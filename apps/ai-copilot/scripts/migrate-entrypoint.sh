#!/usr/bin/env bash
#
# migrate-entrypoint.sh — one-shot AI Copilot migration runner.
#
# Runs as the entrypoint of the canaris/ems-ai-copilot-migrate image.
# Invoked by docker compose as:  docker compose --profile init run --rm migrate-aicopilot
#
# Steps:
#   1. Validate required env vars are present.
#   2. Wait for Postgres to accept connections (up to 30s).
#   3. Apply all SQL files in /app/migrations in lexical order, with
#      ON_ERROR_STOP=1, inside a single psql session per file.
#   4. Verify pgvector is installed and report the AI/CMDB table count.
#
# Unlike apps/api/scripts/migrate-entrypoint.sh, this script does NOT
# bootstrap a baseline schema — the EMS core schema is assumed to already
# exist (the AI Copilot module is additive). Migrations are idempotent
# (CREATE ... IF NOT EXISTS), so re-running this script is a no-op once
# the schema is in place.
#
# Exit codes: 0 on success; non-zero with a final "MIGRATION FAILED: …" line.

set -euo pipefail

# ─── Output helpers ──────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YLW=$'\033[33m'
  C_BLU=$'\033[34m'; C_BOLD=$'\033[1m'; C_OFF=$'\033[0m'
else
  C_RED=""; C_GRN=""; C_YLW=""; C_BLU=""; C_BOLD=""; C_OFF=""
fi

log()  { echo "${C_BLU}[ai-copilot migrate]${C_OFF} $*"; }
ok()   { echo "${C_GRN}[ai-copilot migrate ✓]${C_OFF} $*"; }
warn() { echo "${C_YLW}[ai-copilot migrate ⚠]${C_OFF} $*" >&2; }
err()  { echo "${C_RED}[ai-copilot migrate ✗]${C_OFF} $*" >&2; }
die()  { err "$*"; echo "${C_RED}${C_BOLD}MIGRATION FAILED:${C_OFF} $*"; exit 1; }

# ─── Step 1: Validate required env vars ──────────────────────────────────
log "Step 1/4 — Validating environment"

REQUIRED_VARS=(DATABASE_HOST DATABASE_PORT DATABASE_USER DATABASE_PASSWORD DATABASE_NAME)
for v in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!v:-}" ]]; then
    die "Required env var '${v}' is unset."
  fi
done

# psql reads PGPASSWORD by convention.
export PGPASSWORD="${DATABASE_PASSWORD}"
PSQL_BASE=(psql -h "${DATABASE_HOST}" -p "${DATABASE_PORT}" -U "${DATABASE_USER}" -d "${DATABASE_NAME}")

ok "Environment validated."

# ─── Step 2: Wait for Postgres ───────────────────────────────────────────
log "Step 2/4 — Waiting for Postgres at ${DATABASE_HOST}:${DATABASE_PORT}"

for i in $(seq 1 30); do
  if pg_isready -h "${DATABASE_HOST}" -p "${DATABASE_PORT}" -U "${DATABASE_USER}" >/dev/null 2>&1; then
    ok "Postgres reachable after ${i}s."
    break
  fi
  if [[ $i -eq 30 ]]; then
    die "Postgres not reachable after 30s."
  fi
  sleep 1
done

# ─── Step 3: Apply migrations ────────────────────────────────────────────
log "Step 3/4 — Applying migrations from /app/migrations"

shopt -s nullglob
MIGRATIONS=(/app/migrations/*.sql)
shopt -u nullglob

if [[ ${#MIGRATIONS[@]} -eq 0 ]]; then
  die "No migration files found under /app/migrations."
fi

# Sort lexically (filenames are 20260514NNNNNN-…sql so this is also chronological).
IFS=$'\n' MIGRATIONS_SORTED=($(sort <<<"${MIGRATIONS[*]}")); unset IFS

for f in "${MIGRATIONS_SORTED[@]}"; do
  log "  Applying: $(basename "${f}")"
  if ! "${PSQL_BASE[@]}" -v ON_ERROR_STOP=1 -f "${f}"; then
    die "Failed to apply $(basename "${f}")."
  fi
done

ok "All ${#MIGRATIONS_SORTED[@]} migration(s) applied."

# ─── Step 4: Verify ──────────────────────────────────────────────────────
log "Step 4/4 — Verifying post-migration state"

VECTOR_VER=$("${PSQL_BASE[@]}" -tAc "SELECT extversion FROM pg_extension WHERE extname='vector';" || true)
if [[ -z "${VECTOR_VER}" ]]; then
  die "pgvector extension not installed after migrations."
fi
ok "pgvector installed: version=${VECTOR_VER}"

# Count expected new tables (12 net-new in CP1.1):
#   tenants, tenant_data_sources, tenant_token_budget,
#   knowledge_documents, knowledge_chunks,
#   ai_conversations, ai_messages, ai_feedback, ai_audit_log,
#   ai_dashboard_templates, ai_dashboard_generation_logs, dashboard_widget_metadata,
#   cmdb_configuration_items, cmdb_relationships, cmdb_business_services,
#   cmdb_service_ci_links, cmdb_change_links
# = 17 tables.
EXPECTED=17
TABLE_LIST=$("${PSQL_BASE[@]}" -tAc "
  SELECT count(*) FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name IN (
       'tenants','tenant_data_sources','tenant_token_budget',
       'knowledge_documents','knowledge_chunks',
       'ai_conversations','ai_messages','ai_feedback','ai_audit_log',
       'ai_dashboard_templates','ai_dashboard_generation_logs','dashboard_widget_metadata',
       'cmdb_configuration_items','cmdb_relationships','cmdb_business_services',
       'cmdb_service_ci_links','cmdb_change_links'
     );")
if [[ "${TABLE_LIST}" -ne "${EXPECTED}" ]]; then
  warn "Expected ${EXPECTED} AI/CMDB tables; found ${TABLE_LIST}. (Soft warn — may indicate a partial run.)"
else
  ok "All ${EXPECTED} AI/CMDB tables present."
fi

ok "AI Copilot migrations complete."
