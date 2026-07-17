/**
 * CP9.2.5 paste-back — LIVE. Resolves representative widgets for each of the five
 * WIRED personas against the seeded rich tenant, printing live-vs-empty per widget.
 * This is the realistic input to CP9.3 (templates must not promise widgets that can't
 * yet resolve).
 *
 *   npx ts-node -r tsconfig-paths/register src/dashboard/dsl/persona-resolve.cli.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { WidgetResolverService } from './resolver';
import { WidgetSchema, type Widget } from '../widget-schemas';
import type { WidgetQueryInput } from './widget-query.schema';

/* eslint-disable no-console */
const RICH = process.argv.slice(2).find((a) => a.startsWith('--tenant='))?.slice(9) ?? 'cfc5801f-db4e-454c-a14a-4732d9eac48a';
const CI = 'CI-0002'; // CBS DB Node 1 — a telemetered, related CI

type WInput = Record<string, unknown> & { type: string; id: string; title: string };
const W = (o: WInput): Widget => WidgetSchema.parse(o);
const q = (x: WidgetQueryInput) => x;

const ciMetrics = (id: string, title: string, type: string, extra: Record<string, unknown> = {}) =>
  W({ id, title, type, requiredDataClasses: ['metrics'], query: q({ dataClass: 'metrics', scope: { level: 'ci', ref: CI }, aggregation: 'latest' }), ...extra });

const PERSONAS: Record<string, Widget[]> = {
  'CEO — Bank Digital Operations Scorecard': [
    W({ id: 'ceo-narr', title: 'Executive summary', type: 'ai_narrative', query: q({ dataClass: 'incidents' }) }),
    W({ id: 'ceo-tl', title: 'Service traffic light', type: 'status_traffic_light', query: q({ dataClass: 'asset_status', scope: { level: 'ci', ref: CI } }) }),
    ciMetrics('ceo-gauge', 'CBS availability', 'availability_gauge'),
    ciMetrics('ceo-sla', 'SLA %', 'kpi_tile'),
    W({ id: 'ceo-inc', title: 'Critical incidents', type: 'kpi_tile', requiredDataClasses: ['incidents'], query: q({ dataClass: 'incidents' }) }),
    W({ id: 'ceo-shm', title: 'Service health map', type: 'service_health_map', query: q({ dataClass: 'asset_status', scope: { level: 'tenant' } }) }),
    W({ id: 'ceo-heat', title: 'Risk heat map', type: 'heat_map', xDimension: 'impact', yDimension: 'likelihood', requiredDataClasses: ['vulnerabilities'], query: q({ dataClass: 'vulnerabilities' }) }),
  ],
  'CIO — Enterprise IT Operations': [
    ciMetrics('cio-infra', 'Infrastructure health', 'kpi_tile'),
    W({ id: 'cio-shm', title: 'Service health map', type: 'service_health_map', query: q({ dataClass: 'asset_status', scope: { level: 'tenant' } }) }),
    W({ id: 'cio-trend', title: 'Incident trend', type: 'trend_chart', metric: 'cpu_saturation_pct', query: q({ dataClass: 'metrics', scope: { level: 'ci', ref: CI }, aggregation: 'avg', window: 'all' }) }),
    W({ id: 'cio-cap', title: 'Capacity forecast', type: 'capacity_forecast', metric: 'cpu_saturation_pct', query: q({ dataClass: 'metrics', scope: { level: 'ci', ref: CI }, aggregation: 'avg', window: 'all' }) }),
    W({ id: 'cio-top', title: 'Top problem CIs', type: 'top_n_table', columns: ['name', 'tier'], requiredDataClasses: ['cmdb_ci'], query: q({ dataClass: 'cmdb_ci', topN: 5 }) }),
    W({ id: 'cio-donut', title: 'Root-cause distribution', type: 'distribution_donut', dimension: 'root_cause', requiredDataClasses: ['incidents'], query: q({ dataClass: 'incidents' }) }),
    W({ id: 'cio-narr', title: 'AI insight', type: 'ai_narrative' }),
  ],
  'NOC — Real-Time Infrastructure': [
    W({ id: 'noc-topo', title: 'Topology', type: 'topology_view', query: q({ dataClass: 'topology', scope: { level: 'ci', ref: CI } }) }),
    W({ id: 'noc-alerts', title: 'Live alarms', type: 'alert_list', query: q({ dataClass: 'alerts', window: 'all' }) }),
    W({ id: 'noc-heat', title: 'Network heat map', type: 'heat_map', xDimension: 'ci', yDimension: 'metric', requiredDataClasses: ['metrics'], query: q({ dataClass: 'metrics', scope: { level: 'ci', ref: CI } }) }),
    W({ id: 'noc-top', title: 'Top bandwidth CIs', type: 'top_n_table', columns: ['name'], requiredDataClasses: ['cmdb_ci'], query: q({ dataClass: 'cmdb_ci', topN: 10 }) }),
    ciMetrics('noc-cpu', 'CPU / Mem / Loss', 'kpi_tile'),
    ciMetrics('noc-wan', 'WAN availability', 'availability_gauge'),
  ],
  'CBS — Business Transaction': [
    ciMetrics('cbs-avail', 'CBS availability', 'kpi_tile'),
    W({ id: 'cbs-trend', title: 'Txn volume', type: 'trend_chart', metric: 'latency_ms', query: q({ dataClass: 'metrics', scope: { level: 'ci', ref: CI }, aggregation: 'avg', window: 'all' }) }),
    W({ id: 'cbs-failed', title: 'Failed txns (alarms)', type: 'top_n_table', columns: ['alert'], requiredDataClasses: ['alerts'], query: q({ dataClass: 'alerts', window: 'all', topN: 5 }) }),
    W({ id: 'cbs-dep', title: 'CBS dependencies', type: 'ci_dependency_map', rootCiRef: CI, query: q({ dataClass: 'cmdb_relationships', scope: { level: 'ci', ref: CI } }) }),
    ciMetrics('cbs-db', 'DB / middleware health', 'kpi_tile'),
  ],
  'Branch Head — Branch Operations': [
    W({ id: 'br-geo', title: 'Regional map', type: 'geo_map', query: q({ dataClass: 'asset_status' }) }),
    ciMetrics('br-conn', 'Connectivity / CBS / ATM', 'kpi_tile'),
    W({ id: 'br-top', title: 'Top problem branches', type: 'top_n_table', columns: ['name'], requiredDataClasses: ['cmdb_ci'], query: q({ dataClass: 'cmdb_ci', filters: [{ field: 'ci_type', op: 'eq', value: 'branch_router' }], topN: 5 }) }),
    W({ id: 'br-link', title: 'Link status', type: 'status_traffic_light', query: q({ dataClass: 'asset_status', scope: { level: 'ci', ref: CI } }) }),
  ],
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const resolver = app.get(WidgetResolverService);
    let live = 0;
    let empty = 0;
    for (const [persona, widgets] of Object.entries(PERSONAS)) {
      console.log(`\n================ ${persona} ================`);
      for (const w of widgets) {
        const r = await resolver.resolve(w, RICH);
        if (r.status === 'live') live++;
        else empty++;
        const tag = r.status === 'live' ? 'LIVE ' : 'empty';
        console.log(`  [${tag}] ${w.type.padEnd(24)} ${String(w.title).padEnd(28)} — ${r.detail}${r.count != null ? ` (n=${r.count})` : ''}`);
      }
    }
    console.log(`\nTOTAL: ${live} live, ${empty} empty-state (honest).`);
  } finally {
    await app.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
