import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:');
// production schema for bars (worker.js SCHEMA) + its one secondary index
db.exec(`CREATE TABLE bars (symbol TEXT NOT NULL, unix INTEGER NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL,
  open REAL, high REAL, low REAL, close REAL, volume INTEGER, first_seen INTEGER, updated_at INTEGER,
  revisions INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (symbol, unix))`);
db.exec(`CREATE INDEX bars_symbol_date_unix ON bars (symbol, date, unix)`);
const SYMS = 130, DAYS = 20, PER = 390;
const ins = db.prepare('INSERT INTO bars VALUES (?,?,?,?,1,1,1,1,1,0,0,0)');
db.exec('BEGIN');
for (let s = 0; s < SYMS; s++) for (let d = 0; d < DAYS; d++) {
  const date = '2026-09-' + String(1 + d).padStart(2, '0'), base = 1788000000 + d * 86400;
  for (let i = 0; i < PER; i++) ins.run('S' + s, base + i * 60, date, 'm' + i);
}
db.exec('COMMIT');
db.exec('ANALYZE');
const total = db.prepare('SELECT COUNT(*) c FROM bars').get().c;
console.log('rows in bars:', total.toLocaleString(), '(' + SYMS + ' symbols x ' + DAYS + ' sessions x ' + PER + ')');
const Q = {
  'board (/board, per 60-symbol chunk)': ["SELECT symbol, unix, date, time, open, high, low, close, volume FROM bars WHERE symbol IN ('S1','S2','S3') AND date = ? AND unix > ? ORDER BY symbol, unix", ['2026-09-20', 0]],
  'toCsvRows full (/day)': ['SELECT * FROM bars WHERE symbol = ? AND date = ? ORDER BY unix', ['S1', '2026-09-20']],
  'toCsvRows since (/day incremental)': ['SELECT * FROM bars WHERE symbol = ? AND date = ? AND unix > ? ORDER BY unix', ['S1', '2026-09-20', 0]],
  'DAYS_REFRESH select (every sync)': ['SELECT symbol, date, COUNT(*), SUM(revisions), MIN(time), MAX(time) FROM bars WHERE symbol = ? AND date = ? GROUP BY symbol, date', ['S1', '2026-09-20']],
  'syncSymbol overlap read': ['SELECT unix, open, high, low, close, volume, revisions, first_seen, updated_at FROM bars WHERE symbol = ? AND unix >= ?', ['S1', 1789641000]],
  '/bars/last': ['SELECT symbol, date, time, unix, open, high, low, close, volume FROM bars WHERE symbol = ? AND unix < ? AND unix % 60 = 0 AND time >= \'09:30\' AND time <= \'15:59\' ORDER BY unix DESC LIMIT ?', ['S1', 1790000000, 5]],
  '/bars/export range': ['SELECT date, time, unix, open, high, low, close, volume FROM bars WHERE symbol = ? AND date >= ? AND date <= ? ORDER BY date, unix', ['S1', '2026-09-18', '2026-09-20']],
  '/export all dates': ['SELECT * FROM bars WHERE symbol = ? ORDER BY date, unix', ['S1']],
  '/archive, /mirror (whole symbol)': ['SELECT unix, open, high, low, close, volume FROM bars WHERE symbol = ? ORDER BY unix', ['S1']],
  '/storage': ['SELECT COUNT(*) AS n, MIN(date) AS oldest, MAX(date) AS newest, COUNT(DISTINCT date) AS days FROM bars', []],
  '/audit sample': ['SELECT unix, date, time, open, high, low, close, volume FROM bars WHERE symbol = ? AND date = ? AND (unix % ?) = 0 ORDER BY unix', ['S1', '2026-09-20', 60]],
  '/trace count': ['SELECT COUNT(*) AS n FROM bars WHERE symbol = ? AND date = ?', ['S1', '2026-09-20']],
  'ensureSchema days backfill': ['SELECT symbol, date, COUNT(*), SUM(revisions), MIN(time), MAX(time) FROM bars GROUP BY symbol, date', []],
};
for (const [name, [sql, args]] of Object.entries(Q)) {
  const plan = db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args).map(r => r.detail).join(' ; ');
  const rows = db.prepare(sql).all(...args).length;
  console.log(name.padEnd(38), '| returned ' + String(rows).padStart(7), '|', plan);
}
