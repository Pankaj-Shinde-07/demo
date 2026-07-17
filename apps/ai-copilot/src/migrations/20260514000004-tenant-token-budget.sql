-- Migration: 20260514000004 — Per-tenant LLM token budget
-- Purpose: Enforces the per-tenant monthly token caps that make cost
--          optimization first-class (D10). Updated by the LlmGateway (W5).
-- Branch:  ems-platform.AICopilot
-- Workstream: W1 (Foundations) — CP1.1 — M4
-- Date:    2026-05-14
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS tenant_token_budget (
  tenant_id                       UUID        PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  monthly_input_tokens_limit      BIGINT,
  monthly_output_tokens_limit     BIGINT,
  soft_warn_pct                   INTEGER     NOT NULL DEFAULT 80
                                              CHECK (soft_warn_pct BETWEEN 0 AND 100),
  hard_stop_pct                   INTEGER     NOT NULL DEFAULT 100
                                              CHECK (hard_stop_pct BETWEEN 0 AND 200),
  current_month_input_tokens      BIGINT      NOT NULL DEFAULT 0,
  current_month_output_tokens     BIGINT      NOT NULL DEFAULT 0,
  current_month_started_at        TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  tenant_token_budget IS 'Per-tenant Anthropic token budget (D10).';
COMMENT ON COLUMN tenant_token_budget.soft_warn_pct IS 'Surface a UI warning when this percent of the monthly limit is reached.';
COMMENT ON COLUMN tenant_token_budget.hard_stop_pct IS 'Block further LLM calls when this percent is reached (defaults to 100%).';
