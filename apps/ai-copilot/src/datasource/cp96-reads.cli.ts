/**
 * CP9.6.2 paste-back — LIVE. Exercises the aggregate reads and proves the P2
 * null-preserve contract on a fleet that contains an `unknown` CI.
 *
 *   PACKS_ROOT=<repo>/packs npx ts-node -r tsconfig-paths/register \
 *     src/datasource/cp96-reads.cli.ts
 */
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { CanarisEmsDataSource } from './canaris-ems.data-source';

/* eslint-disable no-console */
const RICH = 'cfc5801f-db4e-454c-a14a-4732d9eac48a';
const WIDE = { from: new Date('2000-01-01T00:00:00Z'), to: new Date('2100-01-01T00:00:00Z') };

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const ems = app.get(CanarisEmsDataSource);
  const db = app.get(DataSource);

  console.log('############ D1 — fleet metrics (whole tenant) ############');
  const fleet = await ems.getFleetMetrics(RICH);
  console.log(`telemetered=${fleet.telemetered}  availability=${JSON.stringify(fleet.availability)}`);
  console.log(`cpu=${JSON.stringify(fleet.cpu)} memory=${JSON.stringify(fleet.memory)} primary=${JSON.stringify(fleet.primary)} latency=${JSON.stringify(fleet.latency)}`);

  console.log('\n############ D1 — fleet metrics filtered by ciType=branch_router ############');
  const br = await ems.getFleetMetrics(RICH, { ciType: 'branch_router' });
  console.log(`telemetered=${br.telemetered}  availability=${JSON.stringify(br.availability)}`);

  console.log('\n############ D1 — fleet metric history (aggregated series) ############');
  const hist = await ems.getFleetMetricHistory(RICH, {}, WIDE);
  console.log(`points=${hist.length}  first=${JSON.stringify(hist[0])}  last=${JSON.stringify(hist[hist.length - 1])}`);

  console.log('\n############ D2 — list business services (health rollup) ############');
  const svcs = await ems.listBusinessServices(RICH);
  console.log(`services=${svcs.length}`);
  for (const s of svcs.slice(0, 5)) console.log(`  ${s.criticalityTier.padEnd(8)} ${s.name.padEnd(28)} cis=${s.ciCount} telem=${s.telemetered} avail=${JSON.stringify(s.availability)}`);
  const tier1 = await ems.listBusinessServices(RICH, { tier: 'tier-1' });
  console.log(`tier-1 services=${tier1.length}`);

  console.log('\n############ P2 — null-preserve: strip one CI\'s availability_state → UNKNOWN bucket ############');
  const before = await ems.getFleetMetrics(RICH);
  console.log(`before: ${JSON.stringify(before.availability)}`);
  await db.query(
    `UPDATE cmdb_configuration_items
        SET attributes = jsonb_set(attributes, '{golden_signal}', (attributes->'golden_signal') - 'availability_state')
      WHERE tenant_id = $1 AND ci_external_id = 'CI-0002'`,
    [RICH],
  );
  const after = await ems.getFleetMetrics(RICH);
  console.log(`after (CI-0002 reading stripped): ${JSON.stringify(after.availability)}`);
  console.log(`→ unknown surfaced (not folded into up): ${after.availability.unknown === before.availability.unknown + 1}`);
  // restore
  await db.query(
    `UPDATE cmdb_configuration_items
        SET attributes = jsonb_set(attributes, '{golden_signal,availability_state}', '"up"'::jsonb)
      WHERE tenant_id = $1 AND ci_external_id = 'CI-0002'`,
    [RICH],
  );
  const restored = await ems.getFleetMetrics(RICH);
  console.log(`restored: ${JSON.stringify(restored.availability)}`);

  await app.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
