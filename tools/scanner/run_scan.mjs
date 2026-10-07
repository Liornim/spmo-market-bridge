// Run the Opportunity Scanner over the database and write the report.
//
// Reads, for every archive symbol: all of archive_bars (the whole history), then
// the main table `bars` (the last 7 sessions, which the Worker also writes during
// the session, so it can be fresher than the archive). Where both hold a minute,
// the main table's value is used. Nothing is filled in.
//
// Writes scan/latest.json, scan/opportunity_scan_all.csv,
// scan/opportunity_candidates.csv, and prints the FINAL OUTPUT summary.
import { writeFileSync, mkdirSync } from 'node:fs';
import { scanAll, toCsv, candidates, COLUMNS } from './engine.mjs';

const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_KEY || '';
const OUT = process.env.SCAN_OUT || 'scan';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const SCALE = 10000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path) {
  for (let a = 1; ; a++) {
    const r = await fetch(SB + '/rest/v1/' + path, { headers: H });
    if (r.status < 300) return r.json();
    if (a >= 4) throw new Error(path.slice(0, 90) + ' -> HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
    await sleep(1500 * a);
  }
}
async function pages(path) {
  const out = []; let after = null;
  for (;;) {
    const rows = await get(path + '&order=unix.asc&limit=1000' + (after != null ? '&unix=gt.' + after : ''));
    out.push(...rows);
    if (rows.length < 1000) return out;
    after = rows[rows.length - 1].unix;
  }
}

async function main() {
  if (!SB || !KEY) throw new Error('SUPABASE_URL / SUPABASE_KEY missing');
  const t0 = Date.now();
  const syms = await get('archive_symbols?select=id,symbol&order=symbol.asc&limit=10000');
  const bars = {};
  let i = 0, rowsRead = 0;
  const worker = async () => {
    while (i < syms.length) {
      const s = syms[i++];
      const arch = await pages(`archive_bars?select=unix,o,h,l,c,v&symbol_id=eq.${s.id}`);
      const main = await pages(`bars?select=unix,open,high,low,close,volume&symbol=eq.${encodeURIComponent(s.symbol)}`);
      const m = new Map();
      for (const r of arch) m.set(r.unix, { u: r.unix, o: r.o / SCALE, h: r.h / SCALE, l: r.l / SCALE, c: r.c / SCALE, v: r.v });
      for (const r of main) m.set(r.unix, { u: r.unix, o: r.open, h: r.high, l: r.low, c: r.close, v: r.volume });
      bars[s.symbol] = [...m.values()];
      rowsRead += arch.length + main.length;
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  const now = Math.floor(Date.now() / 1000);
  const { rows, summary } = scanAll({ bars, now });
  const clean = rows.map(r => Object.fromEntries(COLUMNS.map(c => [c, r[c]]).concat([['data_quality_detail', r._dq_detail || null]])));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/opportunity_scan_all.csv`, toCsv(rows.slice().sort((a, b) => a.symbol < b.symbol ? -1 : 1)));
  writeFileSync(`${OUT}/opportunity_candidates.csv`, toCsv(candidates(rows)));
  writeFileSync(`${OUT}/latest.json`, JSON.stringify({ summary, rows: clean, source: { symbols: syms.length, rows_read: rowsRead, seconds: Math.round((Date.now() - t0) / 1000) } }));
  const top = (list, f) => list.map(s => rows.find(r => r.symbol === s)).map(f).join('\n') || '  (none)';
  console.log(`Scanned: ${summary.scanned}
Short-Term READY: ${summary.short_ready}
Short-Term ARMED: ${summary.short_armed}
Short-Term WATCH: ${summary.short_watch}
Long-Term BUY NOW: ${summary.long_buy_now}
Long-Term BUY LOWER: ${summary.long_buy_lower}
Data Warnings: ${summary.data_warnings}

Top 5 Short-Term
${top(summary.top_short, r => `  #${r.short_term_rank} ${r.symbol} ${r.short_term_status} ${r.short_term_score} ${r.short_term_setup} ${r.short_term_entry_action || ''} stop ${r.short_term_stop_price ?? ''} T1 ${r.short_term_target_1 ?? ''} T2 ${r.short_term_target_2 ?? ''}`)}

Top 5 Long-Term Price Opportunities
${top(summary.top_long, r => `  #${r.long_term_rank} ${r.symbol} ${r.long_term_status} ${r.long_term_score} ${r.long_term_buy_action || ''} pct ${r.long_term_price_percentile} T1 ${r.long_term_target_1 ?? ''} inval ${r.long_term_invalidation_price ?? ''}`)}

(${syms.length} symbols, ${rowsRead} rows read, ${Math.round((Date.now() - t0) / 1000)}s)`);
}
main().catch(e => { console.error(e); process.exit(1); });
