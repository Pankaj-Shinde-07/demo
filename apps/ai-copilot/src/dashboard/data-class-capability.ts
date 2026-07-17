// W9 / CP9.1 — the capability spine (design contract §1, addendum §4.4). Maps each
// abstract DataClass to a predicate over the LIVE provider capabilities, so a
// widget renders IFF its required classes are all suppliable for the tenant —
// otherwise it empty-states naming exactly what is missing. Built on the existing
// W6 capability surface (cmdbCapabilities/apmCapabilities); no new capability code.
//
// Mapping (reconciled to the REAL provider surface — see W9_READ_SURFACE.md):
//   - CMDB classes  → CmdbCapabilities flags (data-driven per tenant). EXACT.
//   - metrics       → CmdbCapabilities.hasGoldenSignals (Tier-A telemetry, W6 Ph2).
//   - topology      → CmdbCapabilities.hasRelationshipGraph (topology == the graph).
//   - alerts        → DATA-DRIVEN (CP9.2 D1): true only when getAlertsInWindow returns
//     rows. A tenant registered-but-EMPTY reports it unavailable.
//   - asset_status  → WIRED (CP9.3a): sourced from CI golden-signal availability_state
//     (the NMS-origin telemetry in the self-owned CMDB). Available when telemetered CIs
//     exist; gate and compiler now AGREE (no gate-green / compiler-not_resolvable).
//   - incidents     → NOT wired: real incidents live in ITSM/EMS Core (foreign) reachable
//     only via the unwired operational client; W8 yields one RCA per window, not a
//     countable list. Constant false → incident widgets empty-state honestly (CP9.3a).
//   - security/vuln/threat/compliance/patch → constant false (no provider declares
//     them) → SOC/IS-Auditor widgets empty-state honestly. By construction there is
//     no path by which these render a number today.

import { Injectable, Logger } from '@nestjs/common';
import { DataSourceRegistry } from '../datasource/data-source.registry';
import type { CmdbCapabilities, DataSourceProvider } from '../datasource/data-source-provider.interface';
import type { ApmCapabilities, TimeWindow } from '../datasource/data-source.types';
import { DATA_CLASSES, WIDGET_CATALOGUE, type DataClass } from './widget-catalogue';
import type { Widget } from './widget-schemas';

// A window wide enough to probe "does ANY behavioural data exist for this tenant".
// Used only for capability detection (existence), never for a rendered value.
const PROBE_WINDOW: TimeWindow = {
  from: new Date('2000-01-01T00:00:00.000Z'),
  to: new Date('2100-01-01T00:00:00.000Z'),
};

const ALL_APM_FALSE: ApmCapabilities = {
  mode: 'seed',
  hasResponseTime: false,
  hasQueryTime: false,
  hasSuccessRate: false,
  hasErrorRate: false,
  hasAppAvailability: false,
  hasPercentiles: false,
  hasTraces: false,
};

/**
 * Real operational data presence for the tenant — DATA-DRIVEN (CP9.2 D1), not
 * "provider registered". Probed through typed provider reads (never raw cmdb SQL —
 * D16), so a class is available only when rows actually sit behind it.
 */
export interface OperationalPresence {
  /** Behavioural alerts seeded/streamed for this tenant (getAlertsInWindow probe). */
  hasAlerts: boolean;
  /**
   * No WIRED incident store. Real incidents live in ITSM/EMS Core (foreign), reachable
   * only via the unwired operational client (deferred); the self-owned schema has none,
   * and W8 yields a single RCA per window, not a countable list. So this is false —
   * incident widgets empty-state honestly rather than show a manufactured count (CP9.3a).
   */
  hasIncidents: boolean;
  /**
   * CP9.3a — WIRED. Asset/device status is sourced from each CI's golden-signal
   * `availability_state` (up/degraded/down) in the self-owned CMDB — the NMS-origin
   * telemetry seam (SynthBank now, Zabbix/live later). True when telemetered CIs exist.
   */
  hasAssetStatus: boolean;
}

/** A point-in-time view of what a tenant's registered providers can supply. */
export interface CapabilitySnapshot {
  cmdb: CmdbCapabilities;
  apm: ApmCapabilities;
  operational: OperationalPresence;
  providerNames: string[];
}

/** DataClass → predicate over the snapshot. The honesty contract lives here. */
export const dataClassCapabilityMap: Record<DataClass, (s: CapabilitySnapshot) => boolean> = {
  // CMDB — exact, data-driven flags
  cmdb_ci: (s) => s.cmdb.hasConfigurationItems,
  cmdb_relationships: (s) => s.cmdb.hasRelationshipGraph,
  business_services: (s) => s.cmdb.hasBusinessServices,
  change_history: (s) => s.cmdb.hasChangeLinkage,
  topology: (s) => s.cmdb.hasRelationshipGraph,
  // Telemetry — Tier-A golden signals are the real metric capability (W6 Phase 2)
  metrics: (s) => s.cmdb.hasGoldenSignals,
  // Operational — DATA-DRIVEN (CP9.2 D1): available only when real data is present.
  asset_status: (s) => s.operational.hasAssetStatus,
  alerts: (s) => s.operational.hasAlerts,
  incidents: (s) => s.operational.hasIncidents,
  // Deferred — no provider declares these → always empty-state
  security_events: () => false,
  vulnerabilities: () => false,
  threat_intel: () => false,
  compliance_controls: () => false,
  patch_status: () => false,
};

/** The set of data classes a tenant's providers can supply, given a snapshot. */
export function availableDataClasses(snapshot: CapabilitySnapshot): Set<DataClass> {
  const out = new Set<DataClass>();
  for (const dc of DATA_CLASSES) {
    if (dataClassCapabilityMap[dc](snapshot)) out.add(dc);
  }
  return out;
}

export interface RenderDecision {
  render: boolean;
  missing: DataClass[];
}

/**
 * The effective required classes for a widget. For per-binding widgets the needs
 * travel on the instance (the binding/query, CP9.2-derived); for fixed widgets the
 * schema pins them, so the instance value equals the catalogue value.
 */
export function requiredClassesOf(widget: Pick<Widget, 'type' | 'requiredDataClasses'>): DataClass[] {
  return (widget.requiredDataClasses ?? WIDGET_CATALOGUE[widget.type].requiredDataClasses) as DataClass[];
}

/** Pure gate: a widget renders iff requiredDataClasses ⊆ available. */
export function canRenderWith(
  widget: Pick<Widget, 'type' | 'requiredDataClasses'>,
  available: Set<DataClass>,
): RenderDecision {
  const required = requiredClassesOf(widget);
  const missing = required.filter((c) => !available.has(c));
  return { render: missing.length === 0, missing };
}

/**
 * Per-tenant capability service. Builds the snapshot from the live registry and
 * answers availableDataClasses / canRender against it. The single place widgets
 * consult before a query — no fabrication path exists by construction.
 */
@Injectable()
export class DataClassCapabilityService {
  private readonly logger = new Logger(DataClassCapabilityService.name);

  constructor(private readonly registry: DataSourceRegistry) {}

  async snapshot(tenantId: string): Promise<CapabilitySnapshot> {
    const providers = await this.registry.getProviders(tenantId);
    const cmdb = await this.registry.combinedCmdbCapabilities(tenantId);
    const native = providers.find((p) => p.type === 'native' || p.name === 'canaris_ems');
    const apm = native ? await native.apmCapabilities(tenantId) : ALL_APM_FALSE;
    // asset_status is sourced from CI golden-signal availability (CP9.3a) → its presence
    // tracks telemetered CIs, which is exactly what cmdb.hasGoldenSignals counts.
    const operational = await this.probeOperational(providers, tenantId, cmdb.hasGoldenSignals);
    return { cmdb, apm, operational, providerNames: providers.map((p) => p.name) };
  }

  /**
   * Data-driven operational presence (D1 + CP9.3a). Probes real provider reads for
   * existence — a provider being *registered* is not enough; rows must exist.
   * `getAlertsInWindow` over a wide window tells us if behavioural alerts exist;
   * `asset_status` presence is passed in (golden-signal availability); incidents are
   * NOT wired (no countable store) so they stay false.
   */
  private async probeOperational(
    providers: DataSourceProvider[],
    tenantId: string,
    hasAssetStatus: boolean,
  ): Promise<OperationalPresence> {
    let hasAlerts = false;
    for (const p of providers) {
      try {
        const alerts = await p.getAlertsInWindow(PROBE_WINDOW, tenantId);
        if (alerts.length > 0) {
          hasAlerts = true;
          break;
        }
      } catch {
        // A provider that doesn't support windowed alerts simply contributes nothing.
      }
    }
    return { hasAlerts, hasIncidents: false, hasAssetStatus };
  }

  async availableDataClasses(tenantId: string): Promise<Set<DataClass>> {
    return availableDataClasses(await this.snapshot(tenantId));
  }

  async canRender(
    widget: Pick<Widget, 'type' | 'requiredDataClasses'>,
    tenantId: string,
  ): Promise<RenderDecision> {
    return canRenderWith(widget, await this.availableDataClasses(tenantId));
  }
}
