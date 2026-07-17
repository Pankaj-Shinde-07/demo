"""Unit: embedder produces normalized 1024-dim vectors (loads the real model).

Run inside the container where the model cache is available.
"""
import math

from src.embedder import Embedder, QUERY_PREFIX


def test_embed_dim_and_normalized():
    e = Embedder()
    e.load()
    vecs = e.embed(["hello world", "the quick brown fox"])
    assert len(vecs) == 2
    assert all(len(v) == 1024 for v in vecs)
    for v in vecs:
        norm = math.sqrt(sum(x * x for x in v))
        assert abs(norm - 1.0) < 1e-2, f"expected unit-norm, got {norm}"


def test_distinct_texts_differ():
    e = Embedder()
    e.load()
    a, b = e.embed(["sponsor bank link for UPI settlement", "ATM cash replenishment"])
    # cosine similarity of two different passages should be < 1
    dot = sum(x * y for x, y in zip(a, b))
    assert dot < 0.999


# --- W4 §2 / Amendment B: bge asymmetric query-prefix contract ----------------

def test_query_prefix_constant_is_exact():
    # The bge-large-en-v1.5 instruction string is load-bearing — a typo here
    # silently degrades retrieval. Pin the exact bytes (trailing space included).
    assert QUERY_PREFIX == "Represent this sentence for searching relevant passages: "


def test_query_embedding_is_normalized_1024():
    e = Embedder()
    e.load()
    vecs = e.embed_query(["which servers support the UPI gateway service"])
    assert len(vecs) == 1 and len(vecs[0]) == 1024
    norm = math.sqrt(sum(x * x for x in vecs[0]))
    assert abs(norm - 1.0) < 1e-2, f"expected unit-norm query, got {norm}"


def test_query_prefix_changes_the_vector():
    # Loud regression assertion: embed_query MUST differ from prefix-free embed
    # of the same text. If embed_query ever stops applying QUERY_PREFIX, the two
    # become identical and this fails — surfacing the quiet-degradation bug.
    e = Embedder()
    e.load()
    text = "how is UPI reconciliation performed against NPCI"
    q = e.embed_query([text])[0]
    p = e.embed([text])[0]
    cos = sum(x * y for x, y in zip(q, p))
    assert cos < 0.999, (
        "query embedding is identical to passage embedding — QUERY_PREFIX is "
        "not being applied on the query path (W4 §2 regression)."
    )
