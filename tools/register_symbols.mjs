// Register symbols that are not in the archive yet, so every later step (sync,
// main table, audits, the nightly run) includes them. A symbol is accepted only
// if Yahoo returns 1-minute data for it; anything else is reported and skipped.
// Env: SUPABASE_URL, SUPABASE_KEY, REQ_SYMBOLS (comma list).
const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), KEY = process.env.SUPABASE_KEY || '';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const want = Array.from(new Set((process.env.REQ_SYMBOLS || '').toUpperCase().split(/[\s,;]+/).filter(s => /^[A-Z0-9.\-]{1,10}$/.test(s))));
const have = new Set((await (await fetch(SB + '/rest/v1/archive_symbols?select=symbol&limit=10000', { headers: H })).json()).map(r => r.symbol));
const added = [], rejected = [];
// Insert without an id first (the identity default mints it). If the table has
// no working default (a 400 "null value in column id"), mint max(id)+1 here —
// this runs inside the workflow's single-run queue — and retry on a collision.
async function insert(sym) {
  const post = body => fetch(SB + '/rest/v1/archive_symbols?on_conflict=symbol' + (body[0].id == null ? '&columns=symbol' : ''), { method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(body) });
  let r = await post([{ symbol: sym }]);
  if (r.status < 300) return { ok: true };
  let why = `HTTP ${r.status} ${(await r.text()).slice(0, 160)}`;
  console.log(`${sym}: insert without id failed — ${why}`);
  for (let k = 0; k < 3; k++) {
    const top = await (await fetch(SB + '/rest/v1/archive_symbols?select=id&order=id.desc&limit=1', { headers: H })).json();
    const id = (top[0]?.id || 0) + 1;
    r = await post([{ id, symbol: sym }]);
    if (r.status < 300) { console.log(`${sym}: registered with id ${id}`); return { ok: true }; }
    why = `HTTP ${r.status} ${(await r.text()).slice(0, 160)}`;
    console.log(`${sym}: insert with id ${id} failed — ${why}`);
  }
  return { ok: false, why };
}
for (const s of want.filter(x => !have.has(x))) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1m&range=5d&includePrePost=false`, { headers: { 'User-Agent': UA } });
  const j = r.status === 200 ? await r.json() : null;
  const n = j?.chart?.result?.[0]?.timestamp?.length || 0;
  if (!n) { rejected.push(`${s} (Yahoo: ${r.status === 200 ? 'no 1m data' : 'HTTP ' + r.status})`); continue; }
  const r2 = await insert(s);
  if (r2.ok) added.push(s); else rejected.push(`${s} (archive insert: ${r2.why})`);
  await new Promise(x => setTimeout(x, 300));
}
// The symbols the rest of the run should use: requested ones that are (now) in the archive.
const accepted = want.filter(x => have.has(x) || added.includes(x));
(await import('node:fs')).writeFileSync('/tmp/accepted_symbols.txt', accepted.join(','));
console.log(`requested ${want.length}; already in the archive ${want.filter(x => have.has(x)).length}; REGISTERED: ${added.join(', ') || 'none'}; REJECTED: ${rejected.join('; ') || 'none'}`);
if (!accepted.length) { console.error('none of the requested symbols can be used — stopping'); process.exit(1); }
