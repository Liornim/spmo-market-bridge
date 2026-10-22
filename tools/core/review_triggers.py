"""Which stocks need a re-review today (protocol v2, owner's decision 22.10.2026).

A review is re-opened only when something NEW happened since its review_date:
  report   a quarterly report since the review (last_earnings > review_date)
  move     close moved more than 2 x ADR60 x sqrt(sessions) ... simplified: |return since review| > 4 x ADR60 (%)
  analysts >= 2 rating downgrades in 30 days, or next-year EPS consensus cut >= 5% in 30 days
  news     a relevant, non-opinion, negative news item of type legal / management / deal / capital since the review
  weekly   (Sunday) every review older than 7 days gets a "what changed" check
Writes core/review_queue.json and adds review_date / review_triggers to every stock row of core/current_state.json.
Usage: python tools/core/review_triggers.py [--weekly]
"""
import os, sys, json, glob, datetime as dt
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
C_ = lambda *p: os.path.join(ROOT, 'core', *p)
WEEKLY = '--weekly' in sys.argv or dt.date.today().weekday() == 6

st = json.load(open(C_('current_state.json')))
an = json.load(open(C_('analysts_latest.json'))).get('rows', {}) if os.path.exists(C_('analysts_latest.json')) else {}
D = pd.read_csv(C_('daily.csv.gz'))[['symbol', 'date', 'close']]
if os.path.exists(C_('daily_new.csv')):
    D = pd.concat([D, pd.read_csv(C_('daily_new.csv'))[['symbol', 'date', 'close']]]).drop_duplicates(['symbol', 'date'], keep='last')
CL = D.pivot(index='date', columns='symbol', values='close').sort_index()

REV = {}
for f in glob.glob(C_('review', '*.json')):
    try:
        j = json.load(open(f)); REV[j.get('ticker') or os.path.basename(f)[:-5]] = j
    except Exception:
        pass

queue = []
for r in st['rows']:
    s = r['symbol']
    if r.get('kind') == 'ETF' or s not in REV: continue
    rv = REV[s]; rd = rv.get('review_date') or '2026-10-13'
    why = []
    le = r.get('last_earnings')
    if le and le > rd: why.append(f'דוח {le}')
    a = r.get('ADR60')
    if s in CL and a:
        c = CL[s].dropna(); base = c[c.index <= rd]
        if len(base) and len(c):
            ret = c.iloc[-1] / base.iloc[-1] - 1
            if abs(ret) * 100 > 4 * a: why.append(f'תזוזה {ret * 100:+.0f}% מאז הסקירה')
    x = an.get(s) or {}
    # only analyst moves AFTER the review count (a review already saw what came before it)
    downs = [c for c in (x.get('_recent') or []) if c.get('action') == 'down' and (c.get('date') or '') > rd]
    if len(downs) >= 2: why.append(f"{len(downs)} הורדות המלצה מאז הסקירה")
    recent_review = (dt.date.today() - dt.date.fromisoformat(rd)).days < 30
    if not recent_review and x.get('eps_ny') and x.get('eps_ny_30d') and x['eps_ny'] / x['eps_ny_30d'] - 1 <= -0.05:
        why.append(f"תחזית רווח שנה הבאה {(x['eps_ny'] / x['eps_ny_30d'] - 1) * 100:+.0f}% ב־30 יום")
    bad = [n for n in (x.get('_news') or []) if n.get('rel') and not n.get('opinion') and not n.get('dup')
           and n.get('etype') in ('legal', 'management', 'deal', 'capital') and n.get('sent') == 'neg' and (n.get('time') or '')[:10] > rd]
    if bad: why.append('חדשות מהותיות רעות: ' + bad[0]['title'][:80])
    if WEEKLY and not why and (dt.date.today() - dt.date.fromisoformat(rd)).days >= 7: why.append('בדיקה שבועית')
    r['review_date'] = rd
    r['review_triggers'] = why
    if why: queue.append(dict(symbol=s, review_date=rd, final=rv.get('final_quality'), reasons=why))

json.dump(st, open(C_('current_state.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
out = dict(built=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%MZ'), state_date=st.get('date'), weekly=WEEKLY,
           n=len(queue), queue=sorted(queue, key=lambda q: (q['reasons'] == ['בדיקה שבועית'], q['symbol'])))
json.dump(out, open(C_('review_queue.json'), 'w'), ensure_ascii=False, indent=1)
print('review queue:', len(queue), [q['symbol'] for q in queue])
