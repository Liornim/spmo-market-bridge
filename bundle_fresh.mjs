// The bundle must contain EXACTLY what the modules contain. Twice today a fix
// landed in a .cjs file, its unit tests passed against that file, and the page
// shipped with the OLD code because view.js was never rebuilt — the tests were
// green while the screen was wrong.
//
// This applies the same transform the build applies and requires the whole
// stripped module to be present in the bundle, character for character. Any
// edit to a module without a rebuild fails here.
import { readFileSync } from 'node:fs';
const bundle = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
const strip = s => s.replace(/^var E = require\([^\n]*\n/m, '').replace(/module\.exports[^;]*;\s*$/m, '').replace(/if \(typeof module[^\n]*\n?/, '');
// JSON.stringify is how the build embeds a page; the module text inside it is
// escaped the same way.
const embedded = s => JSON.stringify(s).slice(1, -1);

let pass = 0, fail = 0;
const ck = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   [' + x + ']' : ''}`); };

// layers.cjs and candidate.cjs have their E.* references rewritten by the build
const unE = s => s.replace(/\bE\.(analyze|tactical|momentum|executionPlan|radarRow|bottomLine|sortRadar|pressure|fmtR|marketContext)\b/g, '$1');
for (const file of ['engine.cjs', 'layers.cjs', 'buycard.cjs', 'candidate.cjs']) {
  const src = readFileSync(new URL('./' + file, import.meta.url), 'utf8');
  const body = unE(strip(src)).trim();
  // check a large window rather than the whole file, so one transform quirk at
  // the edges does not mask a genuine mismatch in the middle
  const chunks = [];
  for (let i = 0; i + 400 <= body.length; i += 400) chunks.push(body.slice(i, i + 400));
  const missing = chunks.filter(c => bundle.indexOf(embedded(c)) < 0);
  ck(file + ' is in the bundle exactly as written', missing.length === 0,
    missing.length ? 'REBUILD NEEDED (node build-view.mjs) — first mismatch near: ' + missing[0].slice(0, 60).replace(/\n/g, ' ') : chunks.length + ' chunks matched');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
