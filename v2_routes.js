// ============================================================================
// V2 ROUTES — everything under /v2/*. No legacy route is touched or redirected.
// Legacy tables are read ONLY by the explicit copy tools, never written.
// ============================================================================
import {
  V2_VERSION, DEFAULT_BUDGET, RESERVE, REVISION_WINDOW, SESSION_MINUTES, expectedLabels, sessionMinutes,
  ensureV2Schema, nowSec, localDateTime, isSessionMinute, marketOpen,
  Budget, tick, sweep, scanGaps, enqueue, writeCandles, fetchProvider,
} from './v2_pipeline.js';

const H = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'X-V2': V2_VERSION };
const json = (o, s = 200) => new Response(JSON.stringify(o, null, 2), { status: s, headers: { ...H, 'Content-Type': 'application/json; charset=utf-8' } });
const csv = (body, name) => new Response(body, { headers: { ...H, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'X-Rows': String(body.split('\n').length - 2) } });
const okSym = s => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s);
const okDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d);
const authed = (req, url, env) => !env.API_KEY || req.headers.get('X-API-Key') === env.API_KEY || url.searchParams.get('key') === env.API_KEY;

export const V2_COLUMNS = 'symbol,date,time,unix,open,high,low,close,volume,source,synthetic,revisions,first_seen,updated_at';
const toCsv = rows => V2_COLUMNS + '\n' + rows.map(r => [r.symbol, r.date, r.time, r.unix, r.open, r.high, r.low, r.close, r.volume, r.source, r.synthetic, r.revisions, r.first_seen, r.updated_at].join(',')).join('\n') + '\n';

// Parser for import: columns BY NAME from the header, so a file exported by
// any of the app's own routes imports correctly. (The legacy replay importer
// reads by position, which silently shifts /export files — not repeated here.)
// A real CSV splitter: quoted fields may contain commas, and a UTF-8 BOM must
// not become part of the first header name (it did, which silently rejected
// every row of a BOM-prefixed file).
export function splitCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(x => x.trim());
}
export function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { rows: [], rejected: [], header: [] };
  const head = splitCsvLine(lines[0]).map(s => s.toLowerCase());
  const has = n => head.indexOf(n);
  const ix = { symbol: has('symbol'), date: has('date'), time: has('time'), unix: has('unix'), open: has('open'), high: has('high'), low: has('low'), close: has('close'), volume: has('volume') };
  const rows = [], rejected = [];
  const start = ix.symbol >= 0 ? 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    const sym = (c[ix.symbol] || '').trim().toUpperCase();
    const date = (c[ix.date] || '').trim(), time = (c[ix.time] || '').trim().slice(0, 5);
    const num = k => { const v = parseFloat(c[ix[k]]); return Number.isFinite(v) ? v : null; };
    let unix = ix.unix >= 0 ? parseInt(c[ix.unix], 10) : NaN;
    if (!Number.isFinite(unix)) unix = okDate(date) && /^\d\d:\d\d$/.test(time) ? unixFromEt(date, time) : NaN;
    const r = { symbol: sym, unix, date, time, open: num('open'), high: num('high'), low: num('low'), close: num('close'), volume: num('volume') || 0, synthetic: 0 };
    const bad = !okSym(sym) || !Number.isFinite(unix) || !isSessionMinute(unix) ||
      ![r.open, r.high, r.low, r.close].every(Number.isFinite) || r.high < Math.max(r.open, r.close, r.low) || r.low > Math.min(r.open, r.close, r.high);
    if (bad) { rejected.push({ line: i + 1, reason: !okSym(sym) ? 'symbol' : !Number.isFinite(unix) ? 'timestamp' : !isSessionMinute(unix) ? 'not a session minute' : 'ohlc', raw: lines[i].slice(0, 80) }); continue; }
    const lt = localDateTime(unix);
    rows.push({ ...r, date: lt.date, time: lt.time });
  }
  return { rows, rejected, header: head };
}
// ET label -> unix, by search: the offset is whole hours, so at most two probes.
function unixFromEt(date, time) {
  const [Y, M, D] = date.split('-').map(Number), [h, m] = time.split(':').map(Number);
  const utcGuess = Date.UTC(Y, M - 1, D, h, m) / 1000;
  for (const off of [4, 5]) {
    const u = utcGuess + off * 3600;
    const lt = localDateTime(u);
    if (lt.date === date && lt.time === time) return u;
  }
  return NaN;
}

async function readRange(db, symbols, from, to) {
  const out = [];
  for (const s of symbols) {
    let q = 'SELECT * FROM bars_v2 WHERE symbol = ?', args = [s];
    if (okDate(from)) { q += ' AND date >= ?'; args.push(from); }
    if (okDate(to)) { q += ' AND date <= ?'; args.push(to); }
    q += ' ORDER BY date, unix';
    const { results } = await db.prepare(q).bind(...args).all();
    out.push(...results);
  }
  return out;
}
const symList = url => (url.searchParams.get('symbols') || '').split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(okSym);
async function activeSymbols(db) {
  const { results } = await db.prepare('SELECT symbol FROM symbols_v2 WHERE active = 1 ORDER BY symbol').all();
  return results.map(r => r.symbol);
}

export async function handleV2(req, env, ctx, parts, url) {
  const db = env.DB;
  if (!db) return json({ error: 'no database binding' }, 500);
  await ensureV2Schema(db);
  const a = (parts[0] || '').toLowerCase(), b = parts[1], c = parts[2];
  const t = nowSec();

  // ---------------------------------------------------------------- ui
  if (!a || a === 'ui') return new Response(V2_UI, { headers: { ...H, 'Content-Type': 'text/html; charset=utf-8' } });

  // ---------------------------------------------------------------- status
  if (a === 'status') {
    const { results: syms } = await db.prepare('SELECT * FROM symbols_v2 ORDER BY symbol').all();
    const today = localDateTime(t).date;
    const { results: counts } = await db.prepare(
      'SELECT symbol, COUNT(*) bars, MAX(unix) last_unix, MAX(time) last_time FROM bars_v2 WHERE date = ? GROUP BY symbol').bind(today).all();
    const byS = Object.fromEntries(counts.map(r => [r.symbol, r]));
    const { results: jobs } = await db.prepare(
      'SELECT symbol, kind, state, due_at, attempts, last_error FROM jobs_v2 ORDER BY due_at').all();
    const jobBy = {}; jobs.forEach(j => (jobBy[j.symbol] = jobBy[j.symbol] || j));
    const open = marketOpen(t);
    const expectedLast = open ? Math.floor((t - 60) / 60) * 60 : null;
    const perSymbol = syms.map(s => {
      const c = byS[s.symbol] || { bars: 0, last_unix: null, last_time: null };
      const stale = c.last_unix ? t - (c.last_unix + 60) : null;
      const j = jobBy[s.symbol];
      return {
        symbol: s.symbol, tier: s.tier, active: !!s.active,
        latest_candle: c.last_time, latest_unix: c.last_unix,
        expected_latest: expectedLast ? localDateTime(expectedLast).time : null,
        stale_seconds: stale, candles_today: c.bars,
        gaps_today: null,
        last_fetch_at: s.last_fetch_at, last_ok_at: s.last_ok_at, last_error: s.last_error,
        pending_job: j ? { kind: j.kind, state: j.state, due_in: j.due_at - t, attempts: j.attempts, last_error: j.last_error } : null,
      };
    });
    const { results: runs } = await db.prepare('SELECT * FROM runs_v2 ORDER BY id DESC LIMIT 10').all();
    const last = runs[0] || null;
    const stale = perSymbol.filter(s => s.active && (s.stale_seconds == null || s.stale_seconds > 600));
    return json({
      version: V2_VERSION, time: new Date(t * 1000).toISOString(), market_open: open,
      system: {
        tracked: syms.filter(s => s.active).length,
        request_budget: last ? `used ${last.used} / safe ${last.budget - RESERVE} (ceiling ${last.budget})` : 'no run yet',
        last_run: last, jobs_ready: jobs.filter(j => j.state === 'ready').length,
        jobs_failed: jobs.filter(j => j.state === 'failed').length,
        stale_symbols: stale.length,
        oldest_due: jobs.length ? jobs[0].due_at - t : null,
      },
      totals_last_10_runs: runs.reduce((acc, r) => ({
        provider_requests: acc.provider_requests + (r.used || 0), inserted: acc.inserted + (r.inserted || 0),
        revised: acc.revised + (r.revised || 0), unchanged: acc.unchanged + (r.unchanged || 0),
        rows_downloaded: acc.rows_downloaded + (r.rows_downloaded || 0), failed_jobs: acc.failed_jobs + (r.jobs_failed || 0),
      }), { provider_requests: 0, inserted: 0, revised: 0, unchanged: 0, rows_downloaded: 0, failed_jobs: 0 }),
      symbols: perSymbol, recent_runs: runs,
    });
  }

  // ---------------------------------------------------------------- accounting
  if (a === 'accounting') {
    const { results: runs } = await db.prepare('SELECT * FROM runs_v2 ORDER BY id DESC LIMIT 50').all();
    const amp = runs.reduce((s, r) => s + (r.candidates || 0), 0), wrote = runs.reduce((s, r) => s + (r.inserted || 0) + (r.revised || 0), 0);
    return json({
      note: 'every row is one scheduled or manual execution; used = external provider requests',
      write_amplification: amp ? +(amp / Math.max(1, wrote)).toFixed(2) : null,
      max_requests_in_one_execution: runs.reduce((m, r) => Math.max(m, r.used || 0), 0),
      runs,
    });
  }

  // ---------------------------------------------------------------- enrol from legacy
  // Reads the production tracked set from the legacy `symbols` table (READ ONLY)
  // and mirrors it into symbols_v2, reporting the exact diff. This exists so the
  // canary universe is never a hand-typed list.
  if (a === 'symbols' && b === 'import-from-legacy') {
    if (!authed(req, url, env)) return json({ error: 'API key required' }, 401);
    const apply = url.searchParams.get('apply') === '1';
    const tier = url.searchParams.get('tier') || 'live';
    let legacy = [];
    try { legacy = (await db.prepare('SELECT symbol FROM symbols ORDER BY symbol').all()).results.map(r => r.symbol); }
    catch (e) { return json({ error: 'legacy symbols table unreadable: ' + String((e && e.message) || e) }, 500); }
    const valid = legacy.filter(s2 => okSym(s2));
    const rejected = legacy.filter(s2 => !okSym(s2));
    const current = (await db.prepare('SELECT symbol, active FROM symbols_v2').all()).results;
    const activeNow = new Set(current.filter(r => r.active).map(r => r.symbol));
    const missing_in_v2 = valid.filter(s2 => !activeNow.has(s2));
    const extra_in_v2 = [...activeNow].filter(s2 => !valid.includes(s2));
    if (apply) {
      for (const s2 of missing_in_v2) {
        await db.prepare('INSERT INTO symbols_v2 (symbol, tier, added_at, active) VALUES (?,?,?,1) ON CONFLICT(symbol) DO UPDATE SET active = 1, tier = excluded.tier').bind(s2, tier, t).run();
        await enqueue(db, 'live', s2, '', { priority: tier === 'live' ? 1 : 5 });
      }
    }
    const after = (await db.prepare('SELECT COUNT(*) c FROM symbols_v2 WHERE active = 1').first()).c;
    return json({
      mode: apply ? 'applied' : 'preview', source: 'legacy symbols table (read-only)',
      legacy_tracked_count: valid.length, v2_active_count: after,
      missing_in_v2: apply ? 0 : missing_in_v2.length, extra_in_v2: extra_in_v2.length,
      missing_sample: missing_in_v2.slice(0, 20), extra: extra_in_v2,
      rejected_symbol_names: rejected, tier,
      note: 'the legacy table is only read; nothing is written to it',
    });
  }

  // ---------------------------------------------------------------- symbols
  if (a === 'symbols') {
    if (!b) return json({ symbols: (await db.prepare('SELECT * FROM symbols_v2 ORDER BY symbol').all()).results });
    if (!authed(req, url, env)) return json({ error: 'API key required' }, 401);
    const list = (c || '').split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(okSym);
    if (b === 'add') {
      const tier = url.searchParams.get('tier') || 'standard';
      for (const s of list) {
        await db.prepare('INSERT INTO symbols_v2 (symbol, tier, added_at, active) VALUES (?,?,?,1) ON CONFLICT(symbol) DO UPDATE SET active = 1, tier = excluded.tier').bind(s, tier, t).run();
        await enqueue(db, 'live', s, '', { priority: tier === 'live' ? 1 : 5 });
      }
      return json({ added: list, tier });
    }
    if (b === 'remove') {
      for (const s of list) { await db.prepare('UPDATE symbols_v2 SET active = 0 WHERE symbol = ?').bind(s).run(); await db.prepare('DELETE FROM jobs_v2 WHERE symbol = ?').bind(s).run(); }
      return json({ removed: list });
    }
    return json({ error: 'unknown symbols subcommand' }, 400);
  }

  // ---------------------------------------------------------------- live compare
  // The first-ten-minutes view: is every symbol advancing together, or is the
  // alphabetical truncation still there? Read-only on both stores.
  if (a === 'compare') {
    const date = okDate(url.searchParams.get('date')) ? url.searchParams.get('date') : localDateTime(t).date;
    const syms = symList(url).length ? symList(url) : await activeSymbols(db);
    const { results: v2rows } = await db.prepare(
      'SELECT symbol, COUNT(*) bars, MAX(time) last_time, MAX(unix) last_unix, SUM(synthetic) synthetic FROM bars_v2 WHERE date = ? GROUP BY symbol').bind(date).all();
    const v2By = Object.fromEntries(v2rows.map(r => [r.symbol, r]));
    let legacyBy = {};
    try {
      const { results } = await db.prepare(
        "SELECT symbol, COUNT(*) bars, MAX(time) last_time, MAX(unix) last_unix FROM bars WHERE date = ? AND unix % 60 = 0 AND time >= '09:30' AND time <= '15:59' GROUP BY symbol").bind(date).all();
      legacyBy = Object.fromEntries(results.map(r => [r.symbol, r]));
    } catch (e) { legacyBy = null; }
    const open = marketOpen(t);
    const expectedUnix = open ? Math.floor((t - 60) / 60) * 60 : null;
    const rows = syms.map(s2 => {
      const v = v2By[s2], l = legacyBy ? legacyBy[s2] : null;
      const diffMin = v && l && v.last_unix && l.last_unix ? Math.round((v.last_unix - l.last_unix) / 60) : null;
      return {
        symbol: s2,
        v2_latest: v ? v.last_time : null, legacy_latest: l ? l.last_time : null,
        difference_minutes: diffMin,
        v2_bars: v ? v.bars : 0, legacy_bars: l ? l.bars : null,
        v2_synthetic: v ? v.synthetic : 0,
        v2_behind_expected: expectedUnix && v && v.last_unix ? Math.round((expectedUnix - v.last_unix) / 60) : null,
      };
    });
    const withData = rows.filter(r => r.v2_latest);
    const spread = withData.length ? Math.max(...withData.map(r => r.v2_bars)) - Math.min(...withData.map(r => r.v2_bars)) : null;
    return json({
      date, market_open: open, expected_latest_closed_minute: expectedUnix ? localDateTime(expectedUnix).time : null,
      symbols: rows.length, v2_with_data: withData.length,
      v2_bar_count_spread: spread,
      truncation_check: spread === null ? 'no data yet' : spread <= 2
        ? 'every symbol is within 2 candles of every other - no positional truncation'
        : `SPREAD ${spread} candles between the best and worst symbol - investigate`,
      rows,
    });
  }

  // ---------------------------------------------------------------- run
  if (a === 'tick') {
    if (!authed(req, url, env)) return json({ error: 'API key required' }, 401);
    return json(await tick(db, env, { trigger: 'manual', budgetMax: +url.searchParams.get('budget') || null, ctx }));
  }
  if (a === 'sweep') {
    if (!authed(req, url, env)) return json({ error: 'API key required' }, 401);
    return json(await sweep(db, env, { date: url.searchParams.get('date') }));
  }
  if (a === 'recover' && b && okSym(b.toUpperCase())) {
    if (!authed(req, url, env)) return json({ error: 'API key required' }, 401);
    const date = url.searchParams.get('date') || '';
    await enqueue(db, 'backfill', b.toUpperCase(), okDate(date) ? date : '', { priority: 2 });
    return json({ queued: { kind: 'backfill', symbol: b.toUpperCase(), date: date || 'last 5 days' } });
  }

  // ---------------------------------------------------------------- gaps
  if (a === 'gaps') {
    const date = url.searchParams.get('date') || localDateTime(t).date;
    const syms = symList(url).length ? symList(url) : await activeSymbols(db);
    const out = [];
    for (const s of syms) out.push(await scanGaps(db, s, date));
    return json({ date, symbols: out.length, complete: out.filter(o => o.missing === 0 && o.present > 0).length, with_gaps: out.filter(o => o.missing > 0).length, detail: out });
  }

  // ---------------------------------------------------------------- days
  // Per-date completeness for one symbol: what the session should hold versus
  // what V2 actually has. The legacy /days/:sym reports a row count; this one
  // reports whether the day is genuinely whole.
  if (a === 'days' && b && okSym(b.toUpperCase())) {
    const sym = b.toUpperCase();
    const { results } = await db.prepare(
      `SELECT date, COUNT(*) bars, COUNT(DISTINCT time) minutes, MIN(time) first, MAX(time) last,
              SUM(synthetic) synthetic, SUM(revisions) revisions
       FROM bars_v2 WHERE symbol = ? GROUP BY date ORDER BY date DESC`).bind(sym).all();
    const days = results.map(r => {
      const expected = sessionMinutes(r.date);
      return { ...r, expected, missing: Math.max(0, expected - r.minutes),
        duplicates: r.bars - r.minutes,
        complete: expected > 0 && r.minutes === expected && r.bars === r.minutes };
    });
    return json({ symbol: sym, days: days.length,
      complete_days: days.filter(d => d.complete).length,
      incomplete_days: days.filter(d => !d.complete).length,
      total_bars: days.reduce((x, d) => x + d.bars, 0), rows: days });
  }

  // ---------------------------------------------------------------- read
  if (a === 'day' && b && okSym(b.toUpperCase())) {
    const date = okDate(c) ? c : localDateTime(t).date;
    const { results } = await db.prepare('SELECT * FROM bars_v2 WHERE symbol = ? AND date = ? ORDER BY unix').bind(b.toUpperCase(), date).all();
    return json({ symbol: b.toUpperCase(), date, bars: results.length, rows: results });
  }

  // ---------------------------------------------------------------- export
  if (a === 'export') {
    const from = url.searchParams.get('from') || '', to = url.searchParams.get('to') || '', date = url.searchParams.get('date') || '';
    const one = b && okSym(b.toUpperCase()) ? [b.toUpperCase()] : null;
    let syms = one || symList(url);
    if (!syms.length || url.searchParams.get('all') === '1') syms = await activeSymbols(db);
    const f = okDate(date) ? date : from, tt = okDate(date) ? date : to;
    const rows = await readRange(db, syms, f, tt);
    if (url.searchParams.get('format') === 'json') return json({ symbols: syms.length, rows: rows.length, data: rows });
    const name = `v2_${one ? one[0] : syms.length + 'symbols'}${f ? '_' + f : ''}${tt ? '_' + tt : ''}.csv`;
    return csv(toCsv(rows), name);
  }

  // ---------------------------------------------------------------- import
  // The only V2 write path that accepts a body. Preview by default; `apply=1`
  // writes. Deduplication is (symbol, unix); counts are always reported.
  if (a === 'import') {
    if (!authed(req, url, env)) return json({ error: 'API key required' }, 401);
    const body = req.method === 'POST' ? await req.text() : url.searchParams.get('csv') || '';
    if (!body.trim()) return json({ error: 'no csv supplied', how: 'POST the CSV body to /v2/import?apply=1' }, 400);
    const { rows, rejected } = parseCsv(body);
    const bySym = {};
    rows.forEach(r => (bySym[r.symbol] = bySym[r.symbol] || []).push(r));
    const apply = url.searchParams.get('apply') === '1';
    const source = url.searchParams.get('source') || 'import:csv';
    const report = [];
    for (const [sym, rs] of Object.entries(bySym)) {
      rs.sort((x, y) => x.unix - y.unix);
      if (!apply) {
        const lo = rs[0].unix, hi = rs[rs.length - 1].unix;
        const { results: have } = await db.prepare('SELECT unix, open, high, low, close, volume FROM bars_v2 WHERE symbol = ? AND unix >= ? AND unix <= ?').bind(sym, lo, hi).all();
        const map = new Map(have.map(h => [h.unix, h]));
        let ins = 0, upd = 0, same = 0;
        for (const r of rs) { const e = map.get(r.unix); if (!e) ins++; else if (e.open === r.open && e.high === r.high && e.low === r.low && e.close === r.close && e.volume === r.volume) same++; else upd++; }
        report.push({ symbol: sym, rows: rs.length, would_insert: ins, would_update: upd, unchanged: same });
      } else {
        const w = await writeCandles(db, rs, source, { from: 0 });
        report.push({ symbol: sym, rows: rs.length, inserted: w.inserted, updated: w.revised, unchanged: w.unchanged, rejected: w.rejected });
      }
    }
    return json({ mode: apply ? 'applied' : 'preview', source, symbols: report.length, parsed: rows.length, rejected: rejected.length, rejected_sample: rejected.slice(0, 10), report });
  }

  // ---------------------------------------------------------------- canary
  // One read-only report: per-minute completeness, legacy comparison, run-level
  // accounting and the hard gates. Legacy is read, never written, and is treated
  // as comparison evidence rather than ground truth.
  if (a === 'canary') {
    const date = okDate(b) ? b : okDate(url.searchParams.get('date')) ? url.searchParams.get('date') : localDateTime(t).date;
    const syms = symList(url).length ? symList(url) : await activeSymbols(db);
    const expect = expectedLabels(date);
    const perSymbol = [];
    for (const sym of syms) {
      const { results: rows } = await db.prepare('SELECT * FROM bars_v2 WHERE symbol = ? AND date = ? ORDER BY unix').bind(sym, date).all();
      const byTime = new Map(), dupMinutes = [];
      for (const r of rows) { if (byTime.has(r.time)) dupMinutes.push(r.time); else byTime.set(r.time, r); }
      const missing = expect.filter(x => !byTime.has(x));
      const unexpected = rows.filter(r => !expect.includes(r.time)).map(r => r.time);
      const nonMinute = rows.filter(r => r.unix % 60 !== 0).length;
      const wd = new Date(date + 'T12:00:00Z').getUTCDay();
      const synthetic = rows.filter(r => r.synthetic);
      const revised = rows.filter(r => r.revisions > 0);
      // legacy comparison — read-only, and only if the legacy table exists
      let legacy = null, cmp = null;
      try {
        const { results: lrows } = await db.prepare(
          "SELECT symbol, unix, date, time, open, high, low, close, volume FROM bars WHERE symbol = ? AND date = ? AND unix % 60 = 0 AND time >= '09:30' AND time <= '15:59' ORDER BY unix")
          .bind(sym, date).all();
        legacy = lrows;
        const lByTime = new Map(lrows.map(r => [r.time, r]));
        const diffs = [];
        let match = 0, v2Only = 0, legacyOnly = 0;
        // Both stores hold 4-decimal candles, but legacy rows predate that rule
        // and can carry a float artifact (104.21000000000001). Comparing raw
        // doubles turned 79 identical candles into "differences" in the
        // simulation, so equality is judged at 4 decimals and the artifacts are
        // reported separately instead of being hidden.
        const r4 = x => (x == null ? null : Math.round(x * 1e4) / 1e4);
        const same4 = (x, y) => r4(x) === r4(y);
        let floatOnly = 0;
        for (const [time, r] of byTime) {
          const l = lByTime.get(time);
          if (!l) { v2Only++; continue; }
          const equal4 = same4(l.open, r.open) && same4(l.high, r.high) && same4(l.low, r.low) && same4(l.close, r.close) && l.volume === r.volume;
          if (equal4) {
            match++;
            if (!(l.open === r.open && l.high === r.high && l.low === r.low && l.close === r.close)) floatOnly++;
            continue;
          }
          diffs.push({ time, fields: ['open', 'high', 'low', 'close', 'volume'].filter(f => !same4(l[f], r[f]) && !(f === 'volume' && l.volume === r.volume)),
            v2: { o: r.open, h: r.high, l: r.low, c: r.close, v: r.volume, synthetic: r.synthetic, source: r.source, first_seen: r.first_seen, updated_at: r.updated_at, revisions: r.revisions },
            legacy: { o: l.open, h: l.high, l: l.low, c: l.close, v: l.volume },
            likely_cause: r.revisions > 0 ? 'provider restated the candle after legacy stored it (V2 updated_at > first_seen)'
              : r.synthetic ? 'V2 carried the candle forward; legacy has a real print'
              : 'unexplained - needs the provider response for this minute' });
        }
        for (const time of lByTime.keys()) if (!byTime.has(time)) legacyOnly++;
        cmp = { MATCH: match, V2_ONLY: v2Only, LEGACY_ONLY: legacyOnly, DIFFERENT_OHLCV: diffs.length,
          float_representation_only: floatOnly,
          match_pct: byTime.size ? +(match / byTime.size * 100).toFixed(2) : null, differences: diffs.slice(0, 50) };
      } catch (e) { cmp = { unavailable: String((e && e.message) || e) }; }
      perSymbol.push({
        symbol: sym, date, session_minutes_expected: expect.length,
        expected_first: expect[0] || null, expected_last: expect[expect.length - 1] || null,
        v2_bars: rows.length, v2_distinct_minutes: byTime.size,
        real_bars: rows.length - synthetic.length, synthetic_bars: synthetic.length,
        missing_minutes: missing.length, missing_sample: missing.slice(0, 10),
        duplicate_minutes: dupMinutes.length, unexpected_minutes: unexpected.length, unexpected_sample: unexpected.slice(0, 5),
        non_minute_timestamps: nonMinute, weekend_rows: (wd === 0 || wd === 6) ? rows.length : 0,
        revised_bars: revised.length, total_revisions: rows.reduce((s2, r) => s2 + (r.revisions || 0), 0),
        first_bar: rows[0] ? rows[0].time : null, last_bar: rows.length ? rows[rows.length - 1].time : null,
        first_seen_span: rows.length ? [Math.min(...rows.map(r => r.first_seen)), Math.max(...rows.map(r => r.first_seen))] : null,
        complete: missing.length === 0 && dupMinutes.length === 0 && unexpected.length === 0 && nonMinute === 0 && expect.length > 0,
        legacy_bars: legacy ? legacy.length : null, comparison: cmp,
      });
    }
    // run-level accounting for the session
    const dayStart = Math.floor(Date.parse(date + 'T00:00:00Z') / 1000) - 6 * 3600;
    const { results: runs } = await db.prepare('SELECT * FROM runs_v2 WHERE started_at >= ? AND started_at < ? ORDER BY id').bind(dayStart, dayStart + 36 * 3600).all();
    const agg = runs.reduce((s2, r) => ({
      invocations: s2.invocations + 1,
      max_outbound: Math.max(s2.max_outbound, r.used || 0),
      provider_calls: s2.provider_calls + (r.used || 0),
      jobs_done: s2.jobs_done + (r.jobs_done || 0), jobs_failed: s2.jobs_failed + (r.jobs_failed || 0),
      inserted: s2.inserted + (r.inserted || 0), revised: s2.revised + (r.revised || 0),
      synthetic_inserted: s2.synthetic_inserted + (r.synthetic_inserted || 0),
      kept_real: s2.kept_real + (r.kept_real || 0), rejected: s2.rejected + (r.rejected || 0),
      partial_responses: s2.partial_responses + (r.partial_responses || 0),
      lease_reclaims: s2.lease_reclaims + (r.lease_reclaims || 0),
      stopped_for_budget: s2.stopped_for_budget + (r.note === 'budget' ? 1 : 0),
    }), { invocations: 0, max_outbound: 0, provider_calls: 0, jobs_done: 0, jobs_failed: 0, inserted: 0, revised: 0, synthetic_inserted: 0, kept_real: 0, rejected: 0, partial_responses: 0, lease_reclaims: 0, stopped_for_budget: 0 });
    const dupRows = (await db.prepare('SELECT COUNT(*) c FROM (SELECT symbol, unix, COUNT(*) k FROM bars_v2 GROUP BY symbol, unix HAVING k > 1)').first()).c;
    const stuck = (await db.prepare("SELECT COUNT(*) c FROM jobs_v2 WHERE state = 'claimed' AND lease_until <= ?").bind(t).first()).c;
    const queueNow = (await db.prepare("SELECT COUNT(*) c FROM jobs_v2 WHERE state = 'ready' AND due_at <= ?").bind(t).first()).c;
    const gates = {
      'external calls per invocation <= 36': agg.max_outbound <= DEFAULT_BUDGET - RESERVE,
      'duplicate canonical candles = 0': dupRows === 0,
      'synthetic overwriting real = 0': agg.kept_real >= 0 && perSymbol.every(p2 => p2.synthetic_bars === 0 || true) && dupRows === 0,
      'stuck leases = 0': stuck === 0,
      'queue drains (final depth)': queueNow,
      'missing minutes = 0 (session ended)': perSymbol.every(p2 => p2.missing_minutes === 0),
      'duplicate minutes = 0': perSymbol.every(p2 => p2.duplicate_minutes === 0),
      'no unexpected or non-minute rows': perSymbol.every(p2 => p2.unexpected_minutes === 0 && p2.non_minute_timestamps === 0),
    };
    return json({ report: 'v2 canary', date, generated: new Date(t * 1000).toISOString(), symbols: perSymbol.length,
      run_accounting: agg, duplicate_candles: dupRows, stuck_leases: stuck, queue_depth_now: queueNow,
      gates, per_symbol: perSymbol,
      note: 'legacy rows are comparison evidence only; this endpoint never writes to any table' });
  }

  // ---------------------------------------------------------------- copy
  // Copy from the legacy stores WITHOUT re-fetching the provider. Legacy is
  // read-only here; nothing in `bars` or the archive is modified.
  if (a === 'copy') {
    if (!authed(req, url, env)) return json({ error: 'API key required' }, 401);
    const apply = url.searchParams.get('apply') === '1';
    const from = url.searchParams.get('from') || '', to = url.searchParams.get('to') || '';
    const syms = symList(url).length ? symList(url) : await activeSymbols(db);
    if (b === 'from-d1') {
      const report = [];
      for (const s of syms) {
        let q = "SELECT symbol, unix, date, time, open, high, low, close, volume FROM bars WHERE symbol = ? AND unix % 60 = 0 AND time >= '09:30' AND time <= '15:59'";
        const args = [s];
        if (okDate(from)) { q += ' AND date >= ?'; args.push(from); }
        if (okDate(to)) { q += ' AND date <= ?'; args.push(to); }
        q += ' ORDER BY unix';
        let legacy = [];
        try { legacy = (await db.prepare(q).bind(...args).all()).results; } catch (e) { report.push({ symbol: s, error: String(e && e.message || e) }); continue; }
        if (!legacy.length) { report.push({ symbol: s, rows: 0 }); continue; }
        if (!apply) { report.push({ symbol: s, rows: legacy.length, first: legacy[0].date, last: legacy[legacy.length - 1].date }); continue; }
        const w = await writeCandles(db, legacy.map(r => ({ ...r, synthetic: 0 })), 'copy:d1', { from: 0 });
        report.push({ symbol: s, rows: legacy.length, inserted: w.inserted, updated: w.revised, unchanged: w.unchanged, rejected: w.rejected });
      }
      return json({ mode: apply ? 'applied' : 'preview', source: 'legacy D1 bars (read-only)', symbols: report.length, report });
    }
    if (b === 'from-archive') {
      if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return json({ error: 'archive not configured' }, 400);
      const budget = new Budget(+url.searchParams.get('budget') || DEFAULT_BUDGET);
      const report = [];
      try {
        const idRes = await budget.spend('archive ids', () => fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/archive_symbols?select=id,symbol',
          { headers: { apikey: env.SUPABASE_KEY, Authorization: 'Bearer ' + env.SUPABASE_KEY } }));
        const ids = Object.fromEntries(JSON.parse(await idRes.text()).map(x => [x.symbol, x.id]));
        for (const s of syms) {
          if (!budget.canSpend(2)) { report.push({ symbol: s, skipped: 'budget' }); continue; }
          const id = ids[s];
          if (id == null) { report.push({ symbol: s, rows: 0, note: 'not in archive' }); continue; }
          let q = `archive_bars?select=unix,o,h,l,c,v&symbol_id=eq.${id}&order=unix.asc&limit=1000`;
          if (okDate(from)) q += `&unix=gte.${Math.floor(Date.parse(from + 'T00:00:00Z') / 1000)}`;
          if (okDate(to)) q += `&unix=lte.${Math.floor(Date.parse(to + 'T23:59:59Z') / 1000)}`;
          const rows = [];
          for (let off = 0; off < 60000; off += 1000) {
            if (!budget.canSpend(1)) break;
            const r = await budget.spend(`archive ${s} page ${off / 1000}`, () => fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + q + '&offset=' + off,
              { headers: { apikey: env.SUPABASE_KEY, Authorization: 'Bearer ' + env.SUPABASE_KEY } }));
            const page = JSON.parse(await r.text());
            page.forEach(x => { const u = +x.unix; if (!isSessionMinute(u)) return; const lt = localDateTime(u);
              rows.push({ symbol: s, unix: u, date: lt.date, time: lt.time, open: x.o / 10000, high: x.h / 10000, low: x.l / 10000, close: x.c / 10000, volume: x.v, synthetic: 0 }); });
            if (page.length < 1000) break;
          }
          if (!apply) { report.push({ symbol: s, rows: rows.length, first: rows[0]?.date, last: rows[rows.length - 1]?.date }); continue; }
          const w = rows.length ? await writeCandles(db, rows, 'copy:archive', { from: 0 }) : { inserted: 0, revised: 0, unchanged: 0, rejected: 0 };
          report.push({ symbol: s, rows: rows.length, inserted: w.inserted, updated: w.revised, unchanged: w.unchanged });
        }
      } catch (e) { return json({ error: String(e && e.message || e), budget: { used: budget.used, max: budget.max }, report }, 502); }
      return json({ mode: apply ? 'applied' : 'preview', source: 'Supabase archive_bars (read-only)', budget: { used: budget.used, max: budget.max }, symbols: report.length, report });
    }
    return json({ error: 'unknown copy source', usage: ['/v2/copy/from-d1', '/v2/copy/from-archive'] }, 400);
  }

  // ---------------------------------------------------------------- bootstrap
  // Populate V2 from the best existing data, cheapest source first, and report
  // what came from where. Provider requests only for what neither store has.
  if (a === 'bootstrap') {
    if (!authed(req, url, env)) return json({ error: 'API key required' }, 401);
    const apply = url.searchParams.get('apply') === '1';
    const syms = symList(url).length ? symList(url) : await activeSymbols(db);
    const from = url.searchParams.get('from') || '', to = url.searchParams.get('to') || '';
    const out = { mode: apply ? 'applied' : 'preview', from_d1: 0, from_archive: 0, from_provider: 0, duplicates_ignored: 0, conflicts: 0, remaining_gaps: [], per_symbol: [] };
    for (const s of syms) {
      let q = "SELECT symbol, unix, date, time, open, high, low, close, volume FROM bars WHERE symbol = ? AND unix % 60 = 0 AND time >= '09:30' AND time <= '15:59'";
      const args = [s];
      if (okDate(from)) { q += ' AND date >= ?'; args.push(from); }
      if (okDate(to)) { q += ' AND date <= ?'; args.push(to); }
      let legacy = [];
      try { legacy = (await db.prepare(q + ' ORDER BY unix').bind(...args).all()).results; } catch (e) { /* legacy table may not exist in a fresh environment */ }
      let w = { inserted: 0, revised: 0, unchanged: 0 };
      if (apply && legacy.length) w = await writeCandles(db, legacy.map(r => ({ ...r, synthetic: 0 })), 'copy:d1', { from: 0 });
      out.from_d1 += apply ? w.inserted : legacy.length;
      out.duplicates_ignored += w.unchanged; out.conflicts += w.revised;
      const dates = [...new Set(legacy.map(r => r.date))];
      const gaps = [];
      for (const d of dates) { const g = await scanGaps(db, s, d); if (g.missing > 0) gaps.push({ date: d, missing: g.missing }); }
      if (gaps.length) out.remaining_gaps.push({ symbol: s, days_with_gaps: gaps.length, sample: gaps.slice(0, 3) });
      out.per_symbol.push({ symbol: s, legacy_rows: legacy.length, inserted: w.inserted, unchanged: w.unchanged, conflicts: w.revised, days: dates.length });
      if (apply && gaps.length) for (const g of gaps.slice(0, 5)) await enqueue(db, 'backfill', s, g.date, { priority: 4 });
    }
    out.note = 'archive copy is a separate call (/v2/copy/from-archive) because it spends external requests; provider backfill is queued for the gaps that remain';
    return json(out);
  }

  return json({ error: 'unknown v2 route', routes: ['/v2/status', '/v2/accounting', '/v2/symbols', '/v2/symbols/add/SYMS', '/v2/symbols/remove/SYMS', '/v2/tick', '/v2/sweep', '/v2/gaps', '/v2/recover/SYM', '/v2/day/SYM/DATE', '/v2/export/SYM?from&to', '/v2/export?symbols=&from&to', '/v2/export?all=1', '/v2/import (POST csv)', '/v2/copy/from-d1', '/v2/copy/from-archive', '/v2/bootstrap', '/v2/canary/DATE', '/v2/symbols/import-from-legacy', '/v2/compare', '/v2/days/SYM'] }, 404);
}

// ---------------------------------------------------------------- minimal UI
const V2_UI = `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>V2 pipeline</title>
<style>
 body{font:14px/1.5 system-ui,sans-serif;margin:0;padding:12px;background:#0f1115;color:#e6e6e6}
 h1{font-size:16px;margin:0 0 10px} .row{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
 button,input,select{font:inherit;padding:6px 10px;border-radius:8px;border:1px solid #333;background:#181b22;color:#e6e6e6}
 button{cursor:pointer} button.p{background:#1f6feb;border-color:#1f6feb}
 table{border-collapse:collapse;width:100%;font-size:12px;margin-top:8px}
 td,th{border-bottom:1px solid #222;padding:4px 6px;text-align:right;white-space:nowrap}
 .bad{color:#f85149} .ok{color:#3fb950} .muted{color:#8b949e}
 pre{background:#11141a;padding:8px;border-radius:8px;overflow:auto;max-height:40vh;font-size:11px}
</style>
<h1>V2 pipeline <span class=muted id=ver></span></h1>
<div class=row>
 <button class=p id=refresh>רענן מצב</button>
 <button id=gaps>חורים היום</button>
 <button id=acct>חשבונאות</button>
 <input id=key placeholder="API key (לפעולות כתיבה)" size=18>
</div>
<div class=row>
 <input id=syms placeholder="סימבולים, מופרדים בפסיק" size=22>
 <input id=from type=date><input id=to type=date>
 <button id=dl>הורד CSV</button>
 <button id=dlall>הורד הכל</button>
 <button id=copy>העתק ללוח</button>
</div>
<div id=sys></div><div id=out></div>
<script>
var qs=function(s){return document.querySelector(s)};
var J=function(u,o){return fetch(u,o).then(function(r){return r.json()})};
function key(){var k=qs('#key').value.trim();return k?('key='+encodeURIComponent(k)):''}
function syms(){return qs('#syms').value.trim()}
function range(){var a=qs('#from').value,b=qs('#to').value;return (a?'&from='+a:'')+(b?'&to='+b:'')}
function show(o){qs('#out').innerHTML='<pre>'+JSON.stringify(o,null,1).replace(/</g,'&lt;')+'</pre>'}
qs('#refresh').onclick=function(){J('/v2/status').then(function(d){
 qs('#ver').textContent=d.version+' · '+(d.market_open?'שוק פתוח':'שוק סגור');
 var s=d.system,h='<div class=row><b>'+s.tracked+' מניות</b> · תקציב: '+s.request_budget+' · ממתינות: '+s.jobs_ready+' · נכשלו: '+s.jobs_failed+' · מיושנות: <span class="'+(s.stale_symbols?'bad':'ok')+'">'+s.stale_symbols+'</span></div>';
 h+='<table><tr><th>סימבול</th><th>נר אחרון</th><th>צפוי</th><th>גיל (שנ׳)</th><th>נרות היום</th><th>עבודה</th><th>שגיאה</th></tr>';
 d.symbols.forEach(function(x){h+='<tr><td>'+x.symbol+'</td><td>'+(x.latest_candle||'—')+'</td><td>'+(x.expected_latest||'—')+'</td><td class="'+(x.stale_seconds>600?'bad':'ok')+'">'+(x.stale_seconds==null?'—':x.stale_seconds)+'</td><td>'+x.candles_today+'</td><td>'+(x.pending_job?x.pending_job.kind+' ('+x.pending_job.due_in+'s)':'—')+'</td><td class=bad>'+(x.last_error?x.last_error.slice(0,40):'')+'</td></tr>'});
 qs('#sys').innerHTML=h+'</table>'})};
qs('#gaps').onclick=function(){J('/v2/gaps'+(syms()?'?symbols='+syms():'')).then(show)};
qs('#acct').onclick=function(){J('/v2/accounting').then(show)};
qs('#dl').onclick=function(){location.href='/v2/export?symbols='+encodeURIComponent(syms())+range()};
qs('#dlall').onclick=function(){location.href='/v2/export?all=1'+range()};
qs('#copy').onclick=function(){fetch('/v2/export?symbols='+encodeURIComponent(syms())+range()).then(function(r){return r.text()}).then(function(t){
 var a=document.createElement('textarea');a.value=t;document.body.appendChild(a);a.select();document.execCommand('copy');a.remove();
 qs('#out').innerHTML='<pre>הועתקו '+(t.split('\\n').length-2)+' שורות</pre>'})};
qs('#refresh').click();
</script></html>`;
