// W9 / CP9.1 — the Dashboard envelope (design contract §2). This is the single
// validation root that BOTH tracks target:
//   - CP9.3 templates are hand-authored Dashboard objects (deterministic, no LLM).
//   - CP9.4 generation emits a Dashboard through the LlmGateway, Zod-validated here;
//     one retry on failure, safe fallback on the second (addendum §4.2).
// (tenantId, key) is the idempotency key for /save (CP9.4).

import { z } from 'zod';
import { WidgetSchema, type Widget } from './widget-schemas';

/** The seven persona templates (design §5). Optional on ad-hoc generated boards. */
export const PERSONA_IDS = [
  'ceo',
  'cio',
  'noc',
  'cbs_admin',
  'branch_head',
  'soc',
  'is_auditor',
] as const;
export type PersonaId = (typeof PERSONA_IDS)[number];
export const PersonaIdEnum = z.enum(PERSONA_IDS);

/** Fixed 12-column grid (L3). A layout item places one widget by its id. */
export const GRID_COLS = 12 as const;

export const LayoutItemSchema = z.object({
  widgetId: z.string().min(1), // references Widget.id
  x: z.number().int().min(0).max(GRID_COLS - 1),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(GRID_COLS),
  h: z.number().int().min(1).max(64),
});
export type LayoutItem = z.infer<typeof LayoutItemSchema>;

// Fields shared by a saved Dashboard and a (tenant-agnostic) pack template.
const DashboardCommonShape = {
  schemaVersion: z.literal(1),
  key: z.string().min(1).max(120), // stable slug; (tenantId, key) is the save idempotency key
  title: z.string().min(1).max(200),
  persona: PersonaIdEnum.optional(),
  description: z.string().max(2000).optional(),
  layout: z.object({
    grid: z.object({ cols: z.literal(GRID_COLS) }),
    items: z.array(LayoutItemSchema),
  }),
  widgets: z.array(WidgetSchema),
};

// Structural integrity: every layout item must reference a declared widget, and
// every widget must be placed exactly once. Caught here so a malformed template or
// generation never reaches the renderer. Shared by both schemas below.
const layoutIntegrity = (
  dash: { widgets: { id: string }[]; layout: { items: { widgetId: string; x: number; w: number }[] } },
  ctx: z.RefinementCtx,
): void => {
  const widgetIds = dash.widgets.map((w) => w.id);
  const idSet = new Set(widgetIds);
  if (idSet.size !== widgetIds.length) {
    ctx.addIssue({ code: 'custom', message: 'duplicate widget id within dashboard' });
  }
  const placed = new Set<string>();
  for (const item of dash.layout.items) {
    if (!idSet.has(item.widgetId)) {
      ctx.addIssue({ code: 'custom', message: `layout item references unknown widgetId '${item.widgetId}'` });
    }
    if (placed.has(item.widgetId)) {
      ctx.addIssue({ code: 'custom', message: `widget '${item.widgetId}' placed more than once` });
    }
    placed.add(item.widgetId);
    if (item.x + item.w > GRID_COLS) {
      ctx.addIssue({
        code: 'custom',
        message: `layout item '${item.widgetId}' overflows the ${GRID_COLS}-col grid (x+w=${item.x + item.w})`,
      });
    }
  }
  for (const id of idSet) {
    if (!placed.has(id)) {
      ctx.addIssue({ code: 'custom', message: `widget '${id}' is declared but never placed in layout` });
    }
  }
};

/** A saved/generated dashboard — tenant-bound, timestamped. */
export const DashboardSchema = z
  .object({
    ...DashboardCommonShape,
    // A general UUID shape (any hex) — tenant ids come from the system/DB, which is
    // laxer than RFC version/variant rules; z.uuid() would reject valid Postgres uuids.
    tenantId: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, 'tenantId must be a UUID'),
    generatedBy: z.enum(['template', 'nl_generation']),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine(layoutIntegrity);

export type Dashboard = z.infer<typeof DashboardSchema>;
export type DashboardInput = z.input<typeof DashboardSchema>;

/**
 * A pack persona template (CP9.3): the same envelope MINUS tenantId/timestamps,
 * which are injected at render/save. Deterministic — no LLM on this path.
 */
export const DashboardTemplateSchema = z
  .object({
    ...DashboardCommonShape,
    generatedBy: z.literal('template').default('template'),
  })
  .superRefine(layoutIntegrity);

export type DashboardTemplate = z.infer<typeof DashboardTemplateSchema>;
export type DashboardTemplateInput = z.input<typeof DashboardTemplateSchema>;

/** Materialise a pack template into a tenant-bound Dashboard at render time. */
export function materializeDashboard(
  template: DashboardTemplate,
  tenantId: string,
  nowIso: string,
): Dashboard {
  return { ...template, tenantId, generatedBy: 'template', createdAt: nowIso, updatedAt: nowIso };
}

/** Re-export for callers that build dashboards programmatically. */
export type { Widget };
