/**
 * CP-P4.1b — banking RAG corpus seed. Uploads the committed corpus
 * (packs/banking/knowledge/, mounted at $PACKS_ROOT) through the REAL W2 upload
 * path (POST /api/v1/knowledge/upload on this service), then polls the DB until
 * each document reaches ingestion_status='completed' (the embedder claim-poll
 * does the embedding). Runs INSIDE the knowledge-ingestion container.
 *
 *   docker exec <ki> node dist/knowledge/corpus-seed.cli.js
 *
 * Idempotent + re-run safe: a document whose (tenant, title) already shows
 * 'completed' is skipped, so re-seeding a populated volume is a no-op and a wiped
 * volume is repopulated. No fabricated content — every doc is synthetic-labeled.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

const PACKS_ROOT = process.env.PACKS_ROOT || '/app/packs';
const CORPUS_DIR = join(PACKS_ROOT, 'banking', 'knowledge');
const KI_URL = process.env.KI_SELF_URL || 'http://localhost:3111';
const POLL_MAX = Number(process.env.SEED_POLL_MAX || 90);

interface ManifestDoc { file: string; document_type: string; title: string }

function db(): Client {
  return new Client({
    host: process.env.DATABASE_HOST || 'postgres',
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER || 'ems_admin',
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME || 'ems_platform',
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function statusOf(c: Client, tenant: string, title: string): Promise<{ id: string; status: string } | null> {
  const r = await c.query(
    `SELECT id, ingestion_status FROM knowledge_documents WHERE tenant_id=$1 AND title=$2 ORDER BY created_at DESC LIMIT 1`,
    [tenant, title],
  );
  return r.rows[0] ? { id: r.rows[0].id, status: r.rows[0].ingestion_status } : null;
}

async function main(): Promise<void> {
  const manifest = JSON.parse(readFileSync(join(CORPUS_DIR, 'manifest.json'), 'utf8')) as {
    tenant: string; documents: ManifestDoc[];
  };
  const tenant = manifest.tenant;
  const c = db();
  await c.connect();
  const summary: Array<{ title: string; status: string; skipped?: boolean }> = [];
  try {
    for (const doc of manifest.documents) {
      const existing = await statusOf(c, tenant, doc.title);
      if (existing?.status === 'completed') {
        console.log(`  skip (already completed): ${doc.title}`);
        summary.push({ title: doc.title, status: 'completed', skipped: true });
        continue;
      }
      // Real W2 upload path (multipart).
      const buf = readFileSync(join(CORPUS_DIR, doc.file));
      const fd = new FormData();
      fd.append('file', new Blob([buf]), doc.file);
      fd.append('tenant_id', tenant);
      fd.append('document_type', doc.document_type);
      fd.append('title', doc.title);
      const res = await fetch(`${KI_URL}/api/v1/knowledge/upload`, { method: 'POST', body: fd });
      const body: { id?: string; ingestion_status?: string } = await res.json();
      if (!body.id) throw new Error(`upload failed for ${doc.title}: HTTP ${res.status} ${JSON.stringify(body)}`);

      // Poll the DB until completed (the embedder claim-poll embeds the chunks).
      let status = body.ingestion_status ?? 'pending';
      for (let i = 0; i < POLL_MAX && status !== 'completed' && status !== 'failed'; i++) {
        await sleep(2000);
        const r = await c.query(`SELECT ingestion_status FROM knowledge_documents WHERE id=$1`, [body.id]);
        status = r.rows[0]?.ingestion_status ?? status;
      }
      console.log(`  ${doc.title}: ${status} (${doc.document_type}, id ${body.id})`);
      summary.push({ title: doc.title, status });
      if (status !== 'completed') throw new Error(`ingestion not completed for ${doc.title}: ${status}`);
    }
    console.log(JSON.stringify({ seeded: summary }, null, 2));
  } finally {
    await c.end();
  }
}

main().catch((err) => {
  console.error(String(err?.message || err));
  process.exit(1);
});
