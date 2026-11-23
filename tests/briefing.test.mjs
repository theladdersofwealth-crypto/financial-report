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

test('US briefing uses verified contracts first and labels cash and missing alternatives', () => {
  const now = Date.parse('2026-11-23T18:00:00Z');
  const futures = [
    {id:'fut_es', value:7000, change:0.5, changeUnit:'%', status:'delayed', contract:'ESZ26', observedAt:'2026-11-23', source:'KIS'},
    {id:'fut_sox', value:5000, change:1, changeUnit:'%', status:'stale', observedAt:'2026-11-20'},
  ];
  const cash = [
    {id:'sp500', value:6990, change:-1, changeUnit:'%', observedAt:'2026-11-20'},
    {id:'nasdaq', value:24000, change:-0.4, changeUnit:'%', observedAt:'2026-11-20', source:'FRED', savedFrom:'build'},
    {id:'sox', value:5000, change:2, changeUnit:'%', observedAt:'2026-11-24'},
  ];
  const first = buildUsBriefing(futures, cash, now);
  assert.equal(first.headline,'S&P 500 선물 상승 · 나스닥100 현물 종가 하락');
  assert.equal(first.items[0].contract,'ESZ26');
  assert.equal(first.items[1].saved,true);
  assert.deepEqual(first.missing,['다우 선물','러셀2000 선물','필라델피아 반도체 선물']);
  futures[0].change = -0.2;
  const later = buildUsBriefing(futures, cash, now + 4*3600000);
  assert.notEqual(later.windowStart, first.windowStart);
  assert.match(later.headline,/S&P 500 선물 하락/);
});
