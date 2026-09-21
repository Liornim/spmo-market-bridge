# CANDLE DATA CONTRACT

## What the system actually does today (CODE-DERIVED unless labelled)
| Property | Current behaviour | Where |
|---|---|---|
| Provider | Yahoo v8 chart, `interval=1m`, `includePrePost=false` | `fetchYahoo` |
| Timestamp | provider `timestamp[i]`, UTC seconds, stored as `unix` | `fetchYahoo`, `UPSERT` |
| Minute semantics | **minute START**: `unix` 15:38:00 ET covers 15:38:00–15:38:59 | provider convention; `localDateTime` |
| Timezone | `date`/`time` derived in `America/New_York` (`TZ`) | `localDateTime` |
| Session | regular hours only; **not enforced** — a 16:00 stamp is stored (MEASURED in archive) | — |
| Forming minute | never stored, never served | `fetchYahoo` `ts+60>now` |
| Precision | prices rounded to 4 decimals; volume integer | `rnd(x,4)` |
| Volume | provider's per-minute volume, null → 0 | `fetchYahoo` |
| No-trade minute | provider null prices → flat bar at previous close, volume 0; **no flag stored** | `fetchYahoo` |
| Storage key | `(symbol, unix)` in D1; `(symbol_id, unix)` in Supabase | schema, `archiveWrite` |
| Correction | upsert overwrites any changed value; `revisions+1`, `updated_at` | `UPSERT` |
| Precedence | last write wins; no provider precedence (single provider); no vintage check | `UPSERT` |
| Completeness | `bars >= 380` | worker.js 2003, 2645 |

## Defects against a canonical contract (evidence)
1. **Identity is the provider timestamp, not the minute.** A non-minute-aligned
   timestamp inside a minute becomes a second row for that minute.
   MEASURED in the published archive: BLK 2026-09-11 has 5 duplicated minutes,
   DE and PLD have 1–2 on several days; e.g. `14:51` real bar (vol 848) plus a
   flat vol-0 bar. LOCALLY VERIFIED: `consistency_test.mjs` reproduces it.
2. **A 16:00 row is stored** on most days (flat, volume 0) — MEASURED on
   AAPL, NVDA, BLK, DE, PLD. It is Yahoo's closing stamp, outside the
   09:30–15:59 convention.
3. **Completeness by count** (`>= 380`) accepts a day missing 10 minutes and a
   day padded by duplicates.
4. **Synthetic no-trade bars carry no marker**: MEASURED — BLK has 49–73 flat
   volume-0 minutes per day (up to 19% of the session).

## The canonical contract (adopted by this audit)
**Canonical identity: `(symbol, unix)` where `unix % 60 == 0`**, which is
equivalent to `(symbol, ET date, ET minute label)` and exactly one of the 390
labels `09:30 … 15:59` (210 on half days `09:30 … 12:59`).

| Field | Rule |
|---|---|
| symbol | upper-case ticker |
| unix | UTC seconds of the minute START, `unix % 60 == 0` |
| date / time | `America/New_York` date and `HH:MM` of `unix` |
| open/high/low/close | provider values rounded to 4 dp; `low <= min(o,c) <= max(o,c) <= high` |
| volume | integer ≥ 0. **volume 0 means no trade in that minute** (provider-reported or carried forward); consumers must not treat it as a traded bar |
| first_seen / updated_at / revisions | ingestion metadata, not part of candle equality |
| source | `yahoo` (single provider; not stored — implicit) |

Rules
- Anything that is not a regular-session minute start is **not a candle** and
  is rejected at ingestion (`fetchYahoo`, the single entry point for D1,
  Supabase and the live `/bars/last` path).
- Rows already stored that break the rule are hidden at read time by the same
  predicate; nothing is deleted (audit rule 10).
- A day is **COMPLETE** only when the 390 (or 210) expected labels are each
  present exactly once (`docs/audit/completeness.mjs`). Otherwise PARTIAL,
  STALE (today, tail lagging > 6 min), MISSING, DUPLICATE or CORRUPT.
- Candle equality across paths = equal `(time, open, high, low, close, volume)`.
