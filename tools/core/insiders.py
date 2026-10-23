"""Insider open-market trades (SEC Form 4) for every stock, last 90 days -> core/insiders.json.

Source: SEC EDGAR only (data.sec.gov submissions + the Form 4 XML in www.sec.gov/Archives), same rule as the
financial statements. Information only: the frozen method does not use it.

Counted:
  buys  = transaction code P (open-market or private purchase), acquired (A), non-derivative
  sells = transaction code S (open-market or private sale), disposed (D), non-derivative
  planned sells = sells on a Form 4 that ticks the Rule 10b5-1 box (field present on filings since 2023)
Not counted: grants and awards (A), option exercises (M), tax withholding (F), gifts (G) and every other code.
Window: transaction date within the last 90 calendar days.
Foreign private issuers (20-F/40-F filers, e.g. TSM, ASML) do not file Form 4 -> status NOT APPLICABLE.

Usage: python tools/core/insiders.py            -> all stocks, writes core/insiders.json
       python tools/core/insiders.py JPM NVDA   -> test: prints those symbols, writes nothing
"""
import datetime as dt, json, os, sys, time, urllib.request, xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UA = os.environ.get('SEC_UA', 'spmo-market-bridge research noamharelnim@gmail.com')
DAYS = 90
ONLY = [a.upper() for a in sys.argv[1:]]


def get(url, as_json=True):
    for i in range(4):
        try:
            time.sleep(0.12)   # SEC asks for <= 10 requests per second
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Encoding': 'identity'})
            with urllib.request.urlopen(req, timeout=60) as r:
                b = r.read()
                return json.loads(b) if as_json else b
        except Exception:
            if i == 3: raise
            time.sleep(2 * (i + 1))


def txt(node, path):
    """value of <path><value>..</value></path> or <path>..</path>; namespace-free"""
    if node is None: return None
    e = node.find(path)
    if e is None: return None
    v = e.find('value')
    s = (v.text if v is not None else e.text) or ''
    return s.strip() or None


def num(s):
    try: return float(s)
    except (TypeError, ValueError): return None


def parse_form4(xml_bytes, issuer_cik=None):
    root = ET.fromstring(xml_bytes)
    # a company's submissions also list Form 4s it files as an OWNER of another issuer (Berkshire, Goldman,
    # Blackstone funds...): only trades in the company's own stock count
    if issuer_cik and int(txt(root, 'issuer/issuerCik') or 0) != int(issuer_cik): return []
    own = root.find('reportingOwner')
    name = txt(own, 'reportingOwnerId/rptOwnerName') or '?'
    rel = own.find('reportingOwnerRelationship') if own is not None else None
    role = []
    if rel is not None:
        if (txt(rel, 'isDirector') or '') in ('1', 'true'): role.append('Director')
        if (txt(rel, 'isOfficer') or '') in ('1', 'true'): role.append(txt(rel, 'officerTitle') or 'Officer')
        if (txt(rel, 'isTenPercentOwner') or '') in ('1', 'true'): role.append('10% owner')
    plan = (txt(root, 'aff10b5One') or '').lower() in ('1', 'true')
    out = []
    for t in root.findall('nonDerivativeTable/nonDerivativeTransaction'):
        code = txt(t, 'transactionCoding/transactionCode')
        ad = txt(t, 'transactionAmounts/transactionAcquiredDisposedCode')
        if code not in ('P', 'S'): continue
        if (code == 'P' and ad != 'A') or (code == 'S' and ad != 'D'): continue
        sh, px = num(txt(t, 'transactionAmounts/transactionShares')), num(txt(t, 'transactionAmounts/transactionPricePerShare'))
        out.append({'code': code, 'date': (txt(t, 'transactionDate') or '')[:10], 'shares': sh, 'price': px,
                    'value': (sh * px) if sh and px else None, 'name': name, 'role': ', '.join(role), 'plan': plan})
    return out


def one(sym, cik, foreign, since):
    if foreign:
        return {'status': 'NOT APPLICABLE', 'note': 'חברה זרה (20-F): לא מגישה Form 4'}
    sub = get(f'https://data.sec.gov/submissions/CIK{cik}.json')
    rec = (sub.get('filings') or {}).get('recent') or {}
    forms, fdates, accs, docs = rec.get('form', []), rec.get('filingDate', []), rec.get('accessionNumber', []), rec.get('primaryDocument', [])
    tx, n4, errs = [], 0, 0
    for f, fd, acc, doc in zip(forms, fdates, accs, docs):
        if f not in ('4', '4/A') or fd < since: continue
        raw = doc.split('/', 1)[1] if doc.startswith('xsl') and '/' in doc else doc
        url = f'https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc.replace("-", "")}/{raw}'
        try:
            b = get(url, as_json=False)
            if int(txt(ET.fromstring(b), 'issuer/issuerCik') or 0) == int(cik): n4 += 1
            for x in parse_form4(b, cik):
                if x['date'] >= since: x['filed'] = fd; x['url'] = url; tx.append(x)
        except Exception:
            errs += 1
    buys = [x for x in tx if x['code'] == 'P']
    sells = [x for x in tx if x['code'] == 'S']
    sv = lambda L: round(sum(x['value'] or 0 for x in L))
    return {'status': 'OK' if not errs else 'PARTIAL', 'form4_filings': n4, 'parse_errors': errs,
            'buys_n': len(buys), 'buys_value': sv(buys), 'buyers': sorted({x['name'] for x in buys}),
            'last_buy': max((x['date'] for x in buys), default=None),
            'sells_n': len(sells), 'sells_value': sv(sells), 'sellers': len({x['name'] for x in sells}),
            'planned_sells_n': sum(1 for x in sells if x['plan']),
            'unplanned_sells_value': round(sum(x['value'] or 0 for x in sells if not x['plan'])),
            'buys': sorted(buys, key=lambda x: x['date'], reverse=True)[:10]}


def main():
    today = dt.date.today()
    since = (today - dt.timedelta(days=DAYS)).isoformat()
    cd = json.load(open(os.path.join(ROOT, 'core', 'core_data.json')))
    syms = [r[0] for r in cd['list']['rows']]
    if ONLY: syms = [s for s in syms if s in ONLY] or ONLY
    rows = {}
    for s in syms:
        try:
            f = json.load(open(os.path.join(ROOT, 'core', 'sec', s + '.json')))
            cik, foreign = f['cik'], f.get('taxonomy') == 'ifrs-full'
        except Exception:
            rows[s] = {'status': 'NO CIK'}; continue
        try:
            rows[s] = one(s, cik, foreign, since)
        except Exception as e:
            rows[s] = {'status': 'ERROR', 'note': str(e)[:200]}
        if ONLY: print(s, json.dumps(rows[s], ensure_ascii=False)[:1500])
    ok = sum(1 for r in rows.values() if r.get('status') in ('OK', 'PARTIAL', 'NOT APPLICABLE'))
    print(f'{ok}/{len(rows)} ok · buyers in {sum(1 for r in rows.values() if r.get("buys_n"))} stocks')
    if ONLY: return
    if ok < len(rows) * 0.8: sys.exit('too many failures, not writing')
    json.dump({'date': today.isoformat(), 'since': since, 'days': DAYS,
               'built': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%MZ'),
               'source': 'SEC EDGAR Form 4 (submissions + filing XML)', 'rows': rows},
              open(os.path.join(ROOT, 'core', 'insiders.json'), 'w'), ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main()
