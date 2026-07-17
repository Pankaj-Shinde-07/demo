import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigCryptoService } from '../common/config-crypto.service';

const DEFAULT_TENANT = 'cfc5801f-db4e-454c-a14a-4732d9eac48a';
const PROVIDER_TYPES = ['native', 'monitoring', 'cmdb'];

interface UpsertBody {
  tenantId?: string;
  providerName: string;
  providerType: string;
  enabled?: boolean;
  config?: { endpoint?: string; token?: string; matchKey?: string; customMatchField?: string; itemMap?: Record<string, string> };
}

/**
 * W11 (CP11.5) — thin additive CRUD over `tenant_data_sources` so an operator can
 * view/switch a tenant's backings + capabilities and configure a Zabbix backing.
 * SECRETS ARE WRITE-ONLY (T-SECRET-DISPLAY): the token is encrypted at rest via
 * ConfigCryptoService and NEVER returned to the client — GET reports only
 * `tokenSet: true/false`. No schema change (the table + crypto already exist).
 */
@Controller('api/v1/ai/data-sources')
export class DataSourceConfigController {
  constructor(
    private readonly db: DataSource,
    private readonly crypto: ConfigCryptoService,
  ) {}

  /** List a tenant's backings — config sanitized (no secret ever returned). */
  @Get()
  async list(@Query('tenant') tenant = DEFAULT_TENANT) {
    const rows = await this.db.query(
      `SELECT provider_name, provider_type, enabled, cmdb_capabilities, config_encrypted
         FROM tenant_data_sources WHERE tenant_id = $1 ORDER BY created_at`,
      [tenant],
    );
    return {
      tenantId: tenant,
      cryptoAvailable: this.crypto.available,
      providers: rows.map((r: Record<string, unknown>) => ({
        providerName: r.provider_name,
        providerType: r.provider_type,
        enabled: r.enabled,
        capabilities: r.cmdb_capabilities ?? {},
        config: this.sanitize(r.config_encrypted as string | null),
      })),
    };
  }

  /** Create/update a backing. `config.token` is accepted but never echoed back. */
  @Post()
  async upsert(@Body() body: UpsertBody) {
    const tenant = body.tenantId ?? DEFAULT_TENANT;
    if (!body.providerName) throw new BadRequestException('providerName is required');
    if (!PROVIDER_TYPES.includes(body.providerType)) throw new BadRequestException(`providerType must be one of ${PROVIDER_TYPES.join(', ')}`);

    let configEncrypted: string | null = null;
    if (body.config) {
      // Merge with any existing config so an omitted token is PRESERVED, not wiped.
      const existing = await this.existingConfig(tenant, body.providerName);
      const merged = { ...existing, ...stripUndefined(body.config) };
      if (!merged.token && existing?.token) merged.token = existing.token; // keep secret
      if (!this.crypto.available && merged.token) {
        throw new BadRequestException('CONFIG_ENCRYPTION_KEY is not set; cannot store a secret token');
      }
      configEncrypted = Object.keys(merged).length ? this.crypto.encryptJson(merged) : null;
    }

    await this.db.query(
      `INSERT INTO tenant_data_sources (tenant_id, provider_name, provider_type, config_encrypted, enabled)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, provider_name)
       DO UPDATE SET provider_type = EXCLUDED.provider_type,
                     config_encrypted = COALESCE(EXCLUDED.config_encrypted, tenant_data_sources.config_encrypted),
                     enabled = EXCLUDED.enabled, updated_at = now()`,
      [tenant, body.providerName, body.providerType, configEncrypted, body.enabled ?? true],
    );
    return { ok: true, tenantId: tenant, providerName: body.providerName, secretStored: !!body.config?.token };
  }

  /** Enable/disable a backing (the switch made operable). */
  @Patch(':providerName/enabled')
  async setEnabled(@Param('providerName') providerName: string, @Body() body: { tenantId?: string; enabled: boolean }) {
    const tenant = body.tenantId ?? DEFAULT_TENANT;
    await this.db.query(`UPDATE tenant_data_sources SET enabled = $3, updated_at = now() WHERE tenant_id = $1 AND provider_name = $2`, [tenant, providerName, body.enabled]);
    return { ok: true, tenantId: tenant, providerName, enabled: body.enabled };
  }

  // ── helpers ──────────────────────────────────────────────────────────────────
  /** Decrypt → strip the secret → expose only non-secret fields + tokenSet. */
  private sanitize(blob: string | null): Record<string, unknown> {
    if (!blob) return { tokenSet: false };
    if (!this.crypto.available) return { tokenSet: true, note: 'encrypted (key not loaded)' };
    try {
      const c = this.crypto.decryptJson<Record<string, unknown>>(blob);
      const { token, ...rest } = c; // NEVER return the token
      void token;
      return { ...rest, tokenSet: typeof c.token === 'string' && (c.token as string).length > 0 };
    } catch {
      return { tokenSet: true, note: 'unreadable config blob' };
    }
  }

  private async existingConfig(tenant: string, providerName: string): Promise<Record<string, any> | null> {
    if (!this.crypto.available) return null;
    const [row] = await this.db.query(`SELECT config_encrypted FROM tenant_data_sources WHERE tenant_id = $1 AND provider_name = $2`, [tenant, providerName]);
    if (!row?.config_encrypted) return null;
    try {
      return this.crypto.decryptJson<Record<string, any>>(row.config_encrypted);
    } catch {
      return null;
    }
  }
}

function stripUndefined<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
