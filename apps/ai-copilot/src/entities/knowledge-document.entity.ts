import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { Tenant } from './tenant.entity';

export type DocumentType =
  | 'manual'
  | 'sop'
  | 'rca'
  | 'runbook'
  | 'datasheet'
  | 'cmdb_export'
  | 'topology_diagram'
  | 'other';

export type IngestionStatus =
  | 'pending'
  | 'parsing'
  | 'chunking'
  | 'embedding'
  | 'completed'
  | 'failed';

@Entity('knowledge_documents')
export class KnowledgeDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'text' })
  title: string;

  @Index('idx_knowledge_documents_tenant_type')
  @Column({ type: 'text', name: 'document_type' })
  documentType: DocumentType;

  @Column({ type: 'text', name: 'source_filename', nullable: true })
  sourceFilename: string | null;

  @Column({ type: 'bigint', name: 'source_size_bytes', nullable: true })
  sourceSizeBytes: string | null;

  @Column({ type: 'text', name: 'source_hash', nullable: true })
  sourceHash: string | null;

  @Column({ type: 'text', array: true, default: () => "'{}'::text[]" })
  tags: string[];

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @Index('idx_knowledge_documents_tenant_status')
  @Column({ type: 'text', name: 'ingestion_status', default: 'pending' })
  ingestionStatus: IngestionStatus;

  @Column({ type: 'text', name: 'ingestion_error', nullable: true })
  ingestionError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
