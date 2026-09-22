# QUANTITATIVE FACTS — CURRENT STATE

Evidence labels: **MEASURED** = real production state, taken from the published
`data` branch (`data/state/*.json`, generated 2026-09-21T08:36:28Z by the Worker
itself, build v234) or from the published CSVs and the GitHub API.
**CODE-DERIVED** = computed from the source. **UNKNOWN** = not provable with the
access I have. No target architecture here.

Access limit that shapes everything below: the sandbox cannot reach
`workers.dev` or `api.cloudflare.com` (HTTP 403 `host_not_allowed`), so I cannot
query D1 or Supabase directly. The published state files are the Worker's own
report of D1, and they are **~3 days stale** relative to the last session in them.

---

## 1. D1 in reality (MEASURED, as of 2026-09-21T08:36Z)

Whole store: **123,854 rows · 17 sessions · 2026-08-26 → 2026-09-18 · 16.4 MB ·
27 symbols**. `D1_KEEP_DAYS = 60` is a ceiling that has never been reached: the
oldest data is 17 trading days old because collection started then.

| SYM | days | bars | revisions | first | last |
|---|---|---|---|---|---|
| AAPL | 16 | 6,236 | 219 | 2026-08-26 | 2026-09-18 |
| AMD | 9 | 2,803 | 71 | 2026-09-08 | 2026-09-18 |
| AMZN | 16 | 5,758 | 79 | 2026-08-26 | 2026-09-18 |
| ANET | 9 | 2,785 | 1,666 | 2026-09-08 | 2026-09-18 |
| AVGO | 16 | 5,511 | 20 | 2026-08-26 | 2026-09-18 |
| BRK-B | 16 | 5,511 | 2,377 | 2026-08-26 | 2026-09-18 |
| C | 10 | 3,171 | 2,053 | 2026-09-04 | 2026-09-18 |
| GOOGL | 16 | 5,510 | 35 | 2026-08-26 | 2026-09-18 |
| INTC | 9 | 2,776 | 3 | 2026-09-08 | 2026-09-18 |
| JPM | 16 | 5,509 | 2,375 | 2026-08-26 | 2026-09-18 |
| META | 16 | 5,509 | 19 | 2026-08-26 | 2026-09-18 |
| MSFT | 16 | 5,509 | 48 | 2026-08-26 | 2026-09-18 |
| NVDA | 16 | 5,509 | 7 | 2026-08-26 | 2026-09-18 |
| PLTR | 10 | 3,165 | 13 | 2026-09-04 | 2026-09-18 |
| QCOM | 8 | 2,412 | 23 | 2026-09-09 | 2026-09-18 |
| QQQ | 16 | 5,502 | 17 | 2026-08-26 | 2026-09-18 |
| SMH | 16 | 5,502 | 59 | 2026-08-26 | 2026-09-18 |
| SPMO | 16 | 5,060 | 2,104 | 2026-08-26 | 2026-09-18 |
| SPY | 16 | 4,966 | 2,688 | 2026-08-26 | 2026-09-18 |
| TQQQ | 15 | 4,963 | 29 | 2026-08-26 | 2026-09-17 |
| TSLA | 15 | 4,692 | 11 | 2026-08-26 | 2026-09-17 |
| VOO | 15 | 4,691 | 1,865 | 2026-08-26 | 2026-09-17 |
| WFC | 10 | 2,738 | 1,383 | 2026-09-03 | 2026-09-17 |
| XLC | 15 | 4,675 | 1,719 | 2026-08-26 | 2026-09-17 |
| XLF | 15 | 4,657 | 1,514 | 2026-08-26 | 2026-09-17 |
| XLK | 13 | 4,368 | 1,518 | 2026-08-26 | 2026-09-17 |
| XLY | 13 | 4,366 | 1,485 | 2026-08-26 | 2026-09-17 |

**Day completeness across the 374 symbol-days:**
| bars | symbol-days |
|---|---|
| exactly 390 (complete) | 103 (28%) |
| **more than 390** (duplicate minutes and/or 16:00 rows) | **65** (17%), up to 406 |
| fewer than 390 (missing minutes) | 206 (55%) |

**Missing minutes by date** — average per symbol vs the expected 390:
| date | symbols | min bars | max bars | avg missing |
|---|---|---|---|---|
| 2026-08-26 … 09-04 | 20–23 | 383 | 395 | ≈0 (and some days over 390) |
| 2026-09-08 | 26 | 349 | 390 | 26 |
| 2026-09-09 | 27 | 348 | 390 | 30 |
| 2026-09-10 | 27 | 348 | 389 | 31 |
| 2026-09-11 | 27 | 390 | 406 | over, not missing |
| **2026-09-14** | 27 | **144** | 391 | **228** |
| 2026-09-15 | 25 | 107 | 387 | 88 |
| 2026-09-16 | 25 | 202 | 390 | 177 |
| **2026-09-17** | 27 | **34** | 388 | **227** |
| 2026-09-18 | 19 | **2** | 389 | 43 |

That block of damage lines up with the quota exhaustion that triggered this
audit. **Not provable from these files:** which minutes exactly are missing per
day, and whether they were later repaired — the state files publish counts, not
minute lists.

**What each item can and cannot be proven with:**
| Item | Evidence available |
|---|---|
| earliest / latest date, unique days, total rows, revisions | MEASURED, `data/state/days.json` + `storage.json` |
| missing minutes per day | count only (390 − bars); the minute list needs `/day/SYM/DATE` per day, i.e. Worker access |
| duplicate / canonical-rejected rows | counts >390 prove they exist; the exact rows need `/table/bars` or `/export` per day |
| latest candle timestamp (to the minute) | not in the state files; needs `/days` or `/day` live |

## 2. Supabase in reality (MEASURED, same snapshot — with a caveat)

`coverage.json` reports **129 archive symbols, 696,464 bars**, with
`first_unix` = 2026-09-14 and `last_unix` = 2026-09-18 for every symbol that has
values, and **10 symbols with null summaries**.

**The summary columns are not trustworthy.** `first_unix` is overwritten on each
write (known defect), and the counts contradict the published data: the archive
summary says AAPL has 6,641 bars, while the published `data/bars/AAPL.csv`
contains **2,735 rows across 7 days**. So `bars` behaves like a write counter,
not a row count.

**Tracked symbols with 0 bars / null summary in the archive:** QQQ, SMH, SPMO,
SPY, TQQQ, VOO, XLC, XLF, XLK, XLY (the ETFs). For those, **D1 is the only
store**.

| Question | Answer |
|---|---|
| earliest retained date | UNKNOWN — summary columns unreliable; needs a direct Supabase query |
| latest date | 2026-09-18 per summary; consistent with D1 |
| symbols covered | 129 (MEASURED) |
| rows per symbol/day | UNKNOWN per day; published CSVs show ~390–391 per day for the days they contain |
| does the 42-day DELETE actually run | **It has never had anything to delete.** The system is ~17 trading days old, so the prune cutoff is older than all data. Whether the DELETE executes successfully is UNVERIFIED |
| days in Supabase but not in D1 | UNKNOWN. Plausible for the universe symbols (never in D1) — that is 102 of the 129 |
| days in D1 but not in Supabase | **Yes, proven:** the 10 ETFs above have no archive rows at all |

## 3. D1 ↔ Supabase disagreement report

**Cannot be produced.** It requires reading both stores row by row for the same
symbol-days. What is missing, precisely:
- Supabase: the `SUPABASE_URL` / `SUPABASE_KEY` secrets, or a Worker endpoint
  that returns raw archive rows (none exists — `/archive/check` returns counts).
- D1: reachable only through the Worker, which the sandbox cannot call.

**Indirect evidence that they do differ (MEASURED):** for 2026-09-14 to 09-18,
D1 holds heavily incomplete days (as low as 2–144 bars), while the published
CSVs built from Supabase hold ~390–391 bars for those dates. The nightly Yahoo
pass refilled the archive; D1 was never repaired. So for that week the two
stores certainly hold different row sets for the same symbol-days.

## 4. KV inventory (CODE-DERIVED; totals from `docs/audit/cost_tables.mjs`)

| Caller | Key / event | Op | Trigger | Max frequency | Ops/day (model) | browser | cron | Trader/Radar |
|---|---|---|---|---|---|---|---|---|
| `logEvent` `cron_fired` | `log:<UTC date>` | GET+PUT | every cron run | 540/day | 540 + 540 | no | yes | no |
| `logEvent` `cron_skipped_closed` | same | GET+PUT | cron outside the session | 150/day | 150 + 150 | no | yes | no |
| `logEvent` `cron_skipped` | same | GET+PUT | cron at write tier frugal | up to 390/day | 0 today | no | yes | no |
| `logEvent` `budget_warn` | same | GET+PUT | **every request** once tier = warn | per request | ~1,950 + 1,950 per active tab-day | yes | yes | yes |
| `logEvent` `board_full_read` | same | GET+PUT | full `/board` (no cursor) | per full board | ~39 + 39 per tab | yes | no | yes |
| `snapshotPut` BOARD | `snap:BOARD:<date>` | PUT | full `/board`, market open | ≤1 per 15 min per isolate | ~26 | yes | no | yes |
| `snapshotPut` symbol | `snap:<SYM>:<date>` | PUT | full `/day` of today | ≤1 per 15 min per symbol per isolate | ~702 | yes | no | yes |
| `snapshotGet` | `snap:…` | GET | read tier frozen/frugal | per request | 0 unless frozen | yes | no | yes |
| `readLog` | `log:<date>` × N | GET | `/db` page, `/selfcheck`, publish | 7 per view | 7 per view | yes | yes | no |
| archive/publish events | `log:` | GET+PUT | nightly | ~8/day | 8 + 8 | no | yes | no |
| watch/self-drive/guard events | `log:` | GET+PUT | user or guard | rare | ~5 | yes | yes | yes |

**Top KV consumers per day:** `budget_warn` (once the tier is warn it dwarfs
everything), `snapshotPut` per symbol-day (~702), `cron_fired` (540),
`cron_skipped_closed` (150), `board_full_read`, snapshot BOARD, readLog,
publish events, watch events, self-drive.

**Correction to an earlier statement of mine:** I previously said the cron alone
emits ~1,080 KV writes/day. The correct model is **690** (540 `cron_fired` +
150 `cron_skipped_closed`), i.e. 69% of the 1,000/day free limit before any
browser traffic. The measured log (330 entries over ~10 h, 163 fired + 150
closed, zero folded) is consistent with that.

## 5. D1 — top costs per session (CODE-DERIVED, `docs/audit/cost_tables.mjs`)

rows_read only; writes are excluded.

| # | path | group | calls/session | rows/call | rows/session | % of 5M |
|---|---|---|---|---|---|---|
| 1 | cron `DAYS_REFRESH` (recount of the whole symbol-day per sync) | cron | 10,530 | 196 avg | 2,058,615 | 41.2% |
| 2 | V2 radar tab, pre-v248 full read every minute | radar | 390 | 5,265 | 2,053,350 | 41.1% |
| 3 | V2 radar tab, v248 overlap + full every 10th | radar | 390 | 1,418 | 552,825 | 11.1% |
| 4 | `/bars/daily` over the whole store (two passes) | export | 1 | 358,020 | 358,020 | 7.2% |
| 5 | `trader-v2-live`, full `/day` every 15 s | trader | 1,560 | 195 | 304,200 | 6.1% |
| 6 | `/view` tab, 4 full `/day` per minute | ui | 1,560 | 195 | 304,200 | 6.1% |
| 7 | cron bars re-read for the mirror queue (15-min overlap) | cron | 10,530 | 15 | 157,950 | 3.2% |
| 8 | `/storage` full table scan | coverage | 1 | 123,854 | 123,854 | 2.5% |
| 9 | production radar tab, incremental `/board` | radar | 390 | 54 | 21,060 | 0.4% |
| 10 | `/audit` recompute (25 symbols) | coverage | 1 | 9,750 | 9,750 | 0.2% |

By group per session: **cron 2,216,565 (44.3%)**, one average tab ~300,000,
coverage/admin ~140,000 when those pages are opened, export on demand.

## 6. Cost of one browser tab (CODE-DERIVED)

| tab | refresh | requests/h | D1 rows/h | KV ops/h at tier warn | provider calls/h |
|---|---|---|---|---|---|
| `/view` | 60 s (fixed) | 240 | 46,800 | 240 get+put | 0 (self-drive only) |
| production radar | 60 s default | 300 | 4,500 | 300 | 0 |
| production radar | 3 s fastest | 6,000 | 90,000 | 6,000 | 0 |
| V2 radar | 60 s default | 300 | 86,310 | 300 | 0 |
| V2 radar | 3 s fastest | 6,000 | **1,726,200** | 6,000 | 0 |
| trader-v2-live | 15 s (fixed) | 480 | 53,280 | 480 | 0 |
| scan | 5 min (fixed) | 44 | 63,180 | 44 | 0 |

Provider calls are 0 directly: only the Worker calls Yahoo, and a tab causes
them indirectly through self-drive (`/board`, `/tick`) — up to 27 Yahoo fetches
per self-drive round, at most once per 60 s.

**Per full session, including the cron:**
| open tabs | D1 rows/session | % of 5M |
|---|---|---|
| cron alone | 2,216,565 | 44.3% |
| + 1 average tab | 2,516,231 | 50.3% |
| + 3 tabs | 3,115,564 | 62.3% |
| + 5 tabs | 3,714,896 | 74.3% |
One V2 radar tab at 3 s alone exceeds the whole daily limit (≈11.2M rows/session).

## 7. Duplicate work across consumers (CODE-DERIVED)

There is **no sharing between tabs** (no BroadcastChannel, no SharedWorker) and
no server-side cache of board rows, so every consumer reads the same rows again.

SPY in one minute, with `/view`, a production radar, a V2 radar and
`trader-v2-live` open:
| consumer | request | reads SPY today |
|---|---|---|
| `/view` | `/day/SPY/today` | full day |
| production radar | `/day/SPY?since` (market context) | delta |
| V2 radar | `/day/SPY?since` (market context) + `/board` | delta ×2 |
| trader-v2-live | `/board?symbols=SPY` | today |
| cron | `DAYS_REFRESH` | full day |
**Same underlying minute read 5–6 times per minute**, in five separate D1 queries.

The same applies to every tracked symbol on the board: each open radar reads the
whole board separately, and both radars read the identical row set.

## 8. Silent partial-data paths (CODE-DERIVED)

| # | failing source | fallback used | response says so? | UI says so? | Trader can consume it? |
|---|---|---|---|---|---|
| 1 | Supabase in `/bars/export` | D1 rows only | no | no | not a Trader path |
| 2 | Supabase in `/days` | D1 day list | no | no | no |
| 3 | Supabase in `/board` | symbol left out | partly — `not_fetched` is returned | not shown | **yes** — the symbol looks empty |
| 4 | Supabase in `/day` archive fallback | empty rows | no | "no data" | **yes** |
| 5 | `daily_bars` query in `/bars/daily` | provider rows dropped | no | no | no |
| 6 | probes in `/archive/dates` | smaller coverage basis | partly (`readable`) | no | no |
| 7 | live Yahoo in `/bars/last` | symbol missing from rows | yes (`live_failed`, `not_reached`) | yes, in the copy message | no |
| 8 | a day in the radar range copy | day skipped | n/a | count only | no |
| 9 | `localStorage` quota | cache not written | n/a | no | no |
| 10 | `snapshotPut` | no snapshot for the frozen tier | n/a | no | **yes, later** — frozen tier then has nothing to serve |
| 11 | `flushUsage` / `flushRouteMeter` | accounting lost | n/a | no | no — but the tier gate then under-counts |
| 12 | mirror to Supabase | D1-only row | no | no | no |

## 9. Freshness by source (CODE-DERIVED)

| source | how freshness is represented | who checks it | max possible age | does the consumer know? |
|---|---|---|---|---|
| D1 | `stale_seconds` in `/day`; `last_bar_unix` in `symbols` | `/day` top-up, self-drive, radar badge | unbounded when the cron stands down (MEASURED: days with 2–144 bars) | partly — the badge shows the newest row's age |
| Supabase | none — rows carry no fetch time | nobody | up to a day (nightly pass) | no |
| KV snapshot | `snapshot_saved_at` in the response; `from_snapshot: true` | `/board`, `/day` | 15 min write throttle + 3-day TTL | yes — radars show a toast |
| localStorage | `saved` timestamp is written | **nobody reads it** | unbounded | no |
| browser memory | the tab's own refresh cycle | the freshness badge, from the newest row | refresh interval (3–120 s) + ingestion lag | partly |
| Yahoo live (`/bars/last`) | `age_seconds` per symbol; `read_live` list | the copy message flags >6 min | seconds | yes |

## 10. GitHub publish failure — root cause (CODE-DERIVED + MEASURED)

**Subrequest budget per publish run.** For each symbol in the shard,
`publishShard` calls `archiveRead`, which issues one id lookup plus one request
per 1,000 rows (`ARCHIVE_PAGE = 1000`). At ~6,600 rows per symbol that is
**7–8 Supabase requests per symbol**.

| step | subrequests |
|---|---|
| nightly: Yahoo 5d × 5 symbols (`archiveNightlyShard`) | 5 |
| Supabase writes for those 5 symbols | ≥5 |
| `publishShard`: 5 symbols × (1 id + ~7 pages) | ~40 |
| `publishFiles`: tree + commit + ref patch (+2 if the base tree is unknown) | 3–5 |
| D1 queries in the same invocation (cursor, universe, meta, usage) | ~5 |
| **total** | **≈58–60, against the ~50 per-invocation limit** |

That is why the error is `Too many subrequests by single Worker invocation`, and
why it appeared only as the archive grew: with 2,000 rows per symbol the same
run needed ~25 subrequests. `/publish/shard` uses **10** symbols per call, which
is worse still (~80).

**MEASURED from GitHub:** `data/bars/AAPL.csv` has exactly **one commit ever**
(2026-09-21T08:36:30Z). The file holds **2,735 rows over 7 days, 2026-09-08 →
2026-09-16**, at 390–391 rows per day. So:
- the git history contains **no older versions** — there is no deeper archive there;
- the published file is missing 09-17 and 09-18, which the archive summary claims
  to hold. **UNKNOWN why** — resolving it needs the publish run's own response or
  the `runs`/log entry for that shard.

## 11. vol_x matrix (CODE-DERIVED, with a worked example)

| surface | function | input window | formula | reproducible? |
|---|---|---|---|---|
| radar / view card indicators | `engine.cjs analyze` → `bar.volx` | running, bars 0..i of the loaded day | `volume ÷ (Σvolume₀..ᵢ ÷ (i+1))` | yes, if the same rows are loaded |
| Trader V2 | `trader-v2-engine.cjs computeBars` → `relVol` | running, bars 0..i | identical formula, separate implementation | yes |
| radar CSV copy | `csvRows` in the page | the whole loaded day | `volume ÷ (Σvolume ÷ n)` of that day | only with the full day loaded |
| server `/day` CSV | `toCsvRows` | **the rows returned by that request** | same formula over those rows | **no** — with `since=` it is the delta only |
| analysis pack §15 | `layers.cjs analysisPack` | the printed window (last 50) | same formula over the printed rows | no |

**Worked example** — a 390-minute day, volume 3,000 at 15:38:
| surface | vol_x for that candle |
|---|---|
| engine volx / V2 relVol | **5.24** |
| radar CSV copy, server full-day CSV | **5.09** |
| analysis pack §15 (50 rows) | **4.95** |
| `/day?since` returning 3 new rows | **1.88** |

## 12. Copy Card / analysis pack — snapshot consistency (CODE-DERIVED)

`buildTickerState` stamps one `calculated_at`, which makes the card look atomic.
The parts have different as-of times:

| part | source | when it was fetched | own timestamp printed? |
|---|---|---|---|
| candles (today) | `/board` (or `/day`) | last refresh: 3–120 s ago, plus 1–3 min ingestion lag | yes — last closed candle + `stale_seconds` |
| market context (SPY/QQQ/sector) | `/day?since` per ETF | same `loadAll`, separate requests | no |
| order book | `/book` (Cboe) | the refresh **after** the card was opened | yes — `Book timestamp` |
| daily history / prior days | `/day` per date | when the card was opened, once | no |
| calibration / volume baseline | computed from those prior days | same | no |
| probability | from the calibration | same | no |

**So yes:** a single card can show price from 15:38, market context from 15:36
and a book from 15:39, with only the first and the book carrying their own time.
Since v250 the V2 Live Validation report prints DATA_AS_OF, BAR_AGE, SOURCE and
MARKET_CONTEXT_AS_OF; the production radar card and the analysis pack do not.

---

## Evidence summary

**MEASURED (production state, 2026-09-21 snapshot):** D1 holds 17 sessions,
123,854 rows, 27 symbols, 2026-08-26 → 2026-09-18 · per-symbol days/bars/revisions ·
65 symbol-days with more than 390 bars (up to 406) and 206 with fewer ·
09-14 → 09-18 damage (as low as 2 bars in a day) · 129 archive symbols with
unreliable summary columns · 10 tracked ETFs absent from the archive ·
published AAPL CSV = 7 days, 2,735 rows, one commit ever · KV log with zero
folded repeats.

**CODE-DERIVED:** all cost tables (D1 per path, per tab, KV per event),
the publish subrequest arithmetic, the silent-fallback list, the freshness
table, the vol_x matrix and its worked example, the snapshot-consistency table.

**UNKNOWN, and what is missing to prove it:**
1. Which minutes exactly are missing per symbol-day — needs `/day/SYM/DATE` per day (Worker access).
2. Row-level D1 ↔ Supabase comparison — needs Supabase credentials or a raw-archive endpoint.
3. True earliest date in Supabase — the summary columns are overwritten per write.
4. Whether the 42-day archive DELETE runs successfully — it has never had rows old enough to delete.
5. Why the published AAPL CSV stops at 09-16 while the archive claims 09-18.
6. Actual production rows_read and KV counts — the Worker's own meter is a
   per-isolate lower bound, and the Cloudflare dashboard is the authority.
