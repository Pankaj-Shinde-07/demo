import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { KnowledgeDocument } from '../entities/knowledge-document.entity';
import { KnowledgeChunk } from '../entities/knowledge-chunk.entity';
import { ParserModule } from '../parsing/parser.module';
import { ChunkerModule } from '../chunking/chunker.module';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { IngestionProcessor } from './ingestion.processor';
import { SopCategoriesService } from './sop-categories.service';
import { INGESTION_QUEUE } from './ingestion.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeDocument, KnowledgeChunk]),
    BullModule.registerQueue({ name: INGESTION_QUEUE }),
    ParserModule,
    ChunkerModule,
  ],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, IngestionProcessor, SopCategoriesService],
})
export class KnowledgeModule {}
