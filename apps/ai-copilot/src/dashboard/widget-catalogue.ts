// W9 / CP9.1 — the widget catalogue: the fixed vocabulary of what a dashboard can
// contain (design contract §1/§3). This file is the human-authoritative source of
// truth for the data-class vocabulary and per-widget capability requirements. The
// Zod schemas (widget-schemas.ts) are derived against these literal sets, and the
// `Widget` discriminated union type is inferred from those schemas.
//
// Discipline (addendum §4): a widget renders IFF its required data classes are all
// suppliable for the tenant; otherwise it renders an honest empty state naming the
// missing class. There is NO fabrication path — a widget cannot exist outside this
// union, and the LLM (CP9.4) can only emit members of it (D6).

/**
 * The capability spine. Every widget declares the data classes it needs; the
 * DataSourceRegistry computes, per tenant, which classes its registered providers
 * can supply. See `data-class-capability.ts` for the class→capability predicates.
 *
 * Reconciliation note (CP9.0 → CP9.1): the design contract §1 annotated each class
 * with EMS method names (getMetrics/getAsset/getTopology). Those methods do NOT
 * exist on the real `DataSourceProvider` interface — operational reads go through
 * `getOperationalEntity`, which currently throws `CapabilityNotSupportedError`
 * (Phase 1). The capability predicates therefore bind to the REAL flags on
 * `CmdbCapabilities`/`ApmCapabilities`; see data-class-capability.ts for the exact
 * mapping and the operational-class FLAG.
 */
export const DATA_CLASSES = [
  // Operational
  'metrics',
  'asset_status',
  'alerts',
  'incidents',
  'topology',
  // CMDB — suppliable now (D13) via CanarisEmsDataSource
  'cmdb_ci',
  'cmdb_relationships',
  'business_services',
  'change_history',
  // Deferred — no provider declares these yet → widgets empty-state honestly
  'security_events',
  'vulnerabilities',
  'threat_intel',
  'compliance_controls',
  'patch_status',
] as const;

export type DataClass = (typeof DATA_CLASSES)[number];

/** Data classes for which NO provider exists today (SOC / IS-Auditor surface). */
export const DEFERRED_DATA_CLASSES: ReadonlySet<DataClass> = new Set<DataClass>([
  'security_events',
  'vulnerabilities',
  'threat_intel',
  'compliance_controls',
  'patch_status',
]);

/** The 20 widget types — the discriminant values of the Widget union (§3). */
export const WIDGET_TYPES = [
  'kpi_tile',
  'status_traffic_light',
  'availability_gauge',
  'trend_chart',
  'distribution_donut',
  'heat_map',
  'top_n_table',
  'alert_list',
  'event_timeline',
  'geo_map',
  'topology_view',
  'service_health_map',
  'ai_narrative',
  'capacity_forecast',
  'business_service_health',
  'ci_dependency_map',
  'tier_1_services_overview',
  'risk_matrix',
  'compliance_scorecard',
  'mitre_attack_matrix',
] as const;

export type WidgetType = (typeof WIDGET_TYPES)[number];

/**
 * Fields shared by every widget (design contract §3). `query` is a forward
 * declaration: CP9.2 introduces the typed Query DSL that compiles to parameterised
 * provider calls. Until then it is an opaque, structured placeholder carried on the
 * widget so templates (CP9.3) and generation (CP9.4) can round-trip it.
 */
export type WidgetQuery = Record<string, unknown>;

export interface WidgetBase {
  /** Unique within the dashboard. */
  id: string;
  type: WidgetType;
  title: string;
  /** DSL ref — compiled to parameterised provider calls in CP9.2. */
  query: WidgetQuery;
  /** The gating set: the widget renders iff these ⊆ availableDataClasses(tenant). */
  requiredDataClasses: DataClass[];
}

/**
 * Per-widget catalogue metadata — the authority for capability gating and for the
 * `dashboard_widget_metadata` seed (D3).
 *
 * - `requiredDataClasses`: FIXED required classes for this type. For `perBinding`
 *   widgets this is the *minimum/illustrative* set; the effective required classes
 *   come from the widget's binding (CP9.2 derives them from the compiled query).
 * - `perBinding`: the widget's required classes depend on what metric/dimension it
 *   binds to (e.g. a `kpi_tile` over an SLA % vs over a CMDB count), so they travel
 *   on the widget instance rather than being fixed by type.
 * - `requiresCmdb`: D13 — the widget is meaningless without CMDB; seeds the
 *   `requires_cmdb` column.
 * - `supportsDataSources`: which backings can supply this widget (seed column).
 * - `deferred`: requires a data class no provider declares yet → ships in SOC /
 *   IS-Auditor templates and empty-states until a source is registered.
 */
export interface WidgetCatalogueEntry {
  type: WidgetType;
  description: string;
  requiredDataClasses: DataClass[];
  perBinding: boolean;
  requiresCmdb: boolean;
  supportsDataSources: string[];
  deferred: boolean;
}

const EMS = 'canaris_ems';
const ZBX = 'zabbix';
const ITOP = 'itop';

export const WIDGET_CATALOGUE: Record<WidgetType, WidgetCatalogueEntry> = {
  kpi_tile: {
    type: 'kpi_tile',
    description: 'Single classed KPI value with RAG thresholds and a Class-1/2/3 confidence badge.',
    requiredDataClasses: [],
    perBinding: true,
    requiresCmdb: false,
    supportsDataSources: [EMS, ZBX, ITOP],
    deferred: false,
  },
  status_traffic_light: {
    type: 'status_traffic_light',
    description: 'Red/amber/green roll-up of an entity or service status.',
    requiredDataClasses: ['asset_status'],
    perBinding: false,
    requiresCmdb: false,
    supportsDataSources: [EMS, ZBX],
    deferred: false,
  },
  availability_gauge: {
    type: 'availability_gauge',
    description: 'Circular gauge of an availability/uptime metric against a target.',
    requiredDataClasses: ['metrics'],
    perBinding: false,
    requiresCmdb: false,
    supportsDataSources: [EMS, ZBX],
    deferred: false,
  },
  trend_chart: {
    type: 'trend_chart',
    description: 'Time-series line/area chart of a metric over a window.',
    requiredDataClasses: ['metrics'],
    perBinding: false,
    requiresCmdb: false,
    supportsDataSources: [EMS, ZBX],
    deferred: false,
  },
  distribution_donut: {
    type: 'distribution_donut',
    description: 'Donut breakdown of a categorical dimension (e.g. root-cause distribution).',
    requiredDataClasses: [],
    perBinding: true,
    requiresCmdb: false,
    supportsDataSources: [EMS, ZBX],
    deferred: false,
  },
  heat_map: {
    type: 'heat_map',
    description: 'Two-dimensional heat map of a metric (risk / network / threat).',
    requiredDataClasses: [],
    perBinding: true,
    requiresCmdb: false,
    supportsDataSources: [EMS, ZBX],
    deferred: false,
  },
  top_n_table: {
    type: 'top_n_table',
    description: 'Ranked table of the top-N entities by a chosen measure.',
    requiredDataClasses: [],
    perBinding: true,
    requiresCmdb: false,
    supportsDataSources: [EMS, ZBX, ITOP],
    deferred: false,
  },
  alert_list: {
    type: 'alert_list',
    description: 'Live list of active alerts, severity-filterable.',
    requiredDataClasses: ['alerts'],
    perBinding: false,
    requiresCmdb: false,
    supportsDataSources: [EMS, ZBX],
    deferred: false,
  },
  event_timeline: {
    type: 'event_timeline',
    description: 'Chronological event stream (incident timeline or attack timeline).',
    requiredDataClasses: ['incidents'],
    perBinding: false,
    requiresCmdb: false,
    supportsDataSources: [EMS],
    deferred: false,
  },
  geo_map: {
    type: 'geo_map',
    description: 'Regional/branch map coloured by status or a metric.',
    requiredDataClasses: ['asset_status'],
    perBinding: false,
    requiresCmdb: false,
    supportsDataSources: [EMS],
    deferred: false,
  },
  topology_view: {
    type: 'topology_view',
    description: 'Network/service topology graph rooted at a CI.',
    requiredDataClasses: ['topology'],
    perBinding: false,
    requiresCmdb: false,
    supportsDataSources: [EMS, ZBX],
    deferred: false,
  },
  service_health_map: {
    type: 'service_health_map',
    description: 'Grid of business services coloured by composite health.',
    requiredDataClasses: ['business_services', 'asset_status'],
    perBinding: false,
    requiresCmdb: false,
    supportsDataSources: [EMS, ITOP],
    deferred: false,
  },
  ai_narrative: {
    type: 'ai_narrative',
    description: 'Grounded, scoped executive/operational narrative (generalises the demo hero). Gateway-backed; degrades via honest decline, not data-class gating.',
    requiredDataClasses: [],
    perBinding: false,
    requiresCmdb: false,
    supportsDataSources: [EMS, ZBX, ITOP],
    deferred: false,
  },
  capacity_forecast: {
    type: 'capacity_forecast',
    description: 'Capacity/utilisation projection of a metric. Displays a forecast signal when a provider supplies one (the analytics are out of W9 scope).',
    requiredDataClasses: ['metrics'],
    perBinding: false,
    requiresCmdb: false,
    supportsDataSources: [EMS, ZBX],
    deferred: false,
  },
  business_service_health: {
    type: 'business_service_health',
    description: 'D13 — health roll-up for one or all business services.',
    requiredDataClasses: ['business_services'],
    perBinding: false,
    requiresCmdb: true,
    supportsDataSources: [EMS, ITOP],
    deferred: false,
  },
  ci_dependency_map: {
    type: 'ci_dependency_map',
    description: 'D13 — CI dependency graph rooted at a CI, with recent-change overlay (RCA value).',
    requiredDataClasses: ['cmdb_ci', 'cmdb_relationships'],
    perBinding: false,
    requiresCmdb: true,
    supportsDataSources: [EMS, ITOP],
    deferred: false,
  },
  tier_1_services_overview: {
    type: 'tier_1_services_overview',
    description: 'D13 — overview of tier-1 (customer-facing/regulator-visible) services and their backing CIs.',
    requiredDataClasses: ['business_services', 'cmdb_ci'],
    perBinding: false,
    requiresCmdb: true,
    supportsDataSources: [EMS, ITOP],
    deferred: false,
  },
  risk_matrix: {
    type: 'risk_matrix',
    description: 'Impact × likelihood risk matrix. Requires a security/vulnerability source → empty-state until registered.',
    requiredDataClasses: ['vulnerabilities'],
    perBinding: false,
    requiresCmdb: false,
    supportsDataSources: [],
    deferred: true,
  },
  compliance_scorecard: {
    type: 'compliance_scorecard',
    description: 'Compliance/patch posture against a framework (RBI/ISO27001). Requires compliance + patch sources → empty-state until registered.',
    requiredDataClasses: ['compliance_controls', 'patch_status'],
    perBinding: false,
    requiresCmdb: false,
    supportsDataSources: [],
    deferred: true,
  },
  mitre_attack_matrix: {
    type: 'mitre_attack_matrix',
    description: 'MITRE ATT&CK coverage/observation matrix. Requires security-event + threat-intel sources → empty-state until registered.',
    requiredDataClasses: ['security_events', 'threat_intel'],
    perBinding: false,
    requiresCmdb: false,
    supportsDataSources: [],
    deferred: true,
  },
};

/** The CMDB-aware widgets (D13) — seed `requires_cmdb = true`. */
export const CMDB_AWARE_WIDGETS: WidgetType[] = WIDGET_TYPES.filter(
  (t) => WIDGET_CATALOGUE[t].requiresCmdb,
);
