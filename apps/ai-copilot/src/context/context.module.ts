import { Module } from '@nestjs/common';
import { DataSourceModule } from '../datasource/datasource.module';
import { PackLoaderModule } from '../packs/pack-loader.module';
import { ContextEngine } from './context-engine.service';
import { CmdbGraphService } from './cmdb-graph.service';

/**
 * W6 Context Engine module. Depends on DataSourceModule and consumes the
 * DataSourceRegistry only — it never imports a concrete provider or a CMDB
 * entity, keeping the D16 boundary (provider is the only path) structural.
 */
@Module({
  imports: [DataSourceModule, PackLoaderModule],
  providers: [ContextEngine, CmdbGraphService],
  exports: [ContextEngine, CmdbGraphService],
})
export class ContextModule {}
