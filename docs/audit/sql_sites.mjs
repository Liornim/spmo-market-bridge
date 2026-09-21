import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../../worker.js', import.meta.url), 'utf8');
const lines = src.split('\n');
// enclosing function / route for each line
const fnAt = [], rtAt = [];
let fn = '(top)', rt = '';
lines.forEach((l, i) => {
  const m = l.match(/^(?:async )?function ([A-Za-z0-9_]+)\(/); if (m) { fn = m[1]; rt = ''; }
  const r = l.match(/if \(\(?route === '([a-z0-9-]+)'(?: && a === '([a-z]+)')?/); if (r) rt = '/' + r[1] + (r[2] ? '/' + r[2] : '');
  fnAt[i] = fn; rtAt[i] = rt;
});
const out = [];
const re = /prepare\(\s*(`[\s\S]*?`|'(?:[^'\\]|\\.)*'(?:\s*\+\s*(?:'(?:[^'\\]|\\.)*'|[A-Za-z_.()\[\]'+ ,]+?))*|"(?:[^"\\]|\\.)*"|[A-Z_]+)\s*\)/g;
let m;
while ((m = re.exec(src))) {
  const ln = src.slice(0, m.index).split('\n').length - 1;
  let sql = m[1].replace(/\s+/g, ' ').slice(0, 140);
  out.push({ line: ln + 1, fn: fnAt[ln], route: rtAt[ln], sql });
}
console.log(out.length + ' prepare() sites');
const kind = s => /^\W*(SELECT|`SELECT|'SELECT)/i.test(s) ? 'R' : /INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP/i.test(s) ? 'W' : '?';
out.forEach(o => console.log([o.line, kind(o.sql), o.fn, o.route, o.sql].join(' | ')));
