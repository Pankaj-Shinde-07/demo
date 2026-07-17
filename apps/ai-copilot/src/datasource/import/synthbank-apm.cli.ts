/**
 * CLI entrypoint for the ADR-006 Tier-B APM seed (labeled-synthetic, demo mode).
 *
 *   npm run seed:synthbank-apm -- --tenant=<tenant-uuid>
 *
 * Idempotent + deterministic (frozen t0, no Math.random) — re-running is
 * byte-identical. Writes per-CI attributes->'apm_tier_b'; read back through
 * getServicePerformance (SeedApmDataSource), never the substrate directly.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { SynthBankApmSeedService } from './synthbank-apm.seed';

const DEFAULT_TENANT = 'cfc5801f-db4e-454c-a14a-4732d9eac48a';

function parseTenant(argv: string[]): string {
  const hit = argv.find((a) => a.startsWith('--tenant='));
  return hit ? hit.slice('--tenant='.length) : DEFAULT_TENANT;
}

async function main(): Promise<void> {
  const logger = new Logger('SynthBankApmCli');
  const tenant = parseTenant(process.argv.slice(2));
  logger.log(`Seeding SynthBank Tier-B APM for tenant ${tenant}`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const seeder = app.get(SynthBankApmSeedService);
    const summary = await seeder.seed(tenant);
    logger.log('Tier-B APM seed complete:');
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
