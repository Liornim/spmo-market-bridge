const E=require('./engine.cjs'), L=require('./layers.cjs');
let pass=0,fail=0; const ck=(n,ok,x='')=>{ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${n}${x?'   ['+x+']':''}`)};
const tm=i=>{const m=30+i;return String(9+Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
function day(date,base,shape,n,seedv){ let p=base,s=seedv||3,out=[]; const rnd=()=>(s=(s*1103515245+12345)%2147483648)/2147483648;
  n=n||390;
  for(let i=0;i<n;i++){ let d=0;
    if(shape==='up')d=0.004; if(shape==='down')d=-0.004; if(shape==='chop')d=Math.sin(i/25)*0.02;
    const o=p,c=o+(rnd()-0.5)*0.16+d,h=Math.max(o,c)+rnd()*0.06,l=Math.min(o,c)-rnd()*0.06;
    out.push({date,time:tm(i),open:+o.toFixed(4),high:+h.toFixed(4),low:+l.toFixed(4),close:+c.toFixed(4),
      volume: i>=385?800000:Math.floor(120000*(1+4/(1+i*0.1))*(0.6+rnd()))}); p=c; }
  return out; }

// ---- time-of-day volume (spec 12)
{ const d1=day('2026-08-27',200,'chop'), d2=day('2026-08-28',200,'chop',390,9), d3=day('2026-08-31',200,'chop',390,21);
  const base=L.volumeBaseline([d1,d2,d3]);
  ck('baseline needs at least two days', L.volumeBaseline([d1])===null);
  ck('baseline covers every minute of the session', Object.keys(base.byTime).length===390, Object.keys(base.byTime).length+'');
  const today=day('2026-09-01',200,'chop',390,33);
  const A=E.analyze(today,{K:3});
  const closeBar=A.bars[A.bars.length-1], openBar=A.bars[0];
  const todClose=L.volxTod(closeBar,base), todOpen=L.volxTod(openBar,base);
  ck('closing candle no longer looks like a 7x spike', todClose>0.2 && todClose<3, 'session-avg '+closeBar.volx.toFixed(1)+'x -> time-of-day '+todClose.toFixed(2)+'x');
  ck('opening candle is normalised too', todOpen>0.2 && todOpen<3, openBar.volx.toFixed(1)+'x -> '+todOpen.toFixed(2)+'x');
  ck('a genuinely heavy minute still reads heavy', (function(){ const t2=today.slice(); t2[200]=Object.assign({},t2[200],{volume:t2[200].volume*6});
    return L.volxTod(E.analyze(t2,{K:3}).bars[200],base)>3; })());
  ck('no baseline -> null, caller falls back', L.volxTod(closeBar,null)===null); }

// ---- daily layer
{ const days=[day('2026-08-26',195,'up'),day('2026-08-27',198,'up',390,7),day('2026-08-28',201,'up',390,11),
    day('2026-08-31',204,'up',390,13),day('2026-09-01',207,'up',390,17)];
  const d=L.dailyContext(days);
  ck('daily context summarises every loaded day', d.days===5 && d.priorDays===4);
  ck('rising sessions read as an up daily trend', d.trend==='UP', d.trend+' ('+d.trendWhy+')');
  ck('previous day high/low exposed', d.prevHigh>d.prevLow && d.prevClose!=null);
  ck('daily ATR is an average of prior ranges', d.atrDaily>0);
  const down=L.dailyContext([day('2026-08-26',215,'down'),day('2026-08-27',212,'down',390,7),day('2026-08-28',209,'down',390,11),day('2026-08-31',206,'down',390,13)]);
  ck('falling sessions read as a down daily trend', down.trend==='DOWN', down.trend);
  ck('one day only -> no daily trend claimed', L.dailyContext([day('2026-09-01',200,'chop')]).trend==='RANGE'); }

// ---- probability: defined event, honest source
{ const today=day('2026-09-01',200,'up',260,5);
  const A=E.analyze(today,{K:3});
  const p=L.pathProbability(A,{market:'Neutral'});
  ck('probability states the exact event it refers to', p.upper!=null && p.lower!=null && p.horizonMin===60,
    'reach '+p.upper.toFixed(2)+' before '+p.lower.toFixed(2)+' within '+p.horizonMin+'m');
  ck('up and down sum to 100', p.up+p.down===100, p.up+'/'+p.down);
  ck('with no history it is labelled a model, not an observed frequency', p.source==='model' && !!p.bias, p.source+' / '+p.bias);
  ck('model confidence stays modest', p.confidence<=55, p.confidence+'');
  ck('the reasons are listed', p.why.length>=3, p.why.length+' reasons');
  // direction responds to evidence
  const bull=L.pathProbability(A,{market:'Bullish',daily:{trend:'UP'}});
  const bear=L.pathProbability(A,{market:'Bearish',daily:{trend:'DOWN'}});
  ck('agreeing layers raise the up-side, disagreeing lower it', bull.up>bear.up+15, bull.up+'% vs '+bear.up+'%');
  // geometry: a nearer upper level must raise the up-side
  const b=A.state.bar, atr=b.atr20;
  const near=L.pathProbability(A,{upper:b.close+0.3*atr,lower:b.close-2*atr,market:'Neutral'});
  const far=L.pathProbability(A,{upper:b.close+2*atr,lower:b.close-0.3*atr,market:'Neutral'});
  ck('a nearer level is likelier to be reached first', near.up>far.up, near.up+'% vs '+far.up+'%'); }

// ---- probability moves with price action (spec 5)
{ const base=day('2026-09-01',200,'chop',200,4);
  const A1=E.analyze(base,{K:3}), b=A1.state.bar, atr=b.atr20;
  const up=b.close+1.2*atr, dn=b.close-1.2*atr;
  const p1=L.pathProbability(A1,{upper:up,lower:dn,market:'Neutral'});
  // strong rejection at support: long lower wicks, closes back up, heavy volume
  const rej=base.concat([0,1,2,3].map(function(i){ const o=b.close-0.1*atr; return {date:'2026-09-01',time:tm(200+i),
    open:+o.toFixed(4),high:+(o+0.9*atr).toFixed(4),low:+(o-1.1*atr).toFixed(4),close:+(o+0.8*atr).toFixed(4),volume:600000}; }));
  const p2=L.pathProbability(E.analyze(rej,{K:3}),{upper:up,lower:dn,market:'Neutral'});
  ck('buyers rejecting support raise the up-side', p2.up>p1.up, p1.up+'% -> '+p2.up+'%');
  const brk=base.concat([0,1,2,3].map(function(i){ const o=b.close-(0.3+i*0.5)*atr; return {date:'2026-09-01',time:tm(200+i),
    open:+o.toFixed(4),high:+(o+0.05*atr).toFixed(4),low:+(o-0.6*atr).toFixed(4),close:+(o-0.55*atr).toFixed(4),volume:700000}; }));
  const p3=L.pathProbability(E.analyze(brk,{K:3}),{upper:up,lower:dn,market:'Neutral'});
  ck('breaking support on volume lowers the up-side', p3.up<p1.up, p1.up+'% -> '+p3.up+'%'); }

// ---- empirical calibration from the symbol's own history (spec 6)
{ const hist=[day('2026-08-24',200,'up'),day('2026-08-25',203,'up',390,7),day('2026-08-26',206,'up',390,11),
    day('2026-08-27',209,'chop',390,13),day('2026-08-28',207,'down',390,17),day('2026-08-31',205,'chop',390,19)];
  const cal=L.calibrate(hist,{});
  ck('calibration produced observations', cal.total>500, cal.total+' outcomes');
  const buckets=Object.keys(cal.table).length;
  ck('outcomes are bucketed by situation', buckets>20, buckets+' buckets');
  const big=Object.keys(cal.coarse).filter(k=>cal.coarse[k].n>=30);
  ck('some buckets reach a usable sample', big.length>0, big.length+' buckets with n>=30');
  const today=day('2026-09-01',205,'chop',200,23);
  const A=E.analyze(today,{K:3});
  const p=L.pathProbability(A,{market:'Neutral',calibration:cal});
  ck('with enough history the source is empirical and reports n', p.source!=='empirical'||p.n>=30, p.source+(p.n?' n='+p.n:''));
  if(p.source==='empirical') ck('empirical confidence beats the model ceiling', p.confidence>55, p.confidence+'');
  else ck('too few cases -> falls back to model and says so', p.source==='model'&&!!p.bias, 'sampled '+(p.sampled||0));
  const empty=L.pathProbability(A,{market:'Neutral',calibration:{table:{},coarse:{}}});
  ck('an empty history never fakes a statistic', empty.source==='model'); }

// ---- what now: plain language, no jargon
{ const today=day('2026-09-01',200,'up',260,5);
  const A=E.analyze(today,{K:3});
  const W=L.whatNow(A,{market:'Neutral',daily:{trend:'UP'}});
  ck('one primary action', !!W.action && !!W.actionText, W.action+' = '+W.actionText);
  ck('a next-thing line exists', !!W.next, W.next);
  ck('an up path and a down path exist', W.up.length>=2 && W.down.length>=2);
  ck('a why exists in plain words', W.why.length>=3, W.why.join(' · '));
  const all=[W.next].concat(W.up,W.down,W.why).join(' ');
  const jargon=['HH','HL','LH','LL','VWAP','EMA','momentum','ATR','R ','swing','breakout'];
  const found=jargon.filter(j=>all.indexOf(j)>=0);
  ck('user-facing text contains no jargon', found.length===0, found.join(',')||'clean');
  ck('every path line names a price', W.up.concat(W.down).every(s=>/\d+\.\d\d/.test(s)), W.up[0]);
  ck('probability is attached', !!W.probability && W.probability.up+W.probability.down===100); }

// ---- session close (spec 11)
{ const today=day('2026-09-01',200,'up',390,5);
  const A=E.analyze(today,{K:3});
  const W=L.whatNow(A,{market:'Neutral',sessionEnded:true});
  ck('session closed shows its own action', W.action==='SESSION_CLOSED', W.actionText);
  ck('session closed does not issue a live instruction', !/אפשר להיכנס|לחכות לאישור/.test([W.next].concat(W.up,W.down).join(' ')), W.next);
  ck('closed view still names the important levels', /\d+\.\d\d/.test(W.up.join(' ')) && /\d+\.\d\d/.test(W.down.join(' '))); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
