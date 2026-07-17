# RCA-2 — CBS EOD Batch Overrun Causing Internet-Banking Timeouts — SynthBank Co-operative Bank

> **SYNTHETIC FIXTURE** — fabricated incident write-up for Canaris AI Copilot
> SynthBank P1. Fictional UCB; fabricated dates, times, figures, all `[verify]`.
> This RCA is the canonical **recent-change-is-the-smoking-gun** archetype: a config
> change the prior evening is the root cause. It is the doc W8 RCA must retrieve when
> asked "what changed before the EOD overrun."

- **Incident ID:** INC-SB-2026-0388
- **Severity:** P2
- **Business services affected:** core_banking (and internet-banking access to it)
- **Primary CIs:** CBS DB Node 1 (`cbs_database_server`), CBS App Node 1
  (`cbs_application_server`)
- **Duration:** EOD batch overran by ~2h10m `[verify]`; internet-banking degraded
  through the overrun window.

## 1. Summary

The CBS end-of-day (EOD) batch ran far longer than its normal window. While the batch
held locks on **CBS DB Node 1**, internet-banking requests that read core_banking
timed out for customers. The trigger was **a configuration change applied the
previous evening** during a routine maintenance window — the single most important
fact of this incident, and the one a generic tool would miss.

## 2. Timeline `[verify]`

- **Prior evening, 21:30** — A maintenance window applied a change to the CBS batch
  configuration on CBS DB Node 1: a parallel-worker/connection-pool parameter was
  reduced as part of an unrelated tuning effort. Recorded in the change log as a
  low-risk change. **This is the smoking gun.**
- **23:50** — Nightly EOD batch starts as scheduled.
- **00:40** — Batch progress tracking behind expected; interest/GL posting stage
  running slower than baseline.
- **01:20** — Lock contention on CBS DB Node 1 rising; internet-banking read latency
  climbing.
- **02:05** — Internet-banking timeouts reported by early users; incident opened.
- **03:10** — On-call correlates batch slowness to the prior-evening parameter
  change; the reduced worker/pool setting serialized batch stages that normally run
  with more parallelism.
- **04:00** — Batch completes (overrun ~2h10m). Internet-banking recovers as locks
  release.
- **Next morning** — Change reverted; batch timing returns to baseline on the
  following run.

## 3. Root cause

The prior-evening configuration change to the CBS batch parallelism/pool parameter on
**CBS DB Node 1** reduced batch throughput, extending lock-hold duration during the
posting stage. The extended locks starved internet-banking reads of core_banking,
producing customer-visible timeouts. The change had been assessed as low-risk because
its batch-timing impact was not modeled.

## 4. Recent-change linkage (the key signal)

This incident is defined by its recent change. The corrective insight is procedural:
**any change to CBS batch configuration must be evaluated against the EOD batch
window, not just steady-state OLTP load.** An RCA that did not consider the prior
evening's change record would have chased the symptom (internet-banking timeouts) and
missed the cause (a batch-config change made hours earlier). This is exactly why W8
RCA weights recent_changes first.

## 5. Impact

Internet-banking access to core_banking degraded for roughly the overrun window
during overnight/early-morning hours, limiting affected customer count `[verify]`.
EOD completion was delayed, compressing the start-of-day readiness for downstream
services. No data loss; postings completed correctly once the batch finished.

## 6. Corrective and preventive actions

1. Revert the parameter; restore the prior batch parallelism on CBS DB Node 1.
2. Add EOD-batch-window impact to the change-assessment checklist for any CBS DB/batch
   change.
3. Add batch-progress alerting that fires when a stage falls behind its baseline,
   well before lock contention reaches internet-banking.
4. Stagger heavy maintenance changes away from EOD-eve where batch-timing risk exists.

## 7. The change record in detail

The prior-evening change is the heart of this RCA, so it is worth stating precisely
what was changed and why it was mis-assessed:

- **What:** a batch-related parallelism / connection-pool parameter on **CBS DB
  Node 1** was reduced during a 21:30 maintenance window, as part of an unrelated
  effort to reduce steady-state connection pressure.
- **Risk rating at the time:** low. The change was reviewed for its effect on daytime
  OLTP load, where reducing the pool was benign — and approved on that basis.
- **What was missed:** the same parameter governs how many batch stages run in
  parallel during EOD. Reducing it serialized work that normally overlaps, extending
  the posting stage and its lock-hold window.
- **The detection gap:** there was no batch-progress alert tied to a per-stage
  baseline, so the overrun was only noticed when customers hit internet-banking
  timeouts at 02:05 — long after the 23:50 batch start where the slowdown began.

## 8. Why recent-change weighting matters

An RCA that started from the symptom (internet-banking timeouts) and worked outward
would have looked at CBS DB Node 1 load, lock contention, and the EOD batch — and might
have concluded "the batch was slow" without finding *why*. The cause was a change made
**four and a half hours before the batch even started**. Only by surfacing the recent
change log for CBS DB Node 1 and asking "what changed before this?" does the parameter
edit become the obvious root cause. This is the exact behaviour the RCA assistant must
exhibit: weight recent changes to the affected CIs first, especially low-risk-rated
changes whose blast radius was assessed against the wrong workload.

## 9. Lessons for the value/impact story

The overrun gives a bounded duration (~2h10m) on core_banking access via internet
banking, overnight. The customers-affected figure for this window comes from the
business-parameters customer-count data scoped to the internet-banking channel; the
operating-cost-of-incident comes from the cost-of-downtime model. As with the
sponsor-link flap, the incident supplies the timeline and the model supplies the worth.
