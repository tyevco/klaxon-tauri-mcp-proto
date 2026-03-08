-- Token source tracking (for Cost Allocation widget)
CREATE TABLE IF NOT EXISTS token_source_entries (
    date          TEXT NOT NULL,
    model         TEXT NOT NULL,
    source        TEXT NOT NULL DEFAULT 'unknown',
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd      REAL    NOT NULL DEFAULT 0.0,
    PRIMARY KEY (date, model, source)
);

-- Scratchpad entries (user ↔ agent shared notepad)
CREATE TABLE IF NOT EXISTS scratchpad_entries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    content    TEXT NOT NULL,
    author     TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
);

-- Checkpoint tracker (multi-step agent task progress)
CREATE TABLE IF NOT EXISTS checkpoints (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    label        TEXT NOT NULL,
    detail       TEXT,
    progress_pct INTEGER,
    session_tag  TEXT,
    created_at   TEXT NOT NULL
);

-- Alert rules (user-defined threshold rules)
CREATE TABLE IF NOT EXISTS alert_rules (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT NOT NULL,
    threshold     REAL NOT NULL,
    level         TEXT NOT NULL DEFAULT 'warning',
    message       TEXT NOT NULL,
    enabled       INTEGER NOT NULL DEFAULT 1,
    last_fired_at TEXT
);

-- Work queue (agent-managed task backlog)
CREATE TABLE IF NOT EXISTS work_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    detail     TEXT,
    status     TEXT NOT NULL DEFAULT 'pending',
    priority   INTEGER NOT NULL DEFAULT 0,
    agent_id   TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
