import test from 'node:test';
import assert from 'node:assert/strict';
import {briefingWindow, buildUsBriefing} from '../src/briefing.js';

test('briefing windows advance at four-hour boundaries in Korea time', () => {
  assert.deepEqual(briefingWindow(Date.parse('2026-11-23T18:59:59Z')), {
    windowStart:'2026-11-23T15:00:00.000Z', nextUpdateAt:'2026-11-23T19:00:00.000Z',
  });
  assert.deepEqual(briefingWindow(Date.parse('2026-11-23T19:00:00Z')), {
    windowStart:'2026-11-23T19:00:00.000Z', nextUpdateAt:'2026-11-23T23:00:00.000Z',
  });
});

test('briefing compares fresh quotes only across matching contracts and venues', () => {
  const now = Date.parse('2026-11-23T19:00:00Z');
  const quote = {id:'fut_es',name:'S&P 500 무기한',venue:'gate',contract:'SPX500_USDT',value:7000,
    status:'live',unit:'USDT',observedAt:new Date(now).toISOString()};
  const old = {...quote, value:6900};
  const previous = {nextUpdateAt:new Date(now).toISOString(),items:[old]};
  const result = buildUsBriefing([quote,{id:'fut_nq',status:'daily',value:24000}],previous,now);
  assert.equal(result.headline,'S&P 500 무기한 상승');
  assert.equal(result.items[0].change,1.45);
  assert.ok(result.missing.includes('나스닥100 무기한'));
  const switched = buildUsBriefing([{...quote,venue:'binance',contract:'SPYUSDT',value:700}],previous,now);
  assert.equal(switched.items[0].change,null);
  const stale = buildUsBriefing([{...quote,observedAt:new Date(now-30001).toISOString()}],previous,now);
  assert.equal(stale.items.length,0);
});
