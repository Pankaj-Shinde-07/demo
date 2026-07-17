// W6 Phase 2 (CP6.4) — the graceful-degradation matrix. Maps each MISSING input
// to the OUTPUT it degrades and names it as a gap. This is Auditor #7 (the CMDB
// self-report) in code: the honesty discipline made structural. The invariant is
// degrade-don't-fabricate — a missing input degrades the output and names the
// gap; it never triggers a fabricated fill. No banking literal (§6.6).

import type { BusinessService, ConfigurationItem } from '../datasource/data-source.types';
import type { ContextGap, ImpactGraph } from './impact-graph.types';
import type { BusinessImpactBlock } from './business-impact.types';
import type { ApplicationPerformanceBlock } from './application-performance.types';

export interface ComposeGapsInput {
  ci: ConfigurationItem;
  services: BusinessService[];
  relCount: number;
  impact: ImpactGraph;
  businessImpact: BusinessImpactBlock;
  applicationPerformance: ApplicationPerformanceBlock;
}

/**
 * Compose the full gap set for a resolved CI's context. Sources, in order:
 *   1. CI-level completeness gaps (owner / tier / relationships) — the
 *      degradation matrix proper;
 *   2. the CP6.3 traversal gaps (dangling edges, services with no CI links);
 *   3. the D15 business_impact gaps (figures that could not be grounded);
 *   4. the APM block gaps (telemetry absent/partial).
 * Deduped on (scope, missingInput, degradedOutput).
 */
export function composeGaps(input: ComposeGapsInput): ContextGap[] {
  const { ci, services, relCount, impact, businessImpact, applicationPerformance } = input;
  const scope = `ci:${ci.externalId ?? ci.id}`;
  const gaps: ContextGap[] = [];

  // 1) CI-level degradation matrix.
  if (!ci.technicalOwner && !ci.businessOwner) {
    gaps.push({ scope, missingInput: 'owner', degradedOutput: 'ownership_unavailable' });
  }
  if (ci.criticalityTier === 'unknown') {
    gaps.push({ scope, missingInput: 'criticality_tier', degradedOutput: 'tier_prioritization_unavailable' });
  }
  if (relCount === 0) {
    gaps.push({ scope, missingInput: 'relationships', degradedOutput: 'dependency_chain_truncated' });
  }
  if (services.length === 0) {
    gaps.push({ scope, missingInput: 'service_links', degradedOutput: 'blast_radius_unavailable' });
  }
  // DR-coverage self-report: a CI with no DR mapping cannot have its failover
  // claimed. Surfaces the deliberate SynthBank DR-coverage gap as a named gap
  // ("watch it tell me what it can't prove"), never a fabricated "DR: covered".
  const dr = ci.attributes?.['dr_mapping'];
  const hasDr = typeof dr === 'string' && dr.trim().length > 0;
  if (!hasDr) {
    gaps.push({ scope, missingInput: 'dr_mapping', degradedOutput: 'dr_coverage_unverified' });
  }

  // 2-4) merge the sub-block gaps.
  gaps.push(...impact.gaps, ...businessImpact.gaps, ...applicationPerformance.gaps);

  return dedupe(gaps);
}

function dedupe(gaps: ContextGap[]): ContextGap[] {
  const seen = new Set<string>();
  const out: ContextGap[] = [];
  for (const g of gaps) {
    const k = `${g.scope}|${g.missingInput}|${g.degradedOutput}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(g);
  }
  return out;
}
