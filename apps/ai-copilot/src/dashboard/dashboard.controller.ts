import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { BoardDigestService } from './board-digest.service';
import { DashboardTemplateService, type RenderedDashboard } from './dashboard-template.service';
import { DashboardGenerationService, type GenerateResult } from './dashboard-generation.service';
import { DashboardPersistenceService } from './dashboard-persistence.service';
import { DashboardSchema, type Dashboard, type DashboardTemplate } from './dashboard-schema';
import type { BoardDigest } from './dashboard.types';

const DEFAULT_TENANT = 'cfc5801f-db4e-454c-a14a-4732d9eac48a';

/**
 * W11 — thin READ API over the W9 dashboard/digest data (was CLI-only). Additive,
 * no schema change; the UI renders these classed tiles. Every figure already
 * carries its ADR-005 class + grounding (the honesty signals the UI surfaces).
 */
@Controller('api/v1/ai/dashboard')
export class DashboardController {
  constructor(
    private readonly digest: BoardDigestService,
    private readonly templates: DashboardTemplateService,
    private readonly generation: DashboardGenerationService,
    private readonly persistence: DashboardPersistenceService,
  ) {}

  /** W9/CP9.4 — natural-language generation. The LLM proposes a Dashboard of approved
   *  catalogue widgets (closed-DSL queries) via the gateway; Zod-validated, one retry,
   *  nearest-template fallback. The proposal can ONLY show real data downstream. */
  @Post('generate')
  async generate(
    @Body() body: { prompt: string; tenant?: string; pack?: string },
  ): Promise<GenerateResult> {
    if (!body?.prompt || typeof body.prompt !== 'string') {
      throw new BadRequestException('prompt is required');
    }
    return this.generation.generate(body.prompt, body.tenant ?? DEFAULT_TENANT, body.pack ?? 'banking');
  }

  /** W9/CP9.4 — resolve an arbitrary (generated) Dashboard proposal to live/empty
   *  widget states for preview, before save. Deterministic (no LLM on this path). */
  @Post('resolve')
  async resolve(@Body() body: { dashboard: Dashboard }): Promise<RenderedDashboard> {
    const parsed = DashboardSchema.safeParse(body?.dashboard);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'invalid dashboard', issues: parsed.error.issues });
    }
    return this.templates.renderDashboard(parsed.data);
  }

  /** W9/CP9.4 — persist a (reviewed) Dashboard. Idempotent on (tenant, key). */
  @Post('save')
  async save(
    @Body() body: { dashboard: Dashboard; pack?: string; generationLogId?: string; userEdits?: unknown },
  ): Promise<{ id: string; key: string; inserted: boolean }> {
    const parsed = DashboardSchema.safeParse(body?.dashboard);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'invalid dashboard', issues: parsed.error.issues });
    }
    const r = await this.persistence.saveDashboard(
      parsed.data,
      body.pack ?? 'banking',
      body.generationLogId ?? null,
      body.userEdits ?? null,
    );
    return { id: r.id, key: parsed.data.key, inserted: r.inserted };
  }

  /** W9/CP9.3 — the active pack's persona templates (validated, unresolved). */
  @Get('templates')
  async listTemplates(@Query('pack') pack = 'banking'): Promise<{ pack: string; templates: DashboardTemplate[] }> {
    return { pack, templates: await this.templates.listTemplates(pack) };
  }

  /** W9/CP9.3 — render one persona template for a tenant: every widget resolved to a
   *  live value or an honest empty-state. Deterministic (no LLM on this path). */
  @Get('templates/:key')
  async renderTemplate(
    @Param('key') key: string,
    @Query('tenant') tenant = DEFAULT_TENANT,
    @Query('pack') pack = 'banking',
  ): Promise<RenderedDashboard> {
    return this.templates.render(pack, key, tenant);
  }

  /** The deterministic tiles (no LLM) — fast; the dashboard page polls this. */
  @Get()
  async tiles(@Query('tenant') tenant = DEFAULT_TENANT, @Query('pack') pack = 'banking'): Promise<BoardDigest> {
    return this.digest.assemble(tenant, pack, new Date().toISOString());
  }

  /** The board digest WITH the bounded executive narrative (LLM). Narrative is
   *  cached per tenant + served instantly; ?regenerate=true forces a fresh run. */
  @Get('digest')
  async board(@Query('tenant') tenant = DEFAULT_TENANT, @Query('pack') pack = 'banking', @Query('regenerate') regenerate?: string): Promise<BoardDigest> {
    return this.digest.assembleWithNarrative(tenant, pack, new Date().toISOString(), regenerate === 'true' || regenerate === '1');
  }
}
