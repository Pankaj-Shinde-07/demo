import {
  Entity,
  PrimaryColumn,
  Column,
  OneToOne,
  JoinColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';

@Entity('tenant_token_budget')
export class TenantTokenBudget {
  @PrimaryColumn({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @OneToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'bigint', name: 'monthly_input_tokens_limit', nullable: true })
  monthlyInputTokensLimit: string | null; // bigint mapped as string in TypeORM

  @Column({ type: 'bigint', name: 'monthly_output_tokens_limit', nullable: true })
  monthlyOutputTokensLimit: string | null;

  @Column({ type: 'integer', name: 'soft_warn_pct', default: 80 })
  softWarnPct: number;

  @Column({ type: 'integer', name: 'hard_stop_pct', default: 100 })
  hardStopPct: number;

  @Column({ type: 'bigint', name: 'current_month_input_tokens', default: 0 })
  currentMonthInputTokens: string;

  @Column({ type: 'bigint', name: 'current_month_output_tokens', default: 0 })
  currentMonthOutputTokens: string;

  @Column({
    type: 'timestamptz',
    name: 'current_month_started_at',
    default: () => "date_trunc('month', now())",
  })
  currentMonthStartedAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
