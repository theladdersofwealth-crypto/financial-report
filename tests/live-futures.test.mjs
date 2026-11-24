import test from 'node:test';
import assert from 'node:assert/strict';
import { collectLiveFutures, loadLiveFuturesChart } from '../src/live-futures.js';

test('fresh exchange books recover from stale or invalid primaries with the true product label', async () => {
  const now = Date.parse('2026-11-24T00:00:00Z');
  const env = {fetchProvider: async input => {
    const url = new URL(input);
    const name = url.searchParams.get('contract') || url.searchParams.get('symbol');
    if (name === 'SPX500_USDT') return Response.json({update:now-60000,bids:[{p:'7000'}],asks:[{p:'7002'}]});
    if (name === 'NAS100_USDT') return Response.json({update:now-1000,bids:[{p:'26000'}],asks:[{p:'26002'}]});
    if (name === 'US30_USDT') return Response.json({update:now,bids:[{p:'50002'}],asks:[{p:'50000'}]});
    if (name === 'SPYUSDT') return Response.json({symbol:name,time:now-200,bidPrice:'700',askPrice:'702'});
    if (url.hostname === 'api.mexc.com') return Response.json({success:true,data:{timestamp:now,bids:[[50000]],asks:[[50004]]}});
    return new Response(null,{status:503});
  }};
  const issues = [];
  const rows = await collectLiveFutures(env,event=>issues.push(event),()=>now);
  assert.deepEqual(rows.map(q=>[q.id,q.venue,q.name,q.value]), [
    ['fut_es','binance','SPY ETF 무기한',701],
    ['fut_nq','gate','나스닥100 무기한',26001],
    ['fut_ym','mexc','다우 무기한',50002],
  ]);
  assert.equal(issues.find(event=>event.symbol === 'SPX500_USDT').reason,'quote_time');
});

test('chart fetch is pinned to the selected venue contract and keeps verified mark OHLC bars', async () => {
  const now = Date.parse('2026-11-24T00:00:00Z');
  const env = {fetchProvider: async input => {
    const url = new URL(input);
    assert.match(url.pathname,/markPriceKlines$/);
    assert.equal(url.searchParams.get('symbol'),'SPYUSDT');
    return Response.json([[now-86400000,'700','703','699','702'],[now,'702','701','702','704']]);
  }};
  assert.equal((await loadLiveFuturesChart(env,'fut_es','D','mexc',now)).status,'invalid');
  const result = await loadLiveFuturesChart(env,'fut_es','D','binance',now);
  assert.equal(result.contract,'SPYUSDT');
  assert.deepEqual(result.bars,[{date:'2026-11-23',open:700,high:703,low:699,close:702,value:702}]);
});
