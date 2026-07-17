// W8 — pure deterministic analysis (no I/O, no LLM). Unit-testable: given the
// substrate facts + a topology distance map, these produce the gradeable
// structure. The LLM never enters here (T-CORRELATION-LLM).

import type { AlertRecord, ChangeEvent } from '../datasource/data-source.types';
import type {
  BranchClassification,
  Confidence,
  RankedCause,
  RecommendedAction,
  TimelineEntry,
} from './incident.types';

/**
 * Rank recent changes by topology-proximity × recency. A change ON the incident
 * (distance 0) just BEFORE onset scores highest — the "what changed before it
 * broke" smoking gun. A change after onset, or far in the graph, scores ~0.
 */
export function rankRootCauses(
  changes: ChangeEvent[],
  distanceByCi: Map<string, number>,
  incidentOnsetMs: number,
): RankedCause[] {
  const scored = changes.map((c) => {
    const distance = distanceByCi.get(c.ciExternalId) ?? Infinity;
    const dtHours = (incidentOnsetMs - Date.parse(c.at)) / 3_600_000;
    // Only changes BEFORE onset are causal candidates — a change AFTER the
    // incident started cannot have caused it (score 0, regardless of proximity).
    const causal = dtHours >= 0;
    const recencyHours = causal ? dtHours : Infinity;
    const proximityScore = Number.isFinite(distance) ? 10 / (1 + distance) : 0;
    const recencyScore = causal && Number.isFinite(recencyHours) ? 6 / (1 + recencyHours) : 0;
    const score = causal ? Math.round((proximityScore + recencyScore) * 100) / 100 : 0;
    return {
      changeRef: c.changeRef,
      ciExternalId: c.ciExternalId,
      at: c.at,
      summary: c.summary,
      proximity: Number.isFinite(distance) ? distance : -1,
      recencyHours: Number.isFinite(recencyHours) ? Math.round(recencyHours * 10) / 10 : -1,
      score,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s, i): RankedCause => ({ ...s, rank: i + 1 }));
}

/**
 * Classify a branch failure pattern + scope. Scope discrimination is the §9.1
 * property at the reasoning layer: a branch-local failure stays branch-local.
 */
export function classifyBranchFailure(
  isBranchRoot: boolean,
  alerts: AlertRecord[],
  affectedBranchCount: number,
): BranchClassification {
  if (!isBranchRoot) {
    return { isBranchFailure: false, pattern: 'indeterminate', scope: 'not_branch', affectedBranchCount, note: 'root is not a branch CI' };
  }
  const hasUnreachable = alerts.some((a) => /unreachable|availability|down/i.test(`${a.metric} ${a.message}`));
  const hasLatencyOnly = !hasUnreachable && alerts.some((a) => /latency|loss/i.test(`${a.metric} ${a.message}`));
  const distinctCis = new Set(alerts.map((a) => a.ciExternalId)).size;

  let pattern: BranchClassification['pattern'];
  if (hasLatencyOnly) pattern = 'isp_or_link';
  else if (hasUnreachable && distinctCis > 1) pattern = 'site_or_power';
  else if (hasUnreachable) pattern = 'indeterminate'; // single CI unreachable: site/power/device not separable
  else pattern = 'device';

  const scope: BranchClassification['scope'] = affectedBranchCount <= 1 ? 'branch_local' : 'hub_cluster';
  const note =
    pattern === 'indeterminate'
      ? 'root cause (power vs ISP vs on-site device) not determinable from telemetry alone'
      : `classified from alert/reachability shape (${distinctCis} CI alerting)`;
  return { isBranchFailure: true, pattern, scope, affectedBranchCount, note };
}

export function buildTimeline(alerts: AlertRecord[], change: ChangeEvent | null): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  if (change) {
    entries.push({ at: change.at, kind: 'change', ref: change.changeRef, ciExternalId: change.ciExternalId, description: change.summary });
  }
  for (const a of alerts) {
    entries.push({ at: a.firedAt, kind: 'alert', ref: a.alertId, ciExternalId: a.ciExternalId, description: `[${a.severity}] ${a.message}` });
  }
  return entries.sort((x, y) => x.at.localeCompare(y.at));
}

export interface ConfidenceSignals {
  impactGrounded: boolean; // customers measured (not null)
  changeExpectedButMissing: boolean;
  causeIndeterminate: boolean;
  drGap: boolean;
  securityFeedGated: boolean;
}

export function computeConfidence(s: ConfidenceSignals): Confidence {
  let score = 1.0;
  const reasons: string[] = [];
  if (!s.impactGrounded) {
    score -= 0.2;
    reasons.push('customer impact not grounded for this entity (scoped/interface)');
  }
  if (s.changeExpectedButMissing) {
    score -= 0.3;
    reasons.push('expected change record not found in window');
  }
  if (s.causeIndeterminate) {
    score -= 0.2;
    reasons.push('failure cause not determinable from telemetry alone');
  }
  if (s.drGap) {
    score -= 0.1;
    reasons.push('DR-mirror posture unknown (named gap)');
  }
  if (s.securityFeedGated) {
    score -= 0.4;
    reasons.push('security-feed-gated: correlation/attribution lands with the deferred feed');
  }
  score = Math.max(0, Math.round(score * 100) / 100);
  const level: Confidence['level'] = score >= 0.8 ? 'high' : score >= 0.5 ? 'medium' : 'low';
  if (reasons.length === 0) reasons.push('grounding complete across alerts, change window, and impact');
  return { level, score, reasons };
}

export function recommendAction(
  rootCiName: string | null,
  topCause: RankedCause | null,
  classification: BranchClassification | null,
): RecommendedAction {
  let text: string;
  if (topCause) {
    text = `Review/roll back ${topCause.changeRef} on ${topCause.ciExternalId} (top-ranked recent change, ${topCause.recencyHours}h before onset); verify before the next peak.`;
  } else if (classification?.isBranchFailure) {
    text = `Dispatch to the affected branch (${rootCiName ?? 'branch'}); confirm scope is ${classification.scope}; cause ${classification.pattern}.`;
  } else if (rootCiName) {
    text = `Investigate ${rootCiName} as the incident root; consider documented failover/DR where available.`;
  } else {
    text = 'Escalate to the responsible team for investigation.';
  }
  // Every W8 action is a PROPOSAL — a human attests/executes. Zero auto-execute.
  return { mode: 'propose', autoExecute: false, text };
}
