# Runbook — Hung Service Restart & Disk-Full Cleanup

> SYNTHETIC — SynthBank UCB (synthetic data). Illustrative procedure; paths,
> thresholds and service names are examples.

## Scope

Two common operational fixes: (a) a hung/unresponsive service, (b) a filesystem
filling toward 100%. Both are **propose-and-assist** actions: the Copilot explains
the procedure and assesses safety; **a human operator executes and attests.** No
action here is performed autonomously by the tool.

## A. Hung / unresponsive service

1. **Confirm it is actually hung** — health endpoint not responding, no log
   progress, connections stacking. Distinguish "hung" from "busy under load."
2. **Assess blast radius BEFORE restarting.** Is the CI tier-1? Is it mid-batch
   (e.g. CBS during EOD)? What depends on it? **Restarting a tier-1 service
   mid-transaction can corrupt in-flight work.**
3. **Human approval gate.** For any tier-1 or customer-facing service, obtain the
   shift-lead's approval and follow change control before restarting. Routine
   restart of a non-critical, non-mid-batch service may proceed per standing
   authorisation.
4. **Restart** via the service manager; watch health + dependents recover.
5. **Record** the action, approver, and outcome in the operations log.

## B. Disk filling / full

1. **Identify the largest consumers** (logs, temp, old backups, core dumps).
2. **Safe-to-clear first:** rotated/compressed logs past retention, temp files,
   stale cores. **Never delete** active data, the live DB, or current backups.
3. **Human approval gate** before deleting anything whose purpose is unclear, or
   anything on a tier-1 host. If the fill is the application's own data growing,
   this is a capacity issue — escalate, do not delete data to buy space.
4. **Clear**, verify free space recovered, confirm the service is healthy.
5. **Record** what was cleared and the space recovered.

## Safety summary (the answer to "can it be done safely?")

Yes — *with a human in the loop.* The Copilot will surface the symptom, retrieve
this fix, and assess whether the specific CI is safe to act on (tier, mid-batch,
dependents). It **proposes**; it does **not** auto-execute. Risky actions on
tier-1 or customer-facing systems require explicit human approval and change
control before execution.
