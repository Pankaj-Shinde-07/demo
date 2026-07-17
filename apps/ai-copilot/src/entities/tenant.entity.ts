import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

export type DeploymentProfile = 'standalone' | 'hybrid' | 'full_stack';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Index('idx_tenants_industry')
  @Column({ type: 'text', default: 'default' })
  industry: string;

  @Column({ type: 'text', name: 'pack_version', nullable: true })
  packVersion: string | null;

  @Column({ type: 'text', name: 'deployment_profile', default: 'standalone' })
  deploymentProfile: DeploymentProfile;

  // Opaque ref to customer in external source. Resolved via DataSourceProvider
  // (D11, ADR-002). Was Q1-A's INTEGER FK before the 2026-05-15 realignment.
  @Index('idx_tenants_linked_customer_ref')
  @Column({ type: 'text', name: 'linked_customer_ref', nullable: true })
  linkedCustomerRef: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
