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

def lastpct(s):
    v = s.dropna().values
    if len(v) < 253: return np.nan
    h = sorted(v[:-1]); return bisect.bisect_left(h, v[-1]) / len(h) * 100

R = pd.read_csv(C_('risk_engine.csv')).set_index('symbol').tier
cd = json.load(open(C_('core_data.json')))
L_ = cd['list']; iS, iL, iF = L_['cols'].index('סימול'), L_['cols'].index('תווית'), L_['cols'].index('Quality סופי (סקירה)')
label = {r[iS]: r[iL] for r in L_['rows']}; final = {r[iS]: r[iF] for r in L_['rows']}
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
    rows.append(dict(symbol=s, kind='ETF' if s in ETF else 'stock', close=num(C[s].iloc[-1]), chg1=num(chg1[s].iloc[-1]), chg20=num(chg20[s].iloc[-1]),
        SMA200=num(sma[s].iloc[-1]), slope200=num(slope[s].iloc[-1], 5), sma200_rising=rising, DD252=num(dd[s].iloc[-1]), D200=num(d2[s].iloc[-1]),
        Cheap_Score=num(cs, 1), Cheap_Quartile=q, cheap_usable=bool(q and rising), ADR60=num(adr60[s].iloc[-1], 2),
        stop_2xADR60=num(2 * adr60[s].iloc[-1] / 100, 4), Risk_Tier=tier if isinstance(tier, str) else None,
        core_cap=CAP.get(tier) if isinstance(tier, str) else None, Excel_label=None if s in ETF else label.get(s),
        Review_final=None if s in ETF else final.get(s), last_day_complete=s in complete))
out = dict(date=str(last)[:10], built=pd.Timestamp.now('UTC').strftime('%Y-%m-%d %H:%MZ'), history_frozen_to=base_last,
           release=[release_first, release_last], symbols=len(rows), incomplete=sorted(set(C.columns) - complete),
           overlap_mismatch=mismatch, splits=splits, rows=rows)
json.dump(out, open(C_('current_state.json'), 'w'), ensure_ascii=False)
pd.DataFrame(rows).to_csv(C_('current_state_latest.csv'), index=False)
print(f"state {out['date']}: {len(rows)} symbols, incomplete {len(out['incomplete'])}, mismatch {mismatch}, splits {splits}")
if mismatch: sys.exit(2)
