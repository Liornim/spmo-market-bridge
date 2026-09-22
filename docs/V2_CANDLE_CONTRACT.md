# V2 CANDLE CONTRACT

One representation, one key, one set of rules.

## Schema (`bars_v2`)

| column | meaning |
|---|---|
| `symbol` | upper-case ticker |
| `unix` | UTC seconds of the minute **start**; `unix % 60 == 0` |
| `date` | `YYYY-MM-DD` in America/New_York |
| `time` | `HH:MM` in America/New_York, the minute's start label |
| `open/high/low/close` | provider values rounded to 4 decimals |
| `volume` | integer ≥ 0; `0` means no trade in that minute |
| `source` | `yahoo:1m`, `yahoo:5d`, `import:csv`, `copy:d1`, `copy:archive` — provenance is stored, never assumed |
| `synthetic` | `1` when the provider gave no prices and the candle was carried forward from the previous close |
| `first_seen` / `updated_at` / `revisions` | ingestion metadata, not part of candle equality |

**Primary key: `(symbol, unix)` with `unix % 60 == 0`**, which is equivalent to
`(symbol, ET date, ET minute label)`.

## Rules

1. A candle exists only for a regular-session minute: ET `09:30 … 15:59`
   (390 per day). Anything else — a mid-minute provider timestamp, the 16:00
   closing stamp — is **not a candle** and is rejected at ingestion.
2. The forming minute is never stored.
3. Candle equality is `(open, high, low, close, volume)`. Metadata differences
   are not changes.
4. A no-trade minute is a flat candle at the previous close with volume 0 **and
   `synthetic = 1`**. The legacy store could not distinguish those from real
   zero-volume minutes; V2 can.
5. Validation at write time: all five values finite,
   `low <= min(open, close) <= max(open, close) <= high`, `volume >= 0`.
   A row failing this is rejected and counted, never silently stored.
6. Writes are idempotent: identical values are counted as `unchanged` and not
   written; different values bump `revisions` and set `updated_at`.

## Why these rules, and where they come from

They are the rules the audit proved correct for the legacy feed (minute
alignment, session bounds, forming-minute exclusion, 4-decimal rounding),
carried over deliberately. What changed is that V2 **enforces them at
ingestion** and records provenance, instead of hiding non-conforming rows behind
read-time filters.
