/**
 * CP9.1.3 paste-back harness — LIVE against the AI DB. Boots the real Nest graph
 * and resolves data-class availability + canRender through the actual
 * DataSourceRegistry for two tenants (a CMDB-rich and a CMDB-poor one).
 *
 *   npx ts-node -r tsconfig-paths/register src/dashboard/capability-check.cli.ts
 *
 * Tenants are passed as --rich=<uuid> --poor=<uuid> (defaults below).
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { DataClassCapabilityService, requiredClassesOf } from './data-class-capability';
import { WIDGET_SCHEMAS, type Widget } from './widget-schemas';
import { DATA_CLASSES } from './widget-catalogue';

/* eslint-disable no-console */
const get = (name: string, fb: string) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fb;
};

async function report(svc: DataClassCapabilityService, label: string, tenantId: string, widgets: Widget[]) {
  const snap = await svc.snapshot(tenantId);
  const available = await svc.availableDataClasses(tenantId);
  console.log(`\n================ ${label}  (${tenantId}) ================`);
  console.log(`providers: [${snap.providerNames.join(', ') || '—'}]`);
  console.log(`cmdb caps: ${JSON.stringify(snap.cmdb)}`);
  console.log(`operational (data-driven): ${JSON.stringify(snap.operational)}   apm.mode=${snap.apm.mode}`);
  console.log(`availableDataClasses (${available.size}/${DATA_CLASSES.length}): { ${[...available].sort().join(', ') || '∅'} }`);
  const unavailable = DATA_CLASSES.filter((c) => !available.has(c));
  console.log(`unavailable: { ${unavailable.join(', ')} }`);
  for (const w of widgets) {
    const d = await svc.canRender(w, tenantId);
    console.log(
      `canRender(${w.type}) → render=${d.render}` +
        (d.render ? '' : `  missing=[${d.missing.join(', ')}]`) +
        `   (requires=[${requiredClassesOf(w).join(', ')}])`,
    );
  }
}

async function main(): Promise<void> {
  const rich = get('rich', 'cfc5801f-db4e-454c-a14a-4732d9eac48a');
  const poor = get('poor', '11111111-1111-1111-1111-111111111111');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const svc = app.get(DataClassCapabilityService);
    // Two representative widgets per the brief: a CMDB widget and a deferred one.
    const ciDep: Widget = WIDGET_SCHEMAS.ci_dependency_map.parse({
      id: 'dep', title: 'CBS dependencies', type: 'ci_dependency_map', rootCiRef: 'CI-0002',
    });
    const compliance: Widget = WIDGET_SCHEMAS.compliance_scorecard.parse({
      id: 'comp', title: 'RBI posture', type: 'compliance_scorecard',
    });
    const widgets = [ciDep, compliance];
    await report(svc, 'CMDB-RICH (SynthBank)', rich, widgets);
    await report(svc, 'CMDB-POOR (fresh tenant, canaris_ems only)', poor, widgets);
  } finally {
    await app.close();
  }
  new Logger('CapabilityCheckCli').log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
