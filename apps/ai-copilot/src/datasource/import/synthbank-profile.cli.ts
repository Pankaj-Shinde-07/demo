/**
 * CLI entrypoint for the SynthBank §FROZEN profile seed (W6 Phase 2, T-SPINE-DATA).
 *
 *   npm run seed:synthbank-profile -- --tenant=<tenant-uuid>
 *
 * Boots a headless Nest context so the seed runs through the real DI graph.
 * Idempotent: safe to re-run (jsonb merge + ON CONFLICT DO NOTHING). Populates
 * the 50 branch_router CIs with the frozen customer counts (450,000 total) and
 * wires each branch to the tier-1 customer-facing service set.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { SynthBankProfileSeedService } from './synthbank-profile.seed';

const DEFAULT_TENANT = 'cfc5801f-db4e-454c-a14a-4732d9eac48a';

function parseTenant(argv: string[]): string {
  const hit = argv.find((a) => a.startsWith('--tenant='));
  return hit ? hit.slice('--tenant='.length) : DEFAULT_TENANT;
}

async function main(): Promise<void> {
  const logger = new Logger('SynthBankProfileCli');
  const tenant = parseTenant(process.argv.slice(2));
  logger.log(`Seeding SynthBank §FROZEN profile for tenant ${tenant}`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const seeder = app.get(SynthBankProfileSeedService);
    const summary = await seeder.seed(tenant);
    logger.log('Seed complete:');
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.reconciles) {
      logger.error(
        `RECONCILIATION FAILED: ${summary.branchesTotal} branches / ${summary.totalCustomers} customers (expected 50 / 450000)`,
      );
      process.exitCode = 3;
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
