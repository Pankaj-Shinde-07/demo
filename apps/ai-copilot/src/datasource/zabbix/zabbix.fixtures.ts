// W6.5 (CP6.5.5) — recorded JSON-RPC responses authored from the documented
// Zabbix 6.x API contract, exposed as a transport resolver. Enough to exercise
// auth handshake, each host→CI match-key mode, item→signal mapping, history via
// trends, and the zero/ambiguous-match named gaps — all without a live Zabbix.
// The deferred live smoke-test (zabbix:smoke against a real instance) is the
// step that turns "switch-proven against contract" into "switch-proven live".

import type { ZabbixHost, ZabbixItem, ZabbixTrend } from './zabbix.types';

const HOSTS: Record<string, ZabbixHost> = {
  '10002': { hostid: '10002', host: 'CI-0002', name: 'CBS DB Node 1', interfaces: [{ ip: '10.0.0.2', type: '1' }], inventory: { tag: 'CI-0002' } },
  '10005': { hostid: '10005', host: 'CI-0005', name: 'Sponsor Bank Link A', interfaces: [{ ip: '10.0.0.5', type: '1' }], inventory: { tag: 'CI-0005' } },
  // two hosts that both claim CI-AMBIG (ambiguous match → named gap)
  '10090': { hostid: '10090', host: 'CI-AMBIG', name: 'Ambiguous A', interfaces: [{ ip: '10.0.9.1', type: '1' }] },
  '10091': { hostid: '10091', host: 'CI-AMBIG', name: 'Ambiguous B', interfaces: [{ ip: '10.0.9.2', type: '1' }] },
};

const ITEMS: Record<string, ZabbixItem[]> = {
  // CBS DB: cpu/mem/disk%used + ping up
  '10002': [
    { itemid: '20021', hostid: '10002', key_: 'system.cpu.util', name: 'CPU utilisation', lastvalue: '72', units: '%' },
    { itemid: '20022', hostid: '10002', key_: 'vm.memory.utilization', name: 'Memory utilisation', lastvalue: '81', units: '%' },
    { itemid: '20023', hostid: '10002', key_: 'vfs.fs.size[/,pused]', name: 'Disk used', lastvalue: '78', units: '%' },
    { itemid: '20024', hostid: '10002', key_: 'icmpping', name: 'ICMP ping', lastvalue: '1' },
  ],
  // Sponsor link: latency + loss + up (no cpu/mem item → those degrade to null)
  '10005': [
    { itemid: '20051', hostid: '10005', key_: 'icmppingsec', name: 'ICMP response time', lastvalue: '0.035', units: 's' },
    { itemid: '20052', hostid: '10005', key_: 'icmppingloss', name: 'ICMP loss', lastvalue: '0.1', units: '%' },
    { itemid: '20053', hostid: '10005', key_: 'icmpping', name: 'ICMP ping', lastvalue: '1' },
  ],
};

// 24 hourly trend points for CBS-DB (cpu 60→72, mem 70→81, disk 60→78).
const TREND_BASE_MS = Date.parse('2026-06-09T00:00:00.000Z');
function trendSeries(itemid: string, from: number, to: number): ZabbixTrend[] {
  const points = 24;
  const out: ZabbixTrend[] = [];
  for (let i = 0; i < points; i++) {
    const clock = Math.floor((TREND_BASE_MS - (points - 1 - i) * 3_600_000) / 1000);
    if (clock < from || clock > to) continue;
    const t = i / (points - 1);
    const v = itemid === '20021' ? 60 + 12 * t : itemid === '20022' ? 70 + 11 * t : 60 + 18 * t;
    out.push({ itemid, clock: String(clock), value_avg: (Math.round(v * 10) / 10).toString(), value_max: (Math.round(v * 10) / 10 + 2).toString(), num: '60' });
  }
  return out;
}

/** The transport resolver used by FixtureZabbixTransport in tests + smoke demo. */
export function zabbixFixtureResolver(method: string, params: unknown): unknown {
  const p = (params ?? {}) as Record<string, any>;
  switch (method) {
    case 'apiinfo.version':
      return '6.4.0';
    case 'host.get': {
      const filterHost: string[] | undefined = p.filter?.host;
      const filterIp: string[] | undefined = p.filter?.ip;
      const search: Record<string, string> | undefined = p.search;
      let matches: ZabbixHost[] = [];
      if (filterHost) {
        matches = Object.values(HOSTS).filter((h) => filterHost.includes(h.host));
      } else if (filterIp) {
        matches = Object.values(HOSTS).filter((h) => h.interfaces?.some((i) => filterIp.includes(i.ip)));
      } else if (search) {
        const [field, val] = Object.entries(search)[0] ?? [];
        matches = Object.values(HOSTS).filter((h) => (h.inventory?.[field] ?? '') === val);
      }
      return matches;
    }
    case 'item.get': {
      const hostids: string[] = p.hostids ?? [];
      return hostids.flatMap((id) => ITEMS[id] ?? []);
    }
    case 'trends.get': {
      const itemids: string[] = p.itemids ?? [];
      const from = Number(p.time_from ?? 0);
      const to = Number(p.time_till ?? Number.MAX_SAFE_INTEGER);
      return itemids.flatMap((id) => trendSeries(id, from, to));
    }
    default:
      throw new Error(`fixture has no recording for method '${method}'`);
  }
}
