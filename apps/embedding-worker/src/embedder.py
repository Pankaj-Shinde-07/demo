"""bge-large-en-v1.5 embedder (W3, D3 — local embeddings, content never leaves)."""
import logging
import threading
from typing import List

from sentence_transformers import SentenceTransformer

from .config import config

logger = logging.getLogger("embedder")

# bge-large-en-v1.5 asymmetric scheme (W4 §2): the query-instruction prefix is
# applied to the QUERY side ONLY. Passages are embedded prefix-free (see embed()).
# This is the single source of truth for the prefix — the /embed query path and
# the prefix-regression eval assertion both import THIS constant so it cannot
# drift. Forgetting it degrades retrieval quietly; the eval is what catches it.
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


class Embedder:
    """Loads the model once and embeds passages (claim-poll loop) and queries
    (synchronous /embed endpoint, W4 Amendment B).

    PASSAGE embeddings are stored WITHOUT any instruction prefix. bge's
    query-instruction prefix (QUERY_PREFIX) is a QUERY-side concern — applying
    it to stored passages quietly degrades retrieval (W3_BRIEF §4.3). The query
    path (embed_query) is the ONLY place the prefix is applied.
    """

    def __init__(self) -> None:
        self._model: SentenceTransformer | None = None
        # The claim-poll worker thread and the FastAPI /embed route share one
        # model instance (one model, one owner — W4 Amendment B). Serialise
        # encode() across the two threads so batch passage embedding and a
        # single query embed never race inside PyTorch.
        self._lock = threading.Lock()

    def load(self) -> None:
        logger.info("Loading embedding model %s …", config.MODEL_NAME)
        self._model = SentenceTransformer(config.MODEL_NAME, device="cpu")
        dim = self._model.get_sentence_embedding_dimension()
        if dim != config.EMBEDDING_DIM:
            # Tripwire (§2): dimension mismatch with the vector(1024) column.
            raise RuntimeError(
                f"Model dim {dim} != expected {config.EMBEDDING_DIM}; "
                f"would mismatch knowledge_chunks.embedding — refusing to run."
            )
        logger.info("Model loaded (dim=%d)", dim)

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def embed(self, texts: List[str]) -> List[List[float]]:
        """Embed PASSAGES. Normalized (cosine == inner-product) for the
        vector_cosine_ops HNSW index. No instruction prefix (passage side)."""
        return self._encode(texts)

    def embed_query(self, texts: List[str]) -> List[List[float]]:
        """Embed QUERIES. Applies QUERY_PREFIX (bge asymmetric scheme, W4 §2)
        then normalizes identically to passages so cosine over the HNSW
        vector_cosine_ops index is valid. This is the only prefix application
        point in the system."""
        return self._encode([QUERY_PREFIX + t for t in texts])

    def _encode(self, texts: List[str]) -> List[List[float]]:
        if self._model is None:
            raise RuntimeError("model not loaded")
        with self._lock:
            vectors = self._model.encode(
                texts,
                batch_size=config.BATCH_SIZE,
                normalize_embeddings=True,
                convert_to_numpy=True,
                show_progress_bar=False,
            )
        return [v.tolist() for v in vectors]
