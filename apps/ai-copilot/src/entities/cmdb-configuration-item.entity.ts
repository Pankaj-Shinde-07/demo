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

export type CriticalityTier = 'tier-1' | 'tier-2' | 'tier-3' | 'unknown';

@Entity('cmdb_configuration_items')
export class CmdbConfigurationItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'text', name: 'ci_external_id', nullable: true })
  ciExternalId: string | null;

  @Index('idx_cmdb_ci_tenant_type')
  @Column({ type: 'text', name: 'ci_type' })
  ciType: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Index('idx_cmdb_ci_tenant_criticality')
  @Column({ type: 'text', name: 'criticality_tier', default: 'unknown' })
  criticalityTier: CriticalityTier;

  // UUID, no FK to public.users (Q2).
  @Column({ type: 'uuid', name: 'technical_owner_id', nullable: true })
  technicalOwnerId: string | null;

  @Column({ type: 'uuid', name: 'business_owner_id', nullable: true })
  businessOwnerId: string | null;

  @Column({ type: 'text', name: 'operations_team', nullable: true })
  operationsTeam: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  attributes: Record<string, unknown>;

  // Opaque ref to asset in external source. Resolved via DataSourceProvider
  // (D11, ADR-002). Was Q6's UUID FK before the 2026-05-15 realignment.
  @Index('idx_cmdb_ci_linked_asset')
  @Column({ type: 'text', name: 'linked_asset_ref', nullable: true })
  linkedAssetRef: string | null;

  @Column({ type: 'text', default: 'canaris_ems' })
  source: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
