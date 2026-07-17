/**
 * CP9.4.4 honesty carries — LIVE:
 *   (a) asset_status NULL → a CI whose golden signal has no availability reading
 *       resolves as UNKNOWN, never "up";
 *   (b) ai_narrative on a thin/poor tenant honestly reports limited data (no rosy
 *       confabulation) — the one LLM-on-data surface.
 *
 *   PACKS_ROOT=<repo>/packs npx ts-node -r tsconfig-paths/register \
 *     src/dashboard/cp94-honesty.cli.ts
 */
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { WidgetResolverService } from './dsl/resolver';
import { BoardDigestService } from './board-digest.service';
import { WidgetSchema, type Widget } from './widget-schemas';

/* eslint-disable no-console */
const RICH = 'cfc5801f-db4e-454c-a14a-4732d9eac48a';
const POOR = '11111111-1111-1111-1111-111111111111';
const CI = 'CI-0002';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const db = app.get(DataSource);
  const resolver = app.get(WidgetResolverService);

  console.log('############ CP9.4.4 (a) — asset_status with no availability reading → UNKNOWN ############');
  const [before] = await db.query(
    `SELECT attributes->'golden_signal'->>'availability_state' AS av FROM cmdb_configuration_items
      WHERE tenant_id=$1 AND ci_external_id=$2`, [RICH, CI]);
  console.log(`CI ${CI} availability_state before: ${before?.av}`);

  // Temporarily strip the availability reading (keep the golden_signal object).
  await db.query(
    `UPDATE cmdb_configuration_items
        SET attributes = jsonb_set(attributes, '{golden_signal}', (attributes->'golden_signal') - 'availability_state')
      WHERE tenant_id=$1 AND ci_external_id=$2`, [RICH, CI]);

  const w: Widget = WidgetSchema.parse({
    id: 's', type: 'status_traffic_light', title: 'Status',
    query: { dataClass: 'asset_status', scope: { level: 'ci', ref: CI } },
  });
  const r = await resolver.resolve(w, RICH);
  console.log(`resolved status (reading stripped): ${r.detail}`);
  console.log(`→ reported UNKNOWN, not up: ${/unknown:1/.test(r.detail)}`);

  // Restore.
  await db.query(
    `UPDATE cmdb_configuration_items
        SET attributes = jsonb_set(attributes, '{golden_signal,availability_state}', to_jsonb($3::text))
      WHERE tenant_id=$1 AND ci_external_id=$2`, [RICH, CI, before?.av ?? 'up']);
  const [after] = await db.query(
    `SELECT attributes->'golden_signal'->>'availability_state' AS av FROM cmdb_configuration_items
      WHERE tenant_id=$1 AND ci_external_id=$2`, [RICH, CI]);
  console.log(`CI ${CI} availability_state restored: ${after?.av}`);

  console.log('\n############ CP9.4.4 (b) — ai_narrative grounding on a thin (poor) tenant ############');
  const digest = await app.get(BoardDigestService).assembleWithNarrative(POOR, 'banking', new Date().toISOString(), true);
  const n = digest.narrative;
  console.log(`narrative: declined=${n?.declined} grounded=${n?.grounded} model=${n?.model}`);
  console.log(`content: ${(n?.content ?? '').slice(0, 360)}`);

  await app.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
