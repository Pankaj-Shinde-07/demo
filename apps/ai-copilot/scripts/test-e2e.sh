#!/usr/bin/env bash
# CP1.3 e2e harness — brings up postgres-test, runs the adversarial tenant
# isolation suite, tears down (volume-deleting) even on failure. Exit code
# matches Jest's (or the up step's, if startup failed).

set -u

cd "$(dirname "$0")/.."  # apps/ai-copilot/

COMPOSE_FILE="../../docker-compose.test.yml"

cleanup() {
  echo "→ tearing down postgres-test"
  docker compose -f "$COMPOSE_FILE" down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "→ bringing up postgres-test"
docker compose -f "$COMPOSE_FILE" up -d --wait postgres-test

echo "→ running jest e2e"
jest --config ./test/jest-e2e.json
