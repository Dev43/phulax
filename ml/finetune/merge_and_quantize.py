"""Merge LoRA adapter into the base, save safetensors, then quantize to Q4 GGUF.

Q4 GGUF is produced via llama.cpp's `convert_hf_to_gguf.py` + `llama-quantize`.
Set LLAMA_CPP_DIR to a built llama.cpp checkout. If unset we still produce the
merged safetensors and skip quantization with a warning - Track D can run on
the safetensors via transformers if needed.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LORA_DIR = ROOT / "artifacts" / "lora"
MERGED = ROOT / "artifacts" / "merged"
GGUF_FP16 = MERGED / "phulax-fp16.gguf"
GGUF_Q4 = MERGED / "phulax-q4.gguf"


def merge() -> None:
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    from finetune.lora import BASE_MODEL

    print(f"merging {LORA_DIR} into {BASE_MODEL}")
    base = AutoModelForCausalLM.from_pretrained(BASE_MODEL, torch_dtype=torch.float16)
    model = PeftModel.from_pretrained(base, str(LORA_DIR))
    merged = model.merge_and_unload()
    MERGED.mkdir(parents=True, exist_ok=True)
    merged.save_pretrained(str(MERGED), safe_serialization=True)
    AutoTokenizer.from_pretrained(BASE_MODEL).save_pretrained(str(MERGED))
    print(f"merged → {MERGED}")


def quantize() -> None:
    llama = os.environ.get("LLAMA_CPP_DIR")
    if not llama:
        print("LLAMA_CPP_DIR unset; skipping GGUF quantization.")
        print("Track D can serve from the safetensors via transformers.")
        return
    llama_path = Path(llama)
    convert = llama_path / "convert_hf_to_gguf.py"
    quantize_bin = llama_path / "build" / "bin" / "llama-quantize"
    if not convert.exists() or not quantize_bin.exists():
        raise SystemExit(f"llama.cpp convert/quantize not found under {llama_path}")

    print("converting safetensors → fp16 GGUF")
    subprocess.run(
        ["python", str(convert), str(MERGED),
         "--outfile", str(GGUF_FP16), "--outtype", "f16"],
        check=True,
    )
    print("quantizing fp16 → Q4_K_M")
    subprocess.run(
        [str(quantize_bin), str(GGUF_FP16), str(GGUF_Q4), "Q4_K_M"],
        check=True,
    )
    GGUF_FP16.unlink(missing_ok=True)
    print(f"q4 → {GGUF_Q4} ({GGUF_Q4.stat().st_size / 1e6:.1f} MB)")


def main() -> None:
    if not LORA_DIR.exists():
        raise SystemExit(f"{LORA_DIR} missing - run finetune.lora first")
    merge()
    quantize()


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(ROOT))
    main()
