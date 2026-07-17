-- Migration: 20260514000010 — AI audit log (D7 chokepoint telemetry)
-- Purpose: One row per LLM call through the LlmGateway (W5). Captures
--          model, token counts (incl. cache hits), latency, prompt hash
--          + 500-char excerpts (secrets masked), evidence_ref count,
--          conversation/message linkage, and any error_code. The
--          authoritative telemetry surface for cost + governance.
-- Branch:  ems-platform.AICopilot
-- Workstream: W1 (Foundations) — CP1.1 — M10
-- Date:    2026-05-14
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS ai_audit_log (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  timestamp           TIMESTAMPTZ NOT NULL DEFAULT now(),
  feature             TEXT        NOT NULL,                    -- 'chat' | 'alert_explain' | 'rca_draft' | ...
  model               TEXT        NOT NULL,                    -- 'claude-sonnet-4', 'claude-haiku-4-5', etc.
  provider            TEXT        NOT NULL,                    -- 'anthropic' | 'ollama' | ...
  input_tokens        INTEGER     NOT NULL,
  output_tokens       INTEGER     NOT NULL,
  cache_read_tokens   INTEGER     NOT NULL DEFAULT 0,
  cache_write_tokens  INTEGER     NOT NULL DEFAULT 0,
  latency_ms          INTEGER     NOT NULL,
  prompt_hash         TEXT        NOT NULL,                    -- sha256 of prompt — for dedup analysis + cache-rate stats
  prompt_excerpt      TEXT,                                    -- first 500 chars, secrets masked
  response_excerpt    TEXT,                                    -- first 500 chars
  evidence_ref_count  INTEGER     NOT NULL DEFAULT 0,
  conversation_id     UUID,                                    -- nullable (some calls aren't conversational, e.g. batch RCA)
  message_id          UUID,                                    -- nullable for the same reason
  error_code          TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_log_tenant_timestamp
  ON ai_audit_log(tenant_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ai_audit_log_tenant_feature_timestamp
  ON ai_audit_log(tenant_id, feature, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ai_audit_log_prompt_hash
  ON ai_audit_log(tenant_id, prompt_hash);

COMMENT ON TABLE  ai_audit_log IS 'D7 single-chokepoint LLM call audit log. Every Anthropic/Ollama call writes one row.';
COMMENT ON COLUMN ai_audit_log.prompt_hash IS 'SHA256 of full prompt — for dedup analysis and prompt-cache hit rate metrics.';
