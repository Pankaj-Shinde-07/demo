# DR Restore-Test SOP — Backup Recovery Verification

> SYNTHETIC — SynthBank UCB (synthetic data). Procedure content only; all names,
> systems and intervals are illustrative. RBI BCP specifics are `[verify]` against
> the current circular — no circular number is asserted here.

## 1. Purpose

This SOP defines how SynthBank verifies that backups are **recoverable**, not just
that they ran. A completed backup is not evidence of recoverability — only a
successful restore test is. This procedure is the restore-test itself; the
**record** of when it was last performed is held in the BCP/DR test register
(operational record, maintained separately).

## 2. Scope

Tier-1 systems: Core Banking DB (CBS DB) and its DR mirror, the UPI/IMPS switch,
NEFT/RTGS, and the document/image store. Tier-1 systems are tested on the cadence
the BCP mandates `[verify]`.

## 3. Procedure

1. **Select the restore target.** Choose the most recent backup set for the system
   under test (e.g. the CBS DB nightly snapshot). Record the backup set id.
2. **Provision an isolated restore environment.** Never restore over production.
   Use the DR node or a sandbox; confirm network isolation before proceeding.
3. **Restore from backup.** Run the vendor restore procedure end-to-end. Capture
   start/end timestamps and any warnings.
4. **Verify integrity.** Validate control totals / row counts against the source
   as of the backup point; confirm the application starts and a read-only smoke
   transaction succeeds.
5. **Record the result** in the BCP/DR test register: system, backup set id,
   restore duration, pass/fail, operator, and date. This register is the evidence
   an auditor will request.
6. **Tear down** the restore environment; confirm no production exposure.

## 4. RPO / RTO

Validate that the achieved restore time meets the system's RTO and that data loss
is within RPO `[verify: confirm the tier-1 RPO/RTO targets against the current BCP]`.

## 5. Honesty note (what this SOP is and is not)

This document is the **procedure**. The **last successful restore-test date** for a
given system is an operational record in the DR test register; if that record is
not available to the tool, the honest answer is that the procedure is known but the
last-test date cannot be evidenced here — it must be confirmed from the register.
