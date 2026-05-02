# Phulax inference server.
#
# Two final stages:
#   stub          (default)  — no weights baked in. Fast image for tests + the
#                              Phase-1 deployment shape. /classify auto-falls-
#                              back to the deterministic stub.
#   transformers             — bakes ml/artifacts/merged into /app/model and
#                              sets PHULAX_MODEL_DIR so the runtime promotes
#                              itself to phase=transformers on boot. Used by
#                              the Fly deploy (see inference/fly.toml).
#
# Build from the REPO ROOT so the frozen prompt template + (for the
# transformers stage) ml/artifacts/merged are in the build context:
#   docker build -f inference/Dockerfile -t phulax-inference .                  # stub
#   docker build -f inference/Dockerfile --target transformers -t … .           # weights
#   fly deploy --config inference/fly.toml --dockerfile inference/Dockerfile \
#              --remote-only                                                    # uses fly.toml [build].target

FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY inference/requirements.txt ./
# Install torch from PyTorch's CPU index first so the rest of requirements.txt
# sees torch already satisfied — avoids pulling the ~2 GB CUDA wheels from PyPI.
# CPU is fine for the demo (QPS is one fire per 0G block).
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.4.1 \
 && pip install -r requirements.txt

# Frozen prompt template — same file fine-tune + eval + this server import,
# version pinned by TEMPLATE_VERSION inside the file. server.py computes
# _REPO_ROOT = Path(__file__).resolve().parent.parent → "/" when WORKDIR=/app,
# so the template MUST live at /ml/prompt/ (not /app/ml/prompt/) for the
# `from prompt.template import ...` to resolve. Without this, /classify silently
# returns the stub triple even with weights loaded — discovered 2026-05-02.
COPY ml/prompt/__init__.py /ml/prompt/__init__.py
COPY ml/prompt/template.py /ml/prompt/template.py

COPY inference/server.py ./

ENV PHULAX_INFERENCE_PHASE=auto \
    PHULAX_MODEL_HASH=stub
# PHULAX_INFERENCE_HMAC_KEY MUST be supplied at runtime (no default in image).

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]


# Default target. Tests + CI build this; PHULAX_MODEL_DIR stays unset so
# /classify uses the deterministic stub.
FROM base AS stub


# Weighted target. Bakes the merged Qwen2.5-0.5B + LoRA checkpoint into the
# image so /healthz reports phase=transformers and a real model_hash on boot.
# Requires `ml/artifacts/merged/` in the build context (see .dockerignore for
# the matching negation). Image grows by ~1 GB.
FROM base AS transformers
COPY ml/artifacts/merged /app/model
ENV PHULAX_MODEL_DIR=/app/model
