// Mirror the R2 history files to the GitHub Release "history", one zip per
// symbol (<SYM>.zip holding <SYM>/<YYYY-MM>.csv.gz) plus manifest.json.
// Why: Claude sessions and other sandboxes often cannot reach *.workers.dev,
// but they can download GitHub release assets
//   https://github.com/Liornim/spmo-market-bridge/releases/download/history/AAPL.zip
// Only symbols whose files changed since the last mirror are re-uploaded.
// Env: GH_TOKEN (gh CLI), WORKER_URL. Runs inside a GitHub Actions checkout.
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
const W = (process.env.WORKER_URL || 'https://spmo-market-bridge.noamharelnim.workers.dev').replace(/\/$/, '');
const TAG = 'history', sh = (c, o = {}) => execSync(c, { stdio: ['ignore', 'pipe', 'pipe'], ...o }).toString();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const man = await (await fetch(W + '/xa/hist/manifest')).json();
const files = man.files || {};
const sig = s => createHash('sha256').update(JSON.stringify(Object.entries(files[s] || {}).sort().map(([m, x]) => [m, x.sha256]))).digest('hex');

const NOTES = `קבצי ההיסטוריה של נרות הדקה (מראה של R2, מתעדכן אוטומטית).

- \`<SYM>.zip\` — קובץ לכל מניה, ובתוכו \`<SYM>/<YYYY-MM>.csv.gz\` לכל חודש שנסגר.
- כל CSV: \`unix,o,h,l,c,v\` — unix בשניות (UTC), מחירים כפולים 10,000, מסחר רגיל + pre/after (לפי השעה בניו יורק: לפני 09:30 pre, מ-16:00 after; ביום קצר — אחרי 13:00 after).
- \`manifest.json\` — לכל מניה ולכל חודש: reg, ext, days, bytes, sha256 (של קובץ ה-gz).
- מקור: Alpaca SIP (כל הבורסות), מחירים לא מותאמים לפיצולים.
- הימים האחרונים (החודש הנוכחי) נמצאים ב-Release היומי candles-YYYY-MM-DD.`;

// the release, and what it mirrored last time
let old = {};
const exists = (() => { try { sh(`gh release view ${TAG}`); return true; } catch (e) { return false; } })();
writeFileSync('/tmp/hist_notes.md', NOTES);
if (!exists) sh(`gh release create ${TAG} --title "היסטוריית נרות דקה (R2)" --notes-file /tmp/hist_notes.md --latest=false`);
else { try { sh(`gh release download ${TAG} -p mirror_state.json -O /tmp/mirror_state.json --clobber`); old = JSON.parse(readFileSync('/tmp/mirror_state.json', 'utf8')); } catch (e) { old = {}; } }

const changed = Object.keys(files).filter(s => old[s] !== sig(s));
console.log(`history mirror: ${Object.keys(files).length} symbols, ${changed.length} changed since the last mirror`);
const state = { ...old }, failed = [];
for (let i = 0; i < changed.length; i += 4) {
  await Promise.all(changed.slice(i, i + 4).map(async s => {
    try {
      const dir = `/tmp/hm/${s}`; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
      for (const [ym, x] of Object.entries(files[s])) {
        let b = null;
        for (let a = 1; a <= 4 && !b; a++) { const r = await fetch(`${W}/xa/hist/file/${encodeURIComponent(s)}/${ym}`); if (r.status === 200) b = Buffer.from(await r.arrayBuffer()); else await sleep(1500 * a); }
        if (!b || createHash('sha256').update(b).digest('hex') !== x.sha256) throw new Error(`${ym}: download or SHA-256 mismatch`);
        writeFileSync(`${dir}/${ym}.csv.gz`, b);
      }
      sh(`cd /tmp/hm && rm -f ${s}.zip && zip -q -0 -r ${s}.zip ${s}`);
      sh(`gh release upload ${TAG} /tmp/hm/${s}.zip --clobber`);
      state[s] = sig(s);
      rmSync(dir, { recursive: true, force: true }); rmSync(`/tmp/hm/${s}.zip`, { force: true });
    } catch (e) { failed.push(`${s}: ${String(e.message || e).slice(0, 160)}`); }
  }));
  console.log(`  ${Math.min(i + 4, changed.length)}/${changed.length}`);
}
writeFileSync('/tmp/manifest.json', JSON.stringify(man));
writeFileSync('/tmp/mirror_state.json', JSON.stringify(state));
sh(`gh release upload ${TAG} /tmp/manifest.json /tmp/mirror_state.json --clobber`);
writeFileSync('/tmp/hist_notes.md', NOTES + `\n\nעודכן: ${new Date().toISOString()} · ${Object.keys(files).length} מניות`);
sh(`gh release edit ${TAG} --notes-file /tmp/hist_notes.md`);
console.log(`\n## history mirror (GitHub Release "${TAG}")\nsymbols uploaded: ${changed.length - failed.length}\nfailed: ${failed.length}${failed.length ? '\n  ' + failed.join('\n  ') : ''}`);
console.log(`MIRROR_VERDICT: ${failed.length ? 'FAIL' : 'PASS'}`);
if (failed.length) process.exit(1);
