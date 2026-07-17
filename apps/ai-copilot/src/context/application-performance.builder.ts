// W6 Phase 2 (APM Tier-A, ADR-004) — builds the application_performance block by
// CONSUMING golden signals the provider exposes (consume-not-instrument, D16). It
// reads ONLY through the DataSourceProvider telemetry method — never the substrate
// directly — so swapping the backing (SynthBank substrate today, a live Zabbix API
// at W6.5) changes nothing here (the §9.3 switch property). No banking literal.

import type { DataSourceProvider } from '../datasource/data-source-provider.interface';
import type { ConfigurationItem, ApmSignalReading } from '../datasource/data-source.types';
import type { ApplicationPerformanceBlock, ApmCompleteness } from './application-performance.types';
import type { ContextGap } from './impact-graph.types';

export async function buildApplicationPerformance(
  provider: DataSourceProvider,
  primaryCi: ConfigurationItem,
  relatedCis: ConfigurationItem[],
  tenantId: string,
): Promise<ApplicationPerformanceBlock> {
  const source = { provider: provider.name, type: provider.type };

  // Capability-driven: a backing that can't serve Tier-A telemetry (a real
  // brownfield tenant pre-Zabbix) → the honest empty-state from 1fd63ce. No error.
  const caps = await provider.cmdbCapabilities(tenantId);
  // ADR-006 Tier-B capabilities (seed vs probe) — independent of Tier-A telemetry.
  const apmCapabilities = await provider.apmCapabilities(tenantId);
  if (!caps.hasGoldenSignals) {
    return {
      completeness: 'empty',
      signals: [],
      gaps: [
        { scope: 'application_performance', missingInput: 'tier_a_telemetry', degradedOutput: 'golden_signals_unavailable' },
      ],
      source,
      tierBSignals: [],
      apmCapabilities,
    };
  }

  // Scope = primary CI + its impact-set CIs, deduped, only those with an external id.
  const scope = dedupeByExternalId([primaryCi, ...relatedCis]);
  const externalIds = scope.map((c) => c.externalId).filter((x): x is string => !!x);
  const signals = await provider.getGoldenSignalsForCis(externalIds, tenantId);
  const got = new Set(signals.map((s) => s.ciExternalId));

  const gaps: ContextGap[] = [];
  for (const c of scope) {
    if (c.externalId && !got.has(c.externalId)) {
      gaps.push({ scope: `ci:${c.externalId}`, missingInput: 'tier_a_telemetry', degradedOutput: 'golden_signals_unavailable' });
    }
  }

  // §4 DR-posture: if the primary CI names a DR mirror, check that mirror's
  // telemetry. A DR mirror with no reachability → "DR posture unknown", never
  // fabricated. (CP6.4 also surfaces dr_coverage from the dr_mapping attribute.)
  const drName = typeof primaryCi.attributes?.['dr_mapping'] === 'string' ? (primaryCi.attributes['dr_mapping'] as string).trim() : '';
  if (drName) {
    const drCi = await provider.findConfigurationItem(drName, tenantId);
    if (drCi?.externalId) {
      const drSignals = await provider.getGoldenSignalsForCis([drCi.externalId], tenantId);
      if (drSignals.length === 0) {
        gaps.push({ scope: `ci:${drCi.externalId}`, missingInput: 'dr_mirror_telemetry', degradedOutput: 'dr_posture_unknown' });
      }
    }
  }

  const inScope = externalIds.length;
  const completeness: ApmCompleteness =
    signals.length === 0 ? 'empty' : signals.length < inScope ? 'partial' : 'present';

  // ADR-006 Tier-B: app-layer signals per in-scope CI (point-in-time). Absent
  // readings are skipped (honest) — probe-stub / un-seeded CIs contribute nothing,
  // never a fabricated number.
  const tierBSignals: ApmSignalReading[] = [];
  for (const c of scope) {
    if (!c.externalId) continue;
    const sp = await provider.getServicePerformance(c.externalId, tenantId);
    if (sp.completeness === 'present') tierBSignals.push(...sp.signals);
  }

  return { completeness, signals, gaps, source, tierBSignals, apmCapabilities };
}

function dedupeByExternalId(cis: ConfigurationItem[]): ConfigurationItem[] {
  const seen = new Set<string>();
  const out: ConfigurationItem[] = [];
  for (const c of cis) {
    const key = c.externalId ?? c.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
