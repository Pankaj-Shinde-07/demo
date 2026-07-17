"""Postgres access for the embedding worker (W3).

Claim-poll model (W3_BRIEF §4.2): find chunks with NULL embeddings, claim a
batch with row-level locking (FOR UPDATE SKIP LOCKED) so multiple workers never
double-process, embed, write back — all in one transaction so a crash mid-batch
rolls back and the rows are re-claimable (self-healing, idempotent). The worker
does NOT speak BullMQ; "find null embeddings" is the queue.
"""
import logging
from typing import List, Tuple

import psycopg2

from .config import config

logger = logging.getLogger("db")


def connect():
    conn = psycopg2.connect(config.dsn())
    conn.autocommit = False
    return conn


def format_vector(vec: List[float]) -> str:
    """pgvector text literal: '[v1,v2,...]' (cast ::vector on write)."""
    return "[" + ",".join(repr(float(x)) for x in vec) + "]"


def claim_batch(cur, limit: int) -> List[Tuple[str, str, str]]:
    """Lock and return up to `limit` un-embedded chunks: (id, document_id, chunk_text).

    Skips chunks whose document is already marked `failed` so a permanently
    failing document does not loop forever (it stays failed until reindex).
    """
    cur.execute(
        """
        SELECT c.id, c.document_id, c.chunk_text
        FROM knowledge_chunks c
        WHERE c.embedding IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM knowledge_documents d
            WHERE d.id = c.document_id AND d.ingestion_status = 'failed'
          )
        ORDER BY c.created_at
        LIMIT %s
        FOR UPDATE SKIP LOCKED
        """,
        (limit,),
    )
    return cur.fetchall()


def write_embedding(cur, chunk_id: str, vector: List[float]) -> None:
    cur.execute(
        "UPDATE knowledge_chunks SET embedding = %s::vector, updated_at = now() WHERE id = %s::uuid",
        (format_vector(vector), chunk_id),
    )


def complete_documents(cur, doc_ids: List[str]) -> List[str]:
    """Flip `embedding` → `completed` for docs whose chunks are all embedded."""
    if not doc_ids:
        return []
    cur.execute(
        """
        UPDATE knowledge_documents d
        SET ingestion_status = 'completed', updated_at = now()
        WHERE d.id = ANY(%s::uuid[])
          AND d.ingestion_status = 'embedding'
          AND NOT EXISTS (
            SELECT 1 FROM knowledge_chunks c
            WHERE c.document_id = d.id AND c.embedding IS NULL
          )
        RETURNING d.id
        """,
        (doc_ids,),
    )
    return [r[0] for r in cur.fetchall()]


def fail_documents(cur, doc_ids: List[str], error: str) -> None:
    if not doc_ids:
        return
    cur.execute(
        """
        UPDATE knowledge_documents
        SET ingestion_status = 'failed', ingestion_error = %s, updated_at = now()
        WHERE id = ANY(%s::uuid[])
          AND ingestion_status IN ('embedding', 'chunking', 'parsing', 'pending')
        """,
        (error[:2000], doc_ids),
    )


def count_null_embeddings(cur) -> int:
    cur.execute("SELECT count(*) FROM knowledge_chunks WHERE embedding IS NULL")
    return cur.fetchone()[0]
