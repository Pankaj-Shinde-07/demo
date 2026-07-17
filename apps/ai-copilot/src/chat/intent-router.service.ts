import { Injectable, Logger } from '@nestjs/common';
import { LlmGateway } from '../llm/llm-gateway.service';
import { DataSourceRegistry } from '../datasource/data-source.registry';
import { resolveContextEntity } from './entity-resolver';
import type { ChatRoute, ChatTurn } from './chat.types';

/**
 * W7 (CP7.1) — the intent router. Classifies the user turn into a route and
 * DISPATCHES; it never answers (T-ROUTING-LLM-OVERREACH). Routing is primarily
 * DETERMINISTIC (keyword signals + entity resolution — "dispatch is deterministic
 * once the intent is known"); the cheap haiku `classify_intent` path is the
 * fallback when no deterministic signal fires. A deterministic boundary pre-check
 * catches out-of-scope operational-state questions (D16) before any model call.
 */
@Injectable()
export class IntentRouterService {
  private readonly logger = new Logger(IntentRouterService.name);

  constructor(
    private readonly gateway: LlmGateway,
    private readonly registry: DataSourceRegistry,
  ) {}

  private readonly outOfScopeRe: RegExp[] = [
    /\bdid\b.*\b(complete|finish|run|succeed|fail)\b/i, // "did EOD complete..."
    /\blast night\b/i,
    /\b(live|current)\b.*\b(status|balance|state)\b/i,
    /\bright now\b.*\b(done|complete|finished)\b/i,
    /\braw (firehose|packets?|syslog)\b/i,
  ];
  // "root fault" / "single ... fault" are RCA framings the original "root cause"
  // pattern missed (routed them to context, which lacks the fault → declined).
  private readonly incidentRe = /(alert storm|what changed|before it broke|root cause|root fault|\brca\b|incident|correlat|smoking gun|slow but|behind (it|this|them))/i;
  private readonly impactRe = /(affect|impact|degrad|blast|at risk|who(?:'s| is| are)?|customers|branches|depend|down)/i;
  // Ownership intent — must win even when "incident" appears as the OBJECT of the
  // question ("who owns the incident on CI-0002"); ownership lives in cmdb_context.
  private readonly ownershipRe = /\bwho (owns|should handle|handles|is responsible|to contact)\b|ownership|responsible (team|party|owner)|which team (owns|handles)/i;
  // Live-state / health / posture / DR / saturation / trend / status framings.
  // These are answered by the CMDB/APM context read (buildContext: golden signals,
  // DR mapping, ownership), NOT the incident path and NOT the knowledge corpus.
  private readonly liveStateRe = /(health|healthy|posture|availab|reachable|\bready\b|saturat|\btrend\b|capacity|headroom|utiliz|\bdr\b|\bbcp\b|\brpo\b|\brto\b|failover|cover(?:ed|age)|\bstatus\b|\bslow\b|response time|query (time|performance)|success rate|error rate|\blatency\b|throughput|performance)/i;
  private readonly retrievalRe = /(procedure|runbook|how (do|to|can)|steps|restart|what is the|guide|\bsop\b|playbook|walk me through|renew|rotate|rotation|restore|recover(y)?|backup)/i;
  // Historical "has this happened before / how was it resolved" → the records
  // archive (retrieval over the bank's own past RCA docs), even when "incident"
  // appears as the object — the live incident path holds no history. Checked
  // BEFORE incidentRe so the word "incident" doesn't steal a history question.
  private readonly historicalRe = /(happened before|seen (this|it) before|prior (incident|occurrence|case)|previously|in the past|\bhistorical\b|past incident|how (was|were|did)\b[^?]*\b(resolv|fix|handl)|ever (had|seen))/i;
  // Value / ROI intent — answered from the W9 valueRealized() computation (CEO-b);
  // a QoQ/trend framing within this route is honestly deferred (no accrued history).
  private readonly valueRe = /(value[- ](realized|realised|delivered)|what (has|have|did) (this|it|we|you|the (tool|platform|system))\b[^?]*\b(saved|delivered)|saved us|downtime avoided|noc hours saved|hours saved|penalties averted|\broi\b|return on investment)/i;

  async classify(message: string, history: ChatTurn[], tenantId: string): Promise<ChatRoute> {
    if (this.outOfScopeRe.some((re) => re.test(message))) return 'out_of_scope';

    // Value/ROI intent → the value path (no entity required). The handler grounds
    // on valueRealized() for point-in-time/monthly asks and defers QoQ trend.
    if (this.valueRe.test(message)) return 'value';

    const entity = await this.tryEntity(message, tenantId);

    // Ownership intent → grounded context, BEFORE the incident check, so a
    // "who owns/handles the incident on X" question reaches the owner data.
    if (entity && this.ownershipRe.test(message)) return 'grounded_context';

    // Historical "happened before / how was it resolved" → retrieval over the
    // records archive (beats the incident keyword; the live path has no history).
    if (this.historicalRe.test(message)) return 'retrieval';

    // Incident keywords win next (the "what changed / alert storm / root fault" story).
    if (this.incidentRe.test(message)) return 'incident';

    // A resolvable CI/service + impact intent → grounded context.
    if (entity && this.impactRe.test(message)) return 'grounded_context';

    // A resolvable CI/service + live-state intent → grounded context. MUST precede
    // retrievalRe, else "what is the ... saturation trend / RPO posture" is stolen
    // by the (empty) knowledge corpus and declines.
    if (entity && this.liveStateRe.test(message)) return 'grounded_context';

    // Procedure / knowledge phrasing → retrieval.
    if (this.retrievalRe.test(message)) return 'retrieval';

    // A bare follow-up that resolves to an entity inherits an impact route.
    const lastRoute = [...history].reverse().find((t) => t.role === 'assistant')?.route;
    if (message.trim().length < 40 && entity) return 'grounded_context';
    if (message.trim().length < 40 && (lastRoute === 'grounded_context' || lastRoute === 'incident')) return lastRoute;

    // Fallback: the haiku classifier (still classify-only, never answers).
    return this.classifyViaLlm(message, history, tenantId);
  }

  private async tryEntity(message: string, tenantId: string): Promise<string | null> {
    try {
      const provider = await this.registry.getCmdbProvider(tenantId);
      if (!provider) return null;
      return await resolveContextEntity(provider, message, tenantId);
    } catch {
      return null;
    }
  }

  private async classifyViaLlm(message: string, history: ChatTurn[], tenantId: string): Promise<ChatRoute> {
    const lastUser = [...history].reverse().find((t) => t.role === 'user');
    const question =
      lastUser && message.trim().length < 40 ? `Previous question: ${lastUser.text}\nFollow-up: ${message}` : message;
    let label = 'other';
    try {
      const r = await this.gateway.complete({ tenantId, templateId: 'classify_intent', packId: 'banking', question, requireGrounding: false });
      const c = r.content.toLowerCase();
      label = ['alert_explain', 'rca', 'service_impact', 'knowledge_lookup', 'other'].find((l) => c.includes(l)) ?? 'other';
    } catch (err) {
      this.logger.warn(`classify failed, defaulting to retrieval: ${(err as Error).message}`);
      return 'retrieval';
    }
    switch (label) {
      case 'rca':
      case 'alert_explain':
        return 'incident';
      case 'service_impact':
        return 'grounded_context';
      case 'knowledge_lookup':
        return 'retrieval';
      default:
        return 'out_of_scope';
    }
  }
}
