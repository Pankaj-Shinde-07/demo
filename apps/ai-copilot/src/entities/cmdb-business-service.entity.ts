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
import type { CriticalityTier } from './cmdb-configuration-item.entity';

@Entity('cmdb_business_services')
export class CmdbBusinessService {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Index('idx_cmdb_services_tenant_criticality')
  @Column({ type: 'text', name: 'criticality_tier', default: 'unknown' })
  criticalityTier: CriticalityTier;

  // UUID, no FK to public.users (Q2).
  @Column({ type: 'uuid', name: 'business_owner_id', nullable: true })
  businessOwnerId: string | null;

  @Column({ type: 'integer', name: 'rto_minutes', nullable: true })
  rtoMinutes: number | null;

  @Column({ type: 'integer', name: 'rpo_minutes', nullable: true })
  rpoMinutes: number | null;

  // Currency tracked at tenant/pack level. Returned as string by TypeORM (NUMERIC).
  @Column({ type: 'numeric', precision: 15, scale: 2, name: 'revenue_impact_hourly', nullable: true })
  revenueImpactHourly: string | null;

  @Column({ type: 'text', default: 'canaris_ems' })
  source: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
