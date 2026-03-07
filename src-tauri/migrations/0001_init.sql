CREATE TABLE IF NOT EXISTS klaxon_items (
    id          TEXT PRIMARY KEY,
    level       TEXT NOT NULL DEFAULT 'info',
    title       TEXT NOT NULL,
    message     TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    ttl_ms      INTEGER,
    status      TEXT NOT NULL DEFAULT 'open',
    form        TEXT,
    actions     TEXT,
    response    TEXT,
    answered_at TEXT
);

CREATE TABLE IF NOT EXISTS timer_entries (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id  TEXT NOT NULL,
    start     TEXT NOT NULL,
    end       TEXT NOT NULL,
    seconds   INTEGER NOT NULL,
    note      TEXT,
    date      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timer_active (
    issue_id  TEXT PRIMARY KEY,
    start     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS token_entries (
    date          TEXT NOT NULL,
    model         TEXT NOT NULL,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd      REAL    NOT NULL DEFAULT 0.0,
    PRIMARY KEY (date, model)
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
