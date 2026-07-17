# UPI / IMPS Operational Runbook — SynthBank Co-operative Bank

> **SYNTHETIC FIXTURE** — fabricated for Canaris AI Copilot SynthBank P1. SynthBank
> is a fictional medium-sized Indian Urban Co-operative Bank (UCB). Nothing here is a
> real bank's runbook. All regulatory, timing, and economic figures are
> plausible-but-synthetic and explicitly marked `[verify]` — confirm against the
> current RBI/NPCI circulars before any real use.

## 1. Purpose and scope

This runbook describes day-to-day operation of SynthBank's retail digital payments
on the **upi_imps** business service: UPI (Unified Payments Interface) and IMPS
(Immediate Payment Service). SynthBank is a *sub-member* — it does not connect to
NPCI directly. Retail payment traffic is carried to the payment rails through a
**sponsor commercial bank** over the `sponsor_bank_link`, and onward to NPCI over
the `npci_link`. This sponsor topology is the defining operational fact of the
service and recurs throughout this document.

The CIs that make up the upi_imps service in the CMDB are:

- **UPI Switch 1** (`upi_switch`, tier_1) — the transaction switch that receives,
  validates, and routes UPI/IMPS messages.
- **Sponsor Bank Link A** (`sponsor_bank_link`, tier_1) — the primary rail to the
  sponsor bank that fronts NPCI membership for SynthBank.
- **NPCI Link A** (`npci_link`, tier_1) — connectivity to the NPCI central system,
  reached via the sponsor's infrastructure.
- **Payment Gateway 1** (`payment_gateway`, tier_1) — the gateway that brokers
  collect/pay requests between SynthBank channels and the switch.
- **HSM Device 1** (`hsm_device`, tier_1) — performs PIN translation and message
  signing for both card and UPI flows; shared with atm_card_services.
- **CBS App Node 1** and **CBS DB Node 1** (`core_banking`) — consulted on every
  transaction for the customer balance check and the debit/credit posting.

## 2. Transaction flow (end to end)

A typical customer UPI pay request traverses the estate in this order:

1. The customer initiates a pay/collect from a channel (mobile app or third-party
   UPI app). The request reaches **Payment Gateway 1**.
2. Payment Gateway 1 forwards the request to **UPI Switch 1**, which validates the
   message format, the VPA, and the transaction limits.
3. UPI Switch 1 requests a **balance check and hold** against **CBS App Node 1**,
   which reads the customer account on **CBS DB Node 1**. If funds are insufficient
   the transaction is declined locally with a business decline (see §4).
4. For PIN-based and signed flows, UPI Switch 1 calls **HSM Device 1** for PIN
   translation / message signing.
5. UPI Switch 1 sends the outbound message over **Sponsor Bank Link A** to the
   sponsor bank, which relays it across **NPCI Link A** to NPCI and the beneficiary
   bank.
6. On the response leg, NPCI → sponsor → UPI Switch 1 → CBS posting (debit
   confirmed) → Payment Gateway 1 → customer. The CBS posting is what makes the
   debit final; a response received but not posted is a reconciliation exception.

The single most important dependency to internalize: **steps 5 and 6 cannot happen
without Sponsor Bank Link A.** If that link is degraded or down, no UPI/IMPS
transaction can complete regardless of the health of the switch, gateway, or CBS.
This is why `sponsor_bank_link` is a tier_1 CI and why its health is the first thing
to check during any payments incident.

## 3. Daily operational checks

### 3.1 Start-of-day rail health
Before the morning peak, confirm: Sponsor Bank Link A is up and within latency
budget `[verify]`; NPCI Link A is reachable through the sponsor; UPI Switch 1 is
processing test heartbeat transactions; HSM Device 1 is online and key ceremony
status is healthy; Payment Gateway 1 is accepting inbound from channels. Record the
morning rail-health snapshot in the operations log.

### 3.2 Peak-window monitoring
SynthBank's UPI traffic peaks in the morning commute and evening windows `[verify]`.
During peaks, watch UPI Switch 1 throughput, the sponsor-link round-trip latency,
and the local-decline ratio. A rising local-decline ratio with healthy rails usually
points at CBS balance-check latency, not a rail problem.

### 3.3 End-of-day reconciliation touchpoint
At end of day the payments team prepares the inputs for the separate **Sponsor-Bank
Settlement & Reconciliation SOP**: the UPI Switch 1 transaction log, the sponsor
settlement file, and the NPCI raw file. UPI/IMPS is a 24x7 service `[verify]`, so
"end of day" here means the recon cut-off, not a service stop.

## 4. Decline handling

UPI declines fall into two families, and distinguishing them is the core operational
skill for this service:

### 4.1 Business declines (expected)
Insufficient funds, per-transaction limit breaches, invalid VPA, and risk holds are
**business declines**. They are generated locally at UPI Switch 1 or CBS and are not
incidents. They show up as a normal background rate. A *spike* in business declines
(e.g. a sudden jump in "insufficient funds") may indicate a CBS balance-read problem
returning stale balances — investigate CBS, not the rail.

### 4.2 Technical declines (investigate)
Timeouts, signature failures, and rail-unreachable responses are **technical
declines**. A rising technical-decline rate is the leading indicator of a rail or
HSM problem:

- **Timeouts on the outbound leg** → suspect Sponsor Bank Link A latency or the
  sponsor's own NPCI connectivity. Confirm link health first.
- **Signature / PIN-translation failures** → suspect HSM Device 1 (key state,
  capacity, or a partial outage). HSM problems present as a payments *and* card
  problem simultaneously, because HSM Device 1 is shared with atm_card_services.
- **"Beneficiary unreachable"** → typically the far side; confirm it is not
  SynthBank-wide before escalating to the sponsor.

A sustained technical-decline spike that crosses the success-rate threshold `[verify]`
is a regulator-relevant event — see the UPI Decline Spike incident archetype and the
APM success-rate signal. Notify the on-call lead and begin an incident record.

## 5. Escalation path

1. **L1 — payments operations** (`payments.ops@synthbank.example`): triage, confirm
   business vs technical decline, run the §3.1 rail checks.
2. **L2 — payments engineering + the sponsor-bank liaison**: for any sustained
   sponsor-link or NPCI-link degradation, open a ticket with the sponsor bank in
   parallel — SynthBank cannot fix the sponsor's NPCI leg, only report and track it.
3. **L3 — security operations** (`security.ops@synthbank.example`): for HSM Device 1
   key/signing failures.

When the sponsor link is the root cause, the incident is *owned by SynthBank but
remediated by the sponsor*; the operational job is accurate, fast reporting and
customer-impact tracking, not a local fix.

## 6. Known failure modes

- **Sponsor-link flap** — intermittent drops on Sponsor Bank Link A cause cascading
  timeouts across UPI, IMPS, and (via the shared sponsor path) NEFT/RTGS. Compress
  the alert storm to one incident rooted at the link. See the sponsor-link-flap RCA.
- **HSM saturation** — HSM Device 1 at capacity raises signing latency, producing
  technical declines on both UPI and card flows.
- **CBS slowdown** — slow balance checks on CBS App Node 1 raise local declines and
  can stall the posting leg, creating reconciliation exceptions even when the rail
  is healthy.

## 7. Disaster recovery posture

Core banking has a documented DR target on **DR Site Node 1**, and NEFT/RTGS has a
DR sponsor path on **Sponsor Bank Link B (DR)**. The UPI/IMPS recovery position for
the switch and gateway tier is covered by the platform DR runbook and the sponsor's
own resilience commitments `[verify]`. Detailed switch-tier failover steps for
upi_imps are maintained by payments engineering and are out of scope for this
operational runbook.

## 8. IMPS specifics

IMPS shares the same rail topology as UPI — **UPI Switch 1**, **Sponsor Bank Link A**,
**NPCI Link A**, and CBS posting — but differs operationally in a few ways the
payments team must keep distinct:

- **Channels.** IMPS is initiated from mobile/internet banking and at the branch
  counter using account+IFSC or MMID+MPIN, whereas UPI is VPA-driven from UPI apps.
  Both converge at Payment Gateway 1 → UPI Switch 1.
- **MPIN verification** uses **HSM Device 1**, the same device that signs UPI and
  verifies card PINs. An HSM problem therefore degrades IMPS, UPI, and card flows
  together — a key correlation signal during incidents.
- **Limits.** IMPS per-transaction and daily limits differ from UPI limits `[verify]`;
  a customer hitting an IMPS limit gets a business decline, not a technical one.
- **Settlement.** IMPS settles through the same sponsor sub-membership path, so it
  appears in the same reconciliation cycle as UPI and is exposed to the same
  sponsor-link cascade.

When triaging "payments are failing," always establish whether the failure is
UPI-only, IMPS-only, or both: both-failing with healthy CBS points hard at the shared
rail or the shared HSM, not at a channel.

## 9. Limits and risk controls

UPI/IMPS transactions are subject to per-transaction caps, daily per-customer caps,
and velocity/risk checks `[verify]`. These controls live partly at UPI Switch 1 and
partly in CBS:

- **Per-transaction and daily caps** are enforced at the switch and surface as
  business declines when breached. A sudden rise in "limit exceeded" declines for
  many customers is unusual and may indicate a misapplied limit-config change rather
  than genuine customer behaviour — check recent changes.
- **Velocity / risk holds** may park a transaction for review. These are expected at
  a low background rate; a spike warrants a look at the risk-rule configuration.
- **New-customer cooling limits** `[verify]` apply tighter caps for a defined initial
  period; declines from these are expected and are not incidents.

Distinguishing a *control* decline (working as designed) from a *fault* decline
(something broke) is the judgement this section exists to support: control declines
are business declines with a clear reason code; fault declines are technical declines
with timeouts or signature errors.

## 10. Customer communication during rail incidents

When Sponsor Bank Link A or the sponsor's NPCI leg is the confirmed root cause, the
fix is not in SynthBank's hands, so communication discipline is the main lever:

1. Post a status notice that retail payments are degraded and being worked, without
   speculating on cause or ETA before the sponsor confirms.
2. Advise customers that funds debited but not completed will auto-reverse on
   reconciliation per the settlement SOP — do not advise re-attempting repeatedly, as
   that inflates the switched-not-settled exception queue.
3. Keep the branch and contact-centre teams updated with the same facts so customers
   get one consistent message.
4. On recovery, confirm normal success rates before declaring resolution, and note
   that reconciliation of in-flight transactions may continue after service restores.

## 11. Worked reconciliation-exception examples

- **Debited, payment shows pending, then auto-reverses.** Transaction switched, the
  sponsor did not settle (a drop mid-flight) → switched-not-settled exception →
  auto-reversed on the next reconciliation against the sponsor's settlement file. No
  manual debit reversal before sponsor confirmation.
- **Beneficiary not credited but SynthBank shows success.** Far-side or NPCI-leg
  issue; raised with the sponsor for the beneficiary bank. SynthBank's leg completed.
- **Duplicate debit.** Customer re-attempted during a slow response; one settles, the
  duplicate becomes a settled-not-switched or amount-context exception and is
  reversed. Reinforces the §10 guidance against repeated re-attempts.

## 12. Triage quick reference

1. Are declines **business** (insufficient funds, limits) or **technical** (timeouts,
   signature)? Business → not an incident. Technical → continue.
2. Is CBS healthy? If CBS is slow, local declines rise — investigate CBS.
3. Are **both** UPI and IMPS failing? If yes with healthy CBS → shared rail
   (Sponsor Bank Link A) or shared HSM (HSM Device 1).
4. Timeouts on the outbound leg → confirm Sponsor Bank Link A health first.
5. Signature/PIN failures + card flows also slow → HSM Device 1.
6. Success rate sustained below threshold `[verify]` → regulator-relevant; open an
   incident and begin impact tracking.
