// W9 / CP9.2 (D3) — the DSL compiler. Input: a validated WidgetQuery. Output: a
// ResolvedPlan that is ONE of:
//   - provider_call : a typed DataSourceProvider call (foreign data, P3). NO SQL text
//                     at all — args are discrete typed values the provider binds.
//   - sql           : parameterised SQL against a Copilot-OWNED, non-CMDB table. Values
//                     appear ONLY in `params`; `text` carries only $n placeholders and
//                     WHITELISTED identifiers. NEVER interpolated (P1).
//   - not_resolvable: the read surface has no `live` path for this class → empty-state.
//
// The compiler is PURE (no DB, no Date) — planning only. The resolver (resolver.ts)
// executes the plan, converting window enums to concrete ranges and binding tenant_id.

import type { DataClass } from '../widget-catalogue';
import { COPILOT_TABLE_COLUMNS, FIELD_WHITELIST, READ_SURFACE } from './read-surface';
import type { CopilotTable, WidgetFilter, WidgetQuery } from './widget-query.schema';

export interface ProviderCallPlan {
  kind: 'provider_call';
  provider: string;
  method: string;
  /** Discrete, typed args (refs, window enums, query objects). Never concatenated. */
  args: unknown[];
  /** In-memory filters the resolver applies AFTER the typed read (never SQL). */
  postFilters?: WidgetFilter[];
}
export interface SqlPlan {
  kind: 'sql';
  table: CopilotTable;
  /** Parameterised: tenant_id is $1; $2.. map to `params` in order. */
  text: string;
  params: unknown[];
}
export interface NotResolvablePlan {
  kind: 'not_resolvable';
  dataClass: DataClass | null;
  reason: string;
}
export type ResolvedPlan = ProviderCallPlan | SqlPlan | NotResolvablePlan;

const EMS = 'canaris_ems';

const notResolvable = (dataClass: DataClass | null, reason: string): NotResolvablePlan => ({
  kind: 'not_resolvable',
  dataClass,
  reason,
});

export function compileWidgetQuery(query: WidgetQuery, widgetType?: string): ResolvedPlan {
  if (query.source === 'copilot') return compileCopilot(query);
  return compileProvider(query, widgetType);
}

// ── Foreign data → typed provider calls (no SQL) ────────────────────────────────
function compileProvider(input: WidgetQuery, widgetType?: string): ResolvedPlan {
  const dc = input.dataClass;
  if (!dc) return notResolvable(null, "provider query missing dataClass");
  if (READ_SURFACE[dc] !== 'live') {
    const why = READ_SURFACE[dc] === 'stubbed'
      ? 'read is stubbed/derived and not wired in CP9.2'
      : 'no read path exists for this data class';
    return notResolvable(dc, why);
  }
  // Tolerate fields a (possibly LLM-authored) query named that aren't valid for this
  // class: DROP them rather than fail the whole widget. Values are never concatenated
  // either way (identifier regex + parameterised reads); dropping an unsupported
  // filter just widens the read (honest), it never fabricates. The strict whitelist
  // stays hard for the Copilot-owned SQL path (compileCopilot), the security-critical one.
  const allowed = FIELD_WHITELIST[dc];
  const query: WidgetQuery = {
    ...input,
    field: input.field && allowed.includes(input.field) ? input.field : undefined,
    filters: input.filters.filter((f) => allowed.includes(f.field)),
  };

  const ref = query.scope.ref;
  const win = { window: query.window }; // resolver converts the enum to a TimeWindow

  switch (dc) {
    case 'cmdb_ci':
      return ref
        ? { kind: 'provider_call', provider: EMS, method: 'findConfigurationItem', args: [ref] }
        : { kind: 'provider_call', provider: EMS, method: 'searchConfigurationItems', args: [ciQueryFromFilters(query)] };

    case 'cmdb_relationships':
    case 'topology':
      if (!ref) return notResolvable(dc, 'requires a root CI ref (scope.ref)');
      return { kind: 'provider_call', provider: EMS, method: 'getCiRelationships', args: [{ ref, depth: 1 }] };

    case 'business_services': {
      if (query.scope.level === 'ci' && ref)
        return { kind: 'provider_call', provider: EMS, method: 'getServicesAffectedByCi', args: [ref] };
      if (query.scope.level === 'service' && ref)
        return { kind: 'provider_call', provider: EMS, method: 'getBusinessService', args: [ref] };
      // CP9.6 — tenant/fleet scope → enumerate services with their health rollup.
      const tier = query.filters.find((f) => f.field === 'criticality_tier' && f.op === 'eq')?.value ?? null;
      return { kind: 'provider_call', provider: EMS, method: 'listBusinessServices', args: [{ tier }] };
    }

    case 'change_history':
      return ref
        ? { kind: 'provider_call', provider: EMS, method: 'getCiChangeHistory', args: [ref, win] }
        : { kind: 'provider_call', provider: EMS, method: 'getChangesInWindow', args: [win] };

    case 'metrics': {
      // Per-CI when explicitly scoped to one CI; otherwise a FLEET aggregate (CP9.6).
      if (query.scope.level === 'ci' && ref) {
        return query.aggregation === 'latest'
          ? { kind: 'provider_call', provider: EMS, method: 'getGoldenSignalsForCis', args: [[ref]] }
          : { kind: 'provider_call', provider: EMS, method: 'getGoldenSignalHistory', args: [ref, win] };
      }
      const fleetArg = { ciType: query.scope.ciType ?? null, serviceId: query.scope.serviceId ?? null };
      // trend/forecast widgets want the aggregated SERIES; everything else a scalar rollup.
      const wantsSeries = widgetType === 'trend_chart' || widgetType === 'capacity_forecast';
      return wantsSeries
        ? { kind: 'provider_call', provider: EMS, method: 'getFleetMetricHistory', args: [fleetArg, win] }
        : { kind: 'provider_call', provider: EMS, method: 'getFleetMetrics', args: [fleetArg] };
    }

    case 'alerts':
      if (query.scope.level === 'alert' && ref)
        return { kind: 'provider_call', provider: EMS, method: 'getAlertById', args: [ref] };
      return {
        kind: 'provider_call',
        provider: EMS,
        method: 'getAlertsInWindow',
        args: [win],
        postFilters: query.filters.length ? query.filters : undefined,
      };

    case 'asset_status': {
      // CP9.3a — CI golden-signal availability. Scoped to one CI, or tenant-wide
      // (optionally narrowed by a ci_type filter for geo/branch widgets).
      const ciType = query.filters.find((f) => f.field === 'ci_type' && f.op === 'eq')?.value;
      const arg = ref ? { refs: [ref] } : { all: true, ...(ciType ? { ciType } : {}) };
      return { kind: 'provider_call', provider: EMS, method: 'getAssetStatuses', args: [arg] };
    }

    default:
      return notResolvable(dc, 'no provider mapping for this data class');
  }
}

/** Build a typed CiQuery object from whitelisted filters — values stay structured. */
function ciQueryFromFilters(query: WidgetQuery): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  for (const f of query.filters) {
    if (f.field === 'ci_type' && f.op === 'eq') q.ciType = f.value;
    if (f.field === 'criticality_tier' && f.op === 'eq') q.criticalityTier = f.value;
    if (f.field === 'name' && f.op === 'contains') q.nameContains = f.value;
  }
  if (query.topN) q.limit = query.topN;
  return q;
}

// ── Copilot-owned tables → parameterised SQL (P3) ───────────────────────────────
const SQL_OP: Record<WidgetFilter['op'], string> = {
  eq: '=',
  neq: '<>',
  gte: '>=',
  lte: '<=',
  in: '= ANY',
  contains: 'ILIKE',
};

function compileCopilot(query: WidgetQuery): ResolvedPlan {
  const dc = query.dataClass ?? null;
  const table = query.copilotTable as CopilotTable; // guaranteed present by schema superRefine
  const allowedCols = COPILOT_TABLE_COLUMNS[table];

  // Whitelist every column that will touch the WHERE / GROUP BY.
  for (const f of query.filters) {
    if (!allowedCols.includes(f.field)) return notResolvable(dc, `column '${f.field}' is not queryable on ${table}`);
  }
  if (query.field && !allowedCols.includes(query.field)) {
    return notResolvable(dc, `column '${query.field}' is not queryable on ${table}`);
  }

  const params: unknown[] = []; // $1 is tenant_id (bound by the resolver); these are $2..
  const where: string[] = ['tenant_id = $1'];
  let p = 2;
  for (const f of query.filters) {
    const col = f.field; // whitelisted identifier — safe to place in text
    if (f.op === 'in') {
      params.push(f.value);
      where.push(`${col} = ANY($${p}::text[])`);
    } else if (f.op === 'contains') {
      params.push(`%${String(f.value)}%`); // the % is added to the BOUND value, not the SQL
      where.push(`${col} ILIKE $${p}`);
    } else {
      params.push(f.value);
      where.push(`${col} ${SQL_OP[f.op]} $${p}`);
    }
    p++;
  }

  // SELECT: a distribution group-by when a field is named, else a scalar count.
  const groupCol = query.field; // whitelisted identifier or undefined
  const selectExpr = groupCol ? `${groupCol} AS bucket, count(*) AS n` : `count(*) AS n`;
  let text = `SELECT ${selectExpr} FROM ${table} WHERE ${where.join(' AND ')}`;
  if (groupCol) text += ` GROUP BY ${groupCol} ORDER BY n DESC`;
  if (query.topN) {
    params.push(query.topN); // bound, even though it is a validated int
    text += ` LIMIT $${p}`;
  }

  return { kind: 'sql', table, text, params };
}
