import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { CanarisEmsDataSource } from './canaris-ems.data-source';
import { DataSourceRegistry } from './data-source.registry';
import { CmdbImportService } from './import/cmdb-import.service';
import { SynthBankProfileSeedService } from './import/synthbank-profile.seed';
import { SynthBankTelemetrySeedService } from './import/synthbank-telemetry.seed';
import { SynthBankP2SeedService } from './import/synthbank-p2.seed';
import { SynthBankBaselineSeedService } from './import/synthbank-baseline.seed';
import { SynthBankApmSeedService } from './import/synthbank-apm.seed';
import { ConfigCryptoService } from '../common/config-crypto.service';
import { ZabbixProviderFactory } from './zabbix/zabbix-provider.factory';
import { DataSourceConfigController } from './data-source-config.controller';
import { APM_SOURCE } from './apm/apm-source.interface';
import { SeedApmDataSource } from './apm/seed-apm.data-source';
import { ProbeApmDataSource } from './apm/probe-apm.data-source';

/**
 * ADR-006 — the APM_SOURCE switch. `APM_SOURCE=probe` binds the honest-stub real
 * probe source (production, wired at client site); anything else (default 'seed')
 * binds the labeled-synthetic seed source (demo). Same interface either way.
 */
const apmSourceProvider = {
  provide: APM_SOURCE,
  useFactory: (config: ConfigService, db: DataSource) =>
    config.get<string>('APM_SOURCE', 'seed') === 'probe' ? new ProbeApmDataSource() : new SeedApmDataSource(db),
  inject: [ConfigService, DataSource],
};

/**
 * W6 DataSource layer (D11 + ADR-002). The TypeORM DataSource is provided
 * globally by the root TypeOrmModule, so the native provider and registry use
 * it directly (same pattern as RetrievalModule). Exports the registry — the
 * Context Engine depends on THAT, never on a concrete provider or a table.
 *
 * CmdbImportService is the provider-mediated population path for the native
 * (Bundled) profile — it writes the self-owned cmdb_* tables through the same
 * entities the provider reads (ADR-002: "the seed import goes through the
 * DataSourceProvider layer, not direct SQL FK joins").
 */
@Module({
  controllers: [DataSourceConfigController],
  providers: [
    apmSourceProvider,
    CanarisEmsDataSource,
    DataSourceRegistry,
    CmdbImportService,
    SynthBankProfileSeedService,
    SynthBankTelemetrySeedService,
    SynthBankP2SeedService,
    SynthBankBaselineSeedService,
    SynthBankApmSeedService,
    ConfigCryptoService,
    ZabbixProviderFactory,
  ],
  exports: [
    DataSourceRegistry,
    CanarisEmsDataSource,
    CmdbImportService,
    SynthBankProfileSeedService,
    SynthBankTelemetrySeedService,
    SynthBankP2SeedService,
    SynthBankBaselineSeedService,
    SynthBankApmSeedService,
    ConfigCryptoService,
    ZabbixProviderFactory,
  ],
})
export class DataSourceModule {}
