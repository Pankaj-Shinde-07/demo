#!/usr/bin/env bash
# Build (if needed) and launch the real NEXA Copilot against the sandbox DB/Redis.
# Reads settings from ./.env. See HANDOFF.md for the full bring-up sequence.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

set -a; . "$HERE/.env"; set +a
export PACKS_ROOT="$HERE/packs"   # absolute — the loader resolves packs from cwd otherwise

if [ "${ANTHROPIC_API_KEY:-}" = "sk-ant-REPLACE-WITH-YOUR-OWN-KEY" ]; then
  echo "!! Set a real ANTHROPIC_API_KEY in .env to score the REAL Copilot (the mock needs none)." >&2
fi

cd "$HERE/apps/ai-copilot"
[ -d "$HERE/node_modules/@nestjs" ] || ( cd "$HERE" && npm install --workspace=apps/ai-copilot )
[ -f dist/main.js ] || npm run build
exec node dist/main.js
