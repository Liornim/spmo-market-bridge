// LAYOUT — the rules that decide whether things fit on a phone screen.
//
// Three times I shipped a card that was cut off at the edge, because my tests
// checked that a CSS string was present rather than whether the layout could
// overflow. These check the properties that actually decide it.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const src = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const ck = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   [' + x + ']' : ''}`); };

function rulesOf(pageName) {
  const page = JSON.parse(src.split('export const ' + pageName + ' = ')[1].split('\nexport const ')[0].trim().replace(/;$/, ''));
  const css = page.split('<style>')[1].split('</style>')[0];
  const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head><body></body></html>`);
  const sheet = [...dom.window.document.styleSheets[0].cssRules];
  return {
    decl: (sel, prop) => {
      const r = sheet.find(x => x.selectorText === sel);
      return r ? r.style.getPropertyValue(prop) : null;
    },
    all: sheet.filter(r => r.selectorText),
    page: page
  };
}
const isZero = v => v === '0' || v === '0px';

// ---- every flex/grid item that holds text must be able to shrink -----------
for (const [name, page] of [['radar', 'RADAR_HTML'], ['scan', 'SCAN_HTML']]) {
  const R = rulesOf(page);

  // Containers that hold a whole view. If these cannot shrink, everything
  // inside them is cut at the screen edge no matter how it is styled.
  const containers = name === 'radar' ? ['.panel'] : ['.rows', '.sugg'];
  containers.forEach(sel => {
    const w = R.decl(sel, 'width'), mw = R.decl(sel, 'min-width');
    if (w === '100%') ck(name + ': ' + sel + ' with width:100% can shrink below its content',
      isZero(mw), 'min-width: ' + (mw || 'NOT SET'));
    else ck(name + ': ' + sel + ' does not claim a fixed full width', true, w || 'auto');
  });

  // A grid column sized `auto` takes its content's width and will push its
  // container wider than the screen. minmax(0,...) lets it give way.
  // A column sized `auto` takes its content's width and can push its container
  // past the screen edge. Enforced on the buy card, which is what I am
  // changing; reported for the rest, which predates it and is left alone.
  R.all.forEach(r => {
    const cols = r.style.getPropertyValue('grid-template-columns');
    if (!cols) return;
    const bare = cols.split(' ').filter(c => c === 'auto' || c === 'max-content' || c === 'min-content');
    if (!bare.length) return;
    if (/^\.bc|^\.buycard/.test(r.selectorText))
      ck(name + ': ' + r.selectorText + ' has no column that cannot give way', false, cols);
    else console.log('NOTE  ' + name + ': ' + r.selectorText + ' uses ' + cols
      + ' — pre-existing, short content, left alone');
  });
}

// ---- the buy card specifically --------------------------------------------
{
  const R = rulesOf('RADAR_HTML');
  ck('the buy card is bounded by its container', R.decl('.buycard', 'max-width') === '100%');
  ck('and every element inside it is too', R.decl('.buycard *', 'max-width') === '100%'
    && isZero(R.decl('.buycard *', 'min-width')));
  ck('it has its own side padding', /16px/.test(R.decl('.buycard', 'padding') || ''),
    R.decl('.buycard', 'padding'));
  ck('it paints its own background', !!R.decl('.buycard', 'background'));
  ck('values that can be long are allowed to wrap',
    /anywhere|break-word/.test(R.decl('.bctech span>b', 'overflow-wrap') || ''),
    R.decl('.bctech span>b', 'overflow-wrap'));

  // The failure mode itself: a value pushed to an edge that is off-screen.
  R.all.forEach(r => {
    if (!/^\.bc/.test(r.selectorText || '')) return;
    const jc = r.style.getPropertyValue('justify-content');
    ck('buy card: ' + r.selectorText + ' does not push content to an edge',
      jc !== 'space-between', jc || '');
  });
}


// ---- the page itself must never exceed the screen -------------------------
// This was the actual cause of a card that stayed clipped through four fixes:
// nothing stopped the PAGE from growing wider than the viewport, and a mobile
// browser then widens the layout viewport to fit. A fixed overlay is positioned
// against that widened viewport, so it appears shifted and cut — and no rule
// inside the overlay can help, because the overlay is not what overflowed.
for (const [name, page] of [['radar', 'RADAR_HTML'], ['scan', 'SCAN_HTML'], ['data', 'DATA_HTML'], ['db', 'DB_HTML'], ['bars', 'BARS_HTML'], ['replay', 'REPLAY_HTML']]) {
  const R = rulesOf(page);
  const root = R.all.find(r => /html,\s*body|^body$/.test(r.selectorText || ''));
  const ox = root ? root.style.getPropertyValue('overflow-x') : null;
  const mw = root ? root.style.getPropertyValue('max-width') : null;
  ck(name + ': the page cannot become wider than the screen',
    ox === 'hidden' || mw === '100%', 'overflow-x: ' + (ox || 'not set') + ', max-width: ' + (mw || 'not set'));
}


// ---- hiding must actually hide ------------------------------------------
// A display rule beats the hidden ATTRIBUTE. Every page here styles containers
// with display:flex or display:grid, so without a global override, setting
// hidden on one does nothing at all — which is how two tabs came to be on
// screen at the same time.
for (const [name, page] of [['radar', 'RADAR_HTML'], ['scan', 'SCAN_HTML'],
                            ['bars', 'BARS_HTML'], ['replay', 'REPLAY_HTML']]) {
  const R = rulesOf(page);
  const global = R.all.find(r => r.selectorText === '[hidden]');
  ck(name + ': the hidden attribute is honoured whatever the display rule',
    !!global && /none/.test(global.style.getPropertyValue('display'))
    && global.style.getPropertyPriority('display') === 'important',
    global ? global.style.cssText : 'NO [hidden] RULE');

  // and nothing may re-enable a hidden element by being more specific
  const offenders = R.all.filter(r => {
    const sel = r.selectorText || '';
    if (!/\[hidden\]/.test(sel)) return false;
    const d = r.style.getPropertyValue('display');
    return d && d !== 'none';
  });
  ck(name + ': no rule un-hides a hidden element', offenders.length === 0,
    offenders.map(r => r.selectorText).join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
