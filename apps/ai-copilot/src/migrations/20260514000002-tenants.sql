-- Migration: 20260514000002 — AI tenants master table
-- Purpose: Net-new UUID-keyed tenant master for the AI/CMDB domain. Carries
--          industry (drives industry-pack selection), pinned pack_version,
--          deployment_profile, and an optional opaque linked_customer_ref
--          (resolved via DataSourceProvider per ADR-002; was Q1-A's bridge
--          column with FK before the 2026-05-15 Path 4 realignment).
--          The existing operational tables remain single-tenant; multi-tenancy
--          in v1 is AI-domain only.
-- Branch:  ems-platform.AICopilot
-- Workstream: W1 (Foundations) — CP1.1 — M2
-- Date:    2026-05-14
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS tenants (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT        NOT NULL,
  industry            TEXT        NOT NULL DEFAULT 'default',
  pack_version        TEXT,
  deployment_profile  TEXT        NOT NULL DEFAULT 'standalone'
                                  CHECK (deployment_profile IN ('standalone', 'hybrid', 'full_stack')),
  -- Opaque ref to a customer in an external source (Canaris EMS, ServiceNow,
  -- Salesforce, etc.). Resolved at runtime via DataSourceProvider (D11).
  -- No SQL FK — see ADR-002 at docs/ai-copilot/ADR-002-self-owned-schema.md.
  linked_customer_ref TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_name_active
  ON tenants(name) WHERE deleted_at IS NULL;
CREATE INDEX        IF NOT EXISTS idx_tenants_industry              ON tenants(industry);
CREATE INDEX        IF NOT EXISTS idx_tenants_linked_customer_ref   ON tenants(linked_customer_ref) WHERE linked_customer_ref IS NOT NULL;

COMMENT ON TABLE  tenants IS 'AI/CMDB tenant master. Net-new in W1; not retrofitted onto existing operational tables.';
COMMENT ON COLUMN tenants.industry IS 'Selects which packs/<industry>/ folder to load (default | banking | aviation | telecom | ...).';
COMMENT ON COLUMN tenants.pack_version IS 'Pinned pack version (NULL = latest).';
COMMENT ON COLUMN tenants.linked_customer_ref IS 'Opaque ref to customer in external source. Resolved via DataSourceProvider (D11, ADR-002).';
