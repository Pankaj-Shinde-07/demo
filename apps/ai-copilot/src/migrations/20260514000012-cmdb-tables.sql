-- Migration: 20260514000012 — CMDB tables (D13)
-- Purpose: Five CMDB tables, all CREATE NEW per architect-signed-off
--          CMDB_DISCOVERY.md Section 6. Do NOT extend existing assets or
--          device_connections (Q5: kept separate; W6 unions at query time).
--
--          Tables:
--            * cmdb_configuration_items   (CIs, with linked_asset_id → assets)
--            * cmdb_relationships         (semantic CI↔CI dependency graph)
--            * cmdb_business_services
--            * cmdb_service_ci_links      (services ↔ CIs M:N)
--            * cmdb_change_links          (changes ↔ CIs M:N)
--
--          External references (no SQL FK, resolved via DataSourceProvider per ADR-002):
--            * linked_asset_ref TEXT — was Q6's linked_asset_id, realigned 2026-05-15
--            * change_ref TEXT       — was Section 6.8's change_id, realigned 2026-05-15
--          User-owner columns are UUID-typed and INTENTIONALLY UNCONSTRAINED
--          (no FK to public.users) per Q2 — users.id is INTEGER, plus same self-owned principle.
-- Branch:  ems-platform.AICopilot
-- Workstream: W1 (Foundations) — CP1.1 — M12
-- Date:    2026-05-14
-- Idempotent: safe to re-run.

-- ─── 12a. Configuration Items ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cmdb_configuration_items (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ci_external_id      TEXT,                                    -- ID in source system (iTop, ServiceNow, ...) when imported
  ci_type             TEXT        NOT NULL,                    -- 'server', 'router', 'application', 'database', 'banking_application', 'aodb', ...
  name                TEXT        NOT NULL,
  description         TEXT,
  -- Q3 acknowledgment: we deliberately keep TEXT 'tier-1/2/3/unknown' here
  -- as the authoritative criticality tier on a CI, even though existing
  -- assets.tier (INTEGER) covers the same concept on a flat asset. The two
  -- live in parallel for v1; consolidating is a post-v1 cleanup.
  criticality_tier    TEXT        NOT NULL DEFAULT 'unknown'
                                  CHECK (criticality_tier IN ('tier-1', 'tier-2', 'tier-3', 'unknown')),
  technical_owner_id  UUID,                                    -- Q2: no FK to users.id (INTEGER)
  business_owner_id   UUID,                                    -- Q2: no FK
  operations_team     TEXT,
  attributes          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Opaque ref to an asset in an external source (Canaris EMS, Zabbix, iTop, etc.).
  -- Resolved at runtime via DataSourceProvider (D11). No SQL FK — see ADR-002.
  linked_asset_ref    TEXT,
  source              TEXT        NOT NULL DEFAULT 'canaris_ems',     -- 'canaris_ems' | 'itop' | 'servicenow' | ...
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cmdb_ci_tenant_type
  ON cmdb_configuration_items(tenant_id, ci_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cmdb_ci_tenant_criticality
  ON cmdb_configuration_items(tenant_id, criticality_tier) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cmdb_ci_linked_asset
  ON cmdb_configuration_items(linked_asset_ref) WHERE linked_asset_ref IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cmdb_ci_tenant_external
  ON cmdb_configuration_items(tenant_id, source, ci_external_id) WHERE ci_external_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN cmdb_configuration_items.criticality_tier IS 'Authoritative tier for the CI. Coexists with legacy assets.tier (INTEGER) for v1; consolidate post-v1.';
COMMENT ON COLUMN cmdb_configuration_items.linked_asset_ref IS 'Opaque ref to asset in external source. NULL for CIs without a monitored asset. Resolved via DataSourceProvider (D11, ADR-002).';

-- ─── 12b. CI Relationships (semantic dependency graph) ───────────────────
CREATE TABLE IF NOT EXISTS cmdb_relationships (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_ci_id        UUID        NOT NULL REFERENCES cmdb_configuration_items(id) ON DELETE CASCADE,
  target_ci_id        UUID        NOT NULL REFERENCES cmdb_configuration_items(id) ON DELETE CASCADE,
  relationship_type   TEXT        NOT NULL
                                  CHECK (relationship_type IN ('runs_on', 'depends_on', 'connected_to', 'hosts', 'contains')),
  metadata            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  source              TEXT        NOT NULL DEFAULT 'canaris_ems',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Forbid self-loops at the SQL level.
  CONSTRAINT chk_cmdb_rel_no_self_loop CHECK (source_ci_id <> target_ci_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cmdb_rel_edge
  ON cmdb_relationships(tenant_id, source_ci_id, target_ci_id, relationship_type);
CREATE INDEX        IF NOT EXISTS idx_cmdb_rel_source   ON cmdb_relationships(tenant_id, source_ci_id);
CREATE INDEX        IF NOT EXISTS idx_cmdb_rel_target   ON cmdb_relationships(tenant_id, target_ci_id);

COMMENT ON TABLE cmdb_relationships IS 'Semantic CI↔CI dependency graph. Distinct from device_connections (physical-link telemetry). W6 unions both at query time.';

-- ─── 12c. Business Services ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cmdb_business_services (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                    TEXT        NOT NULL,
  description             TEXT,
  criticality_tier        TEXT        NOT NULL DEFAULT 'unknown'
                                      CHECK (criticality_tier IN ('tier-1', 'tier-2', 'tier-3', 'unknown')),
  business_owner_id       UUID,                                -- Q2: no FK
  rto_minutes             INTEGER,                             -- Recovery Time Objective
  rpo_minutes             INTEGER,                             -- Recovery Point Objective
  revenue_impact_hourly   NUMERIC(15,2),                       -- est. ₹/hour if down (currency tracked at tenant level)
  source                  TEXT        NOT NULL DEFAULT 'canaris_ems',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cmdb_services_tenant_criticality
  ON cmdb_business_services(tenant_id, criticality_tier) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cmdb_services_tenant_name
  ON cmdb_business_services(tenant_id, name) WHERE deleted_at IS NULL;

-- ─── 12d. Service ↔ CI links ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cmdb_service_ci_links (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id  UUID        NOT NULL REFERENCES cmdb_business_services(id) ON DELETE CASCADE,
  ci_id       UUID        NOT NULL REFERENCES cmdb_configuration_items(id) ON DELETE CASCADE,
  role        TEXT        CHECK (role IS NULL OR role IN ('primary', 'backup', 'dependency')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cmdb_service_ci_link
  ON cmdb_service_ci_links(service_id, ci_id, COALESCE(role, ''));
CREATE INDEX        IF NOT EXISTS idx_cmdb_service_ci_link_tenant_service
  ON cmdb_service_ci_links(tenant_id, service_id);
CREATE INDEX        IF NOT EXISTS idx_cmdb_service_ci_link_tenant_ci
  ON cmdb_service_ci_links(tenant_id, ci_id);

-- ─── 12e. Change ↔ CI links ──────────────────────────────────────────────
-- change_ref is an opaque text ref to a change record in an external source.
-- Resolved at runtime via DataSourceProvider (D11). No SQL FK — see ADR-002.
CREATE TABLE IF NOT EXISTS cmdb_change_links (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  change_ref    TEXT        NOT NULL,
  ci_id         UUID        NOT NULL REFERENCES cmdb_configuration_items(id) ON DELETE CASCADE,
  change_role   TEXT        CHECK (change_role IS NULL OR change_role IN ('modified', 'affected', 'requested_by')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cmdb_change_link
  ON cmdb_change_links(change_ref, ci_id, COALESCE(change_role, ''));
CREATE INDEX        IF NOT EXISTS idx_cmdb_change_link_tenant_ci
  ON cmdb_change_links(tenant_id, ci_id);
CREATE INDEX        IF NOT EXISTS idx_cmdb_change_link_tenant_change
  ON cmdb_change_links(tenant_id, change_ref);

COMMENT ON TABLE cmdb_change_links IS 'Many-to-many between external change records (referenced by opaque change_ref) and CIs. Enables W8 RCA to surface "modified by CHG-1234". Change details resolved at query time via DataSourceProvider (D11, ADR-002).';
