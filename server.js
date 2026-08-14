const http = require('http');
const https = require('https');
const url = require('url');

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'application/json'
};

function fetchJson(targetUrl) {
  return new Promise((resolve, reject) => {
    https.get(targetUrl, { headers: YF_HEADERS }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: null, raw: data.slice(0, 500) });
        }
      });
    }).on('error', reject);
  });
}

function buildBars(chartResult, nowSec, intervalSec) {
  if (!chartResult) return [];
  const ts = chartResult.timestamp || [];
  const q = (chartResult.indicators && chartResult.indicators.quote && chartResult.indicators.quote[0]) || {};
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open ? q.open[i] : null;
    const h = q.high ? q.high[i] : null;
    const l = q.low ? q.low[i] : null;
    const c = q.close ? q.close[i] : null;
    const v = q.volume ? q.volume[i] : null;
    if (o == null || h == null || l == null || c == null) continue; // skip gaps
    bars.push({
      timestamp: new Date(ts[i] * 1000).toISOString(),
      unix: ts[i],
      open: o, high: h, low: l, close: c, volume: v,
      closed: (ts[i] + intervalSec) <= nowSec
    });
  }
  return bars;
}

async function getMarketData(symbol) {
  const nowSec = Math.floor(Date.now() / 1000);
  const base = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol);

  const [oneM, fiveM, daily] = await Promise.all([
    fetchJson(base + '?interval=1m&range=1d&includePrePost=false'),
    fetchJson(base + '?interval=5m&range=5d&includePrePost=false'),
    fetchJson(base + '?interval=1d&range=6mo')
  ]);

  const r1 = oneM.body && oneM.body.chart && oneM.body.chart.result && oneM.body.chart.result[0];
  const r5 = fiveM.body && fiveM.body.chart && fiveM.body.chart.result && fiveM.body.chart.result[0];
  const rd = daily.body && daily.body.chart && daily.body.chart.result && daily.body.chart.result[0];

  if (!r1 && !r5 && !rd) {
    return {
      error: true,
      message: 'Upstream Yahoo Finance fetch failed for all ranges',
      statuses: { oneM: oneM.status, fiveM: fiveM.status, daily: daily.status },
      raw: { oneM: oneM.raw, fiveM: fiveM.raw, daily: daily.raw }
    };
  }

  const meta = (r1 && r1.meta) || (r5 && r5.meta) || (rd && rd.meta) || {};
  const bars1m = buildBars(r1, nowSec, 60).slice(-120);
  const bars5m = buildBars(r5, nowSec, 300).slice(-60);
  const barsDaily = buildBars(rd, nowSec, 86400).slice(-60);

  const lastBar1m = bars1m[bars1m.length - 1];
  const staleSeconds = lastBar1m ? (nowSec - lastBar1m.unix) : null;

  return {
    symbol: symbol.toUpperCase(),
    source: 'yahoo-finance-chart-api-via-bridge',
    fetched_at: new Date(nowSec * 1000).toISOString(),
    market_timestamp: lastBar1m ? lastBar1m.timestamp : null,
    stale_seconds: staleSeconds,
    data_stale: staleSeconds !== null ? staleSeconds > 180 : true,
    last_price: meta.regularMarketPrice != null ? meta.regularMarketPrice : null,
    previous_close: meta.chartPreviousClose != null ? meta.chartPreviousClose : (meta.previousClose != null ? meta.previousClose : null),
    day_high: meta.regularMarketDayHigh != null ? meta.regularMarketDayHigh : null,
    day_low: meta.regularMarketDayLow != null ? meta.regularMarketDayLow : null,
    market_state: meta.marketState || null,
    bars_1m: bars1m,
    bars_5m: bars5m,
    daily: barsDaily
  };
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (parsed.pathname === '/' || parsed.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, usage: '/market/:symbol e.g. /market/SPMO' }));
    return;
  }

  const match = parsed.pathname.match(/^\/market\/([A-Za-z0-9.\-]+)$/);
  if (match) {
    const symbol = match[1];
    try {
      const data = await getMarketData(symbol);
      res.writeHead(data.error ? 502 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data, null, 2));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: true, message: String((e && e.message) || e) }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: true, message: 'not found' }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Market bridge listening on ' + PORT));
