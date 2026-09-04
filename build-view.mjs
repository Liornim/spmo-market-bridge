// Embeds view.html into view.js so worker.js can import it without a bundler
// rule; wrangler bundles ES imports, node tests import it too.
import { readFileSync, writeFileSync } from 'node:fs';
const strip = s => s.replace(/^var E = require\([^\n]*\n/m, '').replace(/module\.exports[^;]*;\s*$/m, '').replace(/if \(typeof module[^\n]*\n?/, '');
// A build stamp, so a stale page is obvious instead of being mistaken for a fix
// that did not work. Every page carries it and shows it.
// A plain counter, not a timestamp. Comparing "2026-09-04 15:24Z" against
// "2026-09-04 16:02Z" to decide whether a fix is deployed is work; v41 against
// v42 is not. The number lives in VERSION and every build bumps it.
const VERSION_FILE = new URL('./VERSION', import.meta.url);
let VERSION_N = 1;
try { VERSION_N = parseInt(readFileSync(VERSION_FILE, 'utf8').trim(), 10) || 1; } catch (e) { /* first build */ }
VERSION_N += 1;
writeFileSync(VERSION_FILE, String(VERSION_N) + '\n');
const BUILD = 'v' + VERSION_N + '  (' + new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z)';
const stamp = s => s.replace(/<!--BUILD-->/g, BUILD);
const engine = strip(readFileSync(new URL('./engine.cjs', import.meta.url), 'utf8'))
  + '\n' + strip(readFileSync(new URL('./layers.cjs', import.meta.url), 'utf8')).replace(/\bE\.(analyze|tactical|momentum|executionPlan|radarRow|bottomLine|sortRadar|pressure|fmtR|marketContext)\b/g, '$1')
  + '\n' + strip(readFileSync(new URL('./candidate.cjs', import.meta.url), 'utf8')).replace(/\bE\.(analyze|tactical|momentum|executionPlan|radarRow|bottomLine|sortRadar|pressure|fmtR|marketContext)\b/g, '$1');
const html = stamp(readFileSync(new URL('./view.html', import.meta.url), 'utf8')).replace('<!--ENGINE-->', '<script>\n' + engine + '\n</script>');
const radar = stamp(readFileSync(new URL('./radar.html', import.meta.url), 'utf8')).replace('<!--ENGINE-->', '<script>\n' + engine + '\n</script>');
const dbPage = readFileSync(new URL('./db.html', import.meta.url), 'utf8');
const dataPage = readFileSync(new URL('./data.html', import.meta.url), 'utf8');
const scanRaw = stamp(readFileSync(new URL('./scan.html', import.meta.url), 'utf8'));
const scanPage = scanRaw.replace('<!--ENGINE-->', '<script>\n' + engine + '\n</script>');
writeFileSync(new URL('./view.js', import.meta.url),
  '// GENERATED from view.html / radar.html by build-view.mjs — edit those, not this file.\n' +
  'export const VIEW_HTML = ' + JSON.stringify(html) + ';\n' +
  'export const RADAR_HTML = ' + JSON.stringify(radar) + ';\n' +
  'export const DB_HTML = ' + JSON.stringify(dbPage) + ';\n' +
  'export const DATA_HTML = ' + JSON.stringify(dataPage) + ';\n' +
  'export const SCAN_HTML = ' + JSON.stringify(scanPage) + ';\n' +
  'export const BUILD = ' + JSON.stringify(BUILD) + ';\n');
console.log('build ' + BUILD + ' — view.js generated: view', html.length, ', radar', radar.length, ', db', dbPage.length, ', data', dataPage.length, ', scan', scanPage.length, 'bytes');
