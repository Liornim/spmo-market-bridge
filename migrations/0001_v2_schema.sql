-- V2 pipeline schema. Additive only: no legacy table is referenced.
-- Apply with: wrangler d1 execute bars-vault --file=migrations/0001_v2_schema.sql

CREATE TABLE IF NOT EXISTS bars_v2 ( symbol TEXT NOT NULL, unix INTEGER NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, open REAL, high REAL, low REAL, close REAL, volume INTEGER, source TEXT NOT NULL, synthetic INTEGER NOT NULL DEFAULT 0, first_seen INTEGER NOT NULL, updated_at INTEGER NOT NULL, revisions INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (symbol, unix));

CREATE INDEX IF NOT EXISTS bars_v2_sym_date ON bars_v2 (symbol, date, unix);

CREATE TABLE IF NOT EXISTS symbols_v2 ( symbol TEXT PRIMARY KEY, tier TEXT NOT NULL DEFAULT 'standard', added_at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, last_fetch_at INTEGER, last_bar_unix INTEGER, last_error TEXT, last_ok_at INTEGER);

CREATE TABLE IF NOT EXISTS jobs_v2 ( id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, symbol TEXT NOT NULL, arg TEXT NOT NULL DEFAULT '', priority INTEGER NOT NULL DEFAULT 5, due_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, state TEXT NOT NULL DEFAULT 'ready', updated_at INTEGER NOT NULL, UNIQUE (kind, symbol, arg));

CREATE INDEX IF NOT EXISTS jobs_v2_ready ON jobs_v2 (state, due_at, priority);

CREATE TABLE IF NOT EXISTS runs_v2 ( id INTEGER PRIMARY KEY AUTOINCREMENT, started_at INTEGER NOT NULL, finished_at INTEGER, trigger TEXT, budget INTEGER, used INTEGER DEFAULT 0, jobs_done INTEGER DEFAULT 0, jobs_failed INTEGER DEFAULT 0, rows_downloaded INTEGER DEFAULT 0, candidates INTEGER DEFAULT 0, inserted INTEGER DEFAULT 0, revised INTEGER DEFAULT 0, unchanged INTEGER DEFAULT 0, status TEXT DEFAULT 'running', note TEXT);

CREATE TABLE IF NOT EXISTS meta_v2 (key TEXT PRIMARY KEY, value TEXT);
