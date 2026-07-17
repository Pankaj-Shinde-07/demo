# NEFT / RTGS Operations SOP — v1.0 (SUPERSEDED) — SynthBank Co-operative Bank

> **SYNTHETIC FIXTURE** — fabricated for Canaris AI Copilot SynthBank P1. Fictional
> UCB. **Document status: SUPERSEDED (v1.0). This document has been replaced by
> NEFT/RTGS Operations SOP v2.0 (CURRENT).** It is retained for audit history only.
> Do not operate from this version. All figures are plausible-but-synthetic and marked
> `[verify]`. This file deliberately co-exists with its replacement so retrieval is
> exercised on version ambiguity (see the SynthBank manifest).

## 1. Scope

This SOP governs SynthBank's operation of **NEFT** and **RTGS** on the **neft_rtgs**
business service via the sponsor sub-membership path. CIs involved: **Sponsor Bank
Link B (DR)** (`sponsor_bank_link`), **NPCI Link A** (`npci_link`), and **CBS App
Node 1** / **CBS DB Node 1** (`core_banking`).

## 2. Windows and cut-offs `[verify]` — OUTDATED

> The clock-time cut-offs below are the reason this version was superseded. v2.0
> replaced them with rail-relative lead-times. The specific times here may not match
> the current rail schedule — **do not rely on them.**

- RTGS internal customer cut-off: fixed clock time each business day `[verify]`.
- NEFT internal cut-offs: fixed clock times per batch through the operating window
  `[verify]`.

Operators historically read these fixed times from this document. Under v2.0 the
effective cut-off is read from the daily schedule instead.

## 3. Outward processing

1. CBS validates the account and places the debit hold on **CBS App Node 1**.
2. The instruction is relayed to the sponsor over **Sponsor Bank Link B (DR)** and
   across **NPCI Link A** (batch for NEFT, immediate for RTGS).
3. On settlement confirmation, CBS posts the debit final.

## 4. Return handling

Returns are posted back to the originating customer within the regulated return
window `[verify]`. Return-age tracking and escalation apply.

## 5. Escalation

L1 payments operations → L2 payments engineering + sponsor liaison. For any
sponsor-link degradation on Sponsor Bank Link B (DR), open a sponsor ticket in
parallel.

## 6. Outward and inward processing (as it stood in v1.0)

1. Branch/customer initiates the transfer; CBS validates and holds the debit on
   **CBS App Node 1**.
2. NEFT instructions queue for the next fixed-time batch; RTGS instructions relay
   immediately to the sponsor over **Sponsor Bank Link B (DR)** and across **NPCI
   Link A**.
3. On settlement confirmation, CBS posts the debit final.
4. Inward returns and credits are posted to the originating/beneficiary customer
   within the regulated window `[verify]`.

> Under v1.0 the batch cut-offs were the fixed clock times listed in §2. This is the
> exact area v2.0 changed — operators occasionally worked from a stale cut-off when
> the rail schedule shifted, which is why v2.0 moved to rail-relative lead-times.

## 7. Failure handling (v1.0)

- Missed NEFT batch → carry to the next fixed-time batch and notify.
- RTGS failure → hold/return per policy `[verify]`.
- Sponsor-link degradation on Sponsor Bank Link B (DR) → escalate to the sponsor
  liaison; do not duplicate-send.

## 8. Version note

Superseded by **v2.0 (CURRENT)** on the cut-off-handling change. Use v2.0 for all
live operations. This v1.0 document is retained only so the version history and the
cut-off-handling change are auditable; it deliberately co-exists with v2.0 in the
corpus to exercise retrieval on version ambiguity.
