# supabase-backfill run 16 (push) — 2026-10-06T23:20:35Z

```
=== GET /
{
  "error": true,
  "where": "worker.fetch",
  "path": "/",
  "message": "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
  "stack": [
    "Error: D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
    "    at D1DatabaseSessionAlwaysPrimary._sendOrThrow (cloudflare-internal:d1-api:188:19)",
    "    at async cloudflare-internal:d1-api:497:19",
    "    at async Object.all (worker.js:32066:59)",
    "    at async trackedSymbols (worker.js:31797:23)",
    "    at async handle (worker.js:33388:20)"
  ],
  "time": "2026-10-06T23:19:29.763Z"
}
[HTTP 500]

=== GET /status
{
  "error": true,
  "where": "worker.fetch",
  "path": "/status",
  "message": "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
  "stack": [
    "Error: D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
    "    at D1DatabaseSessionAlwaysPrimary._sendOrThrow (cloudflare-internal:d1-api:188:19)",
    "    at async cloudflare-internal:d1-api:497:19",
    "    at async Object.first (worker.js:32068:21)",
    "    at async migrate (worker.js:31639:18)",
    "    at async ensureSchema (worker.js:31608:3)"
  ],
  "time": "2026-10-06T23:19:31.118Z"
}
[HTTP 500]

=== GET /table/symbols
{
  "error": true,
  "where": "worker.fetch",
  "path": "/table/symbols",
  "message": "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
  "stack": [
    "Error: D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
    "    at D1DatabaseSessionAlwaysPrimary._sendOrThrow (cloudflare-internal:d1-api:188:19)",
    "    at async cloudflare-internal:d1-api:497:19",
    "    at async Object.first (worker.js:32068:21)",
    "    at async migrate (worker.js:31639:18)",
    "    at async ensureSchema (worker.js:31608:3)"
  ],
  "time": "2026-10-06T23:19:32.492Z"
}
[HTTP 500]

=== GET /usage
{
  "error": true,
  "where": "worker.fetch",
  "path": "/usage",
  "message": "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
  "stack": [
    "Error: D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
    "    at D1DatabaseSessionAlwaysPrimary._sendOrThrow (cloudflare-internal:d1-api:188:19)",
    "    at async cloudflare-internal:d1-api:497:19",
    "    at async Object.first (worker.js:32068:21)",
    "    at async migrate (worker.js:31639:18)",
    "    at async ensureSchema (worker.js:31608:3)"
  ],
  "time": "2026-10-06T23:19:33.795Z"
}
[HTTP 500]

11 symbols, last 30 days in 5 windows, writing to https://ebhy….supabase.co
[1/11] TXN 8190 bars  09-08:390 09-09:390 09-10:390 09-11:390 09-14:390 09-15:390 09-16:390 09-17:390 09-18:390 09-21:390 09-22:390 09-23:390 09-24:390 09-25:390 09-28:390 09-29:390 09-30:390 10-01:390 10-02:390 10-05:390 10-06:390
[2/11] UNP 8190 bars  09-08:390 09-09:390 09-10:390 09-11:390 09-14:390 09-15:390 09-16:390 09-17:390 09-18:390 09-21:390 09-22:390 09-23:390 09-24:390 09-25:390 09-28:390 09-29:390 09-30:390 10-01:390 10-02:390 10-05:390 10-06:390
[3/11] VRTX 8190 bars  09-08:390 09-09:390 09-10:390 09-11:390 09-14:390 09-15:390 09-16:390 09-17:390 09-18:390 09-21:390 09-22:390 09-23:390 09-24:390 09-25:390 09-28:390 09-29:390 09-30:390 10-01:390 10-02:390 10-05:390 10-06:390
[4/11] VZ 8190 bars  09-08:390 09-09:390 09-10:390 09-11:390 09-14:390 09-15:390 09-16:390 09-17:390 09-18:390 09-21:390 09-22:390 09-23:390 09-24:390 09-25:390 09-28:390 09-29:390 09-30:390 10-01:390 10-02:390 10-05:390 10-06:390
[5/11] TSM 8190 bars  09-08:390 09-09:390 09-10:390 09-11:390 09-14:390 09-15:390 09-16:390 09-17:390 09-18:390 09-21:390 09-22:390 09-23:390 09-24:390 09-25:390 09-28:390 09-29:390 09-30:390 10-01:390 10-02:390 10-05:390 10-06:390
[6/11] UBER 8190 bars  09-08:390 09-09:390 09-10:390 09-11:390 09-14:390 09-15:390 09-16:390 09-17:390 09-18:390 09-21:390 09-22:390 09-23:390 09-24:390 09-25:390 09-28:390 09-29:390 09-30:390 10-01:390 10-02:390 10-05:390 10-06:390
[7/11] UNH 8190 bars  09-08:390 09-09:390 09-10:390 09-11:390 09-14:390 09-15:390 09-16:390 09-17:390 09-18:390 09-21:390 09-22:390 09-23:390 09-24:390 09-25:390 09-28:390 09-29:390 09-30:390 10-01:390 10-02:390 10-05:390 10-06:390
[8/11] V 8190 bars  09-08:390 09-09:390 09-10:390 09-11:390 09-14:390 09-15:390 09-16:390 09-17:390 09-18:390 09-21:390 09-22:390 09-23:390 09-24:390 09-25:390 09-28:390 09-29:390 09-30:390 10-01:390 10-02:390 10-05:390 10-06:390
[9/11] WM 8190 bars  09-08:390 09-09:390 09-10:390 09-11:390 09-14:390 09-15:390 09-16:390 09-17:390 09-18:390 09-21:390 09-22:390 09-23:390 09-24:390 09-25:390 09-28:390 09-29:390 09-30:390 10-01:390 10-02:390 10-05:390 10-06:390
[10/11] WMT 8190 bars  09-08:390 09-09:390 09-10:390 09-11:390 09-14:390 09-15:390 09-16:390 09-17:390 09-18:390 09-21:390 09-22:390 09-23:390 09-24:390 09-25:390 09-28:390 09-29:390 09-30:390 10-01:390 10-02:390 10-05:390 10-06:390
[11/11] XOM 8190 bars  09-08:390 09-09:390 09-10:390 09-11:390 09-14:390 09-15:390 09-16:390 09-17:390 09-18:390 09-21:390 09-22:390 09-23:390 09-24:390 09-25:390 09-28:390 09-29:390 09-30:390 10-01:390 10-02:390 10-05:390 10-06:390

## Supabase backfill from Yahoo (30 days, 1m) -> archive
symbols: 11, fetched OK: 11, failed: 0
bars fetched: 90090, sent (new rows inserted, existing left alone): 90090

| date | symbols | bars from Yahoo | symbols with full 390 | rows in Supabase after |
|---|---|---|---|---|
| 2026-09-08 | 11 | 4290 | 11 | (per symbol below) |
| 2026-09-09 | 11 | 4290 | 11 | (per symbol below) |
| 2026-09-10 | 11 | 4290 | 11 | (per symbol below) |
| 2026-09-11 | 11 | 4290 | 11 | (per symbol below) |
| 2026-09-14 | 11 | 4290 | 11 | (per symbol below) |
| 2026-09-15 | 11 | 4290 | 11 | (per symbol below) |
| 2026-09-16 | 11 | 4290 | 11 | (per symbol below) |
| 2026-09-17 | 11 | 4290 | 11 | (per symbol below) |
| 2026-09-18 | 11 | 4290 | 11 | (per symbol below) |
| 2026-09-21 | 11 | 4290 | 11 | (per symbol below) |
| 2026-09-22 | 11 | 4290 | 11 | (per symbol below) |
| 2026-09-23 | 11 | 4290 | 11 | (per symbol below) |
| 2026-09-24 | 11 | 4290 | 11 | (per symbol below) |
| 2026-09-25 | 11 | 4290 | 11 | (per symbol below) |
| 2026-09-28 | 11 | 4290 | 11 | (per symbol below) |
| 2026-09-29 | 11 | 4290 | 11 | (per symbol below) |
| 2026-09-30 | 11 | 4290 | 11 | (per symbol below) |
| 2026-10-01 | 11 | 4290 | 11 | (per symbol below) |
| 2026-10-02 | 11 | 4290 | 11 | (per symbol below) |
| 2026-10-05 | 11 | 4290 | 11 | (per symbol below) |
| 2026-10-06 | 11 | 4290 | 11 | (per symbol below) |

| symbol | archive bars after | first | last |
|---|---|---|---|
| TXN | 10537 | 2026-08-28 | 2026-10-06 |
| UNP | 10530 | 2026-08-28 | 2026-10-06 |
| VRTX | 10508 | 2026-08-28 | 2026-10-06 |
| VZ | 10538 | 2026-08-28 | 2026-10-06 |
| TSM | 10149 | 2026-08-31 | 2026-10-06 |
| UBER | 10149 | 2026-08-31 | 2026-10-06 |
| UNH | 10539 | 2026-08-28 | 2026-10-06 |
| V | 10539 | 2026-08-28 | 2026-10-06 |
| WM | 10534 | 2026-08-28 | 2026-10-06 |
| WMT | 10539 | 2026-08-28 | 2026-10-06 |
| XOM | 10539 | 2026-08-28 | 2026-10-06 |
```
