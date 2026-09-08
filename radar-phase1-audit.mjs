// SCANNER / RADAR — PHASE 1 ARCHITECTURE AUDIT.
// Reads production only. Finds and reports; changes nothing.
import { readFileSync, writeFileSync } from 'node:fs';
const F = [];
const add = (sev, layer, title, detail) => F.push({ sev, layer, title, detail: String(detail || '') });
const L = readFileSync('layers.cjs', 'utf8'), E = readFileSync('engine.cjs', 'utf8'), C = readFileSync('candidate.cjs', 'utf8');
const radar = readFileSync('radar.html', 'utf8'), scan = readFileSync('scan.html', 'utf8');

// ---- LAYER 1: symbol state
{
  const fn = L.slice(L.indexOf('function buildTickerState'), L.indexOf('function buildTickerState') + 6000);
  const usesPrior = /\bprior\b|\bprev(ious)?State\b/.test(fn);
  add(usesPrior ? 'INFO' : 'HIGH', 'symbol state', usesPrior ? 'buildTickerState consults a prior state' : 'buildTickerState is STATELESS — it takes no prior state',
    usesPrior ? '' : 'every call recomputes from candles alone, so nothing can persist across bars by construction: no setup identity, no age, no cooldown, no FAILED memory. Every item below follows from this.');
  const sig = (fn.match(/function buildTickerState\(([^)]*)\)/) || [])[1] || '';
  add('INFO', 'symbol state', 'signature: buildTickerState(' + sig + ')', '');
}
// ---- LAYER 2: trend / regime
{
  const hasRange = /RANGE|chop|טווח/.test(L), hasBase = /HIGH_BASE|בסיס גבוה|highBase/.test(L);
  add(hasBase ? 'INFO' : 'MEDIUM', 'trend/regime', hasBase ? 'a high-base regime is distinguished' : 'no high-base regime: a tight base near highs is classified as range/chop',
    hasBase ? '' : 'a coiling base above the day\'s midpoint and directionless chop get the same label, so the radar cannot rank them differently');
  const trendFrom = (L.match(/trend\s*=\s*[^;]{0,80}/) || [])[0] || '';
  add('INFO', 'trend/regime', 'trend derived from: ' + trendFrom.slice(0, 70), '');
}
// ---- LAYER 3: campaign
{
  const hasCampaign = /campaign/i.test(L) || /campaign/i.test(E);
  add(hasCampaign ? 'INFO' : 'MEDIUM', 'campaign', hasCampaign ? 'a campaign concept exists' : 'NO campaign layer: there is no object spanning several setups on one symbol',
    hasCampaign ? '' : 'each bar\'s setup is unrelated to the last, so "third attempt at this level today" cannot be expressed');
}
// ---- LAYER 4: setup lifecycle
{
  const hasId = /setupId/.test(L), hasAge = /setupAge|ageBars/.test(L), hasFailed = /'FAILED'|"FAILED"/.test(L), hasCooldown = /cooldown/i.test(L);
  add(hasId ? 'INFO' : 'HIGH', 'setup lifecycle', hasId ? 'setups carry an id' : 'NO setup identity in production: setups have no id',
    hasId ? '' : 'the same structural setup cannot be recognised from one bar to the next — this is the production equivalent of the Trader V2 bug fixed in v189/v190');
  add(hasAge ? 'INFO' : 'HIGH', 'setup lifecycle', hasAge ? 'age is tracked' : 'NO setup age', '');
  add(hasFailed ? 'INFO' : 'HIGH', 'setup lifecycle', hasFailed ? 'a FAILED state exists' : 'NO FAILED state: an invalidated setup simply stops being emitted',
    hasFailed ? '' : 'and can therefore be emitted again on the next bar — resurrection is not prevented, it is not even representable');
  add(hasCooldown ? 'INFO' : 'HIGH', 'setup lifecycle', hasCooldown ? 'a cooldown exists' : 'NO cooldown after failure', '');
}
// ---- LAYER 5: entry readiness
{
  const readyScore = (L.match(/READY[\s\S]{0,200}?score\s*[<>=]+\s*(\d+)/) || [])[1];
  const readyNoScore = /state\s*=\s*'READY'/.test(L) && !/score\s*>=?\s*\d/.test(L.slice(Math.max(0, L.indexOf("'READY'") - 400), L.indexOf("'READY'") + 200));
  add(readyNoScore ? 'HIGH' : 'INFO', 'entry readiness',
    readyNoScore ? 'READY can be set without any score gate in scope' : 'READY is gated on a score threshold' + (readyScore ? ' (' + readyScore + ')' : ''),
    readyNoScore ? 'this is the mechanism behind "READY with score 0": the readiness branch and the scoring branch are independent, so one can fire while the other has produced nothing' : '');
  const zoneDyn = /zone\s*=\s*\[[^\]]*(high|low)\b/.test(L);
  add(zoneDyn ? 'HIGH' : 'INFO', 'entry readiness', zoneDyn ? 'the entry zone is built from the CURRENT bar\'s high/low' : 'the entry zone is not obviously price-following',
    zoneDyn ? 'a zone recomputed from the live bar moves with price — the same defect class as the V2 chase gate measuring against a trigger that moved (fixed there in v188)' : '');
}
// ---- LAYER 6: alert state
{
  const dedup = /alertKey|lastAlert|seenAlerts|dedup/i.test(radar);
  add(dedup ? 'INFO' : 'HIGH', 'alert state', dedup ? 'alerts are keyed for deduplication' : 'NO alert deduplication key in the radar page',
    dedup ? '' : 'without a stable setup id there is nothing to key on, so the same condition re-alerts every refresh');
  const flap = !/prior|previous/.test(radar.slice(radar.indexOf('function render'), radar.indexOf('function render') + 3000));
  add('MEDIUM', 'alert state', 'state flapping is expected given statelessness',
    'each poll recomputes every symbol from scratch; a symbol on a threshold boundary will oscillate between states across polls with no hysteresis anywhere');
}
// ---- setup failure vs symbol AVOID
{
  const avoidFromSetup = /AVOID[\s\S]{0,300}setup/i.test(L) || /setup[\s\S]{0,200}AVOID/i.test(L);
  add(avoidFromSetup ? 'HIGH' : 'INFO', 'symbol state', avoidFromSetup ? 'a setup-level failure can set the SYMBOL to AVOID' : 'setup failure and symbol AVOID appear separate',
    avoidFromSetup ? 'one failed setup then suppresses every other setup on that symbol for the rest of the session — a symbol-level verdict drawn from a setup-level event' : '');
}
writeFileSync('radar-phase1-findings.json', JSON.stringify(F, null, 1));
const order = { HIGH: 0, MEDIUM: 1, INFO: 2 };
F.sort((a, b) => order[a.sev] - order[b.sev]);
console.log('PHASE 1 — SCANNER/RADAR ARCHITECTURE AUDIT (findings only, nothing changed)\n');
F.forEach(f => { console.log(f.sev.padEnd(7) + '[' + f.layer + '] ' + f.title); if (f.detail) console.log('        ' + f.detail); });
console.log('\n' + F.filter(f => f.sev === 'HIGH').length + ' HIGH · ' + F.filter(f => f.sev === 'MEDIUM').length + ' MEDIUM · ' + F.filter(f => f.sev === 'INFO').length + ' INFO');
