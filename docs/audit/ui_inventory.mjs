// UI inventory extractor. For every served page: every interactive element,
// its handler, and every endpoint the handler can reach through the page's own
// functions (static call graph, transitive). Output: ui_inventory.json.
import { readFileSync, writeFileSync } from 'node:fs';
const PAGES = { 'view.html': '/view/:sym', 'radar.html': '/radar', 'trader-v2-radar.html': '/trader-v2/radar',
  'trader-v2-live.html': '/trader-v2/live', 'trader-v2-replay.html': '/trader-v2', 'replay.html': '/replay',
  'scan.html': '/scan', 'bars.html': '/bars', 'data.html': '/data', 'db.html': '/db', 'trader-v2-batch-report.html': '/trader-v2/qa' };
const ROOT = new URL('../../', import.meta.url);
const matchBrace = (s, i) => { let d = 0; for (; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}') { d--; if (!d) return i; } } return s.length - 1; };
const lineOf = (s, i) => s.slice(0, i).split('\n').length;
// route names taken from worker.js (p0[0] / route === '…'), not hand-picked
const EP = /['"`](\/(?:archive|audit|auth|backfill|bars|board|book|bookprobe|coverage|daily|day|days|db|diag|export|migrate|mirror|publish|radar|replay|selfcheck|status|storage|sync|table|tick|trace|trader-v2|trader-v2-live|trader-v2-qa|trader-v2-radar|universe|usage|view|watch|data|log|logtest|scan|health|last)(?![A-Za-z0-9_-])[A-Za-z0-9_\/\-]*)/g;
const out = {};
for (const [file, route] of Object.entries(PAGES)) {
  const src = readFileSync(new URL(file, ROOT), 'utf8');
  if (file.length > 400000) {}
  // functions
  const fns = {};
  for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const b = src.indexOf('{', m.index), e = matchBrace(src, b);
    fns[m[1]] = fns[m[1]] || { line: lineOf(src, m.index), body: src.slice(b, e + 1) };
  }
  for (const m of src.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\s*\(/g)) {
    const b = src.indexOf('{', m.index), e = matchBrace(src, b);
    fns[m[1]] = fns[m[1]] || { line: lineOf(src, m.index), body: src.slice(b, e + 1) };
  }
  const names = Object.keys(fns);
  const direct = t => [...new Set([...t.matchAll(EP)].map(x => x[1].replace(/\/+$/, '')))];
  const callees = t => names.filter(n => new RegExp('(^|[^\\w$.])' + n.replace('$', '\\$') + '\\s*\\(').test(t));
  const reach = (t, seen = new Set()) => {
    const eps = new Set(direct(t));
    for (const c of callees(t)) { if (seen.has(c)) continue; seen.add(c); reach(fns[c].body, seen).eps.forEach(e => eps.add(e)); }
    return { eps, fns: seen };
  };
  const actions = [];
  const add = (kind, line, label, handlerText, meta = {}) => {
    const r = reach(handlerText); actions.push({ kind, line, label: label.replace(/\s+/g, ' ').trim().slice(0, 80), handler: handlerText.replace(/\s+/g, ' ').slice(0, 160), endpoints: [...r.eps].sort(), via: [...r.fns].sort(), ...meta });
  };
  // buttons (static + generated), with their inline handlers
  for (const m of src.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)) {
    const at = m[1], id = (at.match(/id=\\?["']([^"'\\]+)/) || [])[1] || '', oc = (at.match(/onclick=\\?["']([^"'\\]*)/) || [])[1] || '';
    add('button', lineOf(src, m.index), m[2].replace(/<[^>]+>/g, '').replace(/'\s*\+[^+]*\+\s*'/g, '…'), oc, { id, attrs: at.trim().slice(0, 120) });
  }
  // inline handlers on other tags
  for (const m of src.matchAll(/<(a|select|input|div|span|td|tr|li|label|summary|details|img|svg|g|text)\b([^>]*\bon(click|change|input|keydown|toggle)=\\?["']([^"'\\]*))/g))
    add('inline-' + m[3], lineOf(src, m.index), m[1] + ' ' + ((m[2].match(/id=\\?["']([^"'\\]+)/) || [])[1] || ''), m[4], {});
  // property bindings  x.onclick = function(){...} | name
  for (const m of src.matchAll(/([\w$#'"().\[\]\-]{1,60})\.on(click|change|input|keydown|submit|toggle|scroll)\s*=\s*/g)) {
    const i = m.index + m[0].length; let h;
    if (/^(async\s*)?function|^\(/.test(src.slice(i))) { const b = src.indexOf('{', i); h = src.slice(i, matchBrace(src, b) + 1); }
    else h = (src.slice(i).match(/^[\w$.]+/) || [''])[0] + '()';
    add('bind-' + m[2], lineOf(src, m.index), m[1], h, {});
  }
  // helper binding: on('#id','click',handler)
  for (const m of src.matchAll(/\bon\(\s*['"]#?([\w-]+)['"]\s*,\s*['"](\w+)['"]\s*,\s*/g)) {
    const i = m.index + m[0].length; let h;
    if (/^(async\s*)?function|^\(/.test(src.slice(i))) { const b = src.indexOf('{', i); h = src.slice(i, matchBrace(src, b) + 1); }
    else h = (src.slice(i).match(/^[\w$.]+/) || [''])[0] + '()';
    add('on-' + m[2], lineOf(src, m.index), '#' + m[1], h, { id: m[1] });
  }
  for (const m of src.matchAll(/addEventListener\(\s*['"](\w+)['"]\s*,\s*/g)) {
    const i = m.index + m[0].length; let h;
    if (/^(async\s*)?function|^\(/.test(src.slice(i))) { const b = src.indexOf('{', i); h = src.slice(i, matchBrace(src, b) + 1); }
    else h = (src.slice(i).match(/^[\w$.]+/) || [''])[0] + '()';
    add('listener-' + m[1], lineOf(src, m.index), src.slice(Math.max(0, m.index - 40), m.index).split(/[\n;]/).pop(), h, {});
  }
  for (const m of src.matchAll(/(setInterval|setTimeout)\(\s*/g)) {
    const i = m.index + m[0].length; let h;
    if (/^(async\s*)?function|^\(/.test(src.slice(i))) { const b = src.indexOf('{', i); h = src.slice(i, matchBrace(src, b) + 1); }
    else h = (src.slice(i).match(/^[\w$.]+/) || [''])[0] + '()';
    const delay = (src.slice(i + h.length, i + h.length + 40).match(/^\s*,\s*([^)]{1,30})\)/) || [])[1] || '';
    add('timer-' + m[1], lineOf(src, m.index), 'delay ' + delay, h, {});
  }
  out[file] = { route, functions: names.length, actions };
}
writeFileSync(new URL('ui_inventory.json', import.meta.url), JSON.stringify(out, null, 1));
for (const [f, p] of Object.entries(out)) {
  const k = {}; p.actions.forEach(a => k[a.kind] = (k[a.kind] || 0) + 1);
  console.log(f.padEnd(28), 'actions', String(p.actions.length).padStart(3), JSON.stringify(k));
}

// ---- coverage join: every button must resolve to a handler
const cov = {};
for (const [f, p] of Object.entries(out)) {
  const binds = p.actions.filter(a => a.kind !== 'button');
  const unresolved = [];
  for (const b of p.actions.filter(a => a.kind === 'button')) {
    let how = '';
    if (b.handler) how = 'inline onclick';
    else if (b.id) { const hit = binds.find(x => x.label.includes("'#" + b.id + "'") || x.label.includes('"#' + b.id + '"') || x.label === '#' + b.id || x.id === b.id || x.label.includes("('" + b.id + "')")); if (hit) { how = 'bound line ' + hit.line; b.endpoints = hit.endpoints; b.via = hit.via; b.bound = hit.handler; } }
    b.resolved = how;
    if (!how) unresolved.push(b.line + ' ' + (b.id || '-') + ' "' + b.label.slice(0, 30) + '" ' + b.attrs.slice(0, 70));
  }
  cov[f] = unresolved;
}
writeFileSync(new URL('ui_inventory.json', import.meta.url), JSON.stringify(out, null, 1));
if (process.argv.includes('--unresolved')) for (const [f, u] of Object.entries(cov)) { console.log('== ' + f + ' unresolved ' + u.length); u.forEach(x => console.log('   ' + x)); }
