FROM python:3.11-slim

WORKDIR /app

# wget is used by the docker-compose healthcheck (uniform with NestJS services
# per CP1.2 Conflict-2 resolution — no curl anywhere).
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*

# W3: install CPU-only torch FIRST, from the PyTorch CPU index, so the large
# default CUDA wheels are never pulled (smaller image; CPU is fine for v1 per
# W3_BRIEF §4.3, and matches the no-GPU air-gapped bank target).
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Project metadata and source must both be present before `pip install -e .`
# so setuptools can resolve the `src` package declared in pyproject.toml.
COPY pyproject.toml ./
COPY src/ ./src/

RUN pip install --no-cache-dir -e .

# W3 §4.4 — model cache lives under a host-mounted path so the ~1.3GB bge-large
# download is not repeated on rebuild and can be pre-staged for air-gapped sites.
ENV HF_HOME=/app/.hf-cache \
    SENTENCE_TRANSFORMERS_HOME=/app/.hf-cache \
    TRANSFORMERS_CACHE=/app/.hf-cache

# uid 1000 has no /etc/passwd entry in python:3.11-slim, but compose runs this
# service as user "1000:1000". torch's getpass.getuser() (used to build its
# inductor cache dir) calls pwd.getpwuid(1000) and crashes with KeyError.
# Create the user so the lookup resolves, and give it a writable HOME.
RUN useradd -m -u 1000 -s /bin/bash canaris
ENV HOME=/home/canaris

EXPOSE 3112

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "3112"]
