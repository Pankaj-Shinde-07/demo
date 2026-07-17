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
import { CmdbBusinessService } from './cmdb-business-service.entity';
import { CmdbConfigurationItem } from './cmdb-configuration-item.entity';

export type ServiceCiRole = 'primary' | 'backup' | 'dependency';

@Entity('cmdb_service_ci_links')
@Index('idx_cmdb_service_ci_link_tenant_service', ['tenantId', 'serviceId'])
@Index('idx_cmdb_service_ci_link_tenant_ci', ['tenantId', 'ciId'])
export class CmdbServiceCiLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'service_id' })
  serviceId: string;

  @ManyToOne(() => CmdbBusinessService, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_id' })
  service: CmdbBusinessService;

  @Column({ type: 'uuid', name: 'ci_id' })
  ciId: string;

  @ManyToOne(() => CmdbConfigurationItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ci_id' })
  ci: CmdbConfigurationItem;

  @Column({ type: 'text', nullable: true })
  role: ServiceCiRole | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
