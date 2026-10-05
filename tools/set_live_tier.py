# Promotes the 30 most liquid tracked symbols to the live tier, through the
# Worker's own endpoint, and reports the resulting tier split.
import json, urllib.request

W = 'https://spmo-market-bridge.noamharelnim.workers.dev'
LIVE = ['NVDA', 'AAPL', 'MSFT', 'META', 'AMZN', 'GOOGL', 'TSLA', 'AMD', 'AVGO', 'SPY',
        'QQQ', 'SMH', 'TQQQ', 'VOO', 'XLK', 'PLTR', 'MU', 'COIN', 'MRVL', 'SMCI',
        'ARM', 'NFLX', 'JPM', 'ORCL', 'CRM', 'QCOM', 'MSTR', 'INTC', 'SPMO', 'XLY']

def get(path):
    with urllib.request.urlopen(W + path, timeout=60) as r:
        return json.loads(r.read().decode())

print('### promoting', len(LIVE), 'symbols to tier=live')
try:
    print(json.dumps(get('/v2/symbols/add/' + ','.join(LIVE) + '?tier=live'))[:400])
except Exception as e:
    print('add failed:', str(e)[:200])

print('\n### tier split now')
try:
    d = get('/v2/symbols')['symbols']
    act = [x for x in d if x['active']]
    counts = {}
    for x in act:
        counts[x['tier']] = counts.get(x['tier'], 0) + 1
    print('active symbols:', len(act), '| by tier:', counts)
    print('live:', sorted(x['symbol'] for x in act if x['tier'] == 'live'))
except Exception as e:
    print('read failed:', str(e)[:200])
