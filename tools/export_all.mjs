// Every candle of every symbol in the archive, as CSV files for the nightly
// e-mail (.github/workflows/export.yml). Same columns as the /bars downloads:
// symbol,date,time,open,high,low,close,volume (New York time, session minutes).
// The rows are split into parts of at most PART_ROWS so each part opens in Excel
// (its limit is 1,048,576 rows). Writes into OUT_DIR and prints a summary.
import { mkdirSync, createWriteStream } from 'node:fs';

const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), KEY = process.env.SUPABASE_KEY || '';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const OUT = process.env.OUT_DIR || 'export';
const PART_ROWS = +(process.env.PART_ROWS || 900000);
// TABLE=archive_ext_bars exports the pre/after-market archive instead (prices
// only; Yahoo has no extended-hours volume), with a session column (pre/after).
const EXT = process.env.TABLE === 'archive_ext_bars', TABLE = EXT ? 'archive_ext_bars' : 'archive_bars';
const PREFIX = EXT ? 'candles_ext' : 'candles';
const HEAD = 'symbol,date,time,open,high,low,close,volume' + (EXT ? ',session' : '') + '\n';

// New York time: one Intl lookup per UTC day
const hf = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }), off = {};
const etOff = u => { const d = Math.floor(u / 86400); if (off[d] === undefined) off[d] = ((+hf.format(new Date((d * 86400 + 57600) * 1000))) % 24 - 16) * 3600; return off[d]; };
const p2 = n => (n < 10 ? '0' : '') + n;
function et(u) { const d = new Date((u + etOff(u)) * 1000), h = d.getUTCHours(), m = d.getUTCMinutes();
  return { date: d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()), time: p2(h) + ':' + p2(m), mod: h * 60 + m }; }
const px = x => String(x / 10000);

async function get(path) {
  for (let a = 1; ; a++) {
    const r = await fetch(SB + '/rest/v1/' + path, { headers: H });
    if (r.status < 300) return r.json();
    if (a >= 5) throw new Error(path.slice(0, 90) + ' -> HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
    await new Promise(x => setTimeout(x, 1500 * a));
  }
}

mkdirSync(OUT, { recursive: true });
const syms = await get('archive_symbols?select=id,symbol&order=symbol.asc&limit=10000');
let part = 0, inPart = 0, total = 0, out = null; const parts = [], perSym = [];
const open = () => { part++; inPart = 0; const f = `${OUT}/${PREFIX}_part${part}.csv`; parts.push(f); out = createWriteStream(f); out.write(HEAD); };
const write = s => new Promise(ok => out.write(s) ? ok() : out.once('drain', ok));
open();
let first = null, last = null;
for (const s of syms) {
  let after = null, n = 0;
  for (;;) {
    const rows = await get(`${TABLE}?select=unix,o,h,l,c,v&symbol_id=eq.${s.id}&order=unix.asc&limit=1000` + (after != null ? `&unix=gt.${after}` : ''));
    let buf = '';
    for (const r of rows) {
      if (r.unix % 60) continue;
      const e = et(r.unix);
      if (EXT ? (e.mod >= 570 && e.mod < 960) : (e.mod < 570 || e.mod >= 960)) continue;   // regular: session minutes only, like the page
      if (inPart >= PART_ROWS) { await write(buf); buf = ''; await new Promise(ok => out.end(ok)); open(); }
      buf += `${s.symbol},${e.date},${e.time},${px(r.o)},${px(r.h)},${px(r.l)},${px(r.c)},${r.v}${EXT ? (e.mod < 570 ? ',pre' : ',after') : ''}\n`;
      inPart++; n++; total++;
      if (!first || e.date < first) first = e.date; if (!last || e.date > last) last = e.date;
    }
    await write(buf);
    if (rows.length < 1000) break;
    after = rows[rows.length - 1].unix;
  }
  perSym.push(`${s.symbol}:${n}`);
}
await new Promise(ok => out.end(ok));
console.log(`EXPORT: ${syms.length} symbols, ${total} candles, ${first}..${last}, ${parts.length} part(s) of up to ${PART_ROWS} rows`);
console.log(`EXPORT_SUMMARY${EXT ? '_EXT' : ''}=${syms.length} מניות · ${total.toLocaleString('en-US')} נרות · ${first} עד ${last}`);
console.log('per symbol: ' + perSym.join(' '));
