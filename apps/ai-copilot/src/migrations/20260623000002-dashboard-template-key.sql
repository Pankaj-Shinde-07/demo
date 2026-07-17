-- 20260623000002-dashboard-template-key.sql
-- W9 / CP9.4 (D3) — additive: give ai_dashboard_templates a stable `key` slug and a
-- partial unique index on (tenant_id, key) so POST /save is idempotent (P4). The
-- original table keyed on `name` (the human title); a saved/generated dashboard
-- carries a stable `key` distinct from its title. Idempotency excludes soft-deleted
-- rows so a key can be re-used after delete.

ALTER TABLE ai_dashboard_templates ADD COLUMN IF NOT EXISTS key TEXT;

COMMENT ON COLUMN ai_dashboard_templates.key IS
  'Stable slug; (tenant_id, key) is the /save idempotency key (W9 CP9.4).';

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_dashboard_templates_tenant_key
  ON ai_dashboard_templates (tenant_id, key)
  WHERE deleted_at IS NULL AND key IS NOT NULL;
