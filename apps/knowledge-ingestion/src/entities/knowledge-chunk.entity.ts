import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Maps the W1-owned `knowledge_chunks` table. Columns-only (no relations).
 * `embedding` (vector(1024)) and `ts_vector` (GENERATED) are intentionally
 * UNMAPPED: W2 leaves embedding NULL (W3 fills) and ts_vector is computed by
 * Postgres. Writing only the W2-owned columns keeps inserts clean.
 */
@Entity('knowledge_chunks')
export class KnowledgeChunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'document_id' })
  documentId: string;

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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
