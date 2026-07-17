import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Tenant } from './tenant.entity';

@Entity('ai_dashboard_generation_logs')
@Index('idx_ai_dashboard_gen_logs_tenant_created', ['tenantId', 'createdAt'])
export class AiDashboardGenerationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  // UUID, no FK to public.users (Q2).
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'text' })
  prompt: string;

  @Column({ type: 'jsonb', name: 'generated_json' })
  generatedJson: unknown;

  @Column({ type: 'jsonb', name: 'validation_errors', default: () => "'[]'::jsonb" })
  validationErrors: unknown[];

  @Column({ type: 'jsonb', name: 'user_edits', nullable: true })
  userEdits: unknown | null;

  @Column({ type: 'uuid', name: 'saved_template_id', nullable: true })
  savedTemplateId: string | null;

  @Column({ type: 'text', name: 'model_used', nullable: true })
  modelUsed: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
