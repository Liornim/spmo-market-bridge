# supabase-backfill run 19 (push) — 2026-10-07T05:28:16Z

```
=== GET /
{
  "ok": true,
  "time": "2026-10-07T05:28:07.750Z",
  "today_et": "2026-10-07",
  "tracked": [
    "AAPL",
    "ABBV",
    "ABNB",
    "ABT",
    "ADBE",
    "ADI",
    "ADP",
    "ALAB",
    "AMD",
    "AMGN",
    "AMT",
    "AMZN",
    "ANET",
    "APH",
    "APP",
    "ARM",
    "ASML",
    "AVGO",
    "AXP",
    "BAC",
    "BKNG",
    "BLK",
    "BMY",
    "BRK-B",
    "BSX",
    "BX",
    "C",
    "CAT",
    "CB",
    "CME",
    "COIN",
    "COP",
    "COST",
    "CRDO",
    "CRM",
    "CRWD",
    "CSCO",
    "CVX",
    "DDOG",
    "DE",
    "DELL",
    "DIS",
    "DUK",
    "ELV",
    "ETN",
    "FISV",
    "GE",
    "GILD",
    "GOOGL",
    "GS",
    "HD",
    "HON",
    "HOOD",
    "IBM",
    "ICE",
    "INTC",
    "INTU",
    "ISRG",
    "JNJ",
    "JPM",
    "KKR",
    "KLAC",
    "KO",
    "LIN",
    "LLY",
    "LMT",
    "LOW",
    "LRCX",
    "MA",
    "MCD",
    "MDLZ",
    "MDT",
    "META",
    "MRK",
    "MRSH",
    "MRVL",
    "MS",
    "MSFT",
    "MSTR",
    "MU",
    "NEE",
    "NFLX",
    "NOW",
    "NVDA",
    "ORCL",
    "PANW",
    "PEP",
    "PG",
    "PGR",
    "PLD",
    "PLTR",
    "PM",
    "QCOM",
    "QQQ",
    "RBLX",
    "RTX",
    "SBUX",
    "SCHW",
    "SHOP",
    "SMCI",
    "SMH",
    "SNOW",
    "SO",
    "SPGI",
    "SPMO",
    "SPY",
    "SYK",
    "T",
    "TJX",
    "TMUS",
    "TQQQ",
    "TSLA",
    "VOO",
    "WFC",
    "XLC",
    "XLF",
    "XLK",
    "XLY"
  ],
  "auth": "OPEN — set the API_KEY secret",
  "last_run": {
    
=== GET /status
{
  "time": "2026-10-07T05:28:08.633Z",
  "today_et": "2026-10-07",
  "usage": {
    "day": "2026-10-07",
    "reads": 8456,
    "writes": 3,
    "queries": 20,
    "read_limit": 5000000,
    "write_limit": 100000,
    "read_pct": 0.2,
    "accounting": "lower bound — flushed periodically from memory; the account dashboard is authoritative",
    "write_pct": 0,
    "tier": "normal",
    "read_tier": "normal",
    "write_tier": "normal",
    "over_read_guard": false
  },
  "kv_usage": {
    "snapshot_puts_today": 0,
    "snapshot_cap": 400,
    "snapshot_min_gap_minutes": 15,
    "log_puts_today": 0,
    "log_cap": 400,
    "worst_case_daily": 800,
    "free_tier": 1000,
    "note": "per isolate; Cloudflare may run several, so treat as a lower bound"
  },
  "worst_stale_seconds": 36668,
  "total_bars": 243782,
  "run_usage": {
    "since": "2026-10-07T00:00:00.000Z",
    "runs": 0,
    "measured_runs": 0,
    "unmeasured_runs": 0,
    "d1_reads": 0,
    "d1_writes": 0,
    "max_reads_one_run": 0,
    "truncated": false,
    "note": "unmeasured = still running, failed before closing, or refused because the write budget was spent"
  },
  "symbols": [
    {
      "symbol": "AAPL",
      "last_fetch_at": 1791315284,
      "last_bar_unix": 1791315180,
      "last_error": null,
      "last_backfill_at": 1788300613,
      "bars": 9865,
      "days": 27,
      "revisions": 241,
      "stale_seconds": 35648,
      "data_stale": true
    },
    {
      "symbol": "ABBV",
      "last_fecurl: (23) Failure writing output to destination

=== GET /table/symbols
{
  "table": "symbols",
  "limit": 200,
  "offset": 0,
  "count": 118,
  "columns": [
    "symbol",
    "added_at",
    "last_fetch_at",
    "last_bar_unix",
    "last_error",
    "last_backfill_at"
  ],
  "rows": [
    {
      "symbol": "AAPL",
      "added_at": 1788272165,
      "last_fetch_at": 1791315284,
      "last_bar_unix": 1791315180,
      "last_error": null,
      "last_backfill_at": 1788300613
    },
    {
      "symbol": "ABBV",
      "added_at": 1790011476,
      "last_fetch_at": 1791314518,
      "last_bar_unix": 1791314400,
      "last_error": null,
      "last_backfill_at": null
    },
    {
      "symbol": "ABNB",
      "added_at": 1790011476,
      "last_fetch_at": 1791314519,
      "last_bar_unix": 1791314400,
      "last_error": null,
      "last_backfill_at": null
    },
    {
      "symbol": "ABT",
      "added_at": 1790011476,
      "last_fetch_at": 1791314519,
      "last_bar_unix": 1791314400,
      "last_error": null,
      "last_backfill_at": null
    },
    {
      "symbol": "ADBE",
      "added_at": 1790011476,
      "last_fetch_at": 1791314519,
      "last_bar_unix": 1791314400,
      "last_error": null,
      "last_backfill_at": null
    },
    {
      "symbol": "ADI",
      "added_at": 1790011477,
      "last_fetch_at": 1791314520,
      "last_bar_unix": 1791314460,
      "last_error": null,
      "last_backfill_at": null
    },
    {
      "symbol": "ADP",
      "added_at": 1790011478,
      "last_fetch_at": 1791314520,
      "last_bar_unix":curl: (23) Failure writing output to destination

=== GET /usage
{
  "day": "2026-10-07",
  "reads": 8578,
  "writes": 6,
  "queries": 26,
  "read_limit": 5000000,
  "write_limit": 100000,
  "read_pct": 0.2,
  "accounting": "lower bound — flushed periodically from memory; the account dashboard is authoritative",
  "write_pct": 0,
  "tier": "normal",
  "read_tier": "normal",
  "write_tier": "normal",
  "over_read_guard": false,
  "by_route": [
    {
      "route": "/status",
      "hits": 3,
      "reads": 8455,
      "writes": 0,
      "reads_per_hit": 2818,
      "pct_of_daily": 0.2
    },
    {
      "route": "/",
      "hits": 3,
      "reads": 362,
      "writes": 0,
      "reads_per_hit": 121,
      "pct_of_daily": 0
    },
    {
      "route": "/table/:sym",
      "hits": 1,
      "reads": 120,
      "writes": 0,
      "reads_per_hit": 120,
      "pct_of_daily": 0
    },
    {
      "route": "/robots.txt",
      "hits": 1,
      "reads": 70,
      "writes": 4,
      "reads_per_hit": 70,
      "pct_of_daily": 0
    }
  ],
  "note": "reads_per_hit is the number to watch — anything in the thousands is scanning"
}
[HTTP 200]

##### tools/scanner/diag_percentile.mjs
T P= 24.425 sessions 27 below: 3
2026-08-28 26 n=390
2026-08-31 25.89 n=390
2026-09-01 26.015 n=390
2026-09-02 25.96 n=390
2026-09-03 26.18 n=390
2026-09-04 25.665 n=390
2026-09-08 25.61 n=390
2026-09-09 25.16 n=390
2026-09-10 25.56 n=390
2026-09-11 26.05 n=390
2026-09-14 26.525 n=390
2026-09-15 26.725 n=390
2026-09-16 25.88 n=390
2026-09-17 25.38 n=390
2026-09-18 25.415 n=390
2026-09-21 25.475 n=390
2026-09-22 25.12 n=390
2026-09-23 25.32 n=390
2026-09-24 25.465 n=390
2026-09-25 25.4 n=390
2026-09-28 24.92 n=390
2026-09-29 24.5 n=390
2026-09-30 24.44 n=390
2026-10-01 24.32 n=390 <
2026-10-02 24.315 n=390 <
2026-10-05 24.24 n=390 <
2026-10-06 24.425 n=390
WFC P= 81.515 sessions 27 below: 6
2026-08-28 86.69 n=390
2026-08-31 86.42 n=390
2026-09-01 87.05 n=390
2026-09-02 89.27 n=390
2026-09-03 89.19 n=390
2026-09-04 89.97 n=390
2026-09-08 87.97 n=390
2026-09-09 89.685 n=390
2026-09-10 89.45 n=390
2026-09-11 90.265 n=390
2026-09-14 88.7 n=390
2026-09-15 89.72 n=390
2026-09-16 87.05 n=390
2026-09-17 86.89 n=390
2026-09-18 86.1 n=390
2026-09-21 86.545 n=390
2026-09-22 83.155 n=390
2026-09-23 81.945 n=390
2026-09-24 82.19 n=390
2026-09-25 82.97 n=390
2026-09-28 80.815 n=390 <
2026-09-29 80.5 n=390 <
2026-09-30 80.11 n=390 <
2026-10-01 80.275 n=390 <
2026-10-02 80.45 n=390 <
2026-10-05 81.435 n=390 <
2026-10-06 81.515 n=390
```
