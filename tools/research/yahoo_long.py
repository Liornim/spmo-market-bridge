"""Long daily history (as far back as Yahoo has it) for index-level research: ETFs, indices, VIX family, rates.

Through the Worker's /xa/yahoo_d proxy (range=max), because Yahoo rate-limits GitHub's runners; falls back to
a direct call. Output long_daily.csv.gz: symbol,date,open,high,low,close,adjclose,volume (+ dividends/splits events).
"""
import os, time, datetime as dt, urllib.parse
import pandas as pd
from common import OUT, WORKER, fetch_json, report

SYMS = ['^GSPC', '^NDX', '^DJI', '^RUT', '^VIX', '^VIX3M', '^VIX9D', '^VVIX', '^SKEW', '^TNX', '^IRX', '^FVX', '^TYX',
        'SPY', 'QQQ', 'DIA', 'IWM', 'MDY', 'RSP', 'TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'GLD', 'SLV', 'USO', 'DBC', 'UUP',
        'EEM', 'EFA', 'VNQ', 'XLB', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XLRE', 'XLC', 'SMH',
        'MTUM', 'QUAL', 'VLUE', 'USMV', 'GC=F', 'CL=F', 'HG=F', 'DX-Y.NYB', 'BTC-USD']
rows, events, rep = [], [], {}
for s in SYMS:
    q = urllib.parse.quote(s, safe='')
    # both routes are tried and the longer answer kept: an older Worker build answers range=max with 1y, not an error
    j, res = None, None
    for url in (f'{WORKER}/xa/yahoo_d/{q}?range=max',
                f'https://query1.finance.yahoo.com/v8/finance/chart/{q}?interval=1d&range=max&events=div,split'):
        try:
            r_ = fetch_json(url, tries=3)['chart']['result'][0]
            if res is None or len(r_.get('timestamp') or []) > len(res.get('timestamp') or []): res, j = r_, True
        except Exception as e:
            rep[s + ' ' + url[8:20]] = f'fail: {str(e)[:80]}'
    if not j: continue
    ts = res.get('timestamp') or []; qd = res['indicators']['quote'][0]
    adj = (res['indicators'].get('adjclose') or [{}])[0].get('adjclose') or [None] * len(ts)
    for i, t in enumerate(ts):
        d = dt.datetime.utcfromtimestamp(t + (res['meta'].get('gmtoffset') or 0)).date().isoformat()
        rows.append((s, d, qd['open'][i], qd['high'][i], qd['low'][i], qd['close'][i], adj[i], qd['volume'][i]))
    for kind, ev in (res.get('events') or {}).items():
        for v in ev.values():
            events.append((s, kind, dt.datetime.utcfromtimestamp(v['date']).date().isoformat(), v.get('amount'),
                           v.get('numerator'), v.get('denominator')))
    rep[s] = f'ok {len(ts)} bars from {rows[-len(ts)][1] if ts else "-"}'
    time.sleep(1.0)
df = pd.DataFrame(rows, columns=['symbol', 'date', 'open', 'high', 'low', 'close', 'adjclose', 'volume']).dropna(subset=['close'])
df.to_csv(os.path.join(OUT, 'long_daily.csv.gz'), index=False, compression='gzip')
pd.DataFrame(events, columns=['symbol', 'event', 'date', 'amount', 'num', 'den']).to_csv(os.path.join(OUT, 'long_events.csv.gz'), index=False, compression='gzip')
report('yahoo_long', rep)
