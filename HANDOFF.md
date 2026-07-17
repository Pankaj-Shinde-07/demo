# NEXA Copilot Eval Sandbox — Intern Handoff

**Built:** 2026-07-13 · **Copilot baseline:** `ems-platform.AICopilot @ 1d4ebc1`
**Everything here is SYNTHETIC.** No client data, names, IPs, or credentials. Read
`nexa-eval-sandbox/RING-FENCE.md` first — it is non-negotiable.

This tar is a **self-contained, synthetic-only** copy of the NEXA AI Copilot plus
the evaluation package (`nexa-eval-sandbox/`). You can reach a green mock baseline
on day one, then score the **real** Copilot on SynthBank and reproduce the target
number below.

---

## Deliverable #1 — the number you reproduce

Scoring the **real** Copilot on SynthBank (the `prompts/prompt_set.jsonl` 20-set):

```
Passed               : 12/20   ← Stage-1 target
  grounded pass      : 7
  honest-empty pass  : 5 / 5
FLAG count           : 7
Fabricated-value fail: 0       ← the worst failure; MUST stay 0
```

Reproduced identically across a clean wipe-and-rebuild (deterministic at temperature 0;
narration may drift ±1 on a borderline phrase, but grounded/declined/FLAG are stable).

**Raw (before the three documented harness adaptations): 4/20.** The jump to 12/20 is
not the Copilot changing — it is the harness fairly meeting the real API (see below).

### Why 12, not 20 — the 7 findings (all genuine, none fabricate)
The Copilot's grounding + honest-empty engine is sound (P001/P002 ground; P011–P015
honestly say "no data", never a false zero). The gaps are **intent-routing / narration**:

| Prompt | Finding |
|---|---|
| P006 | "CPU on IB-APP-01" FLAGs — the router's live-state keywords omit `cpu/disk/memory`, so bare-metric questions fall to the (empty) knowledge-retrieval route. Contrast P014 "disk **utilis­ation**" which grounds. |
| P016 | "highest CPU in Internet Banking" — no member drill-down from a service node. |
| P017, P020 | "how many CIs make up Payments" / "reporting normally" misroute to the incident path via the LLM fallback classifier. |
| P005, P018 | aggregate / all-services questions have no multi-service handler. |
| P009 | alias resolves ("upi") but narration says "UPI", not the canonical "Mobile & UPI". |

These are the surface interns extend against. Log new ones in `nexa-eval-sandbox/templates/GAP-LOG.md`.

### The three harness adaptations (product was NOT changed)
The mock's flat contract differs from the real Copilot; absorbed only in
`nexa-eval-sandbox/harness/scorecard.mjs` + `config.json` + `API-CONTRACT.md`:
1. **ask() adapter** — real endpoint `POST /api/v1/ai/chat`, field `message`, map
   `citations[].ref → refs`, fresh `sessionId` per prompt.
2. **digit-separator normalize** — the Copilot narrates "1,850 ms"; the fact is "1850".
3. **honest-decline vocabulary** — the Copilot declines without emitting a number (an
   honest no-answer); recognised as "no data". No-fabrication is judged separately.

---

## Prerequisites
Docker, Node 18+, and (only to score the *real* Copilot) your own Anthropic API key.

## Day-one green baseline (no product, no key)
```bash
cd nexa-eval-sandbox
node harness/mock-copilot.mjs          # terminal 1 → :8899
# terminal 2: point config.json endpoint at the mock, then:
node harness/scorecard.mjs --build BASELINE   # expect 20/20, 0 FLAG, 0 fabricated
```
> The shipped `config.json` points at the REAL Copilot (:3110). For the mock, set
> `endpoint` to `http://127.0.0.1:8899/copilot/ask` — the same `ask()` drives both.

## Score the REAL Copilot on SynthBank (reproduce 12/20)
```bash
# 1. Sandbox infra (isolated ports; nothing collides with a normal EMS stack)
docker run -d --name nexa-sbx-pg    -e POSTGRES_DB=ai_sandbox -e POSTGRES_USER=ems_admin \
  -e POSTGRES_PASSWORD=sandbox_pw -p 5544:5432 pgvector/pgvector:pg15
docker run -d --name nexa-sbx-redis -p 6390:6379 redis:7-alpine

# 2. Copilot schema (14 idempotent migrations)
for f in apps/ai-copilot/src/migrations/*.sql; do
  docker exec -i nexa-sbx-pg psql -v ON_ERROR_STOP=1 -U ems_admin -d ai_sandbox < "$f"
done

# 3. Load SynthBank, then map it into the Copilot's native CMDB tables
docker exec -i nexa-sbx-pg psql -U ems_admin -d ai_sandbox < nexa-eval-sandbox/synthbank/schema.sql
docker exec -i nexa-sbx-pg psql -U ems_admin -d ai_sandbox < nexa-eval-sandbox/synthbank/seed.sql
docker exec -i nexa-sbx-pg psql -U ems_admin -d ai_sandbox < nexa-eval-sandbox/synthbank/copilot-map.sql

# 4. Set your key, then build + run the Copilot (binds :3110)
cp .env.example .env      # then edit ANTHROPIC_API_KEY
./run-copilot.sh          # first run does npm install + build

# 5. Score it
cd nexa-eval-sandbox && node harness/scorecard.mjs --build REAL
```

`synthbank/copilot-map.sql` maps `synth_*` → the Copilot's `cmdb_*` tables + builds
the `golden_signal` JSONB the Copilot reads. A metric a CI does **not** report is
written as JSON `null` (absent), never `0` — that absence is what makes the honest-empty
prompts real. It also exposes each service (and its aliases) as a resolvable CI node,
because the Copilot's entity resolver resolves CIs, not the separate services table.

---

## What is NOT in this tar (by design)
- The rest of the EMS monorepo (NMS/API/ITSM/Studio-web) — not needed for grounding eval.
- Any client material — stripped and grep-verified (0 hits across all real-client identifiers).
- Real credentials — the `.env` API key is a placeholder; supply your own.
- `node_modules` / build output — created by `run-copilot.sh` on first run.
