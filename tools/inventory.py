# Full inventory: how many symbols, how many days each, how many candles each,
# in both the legacy stores (D1 + Supabase archive) and V2.
import json, os, urllib.request, concurrent.futures

W = 'https://spmo-market-bridge.noamharelnim.workers.dev'

def get(path, timeout=30):
    try:
        with urllib.request.urlopen(W + path, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {'_error': str(e)[:80]}

cov = get('/coverage')
syms = cov.get('symbols') or []
print(f'symbols in /coverage: {len(syms)}  (live tracked: {cov.get("with_live_bars")}, with archive: {cov.get("with_archive_bars")})')

def days_for(s):
    return s, get('/days/' + s, timeout=45)

rows = []
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
    for s, d in ex.map(days_for, [x['symbol'] for x in syms]):
        D = d.get('days') or []
        d1 = [r for r in D if r.get('source') != 'archive']
        ar = [r for r in D if r.get('source') == 'archive']
        full = [r for r in D if (r.get('bars') or 0) >= 390]
        rows.append({
            'symbol': s, 'days': len(D), 'd1_days': len(d1), 'archive_days': len(ar),
            'bars': sum(r.get('bars') or 0 for r in D),
            'full_days': len(full),
            'first': D[-1]['date'] if D else None, 'last': D[0]['date'] if D else None,
        })

rows.sort(key=lambda r: (-r['days'], r['symbol']))
print('\nsymbol | days | of them D1 | archive | full(390+) | candles | first | last')
for r in rows:
    print(f"{r['symbol']:<7}| {r['days']:>4} | {r['d1_days']:>10} | {r['archive_days']:>7} | {r['full_days']:>10} | {r['bars']:>7} | {r['first']} | {r['last']}")

tot_days = sum(r['days'] for r in rows)
tot_bars = sum(r['bars'] for r in rows)
tot_full = sum(r['full_days'] for r in rows)
print(f"\nTOTAL: {len(rows)} symbols | {tot_days} symbol-days | {tot_full} of them complete ({tot_full*100//max(1,tot_days)}%) | {tot_bars:,} candles")
print('symbols with zero days:', [r['symbol'] for r in rows if r['days'] == 0] or 'none')
print('symbols with fewer than 10 days:', [(r['symbol'], r['days']) for r in rows if 0 < r['days'] < 10] or 'none')
