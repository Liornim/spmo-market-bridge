// Independent check of the history files against the database: for every
// symbol-month in the manifest that overlaps days the database holds, the file
// is downloaded through the Worker, decompressed, and compared minute by minute,
// exactly, with archive_bars (regular) and archive_ext_bars (pre/after) — on
// the days the database has. Also re-checks each file's SHA-256 and row counts
// against the manifest. Shares no code with tools/hist_build.mjs.
// Env: SUPABASE_URL, SUPABASE_KEY, SYMBOLS (optional), MONTHS (optional, e.g. 2026-08,2026-09), WORKER_URL.
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const W = (process.env.WORKER_URL || 'https://spmo-market-bridge.noamharelnim.workers.dev').replace(/\/$/, '');
const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), KEY = process.env.SUPABASE_KEY || '';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ny = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const et = u => { const p = Object.fromEntries(ny.formatToParts(new Date(u * 1000)).map(x => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, mod: +p.hour * 60 + +p.minute }; };
async function get(url, opts) { for (let a = 1; ; a++) { const r = await fetch(url, opts); if (r.status < 500 && r.status !== 429) return r; if (a >= 4) return r; await sleep(1500 * a); } }

const man = await (await get(W + '/xa/hist/manifest')).json();
const ids = Object.fromEntries((await (await get(SB + '/rest/v1/archive_symbols?select=id,symbol&limit=10000', { headers: H })).json()).map(x => [x.symbol, x.id]));
const only = new Set((process.env.SYMBOLS || '').toUpperCase().split(/[\s,;]+/).filter(Boolean));
const months = new Set((process.env.MONTHS || '').split(/[\s,;]+/).filter(Boolean));
async function dbRows(table, id, lo, hi) {
  const out = new Map(); let after = lo - 1;
  for (;;) { const rows = await (await get(`${SB}/rest/v1/${table}?select=unix,o,h,l,c,v&symbol_id=eq.${id}&unix=gt.${after}&unix=lt.${hi}&order=unix.asc&limit=1000`, { headers: H })).json();
    rows.forEach(r => out.set(r.unix, r)); if (rows.length < 1000) break; after = rows[rows.length - 1].unix; }
  return out;
}
const tot = { files: 0, shaBad: 0, countBad: 0, compared: 0, days: 0, missingInFile: 0, missingInDb: 0, diff: 0, ex: [] };
for (const [sym, ms] of Object.entries(man.files || {})) {
  if (only.size && !only.has(sym)) continue;
  for (const [ym, meta] of Object.entries(ms)) {
    if (months.size && !months.has(ym)) continue;
    const r = await get(`${W}/xa/hist/file/${encodeURIComponent(sym)}/${ym}`);
    const gz = Buffer.from(await r.arrayBuffer()); tot.files++;
    if (createHash('sha256').update(gz).digest('hex') !== meta.sha256) { tot.shaBad++; tot.ex.push(`${sym} ${ym}: SHA-256 differs from the manifest`); continue; }
    const lines = gunzipSync(gz).toString().trim().split('\n').slice(1);
    const file = new Map(lines.map(l => { const f = l.split(',').map(Number); return [f[0], { o: f[1], h: f[2], l: f[3], c: f[4], v: f[5] }]; }));
    const isReg = u => { const m = et(u).mod; return m >= 570 && m < 960; };
    let reg = 0, ext = 0; for (const u of file.keys()) isReg(u) ? reg++ : ext++;
    // a half day's 13:00-16:00 minutes are pre/after in the file but "regular hours" by the clock; count by the clock only as a sanity check
    if (reg + ext !== meta.reg + meta.ext) { tot.countBad++; tot.ex.push(`${sym} ${ym}: ${reg + ext} rows, manifest says ${meta.reg + meta.ext}`); }
    const id = ids[sym]; if (id == null) continue;
    const us = [...file.keys()]; const lo = Math.min(...us), hi = Math.max(...us) + 60;
    const [dbR, dbE] = await Promise.all([dbRows('archive_bars', id, lo, hi), dbRows('archive_ext_bars', id, lo, hi)]);
    const dbDays = new Set([...dbR.keys()].map(u => et(u).date));                // days the database holds (regular)
    const dbEDays = new Set([...dbE.keys()].map(u => et(u).date));
    tot.days += dbDays.size;
    const cmp = (u, a, b) => { tot.compared++; if (a.o !== b.o || a.h !== b.h || a.l !== b.l || a.c !== b.c || a.v !== b.v) { tot.diff++; if (tot.ex.length < 40) tot.ex.push(`${sym} ${et(u).date} ${u}: file ${a.o}/${a.h}/${a.l}/${a.c}/${a.v} db ${b.o}/${b.h}/${b.l}/${b.c}/${b.v}`); } };
    for (const [u, a] of file) {
      const d = et(u).date, db = dbR.get(u) || dbE.get(u);
      if (db) cmp(u, a, db);
      else if ((dbR.size && dbDays.has(d) && isReg(u)) || (dbEDays.has(d) && !isReg(u))) { tot.missingInDb++; if (tot.ex.length < 40) tot.ex.push(`${sym} ${d} ${u}: in the file, not in the database`); }
    }
    for (const u of [...dbR.keys(), ...dbE.keys()]) if (!file.has(u)) { tot.missingInFile++; if (tot.ex.length < 40) tot.ex.push(`${sym} ${et(u).date} ${u}: in the database, not in the file`); }
  }
}
console.log(`\n## history files vs database\nfiles checked: ${tot.files} (SHA-256 wrong: ${tot.shaBad}, row count wrong: ${tot.countBad})\nsymbol-days the database also holds: ${tot.days}\nminutes compared: ${tot.compared}\ndifferent: ${tot.diff}\nin the database but not in the file: ${tot.missingInFile}\nin the file but not in the database: ${tot.missingInDb}${tot.ex.length ? '\nexamples:\n  ' + tot.ex.slice(0, 40).join('\n  ') : ''}`);
const ok = !tot.shaBad && !tot.countBad && !tot.diff && !tot.missingInFile && !tot.missingInDb;
console.log(`HIST_CHECK_VERDICT: ${ok ? 'PASS' : 'FAIL'}`);
if (!ok) process.exit(1);
