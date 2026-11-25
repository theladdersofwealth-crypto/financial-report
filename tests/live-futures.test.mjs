import test from 'node:test';
import assert from 'node:assert/strict';
import { collectLiveFutures, loadLiveFuturesChart, withFuturesChanges } from '../src/live-futures.js';

test('fresh exchange books recover from stale or invalid primaries with the true product label', async () => {
  const now = Date.parse('2026-11-24T00:00:00Z');
  const env = {fetchProvider: async input => {
    const url = new URL(input);
    const name = url.searchParams.get('contract') || url.searchParams.get('symbol');
    if (name === 'SPX500_USDT') return Response.json({update_us:(now-60000)*1000,bids:[{p:'7000'}],asks:[{p:'7002'}]});
    if (name === 'NAS100_USDT') return Response.json({update:(now-1000)/1000,bids:[{p:'26000'}],asks:[{p:'26002'}]});
    if (name === 'US30_USDT') return Response.json({update:now,bids:[{p:'50002'}],asks:[{p:'50000'}]});
    if (name === 'SPYUSDT') return Response.json({symbol:name,time:now-200,bidPrice:'700',askPrice:'702'});
    if (url.hostname === 'api.mexc.com') return Response.json({success:true,data:{timestamp:now,bids:[[50000]],asks:[[50004]]}});
    return new Response(null,{status:503});
  }};
  const issues = [];
  const rows = await collectLiveFutures(env,event=>issues.push(event),()=>now);
  assert.deepEqual(rows.map(q=>[q.id,q.venue,q.name,q.value]), [
    ['fut_es','binance','SPY ETF',701],
    ['fut_nq','gate','나스닥100',26001],
    ['fut_ym','mexc','다우',50002],
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

test('futures change compares the same contract with its most recent completed daily close', async () => {
  const now = Date.parse('2026-11-25T02:00:00Z');
  const day = Date.parse('2026-11-25T00:00:00Z') / 1000;
  let calls = 0;
  const env = {fetchProvider: async input => {
    calls++;
    const url = new URL(input);
    assert.match(url.pathname, /candlesticks$/);
    assert.equal(url.searchParams.get('contract'), 'SPX500_USDT');
    return Response.json([
      {t:day,c:'115'}, {t:day-86400,c:'100'}, {t:day-172800,c:'98'},
      {t:day-500,c:'101'},
    ]);
  }};
  const quote = {id:'fut_es',venue:'gate',contract:'SPX500_USDT',value:110,observedAt:new Date(now).toISOString()};
  const cache = new Map();
  const [first] = await withFuturesChanges([quote], env, cache, now);
  const [updated] = await withFuturesChanges([{...quote,value:95}], env, cache, now+5000);
  assert.equal(first.comparisonAt, '2026-11-24');
  assert.equal(first.change, 10);
  assert.equal(updated.change, -5);
  assert.equal(calls, 1);
});

test('BTC/ETH use Binance first; unavailable or stale contracts fall back to Bybit, OKX, then Gate', async () => {
  const now = Date.parse('2026-11-25T02:00:00Z');
  for (const expected of ['binance', 'bybit', 'okx', 'gate']) {
    const calls = {BTC:[],ETH:[]};
    const byHost = {'fapi.binance.com':'binance','api.bybit.com':'bybit','www.okx.com':'okx','api.gateio.ws':'gate'};
    const env = {fetchProvider: async input => {
      const url = new URL(input);
      const symbol = url.searchParams.get('contract') || url.searchParams.get('symbol') || url.searchParams.get('instId');
      const coin = /^(BTC|ETH)[_\-]?USDT(?:-SWAP)?$/.exec(symbol)?.[1];
      if (!coin) return new Response(null,{status:404});
      const venue = byHost[url.hostname];
      calls[coin].push(venue);
      if (venue !== expected) {
        if (venue === 'binance') return Response.json({symbol,time:now-31000,bidPrice:'100',askPrice:'102'});
        return new Response(null,{status:503});
      }
      if (venue === 'binance') return Response.json({symbol,time:now-1000,bidPrice:'100',askPrice:'102'});
      if (venue === 'bybit') return Response.json({retCode:0,result:{s:symbol,cts:now-1000,b:[['100']],a:[['102']]}});
      if (venue === 'okx') return Response.json({code:'0',data:[{ts:String(now-1000),bids:[['100']],asks:[['102']]}]});
      return Response.json({update_us:(now-1000)*1000,bids:[{p:'100'}],asks:[{p:'102'}]});
    }};
    const quotes = (await collectLiveFutures(env,()=>{},()=>now,'assets')).filter(q=>q.group === 'crypto');
    assert.deepEqual(quotes.map(q=>[q.id,q.venue,q.value]),[['btc',expected,101],['eth',expected,101]]);
    const order = ['binance','bybit','okx','gate'];
    for (const coin of ['BTC','ETH']) assert.deepEqual(calls[coin],order.slice(0,order.indexOf(expected)+1));
    if (expected === 'okx') assert.equal(quotes[0].sourceUrl,'https://www.okx.com/trade-swap/btc-usdt-swap');
  }
});

test('OKX futures use confirmed UTC trade closes and chart the same swap mark price', async () => {
  const now = Date.parse('2026-11-25T02:00:00Z');
  const day = Date.parse('2026-11-25T00:00:00Z');
  const bar = (time, close, confirm) => [String(time),'101','130','90',String(close),'0','0','0',confirm];
  const env = {fetchProvider:async input => {
    const url = new URL(input);
    assert.equal(url.hostname,'www.okx.com');
    assert.equal(url.searchParams.get('instId'),'BTC-USDT-SWAP');
    if (url.pathname.endsWith('/mark-price-candles')) {
      assert.equal(url.searchParams.get('bar'),'1m');
      return Response.json({code:'0',data:[bar(now,120,'0').slice(0,5)]});
    }
    assert.equal(url.pathname,'/api/v5/market/candles');
    assert.equal(url.searchParams.get('bar'),'1Dutc');
    return Response.json({code:'0',data:[bar(day,125,'0'),bar(day-86400000,120,'0'),bar(day-2*86400000,100,'1')]});
  }};
  const quote = {id:'btc',venue:'okx',contract:'BTC-USDT-SWAP',value:110,observedAt:new Date(now).toISOString()};
  const [compared] = await withFuturesChanges([quote],env,new Map(),now);
  assert.equal(compared.change,10);
  assert.equal(compared.comparisonAt,'2026-11-23');
  const chart = await loadLiveFuturesChart(env,'btc','1min','okx',now);
  assert.equal(chart.contract,quote.contract);
  assert.equal(chart.status,'ready');
  assert.equal(chart.bars[0].close,120);
});
