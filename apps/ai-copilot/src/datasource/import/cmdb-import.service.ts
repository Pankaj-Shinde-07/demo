import { Injectable, Logger } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import * as XLSX from 'xlsx';
import { CanarisEmsDataSource } from '../canaris-ems.data-source';
import { ownerFromEmail } from '../owner-identity';
import type { CriticalityTier } from '../data-source.types';

export interface ImportSummary {
  tenantId: string;
  file: string;
  configurationItems: number;
  businessServices: number;
  serviceCiLinks: number;
  relationships: number;
  changeLinks: number;
  distinctOwners: number;
  unownedConfigurationItems: number;
  skipped: { serviceCiLinks: number; relationships: number; changeLinks: number };
}

interface CiRow {
  ci_id: string;
  ci_name: string;
  ci_type: string;
  criticality_tier: string;
  business_service: string | null;
  location: string | null;
  linked_asset_ref: string | null;
  technical_owner: string | null;
  business_owner: string | null;
  operations_team: string | null;
  status: string | null;
  dr_mapping: string | null;
}

/**
 * Provider-mediated CMDB import (the keystone, CP6.0 / ROADMAP T1).
 *
 * Populates the self-owned cmdb_* tables from a CMDB export workbook. This is the
 * native (Bundled-profile) population path ADR-002 describes — "the seed import
 * goes through the DataSourceProvider layer, not direct SQL FK joins". It lives
 * in the datasource module beside CanarisEmsDataSource and writes the same tables
 * the provider reads, with the provider's discipline: tenant_id on every row,
 * opaque TEXT refs (no FK to EMS), and idempotent upsert by natural key.
 *
 * Re-running is safe and additive — every write is ON CONFLICT … DO UPDATE/NOTHING
 * keyed to the table's natural-key unique index, so a second run updates in place
 * and never duplicates. It touches no knowledge_chunks.
 */
@Injectable()
export class CmdbImportService {
  private readonly logger = new Logger(CmdbImportService.name);

  constructor(
    private readonly db: DataSource,
    private readonly native: CanarisEmsDataSource,
  ) {}

  async importFromWorkbook(filePath: string, tenantId: string): Promise<ImportSummary> {
    const wb = XLSX.readFile(filePath);
    const sheet = <T>(name: string): T[] => {
      const ws = wb.Sheets[name];
      if (!ws) throw new Error(`workbook is missing required sheet '${name}'`);
      return XLSX.utils.sheet_to_json<T>(ws, { defval: null });
    };

    const services = sheet<Record<string, unknown>>('business_services');
    const cis = sheet<CiRow>('configuration_items');
    const links = sheet<Record<string, unknown>>('service_ci_links');
    const rels = sheet<Record<string, unknown>>('relationships');
    const changes = sheet<Record<string, unknown>>('change_links');

    const owners = new Set<string>();
    let unowned = 0;
    const skipped = { serviceCiLinks: 0, relationships: 0, changeLinks: 0 };

    const runner = this.db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      // 1) business_services (natural key: tenant_id, name)
      for (const s of services) {
        const bo = ownerFromEmail(s.business_owner as string | null);
        if (bo) owners.add(bo.id);
        await runner.query(
          `INSERT INTO cmdb_business_services
             (tenant_id, name, description, criticality_tier, business_owner_id,
              rto_minutes, rpo_minutes, revenue_impact_hourly, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'canaris_ems')
           ON CONFLICT (tenant_id, name) WHERE deleted_at IS NULL
           DO UPDATE SET description = EXCLUDED.description,
                         criticality_tier = EXCLUDED.criticality_tier,
                         business_owner_id = EXCLUDED.business_owner_id,
                         rto_minutes = EXCLUDED.rto_minutes,
                         rpo_minutes = EXCLUDED.rpo_minutes,
                         revenue_impact_hourly = EXCLUDED.revenue_impact_hourly,
                         updated_at = now()`,
          [
            tenantId,
            s.service_name,
            s.description ?? null,
            this.normalizeTier(s.criticality_tier as string),
            bo?.id ?? null,
            s.rto_minutes ?? null,
            s.rpo_minutes ?? null,
            s.revenue_impact_hourly_inr ?? null,
          ],
        );
      }

      // 2) configuration_items (natural key: tenant_id, source, ci_external_id)
      for (const c of cis) {
        const tech = ownerFromEmail(c.technical_owner);
        const biz = ownerFromEmail(c.business_owner);
        if (tech) owners.add(tech.id);
        if (biz) owners.add(biz.id);
        if (!tech && !biz) unowned++;

        const attributes: Record<string, unknown> = {
          location: c.location ?? null,
          status: c.status ?? null,
          dr_mapping: c.dr_mapping ?? null, // null preserves the no-DR imperfection
          business_service: c.business_service ?? null,
        };
        if (tech) attributes.technical_owner = tech;
        if (biz) attributes.business_owner = biz;

        await runner.query(
          `INSERT INTO cmdb_configuration_items
             (tenant_id, ci_external_id, ci_type, name, criticality_tier,
              technical_owner_id, business_owner_id, operations_team,
              attributes, linked_asset_ref, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,'canaris_ems')
           ON CONFLICT (tenant_id, source, ci_external_id)
             WHERE ci_external_id IS NOT NULL AND deleted_at IS NULL
           DO UPDATE SET ci_type = EXCLUDED.ci_type,
                         name = EXCLUDED.name,
                         criticality_tier = EXCLUDED.criticality_tier,
                         technical_owner_id = EXCLUDED.technical_owner_id,
                         business_owner_id = EXCLUDED.business_owner_id,
                         operations_team = EXCLUDED.operations_team,
                         attributes = EXCLUDED.attributes,
                         linked_asset_ref = EXCLUDED.linked_asset_ref,
                         updated_at = now()`,
          [
            tenantId,
            c.ci_id,
            c.ci_type,
            c.ci_name,
            this.normalizeTier(c.criticality_tier),
            tech?.id ?? null,
            biz?.id ?? null,
            c.operations_team ?? null,
            JSON.stringify(attributes),
            c.linked_asset_ref ?? null,
          ],
        );
      }

      // Resolve name → id maps for the relational sheets (names are unique).
      const serviceMap = await this.nameMap(runner, 'cmdb_business_services', tenantId);
      const ciMap = await this.nameMap(runner, 'cmdb_configuration_items', tenantId);

      // 3) service_ci_links (natural key: service_id, ci_id, COALESCE(role,''))
      for (const l of links) {
        const serviceId = serviceMap.get(l.service_name as string);
        const ciId = ciMap.get(l.ci_name as string);
        if (!serviceId || !ciId) {
          skipped.serviceCiLinks++;
          this.logger.warn(`service_ci_link unresolved: ${l.service_name} → ${l.ci_name}`);
          continue;
        }
        await runner.query(
          `INSERT INTO cmdb_service_ci_links (tenant_id, service_id, ci_id, role)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (service_id, ci_id, COALESCE(role, '')) DO NOTHING`,
          [tenantId, serviceId, ciId, (l.role as string | null) ?? null],
        );
      }

      // 4) relationships (natural key: tenant_id, source_ci_id, target_ci_id, type)
      for (const r of rels) {
        const sourceId = ciMap.get(r.source_ci as string);
        const targetId = ciMap.get(r.target_ci as string);
        if (!sourceId || !targetId || sourceId === targetId) {
          skipped.relationships++;
          continue;
        }
        await runner.query(
          `INSERT INTO cmdb_relationships
             (tenant_id, source_ci_id, target_ci_id, relationship_type, source)
           VALUES ($1,$2,$3,$4,'canaris_ems')
           ON CONFLICT (tenant_id, source_ci_id, target_ci_id, relationship_type)
           DO NOTHING`,
          [tenantId, sourceId, targetId, r.relationship_type],
        );
      }

      // 5) change_links (natural key: change_ref, ci_id, COALESCE(change_role,''))
      for (const ch of changes) {
        const ciId = ciMap.get(ch.ci_name as string);
        if (!ciId) {
          skipped.changeLinks++;
          this.logger.warn(`change_link unresolved CI: ${ch.ci_name}`);
          continue;
        }
        await runner.query(
          `INSERT INTO cmdb_change_links (tenant_id, change_ref, ci_id, change_role)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (change_ref, ci_id, COALESCE(change_role, '')) DO NOTHING`,
          [tenantId, ch.change_ref, ciId, (ch.change_role as string | null) ?? null],
        );
      }

      await runner.commitTransaction();
    } catch (err) {
      await runner.rollbackTransaction();
      throw err;
    } finally {
      await runner.release();
    }

    // Register/refresh the native provider for this tenant with the capabilities
    // that the just-imported data supports (drives the registry + completeness).
    await this.registerNativeProvider(tenantId);

    const final = await this.tableCounts(tenantId);
    return {
      tenantId,
      file: filePath,
      ...final,
      distinctOwners: owners.size,
      unownedConfigurationItems: unowned,
      skipped,
    };
  }

  private async registerNativeProvider(tenantId: string): Promise<void> {
    const caps = await this.native.cmdbCapabilities(tenantId);
    await this.db.query(
      `INSERT INTO tenant_data_sources
         (tenant_id, provider_name, provider_type, cmdb_capabilities, enabled)
       VALUES ($1, 'canaris_ems', 'native', $2::jsonb, true)
       ON CONFLICT (tenant_id, provider_name)
       DO UPDATE SET cmdb_capabilities = EXCLUDED.cmdb_capabilities,
                     provider_type = EXCLUDED.provider_type,
                     enabled = true,
                     updated_at = now()`,
      [tenantId, JSON.stringify(caps)],
    );
  }

  private async nameMap(
    runner: QueryRunner,
    table: 'cmdb_business_services' | 'cmdb_configuration_items',
    tenantId: string,
  ): Promise<Map<string, string>> {
    const rows = await runner.query(
      `SELECT id, name FROM ${table} WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId],
    );
    return new Map(rows.map((r: { id: string; name: string }) => [r.name, r.id]));
  }

  private async tableCounts(tenantId: string): Promise<{
    configurationItems: number;
    businessServices: number;
    serviceCiLinks: number;
    relationships: number;
    changeLinks: number;
  }> {
    const [row] = await this.db.query(
      `SELECT
         (SELECT count(*) FROM cmdb_configuration_items WHERE tenant_id = $1 AND deleted_at IS NULL) AS cis,
         (SELECT count(*) FROM cmdb_business_services WHERE tenant_id = $1 AND deleted_at IS NULL) AS svcs,
         (SELECT count(*) FROM cmdb_service_ci_links WHERE tenant_id = $1) AS links,
         (SELECT count(*) FROM cmdb_relationships WHERE tenant_id = $1) AS rels,
         (SELECT count(*) FROM cmdb_change_links WHERE tenant_id = $1) AS changes`,
      [tenantId],
    );
    return {
      configurationItems: Number(row.cis),
      businessServices: Number(row.svcs),
      serviceCiLinks: Number(row.links),
      relationships: Number(row.rels),
      changeLinks: Number(row.changes),
    };
  }

  /** Normalize the export's `tier_N` to the schema's CHECK value `tier-N`. */
  private normalizeTier(raw: string | null | undefined): CriticalityTier {
    const v = (raw ?? '').toLowerCase().replace(/_/g, '-');
    if (v === 'tier-1' || v === 'tier-2' || v === 'tier-3') return v;
    return 'unknown';
  }
}
