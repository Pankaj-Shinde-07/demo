-- Migration: 20260514000006 — Knowledge chunks (vectors + ts_vector)
-- Purpose: Per-chunk storage with both pgvector embedding (W3 fills) and
--          tsvector for keyword search. The HNSW index supports D5 hybrid
--          retrieval (vector + keyword + RRF). Embedding dim 1024 matches
--          BAAI/bge-large-en-v1.5 (D3).
-- Branch:  ems-platform.AICopilot
-- Workstream: W1 (Foundations) — CP1.1 — M6
-- Pre-req: M1 (pgvector). pgvector >= 0.5 required for HNSW (we have 0.8.2).
-- Date:    2026-05-14
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id   UUID        NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_index   INTEGER     NOT NULL,
  chunk_text    TEXT        NOT NULL,
  token_count   INTEGER     NOT NULL,
  section_path  TEXT[]      NOT NULL DEFAULT '{}',  -- e.g. ARRAY['Chapter 3', 'Section 3.2']
  metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  embedding     vector(1024),                       -- W3 fills; NULL until embedding-worker processes the chunk
  ts_vector     tsvector    GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup: chunks of a doc, in order, scoped to tenant
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tenant_doc_idx
  ON knowledge_chunks(tenant_id, document_id, chunk_index);

-- Vector similarity index (HNSW) — cosine distance (matches bge default).
-- Note: HNSW is fine on NULL embeddings (rows without embedding are skipped).
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding_hnsw
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

-- Keyword retrieval (D5 hybrid)
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_ts_vector_gin
  ON knowledge_chunks USING gin (ts_vector);

COMMENT ON TABLE  knowledge_chunks IS 'Per-chunk storage with pgvector embedding + tsvector keyword index (D5 hybrid retrieval).';
COMMENT ON COLUMN knowledge_chunks.embedding IS '1024-dim vector from BAAI/bge-large-en-v1.5 (D3). NULL until W3 fills.';
COMMENT ON COLUMN knowledge_chunks.ts_vector IS 'GENERATED tsvector for keyword search. English analyzer.';
