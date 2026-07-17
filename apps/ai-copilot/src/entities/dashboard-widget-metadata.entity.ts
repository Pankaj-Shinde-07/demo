import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

/**
 * GLOBAL widget catalogue — not tenant-scoped. The same widget vocabulary
 * is available to every tenant; the dashboard *instances* (templates) are
 * tenant-scoped. requires_cmdb drives D13 graceful degradation in W9.
 */
@Entity('dashboard_widget_metadata')
@Unique(['widgetType'])
export class DashboardWidgetMetadata {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', name: 'widget_type' })
  widgetType: string;

  @Column({ type: 'integer', name: 'schema_version', default: 1 })
  schemaVersion: number;

  @Column({ type: 'jsonb', name: 'config_schema' })
  configSchema: unknown;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', array: true, name: 'supports_data_sources' })
  supportsDataSources: string[];

  @Column({ type: 'boolean', name: 'requires_cmdb', default: false })
  requiresCmdb: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
