import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CanarisEmsDataSource } from './canaris-ems.data-source';
import { CompositeDataSourceProvider } from './composite-data-source.provider';
import { ConfigCryptoService } from '../common/config-crypto.service';
import { ZabbixProviderFactory } from './zabbix/zabbix-provider.factory';
import type { ZabbixConfig } from './zabbix/zabbix.types';
import type {
  CmdbCapabilities,
  DataSourceProvider,
} from './data-source-provider.interface';

/**
 * Per-tenant registry of active DataSourceProviders, driven by the
 * `tenant_data_sources` table (D11). A tenant can have several backings (a
 * native CMDB + a Zabbix monitor + an iTop CMDB); the registry exposes the union
 * of their capabilities and — W6.5 — COMPOSES a CMDB backing with a monitoring
 * backing so the Context Engine sees one provider and never changes when the
 * telemetry backing is swapped (the synthetic→live switch).
 *
 * Phase 1 wired only the native provider (canaris_ems). W6.5 adds Zabbix
 * (monitoring), instantiated per-tenant from the encrypted `config_encrypted`.
 */
@Injectable()
export class DataSourceRegistry {
  private readonly logger = new Logger(DataSourceRegistry.name);

  constructor(
    private readonly db: DataSource,
    private readonly canarisEms: CanarisEmsDataSource,
    private readonly crypto: ConfigCryptoService,
    private readonly zabbixFactory: ZabbixProviderFactory,
  ) {}

  /** Active providers registered for a tenant, in registration order. */
  async getProviders(tenantId: string): Promise<DataSourceProvider[]> {
    const rows = await this.db.query(
      `SELECT provider_name, provider_type, config_encrypted, enabled
         FROM tenant_data_sources
        WHERE tenant_id = $1 AND enabled = true
        ORDER BY created_at`,
      [tenantId],
    );
    const providers: DataSourceProvider[] = [];
    for (const row of rows as Array<{ provider_name: string; provider_type: string; config_encrypted: string | null }>) {
      const provider = this.instantiate(row.provider_name, row.config_encrypted, tenantId);
      if (provider) providers.push(provider);
      else
        this.logger.warn(
          `tenant ${tenantId}: provider '${row.provider_name}' (${row.provider_type}) ` +
            `is registered but could not be instantiated — skipped.`,
        );
    }
    return providers;
  }

  /**
   * The provider the Context Engine consumes. When a tenant has a distinct CMDB
   * backing and monitoring (telemetry) backing, returns a composite routing
   * CMDB→CMDB backing and golden signals→monitoring backing. A single-backing
   * tenant gets that provider directly (behaviour unchanged from Phase 1/2).
   */
  async getCmdbProvider(tenantId: string): Promise<DataSourceProvider | null> {
    const providers = await this.getProviders(tenantId);
    if (providers.length === 0) return null;

    let cmdbProvider: DataSourceProvider | null = null;
    let telemetryProvider: DataSourceProvider | null = null;
    let telemetryIsMonitoring = false;
    for (const p of providers) {
      const caps = await p.cmdbCapabilities(tenantId);
      if (!cmdbProvider && caps.hasConfigurationItems) cmdbProvider = p;
      if (caps.hasGoldenSignals) {
        // Prefer a dedicated monitoring backing for telemetry over a native one.
        if (p.type === 'monitoring' && !telemetryIsMonitoring) {
          telemetryProvider = p;
          telemetryIsMonitoring = true;
        } else if (!telemetryProvider) {
          telemetryProvider = p;
        }
      }
    }

    const primary = cmdbProvider ?? providers[0];
    if (telemetryProvider && telemetryProvider !== primary) {
      return new CompositeDataSourceProvider(primary, telemetryProvider, providers);
    }
    return primary;
  }

  /** Union of CMDB capabilities across all registered providers for the tenant. */
  async combinedCmdbCapabilities(tenantId: string): Promise<CmdbCapabilities> {
    const providers = await this.getProviders(tenantId);
    const combined: CmdbCapabilities = {
      hasConfigurationItems: false,
      hasRelationshipGraph: false,
      hasBusinessServices: false,
      hasChangeLinkage: false,
      hasOwnership: false,
      hasCriticality: false,
      hasGoldenSignals: false,
    };
    for (const p of providers) {
      const caps = await p.cmdbCapabilities(tenantId);
      for (const key of Object.keys(combined) as (keyof CmdbCapabilities)[]) {
        combined[key] = combined[key] || caps[key];
      }
    }
    return combined;
  }

  private instantiate(
    providerName: string,
    configEncrypted: string | null,
    tenantId: string,
  ): DataSourceProvider | null {
    switch (providerName) {
      case 'canaris_ems':
        return this.canarisEms;
      case 'zabbix':
        return this.instantiateZabbix(configEncrypted, tenantId);
      // case 'itop': return ...;   // W6.6
      default:
        return null;
    }
  }

  /** Decrypt the per-tenant Zabbix config and build a fixture/HTTP-backed provider. */
  private instantiateZabbix(
    configEncrypted: string | null,
    tenantId: string,
  ): DataSourceProvider | null {
    if (!configEncrypted) {
      this.logger.warn(`tenant ${tenantId}: zabbix registered without config_encrypted — skipped.`);
      return null;
    }
    if (!this.crypto.available) {
      this.logger.warn(
        `tenant ${tenantId}: zabbix config present but CONFIG_ENCRYPTION_KEY unset — cannot decrypt; APM degrades to empty-state.`,
      );
      return null;
    }
    try {
      const config = this.crypto.decryptJson<ZabbixConfig>(configEncrypted);
      return this.zabbixFactory.create(config);
    } catch (err) {
      this.logger.warn(`tenant ${tenantId}: failed to read zabbix config: ${(err as Error).message}`);
      return null;
    }
  }
}
