/**
 * CLI entrypoint for the SynthBank Tier-A telemetry seed (W6 Phase 2 v2).
 *
 *   npm run seed:synthbank-telemetry -- --tenant=<tenant-uuid>
 *
 * Boots a headless Nest context so the seed runs through the real DI graph.
 * Idempotent + deterministic: re-running yields byte-identical readings (seeded
 * PRNG + frozen t0). Populates per-CI golden signals into the substrate; leaves
 * the §4 DR-mirror untelemetered on purpose.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { SynthBankTelemetrySeedService } from './synthbank-telemetry.seed';

const DEFAULT_TENANT = 'cfc5801f-db4e-454c-a14a-4732d9eac48a';

function parseTenant(argv: string[]): string {
  const hit = argv.find((a) => a.startsWith('--tenant='));
  return hit ? hit.slice('--tenant='.length) : DEFAULT_TENANT;
}

async function main(): Promise<void> {
  const logger = new Logger('SynthBankTelemetryCli');
  const tenant = parseTenant(process.argv.slice(2));
  logger.log(`Seeding SynthBank Tier-A telemetry for tenant ${tenant}`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const seeder = app.get(SynthBankTelemetrySeedService);
    const summary = await seeder.seed(tenant);
    logger.log('Telemetry seed complete:');
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
