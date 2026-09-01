// Embeds view.html into view.js so worker.js can import it without a bundler
// rule; wrangler bundles ES imports, node tests import it too.
import { readFileSync, writeFileSync } from 'node:fs';
const engine = readFileSync(new URL('./engine.cjs', import.meta.url), 'utf8').replace(/if \(typeof module[^\n]*\n?/, '');
const html = readFileSync(new URL('./view.html', import.meta.url), 'utf8').replace('<!--ENGINE-->', '<script>\n' + engine + '\n</script>');
const radar = readFileSync(new URL('./radar.html', import.meta.url), 'utf8').replace('<!--ENGINE-->', '<script>\n' + engine + '\n</script>');
writeFileSync(new URL('./view.js', import.meta.url),
  '// GENERATED from view.html / radar.html by build-view.mjs — edit those, not this file.\n' +
  'export const VIEW_HTML = ' + JSON.stringify(html) + ';\n' +
  'export const RADAR_HTML = ' + JSON.stringify(radar) + ';\n');
console.log('view.js generated: view', html.length, 'bytes, radar', radar.length, 'bytes');
