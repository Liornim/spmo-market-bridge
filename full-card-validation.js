  // ---- FULL CARD VALIDATION -----------------------------------------------
  //
  // A SECOND export, deliberately kept on its own code path. The existing Live
  // Validation export is not touched: it keeps its own builder, its own text
  // function, its own button and its own filename, and a regression test pins
  // its section list so a shared-helper change cannot alter it silently.
  //
  // This one answers a different question. Live Validation asks "is Trader V2
  // right"; this asks "does the whole card hold together" — both systems, the
  // levels each one used, and above all WHERE each probability level came
  // from. The BRK-B case turned on a level that was correct for what it
  // represented and wrong for how it was used, and no export made that visible.
  //
  // Everything is READ from state the page already computed. Nothing is
  // refetched and no decision is recalculated. The one thing this export does
  // derive is diagnostic flags, which exist only in the file.

  function fvSide(level, px) {
    if (level == null || px == null) return '—';
    if (Math.abs(level - px) < 1e-9) return 'AT';
    return level > px ? 'ABOVE' : 'BELOW';
  }

  // The BRANCH that produced each probability level, read from the same objects
  // the card used rather than guessed backwards from the number. layers.cjs
  // picks them as:
  //   upper = T.resistance ? T.resistance.price : (P.zone ? P.zone[1] : dayHigh)
  //   lower = T.support    ? T.support.price    : (P.invalidation ?? dayLow)
  function fvLevelSource(which, T, P, b) {
    if (which === 'upper') {
      if (T && T.resistance) return { role: 'resistance', type: 'tactical',
        field: 'T.resistance.price', value: T.resistance.price, fallbackReason: null };
      if (P && P.zone) return { role: 'entry_zone_upper', type: 'execution_plan_fallback',
        field: 'P.zone[1]', value: P.zone[1], fallbackReason: 'T.resistance was null' };
      return { role: 'day_high', type: 'bar_fallback', field: 'b.dayHigh',
        value: b && b.dayHigh, fallbackReason: 'T.resistance and P.zone were null' };
    }
    if (T && T.support) return { role: 'support', type: 'tactical',
      field: 'T.support.price', value: T.support.price, fallbackReason: null };
    if (P && P.invalidation != null) return { role: 'invalidation', type: 'execution_plan_fallback',
      field: 'P.invalidation', value: P.invalidation, fallbackReason: 'T.support was null' };
    return { role: 'day_low', type: 'bar_fallback', field: 'b.dayLow',
      value: b && b.dayLow, fallbackReason: 'T.support and P.invalidation were null' };
  }

  function fvBuild(sym, st) {
    var r = st && st.row, snap = st && st.snap, v2 = r && r.v2;
    var A = st && st.A, b = A && A.state && A.state.bar;
    var T = snap && snap.tactical, P = snap && snap.plan;
    if (!T && A) { try { T = tactical(A); } catch (e) { T = null; } }
    var praw = (snap && snap.probabilityRaw) || null;
    var px = praw && praw.price != null ? praw.price : (b && b.close);
    var up = fvLevelSource('upper', T, P, b), lo = fvLevelSource('lower', T, P, b);
    var upV = praw && praw.upper != null ? praw.upper : up.value;
    var loV = praw && praw.lower != null ? praw.lower : lo.value;

    var W = [];
    if (praw && praw.bracketed === false) W.push('PRODUCTION_NOT_BRACKETED');
    if (praw && praw.samSideOrdering) W.push('PRODUCTION_LEVELS_SAME_SIDE');
    if (upV != null && px != null && upV < px) W.push('PRODUCTION_UPPER_BELOW_PRICE');
    if (loV != null && px != null && loV > px) W.push('PRODUCTION_LOWER_ABOVE_PRICE');
    if (praw && (praw.up == null || praw.confidence === 0)) W.push('PRODUCTION_PROBABILITY_SUPPRESSED');
    if (snap && snap.valid === false) W.push('PRODUCTION_MODEL_INCONSISTENT');
    var vBar = v2 && v2.barTime, pBar = b && b.time;
    if (vBar && pBar && vBar !== pBar) W.push('V2_PRODUCTION_SNAPSHOT_TIME_MISMATCH');
    var cov = lvCoverage((st && st.rows) || []);
    if (cov.dupCount) W.push('DUPLICATE_1M_ROWS');
    if (cov.missingCount) W.push('MISSING_1M_ROWS');
    if (v2 && v2.ready && v2.engineState && v2.userStatus === 'READY' && !v2.tradeEnabled)
      W.push('DISPLAY_INTERNAL_STATE_MISMATCH');
    if (st && (st.fresh === 'STALE' || st.fresh === 'DELAYED')) W.push('DATA_' + st.fresh);

    return { sym: sym, st: st, r: r, snap: snap, v2: v2, A: A, b: b, T: T, P: P,
      praw: praw, px: px, up: up, lo: lo, upV: upV, loV: loV, cov: cov, warnings: W };
  }

  function fvSymbolText(sym, st) {
    var f = fvBuild(sym, st);
    var v2 = f.v2, praw = f.praw, snap = f.snap, b = f.b;
    var L = [];
    var kv = function (k, v) { L.push(k + ': ' + (v == null || v === '' ? '—' : v)); };
    var sec = function (t) { L.push(''); L.push('─── ' + t + ' ───'); L.push(''); };

    L.push(''); L.push('==================================================');
    L.push('SYMBOL: ' + sym);
    L.push('==================================================');

    if (f.warnings.length) {
      sec('FULL VALIDATION WARNINGS');
      f.warnings.forEach(function (w) { L.push('  ** ' + w); });
    }

    sec('1. TIME / DATA SNAPSHOT');
    kv('Symbol', sym);
    kv('ET time', lvETNow());
    kv('Data through', v2 && v2.lastBar);
    kv('Freshness', st && st.fresh);
    kv('Stale seconds', st && st.stale);
    kv('Current displayed price', lvNum(b && b.close));
    kv('Last closed candle timestamp', v2 && v2.barTime);
    kv('V2 snapshot bar timestamp', v2 && v2.barTime);
    kv('Production snapshot bar timestamp', b && b.time);
    if (v2 && b && v2.barTime && v2.barTime !== b.time)
      L.push('** WARNING: V2 and Production evaluated DIFFERENT bars');

    sec('2. TRADER V2 — FULL');
    // Reuse the existing builder so this section cannot drift from the other export.
    var lb = lvBuild(sym, st, f.r, snap, (st && st.rows) || []);
    lb.sections.forEach(function (s2) {
      if (s2[0] !== 'TRADER V2') return;
      s2[1].forEach(function (p) { kv(p[0], p[1]); });
    });
    kv('user-facing status', v2 && v2.userStatus ? (U_TXT[v2.userStatus] || v2.userStatus) : '—');

    sec('3. PRODUCTION TRADER — FULL');
    var prod = f.r && f.r.prod;
    kv('Production user-facing status', prod && prod.status);
    kv('Production raw/internal state', snap && snap.status);
    kv('Production instruction', prod && prod.why);
    kv('Production setup score', prod && prod.score);
    kv('Production plan state', f.P && f.P.state);
    kv('Production current price used', lvNum(b && b.close));
    kv('Production data-through time', b && b.time);
    kv('Production freshness', snap && snap.freshness);
    var pr = f.r && f.r.pressure;
    kv('buyers %', pr && pr.buyPct);
    kv('sellers %', pr && pr.sellPct);
    kv('buyer/seller trend', pr && pr.buyersTrend);
    kv('support statement', f.T && f.T.support ? f.T.support.why : null);
    kv('resistance statement', f.T && f.T.resistance ? f.T.resistance.why : null);
    kv('today trend', snap && snap.structure);
    kv('momentum', snap && snap.momentum);
    kv('VWAP relationship', b && b.vwap != null && b.close != null
      ? (b.close >= b.vwap ? 'above VWAP' : 'below VWAP') + ' (' + lvNum(b.vwap) + ')' : null);
    kv('relative volume', b && b.volx != null ? b.volx + '×' : null);
    kv('whatNow', snap && snap.whatNow && snap.whatNow.next);

    sec('4. PRODUCTION PROBABILITY QUESTION');
    if (!praw) { L.push('Probability question: (no probabilityRaw on the stored snapshot)'); }
    else {
      L.push('Probability question:');
      L.push('  "Will price reach ' + lvNum(f.upV) + ' before ' + lvNum(f.loV) + '?"');
      L.push('');
      kv('px', lvNum(f.px));
      kv('upper', lvNum(f.upV));
      kv('lower', lvNum(f.loV));
      kv('bracketed', praw.bracketed === true ? 'true' : 'false');
      kv('sameSideOrdering', praw.samSideOrdering ? 'true' : 'false');
      kv('validQuestion', praw.bracketed === true && !praw.notDirectional ? 'true' : 'false');
      kv('probability', praw.up == null ? 'null' : praw.up);
      kv('probabilitySuppressed', praw.up == null ? 'YES' : 'NO');
      kv('suppressionReason', (praw.why || []).join(' | '));
      kv('side', praw.side);
      L.push('');
      kv('upper_value', lvNum(f.upV));
      kv('upper_role', f.up.role);
      kv('upper_source_type', f.up.type);
      kv('upper_source_field', f.up.field);
      kv('upper_fallback_reason', f.up.fallbackReason);
      kv('upper_side_vs_price', fvSide(f.upV, f.px));
      L.push('');
      kv('lower_value', lvNum(f.loV));
      kv('lower_role', f.lo.role);
      kv('lower_source_type', f.lo.type);
      kv('lower_source_field', f.lo.field);
      kv('lower_fallback_reason', f.lo.fallbackReason);
      kv('lower_side_vs_price', fvSide(f.loV, f.px));
    }

    sec('5. PRODUCTION TACTICAL LEVELS');
    ['support', 'resistance'].forEach(function (k) {
      var o = f.T && f.T[k];
      L.push(k + ':');
      if (!o) { L.push('  (null)'); return; }
      L.push('  price: ' + lvNum(o.price) + '  kind: ' + (o.kind || '—') +
        '  weight: ' + (o.weight == null ? '—' : o.weight));
      L.push('  why: ' + (o.why || '—'));
      L.push('  distance from price: ' + lvNum(o.price - f.px) +
        '   side: ' + fvSide(o.price, f.px));
    });
    L.push('');
    kv('fallback candidate P.zone', f.P && f.P.zone ? JSON.stringify(f.P.zone) : null);
    kv('fallback candidate P.invalidation', lvNum(f.P && f.P.invalidation));
    kv('fallback candidate dayHigh', lvNum(b && b.dayHigh));
    kv('fallback candidate dayLow', lvNum(b && b.dayLow));

    sec('6. PRODUCTION EXECUTION PLAN');
    if (!f.P) L.push('(no plan on the stored snapshot)');
    else ['state', 'kind', 'action', 'headline', 'entry', 'zone', 'stop', 'invalidation',
      'target', 't1', 't2', 'rr', 'rrOk', 'support', 'resistance', 'short'].forEach(function (k) {
        if (f.P[k] === undefined) return;
        kv('P.' + k, typeof f.P[k] === 'object' ? JSON.stringify(f.P[k]) : f.P[k]);
      });

    sec('7. PRODUCTION CONSISTENCY / VALIDATION');
    var inconsistent = snap && snap.valid === false;
    kv('modelInconsistent', inconsistent ? 'YES' : 'NO');
    kv('bracketed', praw ? (praw.bracketed === true ? 'true' : 'false') : '—');
    kv('sameSideOrdering', praw ? (praw.samSideOrdering ? 'true' : 'false') : '—');
    kv('invalidProbabilityQuestion', praw && praw.bracketed === false ? 'true' : 'false');
    if (inconsistent) {
      kv('triggeredBy', praw && praw.bracketed === false
        ? 'probability-bracket-validator' : 'snapshot self-check');
      L.push('reason:');
      ((snap.violations || []).filter(function (x) { return x.severity === 'block'; }))
        .forEach(function (x) { L.push('  ' + (x.code || '') + ': ' + (x.text || '')); });
      if (praw && praw.bracketed === false)
        L.push('  lower=' + lvNum(f.loV) + ' and upper=' + lvNum(f.upV) +
          ' are both ' + fvSide(f.upV, f.px) + ' px=' + lvNum(f.px));
    }
    L.push('why[]:');
    ((praw && praw.why) || []).forEach(function (w) { L.push('  ' + w); });
    ((snap && snap.violations) || []).forEach(function (x) {
      L.push('  [' + (x.severity || '') + '] ' + (x.code || '') + ' ' + (x.text || '')); });

    sec('8. SOURCE COMPARISON');
    L.push('These systems are allowed to calculate differently. Differences are');
    L.push('shown to be visible, not asserted to be wrong.');
    L.push('');
    var ind = v2 && v2.ind;
    var cmp = function (label, a, c) {
      L.push('  ' + label.padEnd(18) + 'V2 ' + String(a == null ? '—' : a).padEnd(14) +
        'Production ' + (c == null ? '—' : c)); };
    cmp('price', lvNum(v2 && v2.price), lvNum(b && b.close));
    cmp('VWAP', lvNum(ind && ind.vwap), lvNum(b && b.vwap));
    cmp('EMA9', lvNum(ind && ind.ema9), lvNum(b && b.ema9));
    cmp('EMA20', lvNum(ind && ind.ema20), lvNum(b && b.ema20));
    cmp('ATR', lvNum(ind && ind.atr), lvNum(b && (b.atr20 || b.avgRange)));
    cmp('relative volume', ind && ind.relVol != null ? lvNum(ind.relVol) : null,
      b && b.volx != null ? b.volx : null);
    cmp('data-through', v2 && v2.barTime, b && b.time);

    sec('9. SESSION DATA');
    lb.sections.forEach(function (s2) {
      if (s2[0] !== 'SESSION DATA') return;
      s2[1].forEach(function (p) { kv(p[0], p[1]); });
    });

    sec('10. DATA COVERAGE');
    var raw = ((st && st.rows) || []).filter(function (x) { return x.time >= '09:30' && x.time <= '15:59'; });
    lb.sections.forEach(function (s2) {
      if (s2[0] !== 'DATA COVERAGE') return;
      s2[1].forEach(function (p) { kv(p[0], p[1]); });
    });
    kv('RAW ROW COUNT', raw.length);
    kv('UNIQUE MINUTE COUNT', f.cov.unique);
    if (f.cov.dupCount) {
      L.push('');
      L.push('** DUPLICATE ROWS PRESENT — not cleaned for this export **');
      L.push('   ' + f.cov.dups.join(', '));
    }

    sec('11. LAST 20 CLOSED 1M CANDLES');
    L.push('symbol,date,time,open,high,low,close,volume');
    if (lb.last20.length) lb.last20.forEach(function (x) {
      L.push([sym, x.date, x.time, x.open, x.high, x.low, x.close, x.volume].join(','));
    }); else L.push('(no closed candles)');

    sec('12. CARD TEXT — EXACT VISIBLE COPY');
    kv('Trader V2 headline/status', v2 && v2.userStatus ? (U_TXT[v2.userStatus] || '') : '—');
    kv('Trader V2 instruction', v2 && v2.why);
    kv('Trader V2 צריך לקרות', v2 && v2.requirement ? v2.requirement.join(' · ') : null);
    kv('Production headline/status', prod && prod.status);
    kv('Production main instruction', prod && prod.why);
    kv('Production probability question', praw
      ? 'האם המחיר מגיע ל-' + lvNum(f.upV) + ' לפני ' + lvNum(f.loV) : null);
    kv('Production inconsistency message', inconsistent ? 'מצב המודל לא עקבי' : null);
    kv('Production למה text', ((praw && praw.why) || []).join(' | '));

    return L.join('\n');
  }

  function fvAllText() {
    var now = new Date();
    var syms = symbols.filter(function (s) { return store[s]; }).slice().sort();
    var uc = {}, rc = {};
    LV_ORDER.forEach(function (k) { uc[k] = 0; });
    syms.forEach(function (s) {
      var u = v2UserBucket(store[s]);
      uc[U_TXT[u] || u] = (uc[U_TXT[u] || u] || 0) + 1;
      var raw = store[s].row && store[s].row.v2 && store[s].row.v2.engineState;
      if (raw) rc[raw] = (rc[raw] || 0) + 1;
    });
    var mk = marketCtxFor(syms[0] || 'SPY') || {};
    var H = ['=== TRADER V2 · FULL CARD VALIDATION — ALL SYMBOLS ===', '',
      'Export time ET: ' + lvETNow(),
      'Export time local: ' + now.toLocaleString(),
      'App build: ' + ((qs('.build') && qs('.build').textContent) || '—'),
      'Trader V2 version: v192 (frozen)',
      'Production Trader build: ' + ((qs('.build') && qs('.build').textContent) || '—') +
        ' (same bundle; Production has no separate version stamp)',
      'Total symbols: ' + syms.length, ''];
    H.push('Market context as shown in the UI:');
    ['SPY', 'QQQ', 'SMH', 'XLK', 'XLC', 'XLY', 'XLF'].forEach(function (e) {
      var o = (mk && (mk[e] || (mk.etfs && mk.etfs[e]))) || null;
      H.push('  ' + e + ': ' + (o ? ((o.vwapSide || (o.close != null && o.vwap != null
        ? (o.close >= o.vwap ? 'above VWAP' : 'below VWAP') : '—'))) : '—'));
    });
    H.push('  overall market regime: ' + ((mk && (mk.label || mk.regime)) || '—'));
    H.push('');
    H.push('User-facing status counts:');
    ['מוכן לכניסה', 'קרוב לכניסה', 'מעקב', 'בעסקה', 'לא עכשיו', 'אין נתונים'].forEach(function (k) {
      H.push('  ' + k + ': ' + (uc[k] || 0)); });
    H.push('');
    H.push('Raw V2 engine state counts:');
    Object.keys(rc).sort().forEach(function (k) { H.push('  ' + k + ': ' + rc[k]); });
    if (!Object.keys(rc).length) H.push('  (none available)');
    H.push('');
    H.push('Every symbol is exported exactly as its card stands now. Nothing was');
    H.push('refetched and no decision was recalculated, so "Data through" may');
    H.push('differ between symbols — that difference is preserved deliberately.');

    var body = syms.map(function (s) { return fvSymbolText(s, store[s]); });
    return H.join('\n') + '\n' + body.join('\n') + '\n\n=== END FULL CARD VALIDATION ===\n';
  }

  function fvAllDownload() {
    if (!symbols.filter(function (s) { return store[s]; }).length) { toast('אין מניות טעונות'); return; }
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric',
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date());
    var o = {}; p.forEach(function (x) { o[x.type] = x.value; });
    var name = 'full-card-validation-' + o.year + '-' + o.month + '-' + o.day + '-' + o.hour + o.minute + '-ET.txt';
    var blob = new Blob([fvAllText()], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
    toast('ירד: ' + name);
  }
