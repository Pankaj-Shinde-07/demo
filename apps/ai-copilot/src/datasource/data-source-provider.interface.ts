// W6 fleshes out this interface (was a W1 compile-only stub). W6.5/W6.6 will
// implement Zabbix and iTop providers against it. This file is interface + types
// only — no classes, no DB access. ADR-002/D11: this is the ONLY path through
// which the Context Engine reads foreign (asset/alert/CMDB) data.

import type {
  ConfigurationItem,
  BusinessService,
  CiRelationshipGraph,
  ChangeRecord,
  AlertRecord,
  ChangeEvent,
  GoldenSignal,
  GoldenSignalPoint,
  OwnerIdentity,
  CiQuery,
  TimeWindow,
  ApmCapabilities,
  ServicePerformance,
} from './data-source.types';

export interface CmdbCapabilities {
  hasConfigurationItems: boolean;
  hasRelationshipGraph: boolean;
  hasBusinessServices: boolean;
  hasChangeLinkage: boolean;
  hasOwnership: boolean;
  hasCriticality: boolean;
  /**
   * W6 Phase 2 telemetry seed: whether this backing can serve Tier-A golden
   * signals for the tenant. A backing that can't (a real brownfield tenant
   * pre-Zabbix) reports false → the APM block degrades to its honest empty-state
   * instead of erroring. SynthBank (seeded substrate) and a live Zabbix-backed
   * tenant report true. Additive — Phase-1 capability consumers ignore it.
   */
  hasGoldenSignals: boolean;
}

/**
 * Thrown by a provider when a method is structurally not supported by that data
 * source (e.g. a CMDB-only provider asked for live metrics). Distinct from a
 * "found nothing" null — the Context Engine uses this to drive graceful
 * degradation rather than treating absence as an error.
 */
export class CapabilityNotSupportedError extends Error {
  constructor(
    public readonly provider: string,
    public readonly method: string,
  ) {
    super(`Provider '${provider}' does not support '${method}'`);
    this.name = 'CapabilityNotSupportedError';
  }
}

export interface DataSourceProvider {
  readonly name: string; // 'canaris_ems' | 'zabbix' | 'itop' | 'servicenow' | ...
  readonly type: 'monitoring' | 'cmdb' | 'native';

  /**
   * What CMDB facts this provider can supply FOR A GIVEN TENANT. Capability is
   * data-driven (a native provider with empty business-service tables reports
   * hasBusinessServices=false), so the Context Engine can degrade honestly.
   * Was a static readonly property in the W1 stub; promoted to a per-tenant
   * method in W6 because completeness is a function of populated data, not the
   * provider class.
   */
  cmdbCapabilities(tenantId: string): Promise<CmdbCapabilities>;

  // ── CMDB (D13) — implemented natively in Phase 1 ────────────────────────────
  getConfigurationItem(ciId: string, tenantId: string): Promise<ConfigurationItem | null>;
  searchConfigurationItems(query: CiQuery, tenantId: string): Promise<ConfigurationItem[]>;
  /** Find a CI by its external id (e.g. 'CI-0001') or exact name. */
  findConfigurationItem(ref: string, tenantId: string): Promise<ConfigurationItem | null>;
  getCiRelationships(ciId: string, depth: number, tenantId: string): Promise<CiRelationshipGraph>;
  getBusinessService(serviceId: string, tenantId: string): Promise<BusinessService | null>;
  getServicesAffectedByCi(ciId: string, tenantId: string): Promise<BusinessService[]>;
  /**
   * The CIs linked to a service (the reverse of getServicesAffectedByCi). Added
   * in W6 Phase 2 (CP6.3): the graph traversal walks seed → affected services →
   * the CIs that consume/support those services, so it can reach the
   * customer-bearing nodes (e.g. branches) for blast-radius counting. Additive
   * to the interface — external providers (Zabbix/iTop, W6.5/6.6) implement it.
   */
  getCisForService(serviceId: string, tenantId: string): Promise<ConfigurationItem[]>;

  // ── Tier-A telemetry (W6 Phase 2 telemetry seed, ADR-004) ───────────────────
  // Golden signals EXPOSED by the backing (consume-not-instrument). The native
  // provider serves them from the seeded SynthBank substrate; the W6.5
  // ZabbixProvider will implement the SAME two methods against a live Zabbix API
  // — one interface, two backings (the synthetic→live switch for telemetry).
  // Keyed by CI EXTERNAL id (the portable, vendor-neutral ref).
  /** Current golden-signal readings for the given CIs (only those the backing has). */
  getGoldenSignalsForCis(ciExternalIds: string[], tenantId: string): Promise<GoldenSignal[]>;
  /** Shallow recent history for one CI (the capacity-trend variant, §3a). */
  getGoldenSignalHistory(
    ciExternalId: string,
    window: TimeWindow,
    tenantId: string,
  ): Promise<GoldenSignalPoint[]>;

  // ── Behavioural / motion reads (SynthBank P2) — windowed, vendor-neutral ─────
  // Alerts firing + change records over a time window, so W8 can ask "what
  // alerts/changes in the last N hours". SynthBank-backed now; Zabbix
  // problem.get / an ITSM change source back the same methods later.
  /** Alerts that fired within the window (all CIs). */
  getAlertsInWindow(window: TimeWindow, tenantId: string): Promise<AlertRecord[]>;
  /**
   * One alert by its id (the alertId → CI bridge for entity.type==='alert').
   * SynthBank-backed: matches against the seeded p2_alerts on each CI. A real
   * operational source (EMS Core alerts API) backs the same method later.
   */
  getAlertById(alertId: string, tenantId: string): Promise<AlertRecord | null>;
  /** Change records timestamped within the window (the RCA seam). */
  getChangesInWindow(window: TimeWindow, tenantId: string): Promise<ChangeEvent[]>;
  getCiChangeHistory(ciId: string, window: TimeWindow, tenantId: string): Promise<ChangeRecord[]>;
  /** Resolve an opaque owner id (technical/business) to its identity. */
  resolveOwner(ownerId: string, tenantId: string): Promise<OwnerIdentity | null>;

  // ── Tier-B APM (ADR-006) — app-layer signals behind the APM_SOURCE switch ────
  // What app-layer signals this backing can serve (seed vs probe mode).
  apmCapabilities(tenantId: string): Promise<ApmCapabilities>;
  /** Point-in-time Tier-B signals for a CI external-id OR a service name. */
  getServicePerformance(ref: string, tenantId: string): Promise<ServicePerformance>;

  // ── Operational data — DEFERRED to a later W6 step / EMS Core API client ─────
  // Declared for interface-completeness per plan lines 304-312. In Phase 1 the
  // native provider throws CapabilityNotSupportedError for these: operational
  // facts (assets/alerts/metrics) flow from EMS Core's REST API, not the
  // self-owned cmdb_* tables. Wiring that client is out of this brief's scope.
  getOperationalEntity(
    kind: 'asset' | 'alert' | 'incident',
    id: string,
    tenantId: string,
  ): Promise<unknown | null>;
}
