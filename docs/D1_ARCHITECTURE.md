# D1 ARCHITECTURE

## What exists (CODE-DERIVED, wrangler.toml + worker.js SCHEMA)
One database, binding `DB` → `bars-vault` (`a70c0956-…`). Nine tables:

| Table | Key | Holds | Size class |
|---|---|---|---|
| `bars` | PK (symbol, unix); index (symbol, date, unix) | one row per stored 1-minute candle | large: symbols × sessions × ≤390 |
| `days` | PK (symbol, date) | per symbol-day summary: bars, revisions, first, last | symbols × sessions |
| `daily_bars` | (symbol, date) | daily OHLC for the scanner | small |
| `symbols` | symbol | tracked list + last_fetch_at, last_bar_unix, last_error, last_backfill_at | ~T |
| `universe_extra` | symbol | user-added universe symbols | tiny |
| `meta` | key | schema_version, cursors, self_drive_at | tiny |
| `usage` | day | the Worker's own daily read/write tally | tiny |
| `usage_route` | (day, route) | per-route tally | tiny |
| `runs` | id | one row per sync run | grows; pruned |

Retention: `d1Prune` deletes `bars` by date beyond the keep window
(`DELETE FROM bars WHERE date = ?`, line 1142) — CODE-DERIVED.

## Budget meter (how the Worker sees its own cost)
`metered(db)` wraps the binding; `count()` adds each result's
`meta.rows_read / rows_written` to an **in-memory, per-isolate** tally,
flushed to `usage` at most once a minute (`flushUsage`). Tiers
normal <55% ≤ warn <75% ≤ frugal <90% ≤ frozen, graded separately for reads
and writes (`tierFor`, `grade`). CODE-DERIVED.

Consequences (INFERRED from the code):
- the Worker's figure is a **lower bound** of the account total: each isolate
  counts only itself, an evicted isolate loses its unflushed tally, and
  route tallies ignore requests under 50 rows. The Worker says so itself in
  `usage.json` ("lower bound … the account dashboard is authoritative",
  MEASURED from the published file).
- So the Worker can believe it is at `warn` while Cloudflare reports 93%.

## Where 5,000,000 rows_read comes from
Model: `docs/audit/d1_cost_model.mjs` (run it; every term is commented).
Inputs are CODE-DERIVED frequencies × LOCALLY VERIFIED index ranges.
Totals are INFERRED — NOT VERIFIED IN PRODUCTION.

T = 27 tracked symbols (the published `coverage.json` of 2026-09-21 lists 27
symbols in D1 — MEASURED), one 390-minute session, Σm = 76,245.

| Source | rows / session |
|---|---|
| **cron sync of T symbols** | **2,417,025** — 85% of it is `DAYS_REFRESH` |
| one V2 radar tab, full board every minute (v225–v247) | 2,059,005 |
| one V2 radar tab, overlap read (v248) | 350,445 |
| one `/view` tab (SYM + SPY + QQQ, every 60 s, background too) | 229,905 |
| one trader-v2-live session | 306,540 |
| one production radar tab (incremental) | 21,450 |
| `/tick` heartbeat, one tab | 11,310 |

| Scenario | rows | % of 5M |
|---|---|---|
| cron + 1 V2 radar tab (v225–v247) | 4,487,340 | **90%** |
| cron + 2 V2 radar tabs (v225–v247) | 6,557,655 | 131% |
| cron + 1 V2 tab + 2 /view + 1 live | 5,253,690 | 105% |
| cron + 2 V2 tabs (v248) | 3,140,535 | 63% |

**Multiplication factor.** Two terms grow with the square of the session
(each reads everything so far, every minute): `DAYS_REFRESH` (T × Σm) and a
full board read (T × Σm per tab). Everything else is linear. The quota was
reached by one server-side quadratic term plus one quadratic term per open
V2 radar tab.

## Why `DAYS_REFRESH` costs so much
`syncSymbol` → bookkeeping batch → `DAYS_REFRESH` for every date touched
(worker.js ~1302, 1265). The statement recomputes `COUNT(*)`, `SUM(revisions)`,
`MIN(time)`, `MAX(time)` over **every bar of that symbol that day**. It runs
whenever the sync stored anything — i.e. every minute per tracked symbol
during the session. It returns one row and is billed for m rows.
Fix → AUDIT_FINDINGS F-D1-1.

## Why the V2 radar cost so much (fixed in v248)
v225 made each poll re-read the whole board to cover minutes that reach the
store late. Late minutes arrive within minutes and `absorb` adds any unseen
minute, so an overlap window covers them; v248 reads 15 minutes back, full
every tenth pass. Fix already shipped; see CHANGELOG_AUDIT.md.

## Index strategy
The single index `(symbol, date, unix)` serves every hot read, and the PK
`(symbol, unix)` serves range-by-time reads (LOCALLY VERIFIED). No new index is
needed. The cost problem is how often whole ranges are re-read, not how they
are found.
