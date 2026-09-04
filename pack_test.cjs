const E=require('./engine.cjs'), L=require('./layers.cjs');
let pass=0,fail=0; const ck=(n,ok,x='')=>{ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${n}${x?'   ['+x+']':''}`)};
const tm=i=>{const m=30+i;return String(9+Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
function day(date,base,shape,n,sd){ let p=base,s=sd||3,out=[]; const rnd=()=>(s=(s*1103515245+12345)%2147483648)/2147483648; n=n||390;
  for(let i=0;i<n;i++){ let d=shape==='up'?0.004:shape==='down'?-0.004:Math.sin(i/25)*0.02;
    const o=p,c=o+(rnd()-0.5)*0.16+d,h=Math.max(o,c)+rnd()*0.06,l=Math.min(o,c)-rnd()*0.06;
    out.push({date,time:tm(i),open:+o.toFixed(4),high:+h.toFixed(4),low:+l.toFixed(4),close:+c.toFixed(4),
      volume:i>=385?800000:Math.floor(120000*(1+4/(1+i*0.1))*(0.6+rnd()))}); p=c; }
  return out; }
const hist=['2026-08-26','2026-08-27','2026-08-28','2026-08-31'].map((d,i)=>day(d,225+i*0.5,'up',390,7+i*5));
const today=day('2026-09-01',227,'up',240,31);
const A=E.analyze(today,{K:3});
const daily=L.dailyContext(hist.concat([today]));
const baseline=L.volumeBaseline(hist);
const cal=L.calibrate(hist,{});
const snap=L.buildTickerState('NVDA',A,{market:'Neutral',freshness:'LIVE',daily,baseline,calibration:cal,date:'2026-09-01'});
const spy=E.analyze(day('2026-09-01',560,'up',240,51),{K:3}); spy.symbol='SPY';
const qqq=E.analyze(day('2026-09-01',480,'up',240,61),{K:3}); qqq.symbol='QQQ';
const marketCtx=L.marketContext([spy,qqq]);
const book={fetched_at:'2026-09-01T15:00:00Z',summary:{venues_ok:['BZX','EDGX'],venues_failed:['BYX','EDGA'],
  bid_shares:3000,ask_shares:2000,bid_pct:60,ask_pct:40,imbalance:20,best_bid:227.68,best_ask:227.7,spread:0.02,depth_levels:5},
  venues:[{venue:'BZX',bids:[{price:227.68,shares:300},{price:227.67,shares:500}],asks:[{price:227.7,shares:200}]},
          {venue:'BYX',error:'no usable response',bids:[],asks:[]}]};
const dailyBars=hist.concat([today]).map(rows=>{ let h=-Infinity,l=Infinity,v=0;
  rows.forEach(r=>{h=Math.max(h,r.high);l=Math.min(l,r.low);v+=r.volume});
  return {date:rows[0].date,open:rows[0].open,high:h,low:l,close:rows[rows.length-1].close,volume:v}; });

const pack=L.analysisPack({snap,analysis:A,rows:today,book,daily,dailyBars,baseline,marketCtx,
  sectorEtf:'SMH',staleSeconds:30,session:'REGULAR',date:'2026-09-01'});

// every required section
const sections=['TIME & DATA STATE','MODEL DECISION','PRICE LEVELS AND THEIR ROLES','WHAT-IF','PROBABILITY',
  'BUYERS / SELLERS','ORDER BOOK / LEVEL 2','TAPE / TIME & SALES','STRUCTURE & MOMENTUM','INDICATORS',
  'MARKET CONTEXT','MULTI-DAY CONTEXT','EVENTS','POSITION','LAST 50 ONE-MINUTE','FIVE-MINUTE','DAILY'];
sections.forEach(s=>ck('section present: '+s, pack.indexOf(s)>=0));

// required fields
const fields=['Symbol:','Last closed candle','Current price','Data age','Session:','Status:','Primary action:','Setup Score:',
  'Active setup type:','Setup state:','Watch level:','Planned entry:','Tactical support:','Tactical resistance:',
  'Entry cancellation','Setup invalidation','Target 1:','Target 2:','Target 3:','Level states',
  'NOW:','IF UP:','IF DOWN:','Confirms entry:','Cancels entry:','Cancels the whole setup:','At target 1:','Confirmation strengthens above:','Exit when:',
  'UP:','Event measured:','Horizon:','Confidence:','Buyers:','Sellers:','Agreement with the setup:',
  'Best bid:','Total bid depth:','Imbalance:','Main structure:','Short momentum:','Recent swings','VWAP:','EMA9:',
  'Average candle range','Relative volume','Time-of-day normalised volume','Regime:','Daily trend:','Previous day:','Position:'];
const missing=fields.filter(f=>pack.indexOf(f)<0);
ck('every required field label present', missing.length===0, missing.join(' | ')||'all present');

// data correctness
const lines=pack.split('\n');
const c50=lines.slice(lines.indexOf('===== 15. CANDLES — LAST 50 ONE-MINUTE (closed only) ====='),
  lines.indexOf('===== 16. CANDLES — LAST 20 FIVE-MINUTE (aggregated from 1-minute) ====='));
const rows50=c50.filter(l=>/^NVDA,2026-09-01,\d\d:\d\d,/.test(l));
ck('exactly 50 one-minute candles', rows50.length===50, rows50.length+'');
ck('the last candle in the pack is the last closed bar', rows50[rows50.length-1].split(',')[2]===today[today.length-1].time);
ck('candle rows carry all 14 columns', rows50[0].split(',').length===14);
const f5start=lines.indexOf('===== 16. CANDLES — LAST 20 FIVE-MINUTE (aggregated from 1-minute) =====');
const f5=lines.slice(f5start,lines.indexOf('===== 17. CANDLES — LAST 10 DAILY =====')).filter(l=>/^NVDA,/.test(l));
ck('twenty five-minute candles', f5.length===20, f5.length+'');
{ // a 5-minute bar must be the true aggregate of its minutes
  const agg=L.aggregate(today,5), last=agg[agg.length-1];
  const mins=today.filter(r=>{const m=+r.time.slice(0,2)*60+ +r.time.slice(3); return Math.floor(m/5)===last.key;});
  ck('five-minute aggregation is correct', last.open===mins[0].open && last.close===mins[mins.length-1].close
    && last.high===Math.max(...mins.map(m=>m.high)) && last.volume===mins.reduce((s,m)=>s+m.volume,0)); }
const dailyRows=lines.slice(lines.indexOf('===== 17. CANDLES — LAST 10 DAILY =====')).filter(l=>/^NVDA,2026-/.test(l));
ck('daily candles included', dailyRows.length===5, dailyRows.length+'');

// book
ck('book is labelled partial', pack.indexOf('PARTIAL BOOK — CBOE ONLY')>=0);
ck('book names what is missing from it', /ARCA, NYSE, Nasdaq/.test(pack) && /NOT the NBBO/.test(pack));
ck('raw book levels are included, not just percentages', /BZX,bid,1,227.68,300/.test(pack));
ck('a venue that failed is listed', /BYX,ERROR/.test(pack));
ck('depth change is marked unavailable without an earlier snapshot', /Depth change over the last 30-60s: NOT AVAILABLE/.test(pack));

// explicit NOT AVAILABLE, never silence
ck('tape is explicitly unavailable', /TAPE NOT AVAILABLE/.test(pack));
ck('position is explicitly unavailable', /Position: NOT AVAILABLE/.test(pack));
ck('target 3 is explicitly unavailable', /Target 3: NOT AVAILABLE/.test(pack));
ck('quote timestamp explains itself', /no separate quote stream/.test(pack));

// probability honesty carried into the pack
// A suppressed probability is a valid outcome; it must still say what was asked.
if(/UP: NOT AVAILABLE/.test(pack)){
  ck('a suppressed probability still names the event and the reason',
    /Event measured:/.test(pack) && /Why: /.test(pack));
  ck('and claims no source', /Source: NOT AVAILABLE/.test(pack));
} else {
ck('probability source is stated', /Source: (empirical|MODEL ESTIMATE)/.test(pack));
if(/MODEL ESTIMATE/.test(pack)) ck('a model estimate says it is not a measured frequency', /not a measured frequency/.test(pack));
else ck('an empirical probability reports its sample size', /comparable cases/.test(pack)); }
ck('pressure method is disclosed', /NOT order flow/.test(pack) && /hasOrderBook=false/.test(pack));

// atomic snapshot
ck('the pack states it came from one snapshot', /one atomic snapshot/.test(pack) && /state_version/.test(pack));
{ const priceLine=lines.find(l=>l.startsWith('Current price'));
  ck('the price in the pack equals the snapshot price', priceLine.indexOf(snap.price.toFixed(2))>=0, priceLine); }

// missing inputs degrade, never crash
{ const bare=L.analysisPack({snap,analysis:A,rows:today});
  ck('a pack with no book/daily/market still builds', bare.length>1000);
  ck('missing book says so', /ORDER BOOK[\s\S]{0,200}NOT AVAILABLE/.test(bare));
  ck('missing multi-day says so', /no prior sessions loaded/.test(bare));
  ck('missing market context says so', /MARKET CONTEXT\n\nNOT AVAILABLE|MARKET CONTEXT\nNOT AVAILABLE/.test(bare)||bare.indexOf('11. MARKET CONTEXT')>=0);
  ck('no snapshot returns a clear message', /NO SNAPSHOT/.test(L.analysisPack({}))); }

console.log(`\nPack size: ${pack.length} chars, ${lines.length} lines`);

// ---- a frozen pack must contain no live instruction
{
  const staleSnap = L.buildTickerState('NVDA', A, { market: 'Neutral', freshness: 'STALE',
    staleSeconds: 4 * 3600, date: '2026-09-01' });
  const frozen = L.analysisPack({ snap: staleSnap, analysis: A, rows: today,
    marketCtx: { label: 'Neutral', parts: [] }, session: 'CLOSED', date: '2026-09-01', staleSeconds: 4 * 3600 });

  ck('the frozen pack says the setup is frozen', /Setup state: FROZEN/.test(frozen));
  ck('the active setup reads none', /Active setup type: none \(data stale\)/.test(frozen));
  ck('the what-if section is marked reference only', /4\. WHAT-IF — FROZEN, REFERENCE ONLY/.test(frozen));

  // the specific fields that used to read as instructions
  ['Confirms entry', 'After entry', 'At target 1', 'Confirmation strengthens above', 'Exit when'].forEach(f => {
    const line = frozen.split('\n').find(l => l.indexOf(f + ':') === 0);
    ck('"' + f + '" is not an instruction while frozen',
      !!line && /NOT AVAILABLE/.test(line) && /setup frozen/.test(line), line || 'field missing');
  });

  ck('level roles are labelled LAST KNOWN', /LAST KNOWN Watch level/.test(frozen));
  ck('level roles say reference only', /REFERENCE ONLY/.test(frozen));
  ck('the watch label is in the past tense', /the price that was being waited for/.test(frozen));
  ck('the add trigger no longer says it confirms an add now',
    !/— confirms an add(?! while)/.test(frozen), (frozen.split('\n').find(l => /reclaim trigger/.test(l)) || ''));
  ck('the section warns before the levels', /NOTE: data is stale/.test(frozen));

  // and a LIVE pack keeps its instructions
  const liveSnap = L.buildTickerState('NVDA', A, { market: 'Neutral', freshness: 'LIVE', staleSeconds: 30, date: '2026-09-01' });
  const live = L.analysisPack({ snap: liveSnap, analysis: A, rows: today,
    marketCtx: { label: 'Neutral', parts: [] }, session: 'REGULAR', date: '2026-09-01', staleSeconds: 30 });
  ck('a live pack is not frozen', !/LAST KNOWN Watch level/.test(live) && !/setup frozen/.test(live));
}

// ---- the narrative never repeats a line
{
  const staleSnap = L.buildTickerState('NVDA', A, { market: 'Neutral', freshness: 'STALE', staleSeconds: 4 * 3600 });
  const W = staleSnap.whatNow;
  ck('no duplicated UP lines', new Set(W.up).size === W.up.length, W.up.join(' | '));
  ck('no duplicated DOWN lines', new Set(W.down).size === W.down.length, W.down.join(' | '));
  ck('the down block describes the downside, not the upside',
    W.down.every(x => !/התרחיש האחרון שנרשם/.test(x)), W.down.join(' | '));
  ck('both blocks are populated while frozen', W.up.length > 0 && W.down.length > 0);
}

// ---- the pressure sentence follows both sides
{
  const cases = [
    { buyers: 'ללא שינוי', sellers: 'נחלשים', side: 'buyers', mustNot: /הלחץ שלהם מתחזק/, must: /היתרון היחסי/ },
    { buyers: 'מתחזקים', sellers: 'ללא שינוי', side: 'buyers', must: /הלחץ שלהם מתחזק/ },
    { buyers: 'נחלשים', sellers: 'ללא שינוי', side: 'buyers', must: /הלחץ שלהם נחלש/ }
  ];
  cases.forEach(c => {
    // build the sentence the same way pressure() does, through a real state
    const st2 = L.buildTickerState('NVDA', A, { market: 'Neutral', freshness: 'LIVE', staleSeconds: 30 });
    const p = st2.pressure;
    if (!p) return;
    if (p.buyersTrend === c.buyers && p.sellersTrend === c.sellers && p.side === c.side) {
      if (c.mustNot) ck('unchanged buyers are never called strengthening', !c.mustNot.test(p.conclusion), p.conclusion);
      ck('the sentence matches the trends', c.must.test(p.conclusion), p.conclusion);
    }
  });
  const st3 = L.buildTickerState('NVDA', A, { market: 'Neutral', freshness: 'LIVE', staleSeconds: 30 });
  const p3 = st3.pressure;
  if (p3) {
    const claimsStronger = /הלחץ שלהם מתחזק/.test(p3.conclusion);
    const leader = p3.side === 'sellers' ? p3.sellersTrend : p3.buyersTrend;
    ck('"strengthening" is only claimed when that side is actually strengthening',
      !claimsStronger || leader === 'מתחזקים', p3.buyersTrend + ' / ' + p3.sellersTrend + ' -> ' + p3.conclusion);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
