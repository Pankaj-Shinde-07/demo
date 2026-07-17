from datetime import datetime, timezone
from fastapi import APIRouter

from .state import state

health_router = APIRouter()


# Register both GET and HEAD on /health: the compose healthcheck uses
# `wget --spider`, which issues HEAD. FastAPI does not auto-route HEAD to the
# GET handler the way Express+NestJS does, so without an explicit HEAD method
# the spider probe returns 405 and the container is marked unhealthy. For HEAD,
# Starlette runs the handler and strips the body before sending — the dict is
# never serialised over the wire.
@health_router.api_route("/health", methods=["GET", "HEAD"])
def health() -> dict:
    return {
        "status": "ok",
        "service": "embedding-worker",
        "version": "0.1.0",
        "model_loaded": state.model_loaded,   # W3: True once bge-large-en-v1.5 is loaded
        "model": state.model_name or None,
        "embedding_dim": state.embedding_dim or None,
        "embedded_total": state.embedded_total,
        "last_error": state.last_error,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
