import { Injectable, Logger } from '@nestjs/common';
import { LlmGateway } from '../llm/llm-gateway.service';
import type { EvidenceItem } from '../llm/grounding';
import { RetrievalService } from '../retrieval/retrieval.service';
import { ContextEngine } from '../context/context-engine.service';
import { DataSourceRegistry } from '../datasource/data-source.registry';
import { IncidentReasoningService } from '../incident/incident-reasoning.service';
import { IncidentNarrationService } from '../incident/incident-narration.service';
import { DashboardTilesService } from '../dashboard/dashboard-tiles.service';
import type { OperationalContext } from '../context/operational-context.types';
import { IntentRouterService } from './intent-router.service';
import { ChatSessionStore } from './chat-session.store';
import { resolveContextEntity } from './entity-resolver';
import type { Citation, ChatRequest, ChatResult, ChatRoute, ChatConfidence } from './chat.types';

/**
 * W7 — the chat orchestrator. Router classifies → capability grounds → W5 gateway
 * narrates. CRITICAL: the grounding / hard-reject decision is FULLY RESOLVED here
 * (gateway.complete returns) BEFORE the controller streams a single token
 * (T-STREAM-FABRICATION). Impact is traversal-derived (never re-stated); every
 * answer is grounded+cited or an honest decline; zero auto-execute. No banking
 * literal in this routing layer (§6.6).
 */

// Demo "current incident" window = the EOD scenario (scenario-2: has the 01:00
// smoking-gun change → "what changed before it broke"). A live system selects the
// active window; the demo scripts it. t0 = 2026-06-09 (the frozen P2 base).
const T0_MS = Date.parse('2026-06-09T00:00:00.000Z');
const HOUR = 3_600_000;
const INCIDENT_WINDOW = {
  from: new Date(T0_MS + 2 * 24 * HOUR - 60_000),
  to: new Date(T0_MS + 2 * 24 * HOUR + 6 * HOUR + 60_000),
  scenario: 'scenario-2',
};

interface Assembled {
  evidence: EvidenceItem[];
  map: Map<string, Citation>;
  template: string;
  confidence: ChatConfidence;
}

@Injectable()
export class ChatOrchestratorService {
  private readonly logger = new Logger(ChatOrchestratorService.name);

  constructor(
    private readonly router: IntentRouterService,
    private readonly retrieval: RetrievalService,
    private readonly context: ContextEngine,
    private readonly registry: DataSourceRegistry,
    private readonly incident: IncidentReasoningService,
    private readonly narration: IncidentNarrationService,
    private readonly gateway: LlmGateway,
    private readonly session: ChatSessionStore,
    private readonly tiles: DashboardTilesService,
  ) {}

  // QoQ / trend / over-time framings — deferred (no accrued history yet).
  private readonly trendRe = /(quarter|\bqoq\b|q-o-q|over time|\btrend\b|growing|month over month|year over year|\byoy\b|history)/i;

  async handle(req: ChatRequest): Promise<ChatResult> {
    const packId = req.packId ?? 'banking';
    const history = await this.session.getHistory(req.tenantId, req.sessionId);
    const route = await this.router.classify(req.message, history, req.tenantId);

    let result: ChatResult;
    if (route === 'out_of_scope') {
      result = await this.declineOutOfScope(req);
    } else if (route === 'value') {
      result = await this.handleValue(req, packId);
    } else {
      const assembled = await this.assemble(route, req, packId);
      if (!assembled || assembled.evidence.length === 0) {
        result = this.clarify(route);
      } else {
        // ── grounding / hard-reject RESOLVES HERE (before any streaming) ────────
        const resp = await this.gateway.complete({
          tenantId: req.tenantId,
          templateId: assembled.template,
          packId,
          question: req.message,
          evidence: assembled.evidence,
          requireGrounding: true,
        });
        const citations = resp.evidenceRefs.map((ref) => assembled.map.get(ref) ?? { ref, label: ref, kind: 'other' as const });
        result = {
          route,
          answer: resp.content,
          grounded: resp.grounded,
          declined: resp.declined,
          citations,
          confidence: resp.declined ? { level: 'low', reasons: ['evidence did not support a confident answer'] } : assembled.confidence,
          evidenceCount: assembled.evidence.length,
          model: resp.model,
        };
      }
    }

    const at = new Date().toISOString();
    await this.session.append(
      req.tenantId,
      req.sessionId,
      { role: 'user', text: req.message, at },
      { role: 'assistant', text: result.answer, route: result.route, at },
    );
    return result;
  }

  // ── capability dispatch + grounding assembly (CP7.2) ─────────────────────────
  private async assemble(route: ChatRoute, req: ChatRequest, packId: string): Promise<Assembled | null> {
    if (route === 'retrieval') return this.assembleRetrieval(req);
    if (route === 'grounded_context') return this.assembleContext(req, packId);
    if (route === 'incident') return this.assembleIncident(req, packId);
    return null;
  }

  private async assembleRetrieval(req: ChatRequest): Promise<Assembled | null> {
    let res;
    try {
      res = await this.retrieval.search({ q: req.message, tenant_id: req.tenantId, k: 6, mode: 'hybrid' } as never);
    } catch (err) {
      this.logger.warn(`retrieval unavailable, degrading to clarify: ${(err as Error).message}`);
      return null; // honest degrade — never fabricate an answer without grounding
    }
    const map = new Map<string, Citation>();
    const evidence: EvidenceItem[] = res.results.map((h) => {
      const id = `kc:${h.chunkId}`;
      const label = h.sectionPath?.length ? `${h.documentTitle} › ${h.sectionPath.join(' › ')}` : h.documentTitle;
      map.set(id, { ref: id, label, kind: 'knowledge' });
      // Full chunk text grounds the answer (snippet is only the UI preview).
      return { id, label, content: h.text ?? h.snippet };
    });
    if (evidence.length === 0) return null;
    const confidence: ChatConfidence =
      evidence.length >= 2
        ? { level: 'high', reasons: [`${evidence.length} relevant passages retrieved`] }
        : { level: 'partial', reasons: ['only one relevant passage found'] };
    return { evidence, map, template: 'chat_answer', confidence };
  }

  private async assembleContext(req: ChatRequest, packId: string): Promise<Assembled | null> {
    const provider = await this.registry.getCmdbProvider(req.tenantId);
    if (!provider) return null;
    const ref = await resolveContextEntity(provider, req.message, req.tenantId);
    if (!ref) return null;
    const ctx = await this.context.buildContext({ tenantId: req.tenantId, entity: { type: 'ci', ref }, packId });
    const { evidence, map } = this.contextEvidence(ctx);
    const drGap = ctx.cmdbContext.gaps.some((g) => g.degradedOutput === 'dr_posture_unknown');
    const confidence: ChatConfidence =
      ctx.cmdbContext.completeness === 'full' && !drGap
        ? { level: 'high', reasons: ['CMDB context complete; impact traversal-derived'] }
        : { level: 'partial', reasons: [`completeness=${ctx.cmdbContext.completeness}`, ...(drGap ? ['DR posture unavailable (named gap)'] : [])] };
    return { evidence, map, template: 'chat_answer', confidence };
  }

  private async assembleIncident(req: ChatRequest, packId: string): Promise<Assembled | null> {
    const analysis = await this.incident.analyzeWindow({
      tenantId: req.tenantId,
      window: { from: INCIDENT_WINDOW.from, to: INCIDENT_WINDOW.to },
      packId,
      scenario: INCIDENT_WINDOW.scenario,
    });
    if (!analysis) return null;
    const evidence = this.narration.toEvidence(analysis);
    const map = new Map<string, Citation>();
    for (const e of evidence) map.set(e.id, { ref: e.id, label: e.label, kind: this.kindOf(e.id) });
    const lvl = analysis.confidence.level;
    const confidence: ChatConfidence = {
      level: lvl === 'high' ? 'high' : lvl === 'medium' ? 'partial' : 'low',
      reasons: analysis.confidence.reasons,
    };
    return { evidence, map, template: 'incident_summary', confidence };
  }

  // ── CMDB context → grounding evidence (impact figures carry their class) ──────
  private contextEvidence(ctx: OperationalContext): { evidence: EvidenceItem[]; map: Map<string, Citation> } {
    const evidence: EvidenceItem[] = [];
    const map = new Map<string, Citation>();
    const push = (id: string, label: string, content: string, kind: Citation['kind']) => {
      evidence.push({ id, label, content });
      map.set(id, { ref: id, label, kind });
    };
    const ci = ctx.cmdbContext.configurationItem;
    if (ci) push(`cmdb:ci:${ci.externalId ?? ci.id}`, `CI ${ci.name}`, `name=${ci.name}; type=${ci.ciType}; criticality=${ci.criticalityTier}; dr_mapping=${(ci.attributes?.['dr_mapping'] as string) || 'none'}`, 'cmdb');
    // Ownership — answers "who owns / who handles" (NOC-k). Real cmdb_context data
    // buildContext already resolves; surfacing it, not relaxing any bar.
    const own = ctx.cmdbContext.ownership;
    if (own.technicalOwner) push(`cmdb:owner:tech:${own.technicalOwner.id}`, `Technical owner ${own.technicalOwner.name}`, `technical_owner=${own.technicalOwner.name} (${own.technicalOwner.kind}); email=${own.technicalOwner.email ?? 'n/a'}`, 'cmdb');
    if (own.businessOwner) push(`cmdb:owner:biz:${own.businessOwner.id}`, `Business owner ${own.businessOwner.name}`, `business_owner=${own.businessOwner.name} (${own.businessOwner.kind}); email=${own.businessOwner.email ?? 'n/a'}`, 'cmdb');
    if (own.operationsTeam) push(`cmdb:ops_team:${own.operationsTeam}`, `Operations team`, `operations_team=${own.operationsTeam}`, 'cmdb');
    // APM Tier-A golden signals — answers "healthy/status right now" (CBS-a/c,
    // ITADM-i) + current saturation (CBS-f). buildContext already computes these;
    // honest empty-state when the backing serves none (no fabrication).
    for (const s of ctx.applicationPerformance.signals) {
      push(`apm:${s.ciExternalId}`, `Golden signals ${s.ciName}`,
        `ci=${s.ciName}; availability=${s.availabilityState}; cpu=${s.cpuSaturationPct ?? 'n/a'}%; mem=${s.memorySaturationPct ?? 'n/a'}%; ` +
        `${s.primaryMetric ? `${s.primaryMetric}=${s.primarySaturationPct ?? 'n/a'}%; ` : ''}latency=${s.latencyMs ?? 'n/a'}ms; loss=${s.packetLossPct ?? 'n/a'}%; reading_at=${s.lastReadingAt}`,
        'cmdb');
    }
    // ADR-006 Tier-B (app-layer) signals — query/response time, success rate.
    // Carries the synthetic label + the honest "percentiles unavailable" note.
    for (const t of ctx.applicationPerformance.tierBSignals) {
      push(
        `apm:tierb:${t.ciExternalId}:${t.metric}`,
        `${t.metric} ${t.ciName ?? ''}`.trim(),
        `${t.metric}=${t.value}${t.unit}` +
          `${t.baseline != null ? `; baseline=${t.baseline}${t.unit}` : ''}` +
          `${t.multipleOfBaseline ? `; ${t.multipleOfBaseline}x baseline` : ''}` +
          `; ci=${t.ciName ?? t.ciExternalId}` +
          `${t.syntheticLabel ? `; ${t.syntheticLabel}` : ''}` +
          `; percentiles=unavailable (point-in-time reading)`,
        'cmdb',
      );
    }
    for (const s of ctx.cmdbContext.businessServices) {
      push(`cmdb:svc:${s.name}`, `Service ${s.name}`, `service=${s.name}; criticality=${s.criticalityTier}; revenue_impact_hourly=${s.revenueImpactHourly ?? 'unknown'}`, 'service');
    }
    for (const f of ctx.cmdbContext.businessImpact.figures) {
      push(`impact:${f.metric}`, `${f.metric} [${f.classLabel}]`, `${f.metric}=${f.value} ${f.unit}; class=${f.classLabel}; grounded_in=${f.groundingInputs.length}; assumptions=${f.assumptions.map((a) => a.description).join(' | ') || 'none'}`, 'impact');
    }
    for (const g of ctx.cmdbContext.gaps) {
      push(`gap:${g.scope}:${g.missingInput}`, `Gap ${g.degradedOutput}`, `${g.scope}: ${g.missingInput} → ${g.degradedOutput} (cannot be asserted)`, 'gap');
    }
    if (ctx.cmdbContext.businessImpact.syntheticDataLabel) {
      push('disclosure:synthetic', 'Data disclosure', ctx.cmdbContext.businessImpact.syntheticDataLabel, 'other');
    }
    return { evidence, map };
  }

  private kindOf(id: string): Citation['kind'] {
    if (id.startsWith('incident:')) return 'incident';
    if (id.startsWith('impact:')) return 'impact';
    if (id.startsWith('gap:')) return 'gap';
    if (id.startsWith('cmdb:svc:')) return 'service';
    if (id.startsWith('cmdb:')) return 'cmdb';
    if (id.startsWith('kc:')) return 'knowledge';
    return 'other';
  }

  // ── value / ROI (CEO-b): bridge to the EXISTING valueRealized() computation ──
  // Surfaces the W9 dashboard value figures as grounded chat evidence — no new
  // computation, same class labels (C1/C2/C3) + [verify] assumptions carried
  // through, grounding bar unchanged. QoQ/trend framings are honestly deferred.
  private async handleValue(req: ChatRequest, packId: string): Promise<ChatResult> {
    const tile = await this.tiles.valueRealized(req.tenantId, packId);
    if (tile.status === 'empty' || tile.figures.length === 0) {
      // No captured baseline → ROI unprovable; honest decline, not a faked number.
      return {
        route: 'value',
        answer: `${tile.notes[0] ?? 'Value-realized is not computable yet.'}`,
        grounded: false,
        declined: true,
        citations: [],
        confidence: { level: 'low', reasons: ['ROI unprovable — no captured baseline'] },
        evidenceCount: 0,
        model: null,
      };
    }

    // Build grounding evidence from the existing figures — carry class + assumptions.
    const evidence: EvidenceItem[] = [];
    const map = new Map<string, Citation>();
    for (const f of tile.figures) {
      const id = `roi:${f.metric}`;
      const refs = f.groundingInputs.map((g) => g.ref).join(', ');
      const assume = f.assumptions.map((a) => a.description).join(' | ') || 'none';
      evidence.push({ id, label: `${f.metric} [${f.classLabel}]`, content: `${f.metric}=${f.value} ${f.unit}; class=${f.classLabel}; grounded_in=[${refs}]; assumptions=${assume}` });
      map.set(id, { ref: id, label: `${f.metric} [${f.classLabel}]`, kind: 'impact' });
    }
    if (tile.label) {
      evidence.push({ id: 'disclosure:synthetic', label: 'Data disclosure', content: tile.label });
      map.set('disclosure:synthetic', { ref: 'disclosure:synthetic', label: 'Data disclosure', kind: 'other' });
    }

    // QoQ / trend / over-time → honest deferral, but a GROUNDED redirect: surface
    // the real monthly-rate figures (cited), declined (no accrued history yet).
    if (this.trendRe.test(req.message)) {
      const lines = tile.figures.map((f) => `• ${f.metric.replace(/_/g, ' ')}: ${f.value} ${f.unit} [${f.classLabel}]`).join('\n');
      return {
        route: 'value',
        answer:
          'No accrued quarter-over-quarter history yet — that builds up once the tool has been running in your environment. ' +
          'What I can show now is the current monthly value-realized (a rate, not a trend):\n' +
          `${lines}\n` +
          'The quarter-over-quarter trend will accrue from these figures once deployed.',
        grounded: false,
        declined: true,
        citations: tile.figures.map((f) => map.get(`roi:${f.metric}`)).filter((c): c is Citation => !!c),
        confidence: { level: 'partial', reasons: ['no accrued QoQ history; redirected to current monthly rate'] },
        evidenceCount: evidence.length,
        model: null,
      };
    }

    // Point-in-time / monthly value (CEO-b) → ground via the gateway on the figures.
    const resp = await this.gateway.complete({
      tenantId: req.tenantId,
      templateId: 'chat_answer',
      packId,
      question: req.message,
      evidence,
      requireGrounding: true,
    });
    const citations = resp.evidenceRefs.map((ref) => map.get(ref) ?? { ref, label: ref, kind: 'other' as const });
    return {
      route: 'value',
      answer: resp.content,
      grounded: resp.grounded,
      declined: resp.declined,
      citations,
      confidence: resp.declined
        ? { level: 'low', reasons: ['evidence did not support a confident answer'] }
        : { level: 'high', reasons: ['grounded on the value-realized computation (baseline × measured compression)'] },
      evidenceCount: evidence.length,
      model: resp.model,
    };
  }

  // ── out-of-scope: honest decline + a useful redirect (D16, CP7.7) ────────────
  private async declineOutOfScope(req: ChatRequest): Promise<ChatResult> {
    let redirect = 'I can show the relevant restart runbook and the infrastructure health I do monitor.';
    const citations: Citation[] = [];
    try {
      const res = await this.retrieval.search({ q: 'EOD failure restart procedure', tenant_id: req.tenantId, k: 2, mode: 'hybrid' } as never);
      if (res.results.length) {
        const h = res.results[0];
        citations.push({ ref: `kc:${h.chunkId}`, label: h.documentTitle, kind: 'knowledge' });
        redirect = `I can show the "${h.documentTitle}" runbook and the CBS infrastructure health I monitor — but not live operational completion status.`;
      }
    } catch {
      /* redirect stays generic */
    }
    return {
      route: 'out_of_scope',
      answer:
        'That is live operational/vendor state I cannot see from here (it is your core-system operator\'s domain), so I will not guess. ' +
        redirect,
      grounded: false,
      declined: true,
      citations,
      confidence: { level: 'high', reasons: ['boundary is known and stated honestly (D16)'] },
      evidenceCount: citations.length,
      model: null,
      redirect,
    };
  }

  private clarify(route: ChatRoute): ChatResult {
    return {
      route,
      answer:
        route === 'grounded_context'
          ? "I couldn't identify which CI or service you mean — name it (e.g. \"Sponsor Bank Link A\" or \"branch 23\") and I'll pull its grounded impact."
          : 'I could not find grounding for that — try rephrasing or naming the service/CI.',
      grounded: false,
      declined: true,
      citations: [],
      confidence: { level: 'low', reasons: ['no grounding could be assembled'] },
      evidenceCount: 0,
      model: null,
    };
  }
}
