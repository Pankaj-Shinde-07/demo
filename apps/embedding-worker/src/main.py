import logging
import threading

from fastapi import FastAPI

from .embed import embed_router
from .health import health_router
from .worker import run_loop

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

app = FastAPI(title="Canaris Embedding Worker", version="0.1.0")
app.include_router(health_router)
app.include_router(embed_router)  # W4 Amendment B: synchronous query-embed path


@app.on_event("startup")
def start_worker() -> None:
    # Run the model load + claim-poll loop on a daemon thread so the FastAPI
    # event loop stays responsive for /health while CPU embedding runs (W3).
    thread = threading.Thread(target=run_loop, name="embedding-worker", daemon=True)
    thread.start()
