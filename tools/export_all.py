"""All saved 1-minute candles up to a date, one CSV per symbol, in the /bars download format.

Sources: the 'history' release (one zip per symbol, monthly csv.gz: unix,o,h,l,c,v with prices x10000, all sessions)
and the newest candles-YYYY-MM-DD release (symbol,date,time,open,high,low,close,volume, regular session).
For dates both cover, the candles release wins. Output: regular session only (09:30-15:59 ET), dates <= END.
Usage: python tools/export_all.py <history_dir_with_zips> <candles_dir> <END YYYY-MM-DD> <out_dir>
"""
import sys, os, glob, zipfile, io, gzip
import pandas as pd

HIST, CAND, END, OUT = sys.argv[1:5]
os.makedirs(OUT, exist_ok=True)
cand = pd.concat([pd.read_csv(f) for f in sorted(glob.glob(os.path.join(CAND, 'candles_part*.csv')))])
cand = cand[(cand.date <= END) & (cand.time >= '09:30') & (cand.time < '16:00')]
cand_by = {s: g for s, g in cand.groupby('symbol')}
syms = sorted(set(os.path.basename(z)[:-4] for z in glob.glob(os.path.join(HIST, '*.zip'))) | set(cand_by))
total = 0
for s in syms:
    parts = []
    z = os.path.join(HIST, s + '.zip')
    if os.path.exists(z):
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                if not n.endswith('.csv.gz'): continue
                h = pd.read_csv(io.BytesIO(gzip.decompress(zf.read(n))))
                if h.empty: continue
                t = pd.to_datetime(h.unix, unit='s', utc=True).dt.tz_convert('America/New_York')
                h = pd.DataFrame({'symbol': s, 'date': t.dt.strftime('%Y-%m-%d'), 'time': t.dt.strftime('%H:%M'),
                                  'open': h.o / 1e4, 'high': h.h / 1e4, 'low': h.l / 1e4, 'close': h.c / 1e4, 'volume': h.v})
                parts.append(h[(h.time >= '09:30') & (h.time < '16:00') & (h.date <= END)])
    hist = pd.concat(parts) if parts else pd.DataFrame(columns=['symbol', 'date', 'time', 'open', 'high', 'low', 'close', 'volume'])
    c = cand_by.get(s)
    if c is not None and len(c): hist = hist[~hist.date.isin(set(c.date))]
    df = pd.concat([hist, c]) if c is not None else hist
    df = df.drop_duplicates(['date', 'time'], keep='last').sort_values(['date', 'time'])
    df.to_csv(os.path.join(OUT, f'{s}.csv'), index=False)
    total += len(df)
    print(s, len(df), df.date.min(), df.date.max(), flush=True)
print('TOTAL rows', total)
