"""Shared runtime state between the FastAPI app and the worker thread (W3)."""
from dataclasses import dataclass
from typing import Any


@dataclass
class WorkerState:
    model_loaded: bool = False
    model_name: str = ""
    embedding_dim: int = 0
    embedded_total: int = 0          # chunks embedded since process start
    last_error: str | None = None
    # The loaded Embedder, published by the worker thread once the model is up.
    # Shared so the FastAPI /embed route reuses the SAME model instance (W4
    # Amendment B — one model, one owner). Typed Any to avoid a circular import.
    embedder: Any = None
    query_embedded_total: int = 0    # queries embedded via /embed since start


state = WorkerState()
