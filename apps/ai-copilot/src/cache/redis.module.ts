import {
  Global,
  Inject,
  Module,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/** DI token for the shared ioredis client (W6 Phase 2, CP6.3). */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * W6 Phase 2 (CP6.3) — wires `ems-ai-copilot` to `ems-ai-redis` (the deferred
 * Phase-1 wiring). Provides a single shared ioredis client. Connection is lazy
 * and resilient: `lazyConnect` + `maxRetriesPerRequest` bounded so a Redis
 * outage surfaces as a fast error the cache layer catches (best-effort cache,
 * never a wrong answer) rather than hanging the request.
 *
 * Global so any feature module (the CMDB graph cache today; W7/W8 later) can
 * inject REDIS_CLIENT without re-importing.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logger = new Logger('RedisClient');
        const client = new Redis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          lazyConnect: true,
          maxRetriesPerRequest: 2,
          enableOfflineQueue: false,
          retryStrategy: (times) => Math.min(times * 200, 2000),
        });
        client.on('error', (err) =>
          logger.warn(`Redis error (cache degrades to compute): ${err.message}`),
        );
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}
  async onModuleDestroy(): Promise<void> {
    // Quit cleanly so a CLI run (seed/canary) exits instead of hanging on an
    // open socket. quit() is a no-op if the client never connected.
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
