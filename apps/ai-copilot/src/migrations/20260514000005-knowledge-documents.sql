-- Migration: 20260514000005 — Knowledge documents (W2 populates)
-- Purpose: Master record for every uploaded knowledge artifact. The
--          document_type CHECK explicitly includes 'cmdb_export' and
--          'topology_diagram' (per D13 — knowledge-base CMDB substitute path
--          for tenants without a real CMDB).
-- Branch:  ems-platform.AICopilot
-- Workstream: W1 (Foundations) — CP1.1 — M5
-- Date:    2026-05-14
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title               TEXT        NOT NULL,
  document_type       TEXT        NOT NULL
                                  CHECK (document_type IN (
                                    'manual', 'sop', 'rca', 'runbook', 'datasheet',
                                    'cmdb_export', 'topology_diagram', 'other'
                                  )),
  source_filename     TEXT,
  source_size_bytes   BIGINT,
  source_hash         TEXT,                         -- sha256 of source file (dedup helper)
  tags                TEXT[]      NOT NULL DEFAULT '{}',
  metadata            JSONB       NOT NULL DEFAULT '{}'::jsonb,
                                  -- For cmdb_export: stash original column headers under metadata.cmdb_columns (W2).
  ingestion_status    TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (ingestion_status IN (
                                    'pending', 'parsing', 'chunking', 'embedding', 'completed', 'failed'
                                  )),
  ingestion_error     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_tenant_type
  ON knowledge_documents(tenant_id, document_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_tenant_status
  ON knowledge_documents(tenant_id, ingestion_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_source_hash
  ON knowledge_documents(tenant_id, source_hash) WHERE source_hash IS NOT NULL AND deleted_at IS NULL;

COMMENT ON TABLE knowledge_documents IS 'Knowledge-base document master (W2 populates, W3 fills embeddings on chunks).';
