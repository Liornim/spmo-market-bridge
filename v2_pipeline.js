// ============================================================================
// V2 MARKET DATA PIPELINE — isolated from the legacy ingestion entirely.
//
// Legacy is untouched: different tables (suffix _v2), different routes (/v2/*),
// a different cron trigger, its own accounting. Nothing here writes to `bars`,
// `days`, `symbols`, `archive_bars` or the Supabase mirror. The only legacy
// reads are explicit copy jobs, and they are read-only.
//
// The failure this replaces: one invocation walked every tracked symbol
// alphabetically and died on Cloudflare's external-subrequest ceiling, so the
// tail of the alphabet starved. V2's rule is the opposite — an execution never
// starts work it cannot pay for, and unfinished work stays queued with its
// original due time, so the next execution continues instead of restarting.
// ============================================================================

export const V2_VERSION = 'v2.0';

// ---------------------------------------------------------------- constants
// Budget: the ceiling is a property of the platform, not of this code. It is
// read from env (V2_BUDGET) so it can follow a plan change without a rewrite.
export const DEFAULT_BUDGET = 40;          // safe working budget; platform ceiling today is 50
export const RESERVE = 4;                  // never spend the last few: recovery/flush headroom
export const REVISION_WINDOW = 30 * 60;    // seconds of trailing candles treated as revisable
export const SESSION_MINUTES = 390;
export const TZ = 'America/New_York';
const UA = 'Mozilla/5.0 (compatible; bars-vault-v2/1.0)';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

export const nowSec = () => Math.floor(Date.now() / 1000);
export function localDateTime(unix) {
  const p = fmt.formatToParts(new Date(unix * 1000)).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const _hourBase = new Map();
export function etMinuteOfDay(unix) {
  const hk = Math.floor(unix / 3600);
  let base = _hourBase.get(hk);
  if (base === undefined) {
    const t = localDateTime(hk * 3600).time;
    base = +t.slice(0, 2) * 60 + +t.slice(3, 5);
    if (_hourBase.size > 4096) _hourBase.clear();
    _hourBase.set(hk, base);
  }
  return base + Math.floor((unix % 3600) / 60);
}
// The canonical candle test, carried over from the legacy audit: a regular
// session minute START. Proven rule, new plumbing.
export const isSessionMinute = u => u % 60 === 0 && etMinuteOfDay(u) >= 570 && etMinuteOfDay(u) < 960;
export function marketOpen(unix) {
  const p = fmt.formatToParts(new Date((unix || nowSec()) * 1000)).reduce((a, x) => (a[x.type] = x.value, a), {});
  const wd = new Date((unix || nowSec()) * 1000).getUTCDay();
  const m = etMinuteOfDay(Math.floor((unix || nowSec()) / 60) * 60);
  return wd !== 0 && wd !== 6 && m >= 570 && m < 960 && p.year > '2000';
}
const rnd = (x, n) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n);

// ---------------------------------------------------------------- schema
export const V2_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS bars_v2 (
     symbol TEXT NOT NULL, unix INTEGER NOT NULL,
     date TEXT NOT NULL, time TEXT NOT NULL,
     open REAL, high REAL, low REAL, close REAL, volume INTEGER,
     source TEXT NOT NULL, synthetic INTEGER NOT NULL DEFAULT 0,
     first_seen INTEGER NOT NULL, updated_at INTEGER NOT NULL, revisions INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (symbol, unix))`,
  `CREATE INDEX IF NOT EXISTS bars_v2_sym_date ON bars_v2 (symbol, date, unix)`,
  `CREATE TABLE IF NOT EXISTS symbols_v2 (
     symbol TEXT PRIMARY KEY, tier TEXT NOT NULL DEFAULT 'standard',
     added_at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
     last_fetch_at INTEGER, last_bar_unix INTEGER, last_error TEXT, last_ok_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS jobs_v2 (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     kind TEXT NOT NULL, symbol TEXT NOT NULL, arg TEXT NOT NULL DEFAULT '',
     priority INTEGER NOT NULL DEFAULT 5, due_at INTEGER NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
     state TEXT NOT NULL DEFAULT 'ready', updated_at INTEGER NOT NULL,
     UNIQUE (kind, symbol, arg))`,
  `CREATE INDEX IF NOT EXISTS jobs_v2_ready ON jobs_v2 (state, due_at, priority)`,
  `CREATE TABLE IF NOT EXISTS runs_v2 (
     id INTEGER PRIMARY KEY AUTOINCREMENT, started_at INTEGER NOT NULL, finished_at INTEGER,
     trigger TEXT, budget INTEGER, used INTEGER DEFAULT 0, jobs_done INTEGER DEFAULT 0,
     jobs_failed INTEGER DEFAULT 0, rows_downloaded INTEGER DEFAULT 0, candidates INTEGER DEFAULT 0,
     inserted INTEGER DEFAULT 0, revised INTEGER DEFAULT 0, unchanged INTEGER DEFAULT 0,
     status TEXT DEFAULT 'running', note TEXT)`,
  `CREATE TABLE IF NOT EXISTS meta_v2 (key TEXT PRIMARY KEY, value TEXT)`,
];
let schemaReady = false;
export async function ensureV2Schema(db, force) {
  if (schemaReady && !force) return;
  for (const sql of V2_SCHEMA) await db.prepare(sql).run();
  schemaReady = true;
}

// ---------------------------------------------------------------- budget
export class BudgetExhausted extends Error {
  constructor(used, max) { super(`v2 budget exhausted: ${used}/${max}`); this.used = used; this.max = max; }
}
// Every external request in V2 goes through this. It refuses BEFORE the
// platform would, so a run ends tidily with work still queued rather than
// throwing Cloudflare's error in the middle of a symbol.
export class Budget {
  constructor(max, reserve = RESERVE) { this.max = max; this.reserve = reserve; this.used = 0; this.log = []; }
  get left() { return this.max - this.used; }
  canSpend(n = 1, useReserve = false) { return this.used + n <= this.max - (useReserve ? 0 : this.reserve); }
  async spend(label, fn, n = 1, useReserve = false) {
    if (!this.canSpend(n, useReserve)) throw new BudgetExhausted(this.used, this.max);
    this.used += n;
    const t0 = Date.now();
    try { const r = await fn(); this.log.push({ n: this.used, label, ms: Date.now() - t0, ok: true }); return r; }
    catch (e) { this.log.push({ n: this.used, label, ms: Date.now() - t0, ok: false, error: String(e && e.message || e) }); throw e; }
  }
}

// ---------------------------------------------------------------- provider
// ONE fetch per symbol per refresh. The normalised result is the single input
// for every downstream write; nothing re-fetches the same candles for a second
// destination.
export async function fetchProvider(symbol, range, budget) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=${range}&includePrePost=false`;
  const res = await budget.spend(`yahoo ${range} ${symbol}`, () => fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }));
  if (!res || res.status !== 200) return { rows: [], downloaded: 0, error: `upstream HTTP ${res && res.status}` };
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r) return { rows: [], downloaded: 0, error: j?.chart?.error?.description || 'no result from upstream' };
  return normalise(symbol, r);
}
// Normalisation rules carried over from the audited legacy behaviour:
// forming minute dropped, 4-decimal rounding, null-price minute becomes a flat
// no-trade candle — but V2 records that as `synthetic = 1` instead of hiding it.
export function normalise(symbol, result) {
  const ts = result.timestamp || [], q = result.indicators?.quote?.[0] || {};
  const now = nowSec(), rows = [];
  let lastClose = null, downloaded = 0, dropped = 0;
  for (let i = 0; i < ts.length; i++) {
    downloaded++;
    const u = ts[i];
    if (u + 60 > now) { dropped++; continue; }              // forming minute
    if (!isSessionMinute(u)) { dropped++; continue; }        // not a canonical candle
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i];
    const { date, time } = localDateTime(u);
    if (o == null || c == null) {
      if (lastClose == null) { dropped++; continue; }
      rows.push({ symbol, unix: u, date, time, open: lastClose, high: lastClose, low: lastClose, close: lastClose, volume: 0, synthetic: 1 });
      continue;
    }
    lastClose = rnd(c, 4);
    rows.push({ symbol, unix: u, date, time, open: rnd(o, 4), high: rnd(h, 4), low: rnd(l, 4), close: rnd(c, 4), volume: Math.round(v || 0), synthetic: 0 });
  }
  rows.sort((a, b) => a.unix - b.unix);
  return { rows, downloaded, dropped, error: null };
}

// ---------------------------------------------------------------- writes
// Bounded, measured upsert. Compares against what is stored and writes only
// what actually differs, so the write amplification is visible per run.
export async function writeCandles(db, rows, source, opts = {}) {
  const acc = { candidates: 0, inserted: 0, revised: 0, unchanged: 0, rejected: 0 };
  if (!rows.length) return acc;
  const symbol = rows[0].symbol;
  const from = opts.from != null ? opts.from : rows[0].unix;
  const canonical = rows.filter(r => {
    if (!isSessionMinute(r.unix) || r.unix < from) { acc.rejected++; return false; }
    const { open: o, high: h, low: l, close: c, volume: v } = r;
    if (![o, h, l, c, v].every(Number.isFinite) || h < Math.max(o, c, l) || l > Math.min(o, c, h) || v < 0) { acc.rejected++; return false; }
    return true;
  });
  acc.candidates = canonical.length;
  if (!canonical.length) return acc;
  const lo = canonical[0].unix, hi = canonical[canonical.length - 1].unix;
  const { results: existing } = await db.prepare(
    'SELECT unix, open, high, low, close, volume FROM bars_v2 WHERE symbol = ? AND unix >= ? AND unix <= ?')
    .bind(symbol, lo, hi).all();
  const have = new Map(existing.map(r => [r.unix, r]));
  const t = nowSec(), ins = [], upd = [];
  for (const r of canonical) {
    const e = have.get(r.unix);
    if (!e) { ins.push(r); continue; }
    if (e.open === r.open && e.high === r.high && e.low === r.low && e.close === r.close && e.volume === r.volume) { acc.unchanged++; continue; }
    upd.push(r);
  }
  const stmts = [];
  for (const r of ins) stmts.push(db.prepare(
    `INSERT INTO bars_v2 (symbol, unix, date, time, open, high, low, close, volume, source, synthetic, first_seen, updated_at, revisions)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0) ON CONFLICT(symbol, unix) DO UPDATE SET
       open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume,
       source=excluded.source, synthetic=excluded.synthetic, updated_at=excluded.updated_at, revisions=bars_v2.revisions+1`)
    .bind(r.symbol, r.unix, r.date, r.time, r.open, r.high, r.low, r.close, r.volume, source, r.synthetic || 0, t, t));
  for (const r of upd) stmts.push(db.prepare(
    `UPDATE bars_v2 SET open=?, high=?, low=?, close=?, volume=?, source=?, synthetic=?, updated_at=?, revisions=revisions+1
     WHERE symbol=? AND unix=?`)
    .bind(r.open, r.high, r.low, r.close, r.volume, source, r.synthetic || 0, t, r.symbol, r.unix));
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  acc.inserted = ins.length; acc.revised = upd.length;
  return acc;
}

// ---------------------------------------------------------------- queue
export async function enqueue(db, kind, symbol, arg, { priority = 5, dueAt = null } = {}) {
  const t = nowSec();
  await db.prepare(
    `INSERT INTO jobs_v2 (kind, symbol, arg, priority, due_at, state, updated_at) VALUES (?,?,?,?,?, 'ready', ?)
     ON CONFLICT(kind, symbol, arg) DO UPDATE SET
       due_at = MIN(jobs_v2.due_at, excluded.due_at), priority = MIN(jobs_v2.priority, excluded.priority),
       state = CASE WHEN jobs_v2.state = 'failed' THEN 'ready' ELSE jobs_v2.state END, updated_at = excluded.updated_at`)
    .bind(kind, symbol, arg || '', priority, dueAt == null ? t : dueAt, t).run();
}
// Fairness: oldest due time first, never alphabetical. A symbol skipped because
// the budget ran out keeps its old due time and is therefore picked FIRST next
// run. `symbol` is only the final tie-break so the order is deterministic.
export async function claimJobs(db, limit) {
  const t = nowSec();
  const { results } = await db.prepare(
    `SELECT * FROM jobs_v2 WHERE state = 'ready' AND due_at <= ? ORDER BY priority ASC, due_at ASC, symbol ASC LIMIT ?`)
    .bind(t, limit).all();
  return results;
}
export const TIER_INTERVAL = { live: 60, standard: 60, slow: 300 };

// ---------------------------------------------------------------- one job
async function runLiveJob(db, job, budget, acc, env) {
  const sym = job.symbol;
  const row = await db.prepare('SELECT last_bar_unix FROM symbols_v2 WHERE symbol = ?').bind(sym).first();
  const lastBar = row && row.last_bar_unix ? row.last_bar_unix : null;
  // One request. `1d` while a session is in progress or has just ended, `5d`
  // only when the symbol has no recent data at all — the range is chosen once,
  // not per destination.
  const range = lastBar && nowSec() - lastBar < 3 * 86400 ? '1d' : '5d';
  const { rows, downloaded, error } = await fetchProvider(sym, range, budget);
  const t = nowSec();
  if (error) {
    await db.prepare('UPDATE symbols_v2 SET last_fetch_at = ?, last_error = ? WHERE symbol = ?').bind(t, error, sym).run();
    throw new Error(error);
  }
  acc.rows_downloaded += downloaded;
  // Bounded write window: only the revision window and anything newer.
  const from = lastBar ? lastBar - REVISION_WINDOW : 0;
  const w = await writeCandles(db, rows, 'yahoo:1m', { from });
  acc.candidates += w.candidates; acc.inserted += w.inserted; acc.revised += w.revised; acc.unchanged += w.unchanged;
  const newest = rows.length ? rows[rows.length - 1].unix : lastBar;
  await db.prepare(
    `UPDATE symbols_v2 SET last_fetch_at = ?, last_ok_at = ?, last_error = NULL,
       last_bar_unix = MAX(COALESCE(last_bar_unix, 0), ?) WHERE symbol = ?`)
    .bind(t, t, newest || 0, sym).run();
  return w;
}

async function runBackfillJob(db, job, budget, acc) {
  const { rows, downloaded, error } = await fetchProvider(job.symbol, '5d', budget);
  if (error) throw new Error(error);
  acc.rows_downloaded += downloaded;
  const wanted = job.arg ? rows.filter(r => r.date === job.arg) : rows;
  const w = await writeCandles(db, wanted, 'yahoo:5d', { from: 0 });
  acc.candidates += w.candidates; acc.inserted += w.inserted; acc.revised += w.revised; acc.unchanged += w.unchanged;
  return w;
}

// Gap scan costs NO external request: it reads what V2 already stored and
// queues bounded repair jobs. Recovery therefore never depends on a browser.
export async function scanGaps(db, symbol, date) {
  const { results } = await db.prepare(
    'SELECT unix, time FROM bars_v2 WHERE symbol = ? AND date = ? ORDER BY unix').bind(symbol, date).all();
  const expect = [];
  for (let i = 0; i < SESSION_MINUTES; i++) { const m = 570 + i; expect.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')); }
  const have = new Set(results.map(r => r.time));
  const missing = expect.filter(x => !have.has(x));
  return { symbol, date, present: results.length, expected: expect.length, missing: missing.length, first_missing: missing[0] || null, last_missing: missing[missing.length - 1] || null };
}

// ---------------------------------------------------------------- the tick
export async function tick(db, env, { trigger = 'cron', budgetMax = null, ctx = null } = {}) {
  await ensureV2Schema(db);
  const max = budgetMax || +(env && env.V2_BUDGET) || DEFAULT_BUDGET;
  const budget = new Budget(max);
  const started = nowSec();
  // Bookkeeping is best-effort on purpose: a failure writing the run row must
  // not stop the work the run exists to do.
  let run = null;
  try {
    run = await db.prepare(
      'INSERT INTO runs_v2 (started_at, trigger, budget, status) VALUES (?,?,?,\'running\') RETURNING id')
      .bind(started, trigger, max).first();
  } catch (e) { /* recorded in the response instead */ }
  const acc = { rows_downloaded: 0, candidates: 0, inserted: 0, revised: 0, unchanged: 0 };
  let done = 0, failed = 0, stoppedBy = 'work-complete';
  const details = [];
  // Only claim what the budget can pay for: each job costs one provider request.
  const claimable = Math.max(0, budget.max - budget.reserve);
  let jobs = [];
  try { jobs = await claimJobs(db, claimable); }
  catch (e) { return { run_id: run ? run.id : null, trigger, budget: { max, used: 0, safe: max - RESERVE, left: max }, jobs_claimed: 0, done: 0, failed: 0, stopped_by: 'queue-read-failed', error: String(e && e.message || e), ...acc, details: [] }; }
  for (const job of jobs) {
    if (!budget.canSpend(1)) { stoppedBy = 'budget'; break; }
    const t = nowSec();
    try {
      const w = job.kind === 'backfill' ? await runBackfillJob(db, job, budget, acc) : await runLiveJob(db, job, budget, acc, env);
      done++;
      details.push({ symbol: job.symbol, kind: job.kind, ok: true, inserted: w.inserted, revised: w.revised, unchanged: w.unchanged });
      const interval = TIER_INTERVAL[job.tier || 'standard'] || 60;
      if (job.kind === 'backfill') await db.prepare('DELETE FROM jobs_v2 WHERE id = ?').bind(job.id).run();
      else await db.prepare('UPDATE jobs_v2 SET due_at = ?, attempts = 0, last_error = NULL, state = \'ready\', updated_at = ? WHERE id = ?')
        .bind(t + interval, t, job.id).run();
    } catch (e) {
      if (e instanceof BudgetExhausted) { stoppedBy = 'budget'; break; }
      failed++;
      const msg = String(e && e.message || e).slice(0, 180);
      details.push({ symbol: job.symbol, kind: job.kind, ok: false, error: msg });
      // Bounded, visible retry: back off 2^attempts minutes, give up at 5 and
      // leave the job visible as failed rather than retrying invisibly.
      const attempts = (job.attempts || 0) + 1;
      const backoff = Math.min(60 * 2 ** attempts, 1800);
      await db.prepare('UPDATE jobs_v2 SET attempts = ?, last_error = ?, due_at = ?, state = ?, updated_at = ? WHERE id = ?')
        .bind(attempts, msg, t + backoff, attempts >= 5 ? 'failed' : 'ready', t, job.id).run();
    }
  }
  if (run) {
    try {
      await db.prepare(
        `UPDATE runs_v2 SET finished_at = ?, used = ?, jobs_done = ?, jobs_failed = ?, rows_downloaded = ?,
           candidates = ?, inserted = ?, revised = ?, unchanged = ?, status = ?, note = ? WHERE id = ?`)
        .bind(nowSec(), budget.used, done, failed, acc.rows_downloaded, acc.candidates, acc.inserted, acc.revised, acc.unchanged,
          failed && !done ? 'failed' : failed ? 'partial' : 'ok', stoppedBy, run.id).run();
    } catch (e) { /* as above */ }
  }
  return { run_id: run ? run.id : null, trigger, budget: { max, used: budget.used, safe: max - RESERVE, left: budget.left }, jobs_claimed: jobs.length, done, failed, stopped_by: stoppedBy, ...acc, details };
}

// Nightly-style maintenance: queue a gap scan for yesterday's sessions. Costs
// no external requests; only the repairs it finds do, and they go through the
// same budget as everything else.
export async function sweep(db, env, { date = null } = {}) {
  await ensureV2Schema(db);
  const { results: syms } = await db.prepare('SELECT symbol FROM symbols_v2 WHERE active = 1 ORDER BY symbol').all();
  const day = date || localDateTime(nowSec() - 20 * 3600).date;
  const queued = [], clean = [];
  for (const s of syms) {
    const g = await scanGaps(db, s.symbol, day);
    if (g.present === 0 || g.missing > 0) { await enqueue(db, 'backfill', s.symbol, day, { priority: 3 }); queued.push({ symbol: s.symbol, missing: g.missing, present: g.present }); }
    else clean.push(s.symbol);
  }
  return { date: day, symbols: syms.length, repairs_queued: queued.length, clean: clean.length, queued };
}
