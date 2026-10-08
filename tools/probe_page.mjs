// Drives the LIVE /bars page in a real browser (bulk tab, today, pre-market)
// and reports what the user would see: estimate, progress, toasts, downloads.
import { chromium } from 'playwright';
import fs from 'node:fs';
const B = 'https://spmo-market-bridge.noamharelnim.workers.dev/bars';
const syms = process.env.SYM || 'AAPL, TSLA, ALAB';
const b = await chromium.launch(); const ctx = await b.newContext({ acceptDownloads: true }); const pg = await ctx.newPage();
pg.on('pageerror', e => console.log('PAGE ERROR', String(e)));
pg.on('dialog', d => { console.log('DIALOG', d.message().replace(/\n/g, ' | ').slice(0, 200)); d.accept(); });
pg.on('response', r => { if (r.url().includes('/xa/') && r.status() >= 400) console.log('HTTP', r.status(), r.url().replace(B.replace('/bars', ''), '').slice(0, 100)); });
pg.on('download', async d => { const t = fs.readFileSync(await d.path(), 'utf8').trim().split('\n'); console.log('DOWNLOAD', d.suggestedFilename(), t.length - 1, 'rows | first', t[1], '| last', t[t.length - 1]); });
await pg.goto(B); await pg.waitForTimeout(3000);
console.log('build', (await pg.textContent('.build')).trim());
await pg.click('#tabBulk'); await pg.fill('#bSyms', syms);
const today = new Date().toLocaleString('sv-SE', { timeZone: 'America/New_York' }).slice(0, 10);
await pg.fill('#bFrom', today); await pg.fill('#bTo', today);
await pg.selectOption('#bFmt', 'one'); await pg.selectOption('#sessBulk', 'pre'); await pg.waitForTimeout(3000);
console.log('estimate:', (await pg.textContent('#bEst')).replace(/\s+/g, ' '));
await pg.click('#bDl');
for (let i = 0; i < 20; i++) { await pg.waitForTimeout(2000); const st = (await pg.textContent('#bStatus')).trim(); const pr = (await pg.textContent('#bProg')).trim(); console.log(`t+${(i + 1) * 2}s prog: ${pr} | status: ${st} | toast: ${(await pg.textContent('#toast')).trim()}`); if (st.startsWith('הושלם')) break; }
await b.close();
