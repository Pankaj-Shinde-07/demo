-- Migration: 20260514000009 — AI feedback (thumbs up/down per message)
-- Purpose: Per-user feedback on individual AI messages. Surfaces in W11 UI
--          and feeds quality metrics. Enforces one feedback row per
--          (message_id, user_id) pair via UNIQUE.
-- Branch:  ems-platform.AICopilot
-- Workstream: W1 (Foundations) — CP1.1 — M9
-- Date:    2026-05-14
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS ai_feedback (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id  UUID        NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL,                            -- Q2: no FK to users.id (INTEGER mismatch)
  rating      SMALLINT    NOT NULL CHECK (rating IN (-1, 0, 1)),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_feedback_message_user
  ON ai_feedback(message_id, user_id);
CREATE INDEX        IF NOT EXISTS idx_ai_feedback_tenant_created
  ON ai_feedback(tenant_id, created_at);

COMMENT ON TABLE  ai_feedback IS 'Per-message thumbs up/down + optional comment. One row per (message,user).';
COMMENT ON COLUMN ai_feedback.rating IS '-1 = thumbs down, 0 = neutral/cleared, 1 = thumbs up.';
