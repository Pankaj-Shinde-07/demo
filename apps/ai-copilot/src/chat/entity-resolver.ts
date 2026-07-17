import type { DataSourceProvider } from '../datasource/data-source-provider.interface';

/**
 * W7 — resolve the CI a grounded-context question is about, from free text. A
 * "branch N" phrasing maps to that branch CI; otherwise the longest CI name that
 * appears in the message wins (deterministic). Returns null if nothing resolves —
 * the orchestrator then asks a clarifying question rather than guessing.
 */
export async function resolveContextEntity(
  provider: DataSourceProvider,
  message: string,
  tenantId: string,
): Promise<string | null> {
  // "branch 23" → "Branch Router BR-023"
  const branch = message.match(/\bbranch\s+0*(\d{1,3})\b/i);
  if (branch) {
    const n = branch[1].padStart(3, '0');
    const ref = `Branch Router BR-${n}`;
    const ci = await provider.findConfigurationItem(ref, tenantId);
    if (ci) return ci.externalId ?? ref;
  }

  // Longest CI name contained in the message (case-insensitive).
  const cis = await provider.searchConfigurationItems({ limit: 500 }, tenantId);
  const lower = message.toLowerCase();
  let best: { ref: string; len: number } | null = null;
  for (const ci of cis) {
    if (ci.name && lower.includes(ci.name.toLowerCase())) {
      if (!best || ci.name.length > best.len) best = { ref: ci.externalId ?? ci.name, len: ci.name.length };
    }
  }
  return best?.ref ?? null;
}
