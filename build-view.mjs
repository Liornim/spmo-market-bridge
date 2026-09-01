// Embeds view.html into view.js so worker.js can import it without a bundler
// rule; wrangler bundles ES imports, node tests import it too.
import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync(new URL('./view.html', import.meta.url), 'utf8');
writeFileSync(new URL('./view.js', import.meta.url),
  '// GENERATED from view.html by build-view.mjs — edit view.html, not this file.\n' +
  'export const VIEW_HTML = ' + JSON.stringify(html) + ';\n');
console.log('view.js generated,', html.length, 'bytes');
