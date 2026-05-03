"""Render PNG diagrams for the Phulax README.

Run with: `python3 scripts/render_diagrams.py`
Outputs into `docs/img/`.

Pure matplotlib so it works without graphviz/mermaid tooling.
"""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch


# ---------- shared style ----------

BG = "#0B0F1A"
PANEL = "#11162A"
FG = "#E6E9F2"
MUTED = "#8B93A7"
ACCENT = "#7C5CFF"
ACCENT2 = "#22D3EE"
DANGER = "#F43F5E"
OK = "#34D399"
WARN = "#F59E0B"

OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "img"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def _style_axes(ax, w, h):
    ax.set_xlim(0, w)
    ax.set_ylim(0, h)
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_facecolor(BG)


def panel(ax, x, y, w, h, *, fill=PANEL, edge=ACCENT, alpha=0.95, lw=1.6):
    """Draw a rounded panel without any text."""
    patch = FancyBboxPatch(
        (x, y),
        w,
        h,
        boxstyle="round,pad=0.02,rounding_size=0.18",
        linewidth=lw,
        edgecolor=edge,
        facecolor=fill,
        alpha=alpha,
    )
    ax.add_patch(patch)


def panel_with_header(
    ax,
    x,
    y,
    w,
    h,
    header,
    chips=None,
    *,
    fill=PANEL,
    edge=ACCENT,
    header_color=FG,
    header_fs=12,
):
    """Panel with a bold header at the top and optional chip rows below."""
    panel(ax, x, y, w, h, fill=fill, edge=edge)
    ax.text(
        x + w / 2,
        y + h - 0.42,
        header,
        ha="center",
        va="center",
        color=header_color,
        fontsize=header_fs,
        fontweight="bold",
    )
    if not chips:
        return
    chip_h = 0.42
    chip_gap = 0.12
    n = len(chips)
    block_h = n * chip_h + (n - 1) * chip_gap
    top = y + h - 0.95
    for i, text in enumerate(chips):
        cy = top - i * (chip_h + chip_gap) - chip_h
        chip(ax, x + 0.18, cy, w - 0.36, chip_h, text)


def chip(ax, x, y, w, h, text, *, fill="#1A2236", fg=MUTED, fs=8.5, family=None, ha="center"):
    patch = FancyBboxPatch(
        (x, y),
        w,
        h,
        boxstyle="round,pad=0.01,rounding_size=0.12",
        linewidth=1.0,
        edgecolor="#2A3350",
        facecolor=fill,
        alpha=0.95,
    )
    ax.add_patch(patch)
    tx = x + w / 2 if ha == "center" else x + 0.18
    ax.text(tx, y + h / 2, text, ha=ha, va="center", color=fg, fontsize=fs, family=family)


def simple_box(ax, x, y, w, h, text, *, fill=ACCENT, edge=None, fg=FG, fs=11, weight="bold"):
    """Single-line text box (title only) - text centered."""
    edge = edge or fill
    patch = FancyBboxPatch(
        (x, y),
        w,
        h,
        boxstyle="round,pad=0.02,rounding_size=0.18",
        linewidth=1.4,
        edgecolor=edge,
        facecolor=fill,
        alpha=0.95,
    )
    ax.add_patch(patch)
    ax.text(
        x + w / 2,
        y + h / 2,
        text,
        ha="center",
        va="center",
        color=fg,
        fontsize=fs,
        fontweight=weight,
    )


def arrow(ax, x1, y1, x2, y2, *, color=MUTED, label=None, lw=1.4, label_dy=0.18):
    a = FancyArrowPatch(
        (x1, y1),
        (x2, y2),
        arrowstyle="->",
        mutation_scale=14,
        linewidth=lw,
        color=color,
        zorder=5,
    )
    ax.add_patch(a)
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        ax.text(
            mx,
            my + label_dy,
            label,
            ha="center",
            va="bottom",
            color=color,
            fontsize=8,
            fontstyle="italic",
        )


def title(ax, x, y, text, *, fs=20):
    ax.text(x, y, text, ha="left", va="center", color=FG, fontsize=fs, fontweight="bold")


def subtitle(ax, x, y, text, *, fs=10):
    ax.text(x, y, text, ha="left", va="center", color=MUTED, fontsize=fs)


def save(fig, name):
    out = OUT_DIR / name
    fig.savefig(out, dpi=180, bbox_inches="tight", facecolor=BG)
    plt.close(fig)
    print(f"wrote {out.relative_to(OUT_DIR.parent.parent)}")


# ---------- 1. Architecture ----------


def render_architecture():
    """Architecture overview — major nodes + labelled flows. Detail lives in the
    dedicated diagrams (detection-pipeline / inft / workflow)."""

    W, H = 18, 12
    fig, ax = plt.subplots(figsize=(W, H), facecolor=BG)
    _style_axes(ax, W, H)

    title(ax, 0.4, H - 0.55, "Phulax — System Architecture")
    subtitle(
        ax,
        0.4,
        H - 1.05,
        "0G chain   ·   KeeperHub workflows   ·   Self-hosted classifier   ·   ERC-7857 iNFT",
    )

    # ---------- TOP ROW: user / account / iNFT ----------
    top_y = 9.4
    top_h = 1.0
    simple_box(ax, 0.6, top_y, 3.0, top_h, "USER (owner key)", fill="#1F2547", edge=FG, fs=11)
    simple_box(
        ax,
        5.6,
        top_y,
        4.4,
        top_h,
        "PhulaxAccount  (2-key smart wallet)",
        fill="#241B4D",
        edge=ACCENT,
        fs=12,
    )
    simple_box(
        ax,
        12.0,
        top_y,
        4.6,
        top_h,
        "PhulaxINFT  (ERC-7857)",
        fill="#3A2B6E",
        edge=ACCENT,
        fs=12,
    )

    # ---------- MIDDLE ROW: agent / keeperhub ----------
    mid_y = 5.8
    mid_h = 1.6
    simple_box(
        ax,
        5.6,
        mid_y,
        4.4,
        mid_h,
        "Guardian Agent\n(off-chain TS  ·  detection + aggregator)",
        fill="#102841",
        edge=ACCENT2,
        fs=12,
    )
    simple_box(
        ax,
        12.0,
        mid_y,
        4.6,
        mid_h,
        "KeeperHub\nworkflow runtime  +  0G plugins",
        fill="#2A1742",
        edge=ACCENT,
        fs=12,
    )

    # ---------- BOTTOM ROW: 0G storage / classifier / pool ----------
    bot_y = 1.2
    bot_h = 2.6
    simple_box(
        ax,
        0.6,
        bot_y,
        4.6,
        bot_h,
        "0G Storage\nKV exploit index  ·  receipt log",
        fill="#0F3B30",
        edge=OK,
        fs=12,
    )
    simple_box(
        ax,
        5.8,
        bot_y,
        4.6,
        bot_h,
        "Self-hosted Classifier\nQwen2.5-0.5B + LoRA  (fine-tuned on 0G)",
        fill="#3A140C",
        edge=DANGER,
        fs=12,
    )
    simple_box(
        ax,
        11.2,
        bot_y,
        6.4,
        bot_h,
        "FakeLendingPool  +  FakePoolAdapter\n5 intentional vulns  ·  0G Galileo (chain 16602)",
        fill="#3A2B17",
        edge=WARN,
        fs=12,
    )

    # ---------- arrows (start/end at panel edges, labels in clear gutters) ----------
    # top row
    arrow(ax, 3.6, 9.9, 5.6, 9.9)
    ax.text(4.6, 10.05, "deposit", color=MUTED, fontsize=9, fontstyle="italic", ha="center")
    arrow(ax, 10.0, 9.9, 12.0, 9.9)
    ax.text(11.0, 10.05, "mints", color=MUTED, fontsize=9, fontstyle="italic", ha="center")

    # iNFT → account (policy)
    arrow(ax, 12.0, 9.5, 10.0, 9.5, color=ACCENT)
    ax.text(11.0, 9.20, "policy / model link", color=ACCENT, fontsize=9, fontstyle="italic", ha="center")

    # vertical: agent → account (withdraw)
    arrow(ax, 7.0, 7.4, 7.0, 9.4, color=ACCENT2)
    ax.text(7.2, 8.4, "withdraw()", color=ACCENT2, fontsize=9, fontstyle="italic", ha="left")

    # vertical: keeperhub → inft (run / receipts)
    arrow(ax, 13.6, 7.4, 13.6, 9.4, color=ACCENT)
    ax.text(13.8, 8.4, "run / receipts", color=ACCENT, fontsize=9, fontstyle="italic", ha="left")

    # horizontal: agent ↔ keeperhub
    arrow(ax, 10.0, 6.9, 12.0, 6.9, color=ACCENT2)
    ax.text(11.0, 7.05, "HTTP /detect /decide", color=ACCENT2, fontsize=9, fontstyle="italic", ha="center")
    arrow(ax, 12.0, 6.3, 10.0, 6.3, color=ACCENT)
    ax.text(11.0, 5.95, "risk score", color=ACCENT, fontsize=9, fontstyle="italic", ha="center")

    # bottom row → middle row
    arrow(ax, 2.9, 3.8, 6.0, 5.8, color=OK)
    ax.text(4.0, 4.85, "vector / receipts", color=OK, fontsize=9, fontstyle="italic", ha="left")
    arrow(ax, 8.0, 3.8, 8.0, 5.8, color=DANGER)
    ax.text(8.2, 4.85, "classify", color=DANGER, fontsize=9, fontstyle="italic", ha="left")
    arrow(ax, 14.4, 3.8, 14.0, 5.8, color=WARN)
    ax.text(14.55, 4.85, "block events", color=WARN, fontsize=9, fontstyle="italic", ha="left")

    save(fig, "architecture.png")


# ---------- 2. Detection pipeline ----------


def render_detection_pipeline():
    W, H = 18, 8.5
    fig, ax = plt.subplots(figsize=(W, H), facecolor=BG)
    _style_axes(ax, W, H)

    title(ax, 0.4, H - 0.55, "Detection Pipeline")
    subtitle(
        ax,
        0.4,
        H - 1.05,
        "Four tiers fan in to one risk score. Pure functions; replayable against any historical exploit.",
    )

    # input
    simple_box(ax, 0.4, 3.0, 2.6, 1.4, "New tx on\nFakeLendingPool", fill="#1F2547", edge=FG, fs=11)

    # 4 tiers
    tiers = [
        ("Tier 1 — Invariants", "share-price drift  ·  solvency  ·  utilization", OK),
        ("Tier 2 — Oracle deviation", "pool price vs Chainlink / TWAP / spot", ACCENT2),
        ("Tier 3 — Vector similarity", "0G Storage KV  ·  cosine vs known exploits", ACCENT),
        ("Tier 4 — Qwen2.5-0.5B + LoRA", "self-hosted classifier  ·  p(nefarious)", DANGER),
    ]

    body_x = 9.0
    for i, (head, body, color) in enumerate(tiers):
        x = 3.8
        y = 5.4 - i * 1.2
        simple_box(ax, x, y, 5.0, 0.85, head, fill=color, fs=10.5)
        ax.text(
            body_x,
            y + 0.42,
            body,
            ha="left",
            va="center",
            color=MUTED,
            fontsize=9,
        )
        # input → tier
        arrow(ax, 3.0, 3.7, x, y + 0.42, color=color, lw=1.0)
        # tier → aggregator: leave from end of body text, enter aggregator left edge
        arrow(ax, 13.6, y + 0.42, 14.4, 3.85, color=color, lw=1.0)

    # aggregator
    panel_with_header(
        ax,
        14.4,
        3.0,
        3.2,
        1.7,
        "Risk Aggregator",
        chips=["weighted fusion  ·  hysteresis"],
        fill="#3A2B6E",
        edge=ACCENT,
    )

    arrow(ax, 16.0, 3.0, 16.0, 1.7, color=ACCENT)
    simple_box(ax, 14.4, 0.5, 3.2, 1.2, "fire?  →  withdraw()", fill="#42180D", edge=DANGER, fs=11)

    save(fig, "detection-pipeline.png")


# ---------- 3. iNFT card ----------


def render_inft_card():
    W, H = 14, 8.5
    fig, ax = plt.subplots(figsize=(W, H), facecolor=BG)
    _style_axes(ax, W, H)

    title(ax, 0.4, H - 0.55, "Your Guardian — owned as an ERC-7857 iNFT")
    subtitle(
        ax,
        0.4,
        H - 1.05,
        "The agent isn't a SaaS account. It's a token. Policy, memory, and model link travel with the holder.",
    )

    # ---------- Left: token card ----------
    # subtle drop-shadow
    panel(ax, 0.72, 0.28, 6.0, 6.20, fill="#000000", edge="#000000", alpha=0.35, lw=0)
    # main panel — extended down to share y-range with the right column
    panel(ax, 0.6, 0.4, 6.0, 6.20, fill="#1B0F35", edge=ACCENT, lw=1.8)

    # accent ribbon — top inner edge
    ribbon = FancyBboxPatch(
        (0.85, 6.30),
        5.5,
        0.10,
        boxstyle="round,pad=0,rounding_size=0.04",
        linewidth=0,
        facecolor=ACCENT,
        alpha=0.55,
    )
    ax.add_patch(ribbon)

    # token avatar — circle + glyph
    avatar = plt.Circle(
        (1.20, 5.85), 0.34, facecolor=ACCENT, edgecolor=FG, linewidth=1.2, zorder=3
    )
    ax.add_patch(avatar)
    ax.text(
        1.20,
        5.83,
        "Φ",
        ha="center",
        va="center",
        color=FG,
        fontsize=18,
        fontweight="bold",
        zorder=4,
    )

    # title block
    ax.text(
        1.78,
        6.02,
        "PhulaxINFT",
        ha="left",
        va="center",
        color=FG,
        fontsize=15,
        fontweight="bold",
    )
    ax.text(
        1.78,
        5.65,
        "#0001  ·  ERC-7857  ·  0G Galileo",
        ha="left",
        va="center",
        color=MUTED,
        fontsize=9.5,
    )

    # corner mini-badge
    chip(ax, 5.10, 6.00, 1.20, 0.38, "iNFT", fill="#3A2B6E", fg=FG, fs=8.5)

    # divider
    ax.plot([0.85, 6.35], [5.30, 5.30], color="#3A2B6E", lw=1.0, alpha=0.7)

    def _section(y, label, color):
        ax.text(
            0.85,
            y,
            label,
            ha="left",
            va="center",
            color=color,
            fontsize=8,
            fontweight="bold",
        )

    def _mono(y, text):
        chip(ax, 0.85, y, 5.5, 0.42, text, family="monospace", ha="left", fs=8.5)

    # POLICY
    _section(5.05, "POLICY", ACCENT2)
    _mono(4.45, "threshold = 0.78")
    _mono(3.95, "adapters = [FakePoolAdapter]")
    _mono(3.45, "feedback.fp_rate = 0 / 0")

    # MEMORY & MODEL
    _section(3.00, "MEMORY  &  MODEL", OK)
    _mono(2.40, "memory  →  0g://kv/incidents/<owner>")
    _mono(1.90, "model_hash = sha256(merged.safetensors)")

    # IDENTITY
    _section(1.45, "IDENTITY", WARN)
    _mono(0.85, "PhulaxAccount = 0xA70060…18a66")

    # ---------- Right column: per-panel heights sized to chip count ----------
    # Range matches the card: y in [0.40, 6.60].
    # Panel heights satisfy h ≥ 1.37 + (n-1)*0.54 so chips don't overflow.
    rx, rw = 7.4, 6.2

    # Top: Signed receipt (1 chip)
    panel_with_header(
        ax,
        rx,
        5.15,
        rw,
        1.45,
        "Signed receipt (per fire)",
        chips=["{ input_hash, output, model_hash, signature }  →  0G Storage Log"],
        fill="#102841",
        edge=ACCENT2,
    )

    # Middle: Verifiability (2 chips)
    panel_with_header(
        ax,
        rx,
        3.05,
        rw,
        2.00,
        "Verifiability story",
        chips=[
            "weights on 0G Storage  +  eval harness",
            "anyone can replay any fire end-to-end",
        ],
        fill="#0F3B30",
        edge=OK,
    )

    # Bottom: Permission boundary (3 chips)
    panel_with_header(
        ax,
        rx,
        0.40,
        rw,
        2.55,
        "Permission boundary",
        chips=[
            "agent key can call ONE selector",
            "recipient hard-coded to owner",
            "no upgrade  ·  no delegatecall on agent path",
        ],
        fill="#3A140C",
        edge=DANGER,
    )

    save(fig, "inft.png")


# ---------- 4. Workflow timeline ----------


def render_workflow_timeline():
    W, H = 18, 5
    fig, ax = plt.subplots(figsize=(W, H), facecolor=BG)
    _style_axes(ax, W, H)

    title(ax, 0.4, H - 0.45, "KeeperHub workflow — per-block detection loop")
    subtitle(
        ax,
        0.4,
        H - 0.85,
        "Nine nodes. KeeperHub owns the loop; the agent is stateless detection logic it calls over HTTP.",
    )

    nodes = [
        ("Block\ntrigger", ACCENT),
        ("Query Pool\nWithdraws", ACCENT2),
        ("Has\nevents?", MUTED),
        ("Detect\n(tier 1/2/3)", OK),
        ("Has\ncandidate?", MUTED),
        ("Classify\n(tier 4)", DANGER),
        ("Decide\n(aggregate)", ACCENT),
        ("Fire?", MUTED),
        ("withdraw()\n+ receipt", WARN),
    ]

    n = len(nodes)
    pad_l = 0.6
    pad_r = 0.6
    span = W - pad_l - pad_r
    box_w = 1.55
    gap = (span - n * box_w) / (n - 1)
    y = 1.6
    h = 1.5

    centers = []
    for i, (label, color) in enumerate(nodes):
        x = pad_l + i * (box_w + gap)
        simple_box(ax, x, y, box_w, h, label, fill=color, fs=9)
        centers.append((x + box_w, y + h / 2, x, y + h / 2))

    for i in range(n - 1):
        x1, y1, _, _ = centers[i]
        _, _, x2, y2 = centers[i + 1]
        arrow(ax, x1, y1, x2, y2, color=MUTED, lw=1.2)

    save(fig, "workflow.png")


def main():
    render_architecture()
    render_detection_pipeline()
    render_inft_card()
    render_workflow_timeline()


if __name__ == "__main__":
    main()
