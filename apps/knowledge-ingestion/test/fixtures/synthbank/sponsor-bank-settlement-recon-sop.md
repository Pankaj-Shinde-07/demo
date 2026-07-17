# Sponsor-Bank Settlement & Reconciliation SOP — SynthBank Co-operative Bank

> **SYNTHETIC FIXTURE** — fabricated for Canaris AI Copilot SynthBank P1. Fictional
> UCB. All settlement timings, cut-offs, and figures are plausible-but-synthetic and
> marked `[verify]`. This is the co-op-specific settlement procedure a generic IT
> tool does not model.

## 1. Why SynthBank settles through a sponsor

SynthBank is a sub-member of the retail payment rails, not a direct NPCI member. Its
UPI/IMPS and NEFT/RTGS traffic reaches NPCI and the wider banking system through a
**sponsor commercial bank**. The operational and financial consequence is that
SynthBank's customer transactions are *settled* in the sponsor's books and then
reconciled back to SynthBank's CBS. Two CIs carry this relationship:

- **Sponsor Bank Link A** (`sponsor_bank_link`, tier_1, business_service upi_imps) —
  the primary rail used for retail UPI/IMPS settlement traffic.
- **Sponsor Bank Link B (DR)** (`sponsor_bank_link`, tier_1, business_service
  neft_rtgs) — the secondary/DR sponsor path, primarily associated with NEFT/RTGS.

Because settlement is sub-membership-based, **a sponsor-link outage is not just a
connectivity event — it is a settlement event.** Transactions may have been switched
but not yet settled, leaving SynthBank with reconciliation breaks that must be
resolved before the books close.

## 2. The settlement cycle

### 2.1 Inputs
Reconciliation consumes three inputs, the same set the UPI runbook prepares at the
recon cut-off:

1. **Switch transaction log** — from UPI Switch 1 (what SynthBank believes happened).
2. **Sponsor-bank settlement file** — what the sponsor actually settled on
   SynthBank's behalf.
3. **NPCI raw data file** — the rail's record of record.

These three are loaded into the reconciliation process that runs on **Reconciliation
Server 1**, which produces the matched set and the exception queue. A missing
sponsor settlement file blocks the entire cycle and must be escalated to the sponsor
liaison immediately — reconciliation cannot proceed on two of three inputs.

### 2.2 Matching
Each switch transaction is matched against the NPCI raw record and the sponsor
settlement entry on the transaction reference and amount. Three-way agreement →
settled-and-reconciled. Any disagreement is an exception.

### 2.3 Exception classes
- **Switched, not settled** — SynthBank switched a transaction the sponsor did not
  settle (often a sponsor-link drop mid-flight). These are the highest-priority
  breaks: customer may have been debited without final settlement.
- **Settled, not switched** — the sponsor settled something SynthBank has no switch
  record for. Rare; usually a duplicate or a late response.
- **Amount mismatch** — reference matches, amount differs. Tag with a reason code and
  route to the payments operations queue.

## 3. What cascades when the sponsor link drops

This is the dependency every operator must know cold:

1. **Immediate:** UPI and IMPS stop completing (the UPI runbook §2 settlement leg
   fails). Customers see technical declines.
2. **Within the cycle:** transactions switched just before the drop become
   *switched-not-settled* exceptions — the reconciliation break count climbs.
3. **Cross-service:** because NEFT/RTGS also rides the sponsor relationship, a
   primary-link failure can pressure the **Sponsor Bank Link B (DR)** path and the
   neft_rtgs service as well. A single sponsor problem can therefore present as a
   simultaneous UPI + IMPS + NEFT/RTGS degradation — compress these into one incident
   rooted at the sponsor link, do not chase them as three separate outages.

This cascade is the basis of the sponsor-link-flap incident archetype: one root
cause (`sponsor_bank_link`), many downstream symptoms.

## 4. Recon-break handling procedure

1. Freeze the exception queue snapshot at the cut-off so the count is stable.
2. Categorize each break (§2.3). Prioritize switched-not-settled.
3. For switched-not-settled breaks caused by a confirmed sponsor-link incident,
   reconcile against the sponsor's post-incident settlement file once the link is
   restored — do **not** reverse customer debits unilaterally before the sponsor
   confirms non-settlement.
4. Carry forward only formally-signed-off unresolved breaks to the next cycle.
5. Record the outcome and the break-count trend in the operations log; a rising
   trend across cycles is a sponsor-relationship health signal worth escalating.

## 5. Sign-off

Reconciliation is signed off only when every exception is resolved or formally
carried forward with a reason code and an owner. The sign-off record names the cycle,
the input files used, the break counts by class, and the carried-forward items. This
record is the audit trail for the settlement relationship and feeds the regulatory
reporting process `[verify]`.

## 6. Dependencies summary

- **Sponsor Bank Link A** — primary settlement rail; its health gates the whole
  cycle.
- **Sponsor Bank Link B (DR)** — DR sponsor path; relevant to neft_rtgs and to
  cross-service cascade.
- **UPI Switch 1** — source of the switch transaction log.
- **NPCI Link A** — source of the NPCI raw file (via the sponsor).
- **Reconciliation Server 1** — where the three-way match runs and the exception
  queue is produced.

## 7. The sub-membership settlement position

Because SynthBank settles in the sponsor's books, it carries a **settlement position**
with the sponsor through the day: the net of what the sponsor has settled on
SynthBank's behalf versus what SynthBank has switched. Operationally this means:

- SynthBank typically pre-funds or maintains an arrangement with the sponsor to cover
  its retail settlement obligation `[verify]`. A breach of that arrangement can cause
  the sponsor to throttle or hold settlement — a *commercial* failure mode distinct
  from a *technical* link failure, but with the same customer-visible symptom
  (payments not completing).
- The treasury/finance team monitors the intraday position; a fast-growing
  switched-not-settled queue during an incident also grows the unsettled exposure,
  which is why prompt reconciliation matters financially, not just operationally.
- The position is reconciled and squared each cycle as part of sign-off (§5).

## 8. Recon break trend as a health signal

A single cycle's break count is noise; the **trend across cycles** is signal:

- A rising switched-not-settled trend with no incidents may indicate intermittent,
  below-alarm sponsor-link instability — worth a proactive conversation with the
  sponsor before it becomes a P1 flap.
- A rising amount-mismatch trend may indicate a fee/charge handling drift between
  SynthBank's and the sponsor's books — route to finance.
- A rising settled-not-switched trend may indicate duplicate or late-response
  handling problems at the switch — route to payments engineering.

Record the per-class trend in the operations log each cycle so the pattern is visible
before it becomes an incident.

## 9. Worked break example — sponsor-link flap

During a sponsor-link flap (see the sponsor-link-flap RCA), the sequence is:

1. Transactions switched in the seconds around each drop are acknowledged late or not
   at all by the sponsor → they land in the switched-not-settled class.
2. The exception queue spikes in lockstep with the flap, not as a steady stream.
3. On link recovery, the sponsor issues a corrected settlement file covering the
   window; SynthBank reconciles the switched-not-settled breaks against it.
4. Genuinely non-settled transactions auto-reverse to customers; settled-but-late
   transactions clear. Only residue after this is carried forward with sign-off.

This is the canonical "the rail broke, now reconcile the financial residue" drill and
is the financial tail of every sponsor-link incident.

## 10. Escalation and ownership

- **L1 payments operations** run the cycle and categorize breaks.
- **L2 payments engineering + sponsor liaison** handle link faults and missing files.
- **Treasury/finance** own the settlement position and any commercial/funding cause.

The defining principle, restated: a sponsor-link outage is a settlement event as much
as a connectivity event — work the connectivity with the sponsor and the financial
residue through reconciliation, in parallel.
