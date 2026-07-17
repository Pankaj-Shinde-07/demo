import { DataSourceRegistry } from '../../src/datasource/data-source.registry';
import { ConfigCryptoService } from '../../src/common/config-crypto.service';
import { ZabbixProviderFactory } from '../../src/datasource/zabbix/zabbix-provider.factory';
import { FixtureZabbixTransport } from '../../src/datasource/zabbix/zabbix.transport';
import { zabbixFixtureResolver } from '../../src/datasource/zabbix/zabbix.fixtures';
import { CompositeDataSourceProvider } from '../../src/datasource/composite-data-source.provider';
import { buildApplicationPerformance } from '../../src/context/application-performance.builder';
import type { DataSourceProvider } from '../../src/datasource/data-source-provider.interface';
import type { ConfigurationItem, GoldenSignal } from '../../src/datasource/data-source.types';

/**
 * CP6.5.4 — the switch, proven with a REAL second backing (fixtures): the
 * registry composes a native CMDB backing with the Zabbix monitoring backing;
 * telemetry routes to Zabbix; flipping the config changes only where signals come
 * from; and the FROZEN APM builder (src/context) lights up from Zabbix unchanged.
 */

const KEY = Buffer.alloc(32, 7).toString('base64');
const crypto = new ConfigCryptoService({ get: (k: string, d: unknown) => (k === 'CONFIG_ENCRYPTION_KEY' ? KEY : d) } as any);

function fixtureFactory(): ZabbixProviderFactory {
  const f = new ZabbixProviderFactory();
  jest.spyOn(f, 'create').mockImplementation((cfg) => f.createWith(cfg, new FixtureZabbixTransport(zabbixFixtureResolver)));
  return f;
}

// canaris substrate stub — returns a DELIBERATELY different cpu (99) so we can
// tell which backing served the telemetry.
function canarisStub(): DataSourceProvider {
  return {
    name: 'canaris_ems',
    type: 'native',
    async cmdbCapabilities() {
      return { hasConfigurationItems: true, hasRelationshipGraph: true, hasBusinessServices: true, hasChangeLinkage: true, hasOwnership: true, hasCriticality: true, hasGoldenSignals: true };
    },
    async getGoldenSignalsForCis(ids: string[]): Promise<GoldenSignal[]> {
      return ids.map((ciExternalId) => ({ ciExternalId, ciName: 'substrate', availabilityState: 'up', cpuSaturationPct: 99, memorySaturationPct: 99, primarySaturationPct: 99, primaryMetric: 'disk', latencyMs: null, packetLossPct: null, lastReadingAt: '2026-06-09T00:00:00.000Z' }));
    },
    async findConfigurationItem() {
      return null;
    },
  } as unknown as DataSourceProvider;
}

function registryWith(rows: any[]): DataSourceRegistry {
  const db = { query: async () => rows } as any;
  return new DataSourceRegistry(db, canarisStub(), crypto, fixtureFactory());
}

const ZBX_ROW = () => ({
  provider_name: 'zabbix',
  provider_type: 'monitoring',
  config_encrypted: crypto.encryptJson({ endpoint: 'http://fixture/api_jsonrpc.php', token: 'dummy', matchKey: 'hostname' }),
  enabled: true,
});
const CANARIS_ROW = { provider_name: 'canaris_ems', provider_type: 'native', config_encrypted: null, enabled: true };

function ci(externalId: string): ConfigurationItem {
  return { id: `id-${externalId}`, externalId, ciType: 'cbs_database_server', name: externalId, description: null, criticalityTier: 'tier-1', technicalOwner: null, businessOwner: null, operationsTeam: null, linkedAssetRef: null, attributes: {}, source: 'test' };
}

describe('CP6.5.4 — switch with a real second backing', () => {
  it('config crypto round-trips the per-tenant Zabbix config', () => {
    const blob = crypto.encryptJson({ endpoint: 'e', token: 'secret-token', matchKey: 'hostname' });
    expect(blob.startsWith('v1:')).toBe(true);
    expect(blob.includes('secret-token')).toBe(false); // not plaintext
    expect(crypto.decryptJson<any>(blob).token).toBe('secret-token');
  });

  it('registry composes canaris(CMDB) + zabbix(telemetry); telemetry routes to Zabbix', async () => {
    const reg = registryWith([CANARIS_ROW, ZBX_ROW()]);
    const provider = await reg.getCmdbProvider('t1');
    expect(provider).toBeInstanceOf(CompositeDataSourceProvider);
    const [sig] = await provider!.getGoldenSignalsForCis(['CI-0002'], 't1');
    expect(sig.cpuSaturationPct).toBe(72); // Zabbix fixture, NOT the substrate stub's 99
  });

  it('flipping off Zabbix returns the substrate backing (the switch)', async () => {
    const reg = registryWith([CANARIS_ROW]); // zabbix disabled/removed
    const provider = await reg.getCmdbProvider('t1');
    expect(provider).not.toBeInstanceOf(CompositeDataSourceProvider);
    const [sig] = await provider!.getGoldenSignalsForCis(['CI-0002'], 't1');
    expect(sig.cpuSaturationPct).toBe(99); // substrate stub
  });

  it('the FROZEN APM builder lights up Class-1 from the Zabbix backing (no engine change)', async () => {
    const reg = registryWith([CANARIS_ROW, ZBX_ROW()]);
    const provider = await reg.getCmdbProvider('t1');
    const apm = await buildApplicationPerformance(provider!, ci('CI-0002'), [], 't1');
    expect(apm.completeness).toBe('present');
    expect(apm.signals[0].cpuSaturationPct).toBe(72); // from Zabbix, through the unchanged builder
  });

  it('an unmatched CI surfaces as a named APM gap (zero host match)', async () => {
    const reg = registryWith([CANARIS_ROW, ZBX_ROW()]);
    const provider = await reg.getCmdbProvider('t1');
    const apm = await buildApplicationPerformance(provider!, ci('CI-ZERO'), [], 't1');
    expect(apm.completeness).toBe('empty');
    expect(apm.gaps.some((g) => g.degradedOutput === 'golden_signals_unavailable')).toBe(true);
  });
});
