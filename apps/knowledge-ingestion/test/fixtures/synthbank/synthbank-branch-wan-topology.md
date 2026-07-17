# SynthBank Branch WAN & Data-Centre Topology

> **100% synthetic.** SynthBank is a fictional medium urban co-operative bank (UCB).
> Every site, link, capacity and figure below is fabricated and marked `[verify]`.
> This is the prose companion to the ~260-CI SynthBank CMDB export
> (`synthbank-cmdb-export.xlsx`); it shares tenant `cfc5801f-…` and the same CI
> vocabulary. It feeds the W9 Branch WAN dashboard story and answers questions like
> "what is our branch network topology", "which hub serves branch 23", and "how do
> branches reach the data centre".

## 1. Network design overview

SynthBank runs a classic **hub-and-spoke** wide-area network. Fifty branches
(`Branch-001` … `Branch-050`) connect upward to **six regional hubs**, and the six
hubs aggregate into **two data centres**: `DC-Primary` (active) and `DC-DR` (disaster
recovery / standby). No branch connects directly to a data centre — every branch
reaches core banking, payments and card services *through* its regional hub and then
the DC core. This three-tier shape (branch → hub → DC) keeps the branch access layer
simple and pushes resilience into the hub and core layers.

The branch WAN is carried over a **dual-transport** design: a primary **MPLS** circuit
to the regional hub and a backup **IPsec VPN over broadband** that fails over when the
MPLS circuit drops. Branch routers (`branch_router`, CI type per ADR-003) hold both
transports; the branch switch (`branch_switch`) fans out to in-branch endpoints,
including the two ATM terminals (`atm_terminal`) every branch operates. The whole
branch WAN is modelled in the CMDB under the tier-2 business service `branch_wan`.

## 2. Regional hubs and branch-to-hub assignment

The fifty branches are distributed across the six hubs in contiguous numeric blocks.
This is the authoritative mapping (each hub runs one `hub_router` and one
`hub_switch`):

| Regional hub | Branches served | Count |
|---|---|---|
| **Hub-North** | Branch-001 … Branch-009 | 9 |
| **Hub-South** | Branch-010 … Branch-018 | 9 |
| **Hub-East** | Branch-019 … Branch-027 | 9 |
| **Hub-West** | Branch-028 … Branch-036 | 9 |
| **Hub-Central** | Branch-037 … Branch-045 | 9 |
| **Hub-NorthEast** | Branch-046 … Branch-050 | 5 |

Worked examples (so a reader can resolve any branch): **Branch-023 is served by
Hub-East**; Branch-014 (the branch called out in RCA-3, whose router is
`Branch Router BR-014`) is served by **Hub-South**; Branch-050 is served by
**Hub-NorthEast**. To find the hub for any branch *N*: North=1–9, South=10–18,
East=19–27, West=28–36, Central=37–45, NorthEast=46–50.

Each regional hub aggregates its branches' MPLS and VPN transports and presents a
single uplink pair to the DC core. A hub failure isolates only that hub's branches;
the other five regions are unaffected. Hub routers connect upward to **Core Router 1**
in DC-Primary (see §4).

## 3. Branch site layout

A standard SynthBank branch site contains four configuration items:

- **1× branch router** (`branch_router`, e.g. `Branch Router BR-023`) — dual MPLS+VPN
  uplink to the regional hub. Tier-2.
- **1× branch switch** (`branch_switch`, e.g. `Branch Switch SW-023`) — in-branch LAN
  fan-out. Tier-3. (Two branch switches — SW-007 and SW-031 — carry an *unknown*
  criticality tier in the CMDB, a deliberate data-hygiene gap.)
- **2× ATM terminals** (`atm_terminal`, e.g. `ATM Terminal ATM-023-1` /
  `ATM Terminal ATM-023-2`) — card/cash endpoints under the `atm_card_services`
  business service, reached through the branch switch.

All four CIs sit at `location = Branch-0NN` in the CMDB. The ATM terminals depend on
the central **ATM Switch 1** and **HSM Device 1** in DC-Primary for authorization;
when the branch WAN drops, on-us ATM behaviour follows the ATM cash-replenishment SOP.

## 4. Data-centre core layout

**DC-Primary** is the active data centre and hosts the bulk of the tier-1 estate:

- **Core network:** `Core Router 1` and `Core Router 2` (`core_router`), `Core Switch 1`
  and `Core Switch 2` (`core_switch`), and `Firewall Edge 1` (`firewall`) at the WAN
  edge. The six hub routers home into Core Router 1.
- **Core banking:** `CBS App Node 1` / `CBS App Node 2` (`cbs_application_server`) and
  `CBS DB Node 1` / `CBS DB Node 2` (`cbs_database_server`), supporting the
  `core_banking` service. (`CBS Hosted Service` covers the shared/hosted CBS leg.)
- **Payments:** `UPI Switch 1`, `Payment Gateway 1`, `HSM Device 2`, and the WAN-edge
  rails `Sponsor Bank Link A` and `NPCI Link A` (with `NPCI Link B (Secondary)` as a
  back-up rail) — the `upi_imps` and `neft_rtgs` services.
- **Cards:** `ATM Switch 1` and `HSM Device 1` — the `atm_card_services` service.
- **Channels:** `Internet Banking Server 1` and `Mobile Banking Gateway 1`
  (`internet_mobile_banking`), and `CTS System 1` (`cheque_clearing`).
- **Reporting / infra:** `Regulatory Reporting Server`, `AD/DNS/DHCP Server 1`,
  `Backup System 1`.

**DC-DR** is the standby data centre. It mirrors the *critical* DC-Primary CIs:
`CBS App DR Node 1`, `CBS DB DR Node 1`, `DR Site Node 1`, `UPI Switch 2 (DR)`,
`Payment Gateway 2 (DR)`, `Sponsor Bank Link B (DR)`, `Internet Banking Server 2 (DR)`,
`Mobile Banking Gateway 2 (DR)`, `CTS System 2 (DR)`, plus DR core network
(`Core Router DR`, `Core Switch DR`, `Firewall DR`, `AD/DNS/DHCP Server 2 (DR)`) and
`Backup System 2 (DR)`.

## 5. Failover and DR posture

DC-Primary → DC-DR failover follows each tier-1 service's RTO/RPO (see the
business-services spine in the CMDB export). Core banking, UPI/IMPS, NEFT/RTGS,
internet/mobile banking and cheque clearing all have a mapped DR node and a defined
recovery objective.

**Known BCP gap (deliberate, and honest):** `atm_card_services` has **no documented DR
and no DR node** — there is no `ATM Switch` or card-serving `HSM` mirror in DC-DR, and
no DR/failover procedure for the ATM switch anywhere in the SynthBank document corpus.
A question such as *"what is the DR plan for the ATM switch / atm_card_services?"*
should therefore return an honest **"no DR documented"** from both the topology/CMDB
side and the document side — not a confabulated procedure. This is a flagged
CMDB-hygiene / BCP-posture item, not an omission to paper over.

## 6. How branches reach the data centre (request path)

For a branch transaction (say, an ATM withdrawal or an internet-banking session
originating at a branch):

1. The endpoint reaches the **branch switch**, which forwards to the **branch router**.
2. The branch router carries the traffic over **MPLS (primary)** or **VPN (backup)** to
   its **regional hub router**.
3. The hub router aggregates and forwards to **Core Router 1** in **DC-Primary**, past
   **Firewall Edge 1**.
4. From the core, the request reaches the relevant tier-1 service — `core_banking`,
   `upi_imps`, `atm_card_services`, etc. — and, for payments, out across the
   `Sponsor Bank Link` / `NPCI Link` rails.
5. If DC-Primary is unavailable, services with a DR mapping cut over to **DC-DR**;
   `atm_card_services` does not (the gap in §5).

This is why a single regional hub outage (RCA-3 style) takes out only the branches
homed to that hub, while a DC-core or payments-rail event has bank-wide blast radius.
The branch WAN dashboard (W9) renders this tree: DC core at the root, six hubs beneath
it, and the fifty branches grouped under their hubs with per-branch ATM status.
