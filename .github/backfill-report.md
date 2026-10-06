# supabase-backfill run 18 (push) — 2026-10-06T23:54:48Z

```

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
  "time": "2026-10-06T23:39:34.881Z"
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
  "time": "2026-10-06T23:39:36.788Z"
}
[HTTP 500]

##### tools/archive_audit.mjs
  MU 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  MU 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  NEE 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  NEE 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  NFLX 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  NFLX 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  NOW 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  NOW 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  ORCL 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  ORCL 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  PANW 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  PANW 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  PEP 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  PEP 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  PG 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  PG 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  PGR 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  PGR 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  PGR 2026-08-28 SHORT bars=343 missing=47 (older than Yahoo 30d) [09:52 09:55 10:02 10:11 10:40 10:53 11:06-11:07 11:09 11:13 11:36-11:37 11:41 11:43-11:44 11:49 12:06 12:16 12:25-12:26 12:29 12:31-12:32 12:41 12:48-12:49 12:51-12:52 12:56 12:58-13:00 13:05 13:13 13:15 13:26 13:28 13:34 13:36 13:54 14:11 14:14 14:18 14:23 14:47 15:12 15:36]
  PLD 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  PLD 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  PLD 2026-08-28 SHORT bars=364 missing=26 (older than Yahoo 30d) [09:31 09:55 10:27 10:43 11:44 11:56 12:06 12:29 12:31 12:41 12:44 12:54 12:56 12:58 13:09 13:11 13:26-13:27 13:30 13:42 13:52 13:58 14:12 14:38 14:43 14:54]
  PLTR 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  PLTR 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  PM 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  PM 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  PM 2026-08-28 SHORT bars=387 missing=3 (older than Yahoo 30d) [12:49 12:58 13:34]
  QCOM 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  QCOM 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  QQQ 2026-09-03 SHORT bars=248 missing=142 (older than Yahoo 30d)
  QQQ 2026-09-04 SHORT bars=389 missing=1 (older than Yahoo 30d) [15:59]
  RBLX 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  RBLX 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  RBLX 2026-08-28 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  RTX 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  RTX 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  RTX 2026-08-28 SHORT bars=381 missing=9 (older than Yahoo 30d) [12:37 12:41 12:52 13:06 13:10 13:44 13:53 14:32 14:51]
  SBUX 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  SBUX 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  SBUX 2026-08-28 SHORT bars=389 missing=1 (older than Yahoo 30d) [10:52]
  SCHW 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  SCHW 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  SHOP 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  SHOP 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  SHOP 2026-08-28 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  SMCI 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  SMCI 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  SMCI 2026-08-28 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  SMH 2026-09-03 SHORT bars=248 missing=142 (older than Yahoo 30d)
  SMH 2026-09-04 SHORT bars=389 missing=1 (older than Yahoo 30d) [15:59]
  SNOW 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  SNOW 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  SNOW 2026-08-28 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  SO 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  SO 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  SPGI 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  SPGI 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  SPGI 2026-08-28 SHORT bars=386 missing=4 (older than Yahoo 30d) [10:14 12:50 13:20 13:52]
  SPMO 2026-08-26 SHORT bars=389 missing=1 (older than Yahoo 30d) [14:24]
  SPMO 2026-08-27 SHORT bars=387 missing=3 (older than Yahoo 30d) [11:02 13:15 13:59]
  SPMO 2026-08-28 SHORT bars=387 missing=3 (older than Yahoo 30d) [10:55 12:53 13:25]
  SPMO 2026-08-31 SHORT bars=383 missing=7 (older than Yahoo 30d) [11:22 13:11 13:56 14:03 14:12 14:46 14:53]
  SPMO 2026-09-01 SHORT bars=387 missing=3 (older than Yahoo 30d) [12:22 12:58 13:14]
  SPMO 2026-09-02 SHORT bars=385 missing=5 (older than Yahoo 30d) [11:31 12:15 14:14 14:49 15:04]
  SPMO 2026-09-03 SHORT bars=243 missing=147 (older than Yahoo 30d)
  SPMO 2026-09-04 SHORT bars=388 missing=2 (older than Yahoo 30d) [10:45 15:59]
  SPY 2026-09-03 SHORT bars=248 missing=142 (older than Yahoo 30d)
  SPY 2026-09-04 SHORT bars=389 missing=1 (older than Yahoo 30d) [15:59]
  SYK 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  SYK 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  T 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  T 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  TJX 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  TJX 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  TMUS 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  TMUS 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  TMUS 2026-08-28 SHORT bars=387 missing=3 (older than Yahoo 30d) [11:36 12:27 15:08]
  TQQQ 2026-09-03 SHORT bars=389 missing=1 (older than Yahoo 30d) [14:09]
  TQQQ 2026-09-04 SHORT bars=389 missing=1 (older than Yahoo 30d) [15:59]
  TSM 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  TSM 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  TSM 2026-08-28 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  TXN 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  TXN 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  TXN 2026-08-28 SHORT bars=389 missing=1 (older than Yahoo 30d) [14:03]
  UBER 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  UBER 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  UBER 2026-08-28 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  UNH 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  UNH 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  UNP 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  UNP 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  UNP 2026-08-28 SHORT bars=375 missing=15 (older than Yahoo 30d) [09:35 09:47 10:23 11:24 11:27 11:43 12:26 12:28 12:41 12:44 13:15 13:31 13:46 13:53 15:18]
  V 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  V 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  VOO 2026-09-03 SHORT bars=389 missing=1 (older than Yahoo 30d) [13:54]
  VOO 2026-09-04 SHORT bars=388 missing=2 (older than Yahoo 30d) [15:58-15:59]
  VRTX 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  VRTX 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  VRTX 2026-08-28 SHORT bars=356 missing=34 (older than Yahoo 30d) [09:32 10:52 11:09 11:25 11:31 11:44 11:51-11:52 12:26 12:28 12:32 12:34 12:37 12:41 12:53 13:02-13:03 13:05 13:08-13:09 13:20 13:26 13:30-13:31 13:35-13:36 13:38 13:45 14:00 14:14 14:22 14:26 14:35 15:17]
  VZ 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  VZ 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  WFC 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  WFC 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  WM 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  WM 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  WM 2026-08-28 SHORT bars=385 missing=5 (older than Yahoo 30d) [09:49 10:46 11:22 12:35 12:38]
  WMT 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  WMT 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  XLC 2026-08-27 SHORT bars=388 missing=2 (older than Yahoo 30d) [11:29 12:12]
  XLC 2026-09-03 SHORT bars=389 missing=1 (older than Yahoo 30d) [13:54]
  XLC 2026-09-04 SHORT bars=385 missing=5 (older than Yahoo 30d) [15:55-15:59]
  XLF 2026-09-03 SHORT bars=389 missing=1 (older than Yahoo 30d) [13:54]
  XLF 2026-09-04 SHORT bars=385 missing=5 (older than Yahoo 30d) [15:55-15:59]
  XLK 2026-09-03 SHORT bars=388 missing=2 (older than Yahoo 30d) [13:53-13:54]
  XLK 2026-09-04 SHORT bars=371 missing=19 (older than Yahoo 30d) [15:41-15:59]
  XLY 2026-09-03 SHORT bars=389 missing=1 (older than Yahoo 30d) [13:54]
  XLY 2026-09-04 SHORT bars=386 missing=4 (older than Yahoo 30d) [15:41-15:44]
  XOM 2026-08-26 EMPTY bars=0 missing=390 (older than Yahoo 30d)
  XOM 2026-08-27 EMPTY bars=0 missing=390 (older than Yahoo 30d)
##### tools/qa_count_check.mjs
COST     2026-09-08   OVER        390   391       390  1 outside 09:30-16:00
COST     2026-09-09   OVER        390   391       390  1 outside 09:30-16:00
COST     2026-09-11   OVER        390   391       390  1 outside 09:30-16:00
COST     2026-09-14   OVER        390   391       390  1 outside 09:30-16:00
COST     2026-09-16   OVER        390   391       390  1 outside 09:30-16:00
COST     2026-09-17   OVER        390   391       390  1 outside 09:30-16:00
COST     2026-09-18   OVER        390   391       390  1 outside 09:30-16:00
CRDO     2026-09-04   OVER        390   391       390  1 outside 09:30-16:00
CRDO     2026-09-08   OVER        390   391       390  1 outside 09:30-16:00

Symbols whose first data day is after 2026-08-26: 109
  ABBV     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  ABT      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  ADBE     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  ADI      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  ADP      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  AMD      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  AMGN     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  AMT      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  ANET     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  APH      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  AXP      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  BAC      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  BKNG     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  BLK      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  BMY      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  BSX      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  BX       2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  C        2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  CAT      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  CB       2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  CME      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  COP      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  COST     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  CRM      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  CRWD     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  CSCO     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  CVX      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  DE       2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  DIS      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  DUK      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  ELV      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  ETN      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  GE       2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  GILD     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  GS       2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  HD       2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  HON      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  IBM      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  ICE      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  INTC     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  INTU     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  ISRG     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  JNJ      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  KKR      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  KLAC     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  KO       2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  LIN      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  LLY      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  LMT      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  LOW      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  MA       2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  MCD      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  MDLZ     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  MDT      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  MRK      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  MS       2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  MU       2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  NEE      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  NFLX     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  NOW      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  ORCL     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  PANW     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  PEP      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  PG       2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  PGR      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  PLD      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  PLTR     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  PM       2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  QCOM     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  RTX      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  SBUX     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  SCHW     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  SO       2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  SPGI     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  SYK      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  T        2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  TJX      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  TMUS     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  TXN      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  UNH      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  UNP      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  V        2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  VRTX     2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  VZ       2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  WFC      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  WM       2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  WMT      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  XOM      2026-08-28 (archive_symbols.first_unix → 2026-08-28)
  ABNB     2026-08-31 (archive_symbols.first_unix → 2026-08-31)
  ALAB     2026-08-31 (archive_symbols.first_unix → 2026-08-31)
  APP      2026-08-31 (archive_symbols.first_unix → 2026-08-31)
  ARM      2026-08-31 (archive_symbols.first_unix → 2026-08-31)
  ASML     2026-08-31 (archive_symbols.first_unix → 2026-08-31)
  COIN     2026-08-31 (archive_symbols.first_unix → 2026-08-31)
  CRDO     2026-08-31 (archive_symbols.first_unix → 2026-08-31)
  DDOG     2026-08-31 (archive_symbols.first_unix → 2026-08-31)
  DELL     2026-08-31 (archive_symbols.first_unix → 2026-08-31)
  FISV     2026-08-31 (archive_symbols.first_unix → 2026-08-31)
  HOOD     2026-08-31 (archive_symbols.first_unix → 2026-08-31)
  LRCX     2026-08-31 (archive_symbols.first_unix → 2026-08-31)
  MRSH     2026-08-31 (archive_symbols.first_unix → 2026-08-31)
  MRVL     2026-08-31 (archive_symbols.first_unix → 2026-08-31)
  MSTR     2026-08-31 (archive_symbols.first_unix → 2026-08-31)
  RBLX     2026-08-31 (archive_symbols.first_unix → 2026-08-31)
  SHOP     2026-08-31 (archive_symbols.first_unix → 2026-08-31)
  SMCI     2026-08-31 (archive_symbols.first_unix → 2026-08-31)
  SNOW     2026-08-31 (archive_symbols.first_unix → 2026-08-31)
  TSM      2026-08-31 (archive_symbols.first_unix → 2026-08-31)
  UBER     2026-08-31 (archive_symbols.first_unix → 2026-08-31)
##### tools/qa_accuracy_check.mjs
  HOOD 2026-09-14 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  HOOD 2026-09-23 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  HOOD 2026-10-01 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  IBM 2026-09-23 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  IBM 2026-09-30 ISSUES compared=389 missing=0 extra=0(flat 0) price=0 volume=1
  ICE 2026-09-21 ISSUES compared=387 missing=0 extra=0(flat 0) price=0 volume=1
  ICE 2026-10-05 ISSUES compared=385 missing=0 extra=0(flat 0) price=0 volume=1
  INTC 2026-09-22 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  INTU 2026-09-24 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  INTU 2026-10-06 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  ISRG 2026-09-23 ISSUES compared=386 missing=0 extra=0(flat 0) price=0 volume=1
  ISRG 2026-10-06 ISSUES compared=386 missing=0 extra=0(flat 0) price=0 volume=1
  JNJ 2026-09-09 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  JNJ 2026-10-01 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  JPM 2026-09-10 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  JPM 2026-09-29 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  KKR 2026-09-17 ISSUES compared=382 missing=0 extra=0(flat 0) price=0 volume=1
  KKR 2026-09-25 ISSUES compared=387 missing=0 extra=0(flat 0) price=0 volume=1
  KKR 2026-10-06 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  KLAC 2026-09-09 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  KLAC 2026-10-02 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  KO 2026-09-09 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  KO 2026-09-18 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  KO 2026-09-30 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  LIN 2026-09-21 ISSUES compared=387 missing=0 extra=0(flat 0) price=0 volume=1
  LLY 2026-09-09 ISSUES compared=388 missing=0 extra=0(flat 0) price=0 volume=1
  LLY 2026-09-18 ISSUES compared=388 missing=0 extra=0(flat 0) price=0 volume=1
  LLY 2026-09-30 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  LMT 2026-09-14 ISSUES compared=385 missing=0 extra=0(flat 0) price=0 volume=1
  LMT 2026-09-25 ISSUES compared=389 missing=0 extra=0(flat 0) price=0 volume=1
  LOW 2026-09-11 ISSUES compared=387 missing=0 extra=0(flat 0) price=0 volume=1
  LOW 2026-09-21 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  LOW 2026-09-28 ISSUES compared=387 missing=0 extra=0(flat 0) price=0 volume=1
  LRCX 2026-09-11 ISSUES compared=389 missing=0 extra=0(flat 0) price=0 volume=1
  LRCX 2026-09-22 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  LRCX 2026-09-30 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MA 2026-09-11 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MA 2026-09-25 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MCD 2026-09-28 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MCD 2026-10-06 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MDLZ 2026-09-10 ISSUES compared=389 missing=0 extra=0(flat 0) price=0 volume=1
  MDLZ 2026-09-24 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MDLZ 2026-10-02 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MDT 2026-09-10 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MDT 2026-09-21 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MDT 2026-09-30 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  META 2026-09-10 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  META 2026-09-28 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  META 2026-10-06 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MRK 2026-09-09 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MRK 2026-09-21 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MRK 2026-10-06 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MRSH 2026-09-24 ISSUES compared=381 missing=0 extra=0(flat 0) price=0 volume=1
  MRSH 2026-10-01 ISSUES compared=381 missing=0 extra=0(flat 0) price=0 volume=1
  MRVL 2026-09-18 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MRVL 2026-10-01 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MS 2026-09-09 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MS 2026-09-11 ISSUES compared=389 missing=0 extra=0(flat 0) price=1 volume=0
  MS 2026-09-30 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MSFT 2026-09-14 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MSFT 2026-09-21 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MSFT 2026-10-05 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MSTR 2026-09-16 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MU 2026-09-09 ISSUES compared=390 missing=0 extra=0(flat 0) price=1 volume=1
  MU 2026-09-16 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  MU 2026-10-02 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  NEE 2026-09-10 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  NEE 2026-09-28 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  NFLX 2026-09-15 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  NFLX 2026-09-24 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  NOW 2026-09-17 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  NOW 2026-10-02 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  NVDA 2026-09-15 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  NVDA 2026-09-17 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  ORCL 2026-09-14 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  ORCL 2026-09-23 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  PANW 2026-09-10 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  PANW 2026-09-24 ISSUES compared=389 missing=0 extra=0(flat 0) price=0 volume=1
  PEP 2026-09-23 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  PEP 2026-10-02 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  PG 2026-09-21 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  PG 2026-10-02 ISSUES compared=390 missing=0 extra=0(flat 0) price=0 volume=1
  PGR 2026-09-18 ISSUES compared=383 missing=0 extra=0(flat 0) price=0 volume=1
  PGR 2026-09-25 ISSUES compared=389 missing=0 extra=0(flat 0) price=0 volume=1
  PGR 2026-10-02 ISSUES compared=389 missing=0 extra=0(flat 0) price=0 volume=1
  PLD 2026-09-10 ISSUES compared=384 missing=0 extra=0(flat 0) price=0 volume=1

=== EXAMPLE MISMATCHES (30 of 1169) ===
  ADI 2026-10-06 15:21 ET  PRICE_MISMATCH  field=o  archive=421.63  yahoo=421.58
  AAPL 2026-09-23 09:30 ET  VOLUME_MISMATCH  field=v  archive=1546139  yahoo=0
  ABNB 2026-09-11 14:17 ET  EXTRA(flat v=0)  field=bar  archive=o=169.25 h=169.25 l=169.25 c=169.25 v=0  yahoo=no row
  ADI 2026-10-06 15:21 ET  PRICE_MISMATCH  field=h  archive=421.63  yahoo=421.65
  AAPL 2026-10-05 09:30 ET  VOLUME_MISMATCH  field=v  archive=881776  yahoo=0
  ADP 2026-09-09 13:55 ET  EXTRA(flat v=0)  field=bar  archive=o=265.7 h=265.7 l=265.7 c=265.7 v=0  yahoo=no row
  ADI 2026-10-06 15:21 ET  PRICE_MISMATCH  field=l  archive=421.63  yahoo=421.5
  ABBV 2026-09-09 09:30 ET  VOLUME_MISMATCH  field=v  archive=90346  yahoo=0
  BLK 2026-09-17 10:30 ET  EXTRA(flat v=0)  field=bar  archive=o=1051.3199 h=1051.3199 l=1051.3199 c=1051.3199 v=0  yahoo=no row
  ADI 2026-10-06 15:21 ET  PRICE_MISMATCH  field=c  archive=421.63  yahoo=421.575
  ABBV 2026-09-24 09:30 ET  VOLUME_MISMATCH  field=v  archive=83233  yahoo=0
  CB 2026-09-09 13:36 ET  EXTRA(flat v=0)  field=bar  archive=o=337.49 h=337.49 l=337.49 c=337.49 v=0  yahoo=no row
  BSX 2026-10-05 11:39 ET  PRICE_MISMATCH  field=h  archive=42.95  yahoo=42.96
  ABNB 2026-09-10 09:30 ET  VOLUME_MISMATCH  field=v  archive=101831  yahoo=0
  CME 2026-09-09 11:40 ET  EXTRA(flat v=0)  field=bar  archive=o=275.95 h=275.95 l=275.95 c=275.95 v=0  yahoo=no row
  BSX 2026-10-05 11:40 ET  PRICE_MISMATCH  field=o  archive=42.885  yahoo=42.88
  ABNB 2026-09-21 09:30 ET  VOLUME_MISMATCH  field=v  archive=58342  yahoo=0
  DE 2026-09-11 13:22 ET  EXTRA(flat v=0)  field=bar  archive=o=681.755 h=681.755 l=681.755 c=681.755 v=0  yahoo=no row
  BSX 2026-10-05 11:40 ET  PRICE_MISMATCH  field=h  archive=42.885  yahoo=42.89
  ABT 2026-09-25 09:30 ET  VOLUME_MISMATCH  field=v  archive=70027  yahoo=0
  DE 2026-09-11 15:04 ET  EXTRA(flat v=0)  field=bar  archive=o=676.82 h=676.82 l=676.82 c=676.82 v=0  yahoo=no row
  BSX 2026-10-05 11:41 ET  PRICE_MISMATCH  field=o  archive=42.865  yahoo=42.87
  ABT 2026-10-02 09:30 ET  VOLUME_MISMATCH  field=v  archive=26681  yahoo=0
  ELV 2026-09-11 13:56 ET  EXTRA(flat v=0)  field=bar  archive=o=415.46 h=415.46 l=415.46 c=415.46 v=0  yahoo=no row
  BSX 2026-10-05 11:41 ET  PRICE_MISMATCH  field=c  archive=42.8699  yahoo=42.865
  ADBE 2026-09-15 09:30 ET  VOLUME_MISMATCH  field=v  archive=161394  yahoo=0
  BSX 2026-10-05 11:42 ET  PRICE_MISMATCH  field=o  archive=42.86  yahoo=42.865
  ADBE 2026-09-22 09:30 ET  VOLUME_MISMATCH  field=v  archive=136429  yahoo=0
  BSX 2026-10-05 11:42 ET  PRICE_MISMATCH  field=h  archive=42.86  yahoo=42.865
  ADBE 2026-10-02 09:30 ET  VOLUME_MISMATCH  field=v  archive=85590  yahoo=0

CSV: /home/runner/work/spmo-market-bridge/spmo-market-bridge/.github/audit/qa_accuracy.csv
```
