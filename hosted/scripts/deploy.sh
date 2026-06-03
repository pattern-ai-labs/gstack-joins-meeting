#!/usr/bin/env bash
# One-shot deploy script for gstack on Fly.io + Vercel + Supabase + Clerk.
#
# Prerequisites you create yourself (free tiers all work):
#   - Supabase project       https://supabase.com   (copy connection string)
#   - Clerk application      https://clerk.com      (copy pk_test_ / sk_test_)
#   - Fly account            https://fly.io         + `flyctl auth login`
#   - Vercel account         https://vercel.com     + `vercel login`
#
# Then create a .env.deploy file in the repo root with these vars set:
#   DATABASE_URL=postgresql://...
#   CLERK_JWKS_URL=https://<instance>.clerk.accounts.dev/.well-known/jwks.json
#   CLERK_ISSUER=https://<instance>.clerk.accounts.dev
#   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
#   CLERK_SECRET_KEY=sk_test_...
#   GSTACK_POOL_AGENTCALL_KEY=ak_ac_...
#   FLY_APP=gstack-broker                       # name of your Fly app
#   VERCEL_PROJECT=gstack-web                   # name of your Vercel project
#
# Then run:
#   scripts/deploy.sh broker   # deploy backend
#   scripts/deploy.sh web      # deploy frontend
#   scripts/deploy.sh all      # both

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

# shellcheck disable=SC1091
if [[ -f .env.deploy ]]; then
  set -a; source .env.deploy; set +a
fi

: "${FLY_APP:=gstack-broker}"
: "${VERCEL_PROJECT:=gstack-web}"

deploy_broker() {
  echo "▸ deploying broker → fly.io (app=$FLY_APP)"
  [[ -n "${DATABASE_URL:-}" ]] || { echo "DATABASE_URL not set"; exit 1; }
  [[ -n "${CLERK_JWKS_URL:-}" ]] || { echo "CLERK_JWKS_URL not set"; exit 1; }

  # First-time only: launch the app (skips if already exists).
  if ! flyctl status --app "$FLY_APP" > /dev/null 2>&1; then
    echo "  ↳ first deploy — creating app"
    flyctl launch --no-deploy --copy-config --name "$FLY_APP" --region iad \
      --dockerfile broker/Dockerfile --yes
  fi

  echo "  ↳ setting secrets"
  flyctl secrets set --app "$FLY_APP" \
    DATABASE_URL="$DATABASE_URL" \
    CLERK_JWKS_URL="$CLERK_JWKS_URL" \
    CLERK_ISSUER="${CLERK_ISSUER:-}" \
    GSTACK_POOL_AGENTCALL_KEY="${GSTACK_POOL_AGENTCALL_KEY:-}" \
    GSTACK_ALLOWED_ORIGINS="${GSTACK_ALLOWED_ORIGINS:-https://${VERCEL_PROJECT}.vercel.app}"

  echo "  ↳ flyctl deploy"
  flyctl deploy --app "$FLY_APP" --config broker/fly.toml --dockerfile broker/Dockerfile
  echo "✓ broker live at https://${FLY_APP}.fly.dev"
}

deploy_web() {
  echo "▸ deploying frontend → vercel (project=$VERCEL_PROJECT)"
  [[ -n "${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}" ]] || { echo "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY not set"; exit 1; }
  [[ -n "${CLERK_SECRET_KEY:-}" ]] || { echo "CLERK_SECRET_KEY not set"; exit 1; }

  cd "$HERE/gstack-web"

  # First-time only: link to the project.
  if [[ ! -d .vercel ]]; then
    echo "  ↳ first deploy — linking project"
    vercel link --yes --project "$VERCEL_PROJECT"
  fi

  echo "  ↳ pushing env vars (production)"
  for var in NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY CLERK_SECRET_KEY; do
    value="${!var}"
    # `vercel env add` is interactive; pipe value in. Removes first to be idempotent.
    vercel env rm "$var" production --yes 2>/dev/null || true
    printf '%s' "$value" | vercel env add "$var" production
  done

  # GSTACK_BROKER_URL points the Next rewrite at the deployed Fly app.
  broker_url="https://${FLY_APP}.fly.dev"
  vercel env rm GSTACK_BROKER_URL production --yes 2>/dev/null || true
  printf '%s' "$broker_url" | vercel env add GSTACK_BROKER_URL production

  echo "  ↳ vercel deploy --prod"
  vercel deploy --prod --yes
  echo "✓ frontend live"
}

case "${1:-help}" in
  broker) deploy_broker ;;
  web)    deploy_web ;;
  all)    deploy_broker; deploy_web ;;
  *)      sed -n '2,30p' "$0" ;;
esac
