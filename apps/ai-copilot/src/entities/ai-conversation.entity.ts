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

@Entity('ai_conversations')
@Index('idx_ai_conversations_tenant_user_updated', ['tenantId', 'userId', 'updatedAt'])
export class AiConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  // UUID, no FK to public.users (Q2: users.id is INTEGER).
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'text', nullable: true })
  title: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  scope: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
