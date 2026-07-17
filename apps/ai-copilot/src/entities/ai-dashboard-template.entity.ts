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

@Entity('ai_dashboard_templates')
@Index('idx_ai_dashboard_templates_tenant', ['tenantId'])
export class AiDashboardTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'text' })
  name: string;

  // W9/CP9.4 — stable slug; (tenant_id, key) is the /save idempotency key.
  @Column({ type: 'text', nullable: true })
  key: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'jsonb', name: 'widget_specs' })
  widgetSpecs: unknown[];

  @Column({ type: 'jsonb', name: 'query_dsl' })
  queryDsl: unknown[];

  @Column({ type: 'text', name: 'source_pack', nullable: true })
  sourcePack: string | null;

  @Column({ type: 'boolean', name: 'created_by_ai', default: false })
  createdByAi: boolean;

  // FK back to ai_dashboard_generation_logs.id (nullable, ON DELETE SET NULL).
  @Column({ type: 'uuid', name: 'generation_log_id', nullable: true })
  generationLogId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
