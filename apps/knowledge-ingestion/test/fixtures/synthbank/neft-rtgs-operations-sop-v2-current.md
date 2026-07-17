# NEFT / RTGS Operations SOP — v2.0 (CURRENT) — SynthBank Co-operative Bank

> **SYNTHETIC FIXTURE** — fabricated for Canaris AI Copilot SynthBank P1. Fictional
> UCB. **Document status: CURRENT (v2.0). Supersedes NEFT/RTGS Operations SOP v1.0.**
> All cut-offs, windows, and figures are plausible-but-synthetic and marked
> `[verify]` against the prevailing RBI/NPCI operating timelines.

## 1. Scope and the sub-membership path

This SOP governs SynthBank's operation of **NEFT** (National Electronic Funds
Transfer) and **RTGS** (Real-Time Gross Settlement) on the **neft_rtgs** business
service. As with retail UPI/IMPS, SynthBank is a sub-member and routes NEFT/RTGS
through its sponsor commercial bank. The relevant CIs:

- **Sponsor Bank Link B (DR)** (`sponsor_bank_link`, tier_1, neft_rtgs) — the sponsor
  path primarily associated with NEFT/RTGS settlement.
- **NPCI Link A** (`npci_link`, tier_1) — rail connectivity reached via the sponsor.
- **CBS App Node 1** / **CBS DB Node 1** (`core_banking`) — debit/credit posting and
  the GL impact of each batch/settlement.

Because the sponsor relationship is shared with retail payments, a sponsor-side
problem can affect NEFT/RTGS and UPI/IMPS together — see the Sponsor-Bank Settlement
SOP for the cascade.

## 2. Windows and cut-offs `[verify]`

- **RTGS** operates on a near-24x7 basis in line with the current RBI schedule
  `[verify]`; SynthBank applies an internal customer cut-off ahead of the rail
  cut-off to allow for sponsor relay and CBS posting time.
- **NEFT** settles in half-hourly batches across the operating window `[verify]`.
  SynthBank's internal cut-off per batch is set a fixed lead-time before the rail
  batch to guarantee the sponsor receives the file in time.

**v2.0 change:** internal cut-offs are now expressed as a *lead-time before the rail
cut-off* rather than fixed clock times, so they track rail-schedule changes
automatically. Operators read the effective cut-off from the daily schedule, not from
this document. (This is the substantive change from v1.0, which hard-coded clock
times — see §6.)

## 3. Outward processing

1. Customer/branch initiates the transfer; CBS validates the account and places the
   debit hold on **CBS App Node 1**.
2. The instruction is queued for the next batch (NEFT) or sent immediately (RTGS) and
   relayed to the sponsor over **Sponsor Bank Link B (DR)**, then across **NPCI
   Link A**.
3. On settlement confirmation, CBS posts the debit final. A confirmation not posted
   is a reconciliation exception handled in the settlement SOP.

## 4. Return and rejection handling

Returns (beneficiary account closed, name mismatch, etc.) arrive on the inbound leg
and must be posted back to the originating customer within the regulated return
window `[verify]`. SynthBank tracks return age; an approaching return-window breach
is escalated to payments operations. Rejections at the sponsor or rail (file
validation failures) block the whole batch and are treated as incidents — confirm
sponsor link health and file integrity first.

## 5. Failure modes and escalation

- **Sponsor-link degradation** on Sponsor Bank Link B (DR) → batches miss their rail
  cut-off; queued instructions accumulate. Escalate to the sponsor liaison and
  communicate the delay; do not duplicate-send.
- **CBS posting lag** on CBS App Node 1 → settlement confirmed but not posted,
  producing reconciliation breaks even with a healthy rail.
- **Missed cut-off** → carry the instruction to the next batch/window and notify the
  customer per policy `[verify]`.

Escalation: L1 payments operations → L2 payments engineering + sponsor liaison →
treasury/finance for any settlement-position concern.

## 6. Version history

- **v2.0 (CURRENT)** — cut-offs expressed as rail-relative lead-times; supersedes
  v1.0. Use this document.
- **v1.0 (SUPERSEDED)** — hard-coded clock-time cut-offs. **Do not operate from v1.0**;
  it is retained only for audit history. If you are reading v1.0, stop and use v2.0.

## 7. NEFT vs RTGS — operational differences

Operators must keep the two rails distinct because their failure handling differs:

- **NEFT** is deferred-net-settlement in half-hourly batches `[verify]`. A missed
  batch is recoverable by carrying instructions to the next batch; the operational
  risk is *delay*, not loss. Batch file integrity to the sponsor is the critical
  control.
- **RTGS** is real-time gross settlement, transaction-by-transaction, used for
  high-value transfers `[verify]`. There is no "next batch" — a failed RTGS
  instruction is held and retried or returned, and the customer expectation is
  immediacy. RTGS failures are therefore more time-sensitive to communicate.

Both settle through the sponsor over **Sponsor Bank Link B (DR)** and post to
**CBS App Node 1**; the rail difference is in batching and urgency, not topology.

## 8. High-value and cut-off-edge handling

- **High-value RTGS near cut-off:** confirm the instruction will reach the sponsor
  within the rail window before accepting it for same-day settlement; otherwise set
  the customer expectation for next-window settlement `[verify]`.
- **Batch-edge NEFT:** instructions submitted close to a batch cut-off must be
  confirmed as either included in the current batch or rolled to the next — never left
  ambiguous, as ambiguity creates reconciliation exceptions.
- **Beneficiary-bank delays:** SynthBank's leg can complete while the beneficiary
  bank credits later; track but do not re-send.

## 9. Reconciliation touchpoint

NEFT/RTGS settlement is reconciled through the same sponsor-settlement process as
retail payments: the CBS posting record, the sponsor settlement confirmation, and the
rail acknowledgement must agree. Confirmed-not-posted items are reconciliation
exceptions; posted-not-confirmed items are investigated with the sponsor. The
settlement SOP governs the break handling; this SOP governs the rail operation that
feeds it.

## 10. Failure-mode quick reference

1. Batch missing acknowledgement → confirm Sponsor Bank Link B (DR) health, then file
   integrity; carry to next batch if needed.
2. RTGS instruction failing → confirm rail window open and link healthy; hold/return
   per policy, communicate immediately.
3. Returns approaching the regulated window → escalate to clear within window
   `[verify]`.
4. Confirmed-but-not-posted → CBS posting lag; reconciliation exception, check CBS
   App Node 1.
