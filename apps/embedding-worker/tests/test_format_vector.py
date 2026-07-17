"""Unit: pgvector text-literal formatting (no DB, no model)."""
from src.db import format_vector


def test_format_vector_basic():
    assert format_vector([0.0, 1.0, -0.5]) == "[0.0,1.0,-0.5]"


def test_format_vector_1024_shape():
    s = format_vector([0.1] * 1024)
    assert s.startswith("[") and s.endswith("]")
    assert s.count(",") == 1023  # 1024 components → 1023 separators


def test_format_vector_casts_ints():
    assert format_vector([1, 2]) == "[1.0,2.0]"
