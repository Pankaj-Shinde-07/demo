# RCA-3 — Regional Branch-WAN Hub Outage — SynthBank Co-operative Bank

> **SYNTHETIC FIXTURE** — fabricated incident write-up for Canaris AI Copilot
> SynthBank P1. Fictional UCB; fabricated dates, times, figures, all `[verify]`.
> This RCA is the scoped-branch-outage archetype: real impact, but bounded — NOT a
> data-centre or core-banking outage.

- **Incident ID:** INC-SB-2026-0401
- **Severity:** P2 (regional, branch-scoped)
- **Business service affected:** branch_wan (branch access to central services)
- **Primary CIs:** Core Router 1 (`core_router`), Branch Router BR-014
  (`branch_router`), Firewall Edge 1 (`firewall`)
- **Duration:** ~95 minutes `[verify]`; ~8 branches on the affected hub unreachable.

## 1. Summary

A regional WAN hub link feeding a cluster of branches dropped, leaving approximately
eight branches unable to reach central services over **branch_wan**. Crucially, the
**data centre, core_banking, and the payment rails were unaffected** — customers at
unaffected branches and all digital channels continued normally. This was a scoped
connectivity outage, not a platform outage, and the RCA's job is to keep that scope
clear so impact is not overstated.

## 2. Timeline `[verify]`

- **10:22** — Monitoring shows loss of reachability to a group of branches behind one
  regional hub; **Branch Router BR-014** and peers on that hub stop responding.
- **10:25** — Branch staff at affected sites report no access to CBS screens; digital
  channels and other branches normal.
- **10:30** — On-call scopes the blast radius to a single hub path through **Core
  Router 1**; **Firewall Edge 1** and the DC core are healthy.
- **10:40** — Carrier engaged for the regional hub link; fault confirmed on the
  carrier's regional segment.
- **11:50** — Carrier restores the segment; branches reconnect and CBS access returns.
- **11:57** — Incident closed after confirming all affected branches are back.

## 3. Root cause

A fault on the carrier's regional WAN segment serving the hub broke connectivity
between the affected branches and the data centre. The SynthBank-side CIs (Core
Router 1, Firewall Edge 1) were healthy; the failure was in the carrier's link feeding
**Branch Router BR-014** and its peer branches. No SynthBank change was involved.

## 4. Recent-change linkage

No SynthBank-side change preceded the outage; the cause was a carrier-side regional
fault. Noted explicitly so the incident is correctly attributed to the WAN carrier,
not to a local network change.

## 5. Impact (correctly scoped)

- **Affected:** ~8 branches on the hub lost CBS/central access for ~95 minutes;
  in-branch service at those sites was disrupted.
- **NOT affected:** the data centre, core_banking platform, UPI/IMPS, NEFT/RTGS, ATM
  switching, internet/mobile banking, and all other branches. This boundary is the
  most important part of the write-up — the outage looked alarming in raw alert
  volume but was bounded to one regional hub.

## 6. Corrective and preventive actions

1. Review redundancy for the affected regional hub; a single-link hub is a branch-WAN
   resilience gap `[verify]`.
2. Tune branch-WAN alerting to group by hub so a hub-link fault presents as one scoped
   incident with a clear branch list, not a flood.
3. Confirm the carrier SLA and restoration commitment for regional segments
   `[verify]`.
4. Maintain a branch-fallback procedure (offline/again-later customer guidance) for
   scoped branch-WAN outages.

## 7. Scoping discipline — why "blast radius" is the headline

The most common failure when reading this kind of incident is **overstating scope**.
Raw alert volume from ~8 branches and their terminals can look, on a flat dashboard,
indistinguishable from a platform outage. The discipline that keeps it honest:

- Confirm what is **still working**: core_banking, the payment rails, digital
  channels, and all other branches were fully up. If digital channels work, it is not
  a DC or CBS outage.
- Establish the **common element** of the failing set: every unreachable branch sat
  behind one regional hub path through **Core Router 1**; the carrier segment feeding
  that hub was the single fault point.
- State the bound explicitly in the incident summary so impact is not inflated: "~8
  branches on one hub, ~95 minutes, no platform or digital impact."

A CMDB-aware view produces this scoping automatically by mapping the failing branch
routers to their shared hub and confirming the rest of the estate is green; a flat
alert list does not.

## 8. Branch-WAN topology note

SynthBank's branches connect to the data centre in a hub-and-spoke arrangement:
branch routers (e.g. **Branch Router BR-014**) aggregate to regional hubs, which reach
the DC through **Core Router 1** behind **Firewall Edge 1**. A regional hub link is
therefore a shared dependency for its cluster of branches — and, as this incident
shows, a single-link hub is a resilience gap worth addressing `[verify]`. The DC core
(Core Router 1, Firewall Edge 1) was never implicated; the fault was upstream of the
branch routers on the carrier segment.

## 9. Lessons for the value/impact story

Branch-scoped outages need a *branch-scoped* impact figure: customers affected are the
customers homed to the ~8 affected branches (from the per-branch customer counts in the
business-parameters model), not the whole customer base. Reporting a bank-wide number
here would be the kind of inflated figure that loses a banker's trust — the honest
figure is scoped to the affected branches and the ~95-minute window.
