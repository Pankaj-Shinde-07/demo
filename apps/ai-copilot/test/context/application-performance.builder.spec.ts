import { buildApplicationPerformance } from '../../src/context/application-performance.builder';
import type { DataSourceProvider, CmdbCapabilities } from '../../src/datasource/data-source-provider.interface';
import type { ConfigurationItem, GoldenSignal } from '../../src/datasource/data-source.types';

/**
 * §9.3 switch-cleanliness (telemetry axis) + APM behaviour. The APM block reads
 * golden signals ONLY through the DataSourceProvider interface — so swapping the
 * backing flips APM between populated and honest empty-state with NO engine
 * change. The two stubs below ARE that swap.
 */

function ci(externalId: string, attrs: Record<string, unknown> = {}): ConfigurationItem {
  return {
    id: `id-${externalId}`,
    externalId,
    ciType: 'node',
    name: externalId,
    description: null,
    criticalityTier: 'tier-1',
    technicalOwner: null,
    businessOwner: null,
    operationsTeam: null,
    linkedAssetRef: null,
    attributes: attrs,
    source: 'stub',
  };
}

function signal(externalId: string): GoldenSignal {
  return {
    ciExternalId: externalId,
    ciName: externalId,
    availabilityState: 'up',
    cpuSaturationPct: 30,
    memorySaturationPct: 40,
    primarySaturationPct: null,
    primaryMetric: null,
    latencyMs: 10,
    packetLossPct: null,
    lastReadingAt: '2026-06-09T00:00:00.000Z',
  };
}

const CAPS_BASE: CmdbCapabilities = {
  hasConfigurationItems: true,
  hasRelationshipGraph: true,
  hasBusinessServices: true,
  hasChangeLinkage: true,
  hasOwnership: true,
  hasCriticality: true,
  hasGoldenSignals: false,
};

/** A backing with NO telemetry (a real brownfield tenant pre-Zabbix). */
function telemetryAbsentProvider(): DataSourceProvider {
  return {
    name: 'stub_absent',
    type: 'native',
    async cmdbCapabilities() {
      return { ...CAPS_BASE, hasGoldenSignals: false };
    },
    async getGoldenSignalsForCis() {
      return [];
    },
    async findConfigurationItem() {
      return null;
    },
  } as unknown as DataSourceProvider;
}

/** A backing that DOES serve telemetry (SynthBank substrate, or live Zabbix). */
function telemetryPresentProvider(map: Record<string, GoldenSignal>): DataSourceProvider {
  return {
    name: 'stub_present',
    type: 'native',
    async cmdbCapabilities() {
      return { ...CAPS_BASE, hasGoldenSignals: true };
    },
    async getGoldenSignalsForCis(ids: string[]) {
      return ids.map((i) => map[i]).filter(Boolean);
    },
    async findConfigurationItem(ref: string) {
      // resolve a DR mirror by name for the dr_posture check
      return ref === 'DR Mirror' ? ci('CI-DR') : null;
    },
  } as unknown as DataSourceProvider;
}

describe('APM Tier-A builder (§9.3 switch-cleanliness)', () => {
  it('falls to honest empty-state when the backing serves no telemetry (no engine change)', async () => {
    const block = await buildApplicationPerformance(telemetryAbsentProvider(), ci('CI-1'), [], 't1');
    expect(block.completeness).toBe('empty');
    expect(block.signals).toHaveLength(0);
    expect(block.gaps).toContainEqual({
      scope: 'application_performance',
      missingInput: 'tier_a_telemetry',
      degradedOutput: 'golden_signals_unavailable',
    });
  });

  it('populates Class-1 signals when the SAME call hits a telemetry-serving backing', async () => {
    const provider = telemetryPresentProvider({ 'CI-1': signal('CI-1'), 'CI-2': signal('CI-2') });
    const block = await buildApplicationPerformance(provider, ci('CI-1'), [ci('CI-2')], 't1');
    expect(block.completeness).toBe('present');
    expect(block.signals.map((s) => s.ciExternalId).sort()).toEqual(['CI-1', 'CI-2']);
  });

  it('marks partial when only some in-scope CIs have readings', async () => {
    const provider = telemetryPresentProvider({ 'CI-1': signal('CI-1') });
    const block = await buildApplicationPerformance(provider, ci('CI-1'), [ci('CI-2')], 't1');
    expect(block.completeness).toBe('partial');
    expect(block.gaps).toContainEqual({
      scope: 'ci:CI-2',
      missingInput: 'tier_a_telemetry',
      degradedOutput: 'golden_signals_unavailable',
    });
  });

  it('surfaces dr_posture_unknown when a named DR mirror has no telemetry', async () => {
    const provider = telemetryPresentProvider({ 'CI-1': signal('CI-1') }); // CI-DR absent
    const block = await buildApplicationPerformance(provider, ci('CI-1', { dr_mapping: 'DR Mirror' }), [], 't1');
    expect(block.gaps).toContainEqual({
      scope: 'ci:CI-DR',
      missingInput: 'dr_mirror_telemetry',
      degradedOutput: 'dr_posture_unknown',
    });
  });
});
