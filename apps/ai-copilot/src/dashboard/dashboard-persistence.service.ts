// W9 / CP9.4 (D3) — persistence for generation logs + saved dashboards. Closes
// discovery M8 (the three dashboard tables existed but had no repository wiring).
// The generation log records EVERY attempt's validation outcome (audit trail §4.8);
// save is idempotent on (tenant_id, key) via the CP9.4 partial unique index.

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AiDashboardGenerationLog } from '../entities/ai-dashboard-generation-log.entity';
import { AiDashboardTemplate } from '../entities/ai-dashboard-template.entity';
import type { Dashboard } from './dashboard-schema';

export interface GenerationLogInput {
  tenantId: string;
  userId: string;
  prompt: string;
  generatedJson: unknown;
  validationErrors: unknown[];
  modelUsed: string;
}

@Injectable()
export class DashboardPersistenceService {
  constructor(
    @InjectRepository(AiDashboardGenerationLog) private readonly genLogs: Repository<AiDashboardGenerationLog>,
    @InjectRepository(AiDashboardTemplate) private readonly templates: Repository<AiDashboardTemplate>,
    private readonly db: DataSource,
  ) {}

  /** One row per /generate call: prompt, final JSON, per-attempt validation errors, model. */
  async logGeneration(input: GenerationLogInput): Promise<string> {
    const row = this.genLogs.create({
      tenantId: input.tenantId,
      userId: input.userId,
      prompt: input.prompt,
      generatedJson: input.generatedJson,
      validationErrors: input.validationErrors,
      modelUsed: input.modelUsed,
    });
    const saved = await this.genLogs.save(row);
    return saved.id;
  }

  /**
   * Idempotent save of a reviewed Dashboard. (tenant_id, key) upserts; re-saving an
   * identical proposal updates in place (one row), never duplicates (P4). Returns
   * whether the row was newly inserted (xmax=0) for the idempotency proof.
   */
  async saveDashboard(
    dashboard: Dashboard,
    pack: string,
    generationLogId: string | null,
    userEdits: unknown | null,
  ): Promise<{ id: string; inserted: boolean }> {
    const widgetSpecs = JSON.stringify({
      persona: dashboard.persona ?? null,
      layout: dashboard.layout,
      widgets: dashboard.widgets,
    });
    const queryDsl = JSON.stringify(dashboard.widgets.map((w) => ({ id: w.id, query: w.query ?? null })));

    const rows: Array<{ id: string; inserted: boolean }> = await this.db.query(
      `INSERT INTO ai_dashboard_templates
         (tenant_id, key, name, widget_specs, query_dsl, source_pack, created_by_ai, generation_log_id)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, true, $7)
       ON CONFLICT (tenant_id, key) WHERE deleted_at IS NULL AND key IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name,
                     widget_specs = EXCLUDED.widget_specs,
                     query_dsl = EXCLUDED.query_dsl,
                     source_pack = EXCLUDED.source_pack,
                     generation_log_id = EXCLUDED.generation_log_id,
                     updated_at = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [dashboard.tenantId, dashboard.key, dashboard.title, widgetSpecs, queryDsl, pack, generationLogId],
    );
    const { id, inserted } = rows[0];

    if (generationLogId) {
      await this.db.query(
        `UPDATE ai_dashboard_generation_logs
            SET saved_template_id = $1${userEdits ? ', user_edits = $3::jsonb' : ''}
          WHERE id = $2`,
        userEdits ? [id, generationLogId, JSON.stringify(userEdits)] : [id, generationLogId],
      );
    }
    return { id, inserted };
  }

  /** Used by tests/CLIs to read back a saved row. */
  async getByKey(tenantId: string, key: string): Promise<AiDashboardTemplate | null> {
    return this.templates.findOne({ where: { tenantId, key } });
  }
}
