import { Module } from '@nestjs/common';
import { DataSourceModule } from '../datasource/datasource.module';
import { ContextModule } from '../context/context.module';
import { PackLoaderModule } from '../packs/pack-loader.module';
import { LlmModule } from '../llm/llm.module';
import { IncidentReasoningService } from './incident-reasoning.service';
import { IncidentNarrationService } from './incident-narration.service';

/**
 * W8 incident-reasoning module. The DETERMINISTIC reasoning (IncidentReasoning)
 * consumes the datasource provider + the CmdbGraphService traversal; the
 * narration (IncidentNarration) routes through the W5 gateway. Depends on the
 * existing context/datasource/llm/pack modules — no new schema.
 */
@Module({
  imports: [DataSourceModule, ContextModule, PackLoaderModule, LlmModule],
  providers: [IncidentReasoningService, IncidentNarrationService],
  exports: [IncidentReasoningService, IncidentNarrationService],
})
export class IncidentModule {}
