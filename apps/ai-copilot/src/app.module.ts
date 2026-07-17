import { Module, Scope } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { aiCopilotEnvValidationSchema } from './config/env.validation';
import { KnowledgeDocument } from './entities/knowledge-document.entity';
import { KnowledgeDocumentRepository } from './common/repositories/knowledge-document.repository';
import { PackLoaderModule } from './packs/pack-loader.module';
import { RetrievalModule } from './retrieval/retrieval.module';
import { DataSourceModule } from './datasource/datasource.module';
import { ContextModule } from './context/context.module';
import { LlmModule } from './llm/llm.module';
import { RedisModule } from './cache/redis.module';
import { IncidentModule } from './incident/incident.module';
import { ChatModule } from './chat/chat.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: aiCopilotEnvValidationSchema,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres' as const,
        host: configService.get<string>('DATABASE_HOST'),
        port: configService.get<number>('DATABASE_PORT'),
        username: configService.get<string>('DATABASE_USER'),
        password: configService.get<string>('DATABASE_PASSWORD'),
        database: configService.get<string>('DATABASE_NAME'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        // installExtensions OFF (W6 Phase 1.5, DEFECT-1) — the TypeORM driver
        // otherwise auto-runs `CREATE EXTENSION "uuid-ossp"` (and vector) on
        // connect because the entities have @PrimaryGeneratedColumn('uuid')
        // columns. That mutates schema outside the migration set (§6.10 nick) and
        // fails to boot where the app's DB role lacks CREATE privilege (air-gap).
        // Extensions are now created solely by migration 001 (the privileged step).
        installExtensions: false,
        // synchronize is OFF unconditionally — the AI/CMDB schema is owned by the
        // SQL migrations under src/migrations/ (applied via the migrate-aicopilot
        // image). Some columns (e.g. `vector(1024)` on knowledge_chunks.embedding,
        // and the GENERATED tsvector column) are not modelled natively by TypeORM
        // 0.3, so auto-sync would attempt destructive conversions. Diverges from
        // the EMS convention (apps/itsm uses `NODE_ENV !== 'production'`); see
        // CP1.2 paste-back for rationale.
        synchronize: false,
        logging: configService.get<string>('NODE_ENV') !== 'production',
      }),
      inject: [ConfigService],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            ttl: configService.get<number>('THROTTLE_TTL', 60) * 1000,
            limit: configService.get<number>('THROTTLE_LIMIT', 100),
          },
        ],
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([KnowledgeDocument]),
    RedisModule,
    PackLoaderModule,
    RetrievalModule,
    DataSourceModule,
    ContextModule,
    LlmModule,
    IncidentModule,
    ChatModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // CP1.3: register the KnowledgeDocumentRepository token. The factory
    // throws if anything actually resolves it — the per-request tenantId
    // wiring is W5/W6 work. CP1.3's e2e test bypasses Nest DI and
    // instantiates `new KnowledgeDocumentRepository(repo, tenantId)`
    // directly. Keeping the token registered means future code that types
    // against it has a known provider symbol.
    {
      provide: KnowledgeDocumentRepository,
      scope: Scope.TRANSIENT,
      inject: [getRepositoryToken(KnowledgeDocument)],
      useFactory: (_repo: Repository<KnowledgeDocument>) => {
        throw new Error(
          'KnowledgeDocumentRepository requires a per-request tenantId. ' +
            'Until the W5/W6 request-scoped factory is wired, instantiate ' +
            'directly via `new KnowledgeDocumentRepository(repo, tenantId)`.',
        );
      },
    },
  ],
})
export class AppModule {}
