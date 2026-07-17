-- Migration: 20260514000001 — Enable required extensions (pgvector + uuid-ossp)
-- Purpose: Make the pgvector type + HNSW/IVFFlat indexes available so the
--          knowledge_chunks.embedding column (M6) can be created; and create
--          uuid-ossp so the schema's extension set is fully migration-owned.
-- Branch:  ems-platform.AICopilot
-- Workstream: W1 (Foundations) — CP1.1 — M1; uuid-ossp added W6 Phase 1.5 (DEFECT-1)
-- Date:    2026-05-14 (uuid-ossp: 2026-06-08)
-- Pre-req: postgres image swapped to pgvector/pgvector:pg15 (vector 0.8.2 available).
-- Idempotent: safe to re-run (CREATE EXTENSION IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS vector;

-- uuid-ossp (W6 Phase 1.5, DEFECT-1). The TypeORM driver formerly auto-created
-- this on connect because the entities have @PrimaryGeneratedColumn('uuid')
-- columns; that runtime CREATE EXTENSION (a) was invisible to the migration set
-- (a §6.10 single-source-of-truth nick) and (b) fails to boot on hardened/air-gap
-- deploys where the app's DB role lacks CREATE privilege. The driver auto-create
-- is now disabled (installExtensions: false in both app.modules); this privileged
-- migration step is the single path to the extension. NB: the schema's UUID PKs
-- actually default to core gen_random_uuid(), so uuid-ossp is created for parity
-- with the prior runtime schema, not because a column requires it.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Sanity check: report the installed versions into the migration log via NOTICE.
DO $$
DECLARE v TEXT; u TEXT;
BEGIN
  SELECT extversion INTO v FROM pg_extension WHERE extname = 'vector';
  SELECT extversion INTO u FROM pg_extension WHERE extname = 'uuid-ossp';
  RAISE NOTICE 'pgvector installed: version=%', v;
  RAISE NOTICE 'uuid-ossp installed: version=%', u;
END $$;
