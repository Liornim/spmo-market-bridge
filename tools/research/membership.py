"""Point-in-time S&P 500 membership from Wikipedia's constituents table + its 'Selected changes' table.

Walks back from today's list: before each change date the added ticker is taken out and the removed one put back.
Outputs: sp500_current.csv, sp500_changes.csv, sp500_intervals.csv (symbol,start,end; end empty = still a member),
universe_symbols.txt (every symbol that was a member at any time since SINCE, plus our tracked list and ETFs).
Known limit: Wikipedia's change table is curated by hand; ticker renames are not always recorded as changes.
"""
import io, os, sys, datetime as dt
import pandas as pd
from common import OUT, fetch, report

SINCE = os.environ.get('SINCE', '2015-01-01')
EXTRA = sys.argv[1] if len(sys.argv) > 1 else ''

html = fetch('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies').decode('utf-8')
tables = pd.read_html(io.StringIO(html))
cur = tables[0]
cur.columns = [str(c) for c in cur.columns]
cur = cur.rename(columns={'Symbol': 'symbol', 'Security': 'name', 'GICS Sector': 'sector', 'GICS Sub-Industry': 'industry',
                          'Date added': 'date_added', 'CIK': 'cik'})
cur.to_csv(os.path.join(OUT, 'sp500_current.csv'), index=False)

ch = tables[1].copy()
ch.columns = ['_'.join(str(x) for x in c).strip() if isinstance(c, tuple) else str(c) for c in ch.columns]
def col(sub):
    return [c for c in ch.columns if sub.lower() in c.lower()]
date_c = col('date')[0]; add_c = [c for c in col('added') if 'ticker' in c.lower()][0]; rem_c = [c for c in col('removed') if 'ticker' in c.lower()][0]
ch = pd.DataFrame({'date': pd.to_datetime(ch[date_c], errors='coerce'), 'added': ch[add_c], 'removed': ch[rem_c],
                   'reason': ch[col('reason')[0]] if col('reason') else ''}).dropna(subset=['date'])
ch['added'] = ch.added.where(ch.added.astype(str).str.strip().ne('') & ch.added.notna())
ch['removed'] = ch.removed.where(ch.removed.astype(str).str.strip().ne('') & ch.removed.notna())
ch = ch.sort_values('date', ascending=False)
ch.to_csv(os.path.join(OUT, 'sp500_changes.csv'), index=False)

# walk back: membership as a dict symbol -> start (None = before our horizon); ends recorded as we pass removals
members = set(cur.symbol)
start = {s: None for s in members}; intervals = []
open_end = {s: '' for s in members}
for _, r in ch.iterrows():
    d = r.date.date().isoformat()
    a, rm = r.added, r.removed
    if isinstance(a, str) and a in members:            # before d, `a` was not a member: its interval starts at d
        intervals.append((a, d, open_end.pop(a, ''))); members.discard(a)
    if isinstance(rm, str) and rm not in members:      # before d, `rm` was a member and left at d
        members.add(rm); open_end[rm] = d
for s in members:                                       # members at the start of the change table
    intervals.append((s, '1900-01-01', open_end.get(s, '')))
iv = pd.DataFrame(intervals, columns=['symbol', 'start', 'end']).sort_values(['symbol', 'start'])
iv.to_csv(os.path.join(OUT, 'sp500_intervals.csv'), index=False)

ever = sorted(set(iv[(iv.end == '') | (iv.end >= SINCE)].symbol))
etfs = ['SPY', 'QQQ', 'DIA', 'IWM', 'MDY', 'RSP', 'VOO', 'TQQQ', 'SMH', 'SPMO', 'TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'GLD', 'SLV', 'USO',
        'DBC', 'UUP', 'EEM', 'EFA', 'VNQ', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY', 'MTUM', 'QUAL',
        'VLUE', 'USMV', 'SIZE', 'BITX']
extra = [s for s in open(EXTRA).read().split() if s] if EXTRA and os.path.exists(EXTRA) else []
uni = sorted(set(ever) | set(extra) | set(etfs))
open(os.path.join(OUT, 'universe_symbols.txt'), 'w').write('\n'.join(uni) + '\n')
report('membership', {'current_members': len(cur), 'changes_rows': len(ch), 'oldest_change': str(ch.date.min().date()),
                      'members_since_' + SINCE: len(ever), 'universe_total': len(uni),
                      'check_member_count_today': int(((iv.end == '')).sum())})
