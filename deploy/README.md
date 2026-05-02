# Phulax single-box deploy

One docker-compose stack that fronts the whole demo behind Caddy on a single
host. Picks the simplest layout that doesn't require patching upstream
KeeperHub:

| Path                | Service              | Notes                                      |
| ------------------- | -------------------- | ------------------------------------------ |
| `/`                 | KeeperHub            | Default mount — no `basePath` patch needed |
| `/web`, `/web/*`    | Phulax web           | Next.js with `basePath=/web` baked at build |
| `/agent`, `/agent/*`| Phulax agent (HTTP)  | Browser-friendly log tail at `/agent`; Caddy strips the prefix before forwarding |
| (internal only)     | inference            | Agent + KH workflow call `http://inference:8000` over the Docker network |

Caddy gates everything with HTTP basic auth. Default creds:

- **username:** `ethglobal`
- **password:** `iofreoifjeroi4324234`

The bcrypt hash is hard-coded in `deploy/Caddyfile`. To rotate:

```bash
htpasswd -nbBC 14 ethglobal '<new-password>'
```

…and replace the line under `basic_auth { ... }`.

## What runs in the stack

- `caddy` — reverse proxy, ACME, basic_auth.
- `db` — Postgres 16 for KeeperHub.
- `localstack` — SQS only; KeeperHub workers expect it.
- `keeperhub` — Next.js app from the submodule's `Dockerfile` (target `runner`).
- `web` — Next.js dashboard built with `NEXT_PUBLIC_BASE_PATH=/web`.
- `agent` — Fastify detection HTTP service. The container holds **no** private keys (KH does signing).
- `inference` — FastAPI + transformers serving merged Qwen2.5-0.5B + LoRA from `ml/artifacts/merged/`. Same `transformers` stage of `inference/Dockerfile` we ship to Fly.

## First-time bring-up

```bash
cp deploy/.env.example .env             # fill PHULAX_INFERENCE_HMAC_KEY, etc.
git submodule update --init --recursive  # keeperhub/ must be populated
docker compose up -d --build             # ~10–25 min on first build
docker compose logs -f caddy             # watch the front door
```

The first build is slow because:

- `inference` bakes the ~1 GB merged checkpoint into its image.
- `keeperhub` runs a multi-stage `pnpm install` + `next build` (~6 min on a 4-core box).

Subsequent rebuilds reuse cached layers — code-only changes finish in ~30 s.

## VM sizing (rough)

| Service       | Steady-state RAM | Cold start |
| ------------- | ---------------- | ---------- |
| keeperhub     | ~1.0–1.5 GB      | ~30 s      |
| db (postgres) | ~200 MB          | <5 s       |
| localstack    | ~250 MB          | ~15 s      |
| web           | ~150 MB          | ~5 s       |
| agent         | ~150 MB          | <5 s       |
| inference     | ~1.4 GB          | ~30 s (1 GB safetensors load) |
| caddy         | ~30 MB           | <2 s       |

Total: **~3.5 GB resident**. Recommend an **8 GB VM** so KH builds don't
swap (the build itself peaks at ~3 GB on top of running services).

Cheap options that work:

- Hetzner CX32 (4 vCPU / 8 GB / dedicated, ~€7/mo)
- Fly.io `performance-2x` (2 vCPU / 4 GB) is too tight; pick `performance-4x` or fall back to a Hetzner box.
- DigitalOcean 8 GB regular droplet (~$48/mo)

## Inference latency note

On Fly's `shared-cpu-1x` we measured ~2 min/call (~0.4 tok/s). On dedicated
CPU you should expect ~10–30 s/call warm; with `min_machines_running = 1`
equivalent (i.e. nothing tearing the model down between calls), the model
stays hot. For the hackathon demo we **do not gate `withdraw` on the
classifier** — tier 1/2/3 (invariants + oracle + vector) decide; the
classifier writes a corroborating receipt to the 0G Storage Log a few
seconds later.

## TLS

Caddy auto-provisions a Let's Encrypt cert when `PHULAX_HOST` is a real
DNS name pointed at the box's IP. For local bring-up against `localhost`,
the cert is self-signed — the browser will warn, but basic_auth still works.

## Security model

- Caddy basic_auth gates **everything**, including `/web` and `/agent`. KeeperHub also has its own auth, which becomes a second gate at the apex.
- The agent container has no on-chain signing key. If `AGENT_PRIVATE_KEY` is ever set in env, the runtime is wired so only `agent/src/exec/withdraw.ts` calls `withdraw(adapter)` (single-selector blast radius enforced in the contract).
- Inference is only reachable on the Docker network — the Caddyfile has no public mount for it. KeeperHub workflow steps call `http://inference:8000` directly.

## Troubleshooting

- **Caddy 502 on `/web/_next/...`**: the build did not get `NEXT_PUBLIC_BASE_PATH=/web`. Rebuild with `docker compose build --build-arg NEXT_PUBLIC_BASE_PATH=/web web`.
- **Caddy 502 on `/agent`**: agent crashed. `docker compose logs agent` for stack trace; the live tail at `/agent` won't render if the process is down.
- **KH "ECONNREFUSED" on Postgres**: db hadn't passed health check yet. `docker compose up -d` retries automatically; if persistent, `docker compose logs db`.
- **Inference 422 / `tag: "stub"`**: weights didn't bake in. Check `ml/artifacts/merged/` is present locally before `up --build`; the `transformers` stage in `inference/Dockerfile` `COPY`s it.
