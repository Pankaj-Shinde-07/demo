// W9 / CP9.4 (D2) — natural-language dashboard generation. The LLM proposes
// STRUCTURE (a Dashboard template of approved catalogue widgets, each carrying a
// closed-DSL query); that object then flows through the SAME gate + compiler +
// resolver as a hand-authored template (CP9.3). The model never produces data, never
// reaches the DB. Worst case for a bad/adversarial prompt is a structurally-valid
// dashboard whose widgets empty-state — or the nearest persona template as fallback.
//
// Flow (P2): completeStructured → Zod-validate → one retry feeding the errors back →
// on a second failure return the nearest persona template (fallbackUsed). The
// frontend never receives unparsable output. Every attempt is logged (§4.8).

import { Injectable, Logger } from '@nestjs/common';
import { LlmGateway } from '../llm/llm-gateway.service';
import { PackLoaderService } from '../packs/pack-loader.service';
import { DataClassCapabilityService } from './data-class-capability';
import { DashboardPersistenceService } from './dashboard-persistence.service';
import {
  DashboardTemplateSchema,
  materializeDashboard,
  PERSONA_IDS,
  type Dashboard,
  type DashboardTemplate,
} from './dashboard-schema';
import { DATA_CLASSES, WIDGET_CATALOGUE, WIDGET_TYPES, type WidgetType } from './widget-catalogue';

// No request-auth user in the PoC generate path — attribute to a system principal.
const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';

export interface GenerateResult {
  proposal: Dashboard;
  generationLogId: string;
  fallbackUsed: boolean;
  /** Number of LLM attempts made (1 = first-try success, 2 = retry, 2 = then fallback). */
  attempts: number;
}

@Injectable()
export class DashboardGenerationService {
  private readonly logger = new Logger(DashboardGenerationService.name);

  constructor(
    private readonly gateway: LlmGateway,
    private readonly capability: DataClassCapabilityService,
    private readonly packs: PackLoaderService,
    private readonly persistence: DashboardPersistenceService,
  ) {}

  async generate(prompt: string, tenantId: string, pack = 'banking'): Promise<GenerateResult> {
    const available = [...(await this.capability.availableDataClasses(tenantId))];
    const templates = (await this.packs.getPack(pack)).dashboardTemplates;
    const system = this.buildSystemPrompt(available, templates);

    const attempts: unknown[] = [];
    let userPrompt = prompt;
    let lastModel = 'n/a';

    for (let i = 1; i <= 2; i++) {
      const res = await this.gateway.completeStructured<DashboardTemplate>({
        tenantId,
        feature: 'dashboard_generate',
        system,
        prompt: userPrompt,
        // No model-level json_schema (the widget union is polymorphic / not strict-
        // schema-compatible); the system prompt + this Zod validate + retry are the
        // guardrail. Worst case is a fallback template, never invalid output.
        validate: (raw) => {
          // The model proposes widgets (+ key/title/persona); the SERVER arranges the
          // 12-col layout deterministically. This removes layout-integrity (the hardest
          // constraint) from the model, so generation succeeds without dropping the
          // strict per-widget catalogue + DSL validation that follows.
          const withLayout = this.ensureLayout(raw);
          const p = DashboardTemplateSchema.safeParse(withLayout);
          return p.success ? { ok: true, data: p.data } : { ok: false, issues: p.error.issues };
        },
        model: 'sonnet',
        maxTokens: 3500,
      });
      lastModel = res.model;
      attempts.push({ attempt: i, ok: res.ok, issues: res.issues, rawExcerpt: res.raw.slice(0, 2000), auditId: res.auditId });

      if (res.ok && res.value) {
        const proposal = materializeDashboard(res.value, tenantId, this.nowIso());
        const generationLogId = await this.persistence.logGeneration({
          tenantId, userId: SYSTEM_USER, prompt, generatedJson: proposal, validationErrors: attempts, modelUsed: lastModel,
        });
        return { proposal, generationLogId, fallbackUsed: false, attempts: attempts.length };
      }
      this.logger.warn(`generate attempt ${i} failed validation (${res.issues.length} issues); ${i === 1 ? 'retrying' : 'falling back'}`);
      userPrompt =
        `${prompt}\n\nYour previous JSON FAILED validation with these errors:\n` +
        `${JSON.stringify(res.issues).slice(0, 1500)}\n` +
        `Return a corrected COMPLETE dashboard JSON that fixes every error.`;
    }

    // Double failure → nearest persona template (deterministic, always valid).
    const llmAttempts = attempts.length;
    const fallback = this.nearestTemplate(prompt, templates);
    const proposal = materializeDashboard(fallback, tenantId, this.nowIso());
    const generationLogId = await this.persistence.logGeneration({
      tenantId, userId: SYSTEM_USER, prompt, generatedJson: proposal,
      validationErrors: [...attempts, { fallbackUsed: true, fallbackKey: fallback.key }], modelUsed: lastModel,
    });
    return { proposal, generationLogId, fallbackUsed: true, attempts: llmAttempts };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  private nowIso(): string {
    return new Date().toISOString();
  }

  /** Synthesize a valid 12-col layout from the proposed widgets if the model omitted
   *  one (or gave an unusable one). Deterministic placement; the model only proposes
   *  widgets. */
  private ensureLayout(raw: unknown): unknown {
    if (!raw || typeof raw !== 'object') return raw;
    const obj = raw as Record<string, unknown>;
    const widgets = (Array.isArray(obj.widgets) ? (obj.widgets as Array<Record<string, unknown>>) : []).map((w) =>
      this.normalizeWidget(w),
    );
    const hasValidLayout =
      obj.layout && typeof obj.layout === 'object' && Array.isArray((obj.layout as { items?: unknown }).items);
    return {
      schemaVersion: 1,
      generatedBy: 'template',
      ...obj,
      widgets,
      layout: hasValidLayout ? obj.layout : this.buildLayout(widgets),
    };
  }

  /**
   * Reconcile the model's requiredDataClasses to the catalogue so a stray value can't
   * fail validation (it also can't dodge the gate — the value is REPLACED, not trusted):
   *  - fixed-class widgets: drop the field → the pinned-tuple default fills the correct set.
   *  - per-binding widgets: if missing/empty, derive from the query's dataClass.
   */
  private normalizeWidget(w: Record<string, unknown>): Record<string, unknown> {
    const type = w.type as WidgetType;
    const meta = WIDGET_CATALOGUE[type];
    if (!meta) return w;
    const out = { ...w };
    if (meta.perBinding) {
      const has = Array.isArray(out.requiredDataClasses) && (out.requiredDataClasses as unknown[]).length > 0;
      const dc = (out.query as { dataClass?: string } | undefined)?.dataClass;
      if (!has && dc) out.requiredDataClasses = [dc];
    } else {
      delete out.requiredDataClasses; // let the schema's pinned default apply
    }
    return out;
  }

  private buildLayout(widgets: Array<Record<string, unknown>>) {
    const items: { widgetId: string; x: number; y: number; w: number; h: number }[] = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i < widgets.length; i++) {
      const id = typeof widgets[i]?.id === 'string' ? (widgets[i].id as string) : `w${i}`;
      const hero = widgets[i]?.type === 'ai_narrative';
      const w = hero ? 12 : 4;
      if (x + w > 12) {
        x = 0;
        y += 4;
      }
      items.push({ widgetId: id, x, y, w, h: hero ? 3 : 4 });
      x += w;
      if (x >= 12) {
        x = 0;
        y += 4;
      }
    }
    return { grid: { cols: 12 as const }, items };
  }

  private buildSystemPrompt(available: string[], templates: DashboardTemplate[]): string {
    const catalogue = WIDGET_TYPES.map((t) => `- ${t}: ${WIDGET_CATALOGUE[t].description}`).join('\n');
    const exemplars = templates
      .map((t) => `# ${t.persona} — ${t.title}\n${JSON.stringify({ key: t.key, persona: t.persona, title: t.title, widgets: t.widgets, layout: t.layout })}`)
      .join('\n\n');
    return [
      'You are the Canaris Intelligent Dashboard Builder for a banking operations copilot.',
      'Given a user request, output ONE JSON object: a dashboard TEMPLATE. Output JSON ONLY — no prose.',
      '',
      'HARD RULES:',
      `- Use ONLY these ${WIDGET_TYPES.length} widget types (no others exist):`,
      catalogue,
      '- Each widget needs: id (unique), type (from the list), title, and a query (the DSL).',
      '- The DSL query shape: { "dataClass": <one of the data classes>, "scope": { "level": "tenant"|"ci"|"service"|"alert", "ref": "<opaque CI/service ref, optional>" }, "aggregation": "latest"|"avg"|"sum"|"count"|"min"|"max"|"p95", "window": "1h"|"24h"|"7d"|"30d"|"90d"|"all", "filters": [{ "field": "<snake_case>", "op": "eq"|"neq"|"in"|"gte"|"lte"|"contains", "value": <typed> }], "topN": <int> }.',
      `- Data classes: ${DATA_CLASSES.join(', ')}.`,
      `- This tenant can currently supply these data classes: [${available.join(', ') || 'none'}]. PREFER widgets whose data needs are in this set so the dashboard is useful; you MAY still include others (they will render an honest empty-state).`,
      '- FILTERS: a ci_type filter (e.g. value "atm_terminal", "branch_router") is valid ONLY on cmdb_ci and asset_status widgets. For metrics / alerts / change_history / topology widgets do NOT add a ci_type filter. Valid filter fields per class: cmdb_ci=[ci_type,criticality_tier,name]; asset_status=[availability_state,criticality_tier,ci_type]; alerts=[severity,metric,scenario]; business_services=[criticality_tier,name].',
      '- SCOPE (important): "overall / across all / fleet" METRIC widgets (availability %, SLA, CPU/memory/latency KPIs, metric trends, capacity forecasts, metric heat maps) MUST use scope { "level": "fleet" } — optionally { "level": "fleet", "ciType": "<type>" } to narrow by device type, or { "level": "fleet", "serviceId": "<id>" }. Use scope { "level": "ci", "ref": "CI-xxxx" } ONLY for a widget about ONE specific CI (e.g. a dependency map or topology rooted at that CI).',
      '- SERVICE widgets (service_health_map, tier_1_services_overview, business_service_health): use dataClass "business_services" with scope { "level": "tenant" }. For a tier-1-only view add filter { "field":"criticality_tier", "op":"eq", "value":"tier-1" } (the values are exactly "tier-1"/"tier-2"/"tier-3", hyphenated).',
      '- For metric trend_chart and capacity_forecast widgets, set "window": "all" so the full available history is included (a short window may show nothing).',
      '- ai_narrative needs no query. Per-binding widgets (kpi_tile, distribution_donut, heat_map, top_n_table) must declare requiredDataClasses matching their query dataClass. Other widget types fix their own requiredDataClasses — you may omit that field for them.',
      '- Provide type-specific config each widget needs: trend_chart/capacity_forecast need "metric"; ci_dependency_map needs "rootCiRef"; top_n_table needs "columns" (array); distribution_donut needs "dimension"; heat_map needs "xDimension" and "yDimension".',
      '- Do NOT emit a "layout" — the server arranges widgets on the 12-column grid. Just emit "key", "title", optional "persona", and "widgets".',
      '- persona: pick the closest of [' + PERSONA_IDS.join(', ') + '] or omit.',
      '- Never invent data, numbers, or widget types. You choose structure only.',
      '',
      'EXEMPLARS (follow this exact shape):',
      exemplars,
    ].join('\n');
  }

  /** Deterministic nearest-template fallback by keyword overlap (no LLM). */
  private nearestTemplate(prompt: string, templates: DashboardTemplate[]): DashboardTemplate {
    const p = prompt.toLowerCase();
    const KW: Record<string, string[]> = {
      ceo: ['executive', 'ceo', 'md', 'board', 'scorecard', 'digital operations'],
      cio: ['cio', 'it head', 'enterprise', 'infrastructure overview'],
      noc: ['noc', 'infrastructure', 'atm', 'network', 'real-time', 'alarm', 'topology'],
      cbs_admin: ['cbs', 'transaction', 'core banking', 'txn'],
      branch_head: ['branch', 'regional'],
      soc: ['security', 'soc', 'threat', 'attack', 'mitre', 'cyber'],
      is_auditor: ['audit', 'compliance', 'governance', 'rbi', 'patch'],
    };
    let best: { persona: string; score: number } = { persona: 'ceo', score: -1 };
    for (const [persona, words] of Object.entries(KW)) {
      const score = words.reduce((s, w) => s + (p.includes(w) ? 1 : 0), 0);
      if (score > best.score) best = { persona, score };
    }
    return templates.find((t) => t.persona === best.persona) ?? templates[0];
  }
}
