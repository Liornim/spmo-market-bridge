// Embeds view.html into view.js so worker.js can import it without a bundler
// rule; wrangler bundles ES imports, node tests import it too.
import { readFileSync, writeFileSync } from 'node:fs';
const strip = s => s.replace(/^var E = require\([^\n]*\n/m, '').replace(/module\.exports[^;]*;\s*$/m, '').replace(/if \(typeof module[^\n]*\n?/, '');
const engine = strip(readFileSync(new URL('./engine.cjs', import.meta.url), 'utf8'))
  + '\n' + strip(readFileSync(new URL('./layers.cjs', import.meta.url), 'utf8')).replace(/\bE\.(analyze|tactical|momentum|executionPlan|radarRow|bottomLine|sortRadar|pressure|fmtR|marketContext)\b/g, '$1')
  + '\n' + strip(readFileSync(new URL('./candidate.cjs', import.meta.url), 'utf8')).replace(/\bE\.(analyze|tactical|momentum|executionPlan|radarRow|bottomLine|sortRadar|pressure|fmtR|marketContext)\b/g, '$1');
const html = readFileSync(new URL('./view.html', import.meta.url), 'utf8').replace('<!--ENGINE-->', '<script>\n' + engine + '\n</script>');
const radar = readFileSync(new URL('./radar.html', import.meta.url), 'utf8').replace('<!--ENGINE-->', '<script>\n' + engine + '\n</script>');
const dbPage = readFileSync(new URL('./db.html', import.meta.url), 'utf8');
const dataPage = readFileSync(new URL('./data.html', import.meta.url), 'utf8');
const scanRaw = readFileSync(new URL('./scan.html', import.meta.url), 'utf8');
const scanPage = scanRaw.replace('<!--ENGINE-->', '<script>\n' + engine + '\n</script>');
writeFileSync(new URL('./view.js', import.meta.url),
  '// GENERATED from view.html / radar.html by build-view.mjs — edit those, not this file.\n' +
  'export const VIEW_HTML = ' + JSON.stringify(html) + ';\n' +
  'export const RADAR_HTML = ' + JSON.stringify(radar) + ';\n' +
  'export const DB_HTML = ' + JSON.stringify(dbPage) + ';\n' +
  'export const DATA_HTML = ' + JSON.stringify(dataPage) + ';\n' +
  'export const SCAN_HTML = ' + JSON.stringify(scanPage) + ';\n');
console.log('view.js generated: view', html.length, ', radar', radar.length, ', db', dbPage.length, ', data', dataPage.length, ', scan', scanPage.length, 'bytes');
