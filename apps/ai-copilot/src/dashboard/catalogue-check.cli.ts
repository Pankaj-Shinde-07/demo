/**
 * CP9.1.2 paste-back harness — pure-schema, no Nest/DB. Proves:
 *   1. the Widget discriminated union has all 20 members (and lists them),
 *   2. one full non-exemplar schema (topology_view) as JSON Schema,
 *   3. the Dashboard envelope validates a hand-written sample (mixed widgets),
 *   4. deliberately-invalid widgets/layout are REJECTED (incl. a forged
 *      requiredDataClasses that tries to dodge the empty-state gate).
 *
 *   npx ts-node --transpile-only src/dashboard/catalogue-check.cli.ts
 */
import { z } from 'zod';
import { WIDGET_TYPES } from './widget-catalogue';
import { WidgetSchema, WIDGET_SCHEMAS } from './widget-schemas';
import { DashboardSchema, type DashboardInput } from './dashboard-schema';

/* eslint-disable no-console */
const line = (s = '') => console.log(s);
const hdr = (s: string) => line(`\n=== ${s} ===`);

hdr('1. Widget union members');
const unionMembers = Object.keys(WIDGET_SCHEMAS);
line(`union member count: ${unionMembers.length} (WIDGET_TYPES: ${WIDGET_TYPES.length})`);
line(unionMembers.join(', '));
if (unionMembers.length !== 20) throw new Error('expected 20 widget types');

hdr('2. Full schema — topology_view (a non-exemplar) as JSON Schema');
try {
  // zod v4 ships z.toJSONSchema
  const json = (z as unknown as { toJSONSchema: (s: unknown) => unknown }).toJSONSchema(
    WIDGET_SCHEMAS.topology_view,
  );
  line(JSON.stringify(json, null, 2));
} catch (e) {
  line(`(z.toJSONSchema unavailable: ${(e as Error).message}) — printing safeParse of a sample instead`);
  line(JSON.stringify(WIDGET_SCHEMAS.topology_view.parse({ id: 'w', title: 't', type: 'topology_view', rootRef: 'CI-0002' }), null, 2));
}

hdr('3. Valid Dashboard sample (kpi_tile + ci_dependency_map + compliance_scorecard)');
const validDash: DashboardInput = {
  schemaVersion: 1,
  key: 'cbs-admin-sample',
  tenantId: 'cfc5801f-db4e-454c-a14a-4732d9eac48a',
  title: 'CBS Admin — sample',
  persona: 'cbs_admin',
  layout: {
    grid: { cols: 12 },
    items: [
      { widgetId: 'k1', x: 0, y: 0, w: 3, h: 2 },
      { widgetId: 'dep1', x: 3, y: 0, w: 6, h: 4 },
      { widgetId: 'comp1', x: 9, y: 0, w: 3, h: 4 },
    ],
  },
  widgets: [
    { id: 'k1', type: 'kpi_tile', title: 'CBS availability', requiredDataClasses: ['metrics'], unit: 'percent', format: 'percent' },
    { id: 'dep1', type: 'ci_dependency_map', title: 'CBS dependencies', rootCiRef: 'CI-0002' },
    { id: 'comp1', type: 'compliance_scorecard', title: 'RBI posture' },
  ],
  generatedBy: 'template',
  createdAt: '2026-06-23T00:00:00.000Z',
  updatedAt: '2026-06-23T00:00:00.000Z',
};
const okRes = DashboardSchema.safeParse(validDash);
line(`safeParse(valid) → success=${okRes.success}`);
if (!okRes.success) { line(JSON.stringify(okRes.error.issues, null, 2)); throw new Error('valid sample failed'); }
line(`  widgets parsed: ${okRes.data.widgets.length}; defaults applied e.g. ci_dependency_map.depth=${(okRes.data.widgets[1] as { depth?: number }).depth}, requiredDataClasses=${JSON.stringify(okRes.data.widgets[2].requiredDataClasses)}`);

hdr('4a. INVALID — forged compliance_scorecard.requiredDataClasses=[] (tries to dodge gate)');
const forged = structuredClone(validDash);
(forged.widgets[2] as { requiredDataClasses: string[] }).requiredDataClasses = [];
const r1 = DashboardSchema.safeParse(forged);
line(`safeParse(forged) → success=${r1.success} (expect false)`);
if (!r1.success) line('  ' + r1.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 3).join(' | '));

hdr('4b. INVALID — topology_view.depth=9 (max 3)');
const r2 = WidgetSchema.safeParse({ id: 't', title: 'topo', type: 'topology_view', depth: 9 });
line(`safeParse(depth=9) → success=${r2.success} (expect false)`);
if (!r2.success) line('  ' + r2.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' | '));

hdr('4c. INVALID — layout references unknown widgetId');
const bad = structuredClone(validDash);
bad.layout.items[0].widgetId = 'ghost';
const r3 = DashboardSchema.safeParse(bad);
line(`safeParse(unknown widgetId) → success=${r3.success} (expect false)`);
if (!r3.success) line('  ' + r3.error.issues.map((i) => i.message).join(' | '));

hdr('4d. INVALID — unknown widget type');
const r4 = WidgetSchema.safeParse({ id: 'x', title: 'x', type: 'frobnicator' });
line(`safeParse(unknown type) → success=${r4.success} (expect false)`);

if (r1.success || r2.success || r3.success || r4.success) throw new Error('an invalid case unexpectedly passed');
line('\nALL CP9.1.2 ASSERTIONS PASSED');
