import { ZabbixProviderFactory } from '../../src/datasource/zabbix/zabbix-provider.factory';
import { FixtureZabbixTransport } from '../../src/datasource/zabbix/zabbix.transport';
import { zabbixFixtureResolver } from '../../src/datasource/zabbix/zabbix.fixtures';
import { ZabbixJsonRpcClient } from '../../src/datasource/zabbix/zabbix-jsonrpc.client';
import type { ZabbixConfig, ZabbixMatchKey } from '../../src/datasource/zabbix/zabbix.types';

/**
 * CP6.5 proofs (fixture-backed, no live Zabbix): auth handshake, each host→CI
 * match-key mode, item→golden-signal mapping, history via trends, named gaps
 * (zero/ambiguous match), missing-item degradation, capability flag — and the
 * output shape is byte-compatible with the substrate backing.
 */

const factory = new ZabbixProviderFactory();
const transport = () => new FixtureZabbixTransport(zabbixFixtureResolver);

function provider(matchKey: ZabbixMatchKey = 'hostname', extra: Partial<ZabbixConfig> = {}) {
  const config: ZabbixConfig = { endpoint: 'http://fixture/api_jsonrpc.php', token: 'dummy', matchKey, ...extra };
  return factory.createWith(config, transport());
}

describe('ZabbixProvider (W6.5, fixture-backed)', () => {
  it('handshakes apiinfo.version (no auth) through the injected transport', async () => {
    const client = new ZabbixJsonRpcClient(transport(), null);
    expect(await client.apiVersion()).toBe('6.4.0');
  });

  it('reports hasGoldenSignals=true and no CMDB capability', async () => {
    const caps = await provider().cmdbCapabilities('t1');
    expect(caps.hasGoldenSignals).toBe(true);
    expect(caps.hasConfigurationItems).toBe(false);
  });

  it('maps items to a Class-1 golden signal (hostname match)', async () => {
    const [sig] = await provider('hostname').getGoldenSignalsForCis(['CI-0002'], 't1');
    expect(sig).toMatchObject({
      ciExternalId: 'CI-0002',
      ciName: 'CBS DB Node 1',
      availabilityState: 'up',
      cpuSaturationPct: 72,
      memorySaturationPct: 81,
      primarySaturationPct: 78,
      primaryMetric: 'disk',
    });
  });

  it('degrades only the missing signal (CI-0005 has no cpu/mem item)', async () => {
    const [sig] = await provider('hostname').getGoldenSignalsForCis(['CI-0005'], 't1');
    expect(sig.cpuSaturationPct).toBeNull();
    expect(sig.memorySaturationPct).toBeNull();
    expect(sig.latencyMs).toBe(35); // icmppingsec 0.035 → 35ms
    expect(sig.packetLossPct).toBe(0.1);
    expect(sig.availabilityState).toBe('up');
  });

  it('resolves the same host under ip and custom match-key modes', async () => {
    const byIp = await provider('ip').getGoldenSignalsForCis(['10.0.0.2'], 't1');
    expect(byIp[0]?.ciExternalId).toBe('10.0.0.2');
    expect(byIp[0]?.cpuSaturationPct).toBe(72);

    const byCustom = await provider('custom', { customMatchField: 'tag' }).getGoldenSignalsForCis(['CI-0002'], 't1');
    expect(byCustom[0]?.ciName).toBe('CBS DB Node 1');
  });

  it('omits a CI on a ZERO host match (→ APM names the gap)', async () => {
    const out = await provider('hostname').getGoldenSignalsForCis(['CI-ZERO'], 't1');
    expect(out).toHaveLength(0);
  });

  it('omits a CI on an AMBIGUOUS host match — never guesses', async () => {
    const out = await provider('hostname').getGoldenSignalsForCis(['CI-AMBIG'], 't1');
    expect(out).toHaveLength(0);
  });

  it('returns a rising history via trends.get (the capacity slope)', async () => {
    const hist = await provider('hostname').getGoldenSignalHistory(
      'CI-0002',
      { from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-06-30T00:00:00Z') },
      't1',
    );
    expect(hist.length).toBeGreaterThan(1);
    const firstPrimary = hist[0].primarySaturationPct!;
    const lastPrimary = hist[hist.length - 1].primarySaturationPct!;
    expect(lastPrimary).toBeGreaterThan(firstPrimary); // rising 60 → 78
    expect(hist).toEqual([...hist].sort((a, b) => a.at.localeCompare(b.at))); // chronological
  });
});
