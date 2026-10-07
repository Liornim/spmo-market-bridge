// /xa/* — the data behind /archive-bars, read ONLY from the Supabase archive
// (archive_bars + archive_symbols). Nothing here touches D1, so the page keeps
// working when D1's daily read quota is spent, and nothing here writes.
//
// Every response has the same shape as the legacy route it stands in for
// (/bars/index, /days, /day, /bars/export, /bars/count, /bars/daily,
// /bars/last, /coverage), so the page logic is the legacy page's logic.
//
// Budget: a Worker invocation may make 50 subrequests. One symbol's whole
// history is ~12 pages of 1,000 today; reads stop at MAX_PAGES and say so.

const PAGE = 1000;
const MAX_PAGES = 40;
const SCALE = 10000;

export function makeArchiveRoutes(deps) {
  const { sb, json, H, validSym, isSessionMinute, localDateTime } = deps;

  let idsAt = 0, ids = null, summary = null;
  async function symbolsTable(env) {
    if (ids && Date.now() - idsAt < 60000) return summary;
    const r = await sb(env, 'archive_symbols?select=id,symbol,bars,first_unix,last_unix&order=symbol.asc&limit=10000');
    summary = JSON.parse(r.text);
    ids = {}; summary.forEach(x => { ids[x.symbol] = x.id; });
    idsAt = Date.now();
    return summary;
  }
  async function idOf(env, sym) { await symbolsTable(env); return ids[sym] == null ? null : ids[sym]; }

  // Keyset pagination on (symbol_id, unix): each page is an index range read,
  // where an offset would rescan everything before it.
  async function readRange(env, id, from, to, cols) {
    const out = []; let after = from == null ? null : from - 1, pages = 0, truncated = false;
    for (;;) {
      if (pages >= MAX_PAGES) { truncated = true; break; }
      let q = `archive_bars?select=${cols}&symbol_id=eq.${id}&order=unix.asc&limit=${PAGE}`;
      if (after != null) q += `&unix=gt.${after}`;
      if (to != null) q += `&unix=lte.${to}`;
      const rows = JSON.parse((await sb(env, q)).text);
      pages++;
      for (const r of rows) if (isSessionMinute(+r.unix)) out.push(r);
      if (rows.length < PAGE) break;
      after = rows[rows.length - 1].unix;
    }
    return { rows: out, truncated };
  }
  const decode = (r, sym) => {
    const { date, time } = localDateTime(r.unix);
    return { symbol: sym, unix: r.unix, date, time, open: r.o / SCALE, high: r.h / SCALE,
      low: r.l / SCALE, close: r.c / SCALE, volume: r.v };
  };
  // A trading date's session sits inside one UTC date (13:30Z–21:00Z at most).
  const dayFrom = d => Math.floor(Date.parse(d + 'T00:00:00Z') / 1000);
  const dayTo = d => Math.floor(Date.parse(d + 'T23:59:59Z') / 1000);
  const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  function tradingDays(from, to) {
    if (!validDate(from) || !validDate(to)) return 42;
    let n = 0;
    for (let d = new Date(from + 'T12:00:00Z'); d <= new Date(to + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
      const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++;
    }
    return n;
  }
  const symList = s => Array.from(new Set(String(s || '').toUpperCase().split(/[\s,;]+/).filter(x => validSym(x))));

  async function handle(env, p, url) {
    if (!(env.SUPABASE_URL && env.SUPABASE_KEY)) return json({ error: 'archive not configured (SUPABASE_URL / SUPABASE_KEY)' }, 503);
    const what = p[0], a = p[1] ? decodeURIComponent(p[1]).toUpperCase() : null, b = p[2] || null;
    const sp = url.searchParams;

    if (what === 'index') {
      const t = await symbolsTable(env);
      const withBars = t.filter(x => (x.bars || 0) > 0);
      const newest = Math.max(0, ...withBars.map(x => x.last_unix || 0));
      // "tracked" has no meaning in the archive; the nearest honest stand-in is
      // "still being written": a last bar within three days of the newest.
      const tracked = withBars.filter(x => (x.last_unix || 0) >= newest - 3 * 86400).map(x => x.symbol);
      const symbols = t.map(x => x.symbol);
      return json({ symbols, tracked, archived: symbols, count: symbols.length,
        note: 'archive only (Supabase). tracked = last bar within 3 days of the newest bar in the archive' });
    }

    if (what === 'days' && a && validSym(a)) {
      const id = await idOf(env, a);
      if (id == null) return json({ symbol: a, days: [], d1_days: 0, archive_only: 0 });
      const { rows, truncated } = await readRange(env, id, null, null, 'unix');
      const by = {};
      for (const r of rows) {
        const { date, time } = localDateTime(r.unix);
        const e = by[date] || (by[date] = { date, bars: 0, first: time, last: time, revisions: 0, source: 'archive' });
        e.bars++; if (time < e.first) e.first = time; if (time > e.last) e.last = time;
      }
      const days = Object.values(by).sort((x, y) => (x.date < y.date ? 1 : -1));
      return json({ symbol: a, days, d1_days: 0, archive_only: days.length, truncated });
    }

    if (what === 'day' && a && validSym(a) && validDate(b)) {
      const id = await idOf(env, a);
      const rows = id == null ? [] : (await readRange(env, id, dayFrom(b), dayTo(b), 'unix,o,h,l,c,v')).rows
        .map(r => decode(r, a)).filter(r => r.date === b);
      return json({ symbol: a, date: b, bars: rows.length, source: 'archive', rows },
        200, { 'X-Symbol': a, 'X-Date': b, 'X-Bars': String(rows.length), 'X-Source': 'archive' });
    }

    if (what === 'export' && a && validSym(a)) {
      const from = sp.get('from'), to = sp.get('to');
      const id = await idOf(env, a);
      const got = id == null ? { rows: [], truncated: false }
        : await readRange(env, id, validDate(from) ? dayFrom(from) : null, validDate(to) ? dayTo(to) : null, 'unix,o,h,l,c,v');
      const lines = got.rows.map(r => { const x = decode(r, a);
        return [a, x.date, x.time, x.open, x.high, x.low, x.close, x.volume].join(','); });
      return new Response(['symbol,date,time,open,high,low,close,volume'].concat(lines).join('\n'), { headers: { ...H,
        'Content-Type': 'text/csv; charset=utf-8', 'X-Rows': String(lines.length), 'X-Truncated': String(got.truncated),
        'Content-Disposition': `attachment; filename="${a}_${from || 'all'}_${to || 'all'}.csv"` } });
    }

    if (what === 'count') {
      const syms = symList(sp.get('symbols')), from = sp.get('from'), to = sp.get('to');
      const td = tradingDays(from, to);
      const est = syms.length * td * 390;
      return json({ symbols: syms.length, from, to, d1_rows_exact: null, d1_days: 0, trading_days_in_range: td,
        archive_rows_estimate: est, estimate_total: est, note: 'archive only: symbols x weekdays x 390, an upper bound' });
    }

    if (what === 'daily') {
      const syms = symList(sp.get('symbols')).slice(0, 3), from = sp.get('from'), to = sp.get('to');
      if (!syms.length) return json({ error: 'symbols= is required (one symbol per request; the page loops)' }, 400);
      const out = [];
      for (const s of syms) {
        const id = await idOf(env, s); if (id == null) continue;
        const { rows } = await readRange(env, id, validDate(from) ? dayFrom(from) : null, validDate(to) ? dayTo(to) : null, 'unix,o,h,l,c,v');
        const by = {};
        for (const r of rows) {
          const x = decode(r, s);
          const e = by[x.date];
          if (!e) by[x.date] = { symbol: s, date: x.date, open: x.open, high: x.high, low: x.low, close: x.close,
            volume: x.volume, bars: 1, first: x.time, last: x.time, source: 'minutes', complete: false, provider: null };
          else { e.high = Math.max(e.high, x.high); e.low = Math.min(e.low, x.low); e.close = x.close;
            e.volume += x.volume; e.bars++; e.last = x.time; }
        }
        Object.values(by).forEach(e => { e.complete = e.bars >= 380; out.push(e); });
      }
      out.sort((x, y) => (x.date === y.date ? (x.symbol < y.symbol ? -1 : 1) : (x.date < y.date ? 1 : -1)));
      return json({ rows: out, count: out.length, note: 'archive only: aggregated from stored 1-minute bars' });
    }

    if (what === 'last') {
      const n = Math.max(1, Math.min(390, parseInt(sp.get('n'), 10) || 5));
      const syms = symList(sp.get('symbols')).slice(0, 40);
      const now = Math.floor(Date.now() / 1000);
      const rows = [], short = [], missing = [], age = {}, source = {};
      await symbolsTable(env);
      for (const s of syms) {
        const id = ids[s];
        if (id == null) { missing.push(s); continue; }
        const got = JSON.parse((await sb(env, `archive_bars?select=unix,o,h,l,c,v&symbol_id=eq.${id}&order=unix.desc&limit=${n + 30}`)).text)
          .filter(r => isSessionMinute(+r.unix) && r.unix + 60 <= now).slice(0, n).reverse();
        if (!got.length) { missing.push(s); continue; }
        if (got.length < n) short.push(s);
        got.forEach(r => { const x = decode(r, s); rows.push({ symbol: s, date: x.date, time: x.time, unix: x.unix,
          open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume }); });
        age[s] = now - got[got.length - 1].unix - 60;
        source[s] = 'archive';
      }
      return json({ n, symbols: syms.length, rows, short, missing, age_seconds: age, source,
        read_live: [], live_failed: [], not_reached: [], note: 'archive only; nothing is read live' });
    }

    if (what === 'coverage') {
      const t = await symbolsTable(env);
      const withBars = t.filter(x => (x.bars || 0) > 0);
      const newest = Math.max(0, ...withBars.map(x => x.last_unix || 0));
      const d = u => (u ? localDateTime(u).date : null);
      const symbols = t.map(x => ({ symbol: x.symbol, live_tracked: (x.last_unix || 0) >= newest - 3 * 86400 && (x.bars || 0) > 0,
        in_universe: true, d1_days: 0, d1_bars: 0, archive_days: Math.round((x.bars || 0) / 390 * 10) / 10,
        archive_bars: x.bars == null ? null : x.bars, first: d(x.first_unix), last: d(x.last_unix) }));
      return json({ symbols, count: symbols.length, with_live_bars: 0, with_archive_bars: withBars.length,
        registered_but_empty: t.filter(x => !(x.bars > 0)).map(x => x.symbol),
        archive: 'from archive_symbols summary columns (bars, first_unix, last_unix); days = bars / 390',
        note: 'archive only' });
    }

    // The Opportunity Scanner's latest report, written by the `scan` GitHub
    // workflow to scan/ in the repository. Served from here so the page has one
    // origin; raw.githubusercontent caches for up to ~5 minutes.
    if (what === 'scan') {
      const file = { '': 'latest.json', 'all.csv': 'opportunity_scan_all.csv', 'candidates.csv': 'opportunity_candidates.csv' }[p[1] || ''];
      if (!file) return json({ error: 'unknown scan file', files: ['/xa/scan', '/xa/scan/all.csv', '/xa/scan/candidates.csv'] }, 404);
      const r = await fetch('https://raw.githubusercontent.com/Liornim/spmo-market-bridge/main/scan/' + file, { headers: { 'User-Agent': 'spmo-market-bridge' } });
      if (r.status !== 200) return json({ error: 'scan report not available yet', upstream: r.status }, 503);
      const body = await r.text();
      return new Response(body, { headers: { ...H, 'Content-Type': file.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'application/json',
        ...(file.endsWith('.csv') ? { 'Content-Disposition': `attachment; filename="${file}"` } : {}) } });
    }

    return json({ error: 'unknown archive route', routes: ['/xa/index', '/xa/days/SYM', '/xa/day/SYM/DATE', '/xa/export/SYM?from=&to=',
      '/xa/count?symbols=&from=&to=', '/xa/daily?symbols=SYM&from=&to=', '/xa/last?symbols=&n=', '/xa/coverage'] }, 404);
  }
  return handle;
}
