"""Current state for every symbol, from the saved candles (the /core page, "מצב היום" tab).

Inputs
  core/daily.csv.gz    frozen daily history (regular session, split-adjusted) up to its last date
  core/daily_new.csv   days after that, rebuilt each run from the newest candles-YYYY-MM-DD release
  core/splits.json     splits found after the frozen history: {"SYM": [["YYYY-MM-DD", factor], ...]}
  core/risk_engine.csv frozen Risk Tier (changes only at the quarterly review)
  core/core_data.json  CORE screen label and review result
  candles dir          minute CSVs (symbol,date,time,open,high,low,close,volume) from the release

Output: core/current_state.json and core/current_state_latest.csv

Definitions (same as the research): SMA200 of closes; slope200 = SMA200 / SMA200 20 days earlier - 1;
DD252 = close / max close of the previous 252 days (excluding today) - 1; D200 = close / SMA200 - 1;
Cheap_Score = mean of (100 - percentile of DD252 vs the stock's own prior values) and the same for D200,
each needing >= 252 prior values; quartiles Q1 <= 25 < Q2 <= 50 < Q3 <= 75 < Q4;
ADR60 = mean of (high - low) / close over 60 days, in %.
"""
import sys, json, glob, bisect, os
import numpy as np, pandas as pd

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
CANDLES = sys.argv[2] if len(sys.argv) > 2 else 'candles'
C_ = lambda p: os.path.join(ROOT, 'core', p)

base = pd.read_csv(C_('daily.csv.gz'))
base_last = base.date.max()

# 1) days after the frozen history, from the minute release
files = sorted(glob.glob(os.path.join(CANDLES, 'candles_part*.csv')))
if not files: sys.exit('no candles_part*.csv in ' + CANDLES)
m = pd.concat([pd.read_csv(f) for f in files])
m = m[(m.time >= '09:30') & (m.time < '16:00')]
g = m.sort_values(['symbol', 'date', 'time']).groupby(['symbol', 'date'])
day = pd.DataFrame({'open': g.open.first(), 'high': g.high.max(), 'low': g.low.min(), 'close': g.close.last(),
                    'volume': g.volume.sum(), 'nbars': g.size()}).reset_index()
release_first, release_last = day.date.min(), day.date.max()
if release_first > base_last:
    sys.exit(f'gap: release starts {release_first}, history ends {base_last}')

# overlap check: release vs frozen history must agree (before any split adjustment)
splits = json.load(open(C_('splits.json'))) if os.path.exists(C_('splits.json')) else {}
ov = day.merge(base[['symbol', 'date', 'close']], on=['symbol', 'date'], suffixes=('', '_b'))
# both sides are raw (unadjusted) prices for these dates, so they must match
ratio = (ov.close / ov.close_b).groupby(ov.symbol).median() if len(ov) else pd.Series(dtype=float)
mismatch = ratio[(ratio - 1).abs() > 0.002].round(4).to_dict()

new = day[day.date > base_last].copy()
# 2) split detection on the new days (overnight ratio close(t-1)/open(t) near an integer)
seq = pd.concat([base[base.date == base_last][['symbol', 'date', 'open', 'close']], new[['symbol', 'date', 'open', 'close']]]).sort_values(['symbol', 'date'])
for s, gd in seq.groupby('symbol'):
    c, o, d = gd.close.values, gd.open.values, gd.date.values
    for i in range(1, len(gd)):
        r = c[i - 1] / o[i]
        for k in (2, 3, 4, 5, 8, 10, 15, 20, 25, 30, 40, 50):
            for rr, f in ((r, k), (1 / r, 1 / k)):
                if rr > 1.5 and abs(rr / k - 1) < 0.06:
                    lst = splits.setdefault(s, [])
                    if [d[i], f] not in lst: lst.append([d[i], f])
json.dump(splits, open(C_('splits.json'), 'w'), indent=1)
new[['symbol', 'date', 'open', 'high', 'low', 'close', 'volume']].to_csv(C_('daily_new.csv'), index=False)

# 3) assemble, apply splits to everything before each split date
X = pd.concat([base, new[['symbol', 'date', 'open', 'high', 'low', 'close', 'volume']]])
for s, lst in splits.items():
    for d, f in lst:
        mk = (X.symbol == s) & (X.date < d)
        X.loc[mk, ['open', 'high', 'low', 'close']] = X.loc[mk, ['open', 'high', 'low', 'close']] / f
P = lambda c: X.pivot(index='date', columns='symbol', values=c).sort_index()
O, H, L, C = P('open'), P('high'), P('low'), P('close')
last = C.index[-1]
complete = set(new[(new.date == last) & (new.nbars >= 380)].symbol) if last > base_last else set(C.columns)
sma = C.rolling(200).mean(); slope = sma / sma.shift(20) - 1
dd = C / C.shift(1).rolling(252).max() - 1; d2 = C / sma - 1
adr60 = ((H - L) / C).rolling(60).mean() * 100
chg1 = C / C.shift(1) - 1; chg20 = C / C.shift(20) - 1
chg5 = C / C.shift(5) - 1; chg60 = C / C.shift(60) - 1
sma20 = C.rolling(20).mean(); sma50 = C.rolling(50).mean()
dd60 = C / C.shift(1).rolling(60).max() - 1
LASTD = str(last)[:10]
# earnings calendar (tools/core/earnings.py) and per-company review (core/review) and EDGAR facts (core/sec)
EARN = (json.load(open(C_('earnings.json'))).get('symbols', {}) if os.path.exists(C_('earnings.json')) else {})
def bdays(a, b):  # trading days from a (exclusive) to b (inclusive), weekends only (US holidays ignored)
    return int(np.busday_count(np.datetime64(a, 'D') + np.timedelta64(1, 'D'), np.datetime64(b, 'D') + np.timedelta64(1, 'D'))) if a < b else -int(np.busday_count(np.datetime64(b, 'D') + np.timedelta64(1, 'D'), np.datetime64(a, 'D') + np.timedelta64(1, 'D')))
def review(s):
    f = C_(os.path.join('review', s + '.json'))
    return json.load(open(f)) if os.path.exists(f) else {}
def sec_val(s, close):
    f = C_(os.path.join('sec', s + '.json'))
    if not os.path.exists(f) or not close: return None, None, None
    j = json.load(open(f)); c = j.get('concepts', {}); t = j.get('ttm', {})
    sh = None
    for key in ('shares_diluted',):
        pts = sorted([(x['end'], x['val']) for k in ('quarters', 'annual') for x in (c.get(key) or {}).get(k, [])])
        if pts: sh = pts[-1][1]; sh_end = pts[-1][0]
    if sh is None:
        pts = sorted([(x['end'], x['val']) for x in (c.get('dei_shares_outstanding') or {}).get('instant', [])])
        if pts: sh = pts[-1][1]; sh_end = pts[-1][0]
    if not sh: return None, None, None
    for d_, f_ in splits.get(s, []):   # splits after the share count date: restate the count
        if d_ > sh_end: sh *= f_
    mcap = close * sh
    ni = t.get('net_income'); ocf = t.get('operating_cash_flow'); cap = t.get('capex')
    pe = mcap / ni if ni and ni > 0 else None
    fy = (ocf - abs(cap or 0)) / mcap if ocf is not None else None
    return pe, fy, mcap

def lastpct(s):
    v = s.dropna().values
    if len(v) < 253: return np.nan
    h = sorted(v[:-1]); return bisect.bisect_left(h, v[-1]) / len(h) * 100

R = pd.read_csv(C_('risk_engine.csv')).set_index('symbol').tier
cd = json.load(open(C_('core_data.json')))
L_ = cd['list']; iS, iL, iF = L_['cols'].index('סימול'), L_['cols'].index('תווית'), L_['cols'].index('Quality סופי (סקירה)')
label = {r[iS]: r[iL] for r in L_['rows']}; final = {r[iS]: r[iF] for r in L_['rows']}
# the official mechanical screen is the SEC EDGAR one (tools/core/screen_sec.py); the Bigdata label is a fallback
sec_label, sec_fails = {}, {}
if os.path.exists(C_('screen_sec.csv')):
    _s = pd.read_csv(C_('screen_sec.csv'))
    for _, r_ in _s.iterrows():
        if isinstance(r_.get('label'), str): sec_label[r_.ticker] = r_.label; sec_fails[r_.ticker] = r_.fails if isinstance(r_.fails, str) else ''
FINSET = set('JPM BAC WFC C GS MS SCHW SOFI HOOD AXP CB PGR BRK-B BLK BX KKR COIN'.split())
ETF = {'VOO', 'SPY', 'XLF', 'XLY', 'QQQ', 'XLC', 'XLK', 'SPMO', 'SMH', 'TQQQ', 'BITX'}
CAP = {'LOW': .10, 'MEDIUM': .10, 'HIGH': .06, 'EXTREME': .03}
num = lambda v, n=4: None if v is None or (isinstance(v, float) and not np.isfinite(v)) else round(float(v), n)
rows = []
for s in C.columns:
    if pd.isna(C[s].iloc[-1]): continue
    cs = ((100 - lastpct(dd[s])) + (100 - lastpct(d2[s]))) / 2
    q = None if not np.isfinite(cs) else 'Q1' if cs <= 25 else 'Q2' if cs <= 50 else 'Q3' if cs <= 75 else 'Q4'
    rising = bool(slope[s].iloc[-1] > 0)
    tier = R.get(s)
    rv = review(s) if s not in ETF else {}
    valuation = (rv.get('valuation') or '').split(' ')[0].split('—')[0].strip() or None
    pe, fcfy, mcap = sec_val(s, C[s].iloc[-1]) if s not in ETF else (None, None, None)
    if s in FINSET: fcfy = None   # free cash flow is not meaningful for banks, brokers, insurers
    e = EARN.get(s, {}); nxt, ntime, lst, ltime = e.get('next'), e.get('next_time'), e.get('last'), e.get('last_time')
    dte = bdays(LASTD, nxt) if nxt else None
    # last trading day a short-term position may still be held before the next report
    if nxt: exit_by = nxt if ntime == 'after' else str(np.busday_offset(np.datetime64(nxt), -1, roll='backward'))
    else: exit_by = None
    hold_days = bdays(LASTD, exit_by) if exit_by else None
    # reaction to the last report: close before the reaction day -> last close
    emove = None
    if lst:
        react = lst if ltime != 'after' else str(np.busday_offset(np.datetime64(lst), 1, roll='forward'))
        prior = C[s].loc[:react].iloc[:-1] if react in C.index else C[s].loc[:react]
        if react <= LASTD and len(prior): emove = C[s].iloc[-1] / prior.iloc[-1] - 1
    qual = None if s in ETF else final.get(s)
    scr = None if s in ETF else sec_label.get(s)
    # the numbers changed since the review: the EDGAR screen now says something else than the screen the reviewer saw
    seen_by_reviewer = (rv.get('excel_status') or '').replace('CORE-ELIGIBLE', 'CORE')
    conflict = bool(seen_by_reviewer and scr and seen_by_reviewer != scr.replace('CORE-ELIGIBLE', 'CORE'))
    adr = adr60[s].iloc[-1] / 100
    recent_report = bool(lst and emove is not None and bdays(lst, LASTD) <= 3)
    if s in ETF: core_dec = 'ETF / INDEX'
    elif qual != 'CORE': core_dec = 'NO CORE'
    elif valuation == 'UNJUSTIFIABLE': core_dec = 'NO CORE'
    elif recent_report and abs(emove) > 2 * adr: core_dec = 'THESIS REVIEW'
    elif conflict: core_dec = 'REVIEW REQUIRED'
    elif q in ('Q3', 'Q4') and rising: core_dec = 'ACCELERATE TRANCHE'
    else: core_dec = 'NORMAL SCHEDULE'
    route = 'ETF' if s in ETF else ('CORE+TACTICAL' if qual == 'CORE' else 'SPECULATIVE')
    short_block = None
    if hold_days is not None and hold_days < 1: short_block = 'report too close (must be out before ' + exit_by + ')'
    rows.append(dict(symbol=s, kind='ETF' if s in ETF else 'stock', close=num(C[s].iloc[-1]), chg1=num(chg1[s].iloc[-1]), chg20=num(chg20[s].iloc[-1]),
        SMA200=num(sma[s].iloc[-1]), slope200=num(slope[s].iloc[-1], 5), sma200_rising=rising, DD252=num(dd[s].iloc[-1]), D200=num(d2[s].iloc[-1]),
        Cheap_Score=num(cs, 1), Cheap_Quartile=q, cheap_usable=bool(q and rising), ADR60=num(adr60[s].iloc[-1], 2),
        stop_2xADR60=num(2 * adr60[s].iloc[-1] / 100, 4), Risk_Tier=tier if isinstance(tier, str) else None,
        core_cap=CAP.get(tier) if isinstance(tier, str) else None, Excel_label=None if s in ETF else sec_label.get(s), Screen_fails=None if s in ETF else sec_fails.get(s),
        Review_final=qual, last_day_complete=s in complete,
        chg5=num(chg5[s].iloc[-1]), chg60=num(chg60[s].iloc[-1]), SMA20=num(sma20[s].iloc[-1]), SMA50=num(sma50[s].iloc[-1]),
        dist_SMA20=num(C[s].iloc[-1] / sma20[s].iloc[-1] - 1), dist_SMA50=num(C[s].iloc[-1] / sma50[s].iloc[-1] - 1), DD60=num(dd60[s].iloc[-1]),
        valuation_review=valuation, review_reason=rv.get('reason'), cyclical_peak=(rv.get('cyclicality') or '').split(' ')[0] or None,
        pe_ttm=num(pe, 1), fcf_yield_ttm=num(fcfy), market_cap=num(mcap, 0),
        next_earnings=nxt, next_earnings_time=ntime, days_to_earnings=dte, short_exit_by=exit_by, short_max_hold_days=(min(20, hold_days) if hold_days is not None else 20),
        last_earnings=lst, last_earnings_time=ltime, move_since_last_report=num(emove), screen_review_conflict=conflict,
        route=route, core_decision=core_dec, short_blocked=short_block))
out = dict(date=str(last)[:10], built=pd.Timestamp.now('UTC').strftime('%Y-%m-%d %H:%MZ'), history_frozen_to=base_last,
           release=[release_first, release_last], symbols=len(rows), incomplete=sorted(set(C.columns) - complete),
           overlap_mismatch=mismatch, splits=splits, rows=rows)
json.dump(out, open(C_('current_state.json'), 'w'), ensure_ascii=False)
pd.DataFrame(rows).to_csv(C_('current_state_latest.csv'), index=False)
print(f"state {out['date']}: {len(rows)} symbols, incomplete {len(out['incomplete'])}, mismatch {mismatch}, splits {splits}")
if mismatch: sys.exit(2)
