"""Out-of-sample test of Kronos (pre-trained candle model, github.com/shiyu-coder/Kronos) on daily US bars.

Each forecast sees only candles up to the close of day t. Every sampled future path is kept (not only the mean),
so the claim "most paths agree -> trending, high-confidence" can be tested. One output row per (symbol, day).
Usage: python kronos_eval.py BARS_CSV_GZ WEIGHTS_DIR KRONOS_REPO START END SHARD NSHARDS OUT
Env: MODEL (small|mini), LOOK (candles of context), NS (sampled paths), SYMS (space separated)
"""
import sys, os, time, inspect
import numpy as np, pandas as pd, torch

BARS, WDIR, REPO, START, END, SHARD, NSH, OUT = sys.argv[1:9]
SHARD, NSH = int(SHARD), int(NSH)
MODEL = os.environ.get('MODEL', 'small'); LOOK = int(os.environ.get('LOOK', 400)); NS = int(os.environ.get('NS', 16)); PRED = 5
SYMS = os.environ['SYMS'].split()
sys.path.insert(0, REPO)
import model.kronos as K
from model import Kronos, KronosTokenizer
torch.set_num_threads(os.cpu_count()); torch.manual_seed(SHARD); np.random.seed(SHARD)

src = inspect.getsource(K.auto_regressive_inference).replace('preds = np.mean(preds, axis=1)', 'pass')
exec(src.replace('def auto_regressive_inference', 'def ari_paths'), K.__dict__)
tok = KronosTokenizer.from_pretrained(f'{WDIR}/Kronos-Tokenizer-' + ('base' if MODEL == 'small' else '2k')).eval()
mdl = Kronos.from_pretrained(f'{WDIR}/Kronos-{MODEL}').eval()
MAXC = 512 if MODEL == 'small' else 2048

b = pd.read_csv(BARS, usecols=['symbol', 'date', 'open', 'high', 'low', 'close', 'volume'])
b = b[b.symbol.isin(SYMS)]; b['date'] = pd.to_datetime(b.date)
F = {k: b.pivot(index='date', columns='symbol', values=c).sort_index() for k, c in
     zip('ohlcv', ['open', 'high', 'low', 'close', 'volume'])}
C = F['c']; dates = C.index
days = [d for d in dates[(dates >= START) & (dates <= END)]]
days = days[SHARD::NSH]

def stamps(ix):
    s = pd.Series(ix)
    return np.stack([s.dt.minute, s.dt.hour, s.dt.weekday, s.dt.day, s.dt.month], 1).astype(np.float32)

rows = []; t0 = time.time()
for d in days:
    i = dates.get_loc(d)
    if i + PRED >= len(dates) or i < LOOK: continue
    xs, meta = [], []
    for s in SYMS:
        if s not in C.columns: continue
        x = np.stack([F[k][s].iloc[i - LOOK + 1:i + 1].values for k in 'ohlcv'], 1).astype(np.float64)
        if np.isnan(x).any(): continue
        x = np.concatenate([x, (x[:, 4] * x[:, :4].mean(1))[:, None]], 1).astype(np.float32)
        mu, sd = x.mean(0), x.std(0)
        xs.append(np.clip((x - mu) / (sd + 1e-5), -5, 5)); meta.append((s, mu, sd))
    if not xs: continue
    xst = np.repeat(stamps(dates[i - LOOK + 1:i + 1])[None], len(xs), 0)
    yst = np.repeat(stamps(pd.bdate_range(d + pd.Timedelta(days=1), periods=PRED))[None], len(xs), 0)
    with torch.no_grad():
        P = K.ari_paths(tok, mdl, torch.tensor(np.stack(xs)), torch.tensor(xst), torch.tensor(yst), MAXC, PRED,
                        5, 1.0, 0, 0.9, NS, False)[:, :, -PRED:, :]
    for j, (s, mu, sd) in enumerate(meta):
        pc = P[j, :, :, 3] * (sd[3] + 1e-5) + mu[3]
        c0 = C[s].iloc[i]; fut = C[s].iloc[i + 1:i + PRED + 1].values
        r = pc / c0 - 1
        rows.append({'sym': s, 'date': d, 'c0': c0, **{f'pred{h + 1}_mean': r[:, h].mean() for h in range(PRED)},
                     **{f'pred{h + 1}_up_share': (r[:, h] > 0).mean() for h in range(PRED)},
                     'pred1_sd': r[:, 0].std(), 'pred5_sd': r[:, -1].std(),
                     **{f'act{h + 1}': fut[h] / c0 - 1 for h in range(PRED)}})
    print(d.date(), len(meta), f'{time.time() - t0:.0f}s', flush=True)
pd.DataFrame(rows).to_parquet(OUT)
print('done', len(rows), time.time() - t0)
