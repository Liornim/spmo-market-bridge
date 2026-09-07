// READ THE PUBLISHED STATE. This replaces every 'send me /trace', 'send me
// /universe', 'run this SQL' I have asked for. If it prints NOT PUBLISHED, the
// only thing missing is the two Worker secrets; nothing else is needed.
//   node state.mjs            -> the whole picture
//   node state.mjs coverage   -> one view raw
const REPO = process.env.GH_REPO || 'Liornim/spmo-market-bridge', BRANCH = 'data';
const raw = p => 'https://raw.githubusercontent.com/' + REPO + '/' + BRANCH + '/data/state/' + p + '.json';
const get = async n => { const r = await fetch(raw(n)); return r.status === 404 ? null : r.ok ? r.json() : { error: r.status }; };
const view = process.argv[2];
if (view) { console.log(JSON.stringify(await get(view), null, 1)); process.exit(0); }
const S = {}; for (const n of ['build', 'coverage', 'universe', 'storage', 'days', 'usage', 'runs', 'log']) S[n] = await get(n);
if (!S.build) {
  console.log('NOT PUBLISHED. The Worker needs two secrets, then /publish/state once:');
  console.log('  wrangler secret put GH_TOKEN     (a GitHub token with contents:write on ' + REPO + ')');
  console.log('  wrangler secret put GH_REPO      (' + REPO + ')');
  process.exit(2);
}
console.log('BUILD      ' + S.build.build + '  schema ' + S.build.schema + '  published ' + S.build.generated);
const c = S.coverage;
const d1By = {}; (c.d1 || []).forEach(r => { d1By[r.symbol] = r; });
const arc = (c.archive_symbols || []).filter(x => x.symbol);
const arcBy = {}; arc.forEach(x => { arcBy[x.symbol] = x; });
const all = Array.from(new Set(Object.keys(d1By).concat(arc.map(x => x.symbol)).concat(c.universe || []))).sort();
const empty = all.filter(s => !(d1By[s] && d1By[s].bars) && !(arcBy[s] && arcBy[s].bars));
const notInUni = all.filter(s => (c.universe || []).indexOf(s) < 0 && !(c.tracked || []).includes(s));
console.log('STORES     D1: ' + (c.tracked || []).length + ' tracked, ' + Object.keys(d1By).length + ' with bars   |   archive: ' + arc.length + ' registered, ' + arc.filter(x => x.bars).length + ' with bars   |   universe: ' + (c.universe || []).length);
console.log('STORAGE    D1 ' + S.storage.d1.rows.toLocaleString() + ' rows, ' + S.storage.d1.sessions + ' sessions, ~' + S.storage.d1.est_mb + ' MB (keep ' + S.storage.d1.keep_days + ')');
console.log('EMPTY      ' + empty.length + ' registered with no bars anywhere: ' + (empty.join(', ') || 'none'));
console.log('NOT IN UNI ' + notInUni.length + ' registered but in neither universe nor tracking: ' + (notInUni.join(', ') || 'none'));
const last = (S.runs && S.runs.rows || []).slice(0, 3).map(r => r.started_at + ' ' + (r.status || '') + ' ' + (r.note || r.kind || '')).join(' | ');
console.log('RUNS       ' + (last || '—'));
const warn = (S.log && S.log.entries || []).filter(e => e.level !== 'info').slice(-5).map(e => e.t.slice(11, 16) + ' ' + e.code + ': ' + e.message).join('\n           ');
console.log('WARNINGS   ' + (warn || 'none'));
console.log('USAGE      reads ' + (S.usage.read_pct ?? '?') + '%  writes ' + (S.usage.write_pct ?? '?') + '%');
console.log('\nper-symbol archive bars (lowest 10):');
arc.filter(x => x.bars != null).sort((a, b) => (a.bars || 0) - (b.bars || 0)).slice(0, 10).forEach(x => console.log('  ' + x.symbol.padEnd(7) + String(x.bars || 0).padStart(6)));
