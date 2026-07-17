import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CapabilityNotSupportedError,
  type CmdbCapabilities,
  type DataSourceProvider,
} from './data-source-provider.interface';
import { APM_SOURCE, type ApmSource } from './apm/apm-source.interface';
import type { ApmCapabilities, ServicePerformance } from './data-source.types';
import {
  availabilityRollup,
  type AggregateReads,
  type BusinessServiceFilter,
  type BusinessServiceHealth,
  type FleetFilter,
  type FleetHistoryPoint,
  type FleetMetrics,
} from './aggregate-reads';
import type {
  AlertRecord,
  BusinessService,
  ChangeEvent,
  ChangeRecord,
  CiQuery,
  CiRelationship,
  CiRelationshipGraph,
  ConfigurationItem,
  GoldenSignal,
  GoldenSignalPoint,
  OwnerIdentity,
  TimeWindow,
} from './data-source.types';

/**
 * The native (Bundled-profile) DataSourceProvider. Reads the AI Copilot's own
 * cmdb_* tables — which ARE self-owned (ADR-002), so this is not a cross-schema
 * read. For Standalone/Hybrid profiles the equivalent CMDB facts arrive through
 * external providers (Zabbix/iTop, W6.5/W6.6) implementing this same interface.
 *
 * D16 boundary: this class is the ONLY code permitted to issue `cmdb_*` SQL. The
 * Context Engine consumes it through the registry and never touches a table. A
 * guard test (no-direct-table-read.spec.ts) enforces that lint rule.
 *
 * Every query carries `tenant_id = $1` — tenant isolation is in the SQL itself,
 * mirroring RetrievalService's always-enforced tenant filter.
 */
@Injectable()
export class CanarisEmsDataSource implements DataSourceProvider, AggregateReads {
  readonly name = 'canaris_ems';
  readonly type = 'native' as const;
  private readonly logger = new Logger(CanarisEmsDataSource.name);

  constructor(
    private readonly db: DataSource,
    @Inject(APM_SOURCE) private readonly apm: ApmSource,
  ) {}

  // ── Tier-B APM (ADR-006) — delegate to the APM_SOURCE-selected provider ──────
  apmCapabilities(tenantId: string): Promise<ApmCapabilities> {
    return this.apm.apmCapabilities(tenantId);
  }
  getServicePerformance(ref: string, tenantId: string): Promise<ServicePerformance> {
    return this.apm.getServicePerformance(ref, tenantId);
  }

  async cmdbCapabilities(tenantId: string): Promise<CmdbCapabilities> {
    const [row] = await this.db.query(
      `SELECT
         (SELECT count(*) FROM cmdb_configuration_items WHERE tenant_id = $1 AND deleted_at IS NULL) AS cis,
         (SELECT count(*) FROM cmdb_relationships     WHERE tenant_id = $1) AS rels,
         (SELECT count(*) FROM cmdb_business_services WHERE tenant_id = $1 AND deleted_at IS NULL) AS svcs,
         (SELECT count(*) FROM cmdb_change_links      WHERE tenant_id = $1) AS changes,
         (SELECT count(*) FROM cmdb_configuration_items
            WHERE tenant_id = $1 AND deleted_at IS NULL
              AND (technical_owner_id IS NOT NULL OR business_owner_id IS NOT NULL)) AS owned,
         (SELECT count(*) FROM cmdb_configuration_items
            WHERE tenant_id = $1 AND deleted_at IS NULL
              AND criticality_tier <> 'unknown') AS tiered,
         (SELECT count(*) FROM cmdb_configuration_items
            WHERE tenant_id = $1 AND deleted_at IS NULL
              AND attributes ? 'golden_signal') AS telemetered`,
      [tenantId],
    );
    return {
      hasConfigurationItems: Number(row.cis) > 0,
      hasRelationshipGraph: Number(row.rels) > 0,
      hasBusinessServices: Number(row.svcs) > 0,
      hasChangeLinkage: Number(row.changes) > 0,
      hasOwnership: Number(row.owned) > 0,
      hasCriticality: Number(row.tiered) > 0,
      hasGoldenSignals: Number(row.telemetered) > 0,
    };
  }

  async getConfigurationItem(ciId: string, tenantId: string): Promise<ConfigurationItem | null> {
    const [row] = await this.db.query(
      `SELECT * FROM cmdb_configuration_items
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [ciId, tenantId],
    );
    return row ? this.mapCi(row) : null;
  }

  async findConfigurationItem(ref: string, tenantId: string): Promise<ConfigurationItem | null> {
    const [row] = await this.db.query(
      `SELECT * FROM cmdb_configuration_items
        WHERE tenant_id = $1 AND deleted_at IS NULL
          AND (ci_external_id = $2 OR name = $2)
        ORDER BY (ci_external_id = $2) DESC
        LIMIT 1`,
      [tenantId, ref],
    );
    return row ? this.mapCi(row) : null;
  }

  async searchConfigurationItems(query: CiQuery, tenantId: string): Promise<ConfigurationItem[]> {
    const clauses = ['tenant_id = $1', 'deleted_at IS NULL'];
    const params: unknown[] = [tenantId];
    if (query.ciType) {
      params.push(query.ciType);
      clauses.push(`ci_type = $${params.length}`);
    }
    if (query.criticalityTier) {
      params.push(query.criticalityTier);
      clauses.push(`criticality_tier = $${params.length}`);
    }
    if (query.nameContains) {
      params.push(`%${query.nameContains}%`);
      clauses.push(`name ILIKE $${params.length}`);
    }
    const limit = Math.min(query.limit ?? 50, 500);
    const rows = await this.db.query(
      `SELECT * FROM cmdb_configuration_items
        WHERE ${clauses.join(' AND ')}
        ORDER BY name
        LIMIT ${limit}`,
      params,
    );
    return rows.map((r: Record<string, unknown>) => this.mapCi(r));
  }

  async getCiRelationships(
    ciId: string,
    depth: number,
    tenantId: string,
  ): Promise<CiRelationshipGraph> {
    if (depth > 1) {
      // Multi-hop traversal + Redis caching is W6 Phase 2 (CP6.3). Phase 1 returns
      // the direct neighbourhood; deeper requests are clamped, logged, not faked.
      this.logger.debug(`getCiRelationships depth ${depth} clamped to 1 (CP6.3 = Phase 2)`);
    }
    const edges: CiRelationship[] = (
      await this.db.query(
        `SELECT source_ci_id, target_ci_id, relationship_type, metadata
           FROM cmdb_relationships
          WHERE tenant_id = $1 AND (source_ci_id = $2 OR target_ci_id = $2)`,
        [tenantId, ciId],
      )
    ).map((r: Record<string, unknown>) => ({
      sourceCiId: r.source_ci_id as string,
      targetCiId: r.target_ci_id as string,
      relationshipType: r.relationship_type as CiRelationship['relationshipType'],
      metadata: (r.metadata as Record<string, unknown>) ?? {},
    }));

    // upstream = CIs this CI points to (root is the edge source: depends_on/runs_on/…).
    // downstream = CIs that point to this CI (root is the edge target).
    const upstreamIds = edges.filter((e) => e.sourceCiId === ciId).map((e) => e.targetCiId);
    const downstreamIds = edges.filter((e) => e.targetCiId === ciId).map((e) => e.sourceCiId);

    const [upstream, downstream] = await Promise.all([
      this.cisByIds(upstreamIds, tenantId),
      this.cisByIds(downstreamIds, tenantId),
    ]);
    return { rootCiId: ciId, depth: 1, upstream, downstream, edges };
  }

  async getBusinessService(serviceId: string, tenantId: string): Promise<BusinessService | null> {
    const [row] = await this.db.query(
      `SELECT * FROM cmdb_business_services
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [serviceId, tenantId],
    );
    return row ? this.mapService(row) : null;
  }

  async getServicesAffectedByCi(ciId: string, tenantId: string): Promise<BusinessService[]> {
    const rows = await this.db.query(
      `SELECT s.* FROM cmdb_business_services s
         JOIN cmdb_service_ci_links l ON l.service_id = s.id AND l.tenant_id = s.tenant_id
        WHERE l.ci_id = $1 AND s.tenant_id = $2 AND s.deleted_at IS NULL
        ORDER BY s.criticality_tier, s.name`,
      [ciId, tenantId],
    );
    return rows.map((r: Record<string, unknown>) => this.mapService(r));
  }

  async getCisForService(serviceId: string, tenantId: string): Promise<ConfigurationItem[]> {
    const rows = await this.db.query(
      `SELECT c.* FROM cmdb_configuration_items c
         JOIN cmdb_service_ci_links l ON l.ci_id = c.id AND l.tenant_id = c.tenant_id
        WHERE l.service_id = $1 AND c.tenant_id = $2 AND c.deleted_at IS NULL
        ORDER BY c.name`,
      [serviceId, tenantId],
    );
    return rows.map((r: Record<string, unknown>) => this.mapCi(r));
  }

  async getGoldenSignalsForCis(
    ciExternalIds: string[],
    tenantId: string,
  ): Promise<GoldenSignal[]> {
    if (ciExternalIds.length === 0) return [];
    const rows = await this.db.query(
      `SELECT ci_external_id, name, attributes->'golden_signal' AS gs
         FROM cmdb_configuration_items
        WHERE tenant_id = $1 AND deleted_at IS NULL
          AND ci_external_id = ANY($2::text[])
          AND attributes ? 'golden_signal'`,
      [tenantId, ciExternalIds],
    );
    return rows
      .map((r: Record<string, unknown>) =>
        this.mapGoldenSignal(r.ci_external_id as string, r.name as string, r.gs as Record<string, unknown>),
      )
      .filter((g: GoldenSignal | null): g is GoldenSignal => g !== null);
  }

  async getGoldenSignalHistory(
    ciExternalId: string,
    window: TimeWindow,
    tenantId: string,
  ): Promise<GoldenSignalPoint[]> {
    const [row] = await this.db.query(
      `SELECT attributes->'golden_signal_history' AS hist,
              attributes->'p2_history'           AS p2hist
         FROM cmdb_configuration_items
        WHERE tenant_id = $1 AND deleted_at IS NULL AND ci_external_id = $2`,
      [tenantId, ciExternalId],
    );
    // Merge the t=0 trend (telemetry seed) with the P2 scenario arc (behaviour
    // seed), both additive jsonb keys — windowed read selects the right slice.
    const hist = [
      ...((row?.hist as Array<Record<string, unknown>> | null) ?? []),
      ...((row?.p2hist as Array<Record<string, unknown>> | null) ?? []),
    ];
    const from = window.from.getTime();
    const to = window.to.getTime();
    return hist
      .map((p) => ({
        at: String(p.at),
        cpuSaturationPct: this.num(p.cpu_saturation_pct),
        memorySaturationPct: this.num(p.memory_saturation_pct),
        primarySaturationPct: this.num(p.primary_saturation_pct),
        latencyMs: this.num(p.latency_ms),
      }))
      .filter((p) => {
        const t = Date.parse(p.at);
        return Number.isNaN(t) || (t >= from && t <= to);
      })
      .sort((a, b) => a.at.localeCompare(b.at));
  }

  async getAlertsInWindow(window: TimeWindow, tenantId: string): Promise<AlertRecord[]> {
    const rows = await this.db.query(
      `SELECT ci_external_id, name, attributes->'p2_alerts' AS alerts
         FROM cmdb_configuration_items
        WHERE tenant_id = $1 AND deleted_at IS NULL AND attributes ? 'p2_alerts'`,
      [tenantId],
    );
    const from = window.from.getTime();
    const to = window.to.getTime();
    const out: AlertRecord[] = [];
    for (const r of rows as Array<Record<string, unknown>>) {
      for (const a of (r.alerts as Array<Record<string, unknown>>) ?? []) {
        const t = Date.parse(String(a.fired_at));
        if (!Number.isNaN(t) && (t < from || t > to)) continue;
        out.push(this.mapAlert(r.ci_external_id as string, r.name as string, a));
      }
    }
    return out.sort((x, y) => x.firedAt.localeCompare(y.firedAt));
  }

  async getAlertById(alertId: string, tenantId: string): Promise<AlertRecord | null> {
    // The alertId → CI bridge: alerts are seeded inside the CI (attributes->
    // 'p2_alerts'), so a single keyed lookup yields both the alert facts and the
    // bearing CI's external id/name. Tenant-isolated in the SQL like every read.
    const [row] = await this.db.query(
      `SELECT c.ci_external_id, c.name, a AS alert
         FROM cmdb_configuration_items c,
              jsonb_array_elements(c.attributes->'p2_alerts') a
        WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
          AND c.attributes ? 'p2_alerts'
          AND a->>'alert_id' = $2
        LIMIT 1`,
      [tenantId, alertId],
    );
    return row
      ? this.mapAlert(
          row.ci_external_id as string,
          row.name as string,
          row.alert as Record<string, unknown>,
        )
      : null;
  }

  async getChangesInWindow(window: TimeWindow, tenantId: string): Promise<ChangeEvent[]> {
    const rows = await this.db.query(
      `SELECT ci_external_id, name, attributes->'p2_change' AS changes
         FROM cmdb_configuration_items
        WHERE tenant_id = $1 AND deleted_at IS NULL AND attributes ? 'p2_change'`,
      [tenantId],
    );
    const from = window.from.getTime();
    const to = window.to.getTime();
    const out: ChangeEvent[] = [];
    for (const r of rows as Array<Record<string, unknown>>) {
      for (const c of (r.changes as Array<Record<string, unknown>>) ?? []) {
        const at = String(c.at);
        const t = Date.parse(at);
        if (!Number.isNaN(t) && (t < from || t > to)) continue;
        out.push({
          changeRef: String(c.change_ref),
          ciExternalId: r.ci_external_id as string,
          ciName: r.name as string,
          at,
          changeType: String(c.change_type ?? 'config'),
          summary: String(c.summary ?? ''),
          risk: (c.risk as ChangeEvent['risk']) ?? 'medium',
          role: (c.role as string | null) ?? null,
          scenario: (c.scenario as string | null) ?? null,
        });
      }
    }
    return out.sort((x, y) => x.at.localeCompare(y.at));
  }

  async getCiChangeHistory(
    ciId: string,
    _window: TimeWindow,
    tenantId: string,
  ): Promise<ChangeRecord[]> {
    // cmdb_change_links holds only (change_ref, ci_id, change_role) — per ADR-002
    // the AI Copilot keeps no Change entity; the change's date/summary/risk are
    // OPERATIONAL data resolved by change_ref through the operational DataSource
    // (EMS Core changes API). Phase 1 has no operational client, so the window is
    // not yet applied — we return the full CI↔change linkage (honest: the linkage
    // is the keystone fact; the narrative lives in the knowledge corpus). Window
    // filtering arrives with the operational change resolver (W6 Phase 2).
    const rows = await this.db.query(
      `SELECT change_ref, ci_id, change_role
         FROM cmdb_change_links
        WHERE tenant_id = $1 AND ci_id = $2
        ORDER BY change_ref`,
      [tenantId, ciId],
    );
    return rows.map((r: Record<string, unknown>) => ({
      changeRef: r.change_ref as string,
      ciId: r.ci_id as string,
      changeRole: r.change_role as ChangeRecord['changeRole'],
      metadata: {},
    }));
  }

  async resolveOwner(ownerId: string, tenantId: string): Promise<OwnerIdentity | null> {
    // Owner identities are denormalized into CI attributes at import time, so a
    // jsonb match resolves any owner that appears on a CI. Service business-owners
    // are a subset of CI owners, so this covers them too — no owners table needed.
    const [row] = await this.db.query(
      `SELECT attributes->'technical_owner' AS t, attributes->'business_owner' AS b
         FROM cmdb_configuration_items
        WHERE tenant_id = $1 AND deleted_at IS NULL
          AND (attributes->'technical_owner'->>'id' = $2
            OR attributes->'business_owner'->>'id' = $2)
        LIMIT 1`,
      [tenantId, ownerId],
    );
    if (!row) return null;
    const t = row.t as OwnerIdentity | null;
    const b = row.b as OwnerIdentity | null;
    if (t && t.id === ownerId) return t;
    if (b && b.id === ownerId) return b;
    return null;
  }

  async getOperationalEntity(): Promise<unknown | null> {
    // Operational facts (assets/alerts/incidents/metrics) are NOT in the self-owned
    // schema. They flow from EMS Core's REST API via a future client — out of W6
    // Phase 1 scope. Throw rather than return a misleading null.
    throw new CapabilityNotSupportedError(this.name, 'getOperationalEntity');
  }

  // ── Aggregate / fleet reads (W9 CP9.6) — SQL GROUP BY over self-owned data ──────
  // P5: rolled up at the data layer (never pulling a bank-scale CI set into memory).
  // P2: `unknown` is its own bucket; availability % is over KNOWN states only.

  async getFleetMetrics(tenantId: string, filter: FleetFilter = {}): Promise<FleetMetrics> {
    const params: unknown[] = [tenantId];
    const clauses = ['c.tenant_id = $1', 'c.deleted_at IS NULL', "c.attributes ? 'golden_signal'"];
    if (filter.ciType) {
      params.push(filter.ciType);
      clauses.push(`c.ci_type = $${params.length}`);
    }
    if (filter.serviceId) {
      params.push(filter.serviceId);
      clauses.push(`c.id IN (SELECT ci_id FROM cmdb_service_ci_links WHERE service_id = $${params.length} AND tenant_id = $1)`);
    }
    const gs = "c.attributes->'golden_signal'";
    const stat = (k: string) =>
      `avg((${gs}->>'${k}')::numeric) AS avg_${k}, ` +
      `percentile_cont(0.95) WITHIN GROUP (ORDER BY (${gs}->>'${k}')::numeric) AS p95_${k}`;
    const [row] = await this.db.query(
      `SELECT
         count(*) AS telemetered,
         count(*) FILTER (WHERE ${gs}->>'availability_state' = 'up') AS up,
         count(*) FILTER (WHERE ${gs}->>'availability_state' = 'degraded') AS degraded,
         count(*) FILTER (WHERE ${gs}->>'availability_state' = 'down') AS down,
         count(*) FILTER (WHERE ${gs}->>'availability_state' IS NULL
                             OR ${gs}->>'availability_state' NOT IN ('up','degraded','down')) AS unknown,
         ${stat('cpu_saturation_pct')}, ${stat('memory_saturation_pct')}, ${stat('primary_saturation_pct')},
         ${stat('latency_ms')}, ${stat('packet_loss_pct')}
       FROM cmdb_configuration_items c
       WHERE ${clauses.join(' AND ')}`,
      params,
    );
    return {
      telemetered: Number(row.telemetered),
      availability: availabilityRollup(Number(row.up), Number(row.degraded), Number(row.down), Number(row.unknown)),
      cpu: { avg: this.r1(row.avg_cpu_saturation_pct), p95: this.r1(row.p95_cpu_saturation_pct) },
      memory: { avg: this.r1(row.avg_memory_saturation_pct), p95: this.r1(row.p95_memory_saturation_pct) },
      primary: { avg: this.r1(row.avg_primary_saturation_pct), p95: this.r1(row.p95_primary_saturation_pct) },
      latency: { avg: this.r1(row.avg_latency_ms), p95: this.r1(row.p95_latency_ms) },
      packetLoss: { avg: this.r1(row.avg_packet_loss_pct), p95: this.r1(row.p95_packet_loss_pct) },
    };
  }

  async getFleetMetricHistory(
    tenantId: string,
    filter: FleetFilter,
    window: TimeWindow,
  ): Promise<FleetHistoryPoint[]> {
    const params: unknown[] = [tenantId];
    const clauses = [
      'c.tenant_id = $1',
      'c.deleted_at IS NULL',
      "(c.attributes ? 'golden_signal_history' OR c.attributes ? 'p2_history')",
    ];
    if (filter.ciType) {
      params.push(filter.ciType);
      clauses.push(`c.ci_type = $${params.length}`);
    }
    if (filter.serviceId) {
      params.push(filter.serviceId);
      clauses.push(`c.id IN (SELECT ci_id FROM cmdb_service_ci_links WHERE service_id = $${params.length} AND tenant_id = $1)`);
    }
    params.push(window.from.toISOString());
    const fromIdx = params.length;
    params.push(window.to.toISOString());
    const toIdx = params.length;
    const rows = await this.db.query(
      `SELECT pt->>'at' AS at,
         avg((pt->>'cpu_saturation_pct')::numeric)     AS cpu,
         avg((pt->>'memory_saturation_pct')::numeric)  AS mem,
         avg((pt->>'primary_saturation_pct')::numeric) AS prim,
         avg((pt->>'latency_ms')::numeric)             AS lat,
         count(*) AS ci_count
       FROM cmdb_configuration_items c
       CROSS JOIN LATERAL jsonb_array_elements(
         coalesce(c.attributes->'golden_signal_history','[]'::jsonb)
         || coalesce(c.attributes->'p2_history','[]'::jsonb)
       ) pt
       WHERE ${clauses.join(' AND ')}
         AND (pt->>'at')::timestamptz BETWEEN $${fromIdx} AND $${toIdx}
       GROUP BY pt->>'at'
       ORDER BY pt->>'at'`,
      params,
    );
    return rows.map((r: Record<string, unknown>) => ({
      at: String(r.at),
      cpu: this.r1(r.cpu),
      memory: this.r1(r.mem),
      primary: this.r1(r.prim),
      latency: this.r1(r.lat),
      ciCount: Number(r.ci_count),
    }));
  }

  async listBusinessServices(
    tenantId: string,
    filter: BusinessServiceFilter = {},
  ): Promise<BusinessServiceHealth[]> {
    const params: unknown[] = [tenantId];
    const clauses = ['s.tenant_id = $1', 's.deleted_at IS NULL'];
    if (filter.tier) {
      params.push(filter.tier);
      clauses.push(`s.criticality_tier = $${params.length}`);
    }
    const gs = "c.attributes->'golden_signal'";
    const rows = await this.db.query(
      `SELECT s.id, s.name, s.criticality_tier,
         count(c.id) AS ci_count,
         count(c.id) FILTER (WHERE c.attributes ? 'golden_signal') AS telemetered,
         count(*) FILTER (WHERE ${gs}->>'availability_state' = 'up') AS up,
         count(*) FILTER (WHERE ${gs}->>'availability_state' = 'degraded') AS degraded,
         count(*) FILTER (WHERE ${gs}->>'availability_state' = 'down') AS down,
         count(c.id) FILTER (WHERE c.attributes ? 'golden_signal'
                               AND (${gs}->>'availability_state' IS NULL
                                 OR ${gs}->>'availability_state' NOT IN ('up','degraded','down'))) AS unknown
       FROM cmdb_business_services s
       LEFT JOIN cmdb_service_ci_links l ON l.service_id = s.id AND l.tenant_id = s.tenant_id
       LEFT JOIN cmdb_configuration_items c ON c.id = l.ci_id AND c.tenant_id = s.tenant_id AND c.deleted_at IS NULL
       WHERE ${clauses.join(' AND ')}
       GROUP BY s.id, s.name, s.criticality_tier
       ORDER BY s.criticality_tier, s.name`,
      params,
    );
    return rows.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      name: String(r.name),
      criticalityTier: String(r.criticality_tier),
      ciCount: Number(r.ci_count),
      telemetered: Number(r.telemetered),
      availability: availabilityRollup(Number(r.up), Number(r.degraded), Number(r.down), Number(r.unknown)),
    }));
  }

  /** Round a possibly-null numeric to 1 dp. */
  private r1(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
  }

  // ── mapping helpers ─────────────────────────────────────────────────────────

  private async cisByIds(ids: string[], tenantId: string): Promise<ConfigurationItem[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.query(
      `SELECT * FROM cmdb_configuration_items
        WHERE tenant_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])
        ORDER BY name`,
      [tenantId, ids],
    );
    return rows.map((r: Record<string, unknown>) => this.mapCi(r));
  }

  private mapCi(row: Record<string, unknown>): ConfigurationItem {
    const attributes = (row.attributes as Record<string, unknown>) ?? {};
    return {
      id: row.id as string,
      externalId: (row.ci_external_id as string | null) ?? null,
      ciType: row.ci_type as string,
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      criticalityTier: row.criticality_tier as ConfigurationItem['criticalityTier'],
      technicalOwner: (attributes.technical_owner as OwnerIdentity) ?? null,
      businessOwner: (attributes.business_owner as OwnerIdentity) ?? null,
      operationsTeam: (row.operations_team as string | null) ?? null,
      linkedAssetRef: (row.linked_asset_ref as string | null) ?? null,
      attributes,
      source: row.source as string,
    };
  }

  private mapAlert(
    ciExternalId: string,
    ciName: string,
    a: Record<string, unknown>,
  ): AlertRecord {
    return {
      alertId: String(a.alert_id),
      ciExternalId,
      ciName,
      severity: (a.severity as AlertRecord['severity']) ?? 'warning',
      firedAt: String(a.fired_at),
      metric: String(a.metric ?? ''),
      message: String(a.message ?? ''),
      scenario: (a.scenario as string | null) ?? null,
    };
  }

  private num(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }

  private mapGoldenSignal(
    ciExternalId: string,
    ciName: string,
    gs: Record<string, unknown> | null,
  ): GoldenSignal | null {
    if (!gs) return null;
    const state = gs.availability_state;
    // A signal with no availability reading is UNKNOWN — never silently 'up' (CP9.4).
    const availabilityState =
      state === 'up' || state === 'degraded' || state === 'down' ? state : 'unknown';
    return {
      ciExternalId,
      ciName,
      availabilityState,
      cpuSaturationPct: this.num(gs.cpu_saturation_pct),
      memorySaturationPct: this.num(gs.memory_saturation_pct),
      primarySaturationPct: this.num(gs.primary_saturation_pct),
      primaryMetric: typeof gs.primary_metric === 'string' ? gs.primary_metric : null,
      latencyMs: this.num(gs.latency_ms),
      packetLossPct: this.num(gs.packet_loss_pct),
      lastReadingAt: String(gs.last_reading_at ?? ''),
    };
  }

  private mapService(row: Record<string, unknown>): BusinessService {
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      criticalityTier: row.criticality_tier as BusinessService['criticalityTier'],
      businessOwnerId: (row.business_owner_id as string | null) ?? null,
      businessOwner: null, // resolved on demand via resolveOwner(businessOwnerId)
      rtoMinutes: row.rto_minutes === null ? null : Number(row.rto_minutes),
      rpoMinutes: row.rpo_minutes === null ? null : Number(row.rpo_minutes),
      revenueImpactHourly: (row.revenue_impact_hourly as string | null) ?? null,
      source: row.source as string,
    };
  }
}
