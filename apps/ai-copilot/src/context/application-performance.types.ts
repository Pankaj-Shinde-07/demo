// W6 Phase 2 (APM Tier-A, ADR-004) — the application_performance golden-signal
// block. Tier-A signals (saturation, availability, latency-proxy) joined to CMDB
// CIs, consume-not-instrument. The block ALWAYS exists; its population reflects
// what the provider exposes (present / partial / honest empty-state). No banking
// literal (§6.6).

import type { GoldenSignal, ApmSignalReading, ApmCapabilities } from '../datasource/data-source.types';
import type { ContextGap } from './impact-graph.types';

export type ApmCompleteness = 'present' | 'partial' | 'empty';

export interface ApplicationPerformanceBlock {
  /** present = all in-scope CIs have readings; partial = some; empty = none. */
  completeness: ApmCompleteness;
  /** Golden-signal readings (Class-1 measured-of-SynthBank) joined to CIs. */
  signals: GoldenSignal[];
  /**
   * Named gaps (CP6.4-style): a CI in scope with no telemetry, a DR-mirror with
   * no reachability (dr_posture_unknown), or — when the backing serves no
   * telemetry at all — the honest empty-state gap. Never a silent absence.
   */
  gaps: ContextGap[];
  /** The provider consulted for telemetry, for source attribution. */
  source: { provider: string; type: string } | null;
  /**
   * ADR-006 Tier-B (app-layer) signals — query/response time, success rate —
   * collected agentless (seed mode now; probe mode at the bank). Point-in-time
   * only; flattened across in-scope CIs that carry them. Empty in probe-stub /
   * where no Tier-B is seeded (honest absence, never fabricated).
   */
  tierBSignals: ApmSignalReading[];
  /** What app-layer signals the backing can serve (seed vs probe; percentiles=false). */
  apmCapabilities: ApmCapabilities;
}
