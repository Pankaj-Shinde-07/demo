// W9 / CP9.2 (D5) — the resolver. Executes a ResolvedPlan against the live data
// surface and returns real data, or an honest empty-state. The two-layer fail-safe
// (P2): the capability gate decides WHETHER a widget may resolve; the compiler emits
// only reads that exist; here we execute and, on any gap, fail toward empty-state —
// never toward a fabricated value.
//
// Foreign data goes through typed DataSourceProvider calls (P3); Copilot-owned `sql`
// plans run as parameterised queries (tenant_id bound as $1). External CI refs are
// resolved to internal ids via findConfigurationItem before id-keyed provider calls.

import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DataSourceRegistry } from '../../datasource/data-source.registry';
import type { DataSourceProvider } from '../../datasource/data-source-provider.interface';
import type { TimeWindow } from '../../datasource/data-source.types';
import { DataClassCapabilityService } from '../data-class-capability';
import type { Widget } from '../widget-schemas';
import { compileWidgetQuery, type ResolvedPlan } from './compiler';
import type { WidgetFilter } from './widget-query.schema';
import { hasAggregateReads } from '../../datasource/aggregate-reads';

// P3 — a projection needs real history; fewer aggregated points than this → honest empty.
const MIN_FORECAST_POINTS = 3;

/**
 * The renderable payload a live widget carries to the UI (CP9.6 render-path fix).
 * Every shape is derived ONLY from real reads — there is no synthesised value here;
 * an empty read still yields an empty-state, not a zero.
 */
export type WidgetData =
  | { kind: 'gauge'; pct: number | null; up: number; degraded: number; down: number; unknown: number; total: number }
  | { kind: 'metric'; value: number | null; unit: string; sub?: string }
  | { kind: 'series'; metric: string; projection: boolean; points: { at: string; value: number | null }[] }
  | { kind: 'services'; services: { name: string; tier: string; pct: number | null; up: number; total: number }[] }
  | { kind: 'status'; up: number; degraded: number; down: number; unknown: number; total: number }
  | { kind: 'list'; items: { title: string; severity?: string }[] }
  | { kind: 'table'; columns: string[]; rows: (string | number)[][] }
  | { kind: 'donut'; slices: { label: string; value: number }[] }
  | { kind: 'graph'; rootLabel: string; nodes: { ref: string; label: string; tier?: string }[] }
  | { kind: 'narrative'; note: string }
  | { kind: 'none' };

export interface ResolveResult {
  status: 'live' | 'empty';
  /** Row/element count for a live read (null for gateway-backed ai_narrative). */
  count: number | null;
  detail: string;
  /** The renderable payload (live widgets only); undefined for empty-states. */
  data?: WidgetData;
}

interface ExecResult {
  count: number;
  detail: string;
  data: WidgetData;
}

const DAY = 86_400_000;

@Injectable()
export class WidgetResolverService {
  private readonly logger = new Logger(WidgetResolverService.name);

  constructor(
    private readonly registry: DataSourceRegistry,
    private readonly capability: DataClassCapabilityService,
    private readonly db: DataSource,
  ) {}

  async resolve(widget: Widget, tenantId: string): Promise<ResolveResult> {
    // Layer 1 — capability gate (data-driven).
    const decision = await this.capability.canRender(widget, tenantId);
    if (!decision.render) {
      return { status: 'empty', count: 0, detail: `gate: missing [${decision.missing.join(', ')}]` };
    }
    // ai_narrative is gateway-backed — no DSL query; grounding/decline handles honesty.
    if (widget.type === 'ai_narrative') {
      return {
        status: 'live',
        count: null,
        detail: 'gateway-backed (grounded narrative)',
        data: { kind: 'narrative', note: 'AI narrative — grounded summary is generated on the board (digest) view.' },
      };
    }
    if (!widget.query) {
      return { status: 'empty', count: 0, detail: 'no query bound' };
    }
    // Layer 2 — compile (widget type steers fleet series-vs-scalar); not_resolvable → empty.
    const plan = compileWidgetQuery(widget.query, widget.type);
    if (plan.kind === 'not_resolvable') {
      return { status: 'empty', count: 0, detail: `not_resolvable: ${plan.reason}` };
    }
    try {
      const { count, detail, data } = await this.execute(plan, tenantId, widget.type);
      // P3: capacity_forecast is a projection — it needs enough real history, else empty.
      if (widget.type === 'capacity_forecast') {
        return count >= MIN_FORECAST_POINTS
          ? { status: 'live', count, detail: `projection from ${count} real points (estimate)`, data }
          : { status: 'empty', count: 0, detail: `insufficient history for a projection (${count} pts)` };
      }
      return count > 0
        ? { status: 'live', count, detail, data }
        : { status: 'empty', count: 0, detail: `read returned no rows (${detail})` };
    } catch (err) {
      this.logger.warn(`resolve ${widget.type} failed: ${(err as Error).message}`);
      return { status: 'empty', count: 0, detail: `read error: ${(err as Error).message}` };
    }
  }

  private async execute(plan: ResolvedPlan, tenantId: string, widgetType: string): Promise<ExecResult> {
    if (plan.kind === 'sql') {
      const rows = await this.db.query(plan.text, [tenantId, ...plan.params]);
      const cols = rows.length ? Object.keys(rows[0]) : [];
      const data: WidgetData = { kind: 'table', columns: cols, rows: rows.map((r: Record<string, unknown>) => cols.map((c) => r[c] as string | number)) };
      return { count: rows.length, detail: `sql:${plan.table}`, data };
    }
    if (plan.kind !== 'provider_call') return { count: 0, detail: 'unresolvable', data: { kind: 'none' } };

    const provider = await this.registry.getCmdbProvider(tenantId);
    if (!provider) return { count: 0, detail: 'no provider', data: { kind: 'none' } };
    const win = this.windowFromArgs(plan.args);

    switch (plan.method) {
      case 'findConfigurationItem': {
        const ci = await provider.findConfigurationItem(String(plan.args[0]), tenantId);
        const data: WidgetData = ci
          ? { kind: 'table', columns: ['Name', 'Type', 'Tier'], rows: [[ci.name, ci.ciType, ci.criticalityTier]] }
          : { kind: 'none' };
        return { count: ci ? 1 : 0, detail: ci ? `ci:${ci.externalId}` : 'no ci', data };
      }
      case 'searchConfigurationItems': {
        const cis = await provider.searchConfigurationItems(plan.args[0] as never, tenantId);
        let data: WidgetData;
        if (widgetType === 'distribution_donut') {
          const byType = new Map<string, number>();
          for (const c of cis) byType.set(c.ciType, (byType.get(c.ciType) ?? 0) + 1);
          data = { kind: 'donut', slices: [...byType].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value })) };
        } else {
          data = { kind: 'table', columns: ['Name', 'Type', 'Tier'], rows: cis.slice(0, 12).map((c) => [c.name, c.ciType, c.criticalityTier]) };
        }
        return { count: cis.length, detail: `cis:${cis.length}`, data };
      }
      case 'getCiRelationships': {
        const { ref, depth } = plan.args[0] as { ref: string; depth: number };
        const id = await this.refToId(provider, ref, tenantId);
        if (!id) return { count: 0, detail: `unknown ci ${ref}`, data: { kind: 'none' } };
        const g = await provider.getCiRelationships(id, depth, tenantId);
        const nodes = [...g.upstream, ...g.downstream].map((c) => ({ ref: c.externalId ?? c.id, label: c.name, tier: c.criticalityTier }));
        return { count: g.edges.length, detail: `edges:${g.edges.length} up:${g.upstream.length} down:${g.downstream.length}`, data: { kind: 'graph', rootLabel: ref, nodes } };
      }
      case 'getServicesAffectedByCi': {
        const id = await this.refToId(provider, String(plan.args[0]), tenantId);
        if (!id) return { count: 0, detail: 'unknown ci', data: { kind: 'none' } };
        const svcs = await provider.getServicesAffectedByCi(id, tenantId);
        return { count: svcs.length, detail: `services:${svcs.length}`, data: { kind: 'services', services: svcs.map((s) => ({ name: s.name, tier: s.criticalityTier, pct: null, up: 0, total: 0 })) } };
      }
      case 'getBusinessService': {
        const svc = await provider.getBusinessService(String(plan.args[0]), tenantId);
        const data: WidgetData = svc ? { kind: 'services', services: [{ name: svc.name, tier: svc.criticalityTier, pct: null, up: 0, total: 0 }] } : { kind: 'none' };
        return { count: svc ? 1 : 0, detail: svc ? `service:${svc.name}` : 'no service', data };
      }
      case 'getCiChangeHistory': {
        const id = await this.refToId(provider, String(plan.args[0]), tenantId);
        if (!id) return { count: 0, detail: 'unknown ci', data: { kind: 'none' } };
        const ch = await provider.getCiChangeHistory(id, win, tenantId);
        return { count: ch.length, detail: `changes:${ch.length}`, data: { kind: 'list', items: ch.slice(0, 12).map((c) => ({ title: `${c.changeRef} (${c.changeRole})` })) } };
      }
      case 'getChangesInWindow': {
        const ch = await provider.getChangesInWindow(win, tenantId);
        return { count: ch.length, detail: `changes:${ch.length}`, data: { kind: 'list', items: ch.slice(0, 12).map((c) => ({ title: `${c.ciName}: ${c.summary || c.changeRef}`, severity: c.risk })) } };
      }
      case 'getGoldenSignalsForCis': {
        const refs = plan.args[0] as string[];
        const gs = await provider.getGoldenSignalsForCis(refs, tenantId);
        const s = gs[0];
        const data: WidgetData =
          widgetType === 'availability_gauge'
            ? { kind: 'gauge', pct: s ? (s.availabilityState === 'up' ? 100 : s.availabilityState === 'degraded' ? 50 : 0) : null, up: gs.filter((x) => x.availabilityState === 'up').length, degraded: gs.filter((x) => x.availabilityState === 'degraded').length, down: gs.filter((x) => x.availabilityState === 'down').length, unknown: gs.filter((x) => x.availabilityState === 'unknown').length, total: gs.length }
            : { kind: 'metric', value: s?.cpuSaturationPct ?? null, unit: '% cpu', sub: s ? `status ${s.availabilityState}` : undefined };
        return { count: gs.length, detail: gs.length ? `signal:${gs[0].availabilityState}` : 'no signal', data };
      }
      case 'getGoldenSignalHistory': {
        const pts = await provider.getGoldenSignalHistory(String(plan.args[0]), win, tenantId);
        return { count: pts.length, detail: `points:${pts.length}`, data: { kind: 'series', metric: 'saturation %', projection: widgetType === 'capacity_forecast', points: pts.map((p) => ({ at: p.at, value: p.cpuSaturationPct ?? p.primarySaturationPct ?? p.latencyMs })) } };
      }
      case 'getAlertsInWindow': {
        let alerts = await provider.getAlertsInWindow(win, tenantId);
        if (plan.postFilters) alerts = alerts.filter((a) => this.matches(a as unknown as Record<string, unknown>, plan.postFilters!));
        return { count: alerts.length, detail: `alerts:${alerts.length}`, data: { kind: 'list', items: alerts.slice(0, 20).map((a) => ({ title: `${a.ciName}: ${a.metric || a.message || a.alertId}`, severity: a.severity })) } };
      }
      case 'getAlertById': {
        const a = await provider.getAlertById(String(plan.args[0]), tenantId);
        const data: WidgetData = a ? { kind: 'list', items: [{ title: `${a.ciName}: ${a.metric || a.message || a.alertId}`, severity: a.severity }] } : { kind: 'none' };
        return { count: a ? 1 : 0, detail: a ? `alert:${a.alertId}` : 'no alert', data };
      }
      case 'getFleetMetrics': {
        if (!hasAggregateReads(provider)) return { count: 0, detail: 'aggregate reads unavailable', data: { kind: 'none' } };
        const m = await provider.getFleetMetrics(tenantId, plan.args[0] as never);
        const a = m.availability;
        let data: WidgetData;
        if (widgetType === 'availability_gauge') {
          data = { kind: 'gauge', pct: a.pct, up: a.up, degraded: a.degraded, down: a.down, unknown: a.unknown, total: a.total };
        } else if (widgetType === 'heat_map') {
          data = { kind: 'metric', value: m.cpu.avg, unit: '% cpu avg', sub: `p95 ${m.cpu.p95 ?? 'n/a'} · mem ${m.memory.avg ?? 'n/a'}%` };
        } else {
          data = { kind: 'metric', value: a.pct, unit: '%', sub: `${a.up}/${a.total} up · cpu ${m.cpu.avg ?? 'n/a'}%` };
        }
        return {
          count: m.telemetered,
          detail: `fleet n=${m.telemetered} avail=${a.pct ?? 'n/a'}% (up:${a.up} degraded:${a.degraded} down:${a.down} unknown:${a.unknown}) cpu~${m.cpu.avg ?? 'n/a'}`,
          data,
        };
      }
      case 'getFleetMetricHistory': {
        if (!hasAggregateReads(provider)) return { count: 0, detail: 'aggregate reads unavailable', data: { kind: 'none' } };
        const pts = await provider.getFleetMetricHistory(tenantId, plan.args[0] as never, this.windowFromArgs(plan.args));
        return { count: pts.length, detail: `fleet series:${pts.length} pts`, data: { kind: 'series', metric: 'avg saturation %', projection: widgetType === 'capacity_forecast', points: pts.map((p) => ({ at: p.at, value: p.cpu ?? p.primary ?? p.latency })) } };
      }
      case 'listBusinessServices': {
        if (!hasAggregateReads(provider)) return { count: 0, detail: 'aggregate reads unavailable', data: { kind: 'none' } };
        const svcs = await provider.listBusinessServices(tenantId, plan.args[0] as never);
        const t1 = svcs.filter((s) => s.criticalityTier === 'tier-1').length;
        return { count: svcs.length, detail: `services:${svcs.length} (tier-1:${t1})`, data: { kind: 'services', services: svcs.map((s) => ({ name: s.name, tier: s.criticalityTier, pct: s.availability.pct, up: s.availability.up, total: s.availability.total })) } };
      }
      case 'getAssetStatuses': {
        // CP9.3a — asset/device status from CI golden-signal availability_state.
        const opt = plan.args[0] as { refs?: string[]; all?: boolean; ciType?: string };
        let externalIds: string[];
        if (opt.refs) {
          externalIds = opt.refs;
        } else {
          const cis = await provider.searchConfigurationItems(opt.ciType ? ({ ciType: opt.ciType } as never) : ({} as never), tenantId);
          externalIds = cis.map((c) => c.externalId).filter((x): x is string => !!x);
        }
        const signals = await provider.getGoldenSignalsForCis(externalIds, tenantId);
        const by = (st: string) => signals.filter((s) => s.availabilityState === st).length;
        // A CI with no availability reading is reported UNKNOWN, never counted as up.
        return {
          count: signals.length,
          detail: `statuses:${signals.length} (up:${by('up')} degraded:${by('degraded')} down:${by('down')} unknown:${by('unknown')})`,
          data: { kind: 'status', up: by('up'), degraded: by('degraded'), down: by('down'), unknown: by('unknown'), total: signals.length },
        };
      }
      default:
        return { count: 0, detail: `unmapped method ${plan.method}`, data: { kind: 'none' } };
    }
  }

  private async refToId(provider: DataSourceProvider, ref: string, tenantId: string): Promise<string | null> {
    const ci = await provider.findConfigurationItem(ref, tenantId);
    return ci?.id ?? null;
  }

  /** Map the DSL window enum (carried in args as { window }) to a concrete range. */
  private windowFromArgs(args: unknown[]): TimeWindow {
    const spec = args.find((a) => a && typeof a === 'object' && 'window' in (a as object)) as
      | { window: string }
      | undefined;
    const now = Date.now();
    const span: Record<string, number> = { '1h': DAY / 24, '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY, '90d': 90 * DAY };
    if (!spec || spec.window === 'all') {
      return { from: new Date('2000-01-01T00:00:00Z'), to: new Date('2100-01-01T00:00:00Z') };
    }
    return { from: new Date(now - (span[spec.window] ?? DAY)), to: new Date(now) };
  }

  /** In-memory post-filter (operational reads) — never SQL. */
  private matches(rec: Record<string, unknown>, filters: WidgetFilter[]): boolean {
    return filters.every((f) => {
      const v = rec[camel(f.field)] ?? rec[f.field];
      switch (f.op) {
        case 'eq':
          return v === f.value;
        case 'neq':
          return v !== f.value;
        case 'in':
          return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
        case 'contains':
          return typeof v === 'string' && typeof f.value === 'string' && v.toLowerCase().includes(f.value.toLowerCase());
        default:
          return true;
      }
    });
  }
}

function camel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
