"""Embedding worker loop (W3): claim → embed → write back → complete documents."""
import logging
import time

from . import db
from .config import config
from .embedder import Embedder
from .state import state

logger = logging.getLogger("worker")


def process_once(conn, embedder: Embedder) -> int:
    """Process one claimed batch. Returns number of chunks embedded.

    One transaction: claim (locks rows) → embed → write → commit. On embed
    failure, roll back (chunks stay NULL, re-claimable) and mark the affected
    documents `failed` in a separate transaction.
    """
    with conn.cursor() as cur:
        rows = db.claim_batch(cur, config.BATCH_SIZE)
        if not rows:
            conn.rollback()
            return 0

        chunk_ids = [r[0] for r in rows]
        doc_ids = list({r[1] for r in rows})
        texts = [r[2] for r in rows]

        try:
            vectors = embedder.embed(texts)  # normalized, no passage prefix
        except Exception as exc:  # embedding failed for this batch
            conn.rollback()
            logger.error("Embedding failed for %d chunks: %s", len(rows), exc)
            with conn.cursor() as fcur:
                db.fail_documents(fcur, doc_ids, f"embedding failed: {exc}")
            conn.commit()
            state.last_error = str(exc)
            return 0

        for chunk_id, vec in zip(chunk_ids, vectors):
            db.write_embedding(cur, chunk_id, vec)

        completed = db.complete_documents(cur, doc_ids)
        conn.commit()

    state.embedded_total += len(rows)
    if completed:
        logger.info("Documents completed: %s", completed)
    logger.info("Embedded %d chunk(s)", len(rows))
    return len(rows)


def run_loop() -> None:
    """Load the model, then poll-claim-embed forever."""
    embedder = Embedder()
    embedder.load()
    state.embedder = embedder          # publish for the /embed route (W4 Amendment B)
    state.model_loaded = True
    state.model_name = config.MODEL_NAME
    state.embedding_dim = config.EMBEDDING_DIM
    logger.info("Worker ready; polling every %.1fs", config.POLL_INTERVAL_SECONDS)

    conn = None
    while True:
        try:
            if conn is None or conn.closed:
                conn = db.connect()
            n = process_once(conn, embedder)
            if n == 0:
                time.sleep(config.POLL_INTERVAL_SECONDS)
        except Exception as exc:  # DB hiccup etc. — reconnect next loop
            logger.error("Worker loop error: %s", exc)
            state.last_error = str(exc)
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass
            conn = None
            time.sleep(config.POLL_INTERVAL_SECONDS)
