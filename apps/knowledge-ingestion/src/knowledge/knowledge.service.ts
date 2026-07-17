import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { KnowledgeDocument } from '../entities/knowledge-document.entity';
import { TenantScopedRepository } from '../common/tenant-scoped.repository';
import { UploadDocumentDto } from './dto/upload-document.dto';
import {
  INGESTION_QUEUE,
  INGEST_DOCUMENT_JOB,
  IngestDocumentJob,
} from './ingestion.constants';

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly uploadDir: string;

  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly docRepo: Repository<KnowledgeDocument>,
    @InjectQueue(INGESTION_QUEUE) private readonly queue: Queue<IngestDocumentJob>,
    config: ConfigService,
  ) {
    this.uploadDir = config.get<string>('UPLOAD_DIR', '/tmp/ki-uploads');
  }

  /** Create the document record, stage the file, and enqueue async ingestion. */
  async uploadAndQueue(
    file: { originalname: string; buffer: Buffer; size: number },
    dto: UploadDocumentDto,
  ): Promise<{ id: string; ingestion_status: string }> {
    const docs = new TenantScopedRepository(this.docRepo, dto.tenant_id);
    const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');

    let doc: KnowledgeDocument;
    try {
      doc = await docs.save({
        title: dto.title ?? file.originalname,
        documentType: dto.document_type,
        sourceFilename: file.originalname,
        sourceSizeBytes: String(file.size),
        sourceHash: hash,
        tags: dto.tags ?? [],
        metadata: {},
        ingestionStatus: 'pending',
      });
    } catch (err) {
      // FK violation → unknown tenant
      if (/foreign key|violates/i.test((err as Error).message)) {
        throw new BadRequestException(`Unknown tenant_id: ${dto.tenant_id}`);
      }
      throw err;
    }

    await fs.mkdir(this.uploadDir, { recursive: true });
    const stagedPath = path.join(this.uploadDir, `${doc.id}__${file.originalname}`);
    await fs.writeFile(stagedPath, file.buffer);
    await docs.update(
      { id: doc.id },
      { metadata: { ...doc.metadata, source_path: stagedPath } },
    );

    await this.queue.add(
      INGEST_DOCUMENT_JOB,
      { documentId: doc.id, tenantId: dto.tenant_id },
      { jobId: doc.id, attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: false },
    );

    this.logger.log(`Queued ingestion for document ${doc.id} (${dto.document_type})`);
    return { id: doc.id, ingestion_status: 'pending' };
  }

  async getStatus(id: string, tenantId: string) {
    const docs = new TenantScopedRepository(this.docRepo, tenantId);
    const doc = await docs.findOneBy({ id });
    if (!doc) throw new NotFoundException(`document ${id} not found`);
    return {
      id: doc.id,
      tenant_id: doc.tenantId,
      title: doc.title,
      document_type: doc.documentType,
      ingestion_status: doc.ingestionStatus,
      ingestion_error: doc.ingestionError,
      tags: doc.tags,
      metadata: doc.metadata,
      created_at: doc.createdAt,
      updated_at: doc.updatedAt,
    };
  }

  /** Delete a document; chunks cascade via the FK. Best-effort removes the staged file. */
  async remove(id: string, tenantId: string): Promise<{ deleted: boolean }> {
    const docs = new TenantScopedRepository(this.docRepo, tenantId);
    const doc = await docs.findOneBy({ id });
    if (!doc) throw new NotFoundException(`document ${id} not found`);
    const stagedPath = doc.metadata?.source_path as string | undefined;
    const res = await docs.delete({ id });
    if (stagedPath) {
      await fs.rm(stagedPath, { force: true }).catch(() => undefined);
    }
    return { deleted: (res.affected ?? 0) > 0 };
  }

  /** Re-enqueue ingestion (worker replaces existing chunks). */
  async reindex(id: string, tenantId: string): Promise<{ id: string; ingestion_status: string }> {
    const docs = new TenantScopedRepository(this.docRepo, tenantId);
    const doc = await docs.findOneBy({ id });
    if (!doc) throw new NotFoundException(`document ${id} not found`);
    if (!doc.metadata?.source_path) {
      throw new BadRequestException('document has no staged source file to reindex');
    }
    await docs.update({ id }, { ingestionStatus: 'pending', ingestionError: null });
    // No custom jobId here: the original upload's job (jobId = doc.id) may still
    // exist with removeOnComplete:false, and BullMQ rejects ':' in custom ids.
    // Let BullMQ auto-generate the id so each reindex is a fresh job.
    await this.queue.add(
      INGEST_DOCUMENT_JOB,
      { documentId: id, tenantId },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );
    return { id, ingestion_status: 'pending' };
  }
}
