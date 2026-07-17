import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { CmdbConfigurationItem } from './cmdb-configuration-item.entity';

export type RelationshipType =
  | 'runs_on'
  | 'depends_on'
  | 'connected_to'
  | 'hosts'
  | 'contains';

@Entity('cmdb_relationships')
@Index('idx_cmdb_rel_source', ['tenantId', 'sourceCiId'])
@Index('idx_cmdb_rel_target', ['tenantId', 'targetCiId'])
export class CmdbRelationship {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'source_ci_id' })
  sourceCiId: string;

  @ManyToOne(() => CmdbConfigurationItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_ci_id' })
  sourceCi: CmdbConfigurationItem;

  @Column({ type: 'uuid', name: 'target_ci_id' })
  targetCiId: string;

  @ManyToOne(() => CmdbConfigurationItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'target_ci_id' })
  targetCi: CmdbConfigurationItem;

  @Column({ type: 'text', name: 'relationship_type' })
  relationshipType: RelationshipType;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @Column({ type: 'text', default: 'canaris_ems' })
  source: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
