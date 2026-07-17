import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { promises as fs } from 'node:fs';
import { Job } from 'bullmq';
import { KnowledgeDocument } from '../entities/knowledge-document.entity';
import { KnowledgeChunk } from '../entities/knowledge-chunk.entity';
import { TenantScopedRepository } from '../common/tenant-scoped.repository';
import { ParserService } from '../parsing/parser.service';
import { ChunkerService } from '../chunking/chunker.service';
import { SopCategoriesService } from './sop-categories.service';
import { IngestDocumentJob, INGESTION_QUEUE } from './ingestion.constants';

/**
 * Async ingestion worker: parse → chunk → store. Updates
 * knowledge_documents.ingestion_status across the lifecycle
 * (pending → parsing → chunking → completed | failed). Chunks land with NULL
 * embeddings (W3 fills). All reads/writes are tenant-scoped.
 */
@Processor(INGESTION_QUEUE)
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly docRepo: Repository<KnowledgeDocument>,
    @InjectRepository(KnowledgeChunk)
    private readonly chunkRepo: Repository<KnowledgeChunk>,
    private readonly parser: ParserService,
    private readonly chunker: ChunkerService,
    private readonly sopCategories: SopCategoriesService,
    private readonly dataSource: DataSource,
  ) {
    super();
  }

  async process(job: Job<IngestDocumentJob>): Promise<{ chunks: number }> {
    const { documentId, tenantId } = job.data;
    const docs = new TenantScopedRepository(this.docRepo, tenantId);
    const doc = await docs.findOneBy({ id: documentId });
    if (!doc) throw new Error(`document ${documentId} not found for tenant`);

    try {
      await docs.update({ id: documentId }, { ingestionStatus: 'parsing' });

      const sourcePath = doc.metadata?.source_path as string | undefined;
      if (!sourcePath) throw new Error('document has no source_path in metadata');
      const buffer = await fs.readFile(sourcePath);

      const parsed = await this.parser.parse({
        buffer,
        filename: doc.sourceFilename ?? doc.title,
        documentType: doc.documentType,
      });

      await docs.update({ id: documentId }, { ingestionStatus: 'chunking' });
      const chunks = this.chunker.chunk(parsed);

      // Replace any existing chunks (idempotent reindex), then insert fresh.
      const chunkScoped = new TenantScopedRepository(this.chunkRepo, tenantId);
      await chunkScoped.delete({ documentId });
      if (chunks.length > 0) {
        await this.chunkRepo.save(
          chunks.map((c) => ({
            tenantId,
            documentId,
            chunkIndex: c.chunkIndex,
            chunkText: c.chunkText,
            tokenCount: c.tokenCount,
            sectionPath: c.sectionPath,
            metadata: c.metadata,
            // embedding intentionally omitted — stays NULL (W3 fills)
          })),
          { chunk: 500 },
        );
      }

      // Document-level metadata enrichment.
      const metadata: Record<string, unknown> = { ...(doc.metadata ?? {}) };
      metadata.chunk_count = chunks.length;
      if (doc.documentType === 'cmdb_export' && parsed.metadata.cmdb_columns) {
        metadata.cmdb_columns = parsed.metadata.cmdb_columns;
      }
      if (parsed.metadata.needs_review === true) {
        metadata.needs_review = true;
      }
      // Soft categorization hint — never blocks the job.
      const industry = await this.lookupIndustry(tenantId);
      const hint = await this.sopCategories.hint(
        industry,
        `${doc.title}\n${parsed.text.slice(0, 2000)}`,
      );
      if (hint) metadata.category_hint = hint;

      // W3 §4.1: chunking done → status 'embedding' (NOT 'completed'). The
      // embedding-worker flips 'embedding' → 'completed' once every chunk of
      // this document has a vector. Intended lifecycle:
      // pending → parsing → chunking → embedding → completed.
      await docs.update(
        { id: documentId },
        { ingestionStatus: 'embedding', metadata, ingestionError: null },
      );
      this.logger.log(
        `Chunked document ${documentId}: ${chunks.length} chunk(s) → status=embedding` +
          (hint ? `, category_hint=${hint}` : ''),
      );
      return { chunks: chunks.length };
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      this.logger.error(`Ingestion failed for ${documentId}: ${message}`);
      await docs.update(
        { id: documentId },
        { ingestionStatus: 'failed', ingestionError: message },
      );
      throw err; // surface to BullMQ (job marked failed)
    }
  }

  private async lookupIndustry(tenantId: string): Promise<string> {
    try {
      const rows = await this.dataSource.query(
        'SELECT industry FROM tenants WHERE id = $1',
        [tenantId],
      );
      return rows?.[0]?.industry ?? 'default';
    } catch {
      return 'default';
    }
  }
}
