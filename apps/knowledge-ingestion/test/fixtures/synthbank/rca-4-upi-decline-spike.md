# RCA-4 — UPI Success-Rate Drop (Decline Spike) Traced to HSM/Switch — SynthBank Co-operative Bank

> **SYNTHETIC FIXTURE** — fabricated incident write-up for Canaris AI Copilot
> SynthBank P1. Fictional UCB; fabricated dates, times, figures, all `[verify]`.
> This RCA ties an APM success-rate signal (ADR-004) to the regulatory surface: a
> sustained UPI success-rate drop is an RBI-watched condition `[verify]`.

- **Incident ID:** INC-SB-2026-0421
- **Severity:** P2 (regulator-relevant)
- **Business service affected:** upi_imps
- **Primary CIs:** HSM Device 1 (`hsm_device`), UPI Switch 1 (`upi_switch`)
- **Duration:** ~48 minutes below the success-rate threshold `[verify]`.

## 1. Summary

SynthBank's UPI **success rate** dropped below its normal band, producing a spike in
**technical declines** (not business declines). The cause was **HSM Device 1**
saturation: signing/PIN-translation latency rose under load, causing UPI Switch 1 to
time out on the signing step and return technical declines. Because a sustained UPI
success-rate drop is a condition the regulator watches `[verify]`, this incident
carries a reporting dimension a generic infra view would not surface.

## 2. Timeline `[verify]`

- **18:40** — Evening UPI peak begins; transaction volume rising toward the daily high.
- **18:52** — APM success-rate signal for upi_imps begins falling; technical-decline
  ratio on UPI Switch 1 climbing while business declines stay flat.
- **18:58** — Success rate crosses below the internal alert threshold `[verify]`;
  incident opened. Card authorizations also show raised latency — the shared-HSM tell.
- **19:05** — On-call identifies HSM Device 1 signing latency at the top of its range;
  the switch is healthy but waiting on the HSM. Root cause = HSM saturation under peak
  load, not a rail or CBS problem.
- **19:30** — Load eases / HSM headroom restored per the mitigation; success rate
  recovers above threshold.
- **19:40** — Incident closed; flagged for regulatory-reporting review `[verify]`.

## 3. Root cause

**HSM Device 1** reached its signing-throughput ceiling during the evening UPI peak.
Elevated signing latency caused **UPI Switch 1** to time out on the signing step,
converting would-be approvals into technical declines and dragging the success rate
down. The distinguishing evidence: technical declines rose while business declines
(insufficient funds, limits) stayed flat, and card authorizations slowed at the same
time — both are downstream of the shared HSM.

## 4. Recent-change linkage

No configuration change preceded the event; the cause was capacity (peak load against
a fixed HSM ceiling), not a change. Recorded so the RCA is attributed to capacity
headroom, not a phantom change — and so the corrective action targets HSM capacity.

## 5. Impact and regulatory dimension

UPI/IMPS ran below its success-rate band for ~48 minutes during the evening peak,
declining a share of customer transactions. Because UPI success rate is an
RBI-watched metric for UCBs `[verify]`, a sustained drop below the reportable
threshold may require regulatory notification — the exact threshold and reporting
window are to be confirmed at pack-detail time `[verify]`. This links the APM
success-rate signal directly to the compliance surface (regulatory_reporting).

## 6. Corrective and preventive actions

1. Add HSM Device 1 capacity headroom for peak UPI load (and account for the shared
   card workload) `[verify]`.
2. Alert on HSM signing latency as a leading indicator, before the success rate
   crosses the threshold.
3. Wire the success-rate threshold breach to an automatic regulatory-reporting review
   trigger `[verify]`.
4. Track technical-vs-business decline split as the primary triage signal for UPI
   success-rate incidents.

## 7. The technical-vs-business decline tell

The diagnostic that pointed straight at the HSM, and away from false leads, was the
decline *composition*:

- **Business declines flat:** insufficient-funds, limit-exceeded, and invalid-VPA
  declines stayed at their normal background rate. So customers were not suddenly
  short of funds or hitting limits — it was not a CBS balance-read or a limit-config
  problem.
- **Technical declines rising:** timeouts and signing failures climbed. Technical
  declines mean the transaction *could* have succeeded but the plumbing failed.
- **Card auth slowing in parallel:** because **HSM Device 1** is shared between UPI
  signing and card PIN verification, card authorization latency rose at the same time
  — the unambiguous shared-HSM signature. A rail-only problem would not have touched
  card auth.

That three-part pattern — business declines flat, technical declines up, card flows
also slow — isolates HSM Device 1 saturation from the alternatives (CBS, rail,
limits) within minutes.

## 8. The APM ↔ regulatory link

This incident is the reference case for tying an **APM success-rate signal** (ADR-004)
to the **regulatory surface**. The success rate is an application-layer signal:
UPI is "up" (the switch is processing) but *degraded* (a rising share of attempts
fail). A pure up/down view would have called the service healthy. Only a
success-rate signal catches it — and because sustained UPI success-rate drops are
RBI-watched for UCBs `[verify]`, that same signal is what determines whether the event
crosses a reportable threshold. The exact threshold and reporting window are deferred
to pack-detail time `[verify]`; the structural point is that degradation, not just
outage, can be a compliance event.

## 9. Lessons for the value/impact story

The ~48-minute below-threshold window scales the impact by the **degradation factor**,
not a binary down/up: only the failed share of peak UPI volume is value-blocked, not
the entire service. This is the ADR-005 Class-1 computation — peak txn-volume baseline
× degradation factor × duration — and it is why an APM severity signal matters: it
turns "UPI had a bad evening" into a defensible, scaled rupee figure for exactly the
window the success rate was down.
