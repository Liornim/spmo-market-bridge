"""Current state for every symbol, from the saved candles (the /core page, "מצב היום" tab).

Inputs
  core/daily.csv.gz    frozen daily history (regular session, split-adjusted) up to its last date
  core/daily_new.csv   days after that, ACCUMULATED: each run merges the newest candles-YYYY-MM-DD release into it
                       (raw prices, release wins for its dates), so the history keeps advancing after the
                       release's rolling window has moved past the frozen history
  core/splits.json     splits after the frozen history, CONFIRMED with Yahoo's split events:
                       {"SYM": [["YYYY-MM-DD", factor], ...], "_checked": {"SYM|date": "result"}}
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
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nyse, secutil

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
CANDLES = sys.argv[2] if len(sys.argv) > 2 else 'candles'
C_ = lambda p: os.path.join(ROOT, 'core', p)
COLS = ['symbol', 'date', 'open', 'high', 'low', 'close', 'volume']

base = pd.read_csv(C_('daily.csv.gz'))
base_last = base.date.max()
NEWF = C_('daily_new.csv')
acc = pd.read_csv(NEWF) if os.path.exists(NEWF) and os.path.getsize(NEWF) > 60 else pd.DataFrame(columns=COLS + ['nbars'])
if 'nbars' not in acc: acc['nbars'] = np.nan
acc = acc[acc.date > base_last]

# 1) the minute release -> daily bars (regular session only)
files = sorted(glob.glob(os.path.join(CANDLES, 'candles_part*.csv')))
if not files: sys.exit('no candles_part*.csv in ' + CANDLES)
m = pd.concat([pd.read_csv(f) for f in files])
m = m[(m.time >= '09:30') & (m.time < '16:00')]
_dup = m[m.duplicated(['symbol', 'date', 'time'], keep=False)]
dup_bars = {s: int(n) for s, n in _dup.groupby('symbol').size().items()}   # same minute twice in the release
m = m.drop_duplicates(['symbol', 'date', 'time'], keep='last')
g = m.sort_values(['symbol', 'date', 'time']).groupby(['symbol', 'date'])
day = pd.DataFrame({'open': g.open.first(), 'high': g.high.max(), 'low': g.low.min(), 'close': g.close.last(),
                    'volume': g.volume.sum(), 'nbars': g.size()}).reset_index()
release_first, release_last = day.date.min(), day.date.max()
hist_last = max(base_last, acc.date.max()) if len(acc) else base_last
if release_first > nyse.next_session(hist_last):
    sys.exit(f'gap: release starts {release_first}, history (frozen + accumulated) ends {hist_last}')

# overlap check, day by day: the release (raw) against what we already hold for the same dates
H = pd.concat([base[['symbol', 'date', 'close']], acc[['symbol', 'date', 'close']]])
ov = day.merge(H, on=['symbol', 'date'], suffixes=('', '_h'))
ov['r'] = ov.close / ov.close_h
mismatch, presplit = {}, {}
for s, gg in ov.groupby('symbol'):
    bad = gg[(gg.r - 1).abs() > 0.005]
    if bad.empty: continue
    k = bad.r.median(); good = gg[(gg.r - 1).abs() <= 0.005]
    if abs(k - 1) > 0.2 and (bad.r / k - 1).abs().max() < 0.01 and (good.empty or bad.date.max() < good.date.min()):
        # the frozen history is already split-adjusted for a split before its end; the release is raw: expected
        presplit[s] = [round(float(k), 4), bad.date.min(), bad.date.max()]
    else:
        mismatch[s] = {r_.date: round(float(r_.r), 4) for r_ in bad.head(5).itertuples()}

# 2) accumulate: release days after the frozen history replace/extend daily_new.csv
rel_new = day[day.date > base_last][COLS + ['nbars']]
keep = ~acc.set_index(['symbol', 'date']).index.isin(rel_new.set_index(['symbol', 'date']).index)
acc = pd.concat([acc[keep], rel_new]).sort_values(['symbol', 'date'])
acc.to_csv(NEWF, index=False)
new = acc

# 3) splits after the frozen history: an overnight gap of 17%+ is a candidate; only Yahoo's split events confirm one
splits = json.load(open(C_('splits.json'))) if os.path.exists(C_('splits.json')) else {}
checked = splits.setdefault('_checked', {})
unconfirmed, gaps_no_split = [], []
seq = pd.concat([base[base.date == base_last][['symbol', 'date', 'open', 'close']], new[['symbol', 'date', 'open', 'close']]]).sort_values(['symbol', 'date'])
for s, gd in seq.groupby('symbol'):
    c, o, d = gd.close.values, gd.open.values, gd.date.values
    for i in range(1, len(gd)):
        r = c[i - 1] / o[i]
        if 0.83 < r < 1.2: continue
        key = f'{s}|{d[i]}'
        if any(abs((pd.Timestamp(x[0]) - pd.Timestamp(d[i])).days) <= 10 for x in splits.get(s, [])): continue   # split already recorded
        if key in checked and checked[key] != 'no split (recheck)':
            if checked[key].startswith('no split'): gaps_no_split.append(key)
            continue
        try:
            import yahoo
            ys = yahoo.splits(s, nyse.prev_session(d[i], 5), nyse.next_session(d[i], 3))
        except Exception as e:
            unconfirmed.append(key + f' (overnight x{1 / r:.3f}; Yahoo unreachable: {str(e)[:60]})'); continue
        hit = [x for x in ys if abs((pd.Timestamp(x[0]) - pd.Timestamp(d[i])).days) <= 4]
        if hit:
            splits.setdefault(s, []).append([d[i], hit[0][1]]); checked[key] = f'split {hit[0][1]} (source date {hit[0][0]})'
        else:
            # a gap that looks like a clean split ratio but the source reports none: do not settle it yet
            near_ratio = any(abs(rr / k - 1) < 0.03 for k in (1.5, 2, 3, 4, 5, 7, 8, 10, 15, 20) for rr in (1 / r, r))
            age = nyse.sessions_between(d[i], seq.date.max())
            if near_ratio and age < 5:
                checked[key] = 'no split (recheck)'; unconfirmed.append(key + f' (overnight x{1 / r:.3f} looks like a split; source reports none yet)')
            else:
                checked[key] = 'no split'; gaps_no_split.append(key)
json.dump(splits, open(C_('splits.json'), 'w'), indent=1)
SPL = {k: v for k, v in splits.items() if not k.startswith('_')}

# 4) assemble, apply each split to everything before its date (prices / f, volume * f)
X = pd.concat([base, new[COLS]])
for s, lst in SPL.items():
    for d, f in lst:
        mk = (X.symbol == s) & (X.date < d)
        X.loc[mk, ['open', 'high', 'low', 'close']] = X.loc[mk, ['open', 'high', 'low', 'close']] / f
        X.loc[mk, 'volume'] = X.loc[mk, 'volume'] * f
P = lambda c: X.pivot(index='date', columns='symbol', values=c).sort_index()
O, H, L, C = P('open'), P('high'), P('low'), P('close')
# a single missing session inside the history (13 symbol-days in 2021-22; the sources have no real bar for them) would
# make every rolling window that contains it NaN and drop ~a year of Cheap Score comparison values: carry the previous
# day forward for interior one-day gaps only (never the last day, whose absence must stay visible)
_gaps = int(C.iloc[:-1].isna().sum().sum())
for F_ in (O, H, L, C): F_.iloc[:-1] = F_.iloc[:-1].ffill(limit=1)
GAPS_FILLED = _gaps - int(C.iloc[:-1].isna().sum().sum())
last = C.index[-1]
LASTD = str(last)[:10]
if last > base_last:
    nb = new[new.date == last].set_index('symbol').nbars
    complete = set(nb[nb >= nyse.full_bars(LASTD) - 10].index)
else: complete = set(C.columns)
sma = C.rolling(200).mean(); slope = sma / sma.shift(20) - 1
dd = C / C.shift(1).rolling(252).max() - 1; d2 = C / sma - 1
adr60 = ((H - L) / C).rolling(60).mean() * 100
chg1 = C / C.shift(1) - 1; chg20 = C / C.shift(20) - 1
chg5 = C / C.shift(5) - 1; chg60 = C / C.shift(60) - 1
sma20 = C.rolling(20).mean(); sma50 = C.rolling(50).mean()
dd60 = C / C.shift(1).rolling(60).max() - 1
sma150 = C.rolling(150).mean(); slope150 = sma150 / sma150.shift(20) - 1
# RSI(2), Wilder smoothing (the Connors rule tested on SPY: close > SMA200 and RSI(2) < 10)
_d1 = C.diff(); _up = _d1.clip(lower=0).ewm(alpha=1 / 2, adjust=False).mean(); _dn = (-_d1.clip(upper=0)).ewm(alpha=1 / 2, adjust=False).mean()
rsi2 = 100 - 100 / (1 + _up / _dn.replace(0, np.nan))
rsi2 = rsi2.where(_dn > 0, 100.0)
ret = C.pct_change(fill_method=None)
vol60 = ret.rolling(60).std()                     # close-to-close daily volatility, 60 sessions
# Decision 20.10.2026 (owner): volatility for the SPECULATIVE stop/size comes from a GARCH(1,1) forecast, not from the
# 60-day range alone. Research (methods backtest 19.10): GARCH beat plain historical volatility out of sample (SPY
# QLIKE -24%, t 4.3; five single stocks -4% to -18%); the high-low range (what ADR60 measures) did worse than plain
# historical volatility (t -3.6). ADR60 stays (Risk Tier, history, the old stop); the forward stop rescales it:
# ADR_fwd = ADR60 x (GARCH forecast of mean daily vol over the next 20 sessions / 60-day close-to-close vol).
_GA = np.array([a for a in np.arange(0.02, 0.21, 0.01) for b in np.arange(0.70, 0.99, 0.01) if a + b < 0.995])
_GB = np.array([b for a in np.arange(0.02, 0.21, 0.01) for b in np.arange(0.70, 0.99, 0.01) if a + b < 0.995])
def garch_fwd(x, h=20, win=1000):
    """GARCH(1,1) with variance targeting fitted by grid search (max likelihood) on the last `win` daily returns;
    returns the forecast mean daily volatility over the next h sessions (same scale as a daily std of returns)."""
    y = x.dropna().values[-win:]
    if len(y) < 250: return np.nan
    y = y - y.mean(); vl = y.var(); om = vl * (1 - _GA - _GB)
    hh = np.full(len(_GA), vl); ll = np.zeros(len(_GA))
    for v in y:                       # h_t known before y_t; then update
        ll += np.log(hh) + v * v / hh
        hh = om + _GA * v * v + _GB * hh
    k = int(np.argmin(ll)); ps = _GA[k] + _GB[k]
    hnext = hh[k]
    var_path = vl + (hnext - vl) * ps ** np.arange(h)
    return float(np.sqrt(var_path.mean()))
GVOL = {s: garch_fwd(ret[s]) for s in C.columns}
# tax-loss window (research M484, B+): at the close nearest Dec 20, stocks down > 20% year to date whose
# December-to-date return is below the median of the list; held to about Jan 10. Shown from Dec 18 to Jan 10.
_ld = pd.Timestamp(LASTD)
TAXWIN = (_ld.month == 12 and _ld.day >= 18) or (_ld.month == 1 and _ld.day <= 10)
_yr = _ld.year - 1 if (_ld.month == 1 and _ld.day <= 10) else _ld.year   # the tax year in question
_ye = C.loc[:f'{_yr - 1}-12-31'].iloc[-1] if len(C.loc[:f'{_yr - 1}-12-31']) else None      # last close of the previous year
_ne = C.loc[:f'{_yr}-11-30'].iloc[-1] if len(C.loc[:f'{_yr}-11-30']) else None              # last close of November
_ref = C.loc[:f'{_yr}-12-20'].iloc[-1] if (_ld.month == 1 and _ld.day <= 10) and len(C.loc[:f'{_yr}-12-20']) else C.iloc[-1]   # Jan 1-10: as of Dec 20
YTD = (_ref / _ye - 1) if _ye is not None else pd.Series(np.nan, index=C.columns)
DECTD = (_ref / _ne - 1) if _ne is not None else pd.Series(np.nan, index=C.columns)
_stk = [s for s in C.columns if s not in {'VOO', 'SPY', 'XLF', 'XLY', 'QQQ', 'XLC', 'XLK', 'SPMO', 'SMH', 'TQQQ', 'BITX'}]
DEC_MED = DECTD[_stk].median()
def sales_accel(c):
    """Research M184 (B+): quarterly YoY revenue growth up > 5 points vs the prior quarter's YoY growth; the effect was
    measured over 63 sessions after the filing, so the flag lasts ~140 days after the quarter end."""
    q = secutil.quarters(c, 'revenue')
    if len(q) < 6: return None, None, None
    def yoy(i):
        e = pd.Timestamp(q[i]['end'])
        prev = [x for x in q[:i] if abs((e - pd.Timestamp(x['end'])).days - 365) <= 20]
        return q[i]['val'] / prev[-1]['val'] - 1 if prev and prev[-1]['val'] > 0 else None
    g0, g1 = yoy(len(q) - 1), yoy(len(q) - 2)
    if g0 is None or g1 is None: return None, None, None
    fresh = (TODAY_NY.tz_localize(None) - pd.Timestamp(q[-1]['end'])).days <= 140
    return round(g0, 4), round(g1, 4), bool(g0 - g1 > 0.05 and fresh)
ACT = nyse.next_session(LASTD)   # the session in which this state is acted on
# earnings calendar (tools/core/earnings.py), per-company review (core/review), EDGAR facts (core/sec)
EJ = json.load(open(C_('earnings.json'))) if os.path.exists(C_('earnings.json')) else {}
EARN = EJ.get('symbols', {})
TT = {'pre': 'BMO', 'after': 'AMC'}
def events(s):
    e = EARN.get(s, {})
    ev = e.get('events') or [[e[k], e.get(k + '_time')] for k in ('last', 'next') if e.get(k)]
    out = []
    for d, t in ev:
        t = t if t in ('pre', 'after') else 'unknown'
        if not nyse.is_session(d): eff, t = nyse.on_or_after(d), 'pre'     # weekend/holiday report: before the next open
        else: eff = d
        react = nyse.next_session(eff) if t == 'after' else eff            # unknown time: treated as before the open
        exit_by = eff if t == 'after' else nyse.prev_session(eff)          # last session a short-term position may be held
        out.append(dict(date=eff, time=t, react=react, exit_by=exit_by))
    return sorted(out, key=lambda x: x['react'])
def review(s):
    f = C_(os.path.join('review', s + '.json'))
    return json.load(open(f)) if os.path.exists(f) else {}
def sec_json(s):
    f = C_(os.path.join('sec', s + '.json'))
    return json.load(open(f)).get('concepts', {}) if os.path.exists(f) else {}

def lastpct(s):
    v = s.dropna().values
    if len(v) < 253: return np.nan
    h = sorted(v[:-1]); return bisect.bisect_left(h, v[-1]) / len(h) * 100

_re = pd.read_csv(C_('risk_engine.csv')).set_index('symbol'); R = _re.tier; MAXDD = _re.maxDD
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
INDEX = {'VOO', 'SPY'}   # the only ETFs that count toward the ~45% broad-index part of CORE (decision 14.10)
CAP = {'LOW': .10, 'MEDIUM': .10, 'HIGH': .06, 'EXTREME': .03}
TODAY_NY = pd.Timestamp.now('America/New_York')
num = lambda v, n=4: None if v is None or (isinstance(v, float) and not np.isfinite(v)) else round(float(v), n)
rows = []
for s in C.columns:
    if pd.isna(C[s].iloc[-1]): continue
    cs = ((100 - lastpct(dd[s])) + (100 - lastpct(d2[s]))) / 2
    q = None if not np.isfinite(cs) else 'Q1' if cs <= 25 else 'Q2' if cs <= 50 else 'Q3' if cs <= 75 else 'Q4'
    rising = bool(slope[s].iloc[-1] > 0)
    tier = R.get(s); tier = tier if isinstance(tier, str) else None
    is_etf = s in ETF
    rv = review(s) if not is_etf else {}
    valuation = (rv.get('valuation') or '').split(' ')[0].split('—')[0].strip() or None
    cj = sec_json(s) if not is_etf else {}
    if is_etf: mcap = pe = fcfy = None; vnote = ''; dstat = None; fend = None
    else:
        mcap, pe, fcfy, vnote = secutil.valuation(s, cj, float(C[s].iloc[-1]))
        dstat = secutil.data_status(s, cj, TODAY_NY.strftime('%Y-%m-%d')); fend = secutil.latest_end(cj)
    if s in FINSET: fcfy = None   # free cash flow is not meaningful for banks, brokers, insurers
    # ---- earnings, relative to the session this state is acted on (ACT = next session after LASTD)
    ev = events(s)
    nx = next((x for x in ev if x['react'] > LASTD), None)          # reaction not yet in these prices
    lx = next((x for x in reversed(ev) if x['react'] <= LASTD), None)
    estatus = None; exit_by = None; hold = None; dte = None; short_block = None
    if nx:
        exit_by = nx['exit_by']; tt = TT.get(nx['time'], 'time unknown')
        hold = nyse.sessions_between(LASTD, exit_by) if exit_by >= ACT else 0      # sessions from ACT to exit_by inclusive
        dte = nyse.sessions_between(LASTD, nx['date'])
        if exit_by < ACT:
            estatus = (f'REPORTED AFTER CLOSE {nx["date"]}: reaction at the open {ACT}' if nx['time'] == 'after'
                       else f'REPORT {nx["date"]} {tt}: short-term positions must already be out')
        elif exit_by == ACT: estatus = f'REPORT {nx["date"]} {tt}: exit short-term positions by the close {ACT}'
        elif dte <= 5: estatus = f'REPORT IN {dte} SESSIONS ({nx["date"]} {tt})'
        if hold <= 1: short_block = f'report {nx["date"]} {tt}: exit by {exit_by}, no new short-term entry'
    emove = None; recent_report = False
    if lx:
        prior = C[s].loc[:lx['react']]
        prior = prior.iloc[:-1] if lx['react'] in C.index else prior
        if len(prior) and pd.notna(prior.iloc[-1]): emove = C[s].iloc[-1] / prior.iloc[-1] - 1
        recent_report = nyse.sessions_between(lx['react'], LASTD) <= 2
        if recent_report and not estatus:
            estatus = f'REPORTED {lx["date"]} {TT.get(lx["time"], "time unknown")}: move since {emove * 100:+.1f}%' if emove is not None else f'REPORTED {lx["date"]}'
    # no next date: harmless right after a report (the next one is ~3 months away, beyond the 75-day window);
    # otherwise the date is simply not announced yet and a 20-session hold could run into it
    if not nx and not is_etf and not (lx and nyse.sessions_between(lx['date'], LASTD) <= 40):
        estatus = (estatus + ' · ' if estatus else '') + 'NEXT REPORT DATE NOT IN THE CALENDAR: check it before any short-term entry'
    qual = None if is_etf else final.get(s)
    scr = None if is_etf else sec_label.get(s)
    # the EDGAR screen now says something else than the screen the reviewer saw: Quality is not settled
    seen_by_reviewer = (rv.get('excel_status') or '').replace('CORE-ELIGIBLE', 'CORE')
    conflict = bool(seen_by_reviewer and scr and seen_by_reviewer != scr.replace('CORE-ELIGIBLE', 'CORE'))
    adr = adr60[s].iloc[-1] / 100
    if is_etf: core_dec = 'INDEX (45%)' if s in INDEX else 'OUTSIDE METHOD'
    elif conflict: core_dec = 'REVIEW REQUIRED'
    elif qual != 'CORE' or valuation == 'UNJUSTIFIABLE': core_dec = 'NO CORE'
    elif recent_report and emove is not None and abs(emove) > 2 * adr: core_dec = 'THESIS REVIEW'
    elif q in ('Q3', 'Q4') and rising: core_dec = 'ACCELERATE TRANCHE'
    else: core_dec = 'NORMAL SCHEDULE'
    a_ = adr60[s].iloc[-1]
    md = MAXDD.get(s)
    if md is None or not np.isfinite(md): md = float((C[s] / C[s].cummax() - 1).min() * 100)   # TQQQ, BITX: own history
    tier_now = None
    if np.isfinite(a_):
        tier_now = 'EXTREME' if a_ >= 4 or md <= -70 else 'HIGH' if a_ >= 2.75 or md <= -50 else 'MEDIUM' if a_ >= 1.6 or md <= -30 else 'LOW'
    route = 'ETF' if is_etf else ('CORE+TACTICAL' if qual == 'CORE' and not conflict else 'SPECULATIVE')
    # any stock that moved more than 2 x ADR60 on its last report (within 3 sessions): read the report before a short-term entry
    post_report = bool(not is_etf and recent_report and emove is not None and abs(emove) > 2 * adr)
    # Decision 20.10: a big move UP on the report no longer blocks TACTICAL/SPECULATIVE (research: drift after positive
    # surprises, PEAD t 2.0, sales acceleration t 2.1 in both periods); a big move DOWN still blocks for 3 sessions
    post_dir = None if not post_report else ('up' if emove > 0 else 'down')
    gv = GVOL.get(s); v60 = vol60[s].iloc[-1]
    adr_fwd = a_ * gv / v60 if (gv is not None and np.isfinite(gv) and np.isfinite(v60) and v60 > 0 and np.isfinite(a_)) else None
    sa = sales_accel(cj) if not is_etf else (None, None, None)
    tax_c = bool(TAXWIN and not is_etf and np.isfinite(YTD.get(s, np.nan)) and YTD[s] < -0.20 and np.isfinite(DECTD.get(s, np.nan)) and DECTD[s] < DEC_MED)
    rows.append(dict(symbol=s, kind='ETF' if is_etf else 'stock', etf_role=('INDEX' if s in INDEX else 'OUTSIDE METHOD') if is_etf else None,
        close=num(C[s].iloc[-1]), chg1=num(chg1[s].iloc[-1]), chg20=num(chg20[s].iloc[-1]),
        SMA200=num(sma[s].iloc[-1]), slope200=num(slope[s].iloc[-1], 5), sma200_rising=rising, DD252=num(dd[s].iloc[-1]), D200=num(d2[s].iloc[-1]),
        Cheap_Score=num(cs, 1), Cheap_Quartile=q, cheap_usable=bool(q and rising), ADR60=num(adr60[s].iloc[-1], 2),
        stop_2xADR60=num(2 * adr60[s].iloc[-1] / 100, 4), Risk_Tier=tier,
        core_cap=None if is_etf else CAP.get(tier), Excel_label=scr, Screen_fails=None if is_etf else sec_fails.get(s),
        Review_final=qual, review_required=conflict, last_day_complete=s in complete,
        chg5=num(chg5[s].iloc[-1]), chg60=num(chg60[s].iloc[-1]),
        # closes N sessions back, counted from the session this state is acted on (N=1 is the last close):
        # the /today page measures 3d/5d/10d/1m/3m/6m moves as live price / close_bN - 1
        **{f'close_b{n}': num(C[s].iloc[-n]) if len(C[s].dropna()) >= n else None for n in (3, 5, 10, 21, 63, 126)}, SMA20=num(sma20[s].iloc[-1]), SMA50=num(sma50[s].iloc[-1]),
        dist_SMA20=num(C[s].iloc[-1] / sma20[s].iloc[-1] - 1), dist_SMA50=num(C[s].iloc[-1] / sma50[s].iloc[-1] - 1), DD60=num(dd60[s].iloc[-1]),
        valuation_review=valuation, review_reason=rv.get('reason'), cyclical_peak=(rv.get('cyclicality') or '').split(' ')[0] or None,
        pe_ttm=num(pe, 1), fcf_yield_ttm=num(fcfy), market_cap=num(mcap, 0), valuation_note=vnote or None,
        fundamentals_status=dstat, fundamentals_end=fend,
        next_earnings=nx['date'] if nx else None, next_earnings_time=nx['time'] if nx else None,
        earnings_time=TT.get(nx['time'], 'UNKNOWN') if nx else None, days_to_earnings=dte,
        short_exit_by=exit_by, short_max_hold_days=(min(20, hold) if hold is not None else 20),
        earnings_status=estatus, tier_today=tier_now,
        last_earnings=lx['date'] if lx else None, last_earnings_time=lx['time'] if lx else None, move_since_last_report=num(emove),
        screen_review_conflict=conflict, route=route, core_decision=core_dec, short_blocked=short_block, post_report_review=post_report,
        # ---- added 20.10.2026 (nothing above changed)
        SMA150=num(sma150[s].iloc[-1]), dist_SMA150=num(C[s].iloc[-1] / sma150[s].iloc[-1] - 1), sma150_rising=bool(slope150[s].iloc[-1] > 0),
        RSI2=num(rsi2[s].iloc[-1], 1),
        index_rsi2_accelerate=bool(s in INDEX and C['SPY'].iloc[-1] > sma['SPY'].iloc[-1] and rsi2['SPY'].iloc[-1] < 10) if 'SPY' in C else False,
        post_report_direction=post_dir, post_report_blocks_short=bool(post_report and post_dir == 'down'),
        vol60_d=num(v60, 5), vol_fcst_20d=num(gv, 5), ADR_fwd=num(adr_fwd, 2), stop_fwd=num(2 * adr_fwd / 100, 4) if adr_fwd is not None else None,
        tier_fwd=(None if adr_fwd is None else 'EXTREME' if adr_fwd >= 4 or md <= -70 else 'HIGH' if adr_fwd >= 2.75 or md <= -50 else 'MEDIUM' if adr_fwd >= 1.6 or md <= -30 else 'LOW'),
        ytd_return=num(YTD.get(s, np.nan)), tax_loss_window=TAXWIN, tax_loss_candidate=tax_c,
        rev_yoy_last_q=sa[0], rev_yoy_prev_q=sa[1], sales_accel=sa[2]))
# ---- added 22.10.2026 (owner): graded quality severity + continuous risk score. Nothing above changed.
# Quality: core/quality_severity.csv (tools/core/quality_severity.py, run after screen_sec in sec-facts).
# Risk: 10th-percentile 6-month drawdown = -(9.82 + 8.70 x ADR60), research in tools/core/risk_research.py;
# cap for a NEW buy = bad case <= 2.5% of the portfolio, max 10%. Never a reason to sell. corr with SPY = info only.
_QS = pd.read_csv(C_('quality_severity.csv')).set_index('ticker') if os.path.exists(C_('quality_severity.csv')) else None
_QN = {'profit': 'רווחיות', 'cash': 'תזרים', 'returns': 'תשואה על ההון', 'balance': 'מאזן', 'growth': 'צמיחה', 'dilution': 'דילול'}
_SV = {1: 'פספוס זעיר', 2: 'כישלון ברור', 3: 'כישלון חמור'}
_r252 = ret.iloc[-252:]
_CORR = _r252.corrwith(_r252['SPY']) if 'SPY' in _r252 else pd.Series(dtype=float)
for row in rows:
    s = row['symbol']
    if _QS is not None and s in _QS.index:
        q = _QS.loc[s]
        row['quality_severity'] = int(q['severity']); row['quality_label_v2'] = q['new_label']
        row['quality_sev_detail'] = ' · '.join(_QN[k] + ': ' + _SV[int(q['sev_' + k])] for k in _QN if int(q['sev_' + k]) > 0) or 'אין כשלים'
    a = row.get('ADR60')
    if a is not None and np.isfinite(a):
        bad = -(9.82 + 8.70 * a)
        row['bad6m'] = round(bad, 1); row['med6m'] = round(-(3.83 + 5.77 * a), 1)
        row['cap_v2'] = None if row['kind'] == 'ETF' else round(min(10.0, 2.5 / -bad * 100), 1)
        row['risk_v2'] = 2 if bad >= -34 else 1 if bad >= -45 else 0
    c = _CORR.get(s, np.nan)
    if s != 'SPY' and pd.notna(c):
        row['corr_spy'] = round(float(c), 2)
        row['market_link'] = 'זזה עם השוק' if c >= .6 else 'חלקית' if c >= .45 else 'זזה לבד'
# ---- data health (every night; the weekly view is the same checks)
vol = X.pivot(index='date', columns='symbol', values='volume').sort_index()
now_ny = TODAY_NY; t_ny = now_ny.strftime('%Y-%m-%d')
exp_last = t_ny if (nyse.is_session(t_ny) and now_ny.hour >= 18) else (nyse.prev_session(t_ny) if nyse.is_session(t_ny) else nyse.on_or_before(t_ny))
last60 = nyse.sessions(nyse.prev_session(LASTD, 59), LASTD)
have = X[X.date >= last60[0]].groupby('symbol').date.apply(set)
eb = EJ.get('built'); eb_age = (pd.Timestamp.now('UTC') - pd.Timestamp(eb.replace('Z', ''), tz='UTC')).total_seconds() / 3600 if eb else None
health = {'checked': pd.Timestamp.now('UTC').strftime('%Y-%m-%d %H:%MZ'), 'state_date': LASTD, 'acted_on_session': ACT,
  'expected_last_session': exp_last,
  'symbols_in_state': int(C.iloc[-1].notna().sum()), 'symbols_expected': 131,
  'missing_symbols': sorted(set(C.columns[C.iloc[-1].isna()])),
  'incomplete_last_day': sorted(set(C.columns) - complete),
  'full_day_bars_expected': nyse.full_bars(LASTD),
  'missing_days_last_60': {s: sorted(set(last60) - have.get(s, set())) for s in C.columns if set(last60) - have.get(s, set())},
  'duplicate_minute_bars_in_release': dup_bars, 'interior_one_day_gaps_carried_forward': GAPS_FILLED,
  'stuck_close_5_sessions': [s for s in C.columns if C[s].iloc[-5:].nunique() == 1],
  'zero_volume_last_day': [s for s in vol.columns if vol[s].iloc[-1] == 0],
  'volume_over_5x_avg': [s for s in vol.columns if vol[s].iloc[-1] > 5 * vol[s].iloc[-21:-1].mean()],
  'one_day_move_over_25pct': [s for s in C.columns if abs(chg1[s].iloc[-1]) > .25],
  'overlap_mismatch_vs_history': mismatch, 'history_presplit_adjusted': presplit,
  'splits_confirmed_after_history': SPL, 'split_candidates_unconfirmed': unconfirmed, 'large_gaps_checked_no_split': gaps_no_split,
  'earnings_calendar_built': eb, 'earnings_calendar_age_hours': None if eb_age is None else round(eb_age, 1),
  'earnings_not_found': EJ.get('not_found'), 'earnings_failed_days': len(EJ.get('failed_days') or []),
  'fundamentals_not_ok': {r_['symbol']: r_['fundamentals_status'] + ' (latest ' + str(r_['fundamentals_end']) + ')' for r_ in rows if r_.get('fundamentals_status') not in (None, 'OK')},
  'cheap_score_lookahead': 'none by construction: percentiles use only values before each day',
  'risk_tier_frozen_vs_today': {r_['symbol']: [r_['Risk_Tier'], r_['tier_today']] for r_ in rows if r_.get('Risk_Tier') and r_.get('tier_today') and r_['Risk_Tier'] != r_['tier_today']}}
health['state_is_current'] = LASTD >= exp_last
health['earnings_calendar_fresh'] = eb_age is not None and eb_age <= 36
health['ok'] = bool(health['state_is_current'] and health['earnings_calendar_fresh'] and not (health['missing_symbols'] or health['incomplete_last_day'] or health['stuck_close_5_sessions']
                    or mismatch or unconfirmed or dup_bars or health['missing_days_last_60']))
# quartile changes vs about a month (21 sessions) and a week (5 sessions) earlier
def q_at(k):
    out_ = {}
    for s in C.columns:
        if len(dd[s].dropna()) < 253 + k: continue
        a1 = lastpct(dd[s].iloc[:len(dd[s]) - k]); a2 = lastpct(d2[s].iloc[:len(d2[s]) - k])
        cs_ = ((100 - a1) + (100 - a2)) / 2
        out_[s] = None if not np.isfinite(cs_) else 'Q1' if cs_ <= 25 else 'Q2' if cs_ <= 50 else 'Q3' if cs_ <= 75 else 'Q4'
    return out_
Q5, Q21 = q_at(5), q_at(21)
for r_ in rows:
    r_['quartile_5_sessions_ago'] = Q5.get(r_['symbol']); r_['quartile_21_sessions_ago'] = Q21.get(r_['symbol'])
os.makedirs(C_('history'), exist_ok=True)
pd.DataFrame(rows).to_csv(C_(os.path.join('history', 'state_' + LASTD + '.csv')), index=False)
EB = json.load(open(C_('earnings.json'))).get('built') if os.path.exists(C_('earnings.json')) else None
out = dict(date=str(last)[:10], acted_on_session=ACT, earnings_built=EB, health=health, built=pd.Timestamp.now('UTC').strftime('%Y-%m-%d %H:%MZ'), history_frozen_to=base_last,
           release=[release_first, release_last], symbols=len(rows), incomplete=sorted(set(C.columns) - complete),
           overlap_mismatch=mismatch, splits=SPL, rows=rows)
json.dump(out, open(C_('current_state.json'), 'w'), ensure_ascii=False)
pd.DataFrame(rows).to_csv(C_('current_state_latest.csv'), index=False)
print(f"state {out['date']} (acted on {ACT}): {len(rows)} symbols, incomplete {len(out['incomplete'])}, mismatch {mismatch}, splits {SPL}, unconfirmed {unconfirmed}, ok {health['ok']}")
if mismatch: sys.exit(2)
