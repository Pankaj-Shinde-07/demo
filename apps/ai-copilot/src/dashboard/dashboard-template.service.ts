// W9 / CP9.3b — the persona-template read service. Serves the active pack's
// validated templates and renders one against a tenant by resolving every widget
// through the CP9.2 resolver (live value or honest empty-state). DETERMINISTIC: no
// LLM on this path (the ai_narrative widget is the only gateway-backed element, and
// its honesty is enforced at the gateway, not here).

import { Injectable, NotFoundException } from '@nestjs/common';
import { PackLoaderService } from '../packs/pack-loader.service';
import { materializeDashboard, type Dashboard, type DashboardTemplate } from './dashboard-schema';
import { WidgetResolverService, type WidgetData } from './dsl/resolver';
import type { DataClass } from './widget-catalogue';

export interface RenderedWidget {
  id: string;
  type: string;
  title: string;
  requiredDataClasses: DataClass[];
  status: 'live' | 'empty';
  count: number | null;
  /** For live: what resolved. For empty: the accurate reason (gate gap / not_resolvable). */
  detail: string;
  /** The renderable payload for a live widget (undefined for empty-states). */
  data?: WidgetData;
}

export interface RenderedDashboard {
  key: string;
  persona?: string;
  title: string;
  tenantId: string;
  pack: string;
  layout: DashboardTemplate['layout'];
  widgets: RenderedWidget[];
  liveCount: number;
  emptyCount: number;
}

@Injectable()
export class DashboardTemplateService {
  constructor(
    private readonly packs: PackLoaderService,
    private readonly resolver: WidgetResolverService,
  ) {}

  /** The active pack's validated persona templates (unresolved). */
  async listTemplates(pack: string): Promise<DashboardTemplate[]> {
    const loaded = await this.packs.getPack(pack);
    return loaded.dashboardTemplates;
  }

  async getTemplate(pack: string, key: string): Promise<DashboardTemplate> {
    const templates = await this.listTemplates(pack);
    const tmpl = templates.find((t) => t.key === key);
    if (!tmpl) throw new NotFoundException(`dashboard template '${key}' not found in pack '${pack}'`);
    return tmpl;
  }

  /** Render a template for a tenant — every widget resolved to live or empty-state. */
  async render(pack: string, key: string, tenantId: string): Promise<RenderedDashboard> {
    const tmpl = await this.getTemplate(pack, key);
    const dashboard = materializeDashboard(tmpl, tenantId, new Date().toISOString());
    return this.renderDashboard(dashboard, pack);
  }

  /**
   * Render an arbitrary (already-materialised) Dashboard — used by the generate panel
   * to preview a proposal before save. Every widget resolved to live or empty-state.
   */
  async renderDashboard(dashboard: Dashboard, pack = '-'): Promise<RenderedDashboard> {
    const widgets: RenderedWidget[] = [];
    for (const w of dashboard.widgets) {
      const r = await this.resolver.resolve(w, dashboard.tenantId);
      widgets.push({
        id: w.id,
        type: w.type,
        title: w.title,
        requiredDataClasses: w.requiredDataClasses,
        status: r.status,
        count: r.count,
        detail: r.detail,
        data: r.data,
      });
    }
    return {
      key: dashboard.key,
      persona: dashboard.persona,
      title: dashboard.title,
      tenantId: dashboard.tenantId,
      pack,
      layout: dashboard.layout,
      widgets,
      liveCount: widgets.filter((w) => w.status === 'live').length,
      emptyCount: widgets.filter((w) => w.status === 'empty').length,
    };
  }
}
