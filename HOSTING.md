# Hosting gstack on the web — Phase 2

The repo now ships three runnable pieces:

| Piece | Where | Runs on | Stack |
|---|---|---|---|
| **broker** | `broker/` | Fly.io / Railway / any Docker host | Python 3.12 + aiohttp + psycopg + Clerk JWT |
| **frontend** | `gstack-web/` | Vercel | Next.js 15 + Clerk + Tailwind v4 |
| **worker** | `worker.py` (root) | user's laptop or any box with Claude Code | Python 3 stdlib + websockets |

Add Postgres (Supabase, Fly Postgres, Neon, or RDS) and you have a
multi-tenant hosted gstack.

```
                         ┌──────────────────────┐
   user's browser  ◄────►│   gstack-web         │ Vercel
                         │   Next.js + Clerk    │
                         └──────────┬───────────┘
                                    │  /api/* (rewrite)
                                    ▼
                         ┌──────────────────────┐         ┌─────────────────┐
                         │     broker           │◄───────►│  Postgres       │
                         │     aiohttp          │         │  (Supabase /    │
                         │     /api/*           │         │   Fly Postgres) │
                         │     /v1/workers/…    │         └─────────────────┘
                         └──────────┬───────────┘
                                    │ WS  (assignment, recall)
                                    ▼
                         ┌──────────────────────┐
                         │     worker.py        │  user's laptop
                         │     + Claude session │
                         │     + server.py      │
                         │     + bridges        │
                         └──────────┬───────────┘
                                    │ AgentCall
                                    ▼
                         ┌──────────────────────┐
                         │   Google Meet / Zoom │
                         └──────────────────────┘
```

---

## Local end-to-end stack

```bash
# 1. Bring up Postgres + broker.
docker compose up postgres broker

# 2. Frontend (separate terminal).
cd gstack-web
cp .env.example .env.local       # paste Clerk keys (free dev instance is fine)
npm install
npm run dev
# → http://localhost:3000

# 3. Sign in (first user becomes admin automatically).
# 4. Visit /workers, mint a key, copy the gw_… string.
# 5. On the same machine (or another), run a worker:
mkdir -p ~/.gstack
echo '{"worker_key":"gw_PASTE"}' > ~/.gstack/worker.json
chmod 600 ~/.gstack/worker.json
GSTACK_BROKER_URL=ws://127.0.0.1:8787/v1/workers/connect python3 worker.py

# 6. Back in the browser, the worker shows as idle on the dashboard.
#    Paste a Meet URL, pick specialists, hit Dispatch. The worker calls
#    its local server.py /dispatch, the bot joins, your Claude Code
#    session (next to worker.py) is the brain.
```

The dev fallback skips Clerk if `CLERK_JWKS_URL` is unset — the broker
reads `X-Dev-User-Id` instead. Useful for curling without a browser.

---

## Production deploy

### 1. Postgres

Easiest: Supabase (free tier). Copy the connection string from
*Project Settings → Database → URI*. Or `fly postgres create`.

### 2. Broker → Fly.io

```bash
cd broker
fly launch --no-deploy --name gstack-broker
fly secrets set \
  DATABASE_URL="postgresql://...your supabase connection string..." \
  CLERK_JWKS_URL="https://<instance>.clerk.accounts.dev/.well-known/jwks.json" \
  CLERK_ISSUER="https://<instance>.clerk.accounts.dev" \
  GSTACK_POOL_AGENTCALL_KEY="ak_ac_..."
fly deploy
```

(The `fly.toml` in `broker/` is preconfigured. The Dockerfile is
self-contained — it COPYs `broker/` and `data/` only.)

### 3. Frontend → Vercel

```bash
cd gstack-web
vercel link
vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY production
vercel env add CLERK_SECRET_KEY production
vercel env add GSTACK_BROKER_URL production   # https://gstack-broker.fly.dev
vercel deploy --prod
```

### 4. Tell your users to run a worker

Each user signs in, mints a `gw_…` worker key for each machine they
own, drops it into `~/.gstack/worker.json`, and runs:

```bash
GSTACK_BROKER_URL=wss://gstack-broker.fly.dev/v1/workers/connect \
  python3 worker.py
```

The Claude Code session in the same terminal is the brain — see
`WORKER.md` for the brain-loop.

---

## What Phase 2 actually changed (vs Phase 1)

| Concern | Phase 1 | Phase 2 |
|---|---|---|
| Store | JSON file at `/tmp/gstack-broker-state.json` | Postgres with migrations |
| Auth on /api/dispatch | open | Clerk JWT (or dev fallback) |
| Worker ownership | global pool | per-user (admins see all) |
| Worker key minting | `curl -H "Bearer $ADMIN_TOKEN"` | sign-in + click in /workers |
| Audit | none | `audit_log` table writes on every dispatch / recall / mint / revoke |
| Per-tenant configs | n/a | `specialist_overrides` table — override description / voice / name per user |
| Deploy | local-only | Vercel + Fly.io + Postgres |

The dispatch protocol over the WS is unchanged — Phase 1 workers
connect to a Phase 2 broker without any change to `worker.py`.

---

## What's still missing (Phase 3+)

- Per-user **quota enforcement** ticks (the broker checks `minutes_used`
  on dispatch but doesn't actually increment it yet — needs an
  end-of-call hook on the assignment update path).
- **Stripe** integration for paid plans.
- **Slack / GitHub PR / Calendar webhook** as alternative dispatch
  triggers (the broker already accepts JSON; a tiny adapter per source).
- **Specialist overrides UI** in the frontend (the API is there;
  the UI is not).
- **Transcript replay** — the worker has the session dir; a small
  upload-on-end loop would let admins replay calls in the dashboard.

Open an issue or PR.
