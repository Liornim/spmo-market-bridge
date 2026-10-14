"""Helpers over core/sec/<T>.json used by state.py (valuation, data status) and screen_sec.py (data status).

Everything is aligned to one date: the end of the latest reported quarter (or fiscal year when a company files no
quarters). A trailing-four-quarter (TTM) value is returned only when four consecutive quarters end on that date, so a
concept that stopped being reported (e.g. a capex tag last used in 2021) gives None instead of an old number.
"""
import datetime as dt

ADR_RATIO = {'TSM': 5}          # ordinary shares per ADR traded in New York
EXTERNAL = {'ASML', 'TSM'}      # foreign filers: no quarterly XBRL at the SEC


def _d(s): return dt.date.fromisoformat(s)


def quarters(c, key):
    return sorted((x for x in (c.get(key) or {}).get('quarters', [])), key=lambda x: x['end'])


def latest_end(c):
    q = quarters(c, 'revenue') or quarters(c, 'net_income')
    a = sorted((c.get('revenue') or {}).get('annual', []), key=lambda x: x['end'])
    ends = [x['end'] for x in q[-1:]] + [x['end'] for x in a[-1:]]
    return max(ends) if ends else None


def ttm(c, key, end, tol=12):
    """Sum of the four quarters ending at `end` (within tol days), or the fiscal year ending there."""
    q = [x for x in quarters(c, key) if x['end'] <= (_d(end) + dt.timedelta(tol)).isoformat()]
    if len(q) >= 4 and abs((_d(q[-1]['end']) - _d(end)).days) <= tol and (_d(q[-1]['end']) - _d(q[-4]['start'])).days <= 380:
        return sum(x['val'] for x in q[-4:])
    for a in (c.get(key) or {}).get('annual', []):
        if abs((_d(a['end']) - _d(end)).days) <= tol: return a['val']
    return None


def inst_at(c, key, end, before=100, after=10):
    """Balance-sheet value reported at (or near) `end`; None when the concept was not reported then."""
    best = None
    for x in (c.get(key) or {}).get('instant', []):
        g = (_d(x['end']) - _d(end)).days
        if -before <= g <= after and (best is None or abs(g) < best[0]): best = (abs(g), x['val'])
    return None if best is None else best[1]


def diluted_shares(c, end):
    """Latest diluted share count near `end`. Some filers tag the count in millions (MCD): scaled back."""
    pts = sorted([x for k in ('quarters', 'annual') for x in (c.get('shares_diluted') or {}).get(k, [])], key=lambda x: x['end'])
    pts = [x for x in pts if end is None or abs((_d(x['end']) - _d(end)).days) <= 200]
    sh = pts[-1]['val'] if pts else None
    note = ''
    if sh is not None and sh < 1e5:      # no company here has fewer than 100k shares: the value is in millions
        sh *= 1e6; note = 'shares tagged in millions, scaled'
    if sh is None and end:               # implied from the latest quarter: net income / diluted EPS
        ni = {(x['start'], x['end']): x['val'] for k in ('quarters', 'annual') for x in (c.get('net_income') or {}).get(k, [])}
        eps = sorted([x for k in ('quarters', 'annual') for x in (c.get('eps_diluted') or {}).get(k, [])], key=lambda x: x['end'])
        for x in reversed(eps):
            if (x.get('start'), x['end']) in ni and x['val']: sh = ni[(x.get('start'), x['end'])] / x['val']; note = 'shares = net income / EPS'; break
    if sh is None:
        pts = sorted((c.get('dei_shares_outstanding') or {}).get('instant', []), key=lambda x: x['end'])
        if pts: sh = pts[-1]['val']; note = 'shares = cover-page outstanding'
    return sh, note


def expected_latest(today, has_quarters=True):
    """Latest period end a timely filer must have reported by `today`: quarter end + 45 days (10-Q), FY end + 90 (10-K).
    Returns the quarter-end date; a company whose latest end is more than ~20 days older is stale."""
    t = _d(today) if isinstance(today, str) else today
    qe = []
    for y in (t.year - 1, t.year):
        for m, d in ((3, 31), (6, 30), (9, 30), (12, 31)): qe.append(dt.date(y, m, d))
    ok = [q for q in qe if q + dt.timedelta(45 if (q.month != 12) else 90) <= t]
    return max(ok).isoformat()


def data_status(t, c, today):
    if t in EXTERNAL: return 'EXTERNAL SOURCE REQUIRED'
    e = latest_end(c)
    if not e: return 'NO DATA'
    exp = expected_latest(today)
    if (_d(exp) - _d(e)).days > 40: return 'DATA STALE'
    return 'OK'


def unit_of(c, key='revenue'):
    return (c.get(key) or {}).get('unit')


def valuation(t, c, close):
    """market cap (USD), P/E and FCF yield on TTM figures aligned to the latest quarter. None when not computable."""
    end = latest_end(c)
    if not end or not close: return None, None, None, 'no EDGAR data'
    sh, note = diluted_shares(c, end)
    if not sh: return None, None, None, 'no share count'
    mcap = close * sh / ADR_RATIO.get(t, 1)
    if unit_of(c) not in (None, 'USD'):
        return mcap, None, None, 'reports in ' + unit_of(c) + ': P/E and FCF yield not computed'
    ni = ttm(c, 'net_income', end); ocf = ttm(c, 'operating_cash_flow', end)
    has_capex = bool(quarters(c, 'capex') or (c.get('capex') or {}).get('annual'))
    cap = ttm(c, 'capex', end) if has_capex else None
    pe = mcap / ni if ni and ni > 0 else None
    fcf = None
    if ocf is not None and cap is not None: fcf = (ocf - abs(cap)) / mcap
    why = [note] if note else []
    if ocf is not None and cap is None: why.append('capex not reported for the latest quarters: FCF yield not computed')
    return mcap, pe, fcf, '; '.join(why)
