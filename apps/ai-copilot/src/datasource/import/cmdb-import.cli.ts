/**
 * CLI entrypoint for the provider-mediated CMDB import (Deliverable A / CP6.0).
 *
 *   npm run import:cmdb -- --file=<path-to-export.xlsx> --tenant=<tenant-uuid>
 *
 * Boots a headless Nest application context (no HTTP server) so the import runs
 * through the real DI graph — the same DataSourceModule/CanarisEmsDataSource the
 * service uses at runtime. Idempotent: safe to re-run.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { CmdbImportService } from './cmdb-import.service';

const DEFAULTS = {
  file: 'test/fixtures/synthbank/synthbank-cmdb-export.xlsx',
  tenant: 'cfc5801f-db4e-454c-a14a-4732d9eac48a',
};

function parseArgs(argv: string[]): { file: string; tenant: string } {
  const get = (name: string, fallback: string) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  return { file: get('file', DEFAULTS.file), tenant: get('tenant', DEFAULTS.tenant) };
}

async function main(): Promise<void> {
  const logger = new Logger('CmdbImportCli');
  const { file, tenant } = parseArgs(process.argv.slice(2));
  logger.log(`Importing CMDB spine from '${file}' for tenant ${tenant}`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const importer = app.get(CmdbImportService);
    const summary = await importer.importFromWorkbook(file, tenant);
    logger.log('Import complete:');
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
