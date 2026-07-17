# NEXA Copilot — Evaluation Sandbox

A self-contained harness for evaluating the NEXA AI Copilot's **grounding** and
**honest-empty** behaviour against a **synthetic** bank estate (SynthBank).

It ships with a **mock Copilot** so you can seed data, run the scorecard, and
get a green baseline on **day one** — before you have the real product wired up.
When the real Copilot is available, you change one line of config and score it.

> **Everything in this package is synthetic.** No client data, names, network, or
> credentials. Read `RING-FENCE.md` before you start — it is non-negotiable.

---

## What's in here

```
nexa-eval-sandbox/
├── README.md                 ← you are here
├── RING-FENCE.md             ← the non-negotiable rules (read first)
├── synthbank/                ← the synthetic estate (single source of truth)
│   ├── generate.py           ← regenerates everything below, deterministically
│   ├── schema.sql            ← additive, namespaced CMDB + metric tables
│   ├── seed.sql              ← INSERTs for the estate (load after schema.sql)
│   ├── cis.json              ← 111 configuration items with live-style metrics
│   ├── services.json         ← 9 services + their aliases
│   ├── service_aliases.csv   ← synonym → service map (Layer-2 resolution)
│   └── derived_facts.json    ← health rollups / worst-CPU / pinned scenarios
├── prompts/
│   ├── prompt_set.jsonl      ← 20 eval prompts with expected grounding
│   └── PROMPT-SCHEMA.md      ← how a prompt entry is structured
├── harness/
│   ├── mock-copilot.mjs      ← stand-in Copilot for day-one bring-up
│   ├── scorecard.mjs         ← the grounding scorecard runner
│   ├── config.json           ← endpoint + paths (repoint to real Copilot here)
│   └── API-CONTRACT.md       ← the request/response contract both sides follow
├── templates/
│   ├── SCORECARD-REPORT.md   ← fill one in per build
│   └── GAP-LOG.md            ← log every grounding failure you find
└── CC-BRIEF-assemble-sandbox.md  ← (for Pramod) wiring the REAL Copilot in
```

## What's NOT in here — and why

The actual NEXA Copilot source is **not** in this package. It is Canaris product
IP and is supplied separately by Pramod (see `CC-BRIEF-assemble-sandbox.md`). This
package is the **evaluation wrapper** around it: the data, the prompts, the
scorecard, and a mock so you're never blocked waiting on the product.

---

## Quick start (day one, no product code needed)

Prerequisites: **Node 18+** and **Python 3** (only used to regenerate data).

```bash
# 1. (optional) regenerate the synthetic estate + prompts, deterministically
python3 synthbank/generate.py

# 2. start the mock Copilot (leave it running in one terminal)
node harness/mock-copilot.mjs
#    -> mock-copilot listening on http://127.0.0.1:8899/copilot/ask

# 3. in a second terminal, run the scorecard
node harness/scorecard.mjs --build BASELINE
```

Expected day-one result against the mock:

```
Passed               : 20/20
FLAG count           : 0   (target: 0)
Fabricated-value fail: 0   (target: 0 — this is the worst failure)
```

That green baseline proves your harness, data, and scoring are wired correctly.
**That is deliverable #1.** From there you extend prompts + estate coverage, and
— once the real Copilot is available — you point `harness/config.json` at it and
the *real* findings begin.

## Loading the estate into Postgres (when wiring the real Copilot)

```bash
psql "$DB_URL" -f synthbank/schema.sql
psql "$DB_URL" -f synthbank/seed.sql
psql "$DB_URL" -f synthbank/copilot-map.sql   # maps synth_* → the Copilot's cmdb_* tables
```

`copilot-map.sql` is the thin loader that lets the REAL Copilot ground on SynthBank:
it maps the `synth_*` estate into the Copilot's native `cmdb_*` tables and builds the
`golden_signal` JSONB it reads. See `../HANDOFF.md` for the full real-Copilot run.

Metrics that a CI genuinely does **not** report have **no row** in
`synth_ci_metric_sample` — they are absent, not zero. That absence is the whole
point: the Copilot must answer "no data", never a false zero.

## Scoring the real Copilot

1. Open `harness/config.json`, set `endpoint` to the real Copilot's ask URL, add
   any auth header it needs.
2. Confirm the request/response shape matches `harness/API-CONTRACT.md` (adjust
   the contract with Pramod if the real API differs — that's a legitimate finding).
3. `node harness/scorecard.mjs --build <build-label>` on every build you receive.
   The runner writes `harness/last-scorecard.json` and reports the delta vs the
   previous run.

Log every failure in `templates/GAP-LOG.md`. A fabricated value (false zero /
invented number) is the most serious failure — the runner exits non-zero on it.
