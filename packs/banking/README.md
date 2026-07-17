# Banking Pack — Urban Co-operative Banks (UCBs)

First-cut industry pack for the co-op-bank beachhead (ADR-003). Holds all
vertical-specific content for UCBs; the ingestion/engine code stays
vertical-agnostic and references this pack by `tenant.industry = banking`.

Seeded in W2:
- `sop-categories.yaml` — co-op SOP categories used for the document
  categorization hint (CBS EOD, UPI reconciliation, ATM cash management, DR
  failover, RBI reporting, security incident).
- `cmdb-mappings.yaml` — co-op CMDB shape incl. the co-op-specific
  `sponsor_bank_link` / `npci_link` CI types and tier-1 business services.
- `glossary.yaml` — co-op domain terms.

Grown later: `severity-rules.yaml`, `prompt-fragments/`, `dashboard-templates/`.

Regulatory specifics in `cmdb-mappings.yaml` are marked **verify** until
confirmed against current RBI circulars — never shipped as asserted fact.

Pack schema: `apps/ai-copilot/src/packs/pack.schema.ts`.
