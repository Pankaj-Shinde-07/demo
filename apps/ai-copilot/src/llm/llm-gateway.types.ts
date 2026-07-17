import type { LlmUsage, LogicalModel } from './llm-provider.interface';
import type { EvidenceItem } from './grounding';
import type { InjectionFinding } from './injection-scan';

export type { EvidenceItem };

export interface StructuredSafety {
  injectionDetected: boolean;
  injectionFindings: InjectionFinding[];
  maskedSecretCount: number;
}

/**
 * The L2 structured-generation entrypoint (CP9.4 D1). Unlike `complete()`, the
 * caller supplies the system prompt + the output JSON schema directly (no template
 * render, no grounding contract). It still runs the SAME governance: budget guard,
 * injection-scan, secret-mask, cost, audit. `validate` is the caller's strict
 * (e.g. Zod) check; `jsonSchema` is what the model is constrained to emit.
 */
export interface StructuredRequest<T> {
  tenantId: string;
  feature: string; // audit feature key, e.g. 'dashboard_generate'
  system: string;
  prompt: string;
  /**
   * Optional model-level JSON-schema constraint. Anthropic's structured output is
   * strict (additionalProperties:false + all-required), which doesn't fit polymorphic
   * shapes like the widget union — for those, omit this and rely on the system prompt
   * + `validate` (Zod) + the caller's retry. The strict guardrail is `validate`.
   */
  jsonSchema?: Record<string, unknown>;
  validate: (raw: unknown) => { ok: true; data: T } | { ok: false; issues: readonly unknown[] };
  model?: LogicalModel; // default 'sonnet'
  maxTokens?: number;
  temperature?: number;
}

export interface StructuredResult<T> {
  ok: boolean;
  value: T | null;
  issues: readonly unknown[];
  raw: string; // the model's raw output (for retry feed-back + logging)
  auditId: string;
  costUsd: number | null;
  model: string;
  safety: StructuredSafety;
  budgetBlocked: boolean;
}

export interface GatewayRequest {
  tenantId: string;
  /** Versioned prompt template (CP5.2). */
  templateId: string;
  templateVersion?: number;
  /** Industry pack for fragment injection ('banking' | 'default' | ...). */
  packId: string;
  /** Extra template-slot vars (beyond pack fragments). */
  vars?: Record<string, string>;
  /** The user turn / question. */
  question: string;
  /** Grounding evidence; the answer may use ONLY these (CP5.3). */
  evidence?: EvidenceItem[];
  /** Override the template's default grounding requirement. */
  requireGrounding?: boolean;
  /** Raw user input to injection-scan (defaults to `question`). */
  userInput?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GatewayResponse {
  content: string;
  grounded: boolean;
  declined: boolean;
  declineReason: string | null;
  evidenceRefs: string[];
  model: string; // resolved provider id
  provider: string;
  usage: LlmUsage;
  costUsd: number | null;
  latencyMs: number;
  templateId: string;
  templateVersion: number;
  auditId: string;
  retried: boolean;
  safety: {
    injectionDetected: boolean;
    injectionFindings: InjectionFinding[];
    maskedSecretCount: number;
  };
  budget: { allowed: boolean; configured: boolean; softWarn: boolean };
}
