// W9 / CP9.2 (D2) — the Query DSL. THE SECURITY SPINE: a widget's data request is a
// CLOSED, Zod-validated structure with a fixed vocabulary. There is NO free-text
// field that flows into a query. In CP9.4 the LLM emits this object as JSON; it is
// Zod-validated before the compiler ever sees it, and the compiler NEVER concatenates
// a value into SQL (P1).
//
// What makes this safe (defense in depth):
//  - `dataClass`, `source`, `aggregation`, `window`, `op`, `copilotTable` are ENUMS.
//  - `field` / `filter.field` are IDENTIFIER-constrained (`^[a-z_][a-z0-9_.]*$`) — a
//    field name can never carry a quote, semicolon, space, or SQL fragment. The
//    compiler additionally checks each field against a per-class WHITELIST.
//  - The only free-form strings are `scope.ref` and `filter.value` (string) — and
//    these reach the database ONLY as bound parameters / typed provider args, never
//    interpolated. Length-bounded to blunt abuse.

import { z } from 'zod';
import { DATA_CLASSES } from '../widget-catalogue';

/** Identifier-only: blocks quotes/semicolons/whitespace/SQL by construction. */
export const IDENTIFIER = /^[a-z_][a-z0-9_.]*$/;
const Identifier = z.string().min(1).max(64).regex(IDENTIFIER);

export const DataClassEnum = z.enum(DATA_CLASSES);

// CP9.6 — the closed set of CI types a `fleet` scope may filter by (P4: enumerated,
// not a free string). Banking-pack types; extend per pack for other verticals.
export const CiTypeEnum = z.enum([
  'ad_dns_dhcp', 'atm_switch', 'atm_terminal', 'backup_system', 'branch_router', 'branch_switch',
  'cbs_application_server', 'cbs_database_server', 'cbs_hosted_service', 'core_router', 'core_switch',
  'cts_system', 'dr_site_node', 'firewall', 'hsm_device', 'hub_router', 'hub_switch',
  'internet_banking_server', 'mobile_banking_gateway', 'npci_link', 'payment_gateway', 'recon_server',
  'server', 'sponsor_bank_link', 'upi_switch',
]);
export type CiType = z.infer<typeof CiTypeEnum>;

/**
 * Where a query is anchored. `ref` is an OPAQUE external ref (e.g. 'CI-0002' or a
 * service name) — never a raw uuid, never interpolated (ADR-002 / P3). The `fleet`
 * level (CP9.6) selects a whole-tenant / by-ciType / by-service aggregate; its
 * `ciType` is enumerated and `serviceId` is an opaque ref — both bound params.
 */
export const ScopeSchema = z.object({
  level: z.enum(['tenant', 'service', 'ci', 'alert', 'fleet']).default('tenant'),
  ref: z.string().min(1).max(128).optional(),
  ciType: CiTypeEnum.optional(),
  serviceId: z.string().min(1).max(128).optional(),
});

export const AggregationEnum = z.enum(['latest', 'avg', 'sum', 'count', 'min', 'max', 'p95', 'pct_up']);
export const WindowEnum = z.enum(['1h', '24h', '7d', '30d', '90d', 'all']);
export const FilterOpEnum = z.enum(['eq', 'neq', 'in', 'gte', 'lte', 'contains']);

/** A typed filter value. Strings may contain arbitrary characters — they are ALWAYS
 *  bound parameters, never concatenated. Length-bounded. */
export const FilterValueSchema = z.union([
  z.string().max(128),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string().max(128), z.number()])).max(20),
]);

export const FilterSchema = z.object({
  field: Identifier, // identifier-only; compiler also whitelists per data class
  op: FilterOpEnum,
  value: FilterValueSchema,
});
export type WidgetFilter = z.infer<typeof FilterSchema>;

/** Copilot-OWNED, non-CMDB tables the compiler may build parameterised SQL against
 *  (P3). CMDB tables are excluded — they are reached only via provider_call (D16). */
export const CopilotTableEnum = z.enum(['knowledge_documents', 'ai_audit_log', 'ai_dashboard_generation_logs']);
export type CopilotTable = z.infer<typeof CopilotTableEnum>;

export const WidgetQuerySchema = z
  .object({
    // 'provider' → foreign data via a typed DataSourceProvider call (default).
    // 'copilot'  → parameterised SQL against a Copilot-owned, non-CMDB table.
    source: z.enum(['provider', 'copilot']).default('provider'),
    // Required for provider source (the foreign class to route + gate on); omitted
    // for copilot source (Copilot-owned facts are not one of the 14 foreign classes).
    dataClass: DataClassEnum.optional(),
    scope: ScopeSchema.default({ level: 'tenant' }),
    field: Identifier.optional(),
    aggregation: AggregationEnum.default('latest'),
    window: WindowEnum.default('24h'),
    filters: z.array(FilterSchema).max(8).default([]),
    topN: z.number().int().min(1).max(100).optional(),
    // Only meaningful when source === 'copilot'.
    copilotTable: CopilotTableEnum.optional(),
  })
  .superRefine((q, ctx) => {
    if (q.source === 'provider' && !q.dataClass) {
      ctx.addIssue({ code: 'custom', message: "source 'provider' requires dataClass" });
    }
    if (q.source === 'copilot' && !q.copilotTable) {
      ctx.addIssue({ code: 'custom', message: "source 'copilot' requires copilotTable" });
    }
    if (q.source === 'provider' && q.copilotTable) {
      ctx.addIssue({ code: 'custom', message: "copilotTable is only valid with source 'copilot'" });
    }
  });

export type WidgetQuery = z.infer<typeof WidgetQuerySchema>;
export type WidgetQueryInput = z.input<typeof WidgetQuerySchema>;
