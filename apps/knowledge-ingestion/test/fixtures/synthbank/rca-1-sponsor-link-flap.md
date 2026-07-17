# RCA-1 — Sponsor-Link Flap Cascading to Retail Payments — SynthBank Co-operative Bank

> **SYNTHETIC FIXTURE** — fabricated incident write-up for Canaris AI Copilot
> SynthBank P1. Fictional UCB; fabricated dates, times, and figures, all `[verify]`.
> This RCA is the canonical "one root cause, many symptoms" payments incident.

- **Incident ID:** INC-SB-2026-0412
- **Severity:** P1 (multiple tier-1 services degraded)
- **Business services affected:** upi_imps, neft_rtgs (and IMPS within upi_imps)
- **Primary CI (root cause):** Sponsor Bank Link A (`sponsor_bank_link`)
- **Duration:** ~73 minutes degraded `[verify]`

## 1. Summary

An intermittent fault ("flap") on **Sponsor Bank Link A** caused repeated drops of
the rail to the sponsor bank. Because SynthBank settles retail payments through the
sponsor sub-membership, the flap cascaded into UPI, IMPS, and — via the shared
sponsor relationship — NEFT/RTGS. The monitoring estate produced a storm of alerts
across **UPI Switch 1**, **Payment Gateway 1**, and the NEFT batch jobs; all of them
trace to the single sponsor-link root cause. The correct operational reading was one
incident at the rail, not several incidents at the switches.

## 2. Timeline `[verify]`

- **14:02** — First technical-decline spike observed on UPI Switch 1; outbound-leg
  timeouts climbing. Approval ratio falling.
- **14:05** — Payment Gateway 1 alerting on downstream timeouts. IMPS failures rising.
- **14:09** — NEFT batch relay over the sponsor path begins missing acknowledgements;
  neft_rtgs flagged.
- **14:12** — On-call correlates the symptoms to Sponsor Bank Link A round-trip
  latency spikes and periodic loss of carrier — i.e. a flapping link, not a clean
  outage. One incident opened, rooted at the sponsor link.
- **14:15** — Sponsor bank engaged in parallel; SynthBank cannot remediate the
  sponsor's leg directly.
- **15:01** — Sponsor confirms a faulty interface on their edge; link stabilized.
- **15:15** — Success rates recovered; incident moved to reconciliation follow-up.

## 3. Root cause

A hardware interface fault on the sponsor bank's edge caused **Sponsor Bank Link A**
to flap. SynthBank's switch, gateway, HSM, and CBS were all healthy throughout — the
failure was entirely in the rail to the sponsor. This is the structural risk ADR-003
describes: a sub-member's retail payments have a hard dependency on a single sponsor
relationship.

## 4. Why it cascaded

- UPI/IMPS settlement legs (UPI runbook §2 steps 5–6) cannot complete without the
  sponsor link → immediate technical declines.
- Transactions switched just before each drop became *switched-not-settled*
  reconciliation breaks (settlement SOP §2.3).
- NEFT/RTGS shares the sponsor relationship, so the batch relay degraded in the same
  window even though it nominally uses Sponsor Bank Link B (DR).

## 5. Recent-change linkage

No SynthBank-side change preceded this incident; the change was on the sponsor's
infrastructure and outside SynthBank's change record. This is explicitly noted so the
RCA is not mis-attributed to a local change — the absence of a SynthBank change is
itself a finding that points to the rail.

## 6. Impact

UPI/IMPS and NEFT/RTGS degraded for ~73 minutes during an afternoon window. Customer
transactions declined and a batch of switched-not-settled exceptions required
reconciliation. Quantified business impact (value blocked, customers affected) is
computed from the business-parameters model and is out of scope for this write-up.

## 7. Corrective and preventive actions

1. Pursue a resilient secondary sponsor path so a single sponsor-edge fault does not
   take all retail rails down `[verify]`.
2. Tune alerting to auto-correlate sponsor-link health with downstream switch/gateway
   symptoms, so the next flap opens one incident, not a storm.
3. Formalize the switched-not-settled reconciliation drill with the sponsor's
   post-incident settlement file.
4. Add a sponsor-link flap (intermittent, not clean-down) detection signal distinct
   from a hard outage.

## 8. Why a generic tool gets this wrong

A generic infrastructure monitor would have raised ~30+ independent alerts —
UPI Switch 1 timeouts, Payment Gateway 1 errors, IMPS failures, NEFT relay failures —
and presented them as a storm of equally-weighted problems. The operator would then
spend the first 10 minutes deciding *which* alert mattered. The co-op-aware reading is
that all of them are downstream of one CI, **Sponsor Bank Link A**, because SynthBank's
sub-membership topology routes every retail rail through that one link. Naming that
root cause immediately — rather than triaging 30 symptoms — is the difference between a
12-minute correlation and an hour of confusion.

## 9. Detection signals that distinguished flap from outage

- **Periodic, not continuous, loss:** round-trip latency on Sponsor Bank Link A
  spiked and recovered repeatedly, with brief carrier-loss intervals — the signature
  of a flapping interface, not a clean down.
- **Healthy local estate:** UPI Switch 1, Payment Gateway 1, HSM Device 1, and CBS
  were all green throughout; only the outbound settlement leg failed.
- **Cross-service correlation:** UPI, IMPS, and NEFT/RTGS degraded in the same window
  — the tell that the common sponsor relationship, not any one service, was at fault.

## 10. Lessons for the value/impact story

This incident is the reference scenario for the business-impact narrative: a
time-bounded tier-1 degradation (~73 min) across upi_imps and neft_rtgs, with a clear
start (14:02) and recovery (15:15). Value-blocked, customers-affected, and fee-income-
at-risk for this window are computed from the business-parameters model against this
timeline — the incident provides the *duration*, the model provides the *worth*. The
two together are what produce a grounded "value blocked and counting" figure rather
than a guess.
