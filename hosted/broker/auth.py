"""Clerk JWT verification — Phase 2.

Two modes:
1. Real Clerk: set CLERK_JWKS_URL (e.g. https://<your-instance>.clerk.accounts.dev/.well-known/jwks.json)
   and CLERK_ISSUER. The broker fetches the JWKS once, caches it for 1h,
   and verifies the `Authorization: Bearer <jwt>` on every protected route.

2. Dev/no-auth: if CLERK_JWKS_URL is unset, the broker accepts a header
   X-Dev-User-Id: user_dev_xxx as the user identity. Useful for local
   integration tests against the docker-compose stack.

The verified identity is stored on the aiohttp request via req["user"].
"""
from __future__ import annotations

import json
import os
import time
import urllib.request
from typing import Any, Optional

import jwt
from aiohttp import web

CLERK_JWKS_URL = os.environ.get("CLERK_JWKS_URL", "")
CLERK_ISSUER   = os.environ.get("CLERK_ISSUER", "")  # e.g. https://<instance>.clerk.accounts.dev
CLERK_AUDIENCE = os.environ.get("CLERK_AUDIENCE", "")  # optional; Clerk usually omits aud
DEV_USER_ID    = os.environ.get("DEV_USER_ID", "user_dev_local")


_jwks_cache: dict = {"fetched_at": 0.0, "keys": []}


def _refresh_jwks() -> list[dict]:
    """Fetch JWKS once an hour. Falls back to cached copy on transient failure."""
    if time.time() - _jwks_cache["fetched_at"] < 3600 and _jwks_cache["keys"]:
        return _jwks_cache["keys"]
    if not CLERK_JWKS_URL:
        return []
    try:
        with urllib.request.urlopen(CLERK_JWKS_URL, timeout=5) as r:
            data = json.loads(r.read().decode("utf-8"))
        keys = data.get("keys") or []
        _jwks_cache["keys"] = keys
        _jwks_cache["fetched_at"] = time.time()
        return keys
    except Exception:
        return _jwks_cache["keys"]  # stale-while-error


def _key_for_kid(kid: str) -> Optional[dict]:
    for k in _refresh_jwks():
        if k.get("kid") == kid:
            return k
    return None


def verify_jwt(token: str) -> Optional[dict]:
    """Return the verified claims dict on success, None on failure."""
    if not CLERK_JWKS_URL:
        return None
    try:
        unverified = jwt.get_unverified_header(token)
    except Exception:
        return None
    kid = unverified.get("kid")
    if not kid:
        return None
    jwk = _key_for_kid(kid)
    if jwk is None:
        return None
    try:
        public_key = jwt.algorithms.RSAAlgorithm.from_jwk(jwk)
        opts = {"verify_aud": bool(CLERK_AUDIENCE)}
        return jwt.decode(
            token, public_key, algorithms=[jwk.get("alg", "RS256")],
            issuer=CLERK_ISSUER or None,
            audience=CLERK_AUDIENCE or None,
            options=opts,
        )
    except jwt.InvalidTokenError:
        return None


def identity_from_request(req: web.Request) -> Optional[dict]:
    """Return {user_id, email, name, source} or None."""
    # 1. Real Clerk JWT in Authorization header.
    auth = req.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        token = auth[len("Bearer "):]
        claims = verify_jwt(token)
        if claims:
            return {
                "user_id":  claims.get("sub") or claims.get("user_id") or "",
                "email":    claims.get("email") or (claims.get("email_addresses") or [{}])[0].get("email_address", ""),
                "name":     claims.get("name") or claims.get("full_name") or "",
                "source":   "clerk",
            }
    # 2. Dev fallback when Clerk isn't configured.
    if not CLERK_JWKS_URL:
        dev = req.headers.get("x-dev-user-id") or DEV_USER_ID
        return {
            "user_id": dev,
            "email":   f"{dev}@localhost",
            "name":    dev,
            "source":  "dev",
        }
    return None


@web.middleware
async def auth_middleware(req: web.Request, handler: Any) -> web.StreamResponse:
    """Attach identity to every request. Routes decide if they require it."""
    req["user"] = identity_from_request(req)
    return await handler(req)


def require_user(req: web.Request) -> Optional[web.Response]:
    if not req.get("user"):
        return web.json_response({"error": "unauthorized"}, status=401)
    return None


def require_admin(req: web.Request, user_row: Optional[dict]) -> Optional[web.Response]:
    if not req.get("user"):
        return web.json_response({"error": "unauthorized"}, status=401)
    if not user_row or user_row.get("role") != "admin":
        return web.json_response({"error": "forbidden"}, status=403)
    return None
