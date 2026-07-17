/**
 * CP9.3b — generator for the seven persona dashboard templates. Defines each as a
 * tenant-agnostic Dashboard template, VALIDATES it against DashboardTemplateSchema
 * (so a shipped YAML can never be invalid), and emits YAML to
 * packs/banking/dashboard-templates/<key>.yaml. Re-run after editing a template;
 * the pack loader re-validates at runtime regardless.
 *
 *   npx ts-node --transpile-only src/dashboard/gen-templates.cli.ts
 *
 * Wired personas (CEO/CIO/NOC/CBS/Branch) compose widgets that resolve live on a
 * CMDB-rich tenant; SOC/IS-Auditor compose real widgets whose deferred data classes
 * empty-state honestly until their sources are registered.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { DashboardTemplateSchema } from './dashboard-schema';

/* eslint-disable no-console */
const CI = 'CI-0002'; // CBS DB Node 1 — telemetered + related, the flagship root CI
type WInput = Record<string, unknown> & { id: string; type: string; title: string };

// CP9.6 — "overall" metric widgets bind to the FLEET aggregate (tenant-wide rollup),
// not a single CI. Per-CI widgets (dependency map, topology) keep scope.ref.
const fleetMetrics = (id: string, title: string, type: string, extra: Record<string, unknown> = {}): WInput => ({
  id, title, type, requiredDataClasses: ['metrics'],
  query: { dataClass: 'metrics', scope: { level: 'fleet' }, aggregation: 'pct_up' }, ...extra,
});

const DEFS: { key: string; persona: string; title: string; widgets: WInput[] }[] = [
  {
    key: 'ceo-bank-digital-operations-scorecard',
    persona: 'ceo',
    title: 'Bank Digital Operations Scorecard',
    widgets: [
      { id: 'narrative', title: 'Executive summary', type: 'ai_narrative', query: { dataClass: 'incidents' } },
      { id: 'traffic', title: 'Service status', type: 'status_traffic_light', query: { dataClass: 'asset_status', scope: { level: 'tenant' } } },
      fleetMetrics('cbs-avail', 'CBS availability', 'availability_gauge'),
      fleetMetrics('sla', 'SLA compliance', 'kpi_tile', { unit: 'percent', format: 'percent' }),
      { id: 'crit-inc', title: 'Critical incidents', type: 'kpi_tile', requiredDataClasses: ['incidents'], query: { dataClass: 'incidents' } },
      { id: 'svc-health', title: 'Service health map', type: 'service_health_map', query: { dataClass: 'business_services', scope: { level: 'tenant' } } },
      { id: 'risk', title: 'Risk heat map', type: 'heat_map', xDimension: 'impact', yDimension: 'likelihood', requiredDataClasses: ['vulnerabilities'], query: { dataClass: 'vulnerabilities' } },
    ],
  },
  {
    key: 'cio-enterprise-it-operations',
    persona: 'cio',
    title: 'Enterprise IT Operations Dashboard',
    widgets: [
      { id: 'narrative', title: 'AI insight', type: 'ai_narrative' },
      fleetMetrics('infra', 'Infrastructure health', 'kpi_tile', { unit: 'percent', format: 'percent' }),
      { id: 'svc-health', title: 'Service health map', type: 'service_health_map', query: { dataClass: 'business_services', scope: { level: 'tenant' } } },
      { id: 'inc-trend', title: 'Saturation trend', type: 'trend_chart', metric: 'cpu_saturation_pct', query: { dataClass: 'metrics', scope: { level: 'fleet' }, aggregation: 'avg', window: 'all' } },
      { id: 'capacity', title: 'Capacity forecast', type: 'capacity_forecast', metric: 'cpu_saturation_pct', query: { dataClass: 'metrics', scope: { level: 'fleet' }, aggregation: 'avg', window: 'all' } },
      { id: 'top-ci', title: 'Top problem CIs', type: 'top_n_table', columns: ['name', 'tier'], requiredDataClasses: ['cmdb_ci'], query: { dataClass: 'cmdb_ci', topN: 5 } },
      { id: 'rca-dist', title: 'Root-cause distribution', type: 'distribution_donut', dimension: 'root_cause', requiredDataClasses: ['incidents'], query: { dataClass: 'incidents' } },
    ],
  },
  {
    key: 'noc-real-time-infrastructure',
    persona: 'noc',
    title: 'Real-Time Infrastructure Dashboard',
    widgets: [
      { id: 'topology', title: 'Topology', type: 'topology_view', rootRef: CI, query: { dataClass: 'topology', scope: { level: 'ci', ref: CI } } },
      { id: 'alarms', title: 'Live alarms', type: 'alert_list', query: { dataClass: 'alerts', window: 'all' } },
      { id: 'net-heat', title: 'Network heat map', type: 'heat_map', xDimension: 'ci', yDimension: 'metric', requiredDataClasses: ['metrics'], query: { dataClass: 'metrics', scope: { level: 'fleet' } } },
      { id: 'top-bw', title: 'Top bandwidth CIs', type: 'top_n_table', columns: ['name'], requiredDataClasses: ['cmdb_ci'], query: { dataClass: 'cmdb_ci', topN: 10 } },
      fleetMetrics('cpu', 'CPU / memory / loss', 'kpi_tile'),
      fleetMetrics('wan', 'WAN availability', 'availability_gauge'),
    ],
  },
  {
    key: 'cbs-business-transaction',
    persona: 'cbs_admin',
    title: 'CBS Business Transaction Dashboard',
    widgets: [
      fleetMetrics('cbs-avail', 'CBS availability', 'kpi_tile', { unit: 'percent', format: 'percent' }),
      { id: 'txn-vol', title: 'Transaction latency trend', type: 'trend_chart', metric: 'latency_ms', query: { dataClass: 'metrics', scope: { level: 'fleet' }, aggregation: 'avg', window: 'all' } },
      { id: 'failed-txn', title: 'Recent alarms', type: 'top_n_table', columns: ['alert'], requiredDataClasses: ['alerts'], query: { dataClass: 'alerts', window: 'all', topN: 5 } },
      { id: 'cbs-dep', title: 'CBS dependencies', type: 'ci_dependency_map', rootCiRef: CI, query: { dataClass: 'cmdb_relationships', scope: { level: 'ci', ref: CI } } },
      fleetMetrics('db-health', 'DB / middleware health', 'kpi_tile'),
    ],
  },
  {
    key: 'branch-operations',
    persona: 'branch_head',
    title: 'Branch Operations Dashboard',
    widgets: [
      { id: 'geo', title: 'Regional status map', type: 'geo_map', query: { dataClass: 'asset_status', scope: { level: 'tenant' }, filters: [{ field: 'ci_type', op: 'eq', value: 'branch_router' }] } },
      fleetMetrics('conn', 'Connectivity / CBS / ATM', 'kpi_tile'),
      { id: 'top-branch', title: 'Top problem branches', type: 'top_n_table', columns: ['name'], requiredDataClasses: ['cmdb_ci'], query: { dataClass: 'cmdb_ci', filters: [{ field: 'ci_type', op: 'eq', value: 'branch_router' }], topN: 5 } },
      { id: 'link', title: 'Link status', type: 'status_traffic_light', query: { dataClass: 'asset_status', scope: { level: 'ci', ref: CI } } },
    ],
  },
  {
    key: 'soc-cyber-security-operations',
    persona: 'soc',
    title: 'Cyber Security Operations Dashboard',
    widgets: [
      { id: 'mitre', title: 'MITRE ATT&CK coverage', type: 'mitre_attack_matrix', query: { dataClass: 'security_events' } },
      { id: 'threat-heat', title: 'Threat heat map', type: 'heat_map', xDimension: 'tactic', yDimension: 'asset', requiredDataClasses: ['security_events'], query: { dataClass: 'security_events' } },
      { id: 'attack-tl', title: 'Attack timeline', type: 'event_timeline', eventSource: 'security_events', requiredDataClasses: ['security_events'], query: { dataClass: 'security_events' } },
      { id: 'risk-mx', title: 'Risk matrix', type: 'risk_matrix', query: { dataClass: 'vulnerabilities' } },
      { id: 'endpoint', title: 'Endpoint health', type: 'kpi_tile', requiredDataClasses: ['security_events'], query: { dataClass: 'security_events' } },
    ],
  },
  {
    key: 'is-auditor-governance-compliance',
    persona: 'is_auditor',
    title: 'IT Governance & Compliance Dashboard',
    widgets: [
      { id: 'compliance', title: 'RBI compliance posture', type: 'compliance_scorecard', framework: 'rbi', query: { dataClass: 'compliance_controls' } },
      { id: 'findings', title: 'Open audit findings', type: 'kpi_tile', requiredDataClasses: ['compliance_controls'], query: { dataClass: 'compliance_controls' } },
      { id: 'violations', title: 'Access / policy violations', type: 'top_n_table', columns: ['control', 'severity'], requiredDataClasses: ['compliance_controls'], query: { dataClass: 'compliance_controls' } },
      { id: 'risk-mx', title: 'Risk matrix', type: 'risk_matrix', query: { dataClass: 'vulnerabilities' } },
    ],
  },
];

function buildLayout(widgets: WInput[]) {
  const items: { widgetId: string; x: number; y: number; w: number; h: number }[] = [];
  let x = 0;
  let y = 0;
  for (const w of widgets) {
    const hero = w.type === 'ai_narrative';
    const width = hero ? 12 : 4;
    if (x + width > 12) {
      x = 0;
      y += 4;
    }
    items.push({ widgetId: w.id, x, y, w: width, h: hero ? 3 : 4 });
    x += width;
    if (x >= 12) {
      x = 0;
      y += 4;
    }
  }
  return { grid: { cols: 12 as const }, items };
}

const outDir = join(__dirname, '..', '..', '..', '..', 'packs', 'banking', 'dashboard-templates');
let ok = 0;
for (const def of DEFS) {
  const template = {
    schemaVersion: 1,
    key: def.key,
    persona: def.persona,
    title: def.title,
    layout: buildLayout(def.widgets),
    widgets: def.widgets,
    generatedBy: 'template',
  };
  const parsed = DashboardTemplateSchema.safeParse(template);
  if (!parsed.success) {
    console.error(`INVALID template ${def.key}:`);
    console.error(parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
    process.exit(1);
  }
  const file = join(outDir, `${def.key}.yaml`);
  writeFileSync(file, yaml.dump(parsed.data, { lineWidth: 120, noRefs: true }));
  console.log(`wrote ${def.key}.yaml (${parsed.data.widgets.length} widgets)`);
  ok++;
}
console.log(`\n${ok}/7 templates generated + validated.`);
