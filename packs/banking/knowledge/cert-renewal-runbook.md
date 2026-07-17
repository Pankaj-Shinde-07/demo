# Runbook — SSL/TLS Certificate Renewal & Rotation

> SYNTHETIC — SynthBank UCB (synthetic data). Illustrative procedure; hostnames,
> CAs and intervals are examples.

## Scope

Renew or rotate an expiring SSL/TLS certificate on a service endpoint (internet
banking, UPI/API gateway, internal service mesh). **Propose-and-assist:** the
Copilot retrieves this procedure and the cert/CMDB context; **a human performs the
rotation.** A botched rotation on a tier-1, customer-facing endpoint causes an
outage, so this is never an autonomous action.

## Procedure

1. **Confirm the expiring cert** — host, SAN list, issuer, expiry date, and the
   tier of the service it fronts (from the CMDB).
2. **Generate a new key pair + CSR** on the target host (or use the existing key
   only if policy permits key reuse).
3. **Obtain the signed certificate** from the approved CA; verify the chain and SANs
   match the endpoint's hostnames.
4. **Stage the new cert** alongside the current one — do not overwrite yet.
5. **Change-control gate (human approval).** For any tier-1 / customer-facing
   endpoint, schedule the rotation in a change window with shift-lead approval.
6. **Install + reload** the service to pick up the new cert (graceful reload where
   supported; avoid a hard restart mid-transaction on CBS-adjacent services).
7. **Verify** from outside: the served cert is the new one, chain valid, expiry
   extended, no handshake errors. Check dependent services and clients.
8. **Roll back** to the staged previous cert immediately if verification fails.
9. **Record** the rotation, approver, and new expiry; update the cert inventory.

## "Walk me through it (or do it)?"

The Copilot walks you through the steps above and surfaces the cert/CMDB context.
It does **not** execute the rotation itself — installation and the service reload
are human actions under change control, especially on tier-1 endpoints.
