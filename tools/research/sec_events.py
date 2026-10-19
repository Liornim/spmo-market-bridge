"""Event data straight from SEC EDGAR (free, public; SEC asks for a contact User-Agent and <= 10 req/s).

1. earnings_dates.csv.gz — every 8-K carrying Item 2.02 ("Results of Operations") per company since 2009:
   symbol,cik,filed,accepted (UTC timestamp, tells pre-market vs after-close),report_date,items.
   This is the earnings release date itself, so PEAD can be measured from the real announcement.
2. insider.csv.gz — open-market insider purchases (P) and sales (S) from SEC's quarterly Form 3/4/5 data sets
   (structured, every filer, 2016Q1 onward): symbol,filed,trans_date,code,shares,price,value,owner,relation,is_officer,is_director.
3. buyback/dividend announcements are not in these sets (they come from the 10-Q cash-flow lines in sec facts).
"""
import io, os, sys, time, zipfile, json, datetime as dt
import pandas as pd
from common import OUT, SEC_UA, fetch, fetch_json, report, symbols_file

H = {'User-Agent': SEC_UA, 'Accept-Encoding': 'identity'}
what = sys.argv[1] if len(sys.argv) > 1 else 'all'
syms = symbols_file(os.path.join(OUT, 'universe_symbols.txt'))
tick = fetch_json('https://www.sec.gov/files/company_tickers.json', headers=H)
cik = {v['ticker'].upper(): str(v['cik_str']).zfill(10) for v in tick.values()}
look = lambda s: cik.get(s) or cik.get(s.replace('-', '.')) or cik.get(s.replace('-', ''))

if what in ('all', 'earnings'):
    rows, rep = [], {}
    for s in syms:
        c = look(s)
        if not c: rep[s] = 'no CIK (ETF, delisted or renamed)'; continue
        try:
            j = fetch_json(f'https://data.sec.gov/submissions/CIK{c}.json', headers=H)
            blocks = [j['filings']['recent']]
            for f in j['filings'].get('files', []):
                time.sleep(0.12); blocks.append(fetch_json('https://data.sec.gov/submissions/' + f['name'], headers=H))
            n = 0
            for b in blocks:
                for form, fd, acc, items, rd in zip(b['form'], b['filingDate'], b['acceptanceDateTime'], b['items'], b['reportDate']):
                    if form in ('8-K', '8-K/A') and '2.02' in (items or '') and fd >= '2009-01-01':
                        rows.append((s, c, fd, acc, rd, items, form)); n += 1
            rep[s] = f'ok {n} item-2.02 filings'
        except Exception as e:
            rep[s] = 'fail ' + str(e)[:80]
        time.sleep(0.12)
    pd.DataFrame(rows, columns=['symbol', 'cik', 'filed', 'accepted', 'report_date', 'items', 'form']) \
      .sort_values(['symbol', 'filed']).to_csv(os.path.join(OUT, 'earnings_dates.csv.gz'), index=False, compression='gzip')
    report('earnings_dates', {'symbols': len(syms), 'with_rows': sum(1 for v in rep.values() if v.startswith('ok') and not v.startswith('ok 0')),
                              'detail': rep})

if what in ('all', 'insider'):
    want = {s.replace('-', '.') for s in syms} | set(syms)
    out, rep = [], {}
    today = dt.date.today()
    for y in range(2016, today.year + 1):
        for q in range(1, 5):
            if dt.date(y, 3 * q - 2, 1) > today: break
            url = f'https://www.sec.gov/files/structureddata/data/form-345-data-sets/{y}q{q}_form345.zip'
            try:
                b = fetch(url, headers=H, timeout=180, tries=3)
            except Exception as e:
                rep[f'{y}q{q}'] = 'fail ' + str(e)[-90:]; continue
            z = zipfile.ZipFile(io.BytesIO(b))
            rd = lambda n: pd.read_csv(z.open([x for x in z.namelist() if x.upper().endswith(n)][0]), sep='\t', dtype=str, low_memory=False)
            sub = rd('SUBMISSION.TSV')[['ACCESSION_NUMBER', 'FILING_DATE', 'ISSUERTRADINGSYMBOL', 'DOCUMENT_TYPE']]
            sub = sub[sub.ISSUERTRADINGSYMBOL.str.upper().isin(want) & sub.DOCUMENT_TYPE.isin(['4', '4/A'])]
            tr = rd('NONDERIV_TRANS.TSV')
            tr = tr[tr.ACCESSION_NUMBER.isin(sub.ACCESSION_NUMBER) & tr.TRANS_CODE.isin(['P', 'S'])]
            own = rd('REPORTINGOWNER.TSV')[['ACCESSION_NUMBER', 'RPTOWNERNAME', 'RPTOWNER_RELATIONSHIP', 'RPTOWNER_TITLE']] \
                    .drop_duplicates('ACCESSION_NUMBER')
            m = tr.merge(sub, on='ACCESSION_NUMBER').merge(own, on='ACCESSION_NUMBER', how='left')
            m = m.rename(columns={'ISSUERTRADINGSYMBOL': 'symbol', 'FILING_DATE': 'filed', 'TRANS_DATE': 'trans_date',
                                  'TRANS_CODE': 'code', 'TRANS_SHARES': 'shares', 'TRANS_PRICEPERSHARE': 'price',
                                  'RPTOWNERNAME': 'owner', 'RPTOWNER_RELATIONSHIP': 'relation', 'RPTOWNER_TITLE': 'title',
                                  'TRANS_ACQUIRED_DISP_CD': 'acq_disp', 'DIRECT_INDIRECT_OWNERSHIP': 'direct'})
            keep = ['symbol', 'filed', 'trans_date', 'code', 'acq_disp', 'shares', 'price', 'owner', 'relation', 'title', 'direct', 'ACCESSION_NUMBER']
            m = m[[c for c in keep if c in m.columns]]
            m['symbol'] = m.symbol.str.upper().str.replace('.', '-', regex=False)
            out.append(m); rep[f'{y}q{q}'] = f'ok {len(m)} P/S rows'
            print(f'{y}q{q}: {len(m)}', flush=True)
            time.sleep(0.5)
    df = pd.concat(out) if out else pd.DataFrame()
    df.to_csv(os.path.join(OUT, 'insider.csv.gz'), index=False, compression='gzip')
    report('insider', rep)
