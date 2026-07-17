# Historical Incident RCA Archive — SynthBank Operations

> SYNTHETIC — SynthBank UCB (synthetic data). This is the bank's **historical
> incident record archive** (closed incidents with their root-cause analysis and
> resolution). It is a set of past records retrieved as knowledge — not a live
> observation. All incident ids, dates, and figures are illustrative.

This archive holds closed-incident RCAs so operators can check **"has this happened
before, and how was it resolved?"** Each entry is a prior, resolved incident.

---

## INC-2025-0731 — CBS DB connection-pool exhaustion during EOD

- **Date:** 2025-07-31 (closed 2025-08-01)
- **System:** Core Banking DB (primary node)
- **Symptom:** During the End-of-Day batch, CBS DB connection saturation rose to
  near-exhaustion; query latency climbed and the Internet Banking channel began
  timing out. Multiple alarms collapsed to one underlying fault.
- **Root cause:** A connection-pool / EOD batch-window tuning change applied the
  prior evening reduced available connections under EOD load; the pool exhausted
  as batch and online traffic overlapped.
- **Resolution:** Rolled back the connection-pool tuning change; re-ran the EOD
  batch from the pre-EOD snapshot per the CBS EOD restart runbook; re-opened
  customer channels only after control totals reconciled. Added a pre-EOD pool
  headroom check to the runbook.
- **Recurrence guard:** Connection-pool changes now require review against EOD peak
  before deployment.

## INC-2026-0118 — Sponsor-bank link flap (UPI/IMPS technical declines)

- **Date:** 2026-01-18 (closed 2026-01-19)
- **System:** Sponsor Bank Link A (UPI/IMPS sponsor rail)
- **Symptom:** Intermittent packet loss and elevated latency on the sponsor link;
  UPI/IMPS success rate dipped below the technical-decline watch level for ~40
  minutes. The UPI switch itself was healthy.
- **Root cause:** Upstream sponsor-link transport instability (carrier-side),
  surfacing as intermittent loss on the rail — not a switch or CBS fault.
- **Resolution:** Failed traffic over to the secondary sponsor path; raised a
  carrier ticket; success rate recovered once the primary link stabilised.
  Confirmed no settlement impact via the UPI reconciliation SOP.
- **Recurrence guard:** Added sponsor-link loss/latency to the proactive watch set;
  documented the failover step.

## INC-2025-1109 — Branch WAN degradation (single branch)

- **Date:** 2025-11-09 (closed 2025-11-09)
- **System:** Branch router (one standard branch)
- **Symptom:** One branch reported slow application access; WAN link saturated with
  high latency. Scope was a single branch, not the hub.
- **Root cause:** Last-mile link congestion at the branch.
- **Resolution:** Carrier escalation + temporary traffic shaping; link restored.
  Confirmed hub and other branches unaffected (branch-local fault).
