"""Today's regular-session 1-minute bars for every symbol, through the Worker's Yahoo proxy (/xa/yahoo).
Writes core/intraday/<date>.csv (symbol,date,time,open,high,low,close,volume). Used for the daily decision report."""
import json, os, sys, time, datetime as dt, urllib.request
from zoneinfo import ZoneInfo
W = 'https://spmo-market-bridge.noamharelnim.workers.dev'
ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
syms = [r['symbol'] for r in json.load(open(os.path.join(ROOT, 'core', 'current_state.json')))['rows']]
ny = ZoneInfo('America/New_York'); now = dt.datetime.now(ny); day = now.date()
p1 = int(dt.datetime.combine(day, dt.time(9, 30), ny).timestamp()); p2 = int(time.time())
rows, miss = [], []
for s in syms:
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(f'{W}/xa/yahoo/{s}?p1={p1}&p2={p2}', headers={'User-Agent': 'core-intraday'}), timeout=30) as r:
                j = json.loads(r.read())['chart']['result'][0]
            q = j['indicators']['quote'][0]
            for k, ts in enumerate(j.get('timestamp') or []):
                t = dt.datetime.fromtimestamp(ts, ny)
                if q['close'][k] is None or not (dt.time(9, 30) <= t.time() < dt.time(16, 0)): continue
                rows.append(f"{s},{t:%Y-%m-%d},{t:%H:%M},{q['open'][k]},{q['high'][k]},{q['low'][k]},{q['close'][k]},{q['volume'][k] or 0}")
            break
        except Exception as e:
            if i == 2: miss.append(f'{s}: {str(e)[:80]}')
            time.sleep(2)
    time.sleep(0.2)
os.makedirs(os.path.join(ROOT, 'core', 'intraday'), exist_ok=True)
open(os.path.join(ROOT, 'core', 'intraday', f'{day}.csv'), 'w').write('symbol,date,time,open,high,low,close,volume\n' + '\n'.join(rows) + '\n')
json.dump({'fetched': now.strftime('%Y-%m-%d %H:%M ET'), 'rows': len(rows), 'missing': miss}, open(os.path.join(ROOT, 'core', 'intraday', f'{day}.json'), 'w'), indent=1)
print(len(rows), 'rows', len(miss), 'missing', miss[:5])
