"""Pull financial statement facts from SEC EDGAR (the filings themselves) for every stock in core/.

For each ticker: https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json, reduced to a fixed set of
concepts. Output core/sec/<TICKER>.json:
  {"ticker","cik","name","taxonomy","fetched",
   "concepts": {key: {"tag": used_tag, "unit": unit,
                      "annual":   [{"start","end","val","form","filed"}],   # ~12-month durations from 10-K/20-F/40-F
                      "quarters": [{"start","end","val","form","filed"}],   # ~3-month durations (Q4 derived = FY - Q1..Q3)
                      "instant":  [{"end","val","form","filed"}]}}}          # balance-sheet points
  plus "ttm": sums of the last 4 quarters for duration concepts, and the latest instant for balance-sheet ones.
SEC asks for a descriptive User-Agent and <= 10 requests/second.
"""
import json, os, sys, time, datetime, urllib.request

UA = os.environ.get('SEC_UA', 'spmo-market-bridge research noamharelnim@gmail.com')
ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
ONLY = set(sys.argv[2].split(',')) if len(sys.argv) > 2 and sys.argv[2] else None
OUT = os.path.join(ROOT, 'core', 'sec'); os.makedirs(OUT, exist_ok=True)

DUR = {  # key: candidate tags in priority order (us-gaap, then ifrs-full)
 'revenue': ['Revenues', 'RevenuesNetOfInterestExpense', 'RevenuesAndOtherIncome', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'Revenue'],
 'operating_income': ['OperatingIncomeLoss', 'ProfitLossFromOperatingActivities'],
 'net_income': ['NetIncomeLoss', 'ProfitLossAttributableToOwnersOfParent', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ProfitLoss'],
 'eps_diluted': ['EarningsPerShareDiluted', 'DilutedEarningsLossPerShare'],
 'shares_diluted': ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfSharesOutstandingDiluted', 'AdjustedWeightedAverageShares'],
 'operating_cash_flow': ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations', 'CashFlowsFromUsedInOperatingActivities'],
 'capex': ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsToAcquireOtherPropertyPlantAndEquipment', 'PaymentsForCapitalImprovements', 'PaymentsToAcquireAndDevelopRealEstate', 'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'],
 'sbc': ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense'],
 'interest_expense': ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt', 'FinanceCosts'],
 'pretax_income': ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic', 'ProfitLossBeforeTax'],
 'dna': ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'Depreciation', 'DepreciationAndAmortisationExpense'],
 'gross_profit': ['GrossProfit'],
 'buybacks': ['PaymentsForRepurchaseOfCommonStock'],
 'dividends': ['PaymentsOfDividendsCommonStock', 'PaymentsOfDividends', 'DividendsPaidClassifiedAsFinancingActivities'],
}
INST = {
 'cash': ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'CashAndCashEquivalents'],
 'short_term_investments': ['ShortTermInvestments', 'MarketableSecuritiesCurrent', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent'],
 'equity': ['StockholdersEquity', 'EquityAttributableToOwnersOfParent'],
 'equity_incl_nci': ['StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'Equity'],
 'long_term_debt': ['LongTermDebt', 'LongTermDebtNoncurrent', 'LongTermBorrowings'],
 'debt_current': ['LongTermDebtCurrent', 'DebtCurrent', 'ShorttermBorrowings'],
 'short_term_borrowings': ['ShortTermBorrowings', 'CommercialPaper'],
 'long_term_debt_noncurrent': ['LongTermDebtNoncurrent'],
 'total_assets': ['Assets'],
 'shares_outstanding': ['CommonStockSharesOutstanding'],
}

# older registrants whose history sits under another CIK (e.g. a new holding company in 2026)
EXTRA_CIK = {'XOM': ['0000034088']}

def merge_facts(a, b):
    for tax, tags in b.items():
        for t, node in tags.items():
            dst = a.setdefault(tax, {}).setdefault(t, {'units': {}})
            for u, arr in node['units'].items(): dst['units'].setdefault(u, []).extend(arr)
    return a

def get(url):
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Encoding': 'identity'})
            with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read())
        except Exception as e:
            if i == 3: raise
            time.sleep(2 * (i + 1))

def days(a, b): return (datetime.date.fromisoformat(b) - datetime.date.fromisoformat(a)).days

def pick(facts, tags, instant):
    """Merge all candidate tags: for each period the highest-priority tag that reports it wins."""
    rows, used, unit0 = [], [], None
    for pr, t in enumerate(tags):
        for tax in ('us-gaap', 'ifrs-full'):
            node = facts.get(tax, {}).get(t)
            if not node: continue
            for unit, arr in node['units'].items():
                if unit0 and unit != unit0: continue
                rs = [dict(x, _p=pr) for x in arr if x.get('form') in ('10-K', '10-Q', '20-F', '40-F', '10-K/A', '10-Q/A', '20-F/A', '6-K')]
                if rs:
                    unit0 = unit0 or unit; rows += rs; used.append(tax + ':' + t); break
    if not rows: return None
    return '+'.join(used), '', unit0, rows

def reduce(rows, instant, additive=True):
    best = {}
    for x in rows:  # keep the latest filing for each period
        k = (x.get('start'), x['end'])
        if k not in best or (x.get('_p', 0), -int(x['filed'].replace('-', ''))) < (best[k].get('_p', 0), -int(best[k]['filed'].replace('-', ''))): best[k] = x
    if instant:
        return {'instant': sorted([{'end': v['end'], 'val': v['val'], 'form': v['form'], 'filed': v['filed']} for (s, e), v in best.items()], key=lambda r: r['end'])}
    ann, qtr = [], []
    for (s, e), v in best.items():
        if not s: continue
        d = days(s, e); r = {'start': s, 'end': e, 'val': v['val'], 'form': v['form'], 'filed': v['filed']}
        if 340 <= d <= 380: ann.append(r)
        elif 80 <= d <= 100: qtr.append(r)
    ann.sort(key=lambda r: r['end']); qtr.sort(key=lambda r: r['end'])
    if not additive:
        return {'annual': ann, 'quarters': qtr}
    # cash-flow statements in 10-Qs are year-to-date only (6 and 9 months): derive the quarter by difference
    have = {q['end'] for q in qtr}
    bystart = {}
    for (s, e), v in best.items():
        if s and 80 <= days(s, e) <= 290: bystart.setdefault(s, []).append((e, v))
    for s, lst in bystart.items():
        lst.sort()
        for (e0, v0), (e1, v1) in zip(lst, lst[1:]):
            if e1 not in have and 80 <= days(e0, e1) <= 100:
                qtr.append({'start': (datetime.date.fromisoformat(e0) + datetime.timedelta(days=1)).isoformat(), 'end': e1,
                            'val': v1['val'] - v0['val'], 'form': 'derived-ytd', 'filed': v1['filed']}); have.add(e1)
    qtr.sort(key=lambda r: r['end'])
    # derive missing Q4 = FY - three quarters inside it (not for per-share values)
    have = {q['end'] for q in qtr}
    for a in ann:
        if a['end'] in have: continue
        inside = [q for q in qtr if q['start'] >= a['start'] and q['end'] < a['end']]
        if len(inside) == 3:
            last_end = max(q['end'] for q in inside)
            qtr.append({'start': (datetime.date.fromisoformat(last_end) + datetime.timedelta(days=1)).isoformat(), 'end': a['end'],
                        'val': a['val'] - sum(q['val'] for q in inside), 'form': 'derived', 'filed': a['filed']})
    qtr.sort(key=lambda r: r['end'])
    return {'annual': ann, 'quarters': qtr}

def main():
    tick = get('https://www.sec.gov/files/company_tickers.json')
    cik = {v['ticker'].upper(): (str(v['cik_str']).zfill(10), v['title']) for v in tick.values()}
    cd = json.load(open(os.path.join(ROOT, 'core', 'core_data.json')))
    syms = [r[0] for r in cd['list']['rows']]
    if ONLY: syms = [s for s in syms if s in ONLY]
    report = {}; global TAGS; TAGS = {}
    for s in syms:
        c = cik.get(s) or cik.get(s.replace('-', '.')) or cik.get(s.replace('-', ''))
        if not c: report[s] = 'no CIK'; continue
        time.sleep(0.15)
        try: f = get(f'https://data.sec.gov/api/xbrl/companyfacts/CIK{c[0]}.json')
        except Exception as e: report[s] = 'fetch failed: ' + str(e)[:80]; continue
        facts = f.get('facts', {})
        for extra in EXTRA_CIK.get(s, []):
            time.sleep(0.15)
            try: facts = merge_facts(facts, get(f'https://data.sec.gov/api/xbrl/companyfacts/CIK{extra}.json').get('facts', {}))
            except Exception: pass
        out = {'ticker': s, 'cik': c[0], 'name': f.get('entityName', c[1]),
            'taxonomy': 'ifrs-full' if 'ifrs-full' in facts and 'us-gaap' not in facts else 'us-gaap',
            'fetched': datetime.datetime.utcnow().strftime('%Y-%m-%d'), 'concepts': {}, 'ttm': {}}
        for key, tags in list(DUR.items()) + list(INST.items()):
            inst = key in INST; p = pick(facts, tags, inst)
            if not p: continue
            tag, tax, unit, rows = p
            red = reduce(rows, inst, additive=key not in ('eps_diluted', 'shares_diluted'))
            # keep 6 years of history
            for k in red: red[k] = [r for r in red[k] if r['end'] >= '2020-01-01']
            out['concepts'][key] = {'tag': tag, 'unit': unit, **red}
            if inst and red['instant']: out['ttm'][key] = red['instant'][-1]['val']
            elif not inst and key not in ('eps_diluted', 'shares_diluted'):
                q = red['quarters'][-4:]
                if len(q) == 4 and days(q[0]['start'], q[-1]['end']) <= 380: out['ttm'][key] = sum(x['val'] for x in q); out['ttm']['ttm_end'] = q[-1]['end']
        json.dump(out, open(os.path.join(OUT, s + '.json'), 'w'), separators=(',', ':'))
        inv = {}
        for tax, tags in facts.items():
            if tax == 'dei': continue
            for t, node in tags.items():
                ends = [x['end'] for u in node['units'].values() for x in u if x.get('form') in ('10-K', '20-F', '40-F')]
                if ends and max(ends) >= '2024-01-01': inv[tax + ':' + t] = max(ends)
        TAGS[s] = sorted(inv)
        report[s] = f"ok {out['taxonomy']} {len(out['concepts'])} concepts"
    json.dump(report, open(os.path.join(OUT, '_report.json'), 'w'), indent=1)
    json.dump(TAGS, open(os.path.join(OUT, '_tags.json'), 'w'), separators=(',', ':'))
    print(json.dumps(report, indent=0)[:4000])

main()
