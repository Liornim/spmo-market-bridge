// Full audit of archive_bars: reads EVERY row of every symbol (keyset pages of
// 1,000 on the primary key) and checks, per symbol per NYSE session from
// AUDIT_FROM to the last completed session:
//   - 390 canonical minutes (09:30..15:59 ET, minute-aligned), listing any gap
//   - rows outside the session or not minute-aligned (non-canonical)
//   - invalid prices: any of o/h/l/c <= 0, h < max(o,c,l), l > min(o,c,h), v < 0
// Writes .github/audit/archive_audit.csv and prints a summary.
import { writeFileSync, mkdirSync } from 'node:fs';

const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_KEY || '';
const FROM = process.env.AUDIT_FROM || '2026-08-26';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const HOLIDAYS = new Set(['2026-09-07']);       // Labor Day; no other NYSE holiday or early close in this span
const YAHOO_FLOOR = Math.floor(Date.now() / 1000) - 30 * 86400;

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
function et(u) {
  const p = fmt.formatToParts(new Date(u * 1000)).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`, s: +p.second };
}
function sessions() {
  const now = et(Math.floor(Date.now() / 1000));
  const last = now.hm >= '16:00' ? now.date : (() => { const d = new Date(now.date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
  const out = [];
  for (let d = new Date(FROM + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10), w = d.getUTCDay();
    if (w !== 0 && w !== 6 && !HOLIDAYS.has(k)) out.push(k);
  }
  return out;
}
const MINUTES = []; for (let m = 570; m < 960; m++) MINUTES.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));

async function get(path) {
  for (let a = 1; ; a++) {
    const r = await fetch(SB + '/rest/v1/' + path, { headers: H });
    if (r.status < 300) return r.json();
    if (a >= 4) throw new Error(path.slice(0, 90) + ' -> HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
    await new Promise(x => setTimeout(x, 1500 * a));
  }
}
function ranges(list) {               // ["09:31","09:32","10:05"] -> "09:31-09:32,10:05"
  const idx = list.map(t => MINUTES.indexOf(t)).sort((a, b) => a - b), out = [];
  for (let i = 0; i < idx.length; i++) { let j = i; while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
    out.push(i === j ? MINUTES[idx[i]] : MINUTES[idx[i]] + '-' + MINUTES[idx[j]]); i = j; }
  return out.join(' ');
}

async function main() {
  if (!SB || !KEY) throw new Error('SUPABASE_URL / SUPABASE_KEY missing');
  const days = sessions();
  const only = new Set((process.env.SYMBOLS || '').toUpperCase().split(/[\s,;]+/).filter(Boolean));  // SYMBOLS (optional): audit only these
  const syms = (await get('archive_symbols?select=id,symbol&order=symbol.asc&limit=10000')).filter(s => !only.size || only.has(s.symbol));
  console.log(`auditing ${syms.length} symbols x ${days.length} sessions (${days[0]} .. ${days[days.length - 1]})`);
  const csv = ['symbol,date,bars,missing,noncanonical,invalid,fillable,status,missing_minutes'];
  const perDate = Object.fromEntries(days.map(d => [d, { ok: 0, bars: 0 }]));
  const problems = []; let total = 0, invalidTotal = 0, noncanTotal = 0;
  for (const [i, s] of syms.entries()) {
    const by = {}; let after = null;
    for (;;) {
      const rows = await get(`archive_bars?select=unix,o,h,l,c,v&symbol_id=eq.${s.id}&order=unix.asc&limit=1000` + (after != null ? `&unix=gt.${after}` : ''));
      for (const r of rows) {
        total++;
        const t = et(r.unix), e = by[t.date] || (by[t.date] = { have: new Set(), non: 0, bad: 0 });
        if (r.unix % 60 !== 0 || t.hm < '09:30' || t.hm > '15:59') { e.non++; continue; }
        e.have.add(t.hm);
        if ([r.o, r.h, r.l, r.c].some(x => !(x > 0)) || r.h < Math.max(r.o, r.c, r.l) || r.l > Math.min(r.o, r.c, r.h) || r.v < 0) e.bad++;
      }
      if (rows.length < 1000) break;
      after = rows[rows.length - 1].unix;
    }
    let symOk = 0;
    for (const d of days) {
      const e = by[d] || { have: new Set(), non: 0, bad: 0 };
      const miss = MINUTES.filter(m => !e.have.has(m));
      const fillable = Math.floor(Date.parse(d + 'T20:00:00Z') / 1000) >= YAHOO_FLOOR;
      const status = e.have.size === 0 ? 'EMPTY' : miss.length ? 'SHORT' : e.bad ? 'INVALID' : 'OK';
      if (status === 'OK') { symOk++; perDate[d].ok++; }
      perDate[d].bars += e.have.size; invalidTotal += e.bad; noncanTotal += e.non;
      csv.push([s.symbol, d, e.have.size, miss.length, e.non, e.bad, fillable ? 'yes' : 'no', status, miss.length && miss.length < 390 ? ranges(miss) : ''].join(','));
      if (status !== 'OK') problems.push(`${s.symbol} ${d} ${status} bars=${e.have.size} missing=${miss.length}${e.bad ? ' invalid=' + e.bad : ''} ${fillable ? '(fillable from Yahoo)' : '(older than Yahoo 30d)'}${miss.length && miss.length < 60 ? ' [' + ranges(miss) + ']' : ''}`);
    }
    console.log(`[${i + 1}/${syms.length}] ${s.symbol}: ${symOk}/${days.length} sessions complete`);
  }
  mkdirSync('.github/audit', { recursive: true });
  writeFileSync('.github/audit/archive_audit.csv', csv.join('\n') + '\n');
  const okAll = Object.values(perDate).reduce((a, x) => a + x.ok, 0), cells = syms.length * days.length;
  console.log(`\n## archive audit\nrows read: ${total}; symbol-sessions: ${cells}; complete: ${okAll}; not complete: ${cells - okAll}; invalid bars: ${invalidTotal}; non-canonical rows: ${noncanTotal}`);
  console.log('\n| date | symbols complete | bars | expected |\n|---|---|---|---|');
  for (const d of days) console.log(`| ${d} | ${perDate[d].ok}/${syms.length} | ${perDate[d].bars} | ${syms.length * 390} |`);
  const fillable = problems.filter(p => p.includes('fillable from Yahoo'));
  console.log(`\nnot complete: ${problems.length} (fillable from Yahoo: ${fillable.length}; older than 30d: ${problems.length - fillable.length})`);
  problems.slice(0, 400).forEach(p => console.log('  ' + p));
}
main().catch(e => { console.error(e); process.exit(1); });
