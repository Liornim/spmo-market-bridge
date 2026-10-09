// History files: one gzip CSV per symbol per CLOSED month, in R2 (bucket
// bars-history) through the Worker's /xa/hist routes.
//
//   <SYM>/<YYYY-MM>.csv.gz   header unix,o,h,l,c,v  (prices x1e4, like the DB)
//                            regular minutes AND pre/after minutes, sorted by unix
//   manifest.json            { files: { SYM: { "YYYY-MM": {reg, ext, days, bytes, sha256} } } }
//
// Source: Alpaca SIP (all exchanges), adjustment=raw — the same source and the
// same rules as the database (tools/archive_sync.mjs, tools/ext_sync.mjs):
//   regular session: Alpaca's market calendar gives each day's open/close (a
//     half day ends at 13:00); a minute without a trade is carried flat at the
//     last close with volume 0; a day without any trade is not written.
//   pre/after: Alpaca's bars as they are (04:00-open, close-20:00 New York), no fill.
// Every file is read back after the upload and must have the same SHA-256.
//
// Env: ALPACA_KEY_ID, ALPACA_SECRET_KEY, SUPABASE_URL, SUPABASE_KEY (symbol list
//      and the write key), FROM=YYYY-MM (default 60 months back), TO=YYYY-MM
//      (default the last closed month), SYMBOLS (optional), FORCE=1 (rebuild files
//      that exist), WORKER_URL.
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const W = (process.env.WORKER_URL || 'https://spmo-market-bridge.noamharelnim.workers.dev').replace(/\/$/, '');
const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), KEY = process.env.SUPABASE_KEY || '';
const AK = process.env.ALPACA_KEY_ID, AS = process.env.ALPACA_SECRET_KEY;
const FORCE = process.env.FORCE === '1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha = b => createHash('sha256').update(b).digest('hex');
const WKEY = sha(KEY + ':hist-write');
if (!SB || !KEY || !AK || !AS) { console.log('SUPABASE / ALPACA credentials missing'); console.log('HIST_VERDICT: FAIL'); process.exit(1); }

const nyF = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const etDate = u => nyF.format(new Date(u * 1000));
const pf = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
function etWall(date, hm) {
  const [y, m, d] = date.split('-').map(Number), [hh, mm] = hm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm) / 1000;
  const off = t => { const p = Object.fromEntries(pf.formatToParts(new Date(t * 1000)).map(x => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) / 1000 - t; };
  let t = guess - off(guess); if (off(t) !== off(guess)) t = guess - off(t);
  return t;
}
const addMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const thisMonth = etDate(Math.floor(Date.now() / 1000)).slice(0, 7);
const TO = /^\d{4}-\d{2}$/.test(process.env.TO || '') ? process.env.TO : addMonth(thisMonth, -1);
const FROM = /^\d{4}-\d{2}$/.test(process.env.FROM || '') ? process.env.FROM : addMonth(thisMonth, -60);
if (TO >= thisMonth) { console.log(`TO=${TO} is not a closed month (now ${thisMonth})`); console.log('HIST_VERDICT: FAIL'); process.exit(1); }

async function alpaca(url) {
  for (let a = 1; ; a++) {
    const r = await fetch(url, { headers: { 'APCA-API-KEY-ID': AK, 'APCA-API-SECRET-KEY': AS } });
    if (r.status === 200) return r.json();
    if (a >= 6 || (r.status !== 429 && r.status < 500)) throw new Error(`alpaca HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
    await sleep(r.status === 429 ? 15000 : 2000 * a);
  }
}
async function worker(path, opts = {}) {
  for (let a = 1; ; a++) {
    const r = await fetch(W + path, opts).catch(e => ({ status: 0, text: async () => String(e) }));
    if (r.status && r.status < 500 && r.status !== 429) return r;
    if (a >= 5) throw new Error(`worker ${path} -> ${r.status} ${(await r.text()).slice(0, 160)}`);
    await sleep(2000 * a);
  }
}

// symbols
let syms = (await (await fetch(SB + '/rest/v1/archive_symbols?select=symbol&order=symbol.asc&limit=10000', { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })).json()).map(r => r.symbol);
const only = new Set((process.env.SYMBOLS || '').toUpperCase().split(/[\s,;]+/).filter(Boolean));
if (only.size) syms = syms.filter(s => only.has(s));
const toA = s => s.replace(/-/g, '.');

// manifest
let manifest = { version: 1, files: {} };
{ const r = await worker('/xa/hist/manifest'); if (r.status === 200) manifest = await r.json(); else if (r.status !== 404) throw new Error('manifest HTTP ' + r.status); }
manifest.files = manifest.files || {};
async function saveManifest() {
  manifest.updated_at = new Date().toISOString();
  const r = await worker('/xa/hist/manifest', { method: 'PUT', headers: { 'X-Hist-Key': WKEY, 'Content-Type': 'application/json' }, body: JSON.stringify(manifest) });
  if (r.status !== 200) throw new Error('manifest PUT ' + r.status + ' ' + (await r.text()).slice(0, 160));
}

// calendar for the whole range (+ a week before for the carry-forward seed)
const calFrom = new Date(Date.parse(FROM + '-01T12:00:00Z') - 10 * 86400e3).toISOString().slice(0, 10);
const calTo = new Date(Date.parse(addMonth(TO, 1) + '-01T12:00:00Z') - 86400e3).toISOString().slice(0, 10);
const cal = (await alpaca(`https://paper-api.alpaca.markets/v2/calendar?start=${calFrom}&end=${calTo}`))
  .map(d => ({ date: d.date, open: etWall(d.date, d.open), close: etWall(d.date, d.close), pre: etWall(d.date, '04:00'), post: etWall(d.date, '20:00') }));
const dayOf = new Map(cal.map(d => [d.date, d]));
console.log(`history files: ${syms.length} symbols, ${FROM}..${TO}, ${cal.length} calendar days${FORCE ? ', FORCE' : ''}`);

const tot = { files: 0, skipped: 0, reg: 0, ext: 0, bytes: 0, empty: 0, failed: [] };
const lastClose = new Map();       // symbol -> last regular close (x1e4), carried across months

for (let ym = FROM; ym <= TO; ym = addMonth(ym, 1)) {
  const days = cal.filter(d => d.date.startsWith(ym));
  if (!days.length) continue;
  const todo = syms.filter(s => FORCE || !manifest.files[s]?.[ym]);
  const build = new Set(todo);
  for (const s of syms) if (!build.has(s)) lastClose.delete(s);   // a skipped month leaves no valid carry-forward close
  if (!todo.length) { tot.skipped += syms.length; continue; }
  tot.skipped += syms.length - todo.length;
  // fetch a week earlier when any symbol has no carry-forward close yet (first month, or after a skip)
  const prevDays = cal.filter(d => d.date < days[0].date).slice(-5);
  const start = (todo.every(s => lastClose.has(s)) ? days[0] : (prevDays[0] || days[0])).pre;
  const end = days[days.length - 1].post;
  const got = new Map(todo.map(s => [s, []]));
  const fromA = new Map(todo.map(s => [toA(s), s]));
  for (let i = 0; i < todo.length; i += 20) {
    const group = todo.slice(i, i + 20);
    let tok = null;
    try {
      do {
        const j = await alpaca(`https://data.alpaca.markets/v2/stocks/bars?symbols=${encodeURIComponent(group.map(toA).join(','))}&timeframe=1Min&feed=sip&adjustment=raw&limit=10000&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}${tok ? '&page_token=' + tok : ''}`);
        for (const [as, bars] of Object.entries(j.bars || {})) { const arr = got.get(fromA.get(as) || as); if (arr) for (const b of bars) arr.push(b); }
        tok = j.next_page_token;
      } while (tok);
    } catch (e) { for (const s of group) if (build.has(s)) tot.failed.push(`${s} ${ym}: ${e.message}`); for (const s of group) got.delete(s); }
  }
  const uploads = [];
  for (const s of todo) {
    const raw = got.get(s); if (!raw) continue;
    const reg = new Map(), ext = [];
    for (const b of raw) {
      const u = Math.floor(Date.parse(b.t) / 1000), d = dayOf.get(etDate(u)); if (!d || u % 60) continue;
      const row = { u, o: Math.round(b.o * 1e4), h: Math.round(b.h * 1e4), l: Math.round(b.l * 1e4), c: Math.round(b.c * 1e4), v: Math.round(b.v) };
      if (u >= d.open && u < d.close) reg.set(u, row); else if (u >= d.pre && u < d.post) ext.push(row);
    }
    // carry-forward seed from the days before this month (first month of the run only)
    let last = lastClose.get(s) ?? null;
    if (last == null) for (const d of prevDays) for (let u = d.open; u < d.close; u += 60) if (reg.has(u)) last = reg.get(u).c;
    const rows = []; let nReg = 0, nDays = 0;
    for (const d of days) {
      let traded = false; for (let u = d.open; u < d.close; u += 60) if (reg.has(u)) { traded = true; break; }
      if (!traded) continue;
      nDays++;
      for (let u = d.open; u < d.close; u += 60) {
        const b = reg.get(u);
        if (b) { last = b.c; rows.push(b); } else if (last != null) rows.push({ u, o: last, h: last, l: last, c: last, v: 0 });
        else continue;
        nReg++;
      }
    }
    if (last != null) lastClose.set(s, last);
    if (!build.has(s)) continue;
    const extIn = ext.filter(r => r.u >= days[0].pre);
    if (!nReg && !extIn.length) { tot.empty++; continue; }        // no trades this month (not listed yet)
    for (const r of extIn) rows.push(r);
    rows.sort((x, y) => x.u - y.u);
    const csv = 'unix,o,h,l,c,v\n' + rows.map(r => `${r.u},${r.o},${r.h},${r.l},${r.c},${r.v}`).join('\n') + '\n';
    const gz = gzipSync(Buffer.from(csv), { level: 9 });
    uploads.push({ s, gz, meta: { reg: nReg, ext: extIn.length, days: nDays, bytes: gz.length, sha256: sha(gz) } });
  }
  // upload 6 at a time, each read back and compared
  for (let k = 0; k < uploads.length; k += 6) {
    await Promise.all(uploads.slice(k, k + 6).map(async x => {
      try {
        const p = `/xa/hist/file/${encodeURIComponent(x.s)}/${ym}`;
        const r = await worker(p, { method: 'PUT', headers: { 'X-Hist-Key': WKEY, 'Content-Type': 'application/gzip' }, body: x.gz });
        if (r.status !== 200) throw new Error('PUT ' + r.status + ' ' + (await r.text()).slice(0, 120));
        const back = Buffer.from(await (await worker(p)).arrayBuffer());
        if (sha(back) !== x.meta.sha256) throw new Error('read-back SHA-256 differs');
        gunzipSync(back);                                           // and it must decompress
        (manifest.files[x.s] = manifest.files[x.s] || {})[ym] = x.meta;
        tot.files++; tot.reg += x.meta.reg; tot.ext += x.meta.ext; tot.bytes += x.meta.bytes;
      } catch (e) { tot.failed.push(`${x.s} ${ym}: ${e.message}`); }
    }));
  }
  await saveManifest();
  console.log(`${ym}: ${uploads.length} files, ${days.length} trading days · total so far ${tot.files} files, ${(tot.bytes / 1048576).toFixed(1)} MB, failed ${tot.failed.length}`);
}

const all = Object.values(manifest.files).reduce((a, m) => a + Object.keys(m).length, 0);
const allBytes = Object.values(manifest.files).reduce((a, m) => a + Object.values(m).reduce((b, x) => b + x.bytes, 0), 0);
console.log(`\n## history files (R2)\nrange: ${FROM}..${TO}\nfiles written: ${tot.files} (regular minutes ${tot.reg}, pre/after minutes ${tot.ext}, ${(tot.bytes / 1048576).toFixed(1)} MB)\nalready there (skipped): ${tot.skipped}\nsymbol-months without trades (not listed yet): ${tot.empty}\nfiles in the bucket: ${all}, ${(allBytes / 1048576).toFixed(1)} MB\nfailed: ${tot.failed.length}${tot.failed.length ? '\n  ' + tot.failed.slice(0, 30).join('\n  ') : ''}`);
console.log(`HIST_VERDICT: ${tot.failed.length ? 'FAIL' : 'PASS'}`);
if (tot.failed.length) process.exit(1);
