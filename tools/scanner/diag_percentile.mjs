// one-off diagnosis: print the daily closes for T and WFC as the engine sees them
import { prepare, daily } from './engine.mjs';
const SB = process.env.SUPABASE_URL.replace(/\/$/, ''), H = { apikey: process.env.SUPABASE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_KEY };
const get = async p => (await fetch(SB + '/rest/v1/' + p, { headers: H })).json();
async function pages(p) { const o = []; let a = null; for (;;) { const r = await get(p + '&order=unix.asc&limit=1000' + (a != null ? '&unix=gt.' + a : '')); o.push(...r); if (r.length < 1000) return o; a = r[r.length - 1].unix; } }
const syms = await get('archive_symbols?select=id,symbol&symbol=in.(T,WFC)');
for (const s of syms) {
  const arch = await pages(`archive_bars?select=unix,o,h,l,c,v&symbol_id=eq.${s.id}`);
  const main = await pages(`bars?select=unix,open,high,low,close,volume&symbol=eq.${s.symbol}`);
  const m = new Map(); for (const r of arch) m.set(r.unix, { u: r.unix, o: r.o / 1e4, h: r.h / 1e4, l: r.l / 1e4, c: r.c / 1e4, v: r.v });
  for (const r of main) m.set(r.unix, { u: r.unix, o: r.open, h: r.high, l: r.low, c: r.close, v: r.volume });
  const p = prepare([...m.values()], Math.floor(Date.now() / 1000)), D = daily(p.sessions), P = p.bars.at(-1).c;
  console.log(s.symbol, 'P=', P, 'sessions', D.length, 'below:', D.filter(d => d.c < P).length);
  console.log(D.map(d => `${d.date} ${d.c} n=${d.n}${d.c < P ? ' <' : ''}`).join('\n'));
}
