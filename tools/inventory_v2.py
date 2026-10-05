import json, urllib.request, concurrent.futures
W = 'https://spmo-market-bridge.noamharelnim.workers.dev'
def get(path, timeout=30):
    try:
        with urllib.request.urlopen(W + path, timeout=timeout) as r: return json.loads(r.read().decode())
    except Exception as e: return {'_error': str(e)[:80]}
st = get('/v2/status')
syms = [x['symbol'] for x in (st.get('symbols') or [])]
print(f'V2 tracked symbols: {len(syms)}')
rows = []
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
    for s, d in ex.map(lambda s: (s, get('/v2/days/' + s, 45)), syms):
        R = d.get('rows') or []
        rows.append({'symbol': s, 'days': d.get('days', 0), 'complete': d.get('complete_days', 0),
                     'bars': d.get('total_bars', 0),
                     'missing': sum(r.get('missing', 0) for r in R),
                     'synth': sum(r.get('synthetic') or 0 for r in R),
                     'dup': sum(r.get('duplicates') or 0 for r in R),
                     'first': R[-1]['date'] if R else None, 'last': R[0]['date'] if R else None})
rows.sort(key=lambda r: (-r['bars'], r['symbol']))
print('\nsymbol | days | complete | candles | missing | synthetic | dup | first | last')
for r in rows[:130]:
    print(f"{r['symbol']:<7}| {r['days']:>4} | {r['complete']:>8} | {r['bars']:>7} | {r['missing']:>7} | {r['synth']:>9} | {r['dup']:>3} | {r['first']} | {r['last']}")
print(f"\nTOTAL V2: {len(rows)} symbols | {sum(r['days'] for r in rows)} symbol-days | "
      f"{sum(r['complete'] for r in rows)} complete | {sum(r['bars'] for r in rows):,} candles | "
      f"{sum(r['synth'] for r in rows):,} synthetic | {sum(r['dup'] for r in rows)} duplicates")
