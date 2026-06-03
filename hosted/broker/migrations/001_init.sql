-- Phase 2 schema for the gstack broker.
-- Migrations are applied in lexical order by broker/db.py on startup.

CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,              -- Clerk user id (user_xxx)
    email           TEXT,
    display_name    TEXT,
    role            TEXT NOT NULL DEFAULT 'member',-- 'admin' | 'member'
    plan            TEXT NOT NULL DEFAULT 'free',  -- 'free' | 'pro' | 'org'
    quota_minutes   INTEGER NOT NULL DEFAULT 60,
    minutes_used    INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS worker_keys (
    key_hash        TEXT PRIMARY KEY,              -- sha256(gw_xxx)
    owner_user_id   TEXT REFERENCES users(id) ON DELETE CASCADE,
    label           TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ,
    revoked         BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS worker_keys_owner_idx ON worker_keys(owner_user_id);

CREATE TABLE IF NOT EXISTS assignments (
    id              TEXT PRIMARY KEY,              -- a-<ts>-<rand>
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    worker_id       TEXT,                          -- in-memory worker id (transient)
    worker_key_hash TEXT REFERENCES worker_keys(key_hash) ON DELETE SET NULL,
    meet_url        TEXT NOT NULL,
    specialists     JSONB NOT NULL,
    brief           TEXT,
    mode            TEXT NOT NULL DEFAULT 'avatar',
    status          TEXT NOT NULL DEFAULT 'pending',-- pending|started|ended|failed|cancelled
    detail          JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    billable_seconds INTEGER
);

CREATE INDEX IF NOT EXISTS assignments_user_idx ON assignments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assignments_status_idx ON assignments(status);

CREATE TABLE IF NOT EXISTS specialist_overrides (
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    specialist_id   TEXT NOT NULL,
    description     TEXT,
    voice           TEXT,
    name            TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, specialist_id)
);

-- Audit log of every state transition the broker drives.
CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGSERIAL PRIMARY KEY,
    ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_user_id   TEXT,
    event           TEXT NOT NULL,                 -- worker.connected | dispatch | recall | admin.mint | ...
    payload         JSONB
);
CREATE INDEX IF NOT EXISTS audit_log_ts_idx ON audit_log(ts DESC);
