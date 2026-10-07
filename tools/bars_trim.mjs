// Keep the main table (`bars`) at exactly the last 7 NYSE sessions.
//
// 1. The 7 sessions are taken from Yahoo itself (SPY, 1m, range=7d), so
//    holidays and early closes never need a hand-kept calendar.
// 2. For every symbol, before anything is deleted, the rows older than the
//    window are counted in `bars` and in `archive_bars` over the same time span.
//    A symbol is trimmed only when the archive holds at least as many canonical
//    minutes as bars does; otherwise it is skipped and reported (FAIL).
// 3. Delete per symbol: bars?symbol=eq.S&date=lt.CUTOFF.
// 4. Verify: bars holds only the 7 dates, and each symbol-date has 390 rows.
// Writes .github/audit/bars_trim.csv and prints a report. DRY_RUN=1 deletes nothing.
import { writeFileSync, mkdirSync } from 'node:fs';

const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_KEY || '';
const DRY = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const KEEP = parseInt(process.env.KEEP_SESSIONS || '7', 10);
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const etDate = u => fmt.format(new Date(u * 1000));

async function rq(path, opts = {}) {
  for (let a = 1; ; a++) {
    const r = await fetch(SB + '/rest/v1/' + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
    if (r.status < 300 || r.status === 416) return r;
    if (a >= 4) throw new Error(`${opts.method || 'GET'} ${path.slice(0, 90)} -> HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    await new Promise(x => setTimeout(x, 1500 * a));
  }
}
async function count(path) {
  const r = await rq(path, { method: 'HEAD', headers: { Prefer: 'count=exact', Range: '0-0' } });
  const n = parseInt((r.headers.get('content-range') || '').split('/')[1], 10);
  return Number.isFinite(n) ? n : 0;
}

const fmtHM = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
const canonical = u => { const t = fmtHM.format(new Date(u * 1000)); return u % 60 === 0 && t >= '09:30' && t <= '15:59'; };
async function pages(path) {
  const out = []; let after = null;
  for (;;) {
    const rows = await (await rq(path + '&order=unix.asc&limit=1000' + (after != null ? '&unix=gt.' + after : ''))).json();
    out.push(...rows.map(r => r.unix));
    if (rows.length < 1000) return out;
    after = rows[rows.length - 1].unix;
  }
}
async function missingFromArchive(s, lo, hi, cutoff) {
  const b = (await pages(`bars?select=unix&symbol=eq.${encodeURIComponent(s.symbol)}&date=lt.${cutoff}`)).filter(canonical);
  const a = new Set(await pages(`archive_bars?select=unix&symbol_id=eq.${s.id}&unix=gte.${lo}&unix=lte.${hi}`));
  return b.filter(u => !a.has(u));
}

async function sessionsFromYahoo() {
  const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1m&range=7d&includePrePost=false',
    { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (r.status !== 200) throw new Error('yahoo SPY HTTP ' + r.status);
  const res = (await r.json())?.chart?.result?.[0];
  const days = new Set((res?.timestamp || []).map(etDate));
  return [...days].sort().slice(-KEEP);
}

async function main() {
  if (!SB || !KEY) throw new Error('SUPABASE_URL / SUPABASE_KEY missing');
  const keep = await sessionsFromYahoo();
  if (keep.length !== KEEP) throw new Error(`expected ${KEEP} sessions from Yahoo, got ${keep.length}: ${keep.join(',')}`);
  const cutoff = keep[0];
  const syms = await (await rq('archive_symbols?select=id,symbol&order=symbol.asc&limit=10000')).json();
  console.log(`keep in bars: ${keep.join(' ')} (cutoff: delete date < ${cutoff})${DRY ? ' — DRY RUN' : ''}`);

  const csv = ['symbol,old_rows_in_bars,archive_rows_same_span,action,deleted'];
  const skipped = []; let deleted = 0;
  for (const s of syms) {
    const sym = encodeURIComponent(s.symbol);
    const old = await count(`bars?select=unix&symbol=eq.${sym}&date=lt.${cutoff}&time=gte.09:30&time=lte.15:59`);
    if (!old) { csv.push(`${s.symbol},0,,nothing to trim,0`); continue; }
    const f = await (await rq(`bars?select=unix&symbol=eq.${sym}&date=lt.${cutoff}&order=unix.asc&limit=1`)).json();
    const l = await (await rq(`bars?select=unix&symbol=eq.${sym}&date=lt.${cutoff}&order=unix.desc&limit=1`)).json();
    const arch = await count(`archive_bars?select=unix&symbol_id=eq.${s.id}&unix=gte.${f[0].unix}&unix=lte.${l[0].unix}`);
    if (arch < old) {
      // Counts can differ because bars may hold junk (rows not on a whole minute)
      // that the archive sync has already removed. Decide minute by minute:
      // every canonical bar about to be deleted must exist in the archive.
      const lost = await missingFromArchive(s, f[0].unix, l[0].unix, cutoff);
      if (lost.length) { skipped.push(`${s.symbol}: ${lost.length} minutes not in archive (first ${lost.slice(0, 3).join(',')})`);
        csv.push(`${s.symbol},${old},${arch},SKIPPED (${lost.length} minutes not in archive),0`); continue; }
    }
    let n = 0;
    if (!DRY) {
      n = await count(`bars?select=unix&symbol=eq.${sym}&date=lt.${cutoff}`);
      await rq(`bars?symbol=eq.${sym}&date=lt.${cutoff}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      deleted += n;
    }
    csv.push(`${s.symbol},${old},${arch},${DRY ? 'would trim' : 'trimmed'},${n}`);
  }

  // Verify the main table: exactly the kept dates, 390 per symbol-date.
  const outside = await count(`bars?select=unix&date=lt.${cutoff}`);
  const bad = []; let cells = 0, okCells = 0;
  for (const s of syms) for (const d of keep) {
    cells++;
    const n = await count(`bars?select=unix&symbol=eq.${encodeURIComponent(s.symbol)}&date=eq.${d}&time=gte.09:30&time=lte.15:59`);
    if (n === 390) okCells++; else bad.push(`${s.symbol} ${d}: ${n}/390`);
  }
  mkdirSync('.github/audit', { recursive: true });
  writeFileSync('.github/audit/bars_trim.csv', csv.join('\n') + '\n');
  const pass = !skipped.length && (DRY || outside === 0) && !bad.length;
  console.log(`\n## main table (bars)\nsessions kept: ${keep.join(', ')}\nrows deleted: ${deleted}; symbols skipped for safety: ${skipped.length}`);
  console.log(`rows older than ${cutoff} left in bars: ${outside}`);
  console.log(`symbol-sessions complete (390/390): ${okCells}/${cells}`);
  skipped.forEach(x => console.log('  SKIPPED ' + x));
  bad.slice(0, 200).forEach(x => console.log('  INCOMPLETE ' + x));
  console.log(`BARS_VERDICT: ${pass ? 'PASS' : 'FAIL'}`);
}
main().catch(e => { console.error(e); console.log('BARS_VERDICT: FAIL (crash)'); process.exit(1); });
