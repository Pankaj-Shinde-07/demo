"""Synchronous query-embedding endpoint (W4 Amendment B).

NestJS ai-copilot calls POST /embed on the dense retrieval path. The bge query
instruction prefix (embedder.QUERY_PREFIX) is applied HERE, worker-side, so the
constant lives in exactly one place and cannot drift between services. The
returned vector is unit-normalized identically to stored passages, so cosine
over the HNSW vector_cosine_ops index is valid.

This is purely additive: the passage claim-poll loop (worker.py) is unchanged
and still embeds prefix-free.
"""
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .state import state

logger = logging.getLogger("embed")

embed_router = APIRouter()


class EmbedRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Query text (prefix added server-side).")


class EmbedResponse(BaseModel):
    embedding: list[float]
    dim: int
    model: str
    # Always true — /embed is the query path and unconditionally applies the
    # prefix. Surfaced so the caller / eval can see the asymmetric scheme is on.
    query_prefix_applied: bool


@embed_router.post("/embed", response_model=EmbedResponse)
def embed_query(req: EmbedRequest) -> EmbedResponse:
    embedder = state.embedder
    if embedder is None or not state.model_loaded:
        # Model still loading on the worker thread (cold start) — caller retries.
        raise HTTPException(status_code=503, detail="embedding model not loaded yet")

    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="text must not be blank")

    try:
        vector = embedder.embed_query([text])[0]
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("query embed failed: %s", exc)
        state.last_error = str(exc)
        raise HTTPException(status_code=500, detail="query embedding failed") from exc

    state.query_embedded_total += 1
    return EmbedResponse(
        embedding=vector,
        dim=len(vector),
        model=state.model_name,
        # embed_query() unconditionally prepends QUERY_PREFIX; this flag makes
        # that contract visible to callers and to the prefix-regression eval.
        query_prefix_applied=True,
    )
