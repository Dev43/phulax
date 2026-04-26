# Phulax inference server.
#
# Phase 1: stub. Builds a tiny FastAPI image that satisfies the /classify
# contract so Track A's E2E synthetic workflow can call it.
#
# Phase 2 (after ml/artifacts.json publishes CIDs): a second stage will
# fetch merged weights + tokenizer + config from 0G Storage at boot, hash
# them into PHULAX_MODEL_HASH, and start llama.cpp HTTP server alongside
# this FastAPI process (or replace _classify() with a llama.cpp client call).
# The image stays reproducible from ml/artifacts.json alone.

FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY server.py ./

ENV PHULAX_INFERENCE_PHASE=stub \
    PHULAX_MODEL_HASH=stub
# PHULAX_INFERENCE_HMAC_KEY MUST be supplied at runtime (no default in image).

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
