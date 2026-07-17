import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RetrievalController } from './retrieval.controller';
import { RetrievalService } from './retrieval.service';
import { EmbeddingClient } from './embedding.client';

/**
 * W4 Retrieval & RAG core. DataSource is provided globally by the root
 * TypeOrmModule, so raw vector/tsvector queries work without forFeature here.
 */
@Module({
  imports: [ConfigModule],
  controllers: [RetrievalController],
  providers: [RetrievalService, EmbeddingClient],
  exports: [RetrievalService],
})
export class RetrievalModule {}
