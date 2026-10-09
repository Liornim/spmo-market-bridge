// Keep the database small: delete days older than KEEP_DAYS (default 58 calendar
// days) from archive_bars and archive_ext_bars — but ONLY a day whose history
// file in R2 holds exactly the same minutes (every o,h,l,c,v equal, nothing
// missing on either side). A day that does not match, or whose month has no
// file yet, is kept and reported. Nothing else is touched.
// Env: SUPABASE_URL, SUPABASE_KEY, KEEP_DAYS, SYMBOLS (optional), DRY_RUN=1, WORKER_URL.
import { gunzipSync } from 'node:zlib';
const W = (process.env.WORKER_URL || 'https://spmo-market-bridge.noamharelnim.workers.dev').replace(/\/$/, '');
const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), KEY = process.env.SUPABASE_KEY || '';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const KEEP = Math.max(57, parseInt(process.env.KEEP_DAYS || '58', 10));     // never inside the 56-day sync window
const DRY = process.env.DRY_RUN === '1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ny = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const etDate = u => ny.format(new Date(u * 1000));
async function rq(path, opts = {}) {
  for (let a = 1; ; a++) { const r = await fetch(SB + '/rest/v1/' + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
    if (r.status < 300) return r; if (a >= 4) throw new Error(`${opts.method || 'GET'} ${path.slice(0, 80)} -> ${r.status} ${(await r.text()).slice(0, 160)}`); await sleep(1500 * a); }
}
const cutDate = etDate(Math.floor(Date.now() / 1000) - KEEP * 86400);
const cutUnix = Math.floor(Date.parse(cutDate + 'T00:00:00Z') / 1000) + 4 * 3600;   // 00:00 New York (EDT) or 23:00 the day before (EST) — both before 04:00
let syms = await (await rq('archive_symbols?select=id,symbol&order=symbol.asc&limit=10000')).json();
const only = new Set((process.env.SYMBOLS || '').toUpperCase().split(/[\s,;]+/).filter(Boolean));
if (only.size) syms = syms.filter(s => only.has(s.symbol));
const man = await (await fetch(W + '/xa/hist/manifest')).json().catch(() => ({ files: {} }));
console.log(`db prune: keep ${KEEP} days → delete days before ${cutDate} that match their history file${DRY ? ' — DRY RUN' : ''}`);
const tot = { days: 0, rows: 0, kept: [], noFile: 0 };
for (const s of syms) {
  const old = new Map();        // date -> Map(unix -> row) from both tables
  for (const t of ['archive_bars', 'archive_ext_bars']) {
    let after = 0;
    for (;;) { const rows = await (await rq(`${t}?select=unix,o,h,l,c,v&symbol_id=eq.${s.id}&unix=gt.${after}&unix=lt.${cutUnix}&order=unix.asc&limit=1000`)).json();
      for (const r of rows) { const d = etDate(r.unix); if (d >= cutDate) continue; (old.get(d) || old.set(d, new Map()).get(d)).set(r.unix, r); }
      if (rows.length < 1000) break; after = rows[rows.length - 1].unix; }
  }
  if (!old.size) continue;
  const files = {};
  for (const d of [...old.keys()].sort()) {
    const ym = d.slice(0, 7);
    if (!man.files?.[s.symbol]?.[ym]) { tot.noFile++; tot.kept.push(`${s.symbol} ${d}: no history file for ${ym} yet`); continue; }
    if (!files[ym]) {
      const r = await fetch(`${W}/xa/hist/file/${encodeURIComponent(s.symbol)}/${ym}`);
      if (r.status !== 200) { tot.kept.push(`${s.symbol} ${d}: file HTTP ${r.status}`); continue; }
      const m = new Map(); for (const l of gunzipSync(Buffer.from(await r.arrayBuffer())).toString().trim().split('\n').slice(1)) { const f = l.split(',').map(Number); (m.get(etDate(f[0])) || m.set(etDate(f[0]), new Map()).get(etDate(f[0]))).set(f[0], f); }
      files[ym] = m;
    }
    const fd = files[ym].get(d) || new Map(), db = old.get(d);
    let bad = fd.size !== db.size ? `file ${fd.size} minutes, database ${db.size}` : '';
    if (!bad) for (const [u, r] of db) { const f = fd.get(u); if (!f || f[1] !== r.o || f[2] !== r.h || f[3] !== r.l || f[4] !== r.c || f[5] !== r.v) { bad = `minute ${u} differs`; break; } }
    if (bad) { tot.kept.push(`${s.symbol} ${d}: ${bad} — kept`); continue; }
    const lo = Math.min(...db.keys()), hi = Math.max(...db.keys());
    if (!DRY) for (const t of ['archive_bars', 'archive_ext_bars'])
      await rq(`${t}?symbol_id=eq.${s.id}&unix=gte.${lo}&unix=lte.${hi}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    tot.days++; tot.rows += db.size;
  }
  if (!DRY) {   // refresh the symbol summary
    const f = await (await rq(`archive_bars?select=unix&symbol_id=eq.${s.id}&order=unix.asc&limit=1`)).json();
    const hc = await rq(`archive_bars?select=unix&symbol_id=eq.${s.id}`, { method: 'HEAD', headers: { Prefer: 'count=exact', Range: '0-0' } });
    await rq(`archive_symbols?id=eq.${s.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ first_unix: f[0]?.unix ?? null, bars: parseInt((hc.headers.get('content-range') || '').split('/')[1], 10) }) });
  }
}
const real = tot.kept.filter(k => !k.includes('no history file'));
console.log(`\n## database prune\ncutoff: days before ${cutDate} (keep ${KEEP} days)\nsymbol-days deleted (identical to their history file): ${tot.days} (${tot.rows} rows)\nkept because the month has no file yet: ${tot.noFile}\nkept because the file differs: ${real.length}${real.length ? '\n  ' + real.slice(0, 30).join('\n  ') : ''}`);
console.log(`PRUNE_VERDICT: ${real.length ? 'FAIL' : 'PASS'}`);
if (real.length) process.exit(1);
