# Phulax inference server.
#
# Three final stages:
#   stub          (default)  — no weights baked in. Fast image for tests + the
#                              Phase-1 deployment shape. /classify auto-falls-
#                              back to the deterministic stub.
#   transformers             — bakes ml/artifacts/merged into /app/model and
#                              sets PHULAX_MODEL_DIR so the runtime promotes
#                              itself to phase=transformers on boot.
#   llama_cpp                — bakes ml/artifacts/merged/phulax-q4.gguf into
#                              /app/model and serves via llama-cpp-python
#                              (~3-5x faster than transformers FP16 on CPU).
#                              Used by the colocated Hetzner deploy — see
#                              docker-compose.yml.
#
# Build from the REPO ROOT so the frozen prompt template + (for the weighted
# stages) ml/artifacts/merged are in the build context:
#   docker build -f inference/Dockerfile -t phulax-inference .                  # stub
#   docker build -f inference/Dockerfile --target transformers -t … .           # full safetensors
#   docker build -f inference/Dockerfile --target llama_cpp    -t … .           # Q4 GGUF
#
# Note: build-essential + cmake are installed because llama-cpp-python may
# fall back to a source build on platforms without a prebuilt wheel
# (notably linux/arm64 < 0.3.0). For linux/amd64 the wheel ships and the
# install is fast; the deps just sit unused.

FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Build deps required only when llama-cpp-python source-builds. On
# linux/amd64 + Python 3.11 the prebuilt wheel covers us, but we install
# build-essential anyway so a wheel-miss doesn't kill the build.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential cmake ca-certificates \
 && rm -rf /var/lib/apt/lists/*

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

ENV PHULAX_INFERENCE_BACKEND=auto \
    PHULAX_INFERENCE_PHASE=auto \
    PHULAX_MODEL_HASH=stub
# PHULAX_INFERENCE_HMAC_KEY MUST be supplied at runtime (no default in image).

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]


# Default target. Tests + CI build this; PHULAX_MODEL_DIR stays unset so
# /classify uses the deterministic stub.
FROM base AS stub


# Full-safetensors target. Bakes the merged Qwen2.5-0.5B + LoRA checkpoint
# into the image so /healthz reports phase=transformers and a real model_hash
# on boot. Image grows by ~1 GB. Use this when you want to validate the
# transformers path or a quantization regression.
FROM base AS transformers
COPY ml/artifacts/merged /app/model
ENV PHULAX_MODEL_DIR=/app/model \
    PHULAX_INFERENCE_BACKEND=transformers


# Q4 GGUF target. Ships only the quantized weights (~380 MB) instead of the
# full safetensors (~1 GB), and serves via llama-cpp-python. Drops cold-load
# time + warm classify latency by ~3-5x on CPU. Requires
# `ml/artifacts/merged/phulax-q4.gguf` in the build context — generate via:
#   docker run --rm -v $(pwd)/ml/artifacts/merged:/model \
#     ghcr.io/ggml-org/llama.cpp:full \
#     --convert /model --outfile /model/phulax-fp16.gguf --outtype f16
#   docker run --rm -v $(pwd)/ml/artifacts/merged:/model \
#     ghcr.io/ggml-org/llama.cpp:full \
#     --quantize /model/phulax-fp16.gguf /model/phulax-q4.gguf Q4_K_M
FROM base AS llama_cpp
RUN mkdir -p /app/model
COPY ml/artifacts/merged/phulax-q4.gguf /app/model/phulax-q4.gguf
COPY ml/artifacts/merged/chat_template.jinja /app/model/chat_template.jinja
ENV PHULAX_MODEL_DIR=/app/model \
    PHULAX_INFERENCE_BACKEND=llama_cpp
