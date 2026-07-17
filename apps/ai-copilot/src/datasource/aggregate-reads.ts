// W9 / CP9.6 — aggregate ("fleet") reads over self-owned data. These roll up the
// per-CI golden signals + CMDB into tenant/fleet/service-level facts via SQL GROUP BY
// (P5 — aggregated at the data layer, never by pulling a bank-scale CI set into
// memory). Null-preserve is the honesty spine (P2): `unknown` is its own bucket and is
// NEVER folded into "up"; availability % is computed over KNOWN states only.
//
// This is a NARROW capability interface, separate from DataSourceProvider, so it does
// not force every provider/test-double to implement it. CanarisEmsDataSource (the only
// code allowed to issue cmdb_ SQL — D16) implements it; the resolver duck-types via
// hasAggregateReads().

import type { TimeWindow } from './data-source.types';

/** Fleet selector — whole tenant, or narrowed by CI type or a single service. */
export interface FleetFilter {
  ciType?: string | null;
  serviceId?: string | null;
}

/** Availability rollup with the honesty contract baked in (P2). */
export interface AvailabilityRollup {
  up: number;
  degraded: number;
  down: number;
  /** Telemetered CIs with no availability reading — surfaced, never folded into up. */
  unknown: number;
  total: number;
  /** up / (up+degraded+down) over KNOWN states; null when there are no known states. */
  pct: number | null;
}

export interface MetricStat {
  avg: number | null;
  p95: number | null;
}

export interface FleetMetrics {
  /** CIs that carry a golden signal in the selected fleet. 0 ⇒ widget empty-states (P1). */
  telemetered: number;
  availability: AvailabilityRollup;
  cpu: MetricStat;
  memory: MetricStat;
  primary: MetricStat;
  latency: MetricStat;
  packetLoss: MetricStat;
}

export interface FleetHistoryPoint {
  at: string;
  cpu: number | null;
  memory: number | null;
  primary: number | null;
  latency: number | null;
  /** How many CIs contributed to this timestamp's average. */
  ciCount: number;
}

export interface BusinessServiceHealth {
  id: string;
  name: string;
  criticalityTier: string;
  ciCount: number;
  telemetered: number;
  availability: AvailabilityRollup;
}

export interface BusinessServiceFilter {
  tier?: string | null;
}

/** The aggregate read surface (CP9.6). */
export interface AggregateReads {
  getFleetMetrics(tenantId: string, filter?: FleetFilter): Promise<FleetMetrics>;
  getFleetMetricHistory(tenantId: string, filter: FleetFilter, window: TimeWindow): Promise<FleetHistoryPoint[]>;
  listBusinessServices(tenantId: string, filter?: BusinessServiceFilter): Promise<BusinessServiceHealth[]>;
}

export function hasAggregateReads(p: unknown): p is AggregateReads {
  return !!p && typeof (p as AggregateReads).getFleetMetrics === 'function';
}

/** Build the rollup from raw bucket counts — the single place the P2 contract lives. */
export function availabilityRollup(up: number, degraded: number, down: number, unknown: number): AvailabilityRollup {
  const known = up + degraded + down;
  return {
    up,
    degraded,
    down,
    unknown,
    total: known + unknown,
    pct: known > 0 ? Math.round((up / known) * 1000) / 10 : null,
  };
}
