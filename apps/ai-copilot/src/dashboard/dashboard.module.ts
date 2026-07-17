import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSourceModule } from '../datasource/datasource.module';
import { ContextModule } from '../context/context.module';
import { IncidentModule } from '../incident/incident.module';
import { PackLoaderModule } from '../packs/pack-loader.module';
import { LlmModule } from '../llm/llm.module';
import { AiDashboardTemplate } from '../entities/ai-dashboard-template.entity';
import { AiDashboardGenerationLog } from '../entities/ai-dashboard-generation-log.entity';
import { DashboardWidgetMetadata } from '../entities/dashboard-widget-metadata.entity';
import { DashboardTilesService } from './dashboard-tiles.service';
import { BoardDigestService } from './board-digest.service';
import { DataClassCapabilityService } from './data-class-capability';
import { WidgetResolverService } from './dsl/resolver';
import { DashboardTemplateService } from './dashboard-template.service';
import { DashboardGenerationService } from './dashboard-generation.service';
import { DashboardPersistenceService } from './dashboard-persistence.service';
import { DashboardController } from './dashboard.controller';

/**
 * W9 — Dashboards + the CEO/board layer. Composes W6 traversal+D15, W8 incidents,
 * telemetry, and the pack value-model into deterministic classed tiles + the
 * bounded executive board digest. No new core reasoning, no new copilot table.
 */
@Module({
  imports: [
    DataSourceModule, ContextModule, IncidentModule, PackLoaderModule, LlmModule,
    TypeOrmModule.forFeature([AiDashboardTemplate, AiDashboardGenerationLog, DashboardWidgetMetadata]),
  ],
  controllers: [DashboardController],
  providers: [
    DashboardTilesService, BoardDigestService, DataClassCapabilityService, WidgetResolverService,
    DashboardTemplateService, DashboardGenerationService, DashboardPersistenceService,
  ],
  exports: [
    DashboardTilesService, BoardDigestService, DataClassCapabilityService, WidgetResolverService,
    DashboardTemplateService, DashboardGenerationService, DashboardPersistenceService,
  ],
})
export class DashboardModule {}
