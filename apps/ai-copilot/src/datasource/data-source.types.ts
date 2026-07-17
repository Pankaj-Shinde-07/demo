// Domain types returned by DataSourceProvider implementations (D11 + D13).
//
// These are ENGINE-level, vendor-neutral shapes — no banking literal lives here
// (ADR-003 portability seam). A CanarisEmsDataSource maps native cmdb_* rows into
// these; a future ZabbixDataSource / ITopDataSource maps its own API into the same
// shapes. The Context Engine only ever sees these types, never raw table rows.

import type { CriticalityTier } from '../entities/cmdb-configuration-item.entity';
import type { RelationshipType } from '../entities/cmdb-relationship.entity';
import type { ServiceCiRole } from '../entities/cmdb-service-ci-link.entity';
import type { ChangeRole } from '../entities/cmdb-change-link.entity';

export type { CriticalityTier, RelationshipType, ServiceCiRole, ChangeRole };

/**
 * A resolved owner identity. In the native (Bundled) profile these are derived
 * from the CMDB export's owner emails (deterministic uuid5). External providers
 * resolve them from their own directory. `kind` distinguishes a functional
 * team mailbox from an individual role-holder.
 */
export interface OwnerIdentity {
  id: string;
  name: string;
  email: string | null;
  kind: 'team' | 'role';
}

/** A Configuration Item — structurally richer than a flat asset (D13). */
export interface ConfigurationItem {
  id: string;
  externalId: string | null;
  ciType: string;
  name: string;
  description: string | null;
  criticalityTier: CriticalityTier;
  technicalOwner: OwnerIdentity | null;
  businessOwner: OwnerIdentity | null;
  operationsTeam: string | null;
  /** Opaque ref to the asset in the external operational source (ADR-002). */
  linkedAssetRef: string | null;
  /** Pass-through of the source CMDB's extra attributes (location, status, etc.). */
  attributes: Record<string, unknown>;
  /** Which provider supplied this CI. */
  source: string;
}

export interface BusinessService {
  id: string;
  name: string;
  description: string | null;
  criticalityTier: CriticalityTier;
  /** Raw opaque owner id; resolve to an identity via provider.resolveOwner(). */
  businessOwnerId: string | null;
  businessOwner: OwnerIdentity | null;
  rtoMinutes: number | null;
  rpoMinutes: number | null;
  /** NUMERIC returned as string by pg; null when the source declares no value. */
  revenueImpactHourly: string | null;
  source: string;
}

export interface ServiceCiLink {
  serviceId: string;
  serviceName: string;
  ciId: string;
  ciName: string;
  role: ServiceCiRole | null;
}

/** A single directed dependency edge between two CIs. */
export interface CiRelationship {
  sourceCiId: string;
  targetCiId: string;
  relationshipType: RelationshipType;
  metadata: Record<string, unknown>;
}

/**
 * The neighbourhood of a CI, resolved to `depth` hops. Phase 1 populates depth-1
 * (direct upstream/downstream); deeper traversal + caching is W6 Phase 2 (CP6.3).
 */
export interface CiRelationshipGraph {
  rootCiId: string;
  depth: number;
  /** CIs this CI depends on / runs on (edges where root is the source). */
  upstream: ConfigurationItem[];
  /** CIs that depend on this CI (edges where root is the target). */
  downstream: ConfigurationItem[];
  edges: CiRelationship[];
}

/** A change record linked to a CI. Change details beyond the ref are resolved
 *  via the operational DataSource in a full deployment; the native import keeps
 *  a denormalized summary in metadata for the SynthBank substrate. */
export interface ChangeRecord {
  changeRef: string;
  ciId: string;
  changeRole: ChangeRole | null;
  /** Summary/date/risk carried from the CMDB export where available. */
  metadata: Record<string, unknown>;
}

export interface CiQuery {
  ciType?: string;
  criticalityTier?: CriticalityTier;
  /** Substring match on name (case-insensitive). */
  nameContains?: string;
  limit?: number;
}

export interface TimeWindow {
  from: Date;
  to: Date;
}

/**
 * Tier-A golden-signal reading for a CI (W6 Phase 2 telemetry seed, ADR-004).
 * Vendor-neutral: the native provider reads it from the seeded SynthBank
 * substrate; a future ZabbixProvider (W6.5) maps a live Zabbix host's items into
 * the same shape. Consume-not-instrument — the provider EXPOSES these; the engine
 * never instruments. Nullable fields are honest "not applicable for this CI type".
 */
// 'unknown' = the backing has a signal but no availability reading — surfaced as
// UNKNOWN, never silently treated as 'up' (W9 CP9.4 honesty fix).
export type AvailabilityState = 'up' | 'degraded' | 'down' | 'unknown';

export interface GoldenSignal {
  ciExternalId: string;
  ciName: string;
  availabilityState: AvailabilityState;
  cpuSaturationPct: number | null;
  memorySaturationPct: number | null;
  /** CI-type headline pressure: DB→connection, link→bandwidth, disk→%used. */
  primarySaturationPct: number | null;
  /** Label for primarySaturationPct ('connections'|'bandwidth'|'disk'|…) or null. */
  primaryMetric: string | null;
  latencyMs: number | null;
  packetLossPct: number | null;
  /** Freshness; frozen at the seed's t0 for SynthBank (deterministic). */
  lastReadingAt: string;
}

/** A single point in a CI's shallow recent golden-signal history (§3a). */
export interface GoldenSignalPoint {
  at: string;
  cpuSaturationPct: number | null;
  memorySaturationPct: number | null;
  primarySaturationPct: number | null;
  latencyMs: number | null;
}

/**
 * An alert firing on a CI (SynthBank P2 behavioural layer). Vendor-neutral
 * consumed data: SynthBank-backed now (substrate), Zabbix `problem.get` /
 * security-feed later. The `scenario` label carries synthetic provenance.
 */
export interface AlertRecord {
  alertId: string;
  ciExternalId: string;
  ciName: string;
  severity: 'info' | 'warning' | 'critical';
  firedAt: string;
  metric: string;
  message: string;
  scenario: string | null;
}

/**
 * A change record linked to a CI, with timing (SynthBank P2 RCA seam). The
 * "smoking-gun" change is time-stamped before an incident. Richer than the
 * link-only ChangeRecord — carries the timestamp + summary W8 RCA needs.
 */
export interface ChangeEvent {
  changeRef: string;
  ciExternalId: string;
  ciName: string;
  at: string;
  changeType: string; // 'config' | 'deploy' | 'firmware' | ...
  summary: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  role: string | null;
  scenario: string | null;
}

/**
 * ADR-006 Tier-B (app-layer, probe-able) APM. A single POINT-IN-TIME reading per
 * signal + its baseline (so "Nx baseline" is grounded). NO percentiles (a single
 * reading is not a distribution → honestly absent) and NO time-series (no trend-
 * trap). syntheticLabel is set in seed mode and drops in probe mode (real).
 */
export interface ApmSignalReading {
  metric: 'query_time' | 'response_time' | 'success_rate' | 'error_rate' | 'app_availability';
  value: number;
  unit: 'ms' | 'pct';
  baseline: number | null;
  /** value/baseline for latency signals; null for rates. */
  multipleOfBaseline: number | null;
  readingAt: string;
  /** 'SynthBank synthetic data' in seed mode; null in probe mode (real). */
  syntheticLabel: string | null;
  ciExternalId: string | null;
  ciName: string | null;
}

export interface ServicePerformance {
  /** The CI external-id or service name requested. */
  ref: string;
  name: string | null;
  kind: 'ci' | 'service';
  completeness: 'present' | 'absent';
  signals: ApmSignalReading[];
  /** Always false in v1 — single point-in-time reading, no distribution. */
  percentilesAvailable: false;
  note: string | null;
  source: { provider: string; mode: 'seed' | 'probe' } | null;
}

export interface ApmCapabilities {
  mode: 'seed' | 'probe';
  hasResponseTime: boolean;
  hasQueryTime: boolean;
  hasSuccessRate: boolean;
  hasErrorRate: boolean;
  hasAppAvailability: boolean;
  /** v1: percentiles + traces are not produced by point-in-time probes. */
  hasPercentiles: boolean;
  hasTraces: boolean;
}
