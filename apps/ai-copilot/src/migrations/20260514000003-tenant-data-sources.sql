-- Migration: 20260514000003 — Tenant data sources registry
-- Purpose: Records which DataSourceProviders are configured per tenant
--          (D11). cmdb_capabilities JSONB declares per-provider what the
--          provider can supply for the CMDB context (D13). Used by W6 to
--          drive graceful degradation when a tenant lacks CMDB sources.
-- Branch:  ems-platform.AICopilot
-- Workstream: W1 (Foundations) — CP1.1 — M3
-- Date:    2026-05-14
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS tenant_data_sources (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_name       TEXT        NOT NULL,         -- 'canaris_ems' | 'zabbix' | 'itop' | 'servicenow' | ...
  provider_type       TEXT        NOT NULL          -- 'native' | 'monitoring' | 'cmdb'
                                  CHECK (provider_type IN ('native', 'monitoring', 'cmdb')),
  config_encrypted    TEXT,                         -- Encrypted JSON (URL, credentials, etc.). Encryption key out of W1 scope.
  cmdb_capabilities   JSONB       NOT NULL DEFAULT '{}'::jsonb,
                                  -- Shape:
                                  -- { "hasConfigurationItems": bool,
                                  --   "hasRelationshipGraph":  bool,
                                  --   "hasBusinessServices":   bool,
                                  --   "hasChangeLinkage":      bool,
                                  --   "hasOwnership":          bool,
                                  --   "hasCriticality":        bool }
  enabled             BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_data_sources_provider
  ON tenant_data_sources(tenant_id, provider_name);
CREATE INDEX        IF NOT EXISTS idx_tenant_data_sources_enabled
  ON tenant_data_sources(tenant_id, enabled);

COMMENT ON TABLE  tenant_data_sources IS 'Per-tenant DataSourceProvider registry (D11).';
COMMENT ON COLUMN tenant_data_sources.cmdb_capabilities IS 'Per-provider declared CMDB capabilities (D13). Used by W6 graceful degradation.';
