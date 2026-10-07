// Reads the outputs of the nightly steps and decides PASS / FAIL.
//
// Inputs (.github/audit/): archive_audit.csv, qa_count.csv, qa_accuracy.csv,
// bars_trim.log (BARS_VERDICT line), known_unfillable.csv (baseline).
//
// A symbol-session that is not complete FAILS the night unless it is in the
// known_unfillable baseline: sessions older than Yahoo's 30-day window that were
// already incomplete when the baseline was taken (nothing can fill them). A
// baseline entry that gets WORSE (fewer bars) also fails — that is data loss.
// Accuracy: any MISSING or PRICE_MISMATCH fails; volume mismatches and
// NO_SOURCE (holiday / Yahoo gap) are warnings.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const dir = '.github/audit';
const read = f => existsSync(`${dir}/${f}`) ? readFileSync(`${dir}/${f}`, 'utf8') : null;
const csv = t => { if (!t) return null; const [h, ...r] = t.trim().split('\n'); const k = h.split(',');
  return r.filter(Boolean).map(l => { const v = l.split(','); return Object.fromEntries(k.map((x, i) => [x, v[i]])); }); };

const fails = [], warns = [], lines = [];
const today = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }).slice(0, 10);

// baseline
const base = {}; (csv(read('known_unfillable.csv')) || []).forEach(r => { base[r.symbol + ' ' + r.date] = +r.bars; });

// 1. full audit (mine)
const audit = csv(read('archive_audit.csv'));
if (!audit) fails.push('archive_audit.csv missing — the audit did not run');
else {
  const firstDay = {}; for (const r of audit) if (+r.bars > 0 && (!firstDay[r.symbol] || r.date < firstDay[r.symbol])) firstDay[r.symbol] = r.date;
  const beforeStart = r => r.status === 'EMPTY' && firstDay[r.symbol] && r.date < firstDay[r.symbol];
  const bad = audit.filter(r => r.status !== 'OK' && !beforeStart(r));
  const known = [], newBad = [];
  for (const r of bad) {
    const k = r.symbol + ' ' + r.date;
    if (k in base && +r.bars >= base[k] && r.status !== 'INVALID') known.push(r); else newBad.push(r);
  }
  const pre = audit.filter(beforeStart).length;
  lines.push(`archive audit: ${audit.length} symbol-sessions, ${audit.length - bad.length - pre} complete, ${pre} before the symbol's first data day (not gaps), ${known.length} known-unfillable (older than Yahoo's 30 days), ${newBad.length} NEW problems`);
  newBad.slice(0, 100).forEach(r => fails.push(`audit: ${r.symbol} ${r.date} ${r.status} bars=${r.bars} missing=${r.missing}${r.invalid > 0 ? ' invalid=' + r.invalid : ''}`));
}

// 2. independent count check
const qc = csv(read('qa_count.csv'));
if (!qc) fails.push('qa_count.csv missing — the independent count check did not run');
else {
  const fd = {}; for (const r of qc) if (+r.session_count > 0 && (!fd[r.symbol] || r.date < fd[r.symbol])) fd[r.symbol] = r.date;
  const bad = qc.filter(r => r.status === 'SHORT' || (r.status === 'EMPTY' && fd[r.symbol] && r.date > fd[r.symbol]) || (r.status === 'OVER' && +r.session_count > +r.expected));
  const newBad = bad.filter(r => { const k = r.symbol + ' ' + r.date; return !(k in base && +r.session_count >= base[k]); });
  // EMPTY before a symbol's first day is the symbol's start, not a gap, when it is in the baseline
  const pre = qc.filter(r => r.status === 'EMPTY' && !(fd[r.symbol] && r.date > fd[r.symbol])).length;
  lines.push(`independent count check: ${qc.length} symbol-sessions, ${qc.length - bad.length - pre} OK, ${pre} before the symbol's first data day, ${bad.length - newBad.length} known-unfillable, ${newBad.length} NEW problems`);
  newBad.slice(0, 100).forEach(r => fails.push(`count-check: ${r.symbol} ${r.date} ${r.status} ${r.session_count}/${r.expected}`));
  // the two independent checks must agree on every complete day
  if (audit) {
    const a = {}; audit.forEach(r => { a[r.symbol + ' ' + r.date] = r.status === 'OK'; });
    const disagree = qc.filter(r => (r.symbol + ' ' + r.date) in a && a[r.symbol + ' ' + r.date] !== (r.status === 'OK' || (r.status === 'OVER' && +r.session_count === +r.expected)));
    if (disagree.length) disagree.slice(0, 30).forEach(r => warns.push(`audit and count-check disagree on ${r.symbol} ${r.date} (count-check: ${r.status} ${r.session_count})`));
    lines.push(`audit vs count-check agreement: ${qc.length - disagree.length}/${qc.length}`);
  }
}

// 3. accuracy vs Yahoo
const acc = csv(read('qa_accuracy.csv'));
if (!acc) fails.push('qa_accuracy.csv missing — the accuracy check did not run');
else {
  const sum = k => acc.reduce((s, r) => s + (+r[k] || 0), 0);
  lines.push(`accuracy vs Yahoo: ${acc.length} sampled symbol-days, ${sum('minutes_compared')} minutes compared — missing ${sum('missing')}, extra ${sum('extra')}, price mismatches ${sum('price_mismatch')}, volume mismatches ${sum('volume_mismatch')}, no source ${acc.filter(r => r.status === 'NO_SOURCE').length}`);
  acc.filter(r => +r.missing > 0 || +r.price_mismatch > 0).slice(0, 50)
    .forEach(r => fails.push(`accuracy: ${r.symbol} ${r.date} missing=${r.missing} price_mismatch=${r.price_mismatch}`));
  if (sum('volume_mismatch')) warns.push(`accuracy: ${sum('volume_mismatch')} volume mismatches (Yahoo revises recent volumes)`);
  if (sum('extra')) warns.push(`accuracy: ${sum('extra')} archive minutes Yahoo has no row for (usually no-trade minutes)`);
}

// 0. the sync itself
const sync = read('archive_sync.log') || '';
const sv = (sync.match(/SYNC_VERDICT: (\w+)/) || [])[1];
lines.unshift(`archive sync with Yahoo: ${sv || 'no verdict'} — ` + ((sync.match(/## archive sync[^\n]*\n([\s\S]*?)SYNC_VERDICT/) || [])[1] || '').trim().split('\n').join('; '));
if (sv !== 'PASS') fails.push('archive sync: ' + (sv || 'did not run') + ' (see archive_sync.log)');

// 4. main table
const trim = read('bars_trim.log') || '';
const bv = (trim.match(/BARS_VERDICT: (\w+)/) || [])[1];
const keep = (trim.match(/sessions kept: (.*)/) || [])[1];
lines.push(`main table: ${bv || 'no verdict'}${keep ? ' — sessions ' + keep : ''}`);
if (bv !== 'PASS') fails.push('main table check: ' + (bv || 'did not run') + ' (see bars_trim.log)');

// pre/after-market archive (prices only — Yahoo has no extended-hours volume)
const ext = read('ext_sync.log');
if (ext) {
  const ev = (ext.match(/EXT_VERDICT: (\w+)/) || [])[1], g = k => (ext.match(new RegExp(k + ': (\\d+)')) || [])[1];
  lines.push(`pre/after-market: ${ev || 'no verdict'} — inserted ${g('inserted')}, prices corrected ${g('prices corrected')}, rows in archive_ext_bars ${g('rows in archive_ext_bars')}`);
  if (ev !== 'PASS') fails.push('pre/after-market sync: ' + (ev || 'did not finish') + ' (see ext_sync.log)');
} else lines.push('pre/after-market: did not run');

// database size against the free plan's 500 MB (needs the db_size() function)
try {
  const SBU = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), K = process.env.SUPABASE_KEY || '';
  const r = await fetch(SBU + '/rest/v1/rpc/db_size', { method: 'POST', headers: { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' }, body: '{}' });
  if (r.status === 200) {
    const mb = Math.round(+(await r.json()) / 1048576);
    lines.push(`database size: ${mb} MB of 500 MB (free plan)`);
    if (mb >= 400) fails.push(`database size ${mb} MB — over the 400 MB alarm; at 500 MB Supabase turns read-only`);
    else if (mb >= 350) warns.push(`database size ${mb} MB — approaching the 400 MB alarm`);
  } else lines.push('database size: unknown (the db_size() function is missing in Supabase)');
} catch (e) { lines.push('database size: unknown (' + e.message + ')'); }

const manual = process.env.MANUAL === '1';
// register.log is committed with the reports, so only this run's request may read it
const reg = manual && process.env.REQ_SYMBOLS ? read('register.log') : '';
if (reg) {
  const line = reg.split('\n').find(l => l.startsWith('requested')) || '';
  lines.unshift('symbols: ' + (line || 'registration did not finish (see register.log)'));
  if (!line || /stopping/.test(reg)) fails.push('symbol registration: ' + (line || 'did not finish'));
}
const verdict = fails.length ? 'FAIL' : 'PASS';
const hdr = manual
  ? `# Update ${today} ${new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' })}: ${verdict}\n\nrequest: ${process.env.REQUEST_ID || 'manual'} · symbols: ${process.env.REQ_SYMBOLS || 'all'} · days back: ${process.env.REQ_DAYS || 30}`
  : `# Nightly ${today}: ${verdict}`;
const report = [hdr, '', ...lines.map(l => '- ' + l), '',
  fails.length ? '## Failures\n' + fails.map(x => '- ' + x).join('\n') : '', '',
  warns.length ? '## Warnings\n' + warns.map(x => '- ' + x).join('\n') : ''].join('\n');
mkdirSync(`${dir}/nightly`, { recursive: true });
// an on-demand run never takes the scheduled run's file name, so it cannot make
// that night's run think it already happened
writeFileSync(`${dir}/nightly/${today}${manual ? '-update-' + (process.env.REQUEST_ID || Date.now()) : ''}.md`, report + '\n');
writeFileSync(`${dir}/LATEST.md`, report + '\n');
console.log(report);
process.exit(fails.length ? 1 : 0);
