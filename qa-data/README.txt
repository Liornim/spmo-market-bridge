Drop CSVs here, one per symbol/day:

  symbol,date,time,open,high,low,close,volume
  AMD,2026-09-04,09:30,462,462,458.03,458.605,850888

Name them anything; the symbol and date are read from the rows themselves.
Get them from /bars -> daily or minute view -> "הורד יום".

The harness sorts by time, drops duplicate timestamps, and runs every golden
case whose symbol and date match — each on candles up to that minute only.
