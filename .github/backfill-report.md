# supabase-backfill run 13 (push) — 2026-10-06T22:41:31Z

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
    "    at async Object.all (worker.js:30666:59)",
    "    at async trackedSymbols (worker.js:30397:23)",
    "    at async handle (worker.js:31979:20)"
  ],
  "time": "2026-10-06T22:28:57.665Z"
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
    "    at async Object.first (worker.js:30668:21)",
    "    at async migrate (worker.js:30239:18)",
    "    at async ensureSchema (worker.js:30208:3)"
  ],
  "time": "2026-10-06T22:28:59.450Z"
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
    "    at async Object.first (worker.js:30668:21)",
    "    at async migrate (worker.js:30239:18)",
    "    at async ensureSchema (worker.js:30208:3)"
  ],
  "time": "2026-10-06T22:29:01.280Z"
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
    "    at async Object.first (worker.js:30668:21)",
    "    at async migrate (worker.js:30239:18)",
    "    at async ensureSchema (worker.js:30208:3)"
  ],
  "time": "2026-10-06T22:29:03.138Z"
}
[HTTP 500]

archive_symbols: 0 added (none)
archive_symbols: 129 symbols; copying 118 from bars
[1/118] AAPL 10920 bars
[2/118] ABBV 8190 bars
[3/118] ABNB 8190 bars
[4/118] ABT 8190 bars
[5/118] ADBE 8190 bars
[6/118] ADI 8190 bars
[7/118] ADP 8190 bars
[8/118] ALAB 8190 bars
[9/118] AMD 8190 bars
[10/118] AMGN 8190 bars
[11/118] AMT 8190 bars
[12/118] AMZN 10920 bars
[13/118] ANET 8190 bars
[14/118] APH 8190 bars
[15/118] APP 8190 bars
[16/118] ARM 8190 bars
[17/118] ASML 8190 bars
[18/118] AVGO 10919 bars
[19/118] AXP 8190 bars
[20/118] BAC 8190 bars
[21/118] BKNG 8190 bars
[22/118] BLK 8190 bars
[23/118] BMY 8190 bars
[24/118] BRK-B 10919 bars
[25/118] BSX 8190 bars
[26/118] BX 8190 bars
[27/118] C 8578 bars
[28/118] CAT 8190 bars
[29/118] CB 8190 bars
[30/118] CME 8190 bars
[31/118] COIN 8190 bars
[32/118] COP 8190 bars
[33/118] COST 8190 bars
[34/118] CRDO 8190 bars
[35/118] CRM 8190 bars
[36/118] CRWD 8190 bars
[37/118] CSCO 8190 bars
[38/118] CVX 8190 bars
[39/118] DDOG 8190 bars
[40/118] DE 8190 bars
[41/118] DELL 8190 bars
[42/118] DIS 8190 bars
[43/118] DUK 8190 bars
[44/118] ELV 8190 bars
[45/118] ETN 8190 bars
[46/118] FISV 8190 bars
[47/118] GE 8190 bars
[48/118] GILD 8190 bars
[49/118] GOOGL 10915 bars
[50/118] GS 8190 bars
[51/118] HD 8190 bars
[52/118] HON 8190 bars
[53/118] HOOD 8190 bars
[54/118] IBM 8190 bars
[55/118] ICE 8190 bars
[56/118] INTC 8190 bars
[57/118] INTU 8190 bars
[58/118] ISRG 8190 bars
[59/118] JNJ 8190 bars
[60/118] JPM 10912 bars
[61/118] KKR 8190 bars
[62/118] KLAC 8190 bars
[63/118] KO 8190 bars
[64/118] LIN 8190 bars
[65/118] LLY 8190 bars
[66/118] LMT 8190 bars
[67/118] LOW 8190 bars
[68/118] LRCX 8190 bars
[69/118] MA 8190 bars
[70/118] MCD 8190 bars
[71/118] MDLZ 8190 bars
[72/118] MDT 8190 bars
[73/118] META 10912 bars
[74/118] MRK 8190 bars
[75/118] MRSH 8190 bars
[76/118] MRVL 8190 bars
[77/118] MS 8190 bars
[78/118] MSFT 10912 bars
[79/118] MSTR 8190 bars
[80/118] MU 8190 bars
[81/118] NEE 8190 bars
[82/118] NFLX 8190 bars
[83/118] NOW 8190 bars
[84/118] NVDA 10919 bars
[85/118] ORCL 8190 bars
[86/118] PANW 8190 bars
[87/118] PEP 8190 bars
[88/118] PG 8190 bars
[89/118] PGR 8190 bars
[90/118] PLD 8190 bars
[91/118] PLTR 8579 bars
[92/118] PM 8190 bars
[93/118] QCOM 8190 bars
[94/118] QQQ 10919 bars
[95/118] RBLX 8190 bars
[96/118] RTX 8190 bars
[97/118] SBUX 8190 bars
[98/118] SCHW 8190 bars
[99/118] SHOP 8190 bars
[100/118] SMCI 8190 bars
[101/118] SMH 8579 bars
[102/118] SNOW 8190 bars
[103/118] SO 8190 bars
[104/118] SPGI 8190 bars
[105/118] SPMO 8578 bars
[106/118] SPY 10919 bars
[107/118] SYK 8190 bars
[108/118] T 8190 bars
[109/118] TJX 8190 bars
[110/118] TMUS 8190 bars
[111/118] TQQQ 8579 bars
[112/118] TSLA 10920 bars
[113/118] VOO 8578 bars
[114/118] WFC 8964 bars
[115/118] XLC 8575 bars
[116/118] XLF 8575 bars
[117/118] XLK 8561 bars
[118/118] XLY 8576 bars
Error: HEAD archive_bars?select=unix&unix=gte.1788786000&unix=lt.1788816600 -> HTTP 500 
    at req (file:///home/runner/work/spmo-market-bridge/spmo-market-bridge/tools/archive_from_bars.mjs:33:49)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at async count (file:///home/runner/work/spmo-market-bridge/spmo-market-bridge/tools/archive_from_bars.mjs:39:15)
    at async main (file:///home/runner/work/spmo-market-bridge/spmo-market-bridge/tools/archive_from_bars.mjs:122:16)
```
