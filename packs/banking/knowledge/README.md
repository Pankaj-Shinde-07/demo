# SynthBank knowledge corpus (RAG) — seed README

The committed knowledge corpus for the SynthBank demo (runbooks / SOPs / historical RCA),
ingested through the **real W2→W3→W4 pipeline** (knowledge-ingestion → embedding-worker →
retrieval), never by direct SQL. The corpus itself is authored in CP-P4.1b; this README
records the operational contract proven in CP-P4.1a.

## Pipeline (demo stack `ems-ai-demo`)
- **W2 ingestion** — `ems-ai-demo-ki` (`:53111`): `POST /api/v1/knowledge/upload`
  (multipart: file + `tenant_id` + `document_type`), `GET /api/v1/knowledge/documents/:id`.
  `document_type` ∈ `manual | sop | rca | runbook | datasheet | cmdb_export | topology_diagram | other`.
- **W3 embedding** — `ems-ai-demo-embedding` (`:53112`): `BAAI/bge-large-en-v1.5`, BullMQ
  (`bull:knowledge-ingestion:*`) + Postgres passage claim-poll. Writes `knowledge_chunks`.
- **W4 retrieval** — ai-copilot `GET /api/v1/knowledge/search` (tenant-scoped); chat
  `grounded_context`/`retrieval` route cites the ingested chunks.

## Air-gap / production deployment (W3 §8)
The embedder needs the `BAAI/bge-large-en-v1.5` weights (~1.3 GB). In a connected demo it
downloads them on first start (`HF_HUB_OFFLINE=0`). **For production / air-gapped bank
deployment:**
1. **Pre-stage** the model cache: ship `./.hf-cache/models--BAAI--bge-large-en-v1.5` with the
   release (host bind-mount `./.hf-cache:/app/.hf-cache`), or copy it onto the target host.
2. **Set `HF_HUB_OFFLINE=1`** in the embedder env so it loads from the local cache and makes
   **no network calls** — required at a bank with no outbound internet.
3. Verify on boot: `GET :53112/health` reports the model loaded before ingestion runs.

So the bank install needs **no model download**: the cache is pre-staged and offline mode is on.

## Re-seed (survives teardown)
`stack.sh seed` brings up ki + embedding (now in `STACK_SERVICES`), then uploads each corpus
file via the W2 endpoint and polls to `completed`. Chunks+embeddings persist in
`ems-ai-demo_postgres_data`; the model cache persists in `./.hf-cache`. (Seed wiring added in CP-P4.1b.)
