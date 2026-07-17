import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { KnowledgeDocument } from './knowledge-document.entity';

/**
 * Chunk of a knowledge document.
 *
 * `embedding` is `vector(1024)` at the DB layer (pgvector). TypeORM has no
 * native vector column type, so we declare it as a `text` column here for
 * scaffolding purposes — W3 will read/write it via raw `DataSource.query`,
 * not the Repository API. The HNSW index defined in the migration handles
 * similarity search.
 *
 * `tsVector` is a Postgres GENERATED column (computed from `chunkText`); the
 * column is read-only at the application layer. We mark it `select: false`
 * so it doesn't bloat default queries.
 */
@Entity('knowledge_chunks')
export class KnowledgeChunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Index('idx_knowledge_chunks_tenant_doc_idx')
  @Column({ type: 'uuid', name: 'document_id' })
  documentId: string;

  @ManyToOne(() => KnowledgeDocument, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: KnowledgeDocument;

  @Column({ type: 'integer', name: 'chunk_index' })
  chunkIndex: number;

  @Column({ type: 'text', name: 'chunk_text' })
  chunkText: string;

  @Column({ type: 'integer', name: 'token_count' })
  tokenCount: number;

  @Column({ type: 'text', array: true, name: 'section_path', default: () => "'{}'::text[]" })
  sectionPath: string[];

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  // pgvector(1024). W3 reads/writes via raw SQL; declared as text here for typing only.
  @Column({ type: 'text', nullable: true, select: false })
  embedding: string | null;

  // GENERATED tsvector column — read-only at app layer.
  @Column({ type: 'tsvector', name: 'ts_vector', select: false, insert: false, update: false, nullable: true })
  tsVector: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
