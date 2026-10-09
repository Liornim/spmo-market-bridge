// Main table (`bars`) <- archive_bars for the last 7 sessions.
// The archive is the Alpaca-synced source of truth (tools/archive_sync.mjs);
// `bars` is a 7-session working copy of it. Writes only what differs:
// a missing minute is inserted, a minute whose price or volume differs is
// updated (prices only — revisions / first_seen / updated_at are left alone).
// An upsert row must carry every NOT NULL column (date, time) even when it only
// updates: Postgres checks the INSERT half first (2026-10-09: every update
// failed, 27 minutes of retries).
// Minutes the archive does not have are left as they are; bars_trim and the
// audits deal with the table's shape.
// Env: SUPABASE_URL, SUPABASE_KEY, ALPACA_KEY_ID, ALPACA_SECRET_KEY, SYMBOLS (optional), SESSIONS (default 7), DRY_RUN=1.
const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), KEY = process.env.SUPABASE_KEY || '';
const AK = process.env.ALPACA_KEY_ID, AS = process.env.ALPACA_SECRET_KEY;
const N = Math.max(1, parseInt(process.env.SESSIONS || '7', 10));
const DRY = process.env.DRY_RUN === '1';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const et = u => { const p = Object.fromEntries(fmt.formatToParts(new Date(u * 1000)).map(x => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` }; };
async function rq(path, opts = {}) {
  for (let a = 1; ; a++) {
    const r = await fetch(SB + '/rest/v1/' + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
    if (r.status < 300) return r;
    if (a >= 4) throw new Error(`${opts.method || 'GET'} ${path.slice(0, 90)} -> HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    await sleep(1500 * a);
  }
}
if (!SB || !KEY || !AK || !AS) { console.log('SUPABASE / ALPACA credentials missing'); console.log('FILL_VERDICT: FAIL'); process.exit(1); }

const today = et(Math.floor(Date.now() / 1000)).date;
const from = et(Math.floor(Date.now() / 1000) - 20 * 86400).date;
const calR = await fetch(`https://paper-api.alpaca.markets/v2/calendar?start=${from}&end=${today}`, { headers: { 'APCA-API-KEY-ID': AK, 'APCA-API-SECRET-KEY': AS } });
if (calR.status !== 200) { console.log('alpaca calendar HTTP ' + calR.status); console.log('FILL_VERDICT: FAIL'); process.exit(1); }
const sess = (await calR.json()).map(d => d.date).slice(-N);
const lo = Math.floor(Date.parse(sess[0] + 'T00:00:00Z') / 1000), hi = Math.floor(Date.parse(today + 'T23:59:59Z') / 1000) + 86400;
let syms = await (await rq('archive_symbols?select=id,symbol&order=symbol.asc&limit=10000')).json();
const only = new Set((process.env.SYMBOLS || '').toUpperCase().split(/[\s,;]+/).filter(Boolean));
if (only.size) syms = syms.filter(s => only.has(s.symbol));
console.log(`main table <- archive: ${syms.length} symbols, sessions ${sess[0]}..${sess[sess.length - 1]}${DRY ? ' — DRY RUN' : ''}`);

const tot = { ins: 0, upd: 0, failed: [] };
for (const [i, s] of syms.entries()) {
  try {
    const arch = new Map(), have = new Map(); let after = lo - 1;
    for (;;) {
      const rows = await (await rq(`archive_bars?select=unix,o,h,l,c,v&symbol_id=eq.${s.id}&unix=gt.${after}&unix=lt.${hi}&order=unix.asc&limit=1000`)).json();
      for (const r of rows) if (sess.includes(et(r.unix).date)) arch.set(r.unix, r);
      if (rows.length < 1000) break; after = rows[rows.length - 1].unix;
    }
    after = lo - 1;
    for (;;) {
      const rows = await (await rq(`bars?select=unix,open,high,low,close,volume&symbol=eq.${encodeURIComponent(s.symbol)}&unix=gt.${after}&order=unix.asc&limit=1000`)).json();
      rows.forEach(r => have.set(r.unix, r)); if (rows.length < 1000) break; after = rows[rows.length - 1].unix;
    }
    const ins = [], upd = [];
    for (const [u, a] of arch) {
      const b = { open: a.o / 1e4, high: a.h / 1e4, low: a.l / 1e4, close: a.c / 1e4, volume: a.v }, h = have.get(u);
      if (!h) { const t = et(u); ins.push({ symbol: s.symbol, unix: u, date: t.date, time: t.time, ...b, revisions: 0, first_seen: null, updated_at: null }); }
      else if (Math.round(h.open * 1e4) !== a.o || Math.round(h.high * 1e4) !== a.h || Math.round(h.low * 1e4) !== a.l || Math.round(h.close * 1e4) !== a.c || Math.round(h.volume) !== a.v) { const t = et(u); upd.push({ symbol: s.symbol, unix: u, date: t.date, time: t.time, ...b }); }
    }
    if (!DRY) for (const [rows, label] of [[ins, 'ins'], [upd, 'upd']]) for (let k = 0; k < rows.length; k += 1000)
      await rq('bars?on_conflict=symbol,unix', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows.slice(k, k + 1000)) });
    tot.ins += ins.length; tot.upd += upd.length;
    console.log(`[${i + 1}/${syms.length}] ${s.symbol}: archive ${arch.size}, inserted ${ins.length}, corrected ${upd.length}`);
  } catch (e) { tot.failed.push(`${s.symbol}: ${e.message}`); console.log(`[${i + 1}/${syms.length}] ${s.symbol} FAILED ${e.message}`); }
}
console.log(`\n## main table <- archive\nsessions: ${sess.join(', ')}\nminutes inserted: ${tot.ins}\nminutes corrected to the archive: ${tot.upd}\nsymbols failed: ${tot.failed.length}${tot.failed.length ? '\n  ' + tot.failed.join('\n  ') : ''}`);
console.log(`FILL_VERDICT: ${tot.failed.length ? 'FAIL' : 'PASS'}`);
if (tot.failed.length) process.exit(1);
