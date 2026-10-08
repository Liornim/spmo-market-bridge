// Company names for every archive symbol -> data/names.json ({"AAPL":"Apple Inc.", ...}),
// shown next to the ticker on the page. Names come from Alpaca's asset list
// (same keys as the market data); only symbols without a name are looked up.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), KEY = process.env.SUPABASE_KEY || '';
const AK = process.env.ALPACA_KEY_ID, AS = process.env.ALPACA_SECRET_KEY;
const FILE = 'data/names.json';
let names = {}; try { names = JSON.parse(readFileSync(FILE, 'utf8')); } catch (e) { /* first run */ }
const syms = (await (await fetch(SB + '/rest/v1/archive_symbols?select=symbol&order=symbol.asc&limit=10000', { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })).json()).map(r => r.symbol);
const tidy = n => String(n || '').replace(/\s+(Common Stock|Ordinary Shares|Class A Common Stock|Class A Ordinary Shares|Common Shares)$/i, '').replace(/\s+/g, ' ').trim();
let added = 0; const missing = [];
for (const s of syms) {
  if (names[s]) continue;
  const r = await fetch('https://paper-api.alpaca.markets/v2/assets/' + encodeURIComponent(s.replace(/-/g, '.')), { headers: { 'APCA-API-KEY-ID': AK, 'APCA-API-SECRET-KEY': AS } });
  if (r.status === 200) { const j = await r.json(); if (j.name) { names[s] = tidy(j.name); added++; continue; } }
  missing.push(`${s} (HTTP ${r.status})`);
  await new Promise(x => setTimeout(x, 150));
}
mkdirSync('data', { recursive: true });
writeFileSync(FILE, JSON.stringify(Object.fromEntries(Object.keys(names).sort().map(k => [k, names[k]])), null, 1) + '\n');
console.log(`names: ${Object.keys(names).length} known, ${added} added${missing.length ? '; no name for: ' + missing.join(', ') : ''}`);
