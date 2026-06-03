"""Postgres helpers for the broker. Phase 2.

Uses psycopg3 connection pool. All queries are parameterised.
Migrations in ./migrations/*.sql are applied in lexical order on startup.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Iterable, Optional

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool


DSN = os.environ.get("DATABASE_URL", "postgresql://gstack:gstack@127.0.0.1:5432/gstack")
HERE = Path(__file__).resolve().parent


_pool: Optional[AsyncConnectionPool] = None


async def init_pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        _pool = AsyncConnectionPool(DSN, min_size=1, max_size=10, open=False)
        await _pool.open()
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def run_migrations() -> None:
    """Apply every migrations/*.sql in lexical order. Idempotent — every
    migration uses CREATE … IF NOT EXISTS so re-running is a no-op."""
    pool = await init_pool()
    migrations_dir = HERE / "migrations"
    files = sorted(migrations_dir.glob("*.sql"))
    async with pool.connection() as conn:
        for f in files:
            sql = f.read_text()
            print(f"[db] applying {f.name}", flush=True)
            async with conn.cursor() as cur:
                await cur.execute(sql)
        await conn.commit()


# ──────────────────────────────────────────────────────────────────────────
# users

async def upsert_user(user_id: str, email: Optional[str], name: Optional[str]) -> dict:
    """Idempotent user sync — first user in the system becomes admin."""
    pool = await init_pool()
    async with pool.connection() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute("SELECT COUNT(*) AS n FROM users")
            row = await cur.fetchone()
            initial_role = "admin" if (row or {}).get("n", 0) == 0 else "member"
            await cur.execute(
                """
                INSERT INTO users (id, email, display_name, role, last_seen_at)
                VALUES (%s, %s, %s, %s, now())
                ON CONFLICT (id) DO UPDATE SET
                    email        = COALESCE(EXCLUDED.email, users.email),
                    display_name = COALESCE(EXCLUDED.display_name, users.display_name),
                    last_seen_at = now()
                RETURNING *
                """,
                (user_id, email, name, initial_role),
            )
            user = await cur.fetchone()
        await conn.commit()
    return user  # type: ignore[return-value]


async def get_user(user_id: str) -> Optional[dict]:
    pool = await init_pool()
    async with pool.connection() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute("SELECT * FROM users WHERE id=%s", (user_id,))
            return await cur.fetchone()


async def list_users() -> list[dict]:
    pool = await init_pool()
    async with pool.connection() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute("SELECT * FROM users ORDER BY created_at")
            return list(await cur.fetchall())


async def set_user_role(user_id: str, role: str) -> None:
    pool = await init_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("UPDATE users SET role=%s WHERE id=%s", (role, user_id))
        await conn.commit()


# ──────────────────────────────────────────────────────────────────────────
# worker keys

async def insert_worker_key(key_hash: str, owner_user_id: str, label: str) -> None:
    pool = await init_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """INSERT INTO worker_keys (key_hash, owner_user_id, label)
                   VALUES (%s, %s, %s)""",
                (key_hash, owner_user_id, label),
            )
        await conn.commit()


async def get_worker_key(key_hash: str) -> Optional[dict]:
    pool = await init_pool()
    async with pool.connection() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT * FROM worker_keys WHERE key_hash=%s",
                (key_hash,),
            )
            return await cur.fetchone()


async def find_worker_key_by_prefix(prefix: str, owner_user_id: Optional[str] = None) -> Optional[dict]:
    """Resolve a (12+ char) hash prefix to a full key row.

    Used by the UI's revoke flow, which only shows the prefix to keep the
    full hash out of the page source. Returns None if no match or if the
    prefix is ambiguous (two keys with the same prefix — astronomically
    unlikely but we refuse rather than guess).
    """
    if len(prefix) < 8:
        return None
    pool = await init_pool()
    async with pool.connection() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            if owner_user_id:
                await cur.execute(
                    "SELECT * FROM worker_keys WHERE key_hash LIKE %s AND owner_user_id=%s",
                    (prefix + "%", owner_user_id),
                )
            else:
                await cur.execute(
                    "SELECT * FROM worker_keys WHERE key_hash LIKE %s",
                    (prefix + "%",),
                )
            rows = await cur.fetchall()
    if len(rows) != 1:
        return None
    return rows[0]


async def list_worker_keys(owner_user_id: Optional[str] = None) -> list[dict]:
    pool = await init_pool()
    async with pool.connection() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            if owner_user_id:
                await cur.execute(
                    "SELECT * FROM worker_keys WHERE owner_user_id=%s ORDER BY created_at DESC",
                    (owner_user_id,),
                )
            else:
                await cur.execute("SELECT * FROM worker_keys ORDER BY created_at DESC")
            return list(await cur.fetchall())


async def revoke_worker_key(key_hash: str) -> bool:
    pool = await init_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE worker_keys SET revoked=true WHERE key_hash=%s",
                (key_hash,),
            )
            updated = cur.rowcount
        await conn.commit()
    return updated > 0


async def touch_worker_key(key_hash: str) -> None:
    pool = await init_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE worker_keys SET last_seen_at=now() WHERE key_hash=%s",
                (key_hash,),
            )
        await conn.commit()


# ──────────────────────────────────────────────────────────────────────────
# assignments

async def insert_assignment(
    aid: str, user_id: str, worker_id: Optional[str], worker_key_hash: Optional[str],
    meet_url: str, specialists: list, brief: str, mode: str,
) -> dict:
    pool = await init_pool()
    async with pool.connection() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """INSERT INTO assignments (id, user_id, worker_id, worker_key_hash,
                                            meet_url, specialists, brief, mode, status)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'started')
                   RETURNING *""",
                (aid, user_id, worker_id, worker_key_hash,
                 meet_url, json.dumps(specialists), brief, mode),
            )
            row = await cur.fetchone()
        await conn.commit()
    return row  # type: ignore[return-value]


async def update_assignment_status(aid: str, status: str, detail: Any = None) -> None:
    pool = await init_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            if status == "ended":
                await cur.execute(
                    """UPDATE assignments
                       SET status=%s, detail=%s, ended_at=now(),
                           billable_seconds = EXTRACT(EPOCH FROM (now() - created_at))::int
                       WHERE id=%s""",
                    (status, json.dumps(detail) if detail is not None else None, aid),
                )
            else:
                await cur.execute(
                    "UPDATE assignments SET status=%s, detail=%s WHERE id=%s",
                    (status, json.dumps(detail) if detail is not None else None, aid),
                )
        await conn.commit()


async def list_assignments(user_id: Optional[str] = None, limit: int = 50) -> list[dict]:
    pool = await init_pool()
    async with pool.connection() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            if user_id:
                await cur.execute(
                    """SELECT * FROM assignments WHERE user_id=%s
                       ORDER BY created_at DESC LIMIT %s""",
                    (user_id, limit),
                )
            else:
                await cur.execute(
                    "SELECT * FROM assignments ORDER BY created_at DESC LIMIT %s",
                    (limit,),
                )
            return list(await cur.fetchall())


# ──────────────────────────────────────────────────────────────────────────
# overrides + audit

async def get_overrides(user_id: str) -> dict[str, dict]:
    """Return {specialist_id: {description, voice, name}} for the user."""
    pool = await init_pool()
    out: dict[str, dict] = {}
    async with pool.connection() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT specialist_id, description, voice, name FROM specialist_overrides WHERE user_id=%s",
                (user_id,),
            )
            for r in await cur.fetchall():
                out[r["specialist_id"]] = {k: v for k, v in r.items() if k != "specialist_id" and v is not None}
    return out


async def upsert_override(user_id: str, specialist_id: str,
                          description: Optional[str], voice: Optional[str],
                          name: Optional[str]) -> None:
    pool = await init_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """INSERT INTO specialist_overrides (user_id, specialist_id, description, voice, name)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (user_id, specialist_id) DO UPDATE SET
                     description = EXCLUDED.description,
                     voice       = EXCLUDED.voice,
                     name        = EXCLUDED.name,
                     updated_at  = now()""",
                (user_id, specialist_id, description, voice, name),
            )
        await conn.commit()


async def audit(actor_user_id: Optional[str], event: str, payload: Any = None) -> None:
    pool = await init_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO audit_log (actor_user_id, event, payload) VALUES (%s, %s, %s)",
                (actor_user_id, event, json.dumps(payload) if payload is not None else None),
            )
        await conn.commit()
