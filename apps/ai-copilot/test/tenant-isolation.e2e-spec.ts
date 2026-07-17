import * as fs from 'node:fs';
import * as path from 'node:path';
import { DataSource, Repository } from 'typeorm';
import { KnowledgeDocument } from '../src/entities/knowledge-document.entity';
import { Tenant } from '../src/entities/tenant.entity';
import { TenantScopedRepository } from '../src/common/tenant-scoped.repository';

// Two deterministic UUIDv4 strings — version digit 4, variant digit 8.
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

describe('Tenant isolation — adversarial probes (CP1.3)', () => {
  let dataSource: DataSource;
  let rawRepo: Repository<KnowledgeDocument>;
  let repoA: TenantScopedRepository<KnowledgeDocument>;
  let repoB: TenantScopedRepository<KnowledgeDocument>;
  let docAId: string;
  let docBId: string;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.TEST_DATABASE_HOST ?? 'localhost',
      port: Number(process.env.TEST_DATABASE_PORT ?? 5434),
      username: process.env.TEST_DATABASE_USER ?? 'ems_test',
      password: process.env.TEST_DATABASE_PASSWORD ?? 'ems_test',
      database: process.env.TEST_DATABASE_NAME ?? 'ems_test',
      entities: [KnowledgeDocument, Tenant],
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();

    // Apply CP1.1 SQL migrations in lexical order. The migrate-aicopilot
    // image is the canonical runner in prod; here we apply the same files
    // via DataSource.query() so the test harness stays in-process (no
    // second container, no psql client on the host).
    const migrationsDir = path.resolve(__dirname, '../src/migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await dataSource.query(sql);
    }

    // Seed two tenants. Documents reference these via FK; isolation tests
    // assume both rows exist throughout the suite.
    await dataSource.query(
      'INSERT INTO tenants (id, name) VALUES ($1, $2), ($3, $4)',
      [TENANT_A, 'Tenant A', TENANT_B, 'Tenant B'],
    );

    rawRepo = dataSource.getRepository(KnowledgeDocument);
  }, 60_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE knowledge_documents CASCADE');

    const docA = await rawRepo.save({
      tenantId: TENANT_A,
      title: 'A-doc',
      documentType: 'manual',
    });
    const docB = await rawRepo.save({
      tenantId: TENANT_B,
      title: 'B-doc',
      documentType: 'manual',
    });
    docAId = docA.id;
    docBId = docB.id;

    repoA = new TenantScopedRepository<KnowledgeDocument>(rawRepo, TENANT_A);
    repoB = new TenantScopedRepository<KnowledgeDocument>(rawRepo, TENANT_B);
  });

  // Probe 1 — Baseline read isolation.
  it('Probe 1: find() from tenantA returns only tenantA rows', async () => {
    const rows = await repoA.find();
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe(TENANT_A);
    expect(rows[0].id).toBe(docAId);
  });

  // Probe 2 — Cross-tenant PK lookup returns null.
  it('Probe 2: findOneBy({ id: tenantB_doc }) from tenantA returns null', async () => {
    const row = await repoA.findOneBy({ id: docBId });
    expect(row).toBeNull();
  });

  // Probe 3 — Caller-supplied tenantId in where is structurally overwritten.
  it('Probe 3: find({ where: { tenantId: TENANT_B } }) from tenantA returns A rows, not B', async () => {
    const rows = await repoA.find({ where: { tenantId: TENANT_B } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe(TENANT_A);
    expect(rows[0].id).toBe(docAId);
  });

  // Probe 4 — save() overwrites caller's tenantId.
  it('Probe 4: save({ tenantId: TENANT_B, ... }) from tenantA persists with tenantA', async () => {
    const saved = await repoA.save({
      tenantId: TENANT_B,
      title: 'injected',
      documentType: 'manual',
    });
    expect(saved.tenantId).toBe(TENANT_A);

    // Verify directly in DB — not via the scoped repo (which would filter).
    const fresh = await rawRepo.findOneBy({ id: saved.id });
    expect(fresh).not.toBeNull();
    expect(fresh!.tenantId).toBe(TENANT_A);
  });

  // Probe 5 — Cross-tenant delete is a no-op; the foreign row survives.
  it('Probe 5: delete({ id: tenantB_doc }) from tenantA deletes zero rows', async () => {
    const result = await repoA.delete({ id: docBId });
    expect(result.affected).toBe(0);

    const tenantBStill = await rawRepo.findOneBy({ id: docBId });
    expect(tenantBStill).not.toBeNull();
    expect(tenantBStill!.tenantId).toBe(TENANT_B);
  });

  // Probe 6 — Cross-tenant update is a no-op.
  it('Probe 6: update({ id: tenantB_doc }, ...) from tenantA updates zero rows', async () => {
    const result = await repoA.update({ id: docBId }, { title: 'hijacked' });
    expect(result.affected).toBe(0);

    const tenantBFresh = await rawRepo.findOneBy({ id: docBId });
    expect(tenantBFresh).not.toBeNull();
    expect(tenantBFresh!.title).toBe('B-doc');
  });

  // Probe 7 — Wrapped Repository is not reachable via normal property access.
  it('Probe 7: wrapped Repository<T> is not exposed via reflection', () => {
    // #repo is an ECMAScript private field — no public property named 'repo'
    // exists on the instance.
    expect((repoA as any).repo).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(repoA, 'repo')).toBeUndefined();
    expect(Object.keys(repoA)).toEqual([]);
  });

  // Probe 8 — Malformed tenantId throws at construction time, not later.
  it('Probe 8: malformed tenantId throws at construction', () => {
    expect(() => new TenantScopedRepository<KnowledgeDocument>(rawRepo, '')).toThrow(
      /tenantId must be a UUID string/,
    );
    expect(
      () => new TenantScopedRepository<KnowledgeDocument>(rawRepo, 'not-a-uuid'),
    ).toThrow(/tenantId must be a UUID string/);
    expect(
      () => new TenantScopedRepository<KnowledgeDocument>(rawRepo, null as any),
    ).toThrow(/tenantId must be a UUID string/);
    expect(
      () => new TenantScopedRepository<KnowledgeDocument>(rawRepo, undefined as any),
    ).toThrow(/tenantId must be a UUID string/);
  });
});
