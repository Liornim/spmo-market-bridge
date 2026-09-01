import { DatabaseSync } from 'node:sqlite';
class Stmt { constructor(db, sql){this.db=db;this.sql=sql;this.p=[];} bind(...p){this.p=p;return this;}
  _exec(){const s=this.db.prepare(this.sql); if(/^\s*(SELECT|WITH)/i.test(this.sql)||/RETURNING/i.test(this.sql)) return {results:s.all(...this.p),meta:{changes:0}}; const r=s.run(...this.p); return {results:[],meta:{changes:Number(r.changes)}};}
  async all(){return this._exec();} async first(){const r=this._exec().results[0];return r===undefined?null:r;} async run(){return this._exec();} }
class D1 { constructor(){this.db=new DatabaseSync(':memory:');} prepare(sql){return new Stmt(this.db,sql);} async batch(s){return s.map(x=>x._exec());} }
let clock = 1788205200; Date.now = () => clock*1000;
globalThis.fetch = async () => { const base=clock-600; const rows=[[base,1,2,0.5,1.5,10],[base+60,1.5,2,1,1.2,20]];
  return {status:200,json:async()=>({chart:{result:[{timestamp:rows.map(r=>r[0]),indicators:{quote:[{open:rows.map(r=>r[1]),high:rows.map(r=>r[2]),low:rows.map(r=>r[3]),close:rows.map(r=>r[4]),volume:rows.map(r=>r[5])}]}}]}})}; };
const db = new D1(); const env={DB:db}; const ctx={waitUntil:p=>{ctx.pending=p;}};
const v1 = (await import('./legacy/worker.v1.js')).default;
await v1.fetch(new Request('https://x/sync/NVDA'), env, ctx);
const v1rows = db.db.prepare('SELECT COUNT(*) c FROM bars').get().c;
const v1runs = db.db.prepare('SELECT COUNT(*) c FROM runs').get().c;
console.log('v1 wrote bars:', v1rows, 'runs:', v1runs);
const v2 = (await import('./worker.js')).default;
const r = await v2.fetch(new Request('https://x/status'), env, ctx); const j = await r.json();
const nv = j.symbols.find(s=>s.symbol==='NVDA');
console.log(nv.bars===v1rows && nv.days===1 ? 'PASS' : 'FAIL', 'v2 /status sees v1 data via migrated days table', JSON.stringify({bars:nv.bars,days:nv.days}));
const s = await v2.fetch(new Request('https://x/sync/NVDA'), env, ctx); const sj = await s.json();
console.log(sj.status==='ok' ? 'PASS' : 'FAIL', 'v2 sync works on v1 runs table (rows_written NOT NULL)', sj.status);
const cols = db.db.prepare("PRAGMA table_info(runs)").all().map(c=>c.name);
console.log(cols.includes('finished_at') && cols.includes('status') ? 'PASS':'FAIL', 'runs columns migrated', cols.join(','));
console.log(db.db.prepare("PRAGMA table_info(symbols)").all().some(c=>c.name==='last_backfill_at') ? 'PASS':'FAIL', 'symbols.last_backfill_at migrated');
