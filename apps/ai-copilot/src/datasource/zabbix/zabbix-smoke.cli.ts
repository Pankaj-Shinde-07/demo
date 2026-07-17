/**
 * W6.5 (CP6.5.5) — Zabbix smoke-test CLI.
 *
 *   FIXTURE DEMO (used for the gate doc, no live Zabbix):
 *     npm run zabbix:smoke -- --fixture
 *
 *   DEFERRED LIVE FIELD STEP (turns switch-proven-against-contract into
 *   switch-proven-live — run against a real Zabbix during onboarding):
 *     npm run zabbix:smoke -- --url=<https://zbx/api_jsonrpc.php> --token=<API_TOKEN> \
 *                            --ci=<CI-EXTERNAL-ID> [--match=hostname|ip|custom]
 *
 * Runs apiinfo.version + a read-only host.get/item.get and prints the mapped
 * golden signals. Read-only / consume-not-instrument — never writes Zabbix.
 */
import { ZabbixProviderFactory } from './zabbix-provider.factory';
import { FixtureZabbixTransport, HttpZabbixTransport } from './zabbix.transport';
import { zabbixFixtureResolver } from './zabbix.fixtures';
import { ZabbixJsonRpcClient } from './zabbix-jsonrpc.client';
import type { ZabbixConfig, ZabbixMatchKey } from './zabbix.types';

function arg(name: string, fallback = ''): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const has = (flag: string) => process.argv.slice(2).includes(`--${flag}`);
const j = (o: unknown) => JSON.stringify(o, null, 2);

async function main(): Promise<void> {
  const factory = new ZabbixProviderFactory();
  const fixture = has('fixture');

  if (fixture) {
    const transport = new FixtureZabbixTransport(zabbixFixtureResolver);
    const config: ZabbixConfig = { endpoint: 'fixture', token: 'dummy', matchKey: 'hostname' };
    const client = new ZabbixJsonRpcClient(transport, null);
    const provider = factory.createWith(config, transport);
    const version = await client.apiVersion();
    const signals = await provider.getGoldenSignalsForCis(['CI-0002', 'CI-0005'], 'fixture-tenant');
    const zeroMatch = await provider.getGoldenSignalsForCis(['CI-ZERO'], 'fixture-tenant');
    const ambiguous = await provider.getGoldenSignalsForCis(['CI-AMBIG'], 'fixture-tenant');
    // eslint-disable-next-line no-console
    console.log(j({
      mode: 'fixture',
      apiVersion: version,
      mappedSignals: signals,
      named_gaps: {
        zero_match_CI_ZERO: zeroMatch.length === 0 ? 'omitted → APM names golden_signals_unavailable' : 'UNEXPECTED',
        ambiguous_CI_AMBIG: ambiguous.length === 0 ? 'omitted → APM names golden_signals_unavailable (never guessed)' : 'UNEXPECTED',
      },
    }));
    return;
  }

  const url = arg('url');
  const token = arg('token');
  const ci = arg('ci');
  const match = (arg('match', 'hostname') as ZabbixMatchKey) || 'hostname';
  if (!url || !token || !ci) {
    // eslint-disable-next-line no-console
    console.error('live mode requires --url, --token, --ci (and optional --match). Or use --fixture.');
    process.exit(2);
  }
  const config: ZabbixConfig = { endpoint: url, token, matchKey: match };
  const transport = new HttpZabbixTransport(url);
  const provider = factory.createWith(config, transport); // real HTTP transport
  const client = new ZabbixJsonRpcClient(transport, null); // version handshake (no auth)
  try {
    const version = await client.apiVersion();
    const signals = await provider.getGoldenSignalsForCis([ci], 'live');
    // eslint-disable-next-line no-console
    console.log(j({ mode: 'live', url, apiVersion: version, match, ci, mappedSignals: signals }));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('live smoke failed:', (err as Error).message);
    process.exit(1);
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
