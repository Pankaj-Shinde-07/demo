import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Unique,
  Index,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { AiMessage } from './ai-message.entity';

@Entity('ai_feedback')
@Unique('uq_ai_feedback_message_user', ['messageId', 'userId'])
export class AiFeedback {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_ai_feedback_tenant_created')
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'message_id' })
  messageId: string;

  @ManyToOne(() => AiMessage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message: AiMessage;

  // UUID, no FK to public.users (Q2).
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  // -1 = thumbs down | 0 = neutral/cleared | 1 = thumbs up
  @Column({ type: 'smallint' })
  rating: number;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
