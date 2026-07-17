/**
 * CP9.2.2 + 9.2.3 paste-back — pure (no DB). Validates example widget queries and
 * shows the compiled ResolvedPlan for each: a typed provider_call (CMDB), a
 * provider_call with post-filters (operational), a parameterised SQL plan
 * (Copilot-owned), and a not_resolvable (deferred class).
 *
 *   npx ts-node --transpile-only src/dashboard/dsl/dsl-demo.cli.ts
 */
import { WidgetQuerySchema, type WidgetQueryInput } from './widget-query.schema';
import { compileWidgetQuery } from './compiler';

/* eslint-disable no-console */
const examples: { label: string; q: WidgetQueryInput }[] = [
  {
    label: 'CMDB widget — ci_dependency_map (cmdb_relationships, scoped to CI-0002)',
    q: { dataClass: 'cmdb_relationships', scope: { level: 'ci', ref: 'CI-0002' } },
  },
  {
    label: 'Operational widget — alert_list (alerts, last 7d, severity=critical)',
    q: { dataClass: 'alerts', window: '7d', filters: [{ field: 'severity', op: 'eq', value: 'critical' }] },
  },
  {
    label: 'Copilot-owned widget — knowledge docs by type (parameterised SQL)',
    q: { source: 'copilot', copilotTable: 'knowledge_documents', field: 'document_type', aggregation: 'count', topN: 5 },
  },
  {
    label: 'Fleet widget — availability_gauge (metrics, fleet scope, ciType=atm_terminal)',
    q: { dataClass: 'metrics', scope: { level: 'fleet', ciType: 'atm_terminal' }, aggregation: 'pct_up' },
  },
  {
    label: 'Service widget — service_health_map (business_services, tenant scope → listBusinessServices)',
    q: { dataClass: 'business_services', scope: { level: 'tenant' } },
  },
  {
    label: 'Deferred widget — compliance_scorecard (compliance_controls)',
    q: { dataClass: 'compliance_controls' },
  },
];

for (const ex of examples) {
  console.log(`\n=== ${ex.label} ===`);
  const parsed = WidgetQuerySchema.safeParse(ex.q);
  if (!parsed.success) {
    console.log('INVALID:', parsed.error.issues.map((i) => i.message).join('; '));
    continue;
  }
  console.log('validated query:', JSON.stringify(parsed.data));
  const plan = compileWidgetQuery(parsed.data);
  if (plan.kind === 'sql') {
    console.log('plan.kind   : sql');
    console.log('plan.table  :', plan.table);
    console.log('plan.text   :', plan.text);
    console.log('plan.params :', JSON.stringify(plan.params), '   (tenant_id is $1, bound at resolve time)');
  } else if (plan.kind === 'provider_call') {
    console.log('plan.kind   : provider_call');
    console.log('plan        :', JSON.stringify({ provider: plan.provider, method: plan.method, args: plan.args, postFilters: plan.postFilters }));
  } else {
    console.log('plan.kind   : not_resolvable');
    console.log('plan        :', JSON.stringify({ dataClass: plan.dataClass, reason: plan.reason }));
  }
}
