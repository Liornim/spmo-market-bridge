# TRADER DATA FLOW

Trader V2 (v192 engine, `trader-v2-engine.cjs` 496bd9b5a8a4936f, frozen) runs
in the browser. The Worker never runs the engine. Two pages feed it.

## trader-v2-radar.html (the board)
| Step | Function | Detail (CODE-DERIVED) |
|---|---|---|
| fetch | `loadBoard` → `/board?since=…` | overlap 15 min, whole day every 10th pass (v248); per-symbol `/day` on open |
| store | `absorb` | rows keyed `date+unix` into `store[sym].rows`; a re-read minute replaces the held row |
| freshness | `st.fresh` | FRESH / STALE / SESSION ENDED from the newest row's age (STALE_AFTER) |
| gap check | `v2FindGap(closed)` | every label between first and last row must exist; **returns "no gap" if the last row is after 15:59**; keys by `time`, so duplicates are invisible |
| input | `v2ViewModel` | `closed = sessionEnded ? rows : rows.slice(0,-1)` |
| engine | `runV2(closed, …)` | decision on the last element of `closed` |

## trader-v2-live.html (one symbol)
`tick()` every 15 s → `/day/SYM/today?format=json` → sort by unix →
`closed = open ? all.slice(0,-1) : all` → `stepEngine()` once per new last
bar. Market context: `/board?symbols=SYM` for production's own verdict.

## Findings
**T-1 (P1, CODE-DERIVED) — both Traders decide one closed candle late.**
Both pages drop the newest row as "the still-forming minute". The Worker
never stores or serves a forming minute: `fetchYahoo` drops every timestamp
whose minute has not ended, and the harness asserts it ("forming bar never
stored"). So at 15:39:30 the store holds 15:38 and the Trader decides on
15:37. With ingestion lag (cron once a minute + provider delay) the decision
runs 2–4 minutes behind the market (INFERRED). This is page plumbing, not the
engine, but it changes decision timing and parity with replay, so it is **not
changed during the audit**; it is recorded for an explicit decision.

**T-2 (P1, LOCALLY VERIFIED + MEASURED) — invalid rows reach the engine.**
Duplicate minute rows and the 16:00 row are served by every path; the radar
keys by unix and keeps both, so the engine can see two candles for one
minute and a flat volume-0 16:00 candle. Fixed at ingestion and read
(F-DATA-1), which changes no engine code.

**T-3 (P1, CODE-DERIVED) — the gap check can be switched off by data.**
A 16:00 row makes `v2FindGap` return null. Fixed with F-DATA-1 (no 16:00
rows) and by clamping the check to 15:59 (F-DATA-2).

## Diagnostics (Phase 10)
Every V2 card exposes, without changing the engine:
DATA_AS_OF (newest row's minute), LATEST_BAR (newest row given to the engine),
BAR_AGE (seconds since LATEST_BAR closed), SOURCE (board / day / snapshot),
CANDLE_COUNT, GAP_COUNT, DUPLICATE_COUNT, DAY_COMPLETE (validator verdict),
DROPPED_NEWEST (T-1 made visible). See CHANGELOG_AUDIT.md F-TRD-1.
