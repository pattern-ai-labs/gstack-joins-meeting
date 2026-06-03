# hosted/ — multi-tenant gstack

This subtree is **only for the maintainer of a hosted demo** (Pattern AI
Labs runs the canonical one) **or anyone self-hosting a multi-tenant
variant**. If you just want gstack specialists in your own meetings,
**you don't need any of this** — see the top-level [README](../README.md)
and follow the 60-second install.

```
hosted/
├── README.md              ← you are here
├── HOSTING.md             ← deploy walk-through (Vercel + Fly + Supabase + Clerk)
├── WORKER.md              ← brain-loop for worker.py operators
├── worker.py              ← WS daemon that turns a laptop into a job-pool worker
├── docker-compose.yml     ← local 3-service stack (postgres + broker + worker)
├── broker/                ← aiohttp service: per-user dispatch + Clerk JWT + Postgres
│   ├── main.py
│   ├── db.py
│   ├── auth.py
│   ├── migrations/
│   ├── Dockerfile
│   └── fly.toml
├── gstack-web/            ← Next.js 15 frontend: marketing landing + dashboard + admin
└── scripts/
    └── deploy.sh          ← `scripts/deploy.sh broker|web|all`
```

## When to use the hosted variant

| Want | Use |
|---|---|
| Try gstack in a meeting without installing anything | **Tier 1**. Visit the hosted demo (gstack.dev — link in repo description). |
| Install gstack on your own laptop and use it daily | **Tier 2**. See [`../README.md`](../README.md). |
| Host a multi-tenant gstack variant for your team / customers | **Tier 3**. See [`HOSTING.md`](./HOSTING.md). |

## Quick local stack

```bash
# from REPO ROOT (Dockerfile builds against the parent context)
docker compose -f hosted/docker-compose.yml up postgres broker

# separate terminal
cd hosted/gstack-web
cp .env.example .env.local
npm install
npx next dev -p 3030
# → http://localhost:3030
```

No Clerk keys? The broker uses an `X-Dev-User-Id` fallback so the UI
works end-to-end. See `HOSTING.md` to plug in real Clerk + Postgres
when you're ready to deploy.

## Why this is separate from the top-level repo

The top-level project is **a Claude Code skill people install on their
laptop**. It's stdlib-Python + vanilla-JS by design. Cloners shouldn't
need to provision Postgres, sign up for Clerk, or read a 200-line
deploy doc to use it.

The hosted/ subtree is **a SaaS-shape on top of the same engine**.
Same `server.py`. Same specialists. Same bots. The hosted/ wrapper
just adds multi-tenant routing + an authenticated frontend on top —
so people can taste-test without installing.

Both modes share `data/specialists.json` and `vendor/bridge*.py` as
the single source of truth.
