import Link from "next/link";
import {
  Shield,
  Zap,
  Eye,
  Brain,
  Lock,
  ArrowRight,
  Activity,
  Database,
  Workflow,
  Cpu,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  Radio,
  KeyRound,
  Layers,
  Target,
  Network,
} from "lucide-react";
import {
  PHULAX_ACCOUNT,
  HUB,
  PHULAX_INFT,
  FAKE_POOL,
  FAKE_POOL_ADAPTER,
  DEMO_ASSET,
} from "@/lib/contracts";
import { shortAddr } from "@/lib/utils";

export const metadata = {
  title: "Phulax — Protect. Detect. Withdraw.",
  description:
    "An autonomous on-chain guardian agent that detects DeFi exploits in real time and pulls your funds out before the attacker drains the pool.",
};

export default function WhatIsItPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <BackgroundFx />

      <Nav />

      <Hero />

      <section className="relative mx-auto w-full max-w-6xl px-6 pb-24">
        <Pitch />
        <ProblemFlip />
        <Architecture />
        <DetectionStack />
        <Invariants />
        <Stack />
        <LiveTestnet />
        <Cta />
      </section>

      <Footer />
    </div>
  );
}

/* ---------------------------------------------------------------- */
/*  Background — animated grid + radial glows                       */
/* ---------------------------------------------------------------- */

function BackgroundFx() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden
    >
      {/* radial glows */}
      <div className="absolute -left-40 -top-40 h-[640px] w-[640px] rounded-full bg-primary/10 blur-[140px]" />
      <div className="absolute -right-40 top-1/3 h-[520px] w-[520px] rounded-full bg-accent/10 blur-[140px]" />
      <div className="absolute bottom-0 left-1/3 h-[420px] w-[420px] rounded-full bg-danger/[0.07] blur-[120px]" />

      {/* grid */}
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "linear-gradient(to right, hsl(220 14% 18% / 0.6) 1px, transparent 1px), linear-gradient(to bottom, hsl(220 14% 18% / 0.6) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(ellipse at 50% 30%, black 30%, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at 50% 30%, black 30%, transparent 78%)",
        }}
      />

      {/* scan-line shimmer (very subtle) */}
      <div
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent animate-pulse-glow"
        style={{ animationDuration: "5s" }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- */
/*  Nav                                                             */
/* ---------------------------------------------------------------- */

function Nav() {
  return (
    <header className="relative z-20 flex items-center justify-between border-b border-border/60 bg-background/40 px-6 py-4 backdrop-blur-md">
      <Link href="/" className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 ring-1 ring-primary/30 text-primary">
          <Shield className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-semibold tracking-tight">Phulax</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            guardian agent
          </div>
        </div>
      </Link>

      <nav className="flex items-center gap-2">
        <Link
          href="/"
          className="rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Dashboard
        </Link>
        <a
          href="https://github.com/Dev43/phulax"
          target="_blank"
          rel="noreferrer"
          className="rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          GitHub
        </a>
        <Link
          href="/"
          className="ml-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Open dashboard
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </nav>
    </header>
  );
}

/* ---------------------------------------------------------------- */
/*  Hero                                                            */
/* ---------------------------------------------------------------- */

function Hero() {
  return (
    <section className="relative z-10 mx-auto w-full max-w-6xl px-6 pt-16 pb-20 md:pt-24 md:pb-28">
      <div className="flex justify-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/[0.06] px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-primary">
          <Sparkles className="h-3 w-3" />
          live on 0G galileo · chain 16602
        </span>
      </div>

      <h1 className="mx-auto mt-7 max-w-4xl text-center text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
        <span className="bg-gradient-to-br from-foreground via-foreground to-foreground/60 bg-clip-text text-transparent">
          Protect. Detect.
        </span>{" "}
        <span className="relative inline-block">
          <span className="bg-gradient-to-br from-primary via-primary to-accent bg-clip-text text-transparent">
            Withdraw.
          </span>
          <span
            className="absolute inset-x-0 -bottom-1 h-px bg-gradient-to-r from-transparent via-primary to-transparent"
            aria-hidden
          />
        </span>
      </h1>

      <p className="mx-auto mt-6 max-w-2xl text-center text-lg leading-relaxed text-muted-foreground md:text-xl">
        Phulax is an autonomous on-chain{" "}
        <span className="text-foreground">guardian agent</span> that watches
        your DeFi positions, detects exploit transactions in real time, and
        pulls your funds out{" "}
        <span className="text-foreground">before the attacker drains the pool</span>.
      </p>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="group inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-[0_0_40px_-10px] shadow-primary/60 transition-all hover:bg-primary/90 hover:shadow-primary/80"
        >
          <Activity className="h-4 w-4" />
          Watch the agent live
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
        <a
          href="#how-it-works"
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card/40 px-5 py-2.5 text-sm font-medium text-foreground backdrop-blur-sm transition-colors hover:bg-muted"
        >
          How it works
        </a>
      </div>

      {/* the punchline */}
      <div className="mx-auto mt-16 max-w-3xl">
        <div className="relative rounded-xl border border-primary/20 bg-card/40 p-6 text-center backdrop-blur-md md:p-8">
          <div className="absolute inset-0 -z-10 rounded-xl bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
          <div className="text-[10px] uppercase tracking-[0.25em] text-primary">
            the 30-second pitch
          </div>
          <p className="mt-4 text-lg leading-relaxed text-foreground md:text-xl">
            The attacker submits a draining transaction. KeeperHub fires the
            workflow on that very tx. The calldata matches a known-attack
            embedding on 0G Storage. The fine-tuned classifier scores{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-base text-primary">
              p(nefarious) = 0.94
            </code>
            . The agent fires <code className="font-mono text-primary">withdraw</code>{" "}
            via KeeperHub's private routing in the same flow.
          </p>
          <p className="mt-5 font-mono text-sm text-muted-foreground">
            The attack tx still lands. The pool still drains.
            <br />
            <span className="text-foreground">We're just not in it anymore.</span>
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/*  Pitch metrics                                                   */
/* ---------------------------------------------------------------- */

function Pitch() {
  const items = [
    {
      icon: <Eye className="h-5 w-5" />,
      stat: "per-tx",
      label: "trigger cadence",
      detail: "KeeperHub fires inside the same flow as the malicious tx",
    },
    {
      icon: <Brain className="h-5 w-5" />,
      stat: "Qwen2.5",
      label: "0.5B classifier",
      detail: "LoRA-fine-tuned on labelled nefarious vs benign txs",
    },
    {
      icon: <Lock className="h-5 w-5" />,
      stat: "1 selector",
      label: "agent permission",
      detail: "agent key can call withdraw(adapter) — and nothing else",
    },
    {
      icon: <Database className="h-5 w-5" />,
      stat: "0G",
      label: "storage + compute",
      detail: "vector DB of historical exploits, append-only incident log",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 pt-2 md:grid-cols-4 md:gap-4">
      {items.map((it) => (
        <div
          key={it.label}
          className="group relative overflow-hidden rounded-lg border border-border bg-card/40 p-4 backdrop-blur-sm transition-colors hover:border-primary/40"
        >
          <div className="flex items-center gap-2 text-primary">{it.icon}</div>
          <div className="mt-3 font-mono text-2xl font-semibold tracking-tight text-foreground">
            {it.stat}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {it.label}
          </div>
          <div className="mt-2 text-xs leading-relaxed text-muted-foreground/90">
            {it.detail}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/*  Problem → Flip                                                  */
/* ---------------------------------------------------------------- */

function ProblemFlip() {
  return (
    <div id="how-it-works" className="mt-28 grid gap-6 md:grid-cols-2">
      <div className="rounded-xl border border-danger/30 bg-danger/[0.04] p-6 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-danger">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-[10px] uppercase tracking-[0.2em]">
            the problem
          </span>
        </div>
        <h3 className="mt-3 text-2xl font-semibold tracking-tight">
          DeFi exploits clear in one tx.
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Mango. Cream. Inverse. Euler. KelpDAO. The attack lands. By the time
          you see the Twitter thread, the pool is already drained. Block-time
          monitoring is too slow — the bad transaction is already mined.
        </p>
        <ul className="mt-4 space-y-2 text-xs text-muted-foreground">
          {[
            "Oracle manipulation drains a pool in ~12 seconds.",
            "Reentrancy bugs cascade in a single calldata payload.",
            "Flash-loan amplification turns $1k into $100M of leverage.",
          ].map((t) => (
            <li key={t} className="flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 rounded-full bg-danger" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-primary/30 bg-primary/[0.04] p-6 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-primary">
          <CheckCircle2 className="h-4 w-4" />
          <span className="text-[10px] uppercase tracking-[0.2em]">
            the flip
          </span>
        </div>
        <h3 className="mt-3 text-2xl font-semibold tracking-tight">
          React inside the same workflow.
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Phulax doesn't try to <em>stop</em> the exploit. It rides on the same
          per-tx trigger, scores the calldata in milliseconds, and fires{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-primary">
            withdraw
          </code>{" "}
          through KeeperHub's private routing — guaranteed execution,
          non-frontrunnable, gas-optimised.
        </p>
        <ul className="mt-4 space-y-2 text-xs text-muted-foreground">
          {[
            "Detection runs verifiably on 0G Compute.",
            "Withdraw is hard-coded to send to the owner — never anywhere else.",
            "Every fire is signed, logged to 0G Storage, and replayable.",
          ].map((t) => (
            <li key={t} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/*  Architecture                                                    */
/* ---------------------------------------------------------------- */

function Architecture() {
  return (
    <div className="mt-28">
      <SectionHeader
        kicker="architecture"
        title="One tx in. One withdraw out."
        sub="A flat pipeline from chain trigger to private execution. Everything between is verifiable."
      />

      <div className="mt-10 rounded-xl border border-border bg-card/30 p-4 backdrop-blur-sm md:p-8">
        <div className="grid gap-4 md:grid-cols-5">
          <FlowNode
            icon={<Radio className="h-5 w-5" />}
            label="Per-tx trigger"
            detail="KeeperHub Block trigger + web3/query-transactions filter on the monitored pool"
            tone="accent"
          />
          <FlowArrow />
          <FlowNode
            icon={<Brain className="h-5 w-5" />}
            label="Risk scoring"
            detail="invariants · oracle drift · vector similarity (0G) · Qwen2.5 classifier"
            tone="primary"
          />
          <FlowArrow />
          <FlowNode
            icon={<Zap className="h-5 w-5" />}
            label="Withdraw"
            detail="agent key calls PhulaxAccount.withdraw(adapter) — funds return to owner"
            tone="warn"
          />
        </div>

        <div className="mt-8 grid gap-4 text-xs md:grid-cols-3">
          <CodeBlock
            title="trigger.json"
            tone="accent"
            lines={[
              <>
                <span className="text-muted-foreground">{`"on": `}</span>
                <span className="text-accent">{`"block"`}</span>
                <span className="text-muted-foreground">,</span>
              </>,
              <>
                <span className="text-muted-foreground">{`"filter": `}</span>
                <span className="text-accent">{`"web3/query-transactions"`}</span>
                <span className="text-muted-foreground">,</span>
              </>,
              <>
                <span className="text-muted-foreground">{`"to": `}</span>
                <span className="text-foreground">{`"FakeLendingPool"`}</span>
              </>,
            ]}
          />
          <CodeBlock
            title="score.ts"
            tone="primary"
            lines={[
              <>
                <span className="text-muted-foreground">const </span>
                <span className="text-foreground">score</span>
                <span className="text-muted-foreground"> = aggregate(</span>
              </>,
              <>
                <span className="text-muted-foreground">{`  invariants, oracle,`}</span>
              </>,
              <>
                <span className="text-muted-foreground">{`  vector, classifier`}</span>
              </>,
              <>
                <span className="text-muted-foreground">{`)`}</span>
              </>,
            ]}
          />
          <CodeBlock
            title="exec.ts"
            tone="warn"
            lines={[
              <>
                <span className="text-muted-foreground">if (score &gt; </span>
                <span className="text-warn">threshold</span>
                <span className="text-muted-foreground">) </span>
              </>,
              <>
                <span className="text-muted-foreground">  account.</span>
                <span className="text-foreground">withdraw</span>
                <span className="text-muted-foreground">(adapter)</span>
              </>,
              <>
                <span className="text-muted-foreground">// → owner only</span>
              </>,
            ]}
          />
        </div>
      </div>
    </div>
  );
}

function FlowNode({
  icon,
  label,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  tone: "primary" | "accent" | "warn";
}) {
  const toneMap = {
    primary: "border-primary/40 bg-primary/[0.06] text-primary",
    accent: "border-accent/40 bg-accent/[0.06] text-accent",
    warn: "border-warn/40 bg-warn/[0.06] text-warn",
  } as const;
  return (
    <div className={`relative col-span-1 rounded-lg border ${toneMap[tone]} p-4`}>
      <div className="flex items-center gap-2">{icon}</div>
      <div className="mt-3 text-sm font-semibold text-foreground">{label}</div>
      <div className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
        {detail}
      </div>
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="hidden items-center justify-center md:flex">
      <ArrowRight className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

function CodeBlock({
  title,
  lines,
  tone,
}: {
  title: string;
  lines: React.ReactNode[];
  tone: "primary" | "accent" | "warn";
}) {
  const toneMap = {
    primary: "text-primary",
    accent: "text-accent",
    warn: "text-warn",
  } as const;
  return (
    <div className="rounded-lg border border-border bg-background/60 font-mono text-[11px] leading-relaxed">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className={`text-[10px] uppercase tracking-[0.18em] ${toneMap[tone]}`}>
          {title}
        </span>
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-muted" />
          <span className="h-1.5 w-1.5 rounded-full bg-muted" />
          <span className="h-1.5 w-1.5 rounded-full bg-muted" />
        </div>
      </div>
      <div className="px-3 py-3">
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/*  Detection stack                                                 */
/* ---------------------------------------------------------------- */

function DetectionStack() {
  const tiers = [
    {
      n: "01",
      icon: <Activity className="h-5 w-5" />,
      title: "Invariant watchers",
      desc: "Per-block sanity: solvency, utilisation, vault share-price monotonicity, totalSupply vs reserves. Reliable, deterministic.",
      tag: "deterministic",
    },
    {
      n: "02",
      icon: <Target className="h-5 w-5" />,
      title: "Oracle deviation",
      desc: "Protocol's read price vs Chainlink, DEX TWAP, CEX spot. Catches the Mango / Cream / Inverse class directly.",
      tag: "primary signal",
    },
    {
      n: "03",
      icon: <GitBranch className="h-5 w-5" />,
      title: "Vector similarity",
      desc: "Embed each historical exploit as {calldata, state delta, root cause}. Cosine match against 5–10 known attacks on 0G Storage.",
      tag: "0G storage",
    },
    {
      n: "04",
      icon: <Brain className="h-5 w-5" />,
      title: "Fine-tuned classifier",
      desc: "Qwen2.5-0.5B + LoRA, fine-tuned on a labelled nefarious-vs-benign corpus. Returns p(nefarious) with a signed receipt.",
      tag: "0G compute",
    },
  ];

  return (
    <div className="mt-28">
      <SectionHeader
        kicker="detection"
        title="Four signals. One score."
        sub="Each layer is independently inspectable. The aggregator combines them into a single number, which the user's iNFT thresholds against."
      />

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {tiers.map((t) => (
          <div
            key={t.n}
            className="group relative overflow-hidden rounded-xl border border-border bg-card/30 p-6 backdrop-blur-sm transition-all hover:border-primary/40 hover:bg-card/60"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/20">
                  {t.icon}
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    tier {t.n}
                  </div>
                  <div className="text-base font-semibold tracking-tight">
                    {t.title}
                  </div>
                </div>
              </div>
              <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {t.tag}
              </span>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              {t.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/*  Invariants                                                      */
/* ---------------------------------------------------------------- */

function Invariants() {
  const items = [
    {
      icon: <KeyRound className="h-4 w-4" />,
      title: "Agent never holds funds",
      detail: (
        <>
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-primary">
            withdraw
          </code>{" "}
          is hard-coded to send to <span className="text-foreground">owner</span>.
          No <code className="font-mono text-[11px]">to</code> parameter. Enforced
          in Solidity, not off-chain.
        </>
      ),
    },
    {
      icon: <Lock className="h-4 w-4" />,
      title: "One selector, one agent",
      detail:
        "Agent role can call withdraw(adapter) and nothing else. No upgradability, no delegatecall, no escape hatch. Asserted across 512 fuzz runs.",
    },
    {
      icon: <Layers className="h-4 w-4" />,
      title: "Detection is pure",
      detail: (
        <>
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
            detect(tx, ctx) → Score
          </code>{" "}
          has no side effects. Any historical exploit can be replayed through it as a regression test.
        </>
      ),
    },
    {
      icon: <Database className="h-4 w-4" />,
      title: "No database in the agent",
      detail:
        "0G Storage (KV + Log) is the database. Append-only incident history per user, queryable by anyone. This is part of the pitch.",
    },
  ];

  return (
    <div className="mt-28">
      <SectionHeader
        kicker="security model"
        title="Invariants the contract enforces."
        sub="The worst case for a compromised agent key is that it forces an exit. It cannot redirect funds, swap, or upgrade."
      />

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {items.map((it) => (
          <div
            key={it.title}
            className="rounded-xl border border-border bg-card/30 p-5 backdrop-blur-sm"
          >
            <div className="flex items-center gap-2 text-primary">{it.icon}</div>
            <div className="mt-3 text-sm font-semibold text-foreground">
              {it.title}
            </div>
            <div className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {it.detail}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/*  Stack                                                           */
/* ---------------------------------------------------------------- */

function Stack() {
  const stack = [
    {
      icon: <Database className="h-4 w-4" />,
      name: "0G Storage",
      role: "KV index of attack embeddings + per-user incident log. Backs the iNFT memory pointer.",
    },
    {
      icon: <Cpu className="h-4 w-4" />,
      name: "0G Compute",
      role: "Sealed inference for the risk-scoring LLM call. Verifiable end-to-end.",
    },
    {
      icon: <Brain className="h-4 w-4" />,
      name: "0G Fine-Tuning",
      role: "Shared Qwen2.5-0.5B classifier — every user's iNFT links to the same merged weights.",
    },
    {
      icon: <Workflow className="h-4 w-4" />,
      name: "KeeperHub",
      role: "Per-tx trigger + private execution. The bridge to 0G is part of this hackathon.",
    },
    {
      icon: <Sparkles className="h-4 w-4" />,
      name: "ERC-7857 iNFT",
      role: "User owns their guardian. Embeds policy, adapter set, false-positive feedback.",
    },
    {
      icon: <Network className="h-4 w-4" />,
      name: "0G Galileo",
      role: "Chain id 16602. All five vulnerable demo contracts live and exploitable on testnet.",
    },
  ];
  return (
    <div className="mt-28">
      <SectionHeader
        kicker="the stack"
        title="Built end-to-end on 0G."
        sub="Storage, compute, fine-tuning, and the chain itself. Plus an upstream KeeperHub PR that adds 0G as a first-class workflow target."
      />
      <div className="mt-10 grid gap-3 md:grid-cols-3">
        {stack.map((s) => (
          <div
            key={s.name}
            className="rounded-lg border border-border bg-card/30 p-4 backdrop-blur-sm transition-colors hover:border-primary/30"
          >
            <div className="flex items-center gap-2">
              <div className="grid h-7 w-7 place-items-center rounded bg-primary/10 text-primary ring-1 ring-primary/20">
                {s.icon}
              </div>
              <span className="text-sm font-semibold tracking-tight">
                {s.name}
              </span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {s.role}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/*  Live testnet addresses                                          */
/* ---------------------------------------------------------------- */

function LiveTestnet() {
  const rows = [
    { label: "PhulaxAccount", addr: PHULAX_ACCOUNT },
    { label: "Hub", addr: HUB },
    { label: "PhulaxINFT (ERC-7857)", addr: PHULAX_INFT },
    { label: "FakeLendingPool", addr: FAKE_POOL },
    { label: "FakePoolAdapter", addr: FAKE_POOL_ADAPTER },
    { label: "DemoAsset (pUSD)", addr: DEMO_ASSET },
  ];
  return (
    <div className="mt-28">
      <SectionHeader
        kicker="live on testnet"
        title="Five intentional exploits. All deployed."
        sub="Every contract is verified on 0G Galileo. Every drain test is reproducible end-to-end."
      />
      <div className="mt-8 overflow-hidden rounded-xl border border-border bg-card/30 backdrop-blur-sm">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border bg-background/40">
            <tr>
              <th className="px-4 py-3 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                contract
              </th>
              <th className="px-4 py-3 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                address
              </th>
              <th className="px-4 py-3 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                short
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr
                key={r.label}
                className="transition-colors hover:bg-muted/30"
              >
                <td className="px-4 py-3 font-medium text-foreground">
                  {r.label}
                </td>
                <td className="px-4 py-3 font-mono text-muted-foreground">
                  {r.addr}
                </td>
                <td className="px-4 py-3 font-mono text-primary">
                  {shortAddr(r.addr)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/*  CTA                                                             */
/* ---------------------------------------------------------------- */

function Cta() {
  return (
    <div className="mt-28">
      <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/[0.08] via-card/60 to-accent/[0.06] p-10 text-center backdrop-blur-md md:p-16">
        <div className="absolute inset-0 -z-10 opacity-40">
          <div className="absolute -left-20 -top-20 h-80 w-80 rounded-full bg-primary/20 blur-3xl" />
          <div className="absolute -right-20 -bottom-20 h-80 w-80 rounded-full bg-accent/20 blur-3xl" />
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/[0.06] px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-primary">
          <Activity className="h-3 w-3" />
          stream live
        </div>
        <h2 className="mt-5 text-3xl font-semibold tracking-tight md:text-5xl">
          Watch the agent think.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
          The dashboard is one screen on purpose. Streaming logs, four risk
          signals, an incident timeline. Trigger a demo exploit and watch the
          guardian react in the same flow.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="group inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-[0_0_60px_-15px] shadow-primary/70 transition-all hover:bg-primary/90"
          >
            Open the dashboard
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a
            href="https://github.com/Dev43/phulax"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background/60 px-5 py-2.5 text-sm text-foreground transition-colors hover:bg-muted"
          >
            Read the code
          </a>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/*  Footer                                                          */
/* ---------------------------------------------------------------- */

function Footer() {
  return (
    <footer className="relative z-10 border-t border-border/60 bg-background/40 px-6 py-8 text-center text-xs text-muted-foreground backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Shield className="h-3.5 w-3.5 text-primary" />
          <span>Phulax — Greek φύλαξ, "guardian"</span>
        </div>
        <div className="font-mono">
          0G Galileo · chain 16602 · hackathon build
        </div>
      </div>
    </footer>
  );
}

/* ---------------------------------------------------------------- */
/*  Section header                                                  */
/* ---------------------------------------------------------------- */

function SectionHeader({
  kicker,
  title,
  sub,
}: {
  kicker: string;
  title: string;
  sub?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="text-[11px] uppercase tracking-[0.25em] text-primary">
        {kicker}
      </div>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
        {title}
      </h2>
      {sub ? (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {sub}
        </p>
      ) : null}
    </div>
  );
}
