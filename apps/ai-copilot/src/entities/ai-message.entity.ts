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
import { AiConversation } from './ai-conversation.entity';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface EvidenceRef {
  type: 'knowledge_chunk' | 'alert' | 'ci' | 'business_service' | 'change' | string;
  id: string;
  snippet?: string;
}

@Entity('ai_messages')
@Index('idx_ai_messages_tenant_conv_created', ['tenantId', 'conversationId', 'createdAt'])
export class AiMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'conversation_id' })
  conversationId: string;

  @ManyToOne(() => AiConversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: AiConversation;

  @Column({ type: 'text' })
  role: MessageRole;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'jsonb', name: 'evidence_refs', default: () => "'[]'::jsonb" })
  evidenceRefs: EvidenceRef[];

  // 0.00 — 1.00. NUMERIC(3,2) returns string in TypeORM.
  @Column({ type: 'numeric', precision: 3, scale: 2, nullable: true })
  confidence: string | null;

  @Column({ type: 'text', name: 'model_used', nullable: true })
  modelUsed: string | null;

  @Column({ type: 'integer', name: 'input_tokens', nullable: true })
  inputTokens: number | null;

  @Column({ type: 'integer', name: 'output_tokens', nullable: true })
  outputTokens: number | null;

  @Column({ type: 'integer', name: 'cache_read_tokens', default: 0 })
  cacheReadTokens: number;

  @Column({ type: 'integer', name: 'cache_write_tokens', default: 0 })
  cacheWriteTokens: number;

  @Column({ type: 'integer', name: 'latency_ms', nullable: true })
  latencyMs: number | null;

  @Index('idx_ai_messages_tenant_feature_created')
  @Column({ type: 'text', nullable: true })
  feature: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
