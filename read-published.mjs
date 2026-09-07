// READ THE PUBLISHED ARCHIVE FROM GITHUB.
//
// This is how the analysis side reads candles without anyone exporting a CSV:
// the Worker publishes data/bars/SYM.csv on the `data` branch every night, and
// raw.githubusercontent.com is reachable from the sandbox even though the
// Worker itself is not. Usage:
//   node read-published.mjs                 -> manifest summary
//   node read-published.mjs NVDA AMD        -> writes qa-data/<SYM>_published.csv
import { writeFileSync, mkdirSync } from 'node:fs';
const REPO = process.env.GH_REPO || 'Liornim/spmo-market-bridge', BRANCH = 'data';
const raw = p => 'https://raw.githubusercontent.com/' + REPO + '/' + BRANCH + '/' + p;
const api = p => 'https://api.github.com/repos/' + REPO + '/contents/' + p + '?ref=' + BRANCH;

// The symbol list comes from the Worker source itself: ARCHIVE_UNIVERSE plus
// any extras named in the environment. No GitHub listing call is needed, and
// raw.githubusercontent.com serves each file without authentication.
import { readFileSync } from 'node:fs';
function universe() {
  const src = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
  const m = src.match(/const ARCHIVE_UNIVERSE = \[([\s\S]*?)\];/);
  const fixed = m ? m[1].match(/'([A-Z.\-]+)'/g).map(x => x.slice(1, -1)) : [];
  const extra = (process.env.UNIVERSE_EXTRA || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  return Array.from(new Set(fixed.concat(extra)));
}
async function list() {
  // probe the first symbol: if it is absent nothing has been published
  const probe = await fetch(raw('data/bars/' + universe()[0] + '.csv'));
  if (probe.status === 404) return null;
  return universe();
}
async function csv(sym) {
  const r = await fetch(raw('data/bars/' + sym + '.csv'));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('github ' + r.status + ' ' + sym);
  return r.text();
}
const syms = process.argv.slice(2);
const files = await list();
if (!files) {
  console.log('NOT PUBLISHED YET: the `' + BRANCH + '` branch has no data/bars. Set GH_TOKEN and GH_REPO on the Worker, then hit /publish/shard?cursor=0 (or wait for the nightly pass).');
  process.exit(2);
}
console.log('published symbols:', files.length);
if (!syms.length) { console.log(files.join(' ')); process.exit(0); }
mkdirSync('qa-data', { recursive: true });
for (const s of syms) {
  const t = await csv(s);
  if (!t) { console.log(s + ': not published'); continue; }
  const n = t.split('\n').filter(Boolean).length - 1;
  writeFileSync('qa-data/' + s + '_published.csv', t);
  console.log(s + ': ' + n + ' rows -> qa-data/' + s + '_published.csv');
}
