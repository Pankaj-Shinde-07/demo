# ATM / Switch Operations & Cash-Replenishment SOP — SynthBank Co-operative Bank

> **SYNTHETIC FIXTURE** — fabricated for Canaris AI Copilot SynthBank P1. Fictional
> UCB. All figures, thresholds, and dispute timelines are plausible-but-synthetic and
> marked `[verify]`. NOTE (deliberate corpus imperfection, logged in the SynthBank
> manifest): this SOP intentionally documents no DR/failover procedure for the ATM
> switch — atm_card_services has no mapped DR node in the CMDB, mirroring a real BCP
> gap. A query for "the DR plan for the ATM switch" should therefore find nothing
> confident rather than a fabricated procedure.

## 1. Scope

This SOP covers SynthBank's **atm_card_services** business service: ATM transaction
switching, card authorization, and ATM cash replenishment. The CIs:

- **ATM Switch 1** (`atm_switch`, tier_1, atm_card_services) — switches and routes
  ATM/card transactions and forwards authorization requests.
- **HSM Device 1** (`hsm_device`, tier_1) — PIN verification and key management for
  card transactions; shared with upi_imps, so an HSM problem is felt by both.
- **Sponsor Bank Link A** (`sponsor_bank_link`) — interchange to other banks' cards
  and SynthBank cards used elsewhere flows via the sponsor relationship.
- **CBS App Node 1** / **CBS DB Node 1** (`core_banking`) — balance check and the
  account posting for on-us transactions.

## 2. Switch operations

### 2.1 Authorization flow
A card transaction at an ATM reaches **ATM Switch 1**, which determines on-us vs
off-us:

- **On-us** (SynthBank card at a SynthBank ATM): ATM Switch 1 calls **HSM Device 1**
  for PIN verification, checks balance against **CBS App Node 1**, and authorizes.
- **Off-us** (interchange): the request routes via **Sponsor Bank Link A** to the
  interchange network and back. SynthBank's ATM serving another bank's card, or a
  SynthBank card at another bank's ATM, both traverse the sponsor interchange path.

### 2.2 Health monitoring
Watch ATM Switch 1 authorization latency and approval ratio, HSM Device 1 signing
latency, and the interchange round-trip over the sponsor link. A drop in approval
ratio with healthy CBS usually points at HSM Device 1 or the interchange path, not
the accounts.

## 3. Cash-out detection and handling

ATM cash-out (an ATM physically out of cash) is distinct from a switch/authorization
failure and must not be confused with it:

1. **Detection** — declining dispense-success at a terminal with healthy
   authorization indicates a cash, not a switch, problem. Low-cash and out-of-cash
   states are tracked per terminal `[verify]`.
2. **Replenishment** — raise a replenishment request to the cash-management vendor
   per the agreed SLA `[verify]`. Record the cassette load and reconcile dispensed
   vs loaded at the next visit.
3. **Reconciliation** — dispensed-cash totals reconcile against the switch
   transaction record; a mismatch is investigated as either a dispense fault or a
   cash-handling discrepancy.

## 4. Disputes and chargebacks (basics)

- A customer dispute (debited but not dispensed, or double-debit) is logged and the
  switch transaction record + the dispense log are pulled.
- "Debited but not dispensed" cases are reconciled against the §3.3 dispensed-vs-
  recorded check and refunded within the regulated dispute window `[verify]`.
- Interchange disputes follow the network/sponsor chargeback process `[verify]`;
  SynthBank files via the sponsor.

## 5. Failure modes and escalation

- **HSM Device 1 degradation** — PIN-verification failures decline card
  transactions *and* (because the HSM is shared) UPI signing. Treat as a
  cross-service incident; escalate to security operations.
- **ATM Switch 1 degradation** — authorization latency/failures across terminals.
  Escalate to channels operations (`channels.ops@synthbank.example`).
- **Interchange path (sponsor) degradation** — off-us transactions fail while on-us
  may still work; confirm Sponsor Bank Link A health.

Escalation: L1 channels operations → L2 channels engineering; HSM issues go to
security operations; sponsor-interchange issues involve the sponsor liaison.

## 6. Daily checks

Start-of-day: confirm ATM Switch 1 is authorizing test transactions, HSM Device 1 is
online, and the interchange path over Sponsor Bank Link A is healthy. Through the
day: monitor approval ratio, per-terminal cash state, and dispute inflow. End of day:
reconcile dispensed cash and switch records, and confirm dispute items are within
window.

## 7. On-us vs off-us — why the distinction drives triage

The single most useful triage split for atm_card_services is on-us versus off-us:

- **On-us failing, off-us working** → the problem is local to SynthBank's own
  authorization path: **HSM Device 1** (PIN verification) or **CBS App Node 1**
  (balance check). The sponsor interchange is fine because off-us still works.
- **Off-us failing, on-us working** → the problem is the interchange path over
  **Sponsor Bank Link A** or the far network. SynthBank's own switch/HSM/CBS are fine.
- **Both failing** → suspect **ATM Switch 1** itself, or the shared **HSM Device 1**
  if card auth is failing alongside UPI signing.

This two-question split resolves most ATM incidents to the right CI in under a minute
and prevents chasing the cash-management vendor for what is actually a switch or HSM
problem.

## 8. Reconciliation and cash accountability

ATM operations carry two reconciliations that must both close:

1. **Transaction reconciliation** — switch records vs CBS postings vs (for off-us)
   the interchange settlement via the sponsor. Mismatches are investigated as dispense
   faults or posting errors.
2. **Cash reconciliation** — physical cash loaded into each terminal vs cash recorded
   as dispensed. A persistent shortfall at a terminal is escalated to cash-management
   and security operations as a potential handling or device issue.

The two are linked: a "debited but not dispensed" customer dispute is resolved by
cross-checking the dispense log against the transaction record — if the switch shows a
completed withdrawal but the dispense log shows no cash out, the customer is refunded
within the dispute window `[verify]`.

## 9. Card-services dependencies summary

- **ATM Switch 1** — authorization and routing; on-us + off-us.
- **HSM Device 1** — PIN verification and key management; **shared with upi_imps**, so
  an HSM fault is a cross-service incident.
- **Sponsor Bank Link A** — interchange path for off-us card traffic.
- **CBS App Node 1 / CBS DB Node 1** — balance check and posting for on-us.

> Reminder (deliberate corpus gap, logged in the manifest): there is intentionally **no
> documented DR/failover procedure for ATM Switch 1 / atm_card_services** in this SOP
> or elsewhere in the SynthBank corpus — atm_card_services has no mapped DR node in the
> CMDB. A question about the ATM switch's DR plan should surface that gap honestly, not
> a fabricated procedure.
