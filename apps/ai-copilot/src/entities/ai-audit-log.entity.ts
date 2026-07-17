import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from './tenant.entity';

@Entity('ai_audit_log')
@Index('idx_ai_audit_log_tenant_timestamp', ['tenantId', 'timestamp'])
@Index('idx_ai_audit_log_tenant_feature_timestamp', ['tenantId', 'feature', 'timestamp'])
export class AiAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  timestamp: Date;

  @Column({ type: 'text' })
  feature: string;

  @Column({ type: 'text' })
  model: string;

  @Column({ type: 'text' })
  provider: string;

  @Column({ type: 'integer', name: 'input_tokens' })
  inputTokens: number;

  @Column({ type: 'integer', name: 'output_tokens' })
  outputTokens: number;

  @Column({ type: 'integer', name: 'cache_read_tokens', default: 0 })
  cacheReadTokens: number;

  @Column({ type: 'integer', name: 'cache_write_tokens', default: 0 })
  cacheWriteTokens: number;

  @Column({ type: 'integer', name: 'latency_ms' })
  latencyMs: number;

  @Index('idx_ai_audit_log_prompt_hash')
  @Column({ type: 'text', name: 'prompt_hash' })
  promptHash: string;

  @Column({ type: 'text', name: 'prompt_excerpt', nullable: true })
  promptExcerpt: string | null;

  @Column({ type: 'text', name: 'response_excerpt', nullable: true })
  responseExcerpt: string | null;

  @Column({ type: 'integer', name: 'evidence_ref_count', default: 0 })
  evidenceRefCount: number;

  @Column({ type: 'uuid', name: 'conversation_id', nullable: true })
  conversationId: string | null;

  @Column({ type: 'uuid', name: 'message_id', nullable: true })
  messageId: string | null;

  @Column({ type: 'text', name: 'error_code', nullable: true })
  errorCode: string | null;
}
