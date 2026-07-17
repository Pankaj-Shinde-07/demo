/**
 * CP9.1.4 — generator for the dashboard_widget_metadata seed migration. Emits one
 * idempotent upsert per widget type from the SINGLE source of truth (the catalogue
 * + Zod schemas), so the global widget registry in the DB can never drift from the
 * TS union. Re-run after changing the catalogue; commit both the generator and the
 * generated .sql.
 *
 *   npx ts-node --transpile-only src/dashboard/gen-widget-metadata-seed.cli.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { WIDGET_TYPES, WIDGET_CATALOGUE } from './widget-catalogue';
import { WIDGET_SCHEMAS } from './widget-schemas';

const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;
const pgTextArray = (arr: string[]) => `'{${arr.map((a) => `"${a}"`).join(',')}}'`;
const toJsonSchema = (schema: unknown) =>
  (z as unknown as { toJSONSchema: (s: unknown) => unknown }).toJSONSchema(schema);

const rows = WIDGET_TYPES.map((t) => {
  const meta = WIDGET_CATALOGUE[t];
  const config = JSON.stringify(toJsonSchema(WIDGET_SCHEMAS[t]));
  return (
    `  (${sqlStr(t)}, 1, ${sqlStr(config)}::jsonb, ${sqlStr(meta.description)}, ` +
    `${pgTextArray(meta.supportsDataSources)}, ${meta.requiresCmdb})`
  );
});

const header = `-- 20260623000001-seed-widget-metadata.sql
-- W9 / CP9.1 (D3) — seed the GLOBAL dashboard_widget_metadata registry with the 20
-- catalogue widget types. Additive + idempotent (ON CONFLICT (widget_type) DO
-- UPDATE), so re-running is a no-op once seeded. GENERATED from the TS catalogue by
-- src/dashboard/gen-widget-metadata-seed.cli.ts — edit the catalogue, not this file.
--
-- config_schema is the JSON Schema of each widget's Zod schema (the contract a
-- generated/template widget of that type must satisfy). requires_cmdb (D13) flips
-- the CMDB-aware widgets; supports_data_sources lists the backings that can supply
-- the widget (empty for the deferred SOC/IS-Auditor widgets → empty-state until a
-- source is registered).

INSERT INTO dashboard_widget_metadata
  (widget_type, schema_version, config_schema, description, supports_data_sources, requires_cmdb)
VALUES
`;

const upsert = `
ON CONFLICT (widget_type) DO UPDATE SET
  schema_version        = EXCLUDED.schema_version,
  config_schema         = EXCLUDED.config_schema,
  description           = EXCLUDED.description,
  supports_data_sources = EXCLUDED.supports_data_sources,
  requires_cmdb         = EXCLUDED.requires_cmdb,
  updated_at            = now();
`;

const sql = header + rows.join(',\n') + upsert;
const out = join(__dirname, '..', 'migrations', '20260623000001-seed-widget-metadata.sql');
writeFileSync(out, sql);
// eslint-disable-next-line no-console
console.log(`wrote ${out} (${WIDGET_TYPES.length} widget rows)`);
