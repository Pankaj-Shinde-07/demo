-- Migration: 20260514000008 — AI messages
-- Purpose: Per-message storage with evidence_refs JSONB (D8) and per-message
--          cost/latency telemetry (D10). One row per turn (user, assistant,
--          system) within a conversation.
-- Branch:  ems-platform.AICopilot
-- Workstream: W1 (Foundations) — CP1.1 — M8
-- Date:    2026-05-14
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS ai_messages (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id     UUID        NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role                TEXT        NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content             TEXT        NOT NULL,
  evidence_refs       JSONB       NOT NULL DEFAULT '[]'::jsonb,    -- D8: array of evidence pointers
  confidence          NUMERIC(3,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  model_used          TEXT,                                        -- 'claude-sonnet-4', 'claude-haiku-4-5', etc.
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  cache_read_tokens   INTEGER     NOT NULL DEFAULT 0,
  cache_write_tokens  INTEGER     NOT NULL DEFAULT 0,
  latency_ms          INTEGER,
  feature             TEXT,                                        -- 'chat' | 'alert_explain' | 'rca_draft' | ...
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_tenant_conv_created
  ON ai_messages(tenant_id, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_messages_tenant_feature_created
  ON ai_messages(tenant_id, feature, created_at) WHERE feature IS NOT NULL;

COMMENT ON TABLE  ai_messages IS 'Per-message storage with evidence_refs (D8) + cost/latency telemetry (D10).';
COMMENT ON COLUMN ai_messages.evidence_refs IS 'Array of {type, id, snippet} pointers to grounded evidence.';
COMMENT ON COLUMN ai_messages.confidence IS '0.00–1.00. Lowered when cmdb_context.completeness != "full" (W6).';
