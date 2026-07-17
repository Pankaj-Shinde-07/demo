/**
 * CLI for the SynthBank §FROZEN baseline seed (W9 CP9.2).
 *   npm run seed:synthbank-baseline -- --tenant=<tenant-uuid>
 * Idempotent. Seeds the "before-Canaris" baseline the ROI computation needs.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { SynthBankBaselineSeedService } from './synthbank-baseline.seed';

const DEFAULT_TENANT = 'cfc5801f-db4e-454c-a14a-4732d9eac48a';

async function main(): Promise<void> {
  const logger = new Logger('SynthBankBaselineCli');
  const hit = process.argv.slice(2).find((a) => a.startsWith('--tenant='));
  const tenant = hit ? hit.slice('--tenant='.length) : DEFAULT_TENANT;
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const summary = await app.get(SynthBankBaselineSeedService).seed(tenant);
    logger.log('Baseline seed complete:');
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
