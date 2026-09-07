// THE QA TEAM. Runs every suite, then the cross-cutting reviewers that no
// single suite owns, and writes one report. Finds; never fixes.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
const findings = [];
const F = (sev, area, title, detail) => findings.push({ sev, area, title, detail: String(detail || '') });
const run = (cmd) => { try { return { ok: true, out: execSync(cmd, { encoding: 'utf8', stdio: 'pipe', timeout: 240000 }) }; }
  catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; } };

// ---- 1. every suite, as its own reviewer
const suites = [
  ['worker', 'node --no-warnings test.mjs'], ['engine', 'node --no-warnings engine_test.cjs'],
  ['layers', 'node --no-warnings layers_test.cjs'], ['state', 'node --no-warnings state_test.cjs'],
  ['pack', 'node --no-warnings pack_test.cjs'], ['candidate', 'node --no-warnings candidate_test.cjs'],
  ['buycard', 'node --no-warnings buycard_test.cjs'], ['replay', 'node --no-warnings replay_test.cjs'],
  ['replay page', 'node --no-warnings replay_page_test.mjs'], ['replay qa', 'node --no-warnings replay_qa.mjs'],
  ['parity', 'node --no-warnings parity_test.mjs'], ['trader parity', 'node --no-warnings trader_parity_test.mjs'],
  ['trader v2', 'node --no-warnings trader_v2_test.cjs'], ['trader v2 qa', 'node --no-warnings trader_v2_qa.mjs'],
  ['bars', 'node --no-warnings bars_test.mjs'], ['bulk probe', 'node --no-warnings bulk_probe.mjs'],
  ['layout', 'node --no-warnings layout_test.mjs'], ['bundle fresh', 'node --no-warnings bundle_fresh.mjs'],
  ['radar smoke', 'node --no-warnings radar_smoke.mjs'], ['scan', 'node --no-warnings scan_test.mjs'],
  ['render card', 'node --no-warnings render_card.mjs'], ['live repair', 'node --no-warnings live_repair.mjs'],
  ['data qa', 'node --no-warnings data_qa.mjs'], ['url probe', 'node --no-warnings url_probe.mjs'],
  ['v2 qa team', 'node trader-v2-qa-runner.cjs'], ['v2 batch', 'node trader-v2-batch-qa.cjs']
];
const suiteResults = [];
// a suite that passes alone and fails in sequence is flaky, and flakiness is a finding
const flaky = [];
for (const [name, cmd] of suites) {
  const r = run(cmd);
  const m = r.out.match(/(\d+) passed,? (\d+) failed/);
  const nr = r.out.match(/(\d+) not run/);
  suiteResults.push({ name, pass: m ? +m[1] : null, fail: m ? +m[2] : null, notRun: nr ? +nr[1] : 0, exit: r.ok });
  if (m && +m[2] > 0) {
    const again = run(cmd); const m2 = again.out.match(/(\d+) passed,? (\d+) failed/);
    if (m2 && +m2[2] === 0) { flaky.push(name); F('HIGH', 'flaky:' + name, 'suite failed once and passed on rerun — non-deterministic', r.out.split('\n').filter(l => /^FAIL/.test(l)).join('; ').slice(0, 200)); }
    else r.out.split('\n').filter(l => /^FAIL/.test(l)).forEach(l => F('HIGH', 'suite:' + name, l.replace(/^FAIL\s+/, ''), ''));
  }
  if (!m && !r.ok) F('HIGH', 'suite:' + name, 'suite did not complete', r.out.slice(-300));
}

// ---- 2. cross-cutting reviewers
const worker = readFileSync('worker.js', 'utf8'), view = readFileSync('view.js', 'utf8');
const pages = ['radar.html', 'scan.html', 'bars.html', 'replay.html', 'trader-v2-replay.html', 'view.html', 'db.html', 'data.html']
  .filter(existsSync).map(f => [f, readFileSync(f, 'utf8')]);

// 2a. DOM-binding reviewer: any assignment of a handler to a compound selector
pages.forEach(([f, src]) => {
  const bad = [...src.matchAll(/document\.querySelector\((['"])([^'"]+)\1\)\.(onclick|onchange|oninput)\s*=/g)]
    .filter(m => /[ >:.\[]/.test(m[2]) && !/^#[\w-]+$/.test(m[2]));
  bad.forEach(m => F('HIGH', 'dom:' + f, 'handler assigned to a compound selector that may match nothing', m[2]));
  const nullable = [...src.matchAll(/qs\((['"])([^'"]+)\1\)\.(onclick|onchange|oninput)\s*=/g)].filter(m => !/^#[\w-]+$/.test(m[2]));
  nullable.forEach(m => F('MEDIUM', 'dom:' + f, 'qs() handler on non-id selector', m[2]));
});
// 2b. hidden attribute reviewer
pages.forEach(([f, src]) => {
  if (!/\[hidden\]\{display:none\s*!important\}/.test(src)) F('HIGH', 'css:' + f, 'no global [hidden] override — display:flex containers ignore hidden', '');
  if (/html,body\{/.test(src) && !/overflow-x:hidden/.test(src)) F('MEDIUM', 'css:' + f, 'no overflow-x:hidden on html,body — mobile viewport can widen', '');
});
// 2c. KV budget reviewer: every KV put must be gated or deduped
{
  const puts = [...worker.matchAll(/env\.LOG\.put\(/g)].length;
  const gated = /open && date === today\) ctx\.waitUntil\(snapshotPut/.test(worker) && /marketOpen\(nowSec\(\)\) && date === todayLocal\(\)\) ctx\.waitUntil\(snapshotPut/.test(worker);
  if (!gated) F('HIGH', 'kv', 'snapshot writes not gated to a live session', '');
  if (!/last\.repeats = \(last\.repeats \|\| 1\) \+ 1/.test(worker)) F('HIGH', 'kv', 'log writer spends a put per repeated event', '');
  F('INFO', 'kv', puts + ' KV put sites in worker.js', 'log + snapshot');
}
// 2d. D1 quota reviewer: any route reading a full day without a cursor on a heartbeat
{
  if (!/route === 'tick'/.test(worker)) F('MEDIUM', 'd1', 'no /tick heartbeat route', '');
  // the heartbeat shares a guard line with /board; a real read would be a db.prepare inside the tick branch
  if (/route === 'tick'\)[\s\S]{0,300}db\.prepare\(/.test(worker) && !/route === 'tick'\)[\s\S]{0,300}reads ZERO/.test(worker)) F('HIGH', 'd1', '/tick reads D1', '');
  if (!/D1_KEEP_DAYS/.test(worker)) F('HIGH', 'd1', 'no D1 retention window', '');
}
// 2e. isolation reviewer: V2 never touches production
{
  ['trader-v2-engine.cjs', 'trader-v2-replay.cjs'].forEach(f => {
    const s = readFileSync(f, 'utf8');
    if (/(^|[^\w.])(buildTickerState|executionPlan|radarRow)\s*\(/.test(s)) F('CRITICAL', 'isolation', f + ' calls production engine', '');
    if (/require\('\.\/(engine|layers|candidate)/.test(s)) F('CRITICAL', 'isolation', f + ' imports production module', '');
  });
  const v2 = JSON.parse(view.split('export const TRADER_V2_HTML = ')[1].split('\n')[0].trim().replace(/;$/, ''));
  if (/function buildTickerState|function radarRow|function executionPlan/.test(v2)) F('CRITICAL', 'isolation', 'V2 page bundles the production engine', '');
}
// 2f. bundle freshness reviewer
{
  const r = run('node --no-warnings bundle_fresh.mjs'); if (!r.ok) F('CRITICAL', 'build', 'view.js is stale against its sources', '');
}
// 2g. secrets reviewer: nothing sensitive in the shipped page bundle
{
  ['github_pat_', 'eyJhbGciOi', 'sk_live', 'SUPABASE_KEY'].forEach(k => { if (view.includes(k)) F('CRITICAL', 'secrets', 'token-like string in view.js', k); });
  pages.forEach(([f, s]) => { if (/github_pat_|eyJhbGciOi/.test(s)) F('CRITICAL', 'secrets', 'token-like string in ' + f, ''); });
}
// 2h. dead-link reviewer: every href/route in pages exists in the worker
{
  const routes = new Set([...worker.matchAll(/route === '([a-z0-9-]+)'/g)].map(m => m[1]).concat([...worker.matchAll(/p0\[0\] === '([a-z0-9-]+)'/g)].map(m => m[1])));
  pages.forEach(([f, s]) => {
    [...s.matchAll(/href="\/([a-z0-9-]+)/g)].map(m => m[1]).forEach(r => { if (!routes.has(r)) F('MEDIUM', 'links:' + f, 'href to a route the worker does not define', '/' + r); });
    [...s.matchAll(/j\('\/([a-z0-9-]+)/g)].map(m => m[1]).forEach(r => { if (!routes.has(r)) F('HIGH', 'links:' + f, 'fetch to a route the worker does not define', '/' + r); });
  });
}
// 2i. error-path reviewer: every fetch in pages has a rejection handler
pages.forEach(([f, s]) => {
  const thens = (s.match(/\.then\(/g) || []).length, catches = (s.match(/\.then\(function\([^)]*\)\{[^}]*\},function/g) || []).length + (s.match(/\.catch\(/g) || []).length;
  if (thens > 0 && catches / thens < 0.3) F('LOW', 'errors:' + f, 'few rejection handlers relative to promises', catches + '/' + thens);
});
// 2j. schema reviewer
{
  const tables = [...worker.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]);
  const expected = (readFileSync('test.mjs', 'utf8').match(/EXPECTED_TABLES = \[([^\]]+)\]/) || [])[1] || '';
  tables.forEach(t => { if (!expected.includes("'" + t + "'")) F('HIGH', 'schema', 'table not in EXPECTED_TABLES', t); });
}
// 2k. cron reviewer
{
  const toml = existsSync('../repo/wrangler.toml') ? readFileSync('../repo/wrangler.toml', 'utf8') : '';
  const crons = (toml.match(/crons = \[([^\]]+)\]/) || [])[1] || '';
  if (!/13-21/.test(crons)) F('MEDIUM', 'cron', 'no intraday cron in wrangler.toml', crons);
  if (!/0-1/.test(crons)) F('MEDIUM', 'cron', 'no nightly cron', crons);
  if (!/publishShard\(env, db, slice\)/.test(worker)) F('HIGH', 'publish', 'nightly pass does not publish', '');
}
// 2l. accessibility / RTL reviewer
pages.forEach(([f, s]) => {
  if (!/dir="rtl"/.test(s)) F('LOW', 'rtl:' + f, 'no dir=rtl on html', '');
  if (!/viewport-fit=cover|width=device-width/.test(s)) F('MEDIUM', 'mobile:' + f, 'no viewport meta', '');
});
// 2m. money-math reviewer in V2
{
  const e = readFileSync('trader-v2-engine.cjs', 'utf8');
  if (/plan\.rr < cfg\.minRR/.test(e)) F('HIGH', 'v2', 'R:R gate reads the rounded display value', '');
  if (/riskRaw \* cfg\.minRR|riskRaw \* 1\.5\b/.test(e)) F('HIGH', 'v2', 'a target is generated to equal the minimum', '');
  if (!/structureBroken\(b, prior\.plan, cfg\)/.test(e)) F('MEDIUM', 'v2', 'invalidation not on close', '');
}
// 2n. QA data hygiene: no synthetic file mistaken for real data
{
  if (existsSync('qa-data')) readdirSync('qa-data').forEach(f => { if (/synth|test|fake/i.test(f)) F('HIGH', 'qa-data', 'synthetic file present in qa-data', f); });
}

// ---- report
const sevOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
findings.sort((a, b) => sevOrder[a.sev] - sevOrder[b.sev]);
const counts = findings.reduce((a, f) => (a[f.sev] = (a[f.sev] || 0) + 1, a), {});
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>QA Team Report</title>
<style>body{font:14px/1.5 system-ui;max-width:1100px;margin:20px auto;padding:0 16px;color:#1B2430;background:#F2F4F7}
table{width:100%;border-collapse:collapse;background:#fff;font-size:12.5px}th,td{padding:6px 8px;border-bottom:1px solid #D6DBE2;text-align:left;vertical-align:top}
th{background:#F2F4F7;color:#5B6673;font-size:11px}.CRITICAL td:first-child{color:#B42318;font-weight:800}.HIGH td:first-child{color:#C2410C;font-weight:700}
.MEDIUM td:first-child{color:#B7791F}.LOW td:first-child{color:#5B6673}.INFO td:first-child{color:#8A94A0}
.top{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:12px 0}.box{background:#fff;border:1px solid #D6DBE2;border-radius:10px;padding:9px 11px}.box b{font-size:20px}.box small{display:block;color:#5B6673;font-size:11px}</style>
<h1>QA TEAM REPORT <small style="color:#5B6673">${esc(readFileSync('VERSION', 'utf8').trim())} · ${new Date().toISOString()}</small></h1>
<div class="top">${['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].map(s => '<div class="box"><small>' + s + '</small><b>' + (counts[s] || 0) + '</b></div>').join('')}
<div class="box"><small>SUITES</small><b>${suiteResults.filter(s => s.fail === 0 && s.exit).length}/${suiteResults.length}</b><small>green</small></div></div>
<h2>Suites</h2><table><tr><th>suite</th><th>pass</th><th>fail</th><th>not run</th><th>exit</th></tr>
${suiteResults.map(s => '<tr><td>' + esc(s.name) + '</td><td>' + (s.pass ?? '—') + '</td><td>' + (s.fail ?? '—') + '</td><td>' + s.notRun + '</td><td>' + (s.exit ? 'ok' : 'FAIL') + '</td></tr>').join('')}</table>
<h2>Findings (${findings.length}) — nothing here was fixed</h2><table><tr><th>sev</th><th>area</th><th>finding</th><th>detail</th></tr>
${findings.map(f => '<tr class="' + f.sev + '"><td>' + f.sev + '</td><td>' + esc(f.area) + '</td><td>' + esc(f.title) + '</td><td>' + esc(f.detail) + '</td></tr>').join('')}</table></html>`;
writeFileSync('qa-team-report.html', html);
writeFileSync('qa-team-findings.json', JSON.stringify({ counts, suites: suiteResults, findings }, null, 2));
console.log('QA TEAM  suites ' + suiteResults.filter(s => s.fail === 0 && s.exit).length + '/' + suiteResults.length + ' green');
console.log('  findings: ' + JSON.stringify(counts));
findings.filter(f => f.sev !== 'INFO').forEach(f => console.log('  ' + f.sev.padEnd(9) + f.area.padEnd(22) + f.title + (f.detail ? '  [' + f.detail.slice(0, 60) + ']' : '')));
suiteResults.filter(s => !s.exit || s.fail).forEach(s => console.log('  suite ' + s.name + ': ' + s.pass + ' pass / ' + s.fail + ' fail'));
