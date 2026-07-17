# embedding-worker

Python 3.11 + FastAPI sidecar that turns text into vectors for the Canaris AI
Copilot knowledge layer. It loads `BAAI/bge-large-en-v1.5` via
`sentence-transformers` (output dim **1024**, matching the `knowledge_chunks.embedding`
`vector(1024)` column + its `vector_cosine_ops` HNSW index) and fills embeddings
for chunks produced by `knowledge-ingestion`.

## How it works (W3)

Per **D3**, embeddings run **locally** — tenant content never leaves the
deployment (a real selling point for air-gapped banks).

- **Claim-poll, not a cross-language queue (§4.2).** A background thread polls
  Postgres for chunks with `embedding IS NULL`, claims a batch with
  `SELECT … FOR UPDATE SKIP LOCKED` (no double-processing), embeds, and writes
  the vectors back — all in one transaction, so a crash mid-batch rolls back and
  the rows are re-claimable. "Find null embeddings" is the queue: self-healing,
  restart-safe, idempotent.
- **Passages are embedded WITHOUT any instruction prefix.** bge's query
  instruction ("Represent this sentence for searching relevant passages:") is a
  **query-side** concern for W4 — applying it to stored passages quietly
  degrades retrieval. (Forward-flagged to W4.)
- Vectors are **normalized** (`normalize_embeddings=True`); with the
  `vector_cosine_ops` index, cosine distance (`<=>`) is the operator to use.
- **Document lifecycle:** `knowledge-ingestion` sets a document to `embedding`
  after chunking; this worker flips it to `completed` once all of its chunks have
  vectors. Embedding failure → `failed` (+ `ingestion_error`); a failed doc's
  chunks are skipped until reindex.

`/health` reports `model_loaded`, the model name, dim, and a running
`embedded_total`.

## Model cache & air-gap pre-stage (§4.4 / §8)

bge-large (~1.3 GB) downloads from HuggingFace on first load. The cache lives at
`/app/.hf-cache`, **host-mounted** from `./.hf-cache` (canaris-owned, uid 1000,
gitignored) — same pattern as W2's `.ki-uploads` (a named Docker volume would be
root-owned and unwritable under uid 1000). So the download happens **once** and
survives image rebuilds.

**Air-gapped / on-prem bank sites have no outbound network.** Pre-stage the model:

1. On an internet-connected box, populate the cache (either let the worker load
   once, or run):
   ```bash
   pip install "huggingface_hub[cli]"
   HF_HOME=./hf-cache huggingface-cli download BAAI/bge-large-en-v1.5
   ```
2. Ship the resulting `hf-cache/` directory to the air-gapped host (it is just
   files — the same artifact an air-gapped deploy ships for offline assets).
3. Place it at the deployment's `./.hf-cache` and set `HF_HUB_OFFLINE=1` in the
   environment so no network is attempted:
   ```yaml
   # docker-compose (env)
   HF_HUB_OFFLINE: "1"
   ```
4. Start the worker — it loads entirely from the local cache, zero egress.

This follows the air-gap lesson: the model is a shippable offline artifact,
not a runtime download.
