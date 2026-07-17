"""Environment configuration for the embedding worker (W3)."""
import os


class Config:
    # Embedding model (D3): BAAI/bge-large-en-v1.5, output dim 1024.
    MODEL_NAME: str = os.getenv("EMBEDDING_MODEL", "BAAI/bge-large-en-v1.5")
    EMBEDDING_DIM: int = int(os.getenv("EMBEDDING_DIM", "1024"))
    BATCH_SIZE: int = int(os.getenv("EMBEDDING_BATCH_SIZE", "32"))
    POLL_INTERVAL_SECONDS: float = float(os.getenv("POLL_INTERVAL_SECONDS", "5"))

    # Postgres (the W1-owned AI schema; W3 only reads chunks + writes embeddings).
    DB_HOST: str = os.getenv("DATABASE_HOST", "postgres")
    DB_PORT: int = int(os.getenv("DATABASE_PORT", "5432"))
    DB_NAME: str = os.getenv("DATABASE_NAME", "ems_platform")
    DB_USER: str = os.getenv("DATABASE_USER", "ems_admin")
    DB_PASSWORD: str = os.getenv("DATABASE_PASSWORD", "")

    # Air-gap: when the model cache is pre-staged, set HF_HUB_OFFLINE=1 so no
    # outbound network is attempted (see §8). Read here only for reporting.
    HF_OFFLINE: bool = os.getenv("HF_HUB_OFFLINE", "0") in ("1", "true", "True")

    def dsn(self) -> str:
        return (
            f"host={self.DB_HOST} port={self.DB_PORT} dbname={self.DB_NAME} "
            f"user={self.DB_USER} password={self.DB_PASSWORD}"
        )


config = Config()
