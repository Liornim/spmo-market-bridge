# AUDIT PLAN — market-data architecture, D1, KV, Trader

Checkpoint commit: `e136e81947c411802aa4004b5d4b4fbf3b81ff0d` (VERSION 248)
Checkpoint tag: `audit-checkpoint-v248`

## Evidence labels (used in every document)
- **MEASURED** — number produced by running something and reading the output.
- **LOCALLY VERIFIED** — behaviour observed by executing repository code locally
  (Node 22 + `node:sqlite`, the same SQLite engine D1 runs on).
- **CODE-DERIVED** — read from source; not executed.
- **INFERRED** — a conclusion from several facts, not directly observed.
- **NOT VERIFIED IN PRODUCTION** — could only be established against the live
  account. The sandbox shell is denied `workers.dev` and `api.cloudflare.com`
  (`x-deny-reason: host_not_allowed`, MEASURED); only GitHub is reachable.

## What is READ-ONLY and what may change code
- Phases 0–12: read-only analysis, local execution, documentation, and NEW
  test files. No change to worker.js, pages, or engines.
- Phase 13 (fixes): small commits, each with BEFORE / CHANGE / TEST / AFTER /
  ROLLBACK. Never touches `trader-v2-engine.cjs` or `trader-v2-replay.cjs`
  (hashes pinned: 496bd9b5a8a4936f / 69468cc604a44a41). Never deletes data.
  Never runs a production migration.
- A P0 (corruption / wrong trading input) found early is documented at once;
  it is fixed in Phase 13 like everything else unless it is actively
  destroying data.

## Steps
| # | Inspect | Files | Commands | Question answered | Output |
|---|---|---|---|---|---|
| 0 | git state, deploy config, bindings, crons, secret NAMES | wrangler.toml, DEPLOY.md, worker.js env usage | `git`, `grep env\.` | what is deployed, with what | AUDIT_LOG, ARCHITECTURE §0 |
| 1 | every route, function, table, index, KV op, page fetch | worker.js, *.html, *.cjs | route/SQL/KV/fetch extraction scripts | what exists and who calls what | ARCHITECTURE.md |
| 2 | one candle from Yahoo to every consumer | fetchYahoo, syncSymbol, UPSERT, readDay, /board, /bars/*, pages, Trader | code trace + local run | exact transitions | DATA_FLOW.md, TRADER_DATA_FLOW.md |
| 3 | identity, timezone, minute semantics, precision, zero volume | localDateTime, UPSERT, schema | local run of fetchYahoo on fixture payload | one canonical candle | CANDLE_DATA_CONTRACT.md |
| 4 | same minute through every read path | all read routes + export + import + Trader loaders | new consistency harness | do paths disagree, why | CONSISTENCY_REPORT.md, new test |
| 5 | day completeness | validators in t3/, coverage code | new validator | COMPLETE/PARTIAL/... | CONSISTENCY_REPORT.md §completeness |
| 6 | live vs stored lifecycle | cron, self-drive, /day top-up, pages | code trace | who polls, when stored | DATA_FLOW.md §live |
| 7 | every D1 statement | worker.js | SQL extraction + EXPLAIN QUERY PLAN on real schema | where 5M rows_read comes from | D1_QUERY_INVENTORY.md, D1_ARCHITECTURE.md |
| 8 | every KV op | worker.js | extraction + rate derivation | why KV limit was hit | KV_ARCHITECTURE.md |
| 9 | every browser fetch/timer | *.html | extraction | traffic × tabs → cost | API_DATA_MATRIX.md |
| 10 | Trader input | trader-v2-radar.html v2ViewModel, trader-v2-live.html | code trace | stale/incomplete handling | TRADER_DATA_FLOW.md |
| 11 | logging/counters | logEvent, usageToday, /status | code trace | cheap observability | RUNBOOK.md §observability |
| 12 | root causes | all of the above | — | why screens disagree, why quotas blew | AUDIT_FINDINGS.md, KNOWN_ISSUES.md |
| 13 | fixes | smallest set | full suite + build before every push | — | CHANGELOG_AUDIT.md, QA_MATRIX.md |

## Rollback
- Whole tree: `git checkout audit-checkpoint-v248`
- One file: `git checkout audit-checkpoint-v248 -- <file>`
- Every fix is its own commit: `git revert <sha>`
- Data: nothing is deleted; no migration is run.

## Working rules
- Every push is preceded by `node build-view.mjs` and all seven suites green.
- Source-text assertions are scoped to the function they describe.
- Documentation is committed after every phase, so a context reset loses nothing.
