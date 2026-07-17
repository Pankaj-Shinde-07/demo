// W9 / CP9.1 — Zod schemas for every widget type (design contract §4). The
// `Widget` discriminated union is the single thing the LLM may emit (CP9.4) and
// the only thing a template (CP9.3) may reference. Zod is the runtime gate; the
// TS `Widget` union type is inferred from it so the type and the validator can
// never drift.
//
// Conventions:
//  - `requiredDataClasses` is PINNED via a literal tuple for widgets whose required
//    classes are fixed by type (so a generated/forged widget cannot understate what
//    it needs and dodge the empty-state gate). It is an overridable array for the
//    few widgets that legitimately bind to one of several classes (event_timeline,
//    risk_matrix) and for the per-binding widgets whose needs come from their query.
//  - `query` is the forward-declared DSL placeholder (CP9.2); defaulted to {} here.

import { z } from 'zod';
import { DATA_CLASSES } from './widget-catalogue';
import { WidgetQuerySchema } from './dsl/widget-query.schema';

export const DataClassEnum = z.enum(DATA_CLASSES);

/** Fields shared by every widget. Each member adds its own `type` literal. */
export const WidgetBaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  // CP9.2 — the typed Query DSL (closed structure; no free-text-to-query). Optional:
  // ai_narrative is gateway-backed and template-only widgets may carry no query yet.
  query: WidgetQuerySchema.optional(),
  // Per-binding default; individual members override (pin or re-default) below.
  requiredDataClasses: z.array(DataClassEnum),
});

// ── 1. kpi_tile — per-binding workhorse (design §4.1) ───────────────────────────
export const KpiTile = WidgetBaseSchema.extend({
  type: z.literal('kpi_tile'),
  unit: z.string().optional(),
  format: z.enum(['number', 'percent', 'currency', 'duration']).default('number'),
  thresholds: z
    .object({
      amberAt: z.number().optional(),
      redAt: z.number().optional(),
      direction: z.enum(['higher_is_better', 'lower_is_better']),
    })
    .optional(),
  // Class-3 renders muted/dashed in the UI, per the demo honesty contract.
  confidenceClass: z.enum(['1', '2', '3']).optional(),
});

// ── 2. status_traffic_light ─────────────────────────────────────────────────────
export const StatusTrafficLight = WidgetBaseSchema.extend({
  type: z.literal('status_traffic_light'),
  entityRef: z.string().optional(),
  requiredDataClasses: z.tuple([z.literal('asset_status')]).default(['asset_status']),
});

// ── 3. availability_gauge ───────────────────────────────────────────────────────
export const AvailabilityGauge = WidgetBaseSchema.extend({
  type: z.literal('availability_gauge'),
  targetPct: z.number().min(0).max(100).optional(),
  requiredDataClasses: z.tuple([z.literal('metrics')]).default(['metrics']),
});

// ── 4. trend_chart ──────────────────────────────────────────────────────────────
export const TrendChart = WidgetBaseSchema.extend({
  type: z.literal('trend_chart'),
  metric: z.string().min(1),
  window: z.enum(['24h', '7d', '30d', '90d']).default('7d'),
  aggregation: z.enum(['avg', 'sum', 'max', 'min', 'p95']).default('avg'),
  requiredDataClasses: z.tuple([z.literal('metrics')]).default(['metrics']),
});

// ── 5. distribution_donut — per-binding ─────────────────────────────────────────
export const DistributionDonut = WidgetBaseSchema.extend({
  type: z.literal('distribution_donut'),
  dimension: z.string().min(1),
  maxSlices: z.number().int().min(2).max(12).default(6),
});

// ── 6. heat_map — per-binding ───────────────────────────────────────────────────
export const HeatMap = WidgetBaseSchema.extend({
  type: z.literal('heat_map'),
  xDimension: z.string().min(1),
  yDimension: z.string().min(1),
  metric: z.string().optional(),
});

// ── 7. top_n_table — per-binding ────────────────────────────────────────────────
export const TopNTable = WidgetBaseSchema.extend({
  type: z.literal('top_n_table'),
  columns: z.array(z.string().min(1)).min(1),
  n: z.number().int().min(1).max(100).default(10),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

// ── 8. alert_list ───────────────────────────────────────────────────────────────
export const AlertList = WidgetBaseSchema.extend({
  type: z.literal('alert_list'),
  severityFilter: z
    .array(z.enum(['critical', 'high', 'medium', 'low', 'info']))
    .optional(),
  limit: z.number().int().min(1).max(200).default(25),
  requiredDataClasses: z.tuple([z.literal('alerts')]).default(['alerts']),
});

// ── 9. event_timeline — incidents OR security_events (overridable) ──────────────
export const EventTimeline = WidgetBaseSchema.extend({
  type: z.literal('event_timeline'),
  eventSource: z.enum(['incidents', 'security_events']).default('incidents'),
  window: z.enum(['24h', '7d', '30d']).default('7d'),
  // Default to incidents; a SOC attack-timeline overrides to ['security_events'].
  requiredDataClasses: z.array(DataClassEnum).default(['incidents']),
});

// ── 10. geo_map ─────────────────────────────────────────────────────────────────
export const GeoMap = WidgetBaseSchema.extend({
  type: z.literal('geo_map'),
  regionField: z.string().optional(),
  metric: z.string().optional(),
  requiredDataClasses: z.tuple([z.literal('asset_status')]).default(['asset_status']),
});

// ── 11. topology_view ───────────────────────────────────────────────────────────
export const TopologyView = WidgetBaseSchema.extend({
  type: z.literal('topology_view'),
  rootRef: z.string().optional(),
  depth: z.number().int().min(1).max(3).default(2),
  requiredDataClasses: z.tuple([z.literal('topology')]).default(['topology']),
});

// ── 12. service_health_map ──────────────────────────────────────────────────────
export const ServiceHealthMap = WidgetBaseSchema.extend({
  type: z.literal('service_health_map'),
  groupBy: z.enum(['tier', 'region', 'none']).default('tier'),
  requiredDataClasses: z
    .tuple([z.literal('business_services'), z.literal('asset_status')])
    .default(['business_services', 'asset_status']),
});

// ── 13. ai_narrative — gateway-backed; degrades via honest decline, not gating ──
export const AiNarrative = WidgetBaseSchema.extend({
  type: z.literal('ai_narrative'),
  scope: z.enum(['tenant', 'service', 'ci', 'incident']).default('tenant'),
  entityRef: z.string().optional(),
  maxWords: z.number().int().min(40).max(600).default(220),
  requiredDataClasses: z.array(DataClassEnum).default([]),
});

// ── 14. capacity_forecast ───────────────────────────────────────────────────────
export const CapacityForecast = WidgetBaseSchema.extend({
  type: z.literal('capacity_forecast'),
  metric: z.string().min(1),
  horizon: z.enum(['7d', '30d', '90d']).default('30d'),
  requiredDataClasses: z.tuple([z.literal('metrics')]).default(['metrics']),
});

// ── 15. business_service_health (D13) ───────────────────────────────────────────
export const BusinessServiceHealth = WidgetBaseSchema.extend({
  type: z.literal('business_service_health'),
  serviceRef: z.string().optional(),
  requiredDataClasses: z.tuple([z.literal('business_services')]).default(['business_services']),
});

// ── 16. ci_dependency_map (D13, design §4.2) ────────────────────────────────────
export const CiDependencyMap = WidgetBaseSchema.extend({
  type: z.literal('ci_dependency_map'),
  rootCiRef: z.string().min(1), // opaque CI ref (ADR-002), never a raw EMS id
  depth: z.number().int().min(1).max(3).default(2),
  highlightTier: z.enum(['tier-1', 'tier-2', 'tier-3']).optional(),
  showChangeMarkers: z.boolean().default(true),
  requiredDataClasses: z
    .tuple([z.literal('cmdb_ci'), z.literal('cmdb_relationships')])
    .default(['cmdb_ci', 'cmdb_relationships']),
});

// ── 17. tier_1_services_overview (D13) ──────────────────────────────────────────
export const Tier1ServicesOverview = WidgetBaseSchema.extend({
  type: z.literal('tier_1_services_overview'),
  includeHealth: z.boolean().default(true),
  requiredDataClasses: z
    .tuple([z.literal('business_services'), z.literal('cmdb_ci')])
    .default(['business_services', 'cmdb_ci']),
});

// ── 18. risk_matrix — vulnerabilities OR security_events (deferred) ─────────────
export const RiskMatrix = WidgetBaseSchema.extend({
  type: z.literal('risk_matrix'),
  impactLevels: z.number().int().min(3).max(6).default(5),
  likelihoodLevels: z.number().int().min(3).max(6).default(5),
  requiredDataClasses: z.array(DataClassEnum).default(['vulnerabilities']),
});

// ── 19. compliance_scorecard (deferred, design §4.3) ────────────────────────────
export const ComplianceScorecard = WidgetBaseSchema.extend({
  type: z.literal('compliance_scorecard'),
  framework: z.enum(['rbi', 'iso27001', 'internal']).default('rbi'),
  controls: z.array(z.string()).optional(),
  requiredDataClasses: z
    .tuple([z.literal('compliance_controls'), z.literal('patch_status')])
    .default(['compliance_controls', 'patch_status']),
});

// ── 20. mitre_attack_matrix (deferred) ──────────────────────────────────────────
export const MitreAttackMatrix = WidgetBaseSchema.extend({
  type: z.literal('mitre_attack_matrix'),
  tactics: z.array(z.string()).optional(),
  requiredDataClasses: z
    .tuple([z.literal('security_events'), z.literal('threat_intel')])
    .default(['security_events', 'threat_intel']),
});

/** The catalogue as a discriminated union — the single validation target (D6). */
export const WidgetSchema = z.discriminatedUnion('type', [
  KpiTile,
  StatusTrafficLight,
  AvailabilityGauge,
  TrendChart,
  DistributionDonut,
  HeatMap,
  TopNTable,
  AlertList,
  EventTimeline,
  GeoMap,
  TopologyView,
  ServiceHealthMap,
  AiNarrative,
  CapacityForecast,
  BusinessServiceHealth,
  CiDependencyMap,
  Tier1ServicesOverview,
  RiskMatrix,
  ComplianceScorecard,
  MitreAttackMatrix,
]);

/** The inferred TS discriminated union — kept in lockstep with the validator. */
export type Widget = z.infer<typeof WidgetSchema>;
export type WidgetInput = z.input<typeof WidgetSchema>;

// Per-type inferred types (handy for renderers/resolvers).
export type KpiTileWidget = z.infer<typeof KpiTile>;
export type CiDependencyMapWidget = z.infer<typeof CiDependencyMap>;
export type ComplianceScorecardWidget = z.infer<typeof ComplianceScorecard>;
export type AiNarrativeWidget = z.infer<typeof AiNarrative>;

/** Map of type → schema, for per-widget validation and the metadata seed. */
export const WIDGET_SCHEMAS = {
  kpi_tile: KpiTile,
  status_traffic_light: StatusTrafficLight,
  availability_gauge: AvailabilityGauge,
  trend_chart: TrendChart,
  distribution_donut: DistributionDonut,
  heat_map: HeatMap,
  top_n_table: TopNTable,
  alert_list: AlertList,
  event_timeline: EventTimeline,
  geo_map: GeoMap,
  topology_view: TopologyView,
  service_health_map: ServiceHealthMap,
  ai_narrative: AiNarrative,
  capacity_forecast: CapacityForecast,
  business_service_health: BusinessServiceHealth,
  ci_dependency_map: CiDependencyMap,
  tier_1_services_overview: Tier1ServicesOverview,
  risk_matrix: RiskMatrix,
  compliance_scorecard: ComplianceScorecard,
  mitre_attack_matrix: MitreAttackMatrix,
} as const;
