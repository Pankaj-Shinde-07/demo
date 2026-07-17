import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnthropicProvider } from './anthropic.provider';
import { OllamaProvider } from './ollama.provider';
import { PromptTemplateRegistry } from './prompt-template.registry';
import { TokenBudgetService } from './token-budget.service';
import { LlmAuditService } from './llm-audit.service';
import {
  parseGrounding,
  parseStructuredGrounding,
  groundingInstruction,
  groundingInstructionStructured,
  renderEvidenceBlock,
  GROUNDED_ANSWER_SCHEMA,
  HONEST_NON_ANSWER,
  type EvidenceItem,
  type GroundingResult,
} from './grounding';
import { scanForInjection, sandboxRetrievedContent, type InjectionFinding } from './injection-scan';
import { maskSecrets } from './secret-mask';
import { estimateCostUsd } from './model-pricing';
import type {
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmProvider,
  LlmSystemBlock,
  LlmUsage,
  LogicalModel,
} from './llm-provider.interface';
import type {
  GatewayRequest,
  GatewayResponse,
  StructuredRequest,
  StructuredResult,
} from './llm-gateway.types';

/**
 * Pull the JSON object out of a model response that may be wrapped in a ```json
 * fence or have leading/trailing prose. Used when no model-level json_schema is set
 * (the structured path relies on the system prompt + Zod validate instead).
 */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body.trim();
}

/**
 * The single governed chokepoint for ALL model calls (D7). No other service
 * calls a provider directly. In one place it enforces, for every call:
 *   budget guard → template render (+pack) → injection scan + sandbox →
 *   secret masking → provider call (Haiku/Sonnet routing) → grounding/honesty
 *   enforcement (hard-reject + 1 retry → honest non-answer) → cost → audit.
 * Determinism: near-zero temperature for factual calls.
 */
@Injectable()
export class LlmGateway {
  private readonly logger = new Logger(LlmGateway.name);
  private readonly factualTemp: number;

  constructor(
    private readonly config: ConfigService,
    private readonly anthropic: AnthropicProvider,
    private readonly ollama: OllamaProvider,
    private readonly templates: PromptTemplateRegistry,
    private readonly budget: TokenBudgetService,
    private readonly audit: LlmAuditService,
  ) {
    this.factualTemp = Number(this.config.get('LLM_FACTUAL_TEMPERATURE', 0));
  }

  async complete(req: GatewayRequest): Promise<GatewayResponse> {
    const started = Date.now();
    const rendered = this.templates.render(
      req.templateId,
      req.packId,
      req.vars,
      req.templateVersion,
    );
    const requireGrounding = req.requireGrounding ?? rendered.callType === 'reasoning';
    const evidence = req.evidence ?? [];
    const provider = this.routeProvider(rendered.model);

    // ── Budget guard (pre-call) ─────────────────────────────────────────────
    const budget = await this.budget.check(req.tenantId);
    if (!budget.allowed) {
      return this.blockedByBudget(req, rendered, budget, started);
    }

    // ── Injection scan + sandbox (CP5.4) ────────────────────────────────────
    const scanTarget = [req.userInput ?? req.question, ...evidence.map((e) => e.content)].join('\n');
    const injection = scanForInjection(scanTarget);
    if (injection.detected) {
      this.logger.warn(
        `injection signals in feature=${req.templateId} tenant=${req.tenantId}: ` +
          injection.findings.map((f) => f.pattern).join(','),
      );
    }
    const sandboxedEvidence: EvidenceItem[] = evidence.map((e) => ({
      ...e,
      content: sandboxRetrievedContent(e.content),
    }));

    // Grounding contract block — structured (schema-forced refs) when grounding is
    // required, plain otherwise. Appended after the template prefix (cacheable).
    const groundingBlock: LlmSystemBlock = {
      text: requireGrounding ? groundingInstructionStructured() : groundingInstruction(false),
      cache: true,
    };
    const systemBlocks: LlmSystemBlock[] = [...rendered.systemBlocks, groundingBlock];

    // ── Assemble + mask outbound prompt (CP5.4) ─────────────────────────────
    const userTurn = `${renderEvidenceBlock(sandboxedEvidence)}\n\nQUESTION: ${req.question}`;
    const maskedSystem: LlmSystemBlock[] = systemBlocks.map((b) => ({
      ...b,
      text: maskSecrets(b.text).text,
    }));
    const maskedUser = maskSecrets(userTurn);
    const maskedCount =
      systemBlocks.reduce((n, b) => n + maskSecrets(b.text).maskedCount, 0) +
      maskedUser.maskedCount;
    const parse = (content: string): GroundingResult =>
      requireGrounding
        ? parseStructuredGrounding(content, evidence)
        : parseGrounding(content, evidence);

    // ── Provider call + grounding enforcement (CP5.3) ───────────────────────
    const temperature = req.temperature ?? this.factualTemp;
    const maxTokens = req.maxTokens ?? (rendered.callType === 'classification' ? 64 : 1024);

    const baseReq: LlmCompletionRequest = {
      feature: req.templateId,
      model: rendered.model,
      system: maskedSystem,
      messages: [{ role: 'user', content: maskedUser.text }],
      maxTokens,
      temperature,
      ...(requireGrounding ? { jsonSchema: GROUNDED_ANSWER_SCHEMA } : {}),
    };

    let resp = await provider.complete(baseReq);
    let grounding = parse(resp.content);
    const usage: LlmUsage = { ...resp.usage };
    let retried = false;

    // Hard-reject path: a should-be-grounded answer with no valid evidence_refs
    // gets ONE stricter retry, then an honest non-answer — never a fabrication.
    if (requireGrounding && !grounding.declined && grounding.evidenceRefs.length === 0) {
      retried = true;
      const retryReq: LlmCompletionRequest = {
        ...baseReq,
        messages: [
          { role: 'user', content: maskedUser.text },
          { role: 'assistant', content: resp.content },
          {
            role: 'user',
            content:
              'Your previous answer cited no evidence. Re-answer using ONLY the EVIDENCE ' +
              'block. If it is insufficient, reply `CANNOT_ANSWER: <reason>` and `EVIDENCE: []`. ' +
              'End with the `EVIDENCE: [ids]` line citing real ids.',
          },
        ],
      };
      const retryResp = await provider.complete(retryReq);
      this.accumulate(usage, retryResp.usage);
      resp = retryResp;
      grounding = parse(retryResp.content);
    }

    let { content, declined, evidenceRefs } = this.resolveAnswer(
      grounding,
      requireGrounding,
    );

    // ── Cost + budget accounting + audit (CP5.5) ────────────────────────────
    const costUsd = estimateCostUsd(resp.modelId, usage);
    await this.budget.record(req.tenantId, usage.inputTokens, usage.outputTokens);

    const auditId = await this.audit.log({
      tenantId: req.tenantId,
      feature: `${rendered.templateId}@${rendered.templateVersion}`,
      model: resp.modelId,
      provider: provider.name,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      latencyMs: Date.now() - started,
      promptForHash: maskedSystem.map((b) => b.text).join('\n') + '\n' + maskedUser.text,
      promptExcerpt: maskedUser.text.slice(0, 500),
      responseExcerpt: content.slice(0, 500),
      evidenceRefCount: evidenceRefs.length,
      errorCode: declined ? 'declined_no_grounding' : null,
    });

    return {
      content,
      grounded: !declined && evidenceRefs.length > 0,
      declined,
      declineReason: grounding.declineReason,
      evidenceRefs,
      model: resp.modelId,
      provider: provider.name,
      usage,
      costUsd,
      latencyMs: Date.now() - started,
      templateId: rendered.templateId,
      templateVersion: rendered.templateVersion,
      auditId,
      retried,
      safety: {
        injectionDetected: injection.detected,
        injectionFindings: injection.findings as InjectionFinding[],
        maskedSecretCount: maskedCount,
      },
      budget: { allowed: budget.allowed, configured: budget.configured, softWarn: budget.softWarn },
    };
  }

  /**
   * L2 — structured generation (CP9.4 D1). Constrained-JSON output against a
   * caller-supplied schema, NOT the grounded-answer schema. Reuses the SAME
   * governance as complete(): budget guard → injection-scan → secret-mask →
   * provider call → cost → audit. The model can only emit JSON matching the schema;
   * the caller's `validate` is the authoritative strict check. Never bypasses the
   * gateway (D7). One call per invocation — retry/fallback is the caller's loop.
   */
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const started = Date.now();
    const model: LogicalModel = req.model ?? 'sonnet';
    const provider = this.routeProvider(model);

    const budget = await this.budget.check(req.tenantId);
    if (!budget.allowed) {
      const auditId = await this.audit.log({
        tenantId: req.tenantId, feature: req.feature, model: 'n/a', provider: 'none',
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        latencyMs: Date.now() - started, promptForHash: req.prompt, promptExcerpt: null,
        responseExcerpt: null, evidenceRefCount: 0, errorCode: 'budget_exceeded',
      });
      return {
        ok: false, value: null, issues: [{ message: `budget: ${budget.reason}` }], raw: '',
        auditId, costUsd: 0, model: 'n/a',
        safety: { injectionDetected: false, injectionFindings: [], maskedSecretCount: 0 },
        budgetBlocked: true,
      };
    }

    // Injection scan (logged, not blocked — the schema constraint is the real net:
    // worst case is a valid object of approved widgets, never data access).
    const injection = scanForInjection(req.prompt);
    if (injection.detected) {
      this.logger.warn(
        `injection signals in structured feature=${req.feature} tenant=${req.tenantId}: ` +
          injection.findings.map((f) => f.pattern).join(','),
      );
    }
    const maskedSystem = maskSecrets(req.system);
    const maskedUser = maskSecrets(req.prompt);
    const maskedCount = maskedSystem.maskedCount + maskedUser.maskedCount;

    const llmReq: LlmCompletionRequest = {
      feature: req.feature,
      model,
      system: [{ text: maskedSystem.text, cache: true }],
      messages: [{ role: 'user', content: maskedUser.text }],
      maxTokens: req.maxTokens ?? 2048,
      temperature: req.temperature ?? this.factualTemp,
      ...(req.jsonSchema ? { jsonSchema: req.jsonSchema } : {}),
    };

    const resp = await provider.complete(llmReq);
    const usage: LlmUsage = { ...resp.usage };
    const costUsd = estimateCostUsd(resp.modelId, usage);
    await this.budget.record(req.tenantId, usage.inputTokens, usage.outputTokens);

    let parsed: unknown;
    let parseError: string | null = null;
    try {
      parsed = JSON.parse(extractJson(resp.content));
    } catch (e) {
      parseError = (e as Error).message;
    }
    const validation = parseError
      ? ({ ok: false, issues: [{ message: `invalid JSON: ${parseError}` }] } as const)
      : req.validate(parsed);

    const auditId = await this.audit.log({
      tenantId: req.tenantId, feature: req.feature, model: resp.modelId, provider: provider.name,
      inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens,
      latencyMs: Date.now() - started,
      promptForHash: maskedSystem.text + '\n' + maskedUser.text,
      promptExcerpt: maskedUser.text.slice(0, 500),
      responseExcerpt: resp.content.slice(0, 500),
      evidenceRefCount: 0,
      errorCode: validation.ok ? null : 'structured_validation_failed',
    });

    const safety = {
      injectionDetected: injection.detected,
      injectionFindings: injection.findings as InjectionFinding[],
      maskedSecretCount: maskedCount,
    };
    return validation.ok
      ? { ok: true, value: validation.data, issues: [], raw: resp.content, auditId, costUsd, model: resp.modelId, safety, budgetBlocked: false }
      : { ok: false, value: null, issues: validation.issues, raw: resp.content, auditId, costUsd, model: resp.modelId, safety, budgetBlocked: false };
  }

  /** Hybrid routing seam (D2): pick the provider that serves this logical model. */
  private routeProvider(model: LogicalModel): LlmProvider {
    if (this.ollama.supports(model)) return this.ollama; // post-v1: on-prem hybrid
    return this.anthropic;
  }

  private resolveAnswer(
    grounding: GroundingResult,
    requireGrounding: boolean,
  ): { content: string; declined: boolean; evidenceRefs: string[] } {
    if (grounding.declined) {
      return { content: grounding.cleanContent || HONEST_NON_ANSWER, declined: true, evidenceRefs: [] };
    }
    if (requireGrounding && grounding.evidenceRefs.length === 0) {
      // Retry already happened upstream; still ungrounded → honest non-answer.
      return { content: HONEST_NON_ANSWER, declined: true, evidenceRefs: [] };
    }
    return { content: grounding.cleanContent, declined: false, evidenceRefs: grounding.evidenceRefs };
  }

  private accumulate(into: LlmUsage, more: LlmUsage): void {
    into.inputTokens += more.inputTokens;
    into.outputTokens += more.outputTokens;
    into.cacheReadTokens += more.cacheReadTokens;
    into.cacheWriteTokens += more.cacheWriteTokens;
  }

  private async blockedByBudget(
    req: GatewayRequest,
    rendered: { templateId: string; templateVersion: number },
    budget: { allowed: boolean; configured: boolean; softWarn: boolean; reason: string | null },
    started: number,
  ): Promise<GatewayResponse> {
    const auditId = await this.audit.log({
      tenantId: req.tenantId,
      feature: `${rendered.templateId}@${rendered.templateVersion}`,
      model: 'n/a',
      provider: 'none',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      latencyMs: Date.now() - started,
      promptForHash: req.question,
      promptExcerpt: null,
      responseExcerpt: null,
      evidenceRefCount: 0,
      errorCode: 'budget_exceeded',
    });
    return {
      content: `This request was not sent to the model: ${budget.reason}.`,
      grounded: false,
      declined: true,
      declineReason: budget.reason,
      evidenceRefs: [],
      model: 'n/a',
      provider: 'none',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsd: 0,
      latencyMs: Date.now() - started,
      templateId: rendered.templateId,
      templateVersion: rendered.templateVersion,
      auditId,
      retried: false,
      safety: { injectionDetected: false, injectionFindings: [], maskedSecretCount: 0 },
      budget,
    };
  }
}
