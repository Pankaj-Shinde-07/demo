import { Logger } from '@nestjs/common';
import {
  type CmdbCapabilities,
  type DataSourceProvider,
} from '../data-source-provider.interface';
import type {
  BusinessService,
  ChangeRecord,
  CiQuery,
  CiRelationshipGraph,
  ConfigurationItem,
  GoldenSignal,
  GoldenSignalPoint,
  OwnerIdentity,
  TimeWindow,
} from '../data-source.types';
import { ZabbixJsonRpcClient } from './zabbix-jsonrpc.client';
import { decideHostMatch, mapItemsToSignal, matchesKey } from './zabbix.mapping';
import {
  DEFAULT_ITEM_MAP,
  type ZabbixConfig,
  type ZabbixHost,
  type ZabbixItem,
} from './zabbix.types';

/**
 * W6.5 — the ZabbixProvider: the SECOND real backing for the golden-signal
 * methods. It implements the SAME `DataSourceProvider` telemetry contract as
 * `CanarisEmsDataSource`, but reads from a live Zabbix API (here, fixtures via
 * the injected transport) instead of the seeded substrate — so a Zabbix-backed
 * tenant lights up APM identically, with ZERO engine change (the switch).
 *
 * It is a MONITORING provider: it serves Tier-A golden signals (hasGoldenSignals
 * = true) and NO CMDB facts (CMDB methods return empty/null — honest "not my
 * job"; the tenant's CMDB comes from a native/iTop provider, composed by the
 * registry). Read-only / consume-not-instrument is enforced by the client.
 */
export class ZabbixProvider implements DataSourceProvider {
  readonly name = 'zabbix';
  readonly type = 'monitoring' as const;
  private readonly logger = new Logger(ZabbixProvider.name);
  private readonly matchKey: NonNullable<ZabbixConfig['matchKey']>;

  constructor(
    private readonly client: ZabbixJsonRpcClient,
    private readonly config: ZabbixConfig,
  ) {
    this.matchKey = config.matchKey ?? 'hostname';
  }

  async cmdbCapabilities(_tenantId: string): Promise<CmdbCapabilities> {
    return {
      hasConfigurationItems: false,
      hasRelationshipGraph: false,
      hasBusinessServices: false,
      hasChangeLinkage: false,
      hasOwnership: false,
      hasCriticality: false,
      hasGoldenSignals: true, // the whole point of this backing
    };
  }

  // ── Tier-A telemetry (the implemented surface) ──────────────────────────────

  async getGoldenSignalsForCis(ciExternalIds: string[], _tenantId: string): Promise<GoldenSignal[]> {
    const out: GoldenSignal[] = [];
    for (const ext of ciExternalIds) {
      const host = await this.resolveHost(ext);
      if (!host) continue; // zero/ambiguous match → omitted → APM names the gap
      const items = await this.client.itemGet({
        hostids: [host.hostid],
        output: ['itemid', 'hostid', 'key_', 'name', 'lastvalue', 'units'],
      });
      out.push(mapItemsToSignal(ext, host.name || host.host, items, this.now(), this.config.itemMap));
    }
    return out;
  }

  async getGoldenSignalHistory(
    ciExternalId: string,
    window: TimeWindow,
    _tenantId: string,
  ): Promise<GoldenSignalPoint[]> {
    const host = await this.resolveHost(ciExternalId);
    if (!host) return [];
    const items = await this.client.itemGet({
      hostids: [host.hostid],
      output: ['itemid', 'key_'],
    });
    const map = { ...DEFAULT_ITEM_MAP, ...(this.config.itemMap ?? {}) };
    const cpuId = this.itemId(items, map.cpu_saturation_pct);
    const memId = this.itemId(items, map.memory_saturation_pct);
    const primId = this.itemId(items, map.primary_disk) ?? this.itemId(items, map.primary_if);
    const itemIds = [cpuId, memId, primId].filter((x): x is string => !!x);
    if (itemIds.length === 0) return [];

    // Prefer trends.get (hourly aggregates) for the shallow capacity trend.
    const trends = await this.client.trendsGet({
      itemids: itemIds,
      time_from: Math.floor(window.from.getTime() / 1000),
      time_till: Math.floor(window.to.getTime() / 1000),
      output: 'extend',
    });
    const byClock = new Map<string, GoldenSignalPoint>();
    for (const t of trends) {
      const at = new Date(Number(t.clock) * 1000).toISOString();
      const p =
        byClock.get(at) ??
        { at, cpuSaturationPct: null, memorySaturationPct: null, primarySaturationPct: null, latencyMs: null };
      const v = t.value_avg !== undefined ? Number(t.value_avg) : NaN;
      if (Number.isFinite(v)) {
        if (t.itemid === cpuId) p.cpuSaturationPct = round1(v);
        else if (t.itemid === memId) p.memorySaturationPct = round1(v);
        else if (t.itemid === primId) p.primarySaturationPct = round1(v);
      }
      byClock.set(at, p);
    }
    return [...byClock.values()].sort((a, b) => a.at.localeCompare(b.at));
  }

  // ── host→CI match (CP6.5.2) ─────────────────────────────────────────────────

  private async resolveHost(ciExternalId: string): Promise<ZabbixHost | null> {
    const hosts = await this.client.hostGet(this.hostGetParams(ciExternalId));
    const match = decideHostMatch(hosts);
    if (match.status === 'ambiguous') {
      this.logger.warn(
        `zabbix host match AMBIGUOUS for ${ciExternalId} (matchKey=${this.matchKey}); surfacing as a gap, not guessing`,
      );
    } else if (match.status === 'zero') {
      this.logger.debug(`zabbix host match ZERO for ${ciExternalId} (matchKey=${this.matchKey})`);
    }
    return match.host;
  }

  private hostGetParams(ciExternalId: string): Record<string, unknown> {
    const base = { output: ['hostid', 'host', 'name'], selectInterfaces: ['ip'] };
    switch (this.matchKey) {
      case 'ip':
        // Field-refinement at the live smoke-test (T-ZABBIX-API): real Zabbix
        // filters interface IP via selectInterfaces + client-side compare.
        return { ...base, filter: { ip: [ciExternalId] } };
      case 'custom': {
        const field = this.config.customMatchField ?? 'tag';
        return { ...base, selectInventory: 'extend', selectTags: 'extend', search: { [field]: ciExternalId } };
      }
      case 'hostname':
      default:
        return { ...base, filter: { host: [ciExternalId] } };
    }
  }

  private itemId(items: ZabbixItem[], pattern: string): string | null {
    const it = items.find((i) => matchesKey(i.key_, pattern));
    return it ? it.itemid : null;
  }

  /** Reading freshness = the moment we read (real Zabbix is live). */
  private now(): string {
    return new Date().toISOString();
  }

  // ── Behavioural reads — not served by this backing yet (honest empty) ───────
  // Zabbix alerts would map from problem.get; SynthBank P2 alerts/changes live in
  // the native substrate. Returning [] keeps the composite honest (no fabrication).
  async getAlertsInWindow(): Promise<import('../data-source.types').AlertRecord[]> {
    return [];
  }
  async getChangesInWindow(): Promise<import('../data-source.types').ChangeEvent[]> {
    return [];
  }
  async getAlertById(): Promise<import('../data-source.types').AlertRecord | null> {
    return null;
  }
  // Tier-B APM — this monitoring backing serves no app-layer probe signals here.
  async apmCapabilities(): Promise<import('../data-source.types').ApmCapabilities> {
    return { mode: 'probe', hasResponseTime: false, hasQueryTime: false, hasSuccessRate: false, hasErrorRate: false, hasAppAvailability: false, hasPercentiles: false, hasTraces: false };
  }
  async getServicePerformance(ref: string): Promise<import('../data-source.types').ServicePerformance> {
    return { ref, name: null, kind: 'ci', completeness: 'absent', signals: [], percentilesAvailable: false, note: 'Zabbix backing serves no Tier-B app-layer signals here', source: null };
  }

  // ── CMDB surface — not served by a monitoring backing (honest empty) ────────
  async getConfigurationItem(): Promise<ConfigurationItem | null> {
    return null;
  }
  async findConfigurationItem(): Promise<ConfigurationItem | null> {
    return null;
  }
  async searchConfigurationItems(_q: CiQuery): Promise<ConfigurationItem[]> {
    return [];
  }
  async getCiRelationships(ciId: string): Promise<CiRelationshipGraph> {
    return { rootCiId: ciId, depth: 0, upstream: [], downstream: [], edges: [] };
  }
  async getBusinessService(): Promise<BusinessService | null> {
    return null;
  }
  async getServicesAffectedByCi(): Promise<BusinessService[]> {
    return [];
  }
  async getCisForService(): Promise<ConfigurationItem[]> {
    return [];
  }
  async getCiChangeHistory(): Promise<ChangeRecord[]> {
    return [];
  }
  async resolveOwner(): Promise<OwnerIdentity | null> {
    return null;
  }
  async getOperationalEntity(): Promise<unknown | null> {
    return null;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
