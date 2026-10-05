# Promotes the 30 most liquid tracked symbols to the live tier, through the
# Worker's own endpoint, and reports the resulting tier split.
import json, urllib.request

W = 'https://spmo-market-bridge.noamharelnim.workers.dev'
LIVE = ['NVDA', 'AAPL', 'MSFT', 'META', 'AMZN', 'GOOGL', 'TSLA', 'AMD', 'AVGO', 'SPY',
        'QQQ', 'SMH', 'TQQQ', 'VOO', 'XLK', 'PLTR', 'MU', 'COIN', 'MRVL', 'SMCI',
        'ARM', 'NFLX', 'JPM', 'ORCL', 'CRM', 'QCOM', 'MSTR', 'INTC', 'SPMO', 'XLY']

# Cloudflare answers 403 to urllib's default user agent, so every call carries a
# normal browser one - the same request a person would make from the page.
def get(path):
    req = urllib.request.Request(W + path, headers={
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())

print('### promoting', len(LIVE), 'symbols to tier=live')
try:
    print(json.dumps(get('/v2/symbols/add/' + ','.join(LIVE) + '?tier=live'))[:400])
except Exception as e:
    print('add failed:', str(e)[:200])

# Everything that is not on the live list goes back to the standard tier: the
# import marked all 118 as live, which is not the agreed split.
print('\n### demoting the rest to tier=standard')
try:
    allsyms = [x['symbol'] for x in get('/v2/symbols')['symbols'] if x['active']]
    rest = [s for s in allsyms if s not in LIVE]
    for i in range(0, len(rest), 25):
        chunk = rest[i:i + 25]
        get('/v2/symbols/add/' + ','.join(chunk) + '?tier=standard')
    print('demoted', len(rest), 'symbols')
except Exception as e:
    print('demote failed:', str(e)[:200])

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
