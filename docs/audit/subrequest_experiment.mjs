// Runtime experiment: run the real worker.js scheduled handler against a fetch
// shim that counts every external request and throws Cloudflare's exact error
// once the ceiling is reached. Nothing in worker.js is modified.
// Usage: node docs/audit/subrequest_experiment.mjs [limit] [order]
//   order = alpha | reverse   (reverse renames symbols so the same set is walked backwards)
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const LIMIT = +(process.argv[2] || 50);
const ORDER = process.argv[3] || 'alpha';
const MIRROR = process.argv[4] !== 'nomirror';

// ---- D1 shim (same shape as the test harness)
class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.p = []; }
  bind(...p) { this.p = p; return this; }
  _exec() {
    const s = this.db.prepare(this.sql);
    if (/^\s*(SELECT|WITH|PRAGMA)/i.test(this.sql) || /RETURNING/i.test(this.sql)) {
      const results = s.all(...this.p);
      return { results, meta: { changes: 0, rows_read: results.length } };
    }
    const r = s.run(...this.p);
    return { results: [], meta: { changes: Number(r.changes) || 0, last_row_id: Number(r.lastInsertRowid) || 0 } };
  }
  async all() { return this._exec(); }
  async run() { return this._exec(); }
  async first() { const r = this._exec(); return r.results[0] || null; }
  async raw() { return this._exec().results.map(o => Object.values(o)); }
}
class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(stmts) { return stmts.map(s => s._exec()); }
  async exec(sql) { this.db.exec(sql); return { count: 0 }; }
}

// ---- instrumented fetch
const LEDGER = [];
let n = 0, blown = null;
const kind = u => u.includes('query1.finance.yahoo') || u.includes('query2.finance.yahoo') ? 'YAHOO'
  : u.includes('/rest/v1/archive_bars') ? 'SUPABASE archive_bars'
  : u.includes('/rest/v1/archive_symbols') ? 'SUPABASE archive_symbols'
  : u.includes('/rest/v1/bars') ? 'SUPABASE bars (mirror)'
  : u.includes('api.github.com') ? 'GITHUB' : 'OTHER';
const symOf = u => (u.match(/chart\/([A-Z0-9.\-]+)/) || u.match(/symbol=eq\.([A-Z0-9.\-]+)/) || [])[1] || '';
globalThis.fetch = async (u) => {
  const url = String(u);
  n++;
  const rec = { n, type: kind(url), symbol: symOf(url), url: url.slice(0, 90) };
  LEDGER.push(rec);
  if (n > LIMIT) {
    rec.result = 'THREW';
    if (!blown) blown = { at: n, rec };
    throw new Error('Too many subrequests by single Worker invocation. To configure this limit, refer to https://developers.cloudflare.com/workers/wrangler/configuration/#limits');
  }
  rec.result = 'ok';
  if (rec.type === 'YAHOO') {
    const base = clock - 3600, rows = [];
    for (let i = 0; i < 30; i++) rows.push([base + i * 60, 100, 101, 99, 100.5, 1000]);
    return { status: 200, ok: true, headers: new Map(), json: async () => ({ chart: { result: [{ timestamp: rows.map(r => r[0]),
      indicators: { quote: [{ open: rows.map(r => r[1]), high: rows.map(r => r[2]), low: rows.map(r => r[3]), close: rows.map(r => r[4]), volume: rows.map(r => r[5]) }] } }] } }),
      text: async () => '' };
  }
  return { status: 200, ok: true, headers: { get: () => '0-0/100' }, text: async () => '[]', json: async () => [] };
};

// ---- clock inside the session
let clock = 1789651800 + 3 * 3600;                 // 2026-09-17 12:30 ET
const realNow = Date.now;
Date.now = () => clock * 1000;

const mod = (await import('../../worker.js')).default;
const db = new D1();
const env = { DB: db, RATE_PER_MIN: 1e9 };
if (MIRROR) { env.SUPABASE_URL = 'https://sb.example.com'; env.SUPABASE_KEY = 'k'; }

// ---- seed the tracked list exactly as production reports it (118 symbols)
const PROD = ('AAPL ABBV ABNB ABT ADBE ADI ADP ALAB AMD AMGN AMT AMZN ANET APH APP ARM ASML AVGO AXP BAC BKNG BLK BMY BRK-B BSX BX C CAT CB CME COIN COP COST CRDO CRM CRWD CSCO CVX DDOG DE DELL DIS DUK ELV ETN FISV GE GILD GOOGL GS HD HON HOOD IBM ICE INTC INTU ISRG JNJ JPM KKR KLAC KO LIN LLY LMT LOW LRCX MA MCD MDLZ MDT META MRK MRSH MRVL MS MSFT MSTR MU NEE NFLX NOW NVDA ORCL PANW PEP PG PGR PLD PLTR PM QCOM QQQ RBLX RTX SBUX SCHW SHOP SMCI SMH SNOW SO SPGI SPMO SPY SYK T TJX TMUS TQQQ TSLA VOO WFC XLC XLF XLK XLY').split(/\s+/);
const COUNT = +(process.argv[5] || 0) || PROD.length;
const USE = PROD.slice(0, COUNT);
const names = ORDER === 'reverse'
  ? USE.map((_, i) => 'Z' + String(USE.length - i).padStart(3, '0'))   // same count, order flipped
  : USE;
await db.exec('CREATE TABLE IF NOT EXISTS symbols (symbol TEXT PRIMARY KEY, added_at INTEGER, last_fetch_at INTEGER, last_bar_unix INTEGER, last_error TEXT, last_backfill_at INTEGER)');
for (const s of names) db.db.prepare('INSERT OR IGNORE INTO symbols (symbol, added_at) VALUES (?, ?)').run(s, clock - 86400);

// ---- run one scheduled invocation, awaiting every waitUntil promise
const pending = [];
const ctx = { waitUntil: p => pending.push(p) };
await mod.scheduled({ cron: '* 13-21 * * *' }, env, ctx);
await Promise.allSettled(pending);
await new Promise(r => setTimeout(r, 50));

// ---- report
const order = (await db.prepare('SELECT symbol FROM symbols ORDER BY symbol').all()).results.map(r => r.symbol);
const idx = s => order.indexOf(s) + 1;
const yahoo = LEDGER.filter(r => r.type === 'YAHOO');
const pre = LEDGER.filter(r => r.n < (yahoo[0] ? yahoo[0].n : 1e9));
console.log(`\nlimit=${LIMIT}  order=${ORDER}  mirror=${MIRROR ? 'on' : 'off'}  tracked=${order.length}`);
console.log(`\nfirst 60 of the processing order (SELECT symbol FROM symbols ORDER BY symbol):`);
console.log('  ' + order.slice(0, 60).map((s, i) => `${i + 1}.${s}`).join(' '));
console.log(`\nstartup requests before the first symbol fetch: ${pre.length}`);
pre.forEach(r => console.log(`   #${r.n} ${r.type} ${r.url}`));
const okY = yahoo.filter(r => r.result === 'ok'), badY = yahoo.filter(r => r.result === 'THREW');
console.log(`\nYahoo requests: ${yahoo.length}  (ok ${okY.length}, threw ${badY.length})`);
console.log(`last symbol fetched ok : ${okY.length ? okY[okY.length - 1].symbol + ' (index ' + idx(okY[okY.length - 1].symbol) + ')' : '-'}`);
console.log(`first symbol that threw: ${badY.length ? badY[0].symbol + ' (index ' + idx(badY[0].symbol) + ')' : '-'}`);
console.log(`ceiling hit at external request #${blown ? blown.at : '-'}`);
const stored = (await db.prepare('SELECT symbol, COUNT(*) c, MAX(time) last FROM bars GROUP BY symbol').all()).results;
const map = Object.fromEntries(stored.map(r => [r.symbol, r]));
console.log(`\nsymbols with stored bars: ${stored.length} of ${order.length}`);
console.log('indexes 45-55:');
for (let i = 44; i < 56 && i < order.length; i++) {
  const s = order[i], f = yahoo.find(r => r.symbol === s);
  console.log(`  ${String(i + 1).padStart(3)} ${s.padEnd(7)} fetched=${f ? f.result : 'NEVER STARTED'}  rows=${map[s] ? map[s].c : 0}  last=${map[s] ? map[s].last : '-'}`);
}
const byType = {};
LEDGER.forEach(r => byType[r.type] = (byType[r.type] || 0) + 1);
console.log('\nexternal request ledger by type:', JSON.stringify(byType));
console.log('total external requests attempted:', LEDGER.length);
Date.now = realNow;
