"""Daily bars from Alpaca (SIP, all exchanges) for every symbol in universe_symbols.txt, 2016-01-01 .. today.

Two adjustments are written, because they answer different questions:
  daily_split.csv.gz  adjustment=split  -> prices as traded, split-adjusted (levels, gaps, patterns)
  daily_all.csv.gz    adjustment=all    -> also dividend-adjusted (total-return backtests)
Columns: symbol,date,open,high,low,close,volume,vwap,trades. Symbols use '-' for classes (BRK-B).
Delisted names: Alpaca keeps bars for many inactive assets but not all; the report lists what came back empty.
"""
import os, sys, json, time, urllib.parse
import pandas as pd
from common import OUT, fetch_json, report, symbols_file

KEY, SEC = os.environ['ALPACA_KEY_ID'], os.environ['ALPACA_SECRET_KEY']
H = {'APCA-API-KEY-ID': KEY, 'APCA-API-SECRET-KEY': SEC, 'Accept': 'application/json'}
START = os.environ.get('START', '2016-01-01')
import re
ALL = symbols_file(os.path.join(OUT, 'universe_symbols.txt'))
# fja05680 marks a ticker that was later reused by another company as TICKER-YYYYMM; Alpaca cannot tell them apart
syms = [s for s in ALL if not re.search(r'-\d{6}$', s)]
skipped_reused = sorted(set(ALL) - set(syms))
toA = lambda s: s.replace('-', '.')
fromA = lambda s: s.replace('.', '-')

bad = []
def one(adj, s1, rows):
    tok = None
    while True:
        q = {'symbols': toA(s1), 'timeframe': '1Day', 'feed': 'sip', 'adjustment': adj, 'start': START, 'limit': 10000}
        if tok: q['page_token'] = tok
        try: j = fetch_json('https://data.alpaca.markets/v2/stocks/bars?' + urllib.parse.urlencode(q), headers=H, tries=2)
        except RuntimeError as e: bad.append((s1, str(e)[-40:])); return
        for s, bars in (j.get('bars') or {}).items():
            for b in bars: rows.append((fromA(s), b['t'][:10], b['o'], b['h'], b['l'], b['c'], b['v'], b.get('vw'), b.get('n')))
        tok = j.get('next_page_token')
        if not tok: return
        time.sleep(0.3)

def pull(adj):
    rows = []
    for i in range(0, len(syms), 50):
        grp = syms[i:i + 50]; tok = None
        while True:
            q = {'symbols': ','.join(toA(s) for s in grp), 'timeframe': '1Day', 'feed': 'sip', 'adjustment': adj,
                 'start': START, 'limit': 10000}
            if tok: q['page_token'] = tok
            try:
                j = fetch_json('https://data.alpaca.markets/v2/stocks/bars?' + urllib.parse.urlencode(q), headers=H)
            except RuntimeError as e:
                if 'HTTP 400' not in str(e) or len(grp) == 1: bad.append((','.join(grp), str(e)[-60:])); break
                for s1 in grp: one(adj, s1, rows)        # one bad symbol poisons the batch: go one by one
                break
            for s, bars in (j.get('bars') or {}).items():
                for b in bars:
                    rows.append((fromA(s), b['t'][:10], b['o'], b['h'], b['l'], b['c'], b['v'], b.get('vw'), b.get('n')))
            tok = j.get('next_page_token')
            if not tok: break
            time.sleep(0.35)
        print(f'{adj}: {min(i + 50, len(syms))}/{len(syms)} symbols, {len(rows)} rows', flush=True)
        time.sleep(0.35)
    return pd.DataFrame(rows, columns=['symbol', 'date', 'open', 'high', 'low', 'close', 'volume', 'vwap', 'trades'])

cov = {}
for adj, name in [('split', 'daily_split.csv.gz'), ('all', 'daily_all.csv.gz')]:
    df = pull(adj).drop_duplicates(['symbol', 'date']).sort_values(['symbol', 'date'])
    df.to_csv(os.path.join(OUT, name), index=False, compression='gzip')
    g = df.groupby('symbol').date.agg(['min', 'max', 'count'])
    cov[adj] = {'symbols_requested': len(syms), 'symbols_with_data': int(len(g)), 'rows': int(len(df)),
                'missing': sorted(set(syms) - set(g.index))}
g.to_csv(os.path.join(OUT, 'daily_coverage.csv'))
cov['skipped_reused_tickers'] = skipped_reused; cov['bad_requests'] = bad[:200]
report('alpaca_daily', cov)
