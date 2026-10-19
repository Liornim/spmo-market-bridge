"""Shared helpers for the research-data jobs (tools/research/*.py).

Every job writes its files under OUT (default /tmp/research_out) and the workflow uploads them to the
GitHub Release `research-data`. Nothing here touches the live system: no D1, no Supabase, no KV.
"""
import gzip, io, json, os, sys, time, urllib.request, urllib.error

OUT = os.environ.get('RESEARCH_OUT', '/tmp/research_out')
os.makedirs(OUT, exist_ok=True)
WORKER = 'https://spmo-market-bridge.noamharelnim.workers.dev'
BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
SEC_UA = os.environ.get('SEC_UA', 'spmo-market-bridge research noamharelnim@gmail.com')


def fetch(url, headers=None, data=None, tries=4, timeout=60, method=None):
    """GET/POST with retries and backoff. Returns bytes; raises after the last try."""
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={'User-Agent': BROWSER_UA, **(headers or {})}, method=method)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                b = r.read()
                if r.headers.get('Content-Encoding') == 'gzip': b = gzip.decompress(b)
                return b
        except urllib.error.HTTPError as e:
            last = f'HTTP {e.code}'
            if e.code in (400, 401, 403, 404): break       # not transient
        except Exception as e:
            last = str(e)[:120]
        time.sleep(2 * (i + 1))
    raise RuntimeError(f'{url[:120]} -> {last}')


def fetch_json(url, **kw):
    return json.loads(fetch(url, **kw))


def write_gz_csv(name, df):
    p = os.path.join(OUT, name)
    df.to_csv(p, index=False, compression='gzip')
    print(f'wrote {name}: {len(df)} rows', flush=True)
    return p


def report(name, obj):
    """Per-job coverage report, uploaded next to the data so a reader sees what is missing."""
    p = os.path.join(OUT, f'_report_{name}.json')
    json.dump(obj, open(p, 'w'), indent=1, default=str)
    print(json.dumps(obj, default=str)[:3000], flush=True)


def symbols_file(path):
    return [s.strip() for s in open(path) if s.strip() and not s.startswith('#')]
