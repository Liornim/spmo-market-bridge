"""Every saved 1-minute candle, regular session, one gzip CSV per month for all symbols together, each file <= 20 MB
(a month that comes out bigger is split by day into _a / _b ...). Small enough to upload to an AI chat or open in code.

Sources: the 'history' release (one zip per symbol, <SYM>/<YYYY-MM>.csv.gz with unix,o,h,l,c,v, prices x10000, all
sessions) and the newest candles-YYYY-MM-DD release (symbol,date,time,open,high,low,close,volume, regular session),
which wins for the dates it covers. Columns out: symbol,date,time,open,high,low,close,volume (New York time).
Usage: python tools/export_months.py <history_dir_with_zips> <candles_dir> <out_dir>
"""
import sys, os, glob, zipfile, io, gzip, re
import pandas as pd

HIST, CAND, OUT = sys.argv[1:4]
LIMIT = 20 * 1000 * 1000
os.makedirs(OUT, exist_ok=True)
COLS = ['symbol', 'date', 'time', 'open', 'high', 'low', 'close', 'volume']

cand = pd.concat([pd.read_csv(f) for f in sorted(glob.glob(os.path.join(CAND, '**', 'candles_part*.csv'), recursive=True))])
cand = cand[(cand.time >= '09:30') & (cand.time < '16:00')][COLS]
cand['month'] = cand.date.str[:7]
cand_dates = set(cand.date)

zips = {os.path.basename(z)[:-4]: zipfile.ZipFile(z) for z in sorted(glob.glob(os.path.join(HIST, '*.zip')))}
members = {}
for s, zf in zips.items():
    for n in zf.namelist():
        m = re.search(r'(\d{4}-\d{2})\.csv\.gz$', n)
        if m: members.setdefault(m.group(1), []).append((s, n))
months = sorted(set(members) | set(cand.month))

def write(df, name):
    df = df.copy(); df[['open', 'high', 'low', 'close']] = df[['open', 'high', 'low', 'close']].round(4)
    b = gzip.compress(df.to_csv(index=False).encode(), 6)
    open(os.path.join(OUT, name), 'wb').write(b)
    return len(b)

summary = []
for mo in months:
    parts = []
    for s, n in members.get(mo, []):
        h = pd.read_csv(io.BytesIO(gzip.decompress(zips[s].read(n))))
        if h.empty: continue
        t = pd.to_datetime(h.unix, unit='s', utc=True).dt.tz_convert('America/New_York')
        h = pd.DataFrame({'symbol': s, 'date': t.dt.strftime('%Y-%m-%d'), 'time': t.dt.strftime('%H:%M'),
                          'open': h.o / 1e4, 'high': h.h / 1e4, 'low': h.l / 1e4, 'close': h.c / 1e4, 'volume': h.v})
        h = h[(h.time >= '09:30') & (h.time < '16:00') & ~h.date.isin(cand_dates)]
        parts.append(h)
    c = cand[cand.month == mo][COLS]
    if len(c): parts.append(c)
    if not parts: continue
    df = pd.concat(parts).drop_duplicates(['symbol', 'date', 'time'], keep='last').sort_values(['symbol', 'date', 'time'])
    days = sorted(df.date.unique())
    name = f'candles_1m_{mo}.csv.gz'
    size = write(df, name)
    k = 1
    while size > LIMIT and k < 8:                      # too big: split the month's days into k+1 groups
        os.remove(os.path.join(OUT, name)) if os.path.exists(os.path.join(OUT, name)) else None
        for f in glob.glob(os.path.join(OUT, f'candles_1m_{mo}_*.csv.gz')): os.remove(f)
        k += 1; size = 0
        for i in range(k):
            grp = days[i * len(days) // k:(i + 1) * len(days) // k]
            size = max(size, write(df[df.date.isin(grp)], f'candles_1m_{mo}_{chr(97 + i)}.csv.gz'))
    summary.append((mo, len(df), df.symbol.nunique(), days[0], days[-1], k))
    print(mo, len(df), 'rows', df.symbol.nunique(), 'symbols', days[0], days[-1], 'files', k, 'max MB', round(size / 1e6, 1), flush=True)

with open(os.path.join(OUT, 'README.txt'), 'w') as f:
    f.write('1-minute candles, regular session (09:30-15:59 New York), all symbols, one gzip CSV per month (<= 20 MB each;\n'
            'a month split into _a/_b... when bigger). Columns: symbol,date,time,open,high,low,close,volume (New York time).\n'
            'Split-adjusted prices. Pre/after-market candles are not included.\n\n')
    for mo, n, ns, d0, d1, k in summary: f.write(f'{mo}: {n:,} rows, {ns} symbols, {d0}..{d1}, {k} file(s)\n')
print('MONTHS', len(summary), 'ROWS', sum(x[1] for x in summary))
