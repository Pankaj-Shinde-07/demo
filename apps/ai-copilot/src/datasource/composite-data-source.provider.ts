import {
  type CmdbCapabilities,
  type DataSourceProvider,
} from './data-source-provider.interface';
import type {
  AlertRecord,
  BusinessService,
  ChangeEvent,
  ChangeRecord,
  CiQuery,
  CiRelationshipGraph,
  ConfigurationItem,
  GoldenSignal,
  GoldenSignalPoint,
  OwnerIdentity,
  TimeWindow,
  ApmCapabilities,
  ServicePerformance,
} from './data-source.types';

/**
 * W6.5 (CP6.5.4) — composes a tenant's registered backings into one
 * `DataSourceProvider` the engine sees, so a "native CMDB + Zabbix monitor"
 * tenant routes CMDB reads to the CMDB backing and Tier-A telemetry to the
 * monitoring backing — with ZERO engine change. The registry builds this only
 * when a tenant genuinely has two distinct backings; a single-backing tenant
 * (e.g. SynthBank) keeps getting that provider directly (behaviour unchanged).
 *
 * This is the datasource-layer seam that proves the synthetic→live switch with a
 * real second backing without touching `src/context/**`.
 */
export class CompositeDataSourceProvider implements DataSourceProvider {
  readonly name: string;
  readonly type: 'monitoring' | 'cmdb' | 'native';

  constructor(
    private readonly cmdb: DataSourceProvider,
    private readonly telemetry: DataSourceProvider,
    private readonly all: DataSourceProvider[],
  ) {
    this.name = `composite(${cmdb.name}+${telemetry.name})`;
    this.type = cmdb.type;
  }

  async cmdbCapabilities(tenantId: string): Promise<CmdbCapabilities> {
    const merged: CmdbCapabilities = {
      hasConfigurationItems: false,
      hasRelationshipGraph: false,
      hasBusinessServices: false,
      hasChangeLinkage: false,
      hasOwnership: false,
      hasCriticality: false,
      hasGoldenSignals: false,
    };
    for (const p of this.all) {
      const c = await p.cmdbCapabilities(tenantId);
      for (const k of Object.keys(merged) as (keyof CmdbCapabilities)[]) merged[k] = merged[k] || c[k];
    }
    return merged;
  }

  // ── CMDB → the CMDB backing ─────────────────────────────────────────────────
  getConfigurationItem(ciId: string, t: string) {
    return this.cmdb.getConfigurationItem(ciId, t);
  }
  findConfigurationItem(ref: string, t: string) {
    return this.cmdb.findConfigurationItem(ref, t);
  }
  searchConfigurationItems(q: CiQuery, t: string) {
    return this.cmdb.searchConfigurationItems(q, t);
  }
  getCiRelationships(ciId: string, depth: number, t: string): Promise<CiRelationshipGraph> {
    return this.cmdb.getCiRelationships(ciId, depth, t);
  }
  getBusinessService(id: string, t: string): Promise<BusinessService | null> {
    return this.cmdb.getBusinessService(id, t);
  }
  getServicesAffectedByCi(ciId: string, t: string): Promise<BusinessService[]> {
    return this.cmdb.getServicesAffectedByCi(ciId, t);
  }
  getCisForService(serviceId: string, t: string): Promise<ConfigurationItem[]> {
    return this.cmdb.getCisForService(serviceId, t);
  }
  getCiChangeHistory(ciId: string, w: TimeWindow, t: string): Promise<ChangeRecord[]> {
    return this.cmdb.getCiChangeHistory(ciId, w, t);
  }
  resolveOwner(ownerId: string, t: string): Promise<OwnerIdentity | null> {
    return this.cmdb.resolveOwner(ownerId, t);
  }
  getOperationalEntity(kind: 'asset' | 'alert' | 'incident', id: string, t: string) {
    return this.cmdb.getOperationalEntity(kind, id, t);
  }

  // ── Tier-A telemetry → the monitoring backing ───────────────────────────────
  getGoldenSignalsForCis(ciExternalIds: string[], t: string): Promise<GoldenSignal[]> {
    return this.telemetry.getGoldenSignalsForCis(ciExternalIds, t);
  }
  getGoldenSignalHistory(ciExternalId: string, w: TimeWindow, t: string): Promise<GoldenSignalPoint[]> {
    return this.telemetry.getGoldenSignalHistory(ciExternalId, w, t);
  }

  // Behavioural reads (alerts/changes) → the CMDB backing, where SynthBank's
  // substrate alert/change data lives (a live tenant would back these from
  // monitoring/ITSM; same vendor-neutral seam).
  getAlertsInWindow(w: TimeWindow, t: string): Promise<AlertRecord[]> {
    return this.cmdb.getAlertsInWindow(w, t);
  }
  getAlertById(alertId: string, t: string): Promise<AlertRecord | null> {
    return this.cmdb.getAlertById(alertId, t);
  }
  // Tier-B APM (ADR-006) → the native CMDB backing (which delegates to APM_SOURCE).
  apmCapabilities(t: string): Promise<ApmCapabilities> {
    return this.cmdb.apmCapabilities(t);
  }
  getServicePerformance(ref: string, t: string): Promise<ServicePerformance> {
    return this.cmdb.getServicePerformance(ref, t);
  }
  getChangesInWindow(w: TimeWindow, t: string): Promise<ChangeEvent[]> {
    return this.cmdb.getChangesInWindow(w, t);
  }
}
