# UPI Reconciliation SOP

> SYNTHETIC FIXTURE — fabricated for Canaris AI Copilot W2 testing.

## 1. Purpose

This SOP describes the daily reconciliation of UPI/IMPS retail payment
transactions between the bank's switch, the sponsor bank, and NPCI. All
amounts, IDs, and timings here are fabricated.

## 2. Inputs

- Switch transaction log (UPI switch)
- Sponsor-bank settlement file
- NPCI raw data file

### 2.1 File Availability

Confirm all three inputs are available before starting. A missing sponsor-bank
settlement file blocks reconciliation and must be escalated.

## 3. Procedure

### 3.1 Match

Match each switch transaction against the NPCI raw data and the sponsor-bank
settlement on the transaction reference.

### 3.2 Investigate Exceptions

Unmatched or amount-mismatched entries are exceptions. Tag each exception with a
reason code and route to the payments operations queue.

## 4. Sign-off

Reconciliation is signed off only when all exceptions are resolved or formally
carried forward. Record the outcome in the operations log.
