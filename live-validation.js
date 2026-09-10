// ---- LIVE VALIDATION ----------------------------------------------------
//
// A QA export, not another analysis screen. Every value here is READ from state
// the page already computed for something else: the v192 view model behind the
// Trader V2 card, the snapshot behind the analysis pack, the market-context
// object, and the same loaded candle array the copy-candles menu uses. Nothing
// is recalculated, no request is made, and v192 is not touched.
//
// The one exception, and it is stated on screen: duplicate timestamps. Nothing
// in the app counts them today, and a duplicate is exactly the kind of fault
// this tab exists to catch, so it is derived here over the already-loaded array
// as an integrity check.

var lvOpen = false;

function lvNum(v, d) {
  if (v == null || v === '' || (typeof v === 'number' && isNaN(v))) return '—';
  return typeof v === 'number' ? v.toFixed(d == null ? 2 : d) : String(v);
}
function lvHM(m) {
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
function lvETNow() {
  var p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date());
  var o = {}; p.forEach(function (x) { o[x.type] = x.value; });
  return o.hour + ':' + o.minute + ':' + o.second + ' ET';
}

// Coverage over the already-loaded rows, the same shape SECTION 4b reports.
function lvCoverage(rows) {
  var out = { first: '—', last: '—', expected: 0, unique: 0, pct: '—',
    missingCount: 0, missing: [], dupCount: 0, dups: [], continuous: 'YES' };
  var rth = (rows || []).filter(function (r) { return r.time >= '09:30' && r.time <= '15:59'; });
  if (!rth.length) { out.continuous = '—'; return out; }
  var t = function (s) { return +s.slice(0, 2) * 60 + +s.slice(3, 5); };
  out.first = rth[0].time; out.last = rth[rth.length - 1].time;
  out.expected = t(out.last) - t(out.first) + 1;
  var seen = {}, dup = {};
  rth.forEach(function (r) { if (seen[r.time]) dup[r.time] = (dup[r.time] || 1) + 1; seen[r.time] = 1; });
  out.unique = Object.keys(seen).length;
  for (var m = t(out.first); m <= t(out.last); m++) if (!seen[lvHM(m)]) out.missing.push(lvHM(m));
  out.missingCount = out.missing.length;
  out.dups = Object.keys(dup).map(function (k) { return k + '×' + dup[k]; });
  out.dupCount = out.dups.length;
  out.pct = out.expected ? (out.unique / out.expected * 100).toFixed(1) + '%' : '—';
  out.continuous = out.missingCount === 0 && out.dupCount === 0 ? 'YES' : 'NO';
  return out;
}

// One ETF's line, read from whatever the market-context object already holds.
function lvEtf(mk, key) {
  var o = (mk && (mk[key] || (mk.etfs && mk.etfs[key]))) || null;
  if (!o) return { price: '—', vwap: '—', ema: '—', trend: '—' };
  return { price: lvNum(o.price != null ? o.price : o.close),
    vwap: lvNum(o.vwap),
    ema: o.emaState || (o.ema9 != null && o.ema20 != null ? (o.ema9 > o.ema20 ? 'EMA9>EMA20' : 'EMA9<EMA20') : '—'),
    trend: o.trend || o.label || '—' };
}

// Build the whole export as ordered sections, so the screen and the clipboard
// can never drift apart: both render from this one object.
function lvBuild(sym, st, r, snap, rows) {
  var v2 = r && r.v2, plan = v2 && v2.plan, ind = v2 && v2.ind;
  var closed = rows || [];
  var lastC = closed.length ? closed[closed.length - 1] : null;
  var rth = closed.filter(function (x) { return x.time >= '09:30' && x.time <= '15:59'; });
  var hi = null, lo = null, vol = 0, up = 0, dn = 0;
  rth.forEach(function (x) {
    if (!hi || x.high > hi.high) hi = x;
    if (!lo || x.low < lo.low) lo = x;
    vol += x.volume || 0;
    if (x.close >= x.open) up++; else dn++;
  });
  var cov = lvCoverage(closed);
  var mk = marketCtxFor(sym) || {};
  var execRR = plan && v2.price != null && plan.stop != null && plan.t1 != null && (v2.price - plan.stop)
    ? (plan.t1 - v2.price) / (v2.price - plan.stop) : null;

  var S = [];
  S.push(['TIME', [
    ['Snapshot time', snap && snap.calculated_at ? String(snap.calculated_at) : (lastC ? lastC.date + ' ' + lastC.time : '—')],
    ['ET time', lvETNow()],
    ['Data through', lastC ? lastC.time : '—'],
    ['Freshness', (st && st.fresh) || '—']]]);

  S.push(['TRADER V2', v2 && v2.ready ? [
    ['Status', (STATUS_TXT[v2.status] || v2.status)],
    ['Main instruction', v2.why || '—'],
    ['What needs to happen', v2.next || '—'],
    ['Trend', (ind && ind.trend) || '—'],
    ['Quality', v2.quality || '—'],
    ['Family', v2.family || '—'],
    ['Engine state', v2.engineState || '—'],
    ['Display state', v2.status],
    ['Score', v2.score == null ? '—' : v2.score + '/10'],
    ['Required score', String(CFG.readyScore)],
    ['SetupId', v2.setupId || '—'],
    ['Setup age', v2.age == null ? '—' : v2.age + ' bars'],
    ['Trigger', lvNum(plan && plan.entry)],
    ['Entry', lvNum(plan && plan.entry)],
    ['Stop', lvNum(plan && plan.stop)],
    ['Invalidation', lvNum(plan && plan.invalidation)],
    ['T1', lvNum(plan && plan.t1)],
    ['T2', lvNum(plan && plan.t2)],
    ['Risk/share', plan && plan.stop != null && v2.price != null ? lvNum(v2.price - plan.stop) : '—'],
    ['Plan RR', lvNum(plan && plan.rr)],
    ['Executable RR', lvNum(execRR)],
    ['Chase ATR', lvNum(v2.ext)],
    ['VWAP', lvNum(ind && ind.vwap)],
    ['EMA9', lvNum(ind && ind.ema9)],
    ['EMA20', lvNum(ind && ind.ema20)],
    ['ATR', lvNum(ind && ind.atr)],
    ['Relative volume', ind && ind.relVol != null ? lvNum(ind.relVol) + '×' : '—'],
    ['Still required', (v2.waiting && v2.waiting.length ? v2.waiting.join(' | ') : '—')],
    ['Warnings', [v2.staleGap ? v2.staleGap.missing.length + ' minutes missing earlier in session' : '',
      v2.openMissing ? 'session starts ' + v2.openMissing + ', not 09:30' : ''].filter(Boolean).join(' · ') || '—']
  ] : [
    ['Status', v2 && v2.dataGap ? 'DATA GAP' : v2 && v2.error ? 'ENGINE ERROR' : v2 && v2.warmup ? 'WARMING UP' : 'NO V2 STATE'],
    ['Reason', v2 && v2.error ? v2.error
      : v2 && v2.dataGap ? 'missing within the indicator window: ' + (v2.recent || v2.missing || []).join(', ')
      : v2 && v2.warmup ? v2.closedBars + '/' + v2.need + ' closed bars' : '—'],
    ['Closed bars', v2 && v2.closedBars != null ? String(v2.closedBars) : '—']]]);

  S.push(['SESSION DATA', [
    ['Current displayed price', lvNum(lastC && lastC.close)],
    ['Last closed candle time', lastC ? lastC.time : '—'],
    ['Last closed OHLCV', lastC ? [lvNum(lastC.open), lvNum(lastC.high), lvNum(lastC.low), lvNum(lastC.close), String(lastC.volume)].join(' / ') : '—'],
    ['Day high', lvNum(hi && hi.high)],
    ['Day high time', hi ? hi.time : '—'],
    ['Day low', lvNum(lo && lo.low)],
    ['Day low time', lo ? lo.time : '—'],
    ['Number of candles', String(rth.length)],
    ['Bull candles', String(up)],
    ['Bear candles', String(dn)],
    ['Total session volume', String(vol)]]]);

  S.push(['DATA COVERAGE', [
    ['First regular bar', cov.first],
    ['Last regular bar', cov.last],
    ['Expected minutes', String(cov.expected)],
    ['Received unique minutes', String(cov.unique)],
    ['Coverage %', cov.pct],
    ['Missing count', String(cov.missingCount)],
    ['Missing minutes', cov.missing.length ? cov.missing.join(', ') : '—'],
    ['Duplicate count', String(cov.dupCount)],
    ['Duplicate timestamps', cov.dups.length ? cov.dups.join(', ') : '—'],
    ['Series continuous', cov.continuous]]]);

  S.push(['INDICATORS', [
    ['VWAP', lvNum(ind && ind.vwap)],
    ['EMA9', lvNum(ind && ind.ema9)],
    ['EMA20', lvNum(ind && ind.ema20)],
    ['EMA state', ind && ind.ema9 != null && ind.ema20 != null ? (ind.ema9 > ind.ema20 ? 'EMA9 > EMA20' : 'EMA9 < EMA20') : '—'],
    ['ATR / avg candle range', lvNum(ind && ind.atr)],
    ['Relative volume', ind && ind.relVol != null ? lvNum(ind.relVol) + '×' : '—'],
    ['Time-of-day normalised volume', snap && snap.volTod != null ? lvNum(snap.volTod) + '×' : '—'],
    ['Source', 'Trader V2 v192 (values the engine itself consumed)']]]);

  var spy = lvEtf(mk, 'SPY'), qqq = lvEtf(mk, 'QQQ');
  var secKey = (mk && (mk.sector || mk.sectorSymbol)) || null;
  var sec = secKey ? lvEtf(mk, secKey) : { price: '—', vwap: '—', ema: '—', trend: '—' };
  S.push(['MARKET CONTEXT', [
    ['Market regime', (mk && (mk.label || mk.regime)) || '—'],
    ['SPY', 'price ' + spy.price + ' · VWAP ' + spy.vwap + ' · ' + spy.ema + ' · ' + spy.trend],
    ['QQQ', 'price ' + qqq.price + ' · VWAP ' + qqq.vwap + ' · ' + qqq.ema + ' · ' + qqq.trend],
    ['Sector ETF', (secKey || '—') + ' · price ' + sec.price + ' · VWAP ' + sec.vwap + ' · ' + sec.ema + ' · ' + sec.trend],
    ['Market supports symbol', (mk && (mk.supports != null ? String(mk.supports) : mk.support)) || '—']]]);

  var last20 = closed.slice(-20);
  return { sections: S, last20: last20, symbol: sym };
}

function lvText(b) {
  var L = ['=== LIVE VALIDATION · ' + b.symbol + ' ==='];
  b.sections.forEach(function (s) {
    L.push(''); L.push(s[0]);
    s[1].forEach(function (kv) { L.push(kv[0] + ': ' + kv[1]); });
  });
  L.push(''); L.push('LAST 20 CLOSED 1M CANDLES');
  L.push('symbol,date,time,open,high,low,close,volume');
  b.last20.forEach(function (r) {
    L.push([b.symbol, r.date, r.time, r.open, r.high, r.low, r.close, r.volume].join(','));
  });
  L.push(''); L.push('=== END LIVE VALIDATION ===');
  return L.join('\n');
}

function drawLive() {
  var st = store[openSym], p = qs('#panel');
  var r = st && st.row, snap = st && st.snap;
  var rows = (st && st.rows) || [];
  var b = lvBuild(openSym, st, r, snap, rows);
  var h = '<div class="grab"></div>' +
    '<div class="dhead"><div><div class="sym" style="font-size:19px">LIVE VALIDATION · ' + openSym + '</div>' +
    '<div class="px num">' + lvETNow() + '</div></div><div class="spacer"></div>' +
    '<button type="button" class="mini-btn" id="lvCopy">העתק Live Validation</button>' +
    '<button type="button" class="mini-btn" id="lvBack">חזרה</button></div>';
  b.sections.forEach(function (s) {
    h += '<div class="sec2">' + s[0] + '</div><div class="lvtab">' +
      s[1].map(function (kv) {
        return '<div class="lvk">' + kv[0] + '</div><div class="lvv">' + kv[1] + '</div>';
      }).join('') + '</div>';
  });
  h += '<div class="sec2">LAST 20 CLOSED 1M CANDLES</div>' +
    '<div class="lvcsv">symbol,date,time,open,high,low,close,volume<br>' +
    b.last20.map(function (x) {
      return [openSym, x.date, x.time, x.open, x.high, x.low, x.close, x.volume].join(',');
    }).join('<br>') + '</div>' +
    '<div class="v2cmp" style="margin-top:10px">כל ערך כאן נקרא ממצב שהדף כבר חישב — מודל V2, ' +
    'התמונה של חבילת הניתוח, הקשר השוק ומערך הנרות הטעון. לא בוצע חישוב מחדש ולא נשלחה בקשה. ' +
    '<b>חריג יחיד: ספירת חותמות כפולות</b>, שאינה מחושבת בשום מקום אחר ונגזרת כאן כבדיקת שלמות.</div>';
  p.innerHTML = h; p.scrollTop = 0;
  qs('#lvBack').onclick = function () { lvOpen = false; drawDetail(); };
  qs('#lvCopy').onclick = function () {
    var txt = lvText(b);
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(
      function () { toast('Live Validation הועתק'); },
      function () {
        var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta);
        ta.select(); try { document.execCommand('copy'); toast('Live Validation הועתק'); }
        catch (e) { toast('העתקה נכשלה'); } document.body.removeChild(ta);
      });
  };
}
