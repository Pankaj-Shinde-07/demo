# Default Pack

Structural skeleton only — no industry-specific content. Used as a fallback
when a tenant's industry has no dedicated pack.

To create a new industry pack, copy this directory to `packs/{industry}/` and
populate the `*.yaml` files with industry-specific content. The `pack.yaml`
file is the manifest and must declare a matching `industry:` field.

Pack schema: `apps/ai-copilot/src/packs/pack.schema.ts`.
Architectural context: D9 in `docs/ai-copilot/AI_COPILOT_PLAN.md`.
