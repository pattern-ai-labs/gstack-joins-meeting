# gstack-web — Phase 2 frontend

Next.js 15 (App Router) + Clerk + Tailwind v4 + SWR. Talks to the
[broker](../broker/) at `$GSTACK_BROKER_URL` via Next's rewrites — the
browser only ever calls `/api/*` on its own origin, so CORS stays
clean and the JWT travels in a same-site request.

## Local dev

```bash
# 1. Bring up the broker + Postgres (from the repo root).
docker compose up postgres broker

# 2. Install + run the frontend.
cd gstack-web
cp .env.example .env.local
# edit .env.local — paste your Clerk keys (free dev instance is fine)
npm install
npm run dev
# → http://localhost:3000
```

The first user that signs in is auto-promoted to `admin`.

## Pages

| Route | What |
|---|---|
| `/` | Paste Meet URL, pick specialists, dispatch. Shows your workers + recent assignments. |
| `/workers` | Mint / revoke `gw_…` worker keys. Each key is shown ONCE. |
| `/admin` | (admin only) All users, all workers, all assignments. Promote/demote roles. |

## Deploy

Vercel:

```bash
vercel link
vercel env add GSTACK_BROKER_URL                # production: https://gstack-broker.fly.dev
vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY # from clerk.com
vercel env add CLERK_SECRET_KEY                  # from clerk.com
vercel deploy --prod
```

The broker lives at [../broker/](../broker/); see `broker/fly.toml`.
