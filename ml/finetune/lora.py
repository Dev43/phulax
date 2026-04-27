"""LoRA fine-tune of Qwen2.5-0.5B-Instruct on the Phulax dataset.

Hyperparameters (post-#5 right-sizing for ~330-row dataset):
  - base: Qwen/Qwen2.5-0.5B-Instruct
  - LoRA rank 8, alpha 16, dropout 0.05
  - target modules: attention q + v projections only
  - lr 2e-4, 3 epochs, bf16 if available else fp16
  - 80/20 train/eval split (deterministic seed)

Loss is masked to the assistant span only (#4): user/system tokens are set to
-100 in `labels` so the cross-entropy is computed exclusively over the JSON
target. Concentrates gradient on what we actually want the model to predict.

If OG_FT_ENDPOINT is set, the script POSTs the dataset + config there and polls
for an adapter artefact. Otherwise it runs locally via transformers + peft.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "dataset.jsonl"
OUT = ROOT / "artifacts" / "lora"

BASE_MODEL = "Qwen/Qwen2.5-0.5B-Instruct"
LORA_RANK = 8
LORA_ALPHA = 16
LORA_DROPOUT = 0.05
TARGET_MODULES = ["q_proj", "v_proj"]
LR = 2e-4
EPOCHS = 3
SEED = 1337
MAX_LEN = 768  # canonical blob grew with `caller` + `signal` — give headroom


def load_rows() -> list[dict]:
    if not DATA.exists():
        raise SystemExit(
            f"{DATA} missing - run `uv run python -m data.build_dataset` first."
        )
    return [json.loads(line) for line in DATA.read_text().splitlines() if line.strip()]


def split(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    import random
    rng = random.Random(SEED)
    rng.shuffle(rows)
    cut = int(len(rows) * 0.8)
    return rows[:cut], rows[cut:]


def run_remote_0g(train: list[dict], eval_: list[dict]) -> Path:
    """POST the job to 0G's fine-tuning surface and download the adapter."""
    import httpx

    endpoint = os.environ["OG_FT_ENDPOINT"]
    token = os.environ.get("OG_FT_TOKEN", "")

    job = {
        "base_model": BASE_MODEL,
        "method": "lora",
        "lora": {
            "rank": LORA_RANK,
            "alpha": LORA_ALPHA,
            "dropout": LORA_DROPOUT,
            "target_modules": TARGET_MODULES,
        },
        "training": {"lr": LR, "epochs": EPOCHS, "seed": SEED},
        "train": train,
        "eval": eval_,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"submitting LoRA job to {endpoint}")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    with httpx.Client(timeout=None) as client:
        r = client.post(f"{endpoint}/jobs", json=job, headers=headers)
        r.raise_for_status()
        job_id = r.json()["job_id"]
        print(f"job_id={job_id} - polling...")
        while True:
            s = client.get(f"{endpoint}/jobs/{job_id}", headers=headers).json()
            if s["status"] in ("succeeded", "failed"):
                break
        if s["status"] != "succeeded":
            raise SystemExit(f"0G fine-tune failed: {s}")
        adapter = client.get(
            f"{endpoint}/jobs/{job_id}/artifact", headers=headers
        ).content
    (OUT / "adapter_model.safetensors").write_bytes(adapter)
    return OUT


def run_local(train: list[dict], eval_: list[dict]) -> Path:
    import torch
    from datasets import Dataset
    from peft import LoraConfig, get_peft_model
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        TrainingArguments,
        Trainer,
        DataCollatorForLanguageModeling,
    )

    from prompt.template import chat_messages

    OUT.mkdir(parents=True, exist_ok=True)
    print(f"loading base model {BASE_MODEL}")
    tok = AutoTokenizer.from_pretrained(BASE_MODEL)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    dtype = torch.bfloat16 if torch.cuda.is_available() and torch.cuda.is_bf16_supported() else torch.float16
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        torch_dtype=dtype if torch.cuda.is_available() else torch.float32,
        device_map="auto" if torch.cuda.is_available() else None,
    )

    lora = LoraConfig(
        r=LORA_RANK, lora_alpha=LORA_ALPHA, lora_dropout=LORA_DROPOUT,
        target_modules=TARGET_MODULES, bias="none", task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    def encode(row: dict) -> dict:
        # Tokenise prefix (system + user, with generation prompt) and full
        # transcript separately. Labels are -100 over the prefix so the
        # cross-entropy is only computed on the assistant JSON target.
        prefix_text = tok.apply_chat_template(
            chat_messages(row, with_target=False),
            tokenize=False, add_generation_prompt=True,
        )
        full_text = tok.apply_chat_template(
            chat_messages(row, with_target=True),
            tokenize=False, add_generation_prompt=False,
        )
        prefix_ids = tok(prefix_text, add_special_tokens=False)["input_ids"]
        full = tok(
            full_text,
            truncation=True, max_length=MAX_LEN, padding="max_length",
            add_special_tokens=False,
        )
        labels = list(full["input_ids"])
        # Mask out the prefix span and any pad tokens.
        prefix_len = min(len(prefix_ids), len(labels))
        for i in range(prefix_len):
            labels[i] = -100
        pad_id = tok.pad_token_id
        for i, tid in enumerate(labels):
            if tid == pad_id:
                labels[i] = -100
        full["labels"] = labels
        return full

    train_ds = Dataset.from_list(train).map(encode, remove_columns=list(train[0]))
    eval_ds = Dataset.from_list(eval_).map(encode, remove_columns=list(eval_[0]))

    # Sanity: confirm the assistant span is what we're supervising.
    sample = train_ds[0]
    n_supervised = sum(1 for x in sample["labels"] if x != -100)
    print(f"loss-mask check: {n_supervised}/{len(sample['labels'])} tokens supervised "
          f"(should be ~length of the JSON target, ~20-30)")

    args = TrainingArguments(
        output_dir=str(OUT),
        num_train_epochs=EPOCHS,
        per_device_train_batch_size=2,
        per_device_eval_batch_size=2,
        gradient_accumulation_steps=4,
        learning_rate=LR,
        warmup_ratio=0.05,
        logging_steps=10,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=1,
        bf16=torch.cuda.is_available() and torch.cuda.is_bf16_supported(),
        fp16=torch.cuda.is_available() and not torch.cuda.is_bf16_supported(),
        seed=SEED,
        report_to=[],
    )
    trainer = Trainer(
        model=model, args=args, train_dataset=train_ds, eval_dataset=eval_ds,
        processing_class=tok,
        data_collator=DataCollatorForLanguageModeling(tok, mlm=False),
    )
    trainer.train()
    trainer.save_model(str(OUT))
    tok.save_pretrained(str(OUT))
    return OUT


def main() -> None:
    rows = load_rows()
    train, eval_ = split(rows)
    print(f"train={len(train)} eval={len(eval_)}")

    if os.environ.get("OG_FT_ENDPOINT"):
        out = run_remote_0g(train, eval_)
    else:
        out = run_local(train, eval_)

    (OUT / "training_meta.json").write_text(json.dumps({
        "base_model": BASE_MODEL,
        "rank": LORA_RANK, "alpha": LORA_ALPHA, "dropout": LORA_DROPOUT,
        "target_modules": TARGET_MODULES,
        "lr": LR, "epochs": EPOCHS, "seed": SEED,
        "train_size": len(train), "eval_size": len(eval_),
    }, indent=2))
    print(f"adapter at {out}")


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(ROOT))
    main()
