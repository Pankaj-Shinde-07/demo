# SynthBank P1 — Stage 1 Corpus Manifest

**Branch:** `ems-platform.AICopilot`
**Date:** 2026-06-07 (Stage 1); 2026-06-08 (P1 CMDB estate + topology, §6–§9)
**Status:** Stage 1 authored + ingested. P1 CMDB estate (~255-CI export) + branch-WAN
topology authored + ingested (§6–§9). Stage 2 NOT authored (follow-on brief).
**Location:** `apps/knowledge-ingestion/test/fixtures/synthbank/`
**Tenant (ingest target):** `cfc5801f-db4e-454c-a14a-4732d9eac48a` (the seeded SynthBank tenant; SynthBank is a **superset** of the existing 18 W2 chunks, which stay as-is).

> **100% synthetic.** SynthBank is a fictional medium UCB. Every regulatory, timing,
> and economic figure is plausible-but-synthetic and marked `[verify]`. Fidelity =
> reads like a real UCB's docs; never real bank data.

## 1. Authoring constraint honoured (chunker)

Token-level sliding window, `DEFAULT_MAX_TOKENS=600`, `DEFAULT_OVERLAP=100`, step 500.
Every substantive prose doc was authored **comfortably over 600 tokens / multi-chunk**;
the anchor (UPI runbook) is ~3k tokens. Token counts below are exact (the chunker's own
`gpt-tokenizer`); predicted chunk yield = `ceil((tokens−100)/500)`. Actual yield is
confirmed at ingest (§5) and may run slightly higher because the chunker prepends
section breadcrumbs and inter-section separators.

## 2. Document inventory

| File | document_type | tokens | pred. chunks | CIs / services referenced | Questions it should answer |
|------|---------------|-------:|-------------:|---------------------------|----------------------------|
| `upi-imps-operational-runbook.md` | runbook | 2977 | ~6 | UPI Switch 1, Sponsor Bank Link A, NPCI Link A, Payment Gateway 1, HSM Device 1, CBS App/DB Node 1 · upi_imps, core_banking | "which servers support UPI", "what happens when a UPI txn declines", "how does UPI settle through the sponsor", "business vs technical decline" |
| `sponsor-bank-settlement-recon-sop.md` | sop | 1875 | ~4 | Sponsor Bank Link A, Sponsor Bank Link B (DR), UPI Switch 1, NPCI Link A, **Reconciliation Server 1 (orphan)** · upi_imps, neft_rtgs | "what depends on the sponsor bank link", "how does sponsor settlement reconcile", "what breaks if the sponsor link drops", "switched-not-settled handling" |
| `neft-rtgs-operations-sop-v2-current.md` | sop | 1534 | ~3 | Sponsor Bank Link B (DR), NPCI Link A, CBS App/DB Node 1 · neft_rtgs | "where does NEFT/RTGS settlement run", "RTGS cutoffs `[verify]`", "NEFT vs RTGS failure handling" |
| `neft-rtgs-operations-sop-v1-superseded.md` | sop | 885 | ~2 | (same as v2) · neft_rtgs | **superseded version** — should surface as the older one / expose version ambiguity vs v2 |
| `atm-switch-cash-replenishment-sop.md` | sop | 1664 | ~4 | ATM Switch 1, HSM Device 1, Sponsor Bank Link A, CBS App/DB Node 1 · atm_card_services | "ATM cash-out procedure", "which switch authorizes card transactions", "on-us vs off-us triage" |
| `rca-1-sponsor-link-flap.md` | rca | 1408 | ~3 | Sponsor Bank Link A, UPI Switch 1, Payment Gateway 1 · upi_imps, neft_rtgs | "what caused the cascading payments outage", "sponsor link flap incident" |
| `rca-2-eod-batch-overrun.md` | rca | 1425 | ~3 | CBS DB Node 1, CBS App Node 1 · core_banking | "what changed before the EOD overrun", "why did internet banking time out" |
| `rca-3-branch-wan-outage.md` | rca | 1314 | ~3 | Core Router 1, Branch Router BR-014, Firewall Edge 1 · branch_wan | "which branches were offline and why", "was it a DC outage" (no) |
| `rca-4-upi-decline-spike.md` | rca | 1418 | ~3 | HSM Device 1, UPI Switch 1 · upi_imps, regulatory_reporting | "why did UPI success rate drop", "is the UPI decline spike reportable `[verify]`" |
| `synthbank-business-parameters.xlsx` | datasheet | (tabular) | ~31 (1/row) | services: upi_imps, core_banking, atm_card_services, neft_rtgs; Branch-014; model metadata | "txn volume baseline for [service]", "fee per UPI txn", "SLA penalty for tier-1 downtime", "attrition assumption", "cost of downtime" |

**Predicted Stage-1 yield: ~31 prose chunks + 31 parameter rows = ~62 chunks**, a
superset on top of the existing 18 (→ ~80). The large step to a few-hundred-chunk
haystack comes from the ~260-CI CMDB export sibling (see §4, dependency).

## 3. Deliberate-imperfection log (every one auditable)

| # | Imperfection | Where | Intended retrieval behaviour |
|---|--------------|-------|------------------------------|
| 1 | **Thin/absent DR procedure for a tier-1 service** (the most important). `atm_card_services` (ATM Switch 1) has **no documented DR/failover** anywhere in the corpus — and no DR node in the CMDB. | `atm-switch-cash-replenishment-sop.md` (§9 note) + absence across corpus | "What's the DR plan for the ATM switch / atm_card_services?" must return **nothing confident** (honest "I don't know"), not a confabulated procedure. |
| 2 | **Orphaned CI** — `Reconciliation Server 1` is referenced as where recon runs and now **exists in the ~255-CI estate as an orphaned CI** (CI present, but blank `business_service` → no upstream service). | `sponsor-bank-settlement-recon-sop.md` (§2.1, §6) + estate sheet 1 | A doc↔CMDB join on that name now **resolves to a CI**, but that CI has no business-service edge → "unknown upstream" hygiene flag, not a confabulated linkage. **SEMANTIC CHANGE (2026-06-08):** Stage 1 modelled this as *absent from the CMDB* (dangling edge). The P1 CMDB brief (§CI-vocabulary) explicitly requires it **present-but-orphaned**, so the imperfection is now "orphan CI", not "dangling reference". Flagged for architect. |
| 3 | **Superseded SOP version co-existing with its replacement.** NEFT/RTGS SOP v1.0 (SUPERSEDED) sits beside v2.0 (CURRENT); the only substantive change is cut-off handling. | `neft-rtgs-operations-sop-v1-superseded.md` + `...-v2-current.md` | Retrieval should surface the **current** version or **expose the version ambiguity**, not silently merge the two. |

## 4. CI-vocabulary cross-check

Checked every CI-like reference across all Stage-1 docs. **Originally** (2026-06-07)
this ran against the only CMDB export that existed — the 16-CI W2 fixture
(`../banking/cmdb-export.csv`). **Re-run 2026-06-08 against the ~255-CI estate**
(`synthbank-cmdb-export.xlsx`, §6): **all 17 Stage-1 CI references now resolve to a
valid `ci_name` in the estate, with NONE missing** — including `Reconciliation Server 1`,
which is now present as an orphaned CI (see imperfection #2 above). Services used
(`upi_imps`, `core_banking`, `atm_card_services`, `neft_rtgs`, `branch_wan`,
`regulatory_reporting`) and locations (`Branch-014`, `DC-Primary`, `DC-DR`, `WAN-Edge`)
all match ADR-003 vocabulary and appear in the estate.

> **DEPENDENCY RESOLVED (2026-06-08):** the **~255-CI SynthBank CMDB export + branch-WAN
> topology sibling is now built and ingested** (§6–§9). The Stage-1 docs are a clean
> superset of its vocabulary (cross-check above). The few-hundred-chunk haystack now
> exists (346 chunks). The relational doc↔CI *join* (queryable spine) remains deferred to
> W6 — see §8 (the W2 ingest only chunks; it does not populate the `cmdb_*` tables).

> **ADR-005 note:** the business-parameters fixture is authored to ADR-005/D15 (three
> confidence classes, `economicModelCapabilities` shape, `source=pack_default`). ADR-005
> is not yet committed in `docs/ai-copilot/` — its contents were taken from the provided
> ADR-005 doc.

## 5. Ingest + verification (filled at ingest time)

Ingest all 10 files via the real W2 upload path (`POST /api/v1/knowledge/upload`), then
record actual chunk count + per-doc yield vs the §2 predictions, the CI cross-check
result, and two hybrid smoke queries. See the session paste-back / `INGEST_RESULTS`.

**Stage-1 ingest confirmed:** 13 docs → 86 chunks under tenant `cfc5801f-…` (a superset
on top of the legacy 18 W2 chunks; the 31-row datasheet + prose docs landed as predicted).

---

## 6. P1 CMDB estate + topology (the ~260-CI sibling)

**Files** (this directory):
- `synthbank-cmdb-export.xlsx` — the estate. **Generator:** `_generate_cmdb_export.py`
  (deterministic, re-runnable, fully auditable).
- `synthbank-branch-wan-topology.md` — the prose topology companion (hub-and-spoke).

### 6.1 Estate shape — sheet 1 `configuration_items` (the INGESTED sheet)

255 CI rows × 12 columns: `ci_id, ci_name, ci_type, criticality_tier, business_service,
location, linked_asset_ref, technical_owner, business_owner, operations_team, status,
dr_mapping`. This is a **superset** of the legacy 16-CI fixture
(`../banking/cmdb-export.{csv,xlsx}`): the first 16 rows reproduce that fixture verbatim
(same `ci_id`/`ci_name`/`ci_type`/`tier`/`business_service`/`location`) with the new
columns added; CI-0017+ are new. Tier values keep the legacy underscore form
(`tier_1/tier_2/tier_3/unknown`) for retrieval-vocabulary consistency with the
already-ingested chunks.

| Location group | CIs | Composition |
|---|---:|---|
| Branch (50 × 4) | 200 | branch_router, branch_switch, 2× atm_terminal (Branch-014 router = legacy CI-0012) |
| Regional hub (6 × 2) | 12 | hub_router, hub_switch |
| DC-Primary | 22 | CBS app/db ×2, core net, UPI/PG/HSM, ATM switch, channels (IB/MB/CTS), AD/DNS, reg-reporting, backup, recon, etc. |
| DC-DR | 14 | mirrors of critical DC-Primary CIs (no ATM-switch/card-HSM DR — see imperfection) |
| WAN-Edge | 6 | Sponsor Link A, NPCI Link A, NPCI Link B (sec.), Firewall Edge 1, Spare Edge Switch |
| Hosted-Shared | 1 | CBS Hosted Service |
| **Total** | **255** | ~260 target (POC_FIDELITY Part 1) |

Branch → hub assignment (contiguous blocks; authoritative copy in the topology doc §2):
North 001–009 · South 010–018 · East 019–027 · West 028–036 · Central 037–045 ·
NorthEast 046–050. (Branch-023 → Hub-East.)

### 6.2 Business-service spine (sheets 2–5 — NOT ingested by W2)

The relational spine lives in sheets 2–5 of the same workbook so it is **fully expressed
in the export file**, ready for the deferred relational import (§8), even though the W2
path ingests only sheet 1:

- **`business_services`** (9 rows): 6 tier-1 (`core_banking`, `upi_imps`, `neft_rtgs`,
  `atm_card_services`, `internet_mobile_banking`, `cheque_clearing`) + 2 tier-2
  (`branch_wan`, `regulatory_reporting`) + 1 tier-3 (`document_management`), each with
  RTO/RPO/revenue-impact (all `[verify]`).
- **`service_ci_links`** (204 rows): M:N service↔CI with `role` (primary/backup/dependency).
- **`relationships`** (218 rows): CI↔CI graph (`depends_on`/`connected_to`) incl. the full
  branch access-layer (atm→switch→router→hub→core).
- **`change_links`** (3 rows): change_ref↔CI, incl. the RCA-2 smoking gun.

Per-CI `business_service` (sheet 1) holds each CI's **primary** service (single-valued,
chunk-retrievable). The full M:N is in sheets 2–3 + the topology prose.

## 7. P1 estate deliberate-imperfection log (every one auditable)

| # | Imperfection | Where (CI / row) | Flag exercised |
|---|--------------|------------------|----------------|
| E1 | **DR gap on a tier-1 service** — `atm_card_services` (ATM Switch 1, HSM Device 1, all 100 ATM terminals) has **blank `dr_mapping`** and there is **no `atm_switch`/card-HSM node in DC-DR**. The `business_services` sheet encodes it relationally with RTO/RPO = 0. | ATM Switch 1, HSM Device 1, ATM Terminal ATM-*; services sheet | BCP-hygiene / DR-posture flag. **Aligned with Stage-1 doc gap #1** — see §8 alignment note. |
| E2 | **4 orphaned CIs** (blank `business_service` → unknown upstream): `Reconciliation Server 1` (the Stage-1 recon-SOP reference, now present-as-orphan — see §3 #2), `Legacy Reporting Server` (status=retired), `Lab Sandbox Server`, `Spare Edge Switch`. | sheet 1 | "unknown upstream" hygiene flag. |
| E3 | **1 unmonitored secondary rail** — `NPCI Link B (Secondary)` has blank `linked_asset_ref` (no metrics). | NPCI Link B (Secondary) | `completeness = partial`. |
| E4 | **~15% ownership incompleteness** — 40/255 CIs (≈15%) missing `technical_owner` or `business_owner` (36 `technical_owner` fields blanked deterministically by the generator + orphan/hosted rows). | sheet 1 (every 7th CI, idx%7==3) | ownership-completeness flag. |
| E5 | **2 CIs with unknown `criticality_tier`** — `Branch Switch SW-007`, `Branch Switch SW-031`. | sheet 1 | tier-unknown handling. |
| E6 | **"Recent change is the smoking gun"** — `CHG-SB-2026-0291` (CBS DB Node 1, 2026-03-14 21:30, low-risk parallel-worker/pool change) is the deliberate cause of `INC-SB-2026-0388` (RCA-2 EOD overrun the following early morning). Lives in the `change_links` sheet (Phase 2/W6, not W2-ingested); the RCA-2 doc prose already carries the retrievable narrative. | change_links sheet + `rca-2-eod-batch-overrun.md` | W8 RCA "what changed before" story. |

## 8. Phase 0 fork resolution + Phase 2 deferral (the open question, answered)

**Phase 0 finding — the W2 ingest ONLY chunks; it does NOT populate the `cmdb_*`
relational tables.** Evidence:
- All five `cmdb_*` tables were **empty** (0 rows) after Stage 1; the legacy 16-CI export
  produced **16 chunks and 0 relational rows**.
- `IngestionProcessor.process()` does `parse → chunk → save` into `knowledge_chunks` only;
  for `cmdb_export` it merely copies `cmdb_columns` onto the document row. No `cmdb_*` write
  exists in the path. The migration header itself assigns relational population to the
  DataSourceProvider (ADR-002, D11) — a later workstream.
- `xlsx.parser` reads **only the first worksheet**; the chunker emits **1 chunk/row**.

**Consequence (per brief Phase 2):** **STOP — flag-don't-build.** No relational-import path
was built. The estate is authored in a shape **ready** for that import (full spine in
sheets 2–5). Populating `cmdb_*` (→ the queryable service→CI→asset join that D15/W8
traverse) is the **W6 dependency**, on-plan per POC_FIDELITY phasing ("the join pays off in
W6/W8"). The recall@10 gate is unblocked by the chunk haystack regardless.

**Format note:** sheet 1 tier values use `tier_1` (underscore) to match the ingested
legacy vocabulary; the relational `cmdb_configuration_items.criticality_tier` CHECK uses
`tier-1` (hyphen). The W6 import must normalize `tier_N` → `tier-N`. Likewise `status`,
`dr_mapping`, `operations_team` map onto `attributes`/owner columns at import.

**Topology routing note:** `document_type=topology_diagram` routes to `parseTopology`
(a PDF text-layer extractor that flags `needs_review`) — wrong for a prose `.md`. The
topology doc was therefore ingested as `document_type=other` so it goes through the
markdown prose parser and splits section-aware (5 chunks).

### 8.1 Doc ↔ CMDB DR-gap alignment (the deliberate convergence)

The DR gap is aligned on **one** service across both representations: `atm_card_services`.
Doc side (Stage-1 #1): no DR/failover procedure for the ATM switch anywhere in the corpus.
CMDB side (E1): no DR node and blank `dr_mapping` for its CIs. So *"what's the DR plan for
the ATM switch / atm_card_services?"* returns an **honest nothing from both** — verified in
§9. Every other tier-1 service has a documented DR node.

## 9. Ingest + verification results (Phase 1, 2026-06-08)

Ingested via the real W2 path (`POST :3111/api/v1/knowledge/upload`), tenant `cfc5801f-…`:

| File | document_type | chunks | yield |
|------|---------------|-------:|-------|
| `synthbank-cmdb-export.xlsx` | cmdb_export | **255** | 1 / CI-row (exact) |
| `synthbank-branch-wan-topology.md` | other (markdown prose) | **5** | section-aware split |

**Total corpus for tenant: 15 docs → 346 chunks, all 346 embedded** (Stage-1 86 + 255 + 5;
matches the ~350 prediction). cmdb_export bucket = 271 (16 legacy + 255 new; overlap is
additive and documented).

**Retrieval spot-checks (hybrid, k=5) — all sane:**
1. *"which hub serves branch 23"* → topology branch→hub table (Hub-East = Branch-019…027 ✓)
   + hub CIs.
2. *"what is the DR plan for the ATM switch atm_card_services"* → topology DC-layout (DR
   node list, no ATM switch among them) + ATM SOP + `ATM Switch 1` CI (DC-Primary, no DR)
   → **honest gap holds**, no confabulated DR.
3. *"which CIs support upi_imps"* → `UPI Switch 1` CI rows + UPI runbook + DR-posture chunk.

**CI-vocabulary cross-check:** all 17 Stage-1-referenced CI names resolve in the estate
(NONE missing) — see §4.

## 10. Open items for the architect (flagged, not resolved here)

1. **Dedup the legacy 16-CI fixture, or leave it?** Recommend **leave** (additive
   discipline). The estate reproduces those 16 verbatim as its first rows; the overlap is
   visible in retrieval (e.g. two `CI-0008 ATM Switch 1` chunks). Noted, not deduped.
2. **W6 deferral of the relational spine** — confirm acceptance (Phase 0 §8: the W2 path
   does not populate `cmdb_*`; the join is a W6 dependency, on POC_FIDELITY plan).
3. **`Reconciliation Server 1` semantic change** — Stage-1 modelled it absent (dangling
   edge); the P1 brief required it present-but-orphaned. Now an orphan CI (§3 #2, E2).
4. **Branch-count discrepancy — RESOLVED (2026-06-08, W4 gate Phase A).** The
   business-parameters fixture was corrected `branch_count 43→50` (and
   `customers_per_branch_avg 9800→8400` to keep the 420k rollup), regenerated and
   re-ingested (delete-then-reupload). Corpus is now internally consistent on 50 branches.
5. Recall@10 ≥ 0.85 gate now has its full haystack (346 chunks) — architect sequences it
   next (NOT run here).
