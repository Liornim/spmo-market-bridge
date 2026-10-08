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

// New York date/time without Intl per row. Intl.formatToParts costs ~15us a call;
// at 11,700 rows that alone was most of a 30-day export's CPU, and the Workers
// free plan allows 10 ms of CPU per request -- the downloads came back 503. The
// offset only changes between EDT and EST, so it is looked up once per UTC day.
const _off = new Map();
const _fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false });
function etOffset(u) {
  const day = Math.floor(u / 86400);
  let o = _off.get(day);
  if (o === undefined) { const h = +_fmt.format(new Date((day * 86400 + 16 * 3600) * 1000)) % 24; o = (h - 16) * 3600; _off.set(day, o); }
  return o;
}
const p2 = n => (n < 10 ? '0' : '') + n;
export function etDateTime(u) {
  const l = u + etOffset(u), d = new Date(l * 1000);
  return { date: d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()), time: p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) };
}
const etSession = u => { if (u % 60 !== 0) return false; const m = Math.floor(((u + etOffset(u)) % 86400) / 60); return m >= 570 && m < 960; };

export function makeArchiveRoutes(deps) {
  const { sb, json, H, validSym, authorized, ghOn, gh } = deps;
  const localDateTime = etDateTime, isSessionMinute = etSession;

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

  async function handle(env, p, url, req) {
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

    // One page (up to 1,000 rows) of a symbol's archive, passed through as the
    // CSV PostgREST produces -- never parsed here. Decoding 11,700 rows in the
    // Worker cost 30-200 ms of CPU against the free plan's 10 ms, and long
    // downloads came back 503. The page pages through this and decodes itself.
    // ?from=&to= (ET dates)  ?after=<unix> (keyset)  ?cols=unix (just timestamps)
    if (what === 'raw' && a && validSym(a)) {
      const id = await idOf(env, a);
      const cols = sp.get('cols') === 'unix' ? 'unix' : 'unix,o,h,l,c,v';
      if (id == null) return new Response(cols + '\n', { headers: { ...H, 'Content-Type': 'text/csv; charset=utf-8' } });
      const from = sp.get('from'), to = sp.get('to'), after = parseInt(sp.get('after'), 10);
      // ?ext=1: the pre/after-market archive (archive_ext_bars), same layout
      let q = `${sp.get('ext') === '1' ? 'archive_ext_bars' : 'archive_bars'}?select=${cols}&symbol_id=eq.${id}&order=unix.asc&limit=${PAGE}`;
      if (Number.isFinite(after)) q += `&unix=gt.${after}`;
      if (validDate(from)) q += `&unix=gte.${dayFrom(from)}`;
      if (validDate(to)) q += `&unix=lte.${dayTo(to)}`;
      const r = await sb(env, q, { headers: { Accept: 'text/csv' } });
      return new Response(r.text, { headers: { ...H, 'Content-Type': 'text/csv; charset=utf-8' } });
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
      // ?ext=1: exact pre-market and after-market row counts from archive_ext_bars
      // (they have no fixed size per day), one OR-of-ranges count each
      if (sp.get('ext') === '1') {
        await symbolsTable(env);
        const idl = syms.map(x => ids[x]).filter(x => x != null);
        const today = new Date().toISOString().slice(0, 10);
        const f0 = validDate(from) ? from : new Date(Date.now() - 62 * 86400000).toISOString().slice(0, 10);
        const t0 = validDate(to) ? to : today;
        const hf = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false });
        const pre = [], post = [];
        for (let d = new Date(f0 + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= t0; d.setUTCDate(d.getUTCDate() + 1)) {
          const w = d.getUTCDay(); if (w === 0 || w === 6) continue;
          const noon = Math.floor(d.getTime() / 1000), off = ((+hf.format(new Date(noon * 1000))) % 24 - 12) * 3600;
          const mid = noon - 12 * 3600 - off;                       // 00:00 New York
          pre.push(`and(unix.gte.${mid + 4 * 3600},unix.lt.${mid + 9.5 * 3600})`);
          post.push(`and(unix.gte.${mid + 16 * 3600},unix.lt.${mid + 20 * 3600})`);
        }
        const cnt = async ranges => {
          if (!idl.length || !ranges.length) return 0;
          const r = await sb(env, `archive_ext_bars?select=unix&symbol_id=in.(${idl.join(',')})&or=(${ranges.join(',')})`, { method: 'HEAD', headers: { Prefer: 'count=exact', Range: '0-0' } });
          return parseInt(((r.headers && r.headers.get && r.headers.get('content-range')) || '').split('/')[1], 10) || 0;
        };
        const [p1, p2] = await Promise.all([cnt(pre), cnt(post)]);
        return json({ symbols: syms.length, from: f0, to: t0, trading_days_in_range: td, archive_rows_estimate: est, estimate_total: est, pre_rows: p1, after_rows: p2 });
      }
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
    // Run a scan now: commit a new .github/scan-request.json, which starts the
    // `scan` workflow. Same key as every other write; at most one request per 4 minutes.
    if (what === 'scan' && p[1] === 'run') {
      if (!authorized(req, url, env)) return json({ error: 'API key required' }, 401);
      if (!ghOn(env)) return json({ error: 'GH_TOKEN / GH_REPO not configured on the Worker' }, 503);
      const path = '/contents/.github/scan-request.json';
      const cur = await gh(env, path + '?ref=main');
      let prev = null; try { prev = JSON.parse(atob((cur.json.content || '').replace(/\n/g, ''))).requested_at; } catch (e) { /* first request */ }
      if (prev && Date.now() - Date.parse(prev) < 4 * 60 * 1000) return json({ ok: true, already: true, requested_at: prev });
      const requested_at = new Date().toISOString();
      const body = { message: 'scan: requested from the Opportunity Scanner tab', branch: 'main',
        content: btoa(JSON.stringify({ requested_at, by: 'archive-bars page' }) + '\n') };
      if (cur.status === 200 && cur.json.sha) body.sha = cur.json.sha;
      const put = await gh(env, path, { method: 'PUT', body: JSON.stringify(body) });
      if (put.status >= 300) return json({ error: 'could not start the scan', github: put.status }, 502);
      return json({ ok: true, requested_at, note: 'the scan takes about 3 minutes' });
    }

    // "Update DB" tab: run the nightly build now, for all symbols or a chosen
    // list (new symbols are registered after Yahoo confirms they have 1m data),
    // N days back (1..30 — Yahoo keeps 30 days of minutes). The request is a
    // commit of .github/nightly-request.json, which starts the `nightly` workflow.
    if (what === 'update' && p[1] === 'run') {
      if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
      if (!authorized(req, url, env)) return json({ error: 'API key required' }, 401);
      if (!ghOn(env)) return json({ error: 'GH_TOKEN / GH_REPO not configured on the Worker' }, 503);
      let inp = {}; try { inp = await req.json(); } catch (e) { /* empty body = all symbols, 30 days */ }
      const raw = [].concat(inp.symbols || []).join(',').toUpperCase().split(/[\s,;]+/).filter(Boolean);
      const bad = raw.filter(s => !/^[A-Z0-9.\-]{1,10}$/.test(s));
      if (bad.length) return json({ error: 'invalid symbols', bad }, 400);
      const symbols = Array.from(new Set(raw));
      if (symbols.length > 500) return json({ error: 'at most 500 symbols per request' }, 400);
      const days = Math.min(30, Math.max(1, Math.round(+inp.days || 30)));
      const path = '/contents/.github/nightly-request.json';
      const cur = await gh(env, path + '?ref=main');
      let prev = null; try { prev = JSON.parse(atob((cur.json.content || '').replace(/\n/g, ''))); } catch (e) { /* first request */ }
      if (prev && prev.requested_at && Date.now() - Date.parse(prev.requested_at) < 10 * 60 * 1000)
        return json({ ok: false, error: 'an update was requested less than 10 minutes ago', request: prev }, 429);
      const request = { request_id: 'u' + Date.now().toString(36), requested_at: new Date().toISOString(), symbols, days, by: 'archive-bars page' };
      const body = { message: `update db: ${symbols.length ? symbols.length + ' symbols' : 'all symbols'}, ${days} days`, branch: 'main',
        content: btoa(JSON.stringify(request) + '\n') };
      if (cur.status === 200 && cur.json.sha) body.sha = cur.json.sha;
      const put = await gh(env, path, { method: 'PUT', body: JSON.stringify(body) });
      if (put.status >= 300) return json({ error: 'could not start the update', github: put.status }, 502);
      return json({ ok: true, request });
    }

    // Preview for the "Update DB" tab: Yahoo's 1-minute answer for one window,
    // passed through unparsed (the free plan's 10 ms CPU cannot parse it); the
    // page decodes it and compares it with /xa/raw — nothing is written.
    if (what === 'yahoo' && a && validSym(a)) {
      const now = Math.floor(Date.now() / 1000), p1 = parseInt(sp.get('p1'), 10), p2 = parseInt(sp.get('p2'), 10);
      if (!Number.isFinite(p1) || !Number.isFinite(p2) || p2 <= p1 || p2 - p1 > 8 * 86400 || p1 < now - 31 * 86400 || p2 > now + 3600)
        return json({ error: 'p1/p2: a window of at most 8 days inside the last 31 days' }, 400);
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(a)}?interval=1m&includePrePost=${sp.get('prepost') === '1' ? 'true' : 'false'}&period1=${p1}&period2=${p2}`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Accept: 'application/json' } });
      return new Response(await r.text(), { status: r.status, headers: { ...H, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }

    // Alpaca (SIP: all US exchanges) 1-minute bars, 15 minutes delayed on the free
    // plan, passed through unparsed for the page's pre/after-market view.
    // /xa/alpaca?symbols=A,B&start=<unix>&page_token=..  (end is always now-15m)
    if (what === 'alpaca') {
      if (!env.ALPACA_KEY_ID || !env.ALPACA_SECRET_KEY) return json({ error: 'Alpaca keys are not set on the Worker' }, 503);
      const syms = String(sp.get('symbols') || '').toUpperCase().split(/[\s,;]+/).filter(x => validSym(x)).slice(0, 30);
      const now = Math.floor(Date.now() / 1000), start = parseInt(sp.get('start'), 10);
      if (!syms.length || !Number.isFinite(start) || start < now - 4 * 86400 || start >= now) return json({ error: 'symbols= and start= (unix, within 4 days) required' }, 400);
      const end = Math.floor((now - 15 * 60) / 60) * 60;
      const tok = sp.get('page_token');
      const u = `https://data.alpaca.markets/v2/stocks/bars?symbols=${encodeURIComponent(syms.map(x => x.replace(/-/g, '.')).join(','))}&timeframe=1Min&feed=sip&adjustment=raw&limit=10000` +
        `&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}` + (tok ? `&page_token=${encodeURIComponent(tok)}` : '');
      const r = await fetch(u, { headers: { 'APCA-API-KEY-ID': env.ALPACA_KEY_ID, 'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY } });
      return new Response(await r.text(), { status: r.status, headers: { ...H, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Alpaca-End': String(end) } });
    }

    if (what === 'update' && p[1] === 'status') {
      const rawFile = async f => {
        const r = ghOn(env)
          ? await fetch('https://api.github.com/repos/' + env.GH_REPO + '/contents/' + f + '?ref=main', { headers: { Authorization: 'Bearer ' + env.GH_TOKEN, Accept: 'application/vnd.github.raw', 'User-Agent': 'bars-vault' } })
          : await fetch('https://raw.githubusercontent.com/Liornim/spmo-market-bridge/main/' + f, { headers: { 'User-Agent': 'spmo-market-bridge' } });
        return r.status === 200 ? r.text() : null;
      };
      const [rq, report] = await Promise.all([rawFile('.github/nightly-request.json'), rawFile('.github/audit/LATEST.md')]);
      let request = null; try { request = JSON.parse(rq); } catch (e) { /* none yet */ }
      const done = !!(request && report && report.includes(request.request_id));
      const verdict = report ? ((report.split('\n')[0].match(/(PASS|FAIL)/) || [])[1] || null) : null;
      return json({ request, done, verdict, report });
    }

    if (what === 'scan') {
      const file = { '': 'latest.json', 'all.csv': 'opportunity_scan_all.csv', 'candidates.csv': 'opportunity_candidates.csv' }[p[1] || ''];
      if (!file) return json({ error: 'unknown scan file', files: ['/xa/scan', '/xa/scan/all.csv', '/xa/scan/candidates.csv', '/xa/scan/run'] }, 404);
      // through the GitHub API when the Worker has a token: no CDN cache, so a
      // scan that just finished is visible at once
      const r = ghOn(env)
        ? await fetch('https://api.github.com/repos/' + env.GH_REPO + '/contents/scan/' + file + '?ref=main', { headers: { Authorization: 'Bearer ' + env.GH_TOKEN, Accept: 'application/vnd.github.raw', 'User-Agent': 'bars-vault' } })
        : await fetch('https://raw.githubusercontent.com/Liornim/spmo-market-bridge/main/scan/' + file, { headers: { 'User-Agent': 'spmo-market-bridge' } });
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
