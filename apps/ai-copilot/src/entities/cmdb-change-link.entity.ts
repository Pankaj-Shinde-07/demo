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
import { CmdbConfigurationItem } from './cmdb-configuration-item.entity';

export type ChangeRole = 'modified' | 'affected' | 'requested_by';

/**
 * Many-to-many between external change records (referenced by opaque change_ref)
 * and CMDB CIs. Per ADR-002, AI Copilot does not hold a Change entity — change
 * details are resolved at runtime via DataSourceProvider (D11). The DataSourceProvider
 * may point at locally-deployed Canaris EMS Core (Bundled profile), at customer's
 * external change-management system (Standalone profile), or a mix (Hybrid profile).
 */
@Entity('cmdb_change_links')
@Index('idx_cmdb_change_link_tenant_ci', ['tenantId', 'ciId'])
@Index('idx_cmdb_change_link_tenant_change', ['tenantId', 'changeRef'])
export class CmdbChangeLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  // Opaque ref to change in external source. Resolved via DataSourceProvider
  // (D11, ADR-002). Was Section 6.8's UUID FK before the 2026-05-15 realignment.
  @Column({ type: 'text', name: 'change_ref' })
  changeRef: string;

  @Column({ type: 'uuid', name: 'ci_id' })
  ciId: string;

  @ManyToOne(() => CmdbConfigurationItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ci_id' })
  ci: CmdbConfigurationItem;

  @Column({ type: 'text', name: 'change_role', nullable: true })
  changeRole: ChangeRole | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
