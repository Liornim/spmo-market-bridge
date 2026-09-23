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
export const DEFAULT_BUDGET = 14;          // provider-rate limited, not platform limited: see PROVIDER_RATE below
export const FETCH_TIMEOUT_MS = 8000;      // a hung request must not take the invocation down with it
export const RESERVE = 2;                  // never spend the last few: recovery/flush headroom
export const REVISION_WINDOW = 30 * 60;    // seconds of trailing candles treated as revisable
export const SESSION_MINUTES = 390;
export const HALF_SESSION_MINUTES = 210;          // early close at 13:00 ET
// US equity market calendar. Without it the gap engine "repairs" weekends and
// holidays: a sweep on 2026-12-25 queued a 390-minute repair for every symbol.
export const MARKET_HOLIDAYS = new Set([
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);
export const EARLY_CLOSES = new Set(['2025-07-03', '2025-11-28', '2025-12-24', '2026-11-27', '2026-12-24', '2027-11-26']);
// 0 means the market never opened that day, so nothing about it is a gap.
export function sessionMinutes(date) {
  const d = new Date(date + 'T12:00:00Z'), wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return 0;
  if (MARKET_HOLIDAYS.has(date)) return 0;
  return EARLY_CLOSES.has(date) ? HALF_SESSION_MINUTES : SESSION_MINUTES;
}
export function expectedLabels(date) {
  const n = sessionMinutes(date), out = [];
  for (let i = 0; i < n; i++) { const m = 570 + i; out.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')); }
  return out;
}
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
export function isSessionMinute(u) {
  if (!Number.isFinite(u) || u % 60 !== 0) return false;
  const m = etMinuteOfDay(u);
  if (m < 570 || m >= 960) return false;
  // Weekends are unambiguous: no US equity session has ever traded on one, so a
  // Saturday timestamp is corrupt data whatever the calendar says. Holidays are
  // NOT rejected here on purpose — a wrong entry in a hand-maintained holiday
  // list would silently discard real candles. They are handled by the gap
  // engine (sessionMinutes), which only decides what to expect, never what to keep.
  const wd = new Date(localDateTime(u).date + 'T12:00:00Z').getUTCDay();
  return wd !== 0 && wd !== 6;
}
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
     lease_until INTEGER NOT NULL DEFAULT 0, claim_id TEXT,
     UNIQUE (kind, symbol, arg))`,
  `CREATE INDEX IF NOT EXISTS jobs_v2_ready ON jobs_v2 (state, due_at, priority)`,
  `CREATE TABLE IF NOT EXISTS runs_v2 (
     id INTEGER PRIMARY KEY AUTOINCREMENT, started_at INTEGER NOT NULL, finished_at INTEGER,
     trigger TEXT, budget INTEGER, used INTEGER DEFAULT 0, jobs_done INTEGER DEFAULT 0,
     jobs_failed INTEGER DEFAULT 0, rows_downloaded INTEGER DEFAULT 0, candidates INTEGER DEFAULT 0,
     inserted INTEGER DEFAULT 0, revised INTEGER DEFAULT 0, unchanged INTEGER DEFAULT 0,
     synthetic_inserted INTEGER DEFAULT 0, kept_real INTEGER DEFAULT 0, rejected INTEGER DEFAULT 0,
     partial_responses INTEGER DEFAULT 0, lease_reclaims INTEGER DEFAULT 0,
     symbols TEXT, status TEXT DEFAULT 'running', note TEXT)`,
  `CREATE TABLE IF NOT EXISTS meta_v2 (key TEXT PRIMARY KEY, value TEXT)`,
];
// Columns added after the first deployment. CREATE TABLE IF NOT EXISTS does
// nothing to a table that already exists, so a database migrated from an earlier
// version keeps the old shape and every claim fails silently. Each ALTER is
// attempted once and its "duplicate column" error is the expected outcome.
export const V2_COLUMN_UPGRADES = [
  'ALTER TABLE jobs_v2 ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE jobs_v2 ADD COLUMN claim_id TEXT',
  'ALTER TABLE runs_v2 ADD COLUMN synthetic_inserted INTEGER DEFAULT 0',
  'ALTER TABLE runs_v2 ADD COLUMN kept_real INTEGER DEFAULT 0',
  'ALTER TABLE runs_v2 ADD COLUMN rejected INTEGER DEFAULT 0',
  'ALTER TABLE runs_v2 ADD COLUMN partial_responses INTEGER DEFAULT 0',
  'ALTER TABLE runs_v2 ADD COLUMN lease_reclaims INTEGER DEFAULT 0',
  'ALTER TABLE runs_v2 ADD COLUMN symbols TEXT',
];
let schemaReady = false;
export async function ensureV2Schema(db, force) {
  if (schemaReady && !force) return;
  for (const sql of V2_SCHEMA) await db.prepare(sql).run();
  for (const sql of V2_COLUMN_UPGRADES) {
    try { await db.prepare(sql).run(); } catch (e) { /* already present */ }
  }
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
  // A blocked provider does not answer, it hangs. Without this timeout the
  // invocation was killed mid-request, which is why every run row in production
  // stayed 'running' with nothing recorded.
  const res = await budget.spend(`yahoo ${range} ${symbol}`, async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try { return await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctl.signal }); }
    finally { clearTimeout(timer); }
  });
  if (res && res.status === 429) {
    const ra = parseInt(res.headers && res.headers.get && res.headers.get('retry-after') || '', 10);
    return { rows: [], downloaded: 0, error: 'provider rate limited (429)', retryAfter: Number.isFinite(ra) ? ra : 900 };
  }
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
  const acc = { candidates: 0, inserted: 0, revised: 0, unchanged: 0, rejected: 0, kept_real: 0, synthetic_inserted: 0 };
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
    // Precedence: a carried-forward (synthetic) candle never replaces a real
    // one. The provider omitting a minute it once reported must not erase it.
    if (r.synthetic && !e.synthetic) { acc.kept_real = (acc.kept_real || 0) + 1; acc.unchanged++; continue; }
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
  acc.synthetic_inserted = ins.filter(r => r.synthetic).length;
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
export const LEASE_SECONDS = 120;                  // longer than any tick can run

// Fairness AND exclusivity in one statement. Oldest due time first, never
// alphabetical; `symbol` is only the final tie-break so the order is
// deterministic. The UPDATE is a single atomic statement, so two ticks running
// at the same moment cannot claim the same job — before this, 10 concurrent
// ticks produced 324 duplicate provider calls.
export async function claimJobs(db, limit, claimId) {
  const t = nowSec();
  const { results } = await db.prepare(
    `UPDATE jobs_v2 SET state = 'claimed', lease_until = ?, claim_id = ?, updated_at = ?
     WHERE id IN (
       SELECT id FROM jobs_v2
       WHERE due_at <= ? AND (state = 'ready' OR (state = 'claimed' AND lease_until <= ?))
       ORDER BY priority ASC, due_at ASC, symbol ASC LIMIT ?)
     RETURNING *`)
    .bind(t + LEASE_SECONDS, claimId, t, t, t, limit).all();
  return results;
}
// Every completion is fenced by the claim id: a worker that was presumed dead
// and whose lease expired cannot overwrite the state of the worker that took
// the job over.
const fenced = (sql) => sql + ' AND claim_id = ?';
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
  const { rows, downloaded, error, retryAfter } = await fetchProvider(sym, range, budget);
  const t = nowSec();
  if (error) {
    if (retryAfter) { const e = new Error(error); e.retryAfter = retryAfter; 
      await db.prepare('UPDATE symbols_v2 SET last_fetch_at = ?, last_error = ? WHERE symbol = ?').bind(t, error, sym).run();
      throw e; }
    await db.prepare('UPDATE symbols_v2 SET last_fetch_at = ?, last_error = ? WHERE symbol = ?').bind(t, error, sym).run();
    throw new Error(error);
  }
  acc.rows_downloaded += downloaded;
  // Bounded write window: only the revision window and anything newer.
  const from = lastBar ? lastBar - REVISION_WINDOW : 0;
  const w = await writeCandles(db, rows, 'yahoo:1m', { from });
  acc.candidates += w.candidates; acc.inserted += w.inserted; acc.revised += w.revised; acc.unchanged += w.unchanged;
  acc.synthetic_inserted += w.synthetic_inserted || 0; acc.kept_real += w.kept_real || 0; acc.rejected += w.rejected || 0;
  // a response that carries fewer session minutes than the day should have by now
  const expectedSoFar = Math.max(0, Math.min(390, etMinuteOfDay(nowSec()) - 570));
  if (marketOpen() && rows.length && rows.filter(r => r.date === localDateTime(nowSec()).date).length < expectedSoFar - 5) acc.partial_responses++;
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
  acc.synthetic_inserted += w.synthetic_inserted || 0; acc.kept_real += w.kept_real || 0; acc.rejected += w.rejected || 0;
  return w;
}

// Gap scan costs NO external request: it reads what V2 already stored and
// queues bounded repair jobs. Recovery therefore never depends on a browser.
export async function scanGaps(db, symbol, date) {
  const { results } = await db.prepare(
    'SELECT unix, time FROM bars_v2 WHERE symbol = ? AND date = ? ORDER BY unix').bind(symbol, date).all();
  const expect = expectedLabels(date);
  const have = new Set(results.map(r => r.time));
  const missing = expect.filter(x => !have.has(x));
  return { symbol, date, session: expect.length > 0, present: results.length, expected: expect.length, missing: missing.length, first_missing: missing[0] || null, last_missing: missing[missing.length - 1] || null };
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
  const acc = { rows_downloaded: 0, candidates: 0, inserted: 0, revised: 0, unchanged: 0, synthetic_inserted: 0, kept_real: 0, rejected: 0, partial_responses: 0, lease_reclaims: 0 };
  let done = 0, failed = 0, stoppedBy = 'work-complete';
  const details = [];
  // Only claim what the budget can pay for: each job costs one provider request.
  const claimable = Math.max(0, budget.max - budget.reserve);
  const claimId = `${started}-${Math.random().toString(36).slice(2, 10)}`;
  let jobs = [];
  try { jobs = await claimJobs(db, claimable, claimId); acc.lease_reclaims = jobs.filter(j => j.attempts === 0 && j.lease_until && j.lease_until <= started).length; }
  catch (e) {
    const msg = String(e && e.message || e).slice(0, 180);
    // Record the failure. A run row left at 'running' with used 0 is exactly how
    // a broken claim looked in production: alive, busy-looking, doing nothing.
    if (run) { try { await db.prepare("UPDATE runs_v2 SET finished_at = ?, status = 'failed', note = ? WHERE id = ?").bind(nowSec(), 'queue-read-failed: ' + msg, run.id).run(); } catch (e2) { /* nothing left to report with */ } }
    return { run_id: run ? run.id : null, trigger, budget: { max, used: 0, safe: max - RESERVE, left: max }, jobs_claimed: 0, done: 0, failed: 0, stopped_by: 'queue-read-failed', error: msg, ...acc, details: [] };
  }
  // Sequential fetching cost ~1s per symbol, so 36 of them outlasted the
  // invocation: production showed every run stuck at 'running' with used 0
  // while candles were still being written. Small concurrent groups cut the
  // wall time without changing the request budget - each fetch still charges
  // the budget before it opens a socket.
  const GROUP = 6;
  const groups = [];
  for (let i = 0; i < jobs.length; i += GROUP) groups.push(jobs.slice(i, i + GROUP));
  for (const group of groups) {
    if (stoppedBy === 'provider-rate-limited') break;      // the provider said wait; waiting is the whole response
    if (!budget.canSpend(group.length)) { stoppedBy = 'budget'; break; }
    await Promise.all(group.map(job => runOne(job)));
    // Checkpoint: if the invocation dies now, the row still shows what was done.
    if (run) {
      try {
        await db.prepare(`UPDATE runs_v2 SET used = ?, jobs_done = ?, jobs_failed = ?, inserted = ?, revised = ?,
          unchanged = ?, status = 'running', note = 'in progress' WHERE id = ?`)
          .bind(budget.used, done, failed, acc.inserted, acc.revised, acc.unchanged, run.id).run();
      } catch (e) { /* reporting only */ }
    }
  }

  async function runOne(job) {
    const t = nowSec();
    try {
      const w = job.kind === 'backfill' ? await runBackfillJob(db, job, budget, acc) : await runLiveJob(db, job, budget, acc, env);
      done++;
      details.push({ symbol: job.symbol, kind: job.kind, ok: true, inserted: w.inserted, revised: w.revised, unchanged: w.unchanged });
      const interval = TIER_INTERVAL[job.tier || 'standard'] || 60;
      if (job.kind === 'backfill') await db.prepare('DELETE FROM jobs_v2 WHERE id = ? AND claim_id = ?').bind(job.id, claimId).run();
      else await db.prepare(`UPDATE jobs_v2 SET due_at = ?, attempts = 0, last_error = NULL, state = 'ready',
             lease_until = 0, claim_id = NULL, updated_at = ? WHERE id = ? AND claim_id = ?`)
        .bind(t + interval, t, job.id, claimId).run();
    } catch (e) {
      if (e instanceof BudgetExhausted) { stoppedBy = 'budget'; return; }
      failed++;
      // A rate limit is a statement about the whole run, not about this symbol.
      if (e && e.retryAfter) stoppedBy = 'provider-rate-limited';
      const msg = String(e && e.message || e).slice(0, 180);
      details.push({ symbol: job.symbol, kind: job.kind, ok: false, error: msg });
      // Bounded, visible retry: back off 2^attempts minutes, give up at 5 and
      // leave the job visible as failed rather than retrying invisibly.
      const attempts = (job.attempts || 0) + 1;
      // A rate limit is not a per-symbol fault: honour the provider's own wait.
      const backoff = e && e.retryAfter ? Math.max(e.retryAfter, 300) : Math.min(60 * 2 ** attempts, 1800);
      await db.prepare(`UPDATE jobs_v2 SET attempts = ?, last_error = ?, due_at = ?, state = ?,
             lease_until = 0, claim_id = NULL, updated_at = ? WHERE id = ? AND claim_id = ?`)
        .bind(attempts, msg, t + backoff, attempts >= 5 ? 'failed' : 'ready', t, job.id, claimId).run();
      if (stoppedBy === 'provider-rate-limited') {
        // Push every other job this run claimed out too, so the next minute does
        // not walk straight back into the same wall.
        await db.prepare(`UPDATE jobs_v2 SET due_at = MAX(due_at, ?), state = 'ready', lease_until = 0, claim_id = NULL
                          WHERE claim_id = ?`).bind(t + backoff, claimId).run();
      }
    }
  }
  let queueDepth = null;
  try { queueDepth = (await db.prepare("SELECT COUNT(*) c FROM jobs_v2 WHERE state = 'ready' AND due_at <= ?").bind(nowSec()).first()).c; } catch (e) { /* reporting only */ }
  // Anything still claimed by this run was never started: release it now so the
  // next tick picks it up immediately instead of waiting for the lease.
  try { await db.prepare("UPDATE jobs_v2 SET state = 'ready', lease_until = 0, claim_id = NULL WHERE claim_id = ? AND state = 'claimed'").bind(claimId).run(); }
  catch (e) { /* the lease expiry covers this */ }
  if (run) {
    try {
      await db.prepare(
        `UPDATE runs_v2 SET finished_at = ?, used = ?, jobs_done = ?, jobs_failed = ?, rows_downloaded = ?,
           candidates = ?, inserted = ?, revised = ?, unchanged = ?, synthetic_inserted = ?, kept_real = ?,
           rejected = ?, partial_responses = ?, lease_reclaims = ?, symbols = ?, status = ?, note = ? WHERE id = ?`)
        .bind(nowSec(), budget.used, done, failed, acc.rows_downloaded, acc.candidates, acc.inserted, acc.revised, acc.unchanged,
          acc.synthetic_inserted, acc.kept_real, acc.rejected, acc.partial_responses, acc.lease_reclaims,
          jobs.map(j => j.symbol).join(' '), failed && !done ? 'failed' : failed ? 'partial' : 'ok', stoppedBy, run.id).run();
    } catch (e) { /* as above */ }
  }
  return { run_id: run ? run.id : null, trigger, budget: { max, used: budget.used, safe: max - RESERVE, left: budget.left }, jobs_claimed: jobs.length, symbols_claimed: jobs.map(j => j.symbol), done, failed, stopped_by: stoppedBy, queue_depth: queueDepth, ...acc, details };
}

// Nightly-style maintenance: queue a gap scan for yesterday's sessions. Costs
// no external requests; only the repairs it finds do, and they go through the
// same budget as everything else.
export async function sweep(db, env, { date = null } = {}) {
  await ensureV2Schema(db);
  const { results: syms } = await db.prepare('SELECT symbol FROM symbols_v2 WHERE active = 1 ORDER BY symbol').all();
  const day = date || localDateTime(nowSec() - 20 * 3600).date;
  if (!sessionMinutes(day)) return { date: day, symbols: syms.length, market_closed: true, repairs_queued: 0, clean: syms.length, queued: [] };
  const queued = [], clean = [];
  for (const s of syms) {
    const g = await scanGaps(db, s.symbol, day);
    if (g.present === 0 || g.missing > 0) { await enqueue(db, 'backfill', s.symbol, day, { priority: 3 }); queued.push({ symbol: s.symbol, missing: g.missing, present: g.present }); }
    else clean.push(s.symbol);
  }
  return { date: day, symbols: syms.length, repairs_queued: queued.length, clean: clean.length, queued };
}
