-- Migration: 20260514000011 — AI dashboard tables (W9 populates)
-- Purpose: Three tables behind the constrained-generation dashboard builder
--          (D6). dashboard_widget_metadata is global (no tenant_id); the
--          two ai_dashboard_* tables are tenant-scoped.
-- Branch:  ems-platform.AICopilot
-- Workstream: W1 (Foundations) — CP1.1 — M11
-- Date:    2026-05-14
-- Idempotent: safe to re-run.

-- 11a. Saved dashboard templates (tenant-scoped)
CREATE TABLE IF NOT EXISTS ai_dashboard_templates (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                  TEXT        NOT NULL,
  description           TEXT,
  widget_specs          JSONB       NOT NULL,                  -- Array of widget config objects (per dashboard_widget_metadata)
  query_dsl             JSONB       NOT NULL,                  -- Array of query DSL nodes (compiled to parameterized SQL in W9)
  source_pack           TEXT,                                  -- e.g. 'banking', 'aviation'; NULL if user-authored
  created_by_ai         BOOLEAN     NOT NULL DEFAULT FALSE,
  generation_log_id     UUID,                                  -- soft pointer to ai_dashboard_generation_logs.id; FK below
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_dashboard_templates_tenant
  ON ai_dashboard_templates(tenant_id) WHERE deleted_at IS NULL;

-- 11b. Generation logs (one per /dashboard/generate call)
CREATE TABLE IF NOT EXISTS ai_dashboard_generation_logs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id               UUID        NOT NULL,                  -- Q2: no FK
  prompt                TEXT        NOT NULL,
  generated_json        JSONB       NOT NULL,
  validation_errors     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  user_edits            JSONB,                                 -- diff applied by user before save (NULL if not saved or no edits)
  saved_template_id     UUID        REFERENCES ai_dashboard_templates(id) ON DELETE SET NULL,
  model_used            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_dashboard_gen_logs_tenant_created
  ON ai_dashboard_generation_logs(tenant_id, created_at DESC);

-- Backfill the cross-link FK from templates → generation_logs now that the target exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'ai_dashboard_templates'
       AND constraint_name = 'fk_ai_dashboard_templates_generation_log'
  ) THEN
    ALTER TABLE ai_dashboard_templates
      ADD CONSTRAINT fk_ai_dashboard_templates_generation_log
      FOREIGN KEY (generation_log_id) REFERENCES ai_dashboard_generation_logs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 11c. Widget metadata (GLOBAL, not tenant-scoped — same widget catalogue everywhere)
CREATE TABLE IF NOT EXISTS dashboard_widget_metadata (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  widget_type           TEXT        NOT NULL UNIQUE,           -- 'line_chart', 'bar_chart', 'tier_1_services_overview', ...
  schema_version        INTEGER     NOT NULL DEFAULT 1,
  config_schema         JSONB       NOT NULL,                  -- Zod-compatible schema fragment
  description           TEXT,
  supports_data_sources TEXT[]      NOT NULL,                  -- e.g. ARRAY['canaris_ems', 'zabbix', 'itop']
  requires_cmdb         BOOLEAN     NOT NULL DEFAULT FALSE,    -- D13: CMDB-aware widgets render empty-state if FALSE on tenants without CMDB
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  ai_dashboard_templates IS 'Saved dashboards (W9). May be AI-generated and edited.';
COMMENT ON TABLE  ai_dashboard_generation_logs IS 'Audit trail for /dashboard/generate calls — prompt, raw JSON, validation errors, user edits.';
COMMENT ON TABLE  dashboard_widget_metadata IS 'Global widget catalogue (D6). requires_cmdb drives D13 graceful degradation.';
