import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PackLoaderService } from '../src/packs/pack-loader.service';
import {
  PackNotFoundError,
  PackValidationError,
} from '../src/packs/pack.types';

// CP1.4 unit tests — covered cases:
//   1. Valid pack loads
//   2. Missing industry throws PackNotFoundError
//   3. Malformed pack.yaml throws PackValidationError
//   4. Missing required content file throws PackValidationError
//   5. Missing required subdirectory throws PackValidationError
//   6. In-memory cache survives fixture deletion
//   7. Concurrent getPack() calls coalesce to one disk read
//   8. listAvailablePacks() discovers packs without loading them

async function writeValidPack(
  packsRoot: string,
  industry: string,
  version = '0.1.0',
): Promise<string> {
  const packDir = path.join(packsRoot, industry);
  await fs.mkdir(path.join(packDir, 'prompt-fragments'), { recursive: true });
  await fs.mkdir(path.join(packDir, 'dashboard-templates'), { recursive: true });
  await fs.writeFile(
    path.join(packDir, 'pack.yaml'),
    `industry: ${industry}\nversion: "${version}"\nname: "Test ${industry}"\ndescription: "Fixture pack for ${industry}"\n`,
    'utf-8',
  );
  await fs.writeFile(path.join(packDir, 'glossary.yaml'), 'terms: []\n', 'utf-8');
  await fs.writeFile(
    path.join(packDir, 'severity-rules.yaml'),
    'rules: []\n',
    'utf-8',
  );
  await fs.writeFile(
    path.join(packDir, 'cmdb-mappings.yaml'),
    'ci_types: []\ncriticality_tiers: []\nbusiness_services: []\n',
    'utf-8',
  );
  await fs.writeFile(
    path.join(packDir, 'sop-categories.yaml'),
    'categories: []\n',
    'utf-8',
  );
  return packDir;
}

async function rimraf(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true });
}

describe('PackLoaderService', () => {
  let packsRoot: string;
  const originalPacksRoot = process.env.PACKS_ROOT;

  beforeEach(async () => {
    packsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pack-loader-test-'));
    process.env.PACKS_ROOT = packsRoot;
  });

  afterEach(async () => {
    if (originalPacksRoot === undefined) {
      delete process.env.PACKS_ROOT;
    } else {
      process.env.PACKS_ROOT = originalPacksRoot;
    }
    await rimraf(packsRoot);
  });

  it('loads a valid pack', async () => {
    await writeValidPack(packsRoot, 'default');
    const svc = new PackLoaderService();
    await svc.onModuleInit();

    const pack = await svc.getPack('default');

    expect(pack.industry).toBe('default');
    expect(pack.version).toBe('0.1.0');
    expect(pack.name).toBe('Test default');
    expect(pack.description).toBe('Fixture pack for default');
    expect(pack.path).toBe(path.join(packsRoot, 'default'));
    expect(pack.glossary).toEqual({ terms: [] });
    expect(pack.severityRules).toEqual({ rules: [] });
    expect(pack.cmdbMappings).toEqual({
      ci_types: [],
      criticality_tiers: [],
      business_services: [],
    });
    expect(pack.sopCategories).toEqual({ categories: [] });
  });

  it('throws PackNotFoundError for a missing industry', async () => {
    await writeValidPack(packsRoot, 'default');
    const svc = new PackLoaderService();
    await svc.onModuleInit();

    await expect(svc.getPack('banking')).rejects.toBeInstanceOf(
      PackNotFoundError,
    );
  });

  it('throws PackValidationError when pack.yaml is missing required fields', async () => {
    await writeValidPack(packsRoot, 'default');
    // Overwrite pack.yaml with a manifest missing the required `industry` field.
    await fs.writeFile(
      path.join(packsRoot, 'default', 'pack.yaml'),
      `version: "0.1.0"\nname: "Broken"\ndescription: "Missing industry field"\n`,
      'utf-8',
    );
    const svc = new PackLoaderService();
    await svc.onModuleInit();

    let captured: unknown;
    try {
      await svc.getPack('default');
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(PackValidationError);
    const err = captured as PackValidationError;
    expect(err.issues.length).toBeGreaterThan(0);
    const issuePathPoints = err.issues
      .map((issue) =>
        Array.isArray((issue as { path?: unknown }).path)
          ? ((issue as { path: unknown[] }).path[0] as string)
          : null,
      )
      .filter(Boolean);
    expect(issuePathPoints).toContain('industry');
  });

  it('throws PackValidationError when a required content file is missing', async () => {
    await writeValidPack(packsRoot, 'default');
    await fs.rm(path.join(packsRoot, 'default', 'severity-rules.yaml'));
    const svc = new PackLoaderService();
    await svc.onModuleInit();

    await expect(svc.getPack('default')).rejects.toBeInstanceOf(
      PackValidationError,
    );
  });

  it('throws PackValidationError when a required subdirectory is missing', async () => {
    await writeValidPack(packsRoot, 'default');
    await fs.rm(path.join(packsRoot, 'default', 'prompt-fragments'), {
      recursive: true,
    });
    const svc = new PackLoaderService();
    await svc.onModuleInit();

    await expect(svc.getPack('default')).rejects.toBeInstanceOf(
      PackValidationError,
    );
  });

  it('serves the second getPack() from cache after the fixture is deleted', async () => {
    await writeValidPack(packsRoot, 'default');
    const svc = new PackLoaderService();
    await svc.onModuleInit();

    const first = await svc.getPack('default');
    expect(first.industry).toBe('default');

    // Remove the on-disk content. A non-cached implementation would now fail.
    await fs.rm(path.join(packsRoot, 'default'), { recursive: true });

    const second = await svc.getPack('default');
    expect(second).toBe(first);
  });

  it('coalesces concurrent getPack() calls to a single disk load', async () => {
    await writeValidPack(packsRoot, 'default');
    const svc = new PackLoaderService();
    await svc.onModuleInit();

    // Spy on the protected loader method. Passes through to the real impl
    // by default — we only care about call count.
    const spy = jest.spyOn(
      svc as unknown as { loadPackContents: (...args: unknown[]) => unknown },
      'loadPackContents',
    );

    const [a, b] = await Promise.all([
      svc.getPack('default'),
      svc.getPack('default'),
    ]);

    expect(a).toBe(b);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('listAvailablePacks() returns discovered packs without loading them', async () => {
    await writeValidPack(packsRoot, 'default');
    await writeValidPack(packsRoot, 'banking', '0.2.0');
    const svc = new PackLoaderService();

    const loadSpy = jest.spyOn(
      svc as unknown as { loadPackContents: (...args: unknown[]) => unknown },
      'loadPackContents',
    );

    await svc.onModuleInit();
    const packs = svc.listAvailablePacks();

    expect(packs).toHaveLength(2);
    const byIndustry = Object.fromEntries(packs.map((p) => [p.industry, p]));
    expect(byIndustry.default).toMatchObject({
      industry: 'default',
      version: '0.1.0',
      name: 'Test default',
    });
    expect(byIndustry.banking).toMatchObject({
      industry: 'banking',
      version: '0.2.0',
      name: 'Test banking',
    });
    // listAvailablePacks must not trigger pack content loading.
    expect(loadSpy).not.toHaveBeenCalled();
  });
});
