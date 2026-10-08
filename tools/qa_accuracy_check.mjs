#!/usr/bin/env node
// Independent accuracy QA: compares stored 1-minute candles (Supabase archive_bars)
// against the source (Yahoo Finance chart API), minute by minute.
// Self-contained on purpose: shares no code with the writers of the archive.
//
// Env: SUPABASE_URL, SUPABASE_KEY (required)
//      QA_THROTTLE_MS (default 400), QA_OUT_CSV (default <repo>/.github/audit/qa_accuracy.csv)
//      QA_FROM / QA_TO (default 2026-09-09 / 2026-10-06), QA_DAYS_PER_SYMBOL (default 3)
// Exit: 0 when the check completes (even with findings), 1 on crash.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_CSV = process.env.QA_OUT_CSV || resolve(SCRIPT_DIR, '..', '.github', 'audit', 'qa_accuracy.csv');
const THROTTLE_MS = Number(process.env.QA_THROTTLE_MS ?? 400);
const RANGE_FROM = process.env.QA_FROM || '2026-09-09';
const RANGE_TO = process.env.QA_TO || '2026-10-06';
const DAYS_PER_SYMBOL = Number(process.env.QA_DAYS_PER_SYMBOL || 3);
// NYSE full-day closures inside or near the window (Labor Day 2026-09-07 is before it).
const NYSE_HOLIDAYS = new Set(['2026-09-07', '2026-11-26', '2026-12-25']);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PRICE_TOL = 0.0002;
const VOL_REL_TOL = 0.02;
const VOL_ABS_TOL = 100;
const MAX_ISSUE_LIST = 200;
const MAX_EXAMPLES = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- deterministic RNG ----------
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickDays(symbol, days, n) {
  const rnd = mulberry32(fnv1a('qa_accuracy:' + symbol));
  const arr = days.slice();
  const k = Math.min(n, arr.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rnd() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, k).sort();
}

// ---------- calendar / time zone ----------
function tradingDays(from, to) {
  const out = [];
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end) {
    const dow = d.getUTCDay();
    const s = d.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !NYSE_HOLIDAYS.has(s)) out.push(s);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
const etParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
function partsOf(ms) {
  const p = {};
  for (const x of etParts.formatToParts(new Date(ms))) p[x.type] = x.value;
  return p;
}
// Offset (ms) of America/New_York from UTC at instant ms (negative in the US).
function etOffsetMs(ms) {
  const p = partsOf(ms);
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return wall - Math.floor(ms / 1000) * 1000;
}
// Epoch seconds of an ET wall-clock time on a date (no DST switch happens at 09:30/16:00).
function etWallToUnix(dateStr, hh, mm) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = etOffsetMs(guess - 5 * 3600e3);
  let t = guess - off;
  const off2 = etOffsetMs(t);
  if (off2 !== off) t = guess - off2;
  return Math.floor(t / 1000);
}
function sessionWindow(dateStr) {
  return { open: etWallToUnix(dateStr, 9, 30), close: etWallToUnix(dateStr, 16, 0) };
}
function etTime(unix) {
  const p = partsOf(unix * 1000);
  return `${p.hour}:${p.minute}`;
}

// ---------- HTTP ----------
async function fetchRetry(url, opts, label, tries = 6) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`${label}: HTTP ${res.status}`);
      } else {
        return res;
      }
    } catch (e) {
      lastErr = e;
    }
    const wait = Math.min(30000, 1000 * 2 ** i) + Math.floor(Math.random() * 250);
    await sleep(THROTTLE_MS === 0 ? 0 : wait);
  }
  throw lastErr;
}

function sbHeaders() {
  const key = process.env.SUPABASE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' };
}
function sbBase() {
  return process.env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/';
}
async function sbGetAll(pathAndQuery) {
  const rows = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const sep = pathAndQuery.includes('?') ? '&' : '?';
    const url = `${sbBase()}${pathAndQuery}${sep}limit=${PAGE}&offset=${offset}`;
    const res = await fetchRetry(url, { headers: sbHeaders() }, 'supabase');
    if (!res.ok) throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const page = await res.json();
    if (!Array.isArray(page)) throw new Error('supabase: non-array response');
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

async function loadSymbols() {
  const rows = await sbGetAll('archive_symbols?select=id,symbol,bars,first_unix,last_unix&order=symbol.asc');
  const only = new Set((process.env.SYMBOLS || '').toUpperCase().split(/[\s,;]+/).filter(Boolean));  // SYMBOLS (optional): check only these
  return rows.filter((r) => r && r.symbol != null && r.id != null && (!only.size || only.has(String(r.symbol))));
}
async function loadArchiveDay(symbolId, open, close) {
  const q = `archive_bars?select=unix,o,h,l,c,v&symbol_id=eq.${encodeURIComponent(symbolId)}` +
    `&unix=gte.${open}&unix=lt.${close}&order=unix.asc`;
  const rows = await sbGetAll(q);
  const map = new Map();
  for (const r of rows) map.set(Number(r.unix), r);
  return map;
}

function yahooTicker(sym) {
  // Yahoo uses '-' for share classes (BRK.B -> BRK-B).
  return String(sym).trim().toUpperCase().replace(/\./g, '-');
}
let lastYahooAt = 0;
// Returns Map(unix -> {o,h,l,c,v} | null-OHLC marker) or null when no source.
async function loadYahoo(sym, p1, p2) {
  const gap = Date.now() - lastYahooAt;
  if (gap < THROTTLE_MS) await sleep(THROTTLE_MS - gap);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker(sym))}` +
    `?interval=1m&period1=${p1}&period2=${p2}&includePrePost=false`;
  let res;
  try {
    res = await fetchRetry(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }, 'yahoo');
  } finally {
    lastYahooAt = Date.now();
  }
  if (!res.ok) return { map: null, err: `HTTP ${res.status}` };
  let body;
  try { body = await res.json(); } catch { return { map: null, err: 'bad json' }; }
  const r = body?.chart?.result?.[0];
  if (!r) return { map: null, err: body?.chart?.error?.description || 'no result' };
  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const map = new Map();
  for (let i = 0; i < ts.length; i++) {
    const t = Math.floor(Number(ts[i]) / 60) * 60;
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i];
    const isNull = [o, h, l, c].some((x) => x == null || !Number.isFinite(Number(x)));
    if (map.has(t) && isNull) continue; // keep a real row over a null duplicate
    map.set(t, isNull ? { nullOhlc: true } : { o: +o, h: +h, l: +l, c: +c, v: v == null ? null : +v });
  }
  return { map, err: null };
}

// ---------- comparison ----------
const r4 = (x) => Math.round(x * 10000) / 10000;

function compareDay(sym, date, open, close, arch, yah, examples) {
  const res = { symbol: sym, date, minutes_compared: 0, missing: 0, extra: 0, extra_flat: 0,
    price_mismatch: 0, volume_mismatch: 0, carry_ok: 0, status: 'OK' };
  const ex = (time, field, a, y, kind) => { examples.push({ symbol: sym, date, time, kind, field, archive: a, yahoo: y }); };

  const minutes = new Set();
  for (const t of arch.keys()) if (t >= open && t < close) minutes.add(t);
  for (const t of yah.keys()) if (t >= open && t < close) minutes.add(t);
  const sorted = [...minutes].sort((a, b) => a - b);

  let prevArchClose = null;
  let prevYahooClose = null;
  for (const t of sorted) {
    const a = arch.get(t);
    const y = yah.get(t);
    const tm = etTime(t);
    const ao = a && { o: a.o / 10000, h: a.h / 10000, l: a.l / 10000, c: a.c / 10000, v: Number(a.v) };
    const aFlatZero = ao && ao.o === ao.h && ao.h === ao.l && ao.l === ao.c && (ao.v === 0 || Number.isNaN(ao.v));

    if (y && !y.nullOhlc) {
      if (!a) {
        res.missing++;
        ex(tm, 'bar', null, `c=${r4(y.c)} v=${y.v}`, 'MISSING');
      } else {
        res.minutes_compared++;
        let priceBad = false;
        for (const f of ['o', 'h', 'l', 'c']) {
          const yv = r4(y[f]);
          // compare in 0.0001 units: in floating point 153.3502-153.35 is 0.00020000000000095,
          // which failed a difference of exactly the 2-unit tolerance the sync itself allows
          if (Math.round(Math.abs(ao[f] - yv) * 10000) > Math.round(PRICE_TOL * 10000)) {
            priceBad = true;
            ex(tm, f, ao[f], yv, 'PRICE_MISMATCH');
          }
        }
        if (priceBad) res.price_mismatch++;
        if (y.v != null) {
          const d = Math.abs(ao.v - y.v);
          const rel = d / Math.max(Math.abs(y.v), 1);
          if (rel > VOL_REL_TOL && d > VOL_ABS_TOL) {
            res.volume_mismatch++;
            ex(tm, 'v', ao.v, y.v, 'VOLUME_MISMATCH');
          }
        }
      }
      prevYahooClose = r4(y.c);
    } else if (y && y.nullOhlc) {
      // No trade that minute. Archive may hold a carried-forward flat bar.
      if (a) {
        const prevOk = (prevArchClose == null && prevYahooClose == null) ||
          (prevArchClose != null && Math.abs(ao.c - prevArchClose) <= PRICE_TOL) ||
          (prevYahooClose != null && Math.abs(ao.c - prevYahooClose) <= PRICE_TOL);
        if (aFlatZero && prevOk) {
          res.carry_ok++;
        } else {
          res.extra++;
          ex(tm, 'bar', `o=${ao.o} h=${ao.h} l=${ao.l} c=${ao.c} v=${ao.v}`, 'null OHLC (no trade)', 'EXTRA');
        }
      }
    } else if (a) {
      res.extra++;
      if (aFlatZero) res.extra_flat++;
      ex(tm, 'bar', `o=${ao.o} h=${ao.h} l=${ao.l} c=${ao.c} v=${ao.v}`, 'no row', aFlatZero ? 'EXTRA(flat v=0)' : 'EXTRA');
    }
    if (ao) prevArchClose = ao.c;
  }
  if (res.missing || res.extra || res.price_mismatch || res.volume_mismatch) res.status = 'ISSUES';
  return res;
}

// ---------- main ----------
async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_KEY must be set');
  }
  const days = tradingDays(RANGE_FROM, RANGE_TO);
  const symbols = await loadSymbols();
  console.log(`qa_accuracy: ${symbols.length} symbols, ${days.length} trading days in ${RANGE_FROM}..${RANGE_TO}, ${DAYS_PER_SYMBOL}/symbol`);

  const results = [];
  const examples = [];
  const SEVEN_DAYS = 7 * 86400;

  for (let si = 0; si < symbols.length; si++) {
    const { id, symbol } = symbols[si];
    const picked = pickDays(symbol, days, DAYS_PER_SYMBOL);
    const wins = picked.map((d) => ({ date: d, ...sessionWindow(d) }));

    // Group into Yahoo requests that each span <= 7 days.
    const groups = [];
    for (const w of wins) {
      const g = groups[groups.length - 1];
      if (g && w.close - g[0].open <= SEVEN_DAYS) g.push(w); else groups.push([w]);
    }
    const yahooByDay = new Map();
    for (const g of groups) {
      let y;
      try {
        y = await loadYahoo(symbol, g[0].open, g[g.length - 1].close);
      } catch (e) {
        y = { map: null, err: String(e.message || e) };
      }
      for (const w of g) yahooByDay.set(w.date, y);
    }

    for (const w of wins) {
      const arch = await loadArchiveDay(id, w.open, w.close);
      const y = yahooByDay.get(w.date);
      let realInDay = 0;
      if (y.map) for (const [t, b] of y.map) if (t >= w.open && t < w.close && !b.nullOhlc) realInDay++;
      if (!y.map || realInDay === 0) {
        results.push({ symbol, date: w.date, minutes_compared: 0, missing: 0, extra: 0, extra_flat: 0,
          price_mismatch: 0, volume_mismatch: 0, carry_ok: 0, status: 'NO_SOURCE',
          note: y.err || 'yahoo returned no traded minutes', archive_rows: arch.size });
        continue;
      }
      const r = compareDay(symbol, w.date, w.open, w.close, arch, y.map, examples);
      r.archive_rows = arch.size;
      results.push(r);
    }
    if ((si + 1) % 10 === 0) console.log(`  ...${si + 1}/${symbols.length} symbols`);
  }

  // CSV
  mkdirSync(dirname(OUT_CSV), { recursive: true });
  const header = 'symbol,date,minutes_compared,missing,extra,price_mismatch,volume_mismatch,status';
  const lines = results.map((r) => [r.symbol, r.date, r.minutes_compared, r.missing, r.extra,
    r.price_mismatch, r.volume_mismatch, r.status].map((x) => /[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x).join(','));
  writeFileSync(OUT_CSV, [header, ...lines].join('\n') + '\n');

  // Totals
  const sum = (k) => results.reduce((s, r) => s + (r[k] || 0), 0);
  const count = (st) => results.filter((r) => r.status === st).length;
  console.log('\n=== TOTALS ===');
  console.log(`symbol-days sampled : ${results.length}  (OK ${count('OK')}, ISSUES ${count('ISSUES')}, NO_SOURCE ${count('NO_SOURCE')})`);
  console.log(`minutes compared    : ${sum('minutes_compared')}`);
  console.log(`MISSING             : ${sum('missing')}`);
  console.log(`EXTRA               : ${sum('extra')}  (of which flat v=0 bars where Yahoo has no row: ${sum('extra_flat')})`);
  console.log(`PRICE_MISMATCH (min): ${sum('price_mismatch')}`);
  console.log(`VOLUME_MISMATCH     : ${sum('volume_mismatch')}`);
  console.log(`carried-forward OK  : ${sum('carry_ok')}  (Yahoo null OHLC, archive flat v=0)`);

  const bad = results.filter((r) => r.status !== 'OK');
  console.log(`\n=== SYMBOL-DAYS WITH ISSUES / NO SOURCE (${bad.length}${bad.length > MAX_ISSUE_LIST ? `, showing ${MAX_ISSUE_LIST}` : ''}) ===`);
  for (const r of bad.slice(0, MAX_ISSUE_LIST)) {
    const extra = r.status === 'NO_SOURCE' ? ` note=${r.note} archive_rows=${r.archive_rows}` :
      ` compared=${r.minutes_compared} missing=${r.missing} extra=${r.extra}(flat ${r.extra_flat}) price=${r.price_mismatch} volume=${r.volume_mismatch}`;
    console.log(`  ${r.symbol} ${r.date} ${r.status}${extra}`);
  }

  // Examples: prefer variety across kinds, then fill.
  const chosen = [];
  const kinds = ['PRICE_MISMATCH', 'MISSING', 'EXTRA', 'VOLUME_MISMATCH', 'EXTRA(flat v=0)'];
  const byKind = new Map(kinds.map((k) => [k, examples.filter((e) => e.kind === k)]));
  for (let i = 0; chosen.length < MAX_EXAMPLES && chosen.length < examples.length; i++) {
    let added = false;
    for (const k of kinds) {
      const e = byKind.get(k)[i];
      if (e && chosen.length < MAX_EXAMPLES) { chosen.push(e); added = true; }
    }
    if (!added) break;
  }
  console.log(`\n=== EXAMPLE MISMATCHES (${chosen.length} of ${examples.length}) ===`);
  for (const e of chosen) {
    console.log(`  ${e.symbol} ${e.date} ${e.time} ET  ${e.kind}  field=${e.field}  archive=${e.archive}  yahoo=${e.yahoo}`);
  }
  console.log(`\nCSV: ${OUT_CSV}`);
  return results;
}

try {
  await main();
  process.exitCode = 0;
} catch (e) {
  console.error('qa_accuracy crashed:', e?.stack || e);
  process.exitCode = 1;
}
