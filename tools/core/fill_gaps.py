"""Fill missing session bars in the frozen daily history (core/daily.csv.gz) from Yahoo's daily bars.

A missing day inside the history makes every rolling window that contains it NaN (SMA200, DD252, the Cheap Score
percentile history), so one hole removes about a year of comparison values. The NYSE calendar (nyse.py) says which
sessions should exist; each missing (symbol, session) is fetched once and appended with source noted in
core/daily_filled.json. Runs in GitHub Actions (Yahoo is not reachable from every sandbox); no-op when nothing is missing.
"""
import sys, os, json
import pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
import nyse, yahoo

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
F = os.path.join(ROOT, 'core', 'daily.csv.gz'); LOG = os.path.join(ROOT, 'core', 'daily_filled.json')
d = pd.read_csv(F)
first = d.groupby('symbol').date.min(); last = d.date.max()
missing = {}
for s, g in d.groupby('symbol'):
    want = set(nyse.sessions(first[s], last)); have = set(g.date)
    m = sorted(want - have)
    if m: missing[s] = m
print('missing:', {s: v for s, v in missing.items()})
log = json.load(open(LOG)) if os.path.exists(LOG) else {}
add = []
for s, days in missing.items():
    try: bars = yahoo.daily(s, min(days), max(days))
    except Exception as e: print('fail', s, e); continue
    for day in days:
        b = bars.get(day)
        if not b: print('yahoo has no bar', s, day); continue
        add.append(dict(symbol=s, date=day, **{k: round(float(b[k]), 4) if k != 'volume' else int(b[k] or 0) for k in ('open', 'high', 'low', 'close', 'volume')}))
        log.setdefault(s, []).append([day, 'yahoo daily'])
if add:
    d = pd.concat([d, pd.DataFrame(add)[d.columns]]).sort_values(['symbol', 'date'])
    d.to_csv(F, index=False)
    json.dump(log, open(LOG, 'w'), indent=1)
print(f'filled {len(add)} bars')
