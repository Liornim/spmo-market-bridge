# supabase-backfill run 20 (push) — 2026-10-07T06:47:37Z

```
=== GET /
{
  "ok": true,
  "time": "2026-10-07T06:43:41.133Z",
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
  "time": "2026-10-07T06:43:42.182Z",
  "today_et": "2026-10-07",
  "usage": {
    "day": "2026-10-07",
    "reads": 19736,
    "writes": 7,
    "queries": 48,
    "read_limit": 5000000,
    "write_limit": 100000,
    "read_pct": 0.4,
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
  "worst_stale_seconds": 41201,
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
      "stale_seconds": 40181,
      "data_stale": true
    },
    {
      "symbol": "ABBV",
      "last_fcurl: (23) Failure writing output to destination

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
  "reads": 19739,
  "writes": 8,
  "queries": 51,
  "read_limit": 5000000,
  "write_limit": 100000,
  "read_pct": 0.4,
  "accounting": "lower bound — flushed periodically from memory; the account dashboard is authoritative",
  "write_pct": 0,
  "tier": "normal",
  "read_tier": "normal",
  "write_tier": "normal",
  "over_read_guard": false,
  "by_route": [
    {
      "route": "/status",
      "hits": 7,
      "reads": 19731,
      "writes": 0,
      "reads_per_hit": 2819,
      "pct_of_daily": 0.4
    },
    {
      "route": "/",
      "hits": 7,
      "reads": 846,
      "writes": 0,
      "reads_per_hit": 121,
      "pct_of_daily": 0
    },
    {
      "route": "/table/:sym",
      "hits": 2,
      "reads": 240,
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

##### tools/load_test_raw.mjs
symbols 129, ok 129, failed 0, rows 1056510, requests 1161, retries 0, 234s
rows per symbol: min 8190 max 8190
LOAD_TEST: PASS
```
