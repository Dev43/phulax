# Phulax inference server.
#
# Phase 2: transformers-served Qwen2.5-0.5B + merged LoRA. The image is uniform
# regardless of phase — server.py stays in stub mode unless PHULAX_MODEL_DIR
# (mounted at runtime, or baked in via a downstream stage that fetches CIDs
# from ml/artifacts.json) resolves to a transformers checkpoint.
#
# Build from the REPO ROOT so the frozen prompt template is in the build
# context:
#   docker build -f inference/Dockerfile -t phulax-inference .

FROM python:3.11-slim AS runtime

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
# version pinned by TEMPLATE_VERSION inside the file. Mirrored at /app/ml so
# the sys.path manipulation in server.py resolves identically to dev runs.
COPY ml/prompt/__init__.py /app/ml/prompt/__init__.py
COPY ml/prompt/template.py /app/ml/prompt/template.py

COPY inference/server.py ./

ENV PHULAX_INFERENCE_PHASE=auto \
    PHULAX_MODEL_HASH=stub
# PHULAX_INFERENCE_HMAC_KEY MUST be supplied at runtime (no default in image).
# PHULAX_MODEL_DIR (optional): mount the merged checkpoint here to enable
# real inference. Without it, /classify falls back to the deterministic stub.

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
