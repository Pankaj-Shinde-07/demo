import { Injectable } from '@nestjs/common';
import { LlmGateway } from '../llm/llm-gateway.service';
import type { EvidenceItem } from '../llm/grounding';
import type { GatewayResponse } from '../llm/llm-gateway.types';
import type { IncidentAnalysis } from './incident.types';

/**
 * W8 narration (CP8.5/8.6) — turns the DETERMINISTIC IncidentAnalysis into a
 * grounded, cited operator summary through the W5 gateway (requireGrounding=true,
 * propose-not-execute template). The model EXPLAINS the computed structure; it
 * never decides the grouping or invents the root cause/impact (T-CORRELATION-LLM,
 * T-GROUNDING). Every figure the model may use is in the evidence; nothing else.
 */
@Injectable()
export class IncidentNarrationService {
  constructor(private readonly gateway: LlmGateway) {}

  async narrate(
    analysis: IncidentAnalysis,
    tenantId: string,
    packId = 'default',
  ): Promise<GatewayResponse> {
    const evidence = this.toEvidence(analysis);
    const question =
      'Summarise this incident for the operator: how many alerts collapsed to one ' +
      'incident, the likely root cause, the business impact (with its class), the ' +
      'proposed next action, the reportability note, and any honest gaps.';
    return this.gateway.complete({
      tenantId,
      templateId: 'incident_summary',
      packId,
      question,
      evidence,
      requireGrounding: true,
    });
  }

  /** Structured analysis → grounding evidence. Ids are stable, cited refs. */
  toEvidence(a: IncidentAnalysis): EvidenceItem[] {
    const ev: EvidenceItem[] = [];
    ev.push({
      id: `incident:${a.incident.incidentId}`,
      label: 'Correlated incident',
      content: `${a.incident.rawAlertCount} raw alerts collapsed to 1 incident (compression ${a.incident.compressionRatio}); root candidate ${a.incident.rootCandidateCiRefs.join(', ')}; window ${a.incident.window.from}..${a.incident.window.to}`,
    });
    const top = a.rankedCauses.find((c) => c.rank === 1 && c.score > 0);
    if (top) {
      ev.push({
        id: `rca:${top.changeRef}`,
        label: 'Top root-cause candidate (recent change)',
        content: `${top.changeRef} on ${top.ciExternalId} at ${top.at}: ${top.summary}; ${top.recencyHours}h before onset, graph-proximity ${top.proximity} (rank #1, score ${top.score})`,
      });
    }
    ev.push({
      id: `impact:${a.impact.rootCiExternalId ?? 'none'}`,
      label: 'Business impact (traversal-derived)',
      content:
        `services=${JSON.stringify(a.impact.services)}; ` +
        `customers=${a.impact.customers === null ? 'unavailable' : a.impact.customers} [${a.impact.customersClass}]; ` +
        `branches=${a.impact.branches}`,
    });
    for (const t of a.timeline) {
      ev.push({ id: `timeline:${t.ref}`, label: `Timeline ${t.kind}`, content: `${t.at} ${t.kind} (${t.ciExternalId ?? 'n/a'}): ${t.description}` });
    }
    if (a.classification?.isBranchFailure) {
      ev.push({ id: `classify:${a.impact.rootCiExternalId}`, label: 'Branch-failure classification', content: `pattern=${a.classification.pattern}; scope=${a.classification.scope}; affectedBranches=${a.classification.affectedBranchCount}; ${a.classification.note}` });
    }
    ev.push({
      id: 'reportability:assessment',
      label: 'Reportability (Assist)',
      content: a.reportability.applicable
        ? `applicable; obligation="${a.reportability.obligation}"; window_hours=${a.reportability.windowHours ?? 'unknown'}; authority=${a.reportability.authority}; caveat="${a.reportability.caveat}"`
        : `not assessed/applicable; caveat="${a.reportability.caveat}"`,
    });
    ev.push({ id: 'action:proposed', label: 'Recommended action (proposed — not executed)', content: `${a.recommendedAction.text} [autoExecute=${a.recommendedAction.autoExecute}]` });
    ev.push({ id: 'confidence', label: 'Confidence', content: `${a.confidence.level} (${a.confidence.score}): ${a.confidence.reasons.join('; ')}` });
    for (const g of a.gaps) {
      ev.push({ id: `gap:${g.scope}:${g.missingInput}`, label: `Gap ${g.degradedOutput}`, content: `${g.scope}: ${g.missingInput} → ${g.degradedOutput} (cannot be asserted)` });
    }
    if (a.synthetic) ev.push({ id: 'disclosure:synthetic', label: 'Data disclosure', content: a.synthetic });
    return ev;
  }
}
