import m from './worker.js';
const stmt = () => ({ bind: () => stmt(), all: async () => ({ results: [] }), first: async () => null, run: async () => ({ meta: {} }) });
const db = { prepare: () => stmt(), batch: async () => [], exec: async () => {} };
const env = { DB: db, RATE_PER_MIN: 1000000 };
const ctx = { waitUntil() {} };
for (const p of ['/bars/index','/days/AAPL','/day/AAPL/2026-09-09?format=json','/coverage','/auth','/publish/status','/bars/count?symbols=AAPL','/bars/daily?symbols=AAPL']) {
  try {
    const r = await m.fetch(new Request('https://x' + p), env, ctx);
    const t = await r.text();
    console.log(p.padEnd(40), r.status, (r.headers.get('content-type') || '').slice(0, 22).padEnd(24), t.trim()[0] === '<' ? '*** HTML ***' : 'ok');
  } catch (e) { console.log(p.padEnd(40), 'THREW ' + String(e.message).slice(0, 70)); }
}
