"""Point-in-time S&P 500 membership from Wikipedia's constituents table + its 'Selected changes' table.

Walks back from today's list: before each change date the added ticker is taken out and the removed one put back.
Outputs: sp500_current.csv, sp500_changes.csv, sp500_intervals.csv (symbol,start,end; end empty = still a member),
universe_symbols.txt (every symbol that was a member at any time since SINCE, plus our tracked list and ETFs).
Known limit: Wikipedia's change table is curated by hand; ticker renames are not always recorded as changes.
"""
import io, os, sys, urllib.parse, datetime as dt
import pandas as pd
from common import OUT, fetch, report

SINCE = os.environ.get('SINCE', '2015-01-01')
EXTRA = sys.argv[1] if len(sys.argv) > 1 else ''

def from_fja():
    """github.com/fja05680/sp500: one row per date with the full member list (back to 1996)."""
    import json as _j
    lst = _j.loads(fetch('https://api.github.com/repos/fja05680/sp500/contents',
                         headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN']} if os.environ.get('GH_TOKEN') else None))
    name = sorted(x['name'] for x in lst if x['name'].startswith('S&P 500 Historical Components') and x['name'].endswith('.csv'))[-1]
    d = pd.read_csv(io.BytesIO(fetch('https://raw.githubusercontent.com/fja05680/sp500/master/' + urllib.parse.quote(name))))
    d.columns = ['date', 'tickers']; d['date'] = pd.to_datetime(d.date); d = d.sort_values('date')
    rows, prev, since = [], set(), {}
    for _, r in d.iterrows():
        cur_ = set(t.strip() for t in str(r.tickers).split(',') if t.strip())
        day = r.date.date().isoformat()
        for t in cur_ - prev: since[t] = day
        for t in prev - cur_: rows.append((t, since.pop(t), day))
        prev = cur_
    rows += [(t, s_, '') for t, s_ in since.items()]
    return rows, name

src = {}
try:
    html = fetch('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies').decode('utf-8')
    tables = pd.read_html(io.StringIO(html))
    cur = tables[0]; cur.columns = [str(c) for c in cur.columns]
    cur = cur.rename(columns={'Symbol': 'symbol', 'Security': 'name', 'GICS Sector': 'sector', 'GICS Sub-Industry': 'industry',
                              'Date added': 'date_added', 'CIK': 'cik'})
    cur.to_csv(os.path.join(OUT, 'sp500_current.csv'), index=False); src['wikipedia_current'] = len(cur)
except Exception as e:
    tables = None; src['wikipedia'] = 'fail ' + str(e)[:120]

intervals = None
try:
    intervals, fname = from_fja(); src['intervals_source'] = 'fja05680/sp500 ' + fname
except Exception as e:
    src['fja05680'] = 'fail ' + str(e)[:120]

if intervals is None:
    if tables is None: raise RuntimeError(f'no membership source worked: {src}')
    ch = tables[1].copy()
    ch.columns = ['_'.join(str(x) for x in c).strip() if isinstance(c, tuple) else str(c) for c in ch.columns]
    def col(sub): return [c for c in ch.columns if sub.lower() in c.lower()]
    date_c = col('date')[0]; add_c = [c for c in col('added') if 'ticker' in c.lower()][0]; rem_c = [c for c in col('removed') if 'ticker' in c.lower()][0]
    ch = pd.DataFrame({'date': pd.to_datetime(ch[date_c], errors='coerce'), 'added': ch[add_c], 'removed': ch[rem_c]}).dropna(subset=['date'])
    ch = ch.sort_values('date', ascending=False); ch.to_csv(os.path.join(OUT, 'sp500_changes.csv'), index=False)
    members = set(cur.symbol); intervals = []; open_end = {s_: '' for s_ in members}
    for _, r in ch.iterrows():
        d = r.date.date().isoformat(); a, rm = r.added, r.removed
        if isinstance(a, str) and a in members: intervals.append((a, d, open_end.pop(a, ''))); members.discard(a)
        if isinstance(rm, str) and rm not in members: members.add(rm); open_end[rm] = d
    intervals += [(s_, '1900-01-01', open_end.get(s_, '')) for s_ in members]
    src['intervals_source'] = 'wikipedia walk-back'
iv = pd.DataFrame(intervals, columns=['symbol', 'start', 'end']).sort_values(['symbol', 'start'])

iv['symbol'] = iv.symbol.str.replace('.', '-', regex=False)
iv.to_csv(os.path.join(OUT, 'sp500_intervals.csv'), index=False)
ever = sorted(set(iv[(iv.end == '') | (iv.end >= SINCE)].symbol))
etfs = ['SPY', 'QQQ', 'DIA', 'IWM', 'MDY', 'RSP', 'VOO', 'TQQQ', 'SMH', 'SPMO', 'TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'GLD', 'SLV', 'USO',
        'DBC', 'UUP', 'EEM', 'EFA', 'VNQ', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY', 'MTUM', 'QUAL',
        'VLUE', 'USMV', 'SIZE', 'BITX']
extra = [s for s in open(EXTRA).read().split() if s] if EXTRA and os.path.exists(EXTRA) else []
uni = sorted(set(ever) | set(extra) | set(etfs))
open(os.path.join(OUT, 'universe_symbols.txt'), 'w').write('\n'.join(uni) + '\n')
report('membership', {**src, 'members_since_' + SINCE: len(ever), 'universe_total': len(uni),
                      'check_member_count_today': int(((iv.end == '')).sum())})
