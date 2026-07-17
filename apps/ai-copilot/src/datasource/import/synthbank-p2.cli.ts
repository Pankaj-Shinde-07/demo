/**
 * CLI for the SynthBank P2 behaviour seed (motion layer).
 *
 *   npm run seed:synthbank-p2 -- --tenant=<tenant-uuid>
 *
 * Idempotent + deterministic: re-running yields byte-identical scenario data
 * (arc interpolation + t0-relative timestamps). Composes onto the t=0 telemetry.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { SynthBankP2SeedService } from './synthbank-p2.seed';

const DEFAULT_TENANT = 'cfc5801f-db4e-454c-a14a-4732d9eac48a';

function parseTenant(argv: string[]): string {
  const hit = argv.find((a) => a.startsWith('--tenant='));
  return hit ? hit.slice('--tenant='.length) : DEFAULT_TENANT;
}

async function main(): Promise<void> {
  const logger = new Logger('SynthBankP2Cli');
  const tenant = parseTenant(process.argv.slice(2));
  logger.log(`Seeding SynthBank P2 behaviour scenarios for tenant ${tenant}`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const seeder = app.get(SynthBankP2SeedService);
    const summary = await seeder.seed(tenant);
    logger.log('P2 seed complete:');
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
