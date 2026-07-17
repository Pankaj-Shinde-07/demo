import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { Tenant } from './tenant.entity';

export type ProviderType = 'native' | 'monitoring' | 'cmdb';

export interface CmdbCapabilities {
  hasConfigurationItems: boolean;
  hasRelationshipGraph: boolean;
  hasBusinessServices: boolean;
  hasChangeLinkage: boolean;
  hasOwnership: boolean;
  hasCriticality: boolean;
}

@Entity('tenant_data_sources')
@Unique('uq_tenant_data_sources_provider', ['tenantId', 'providerName'])
export class TenantDataSource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'text', name: 'provider_name' })
  providerName: string;

  @Column({ type: 'text', name: 'provider_type' })
  providerType: ProviderType;

  @Column({ type: 'text', name: 'config_encrypted', nullable: true })
  configEncrypted: string | null;

  @Column({ type: 'jsonb', name: 'cmdb_capabilities', default: () => "'{}'::jsonb" })
  cmdbCapabilities: Partial<CmdbCapabilities>;

  @Index('idx_tenant_data_sources_enabled')
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
