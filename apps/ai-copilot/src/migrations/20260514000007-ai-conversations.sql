-- Migration: 20260514000007 — AI conversations
-- Purpose: One row per Copilot chat conversation (W7 populates). user_id is
--          UUID and is INTENTIONALLY UNCONSTRAINED (no FK to public.users)
--          per architect decision Q2 — existing users.id is INTEGER and the
--          AI domain uses UUIDs throughout.
-- Branch:  ems-platform.AICopilot
-- Workstream: W1 (Foundations) — CP1.1 — M7
-- Date:    2026-05-14
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS ai_conversations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL,                 -- Q2: no FK to users.id (INTEGER mismatch). Auth layer issues UUID-mapped tokens.
  title       TEXT,                                 -- Auto-generated from first user message (W7).
  scope       JSONB       NOT NULL DEFAULT '{}'::jsonb,
                          -- e.g. { "alert_id": "...", "incident_id": "...", "asset_id": "..." }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_tenant_user_updated
  ON ai_conversations(tenant_id, user_id, updated_at DESC) WHERE deleted_at IS NULL;

COMMENT ON TABLE  ai_conversations IS 'Copilot chat conversations (W7).';
COMMENT ON COLUMN ai_conversations.user_id IS 'UUID (cross-domain). No FK — users.id is INTEGER (Q2).';
