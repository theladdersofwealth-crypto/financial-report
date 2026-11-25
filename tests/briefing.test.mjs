import test from 'node:test';
import assert from 'node:assert/strict';
import {briefingWindow, buildKoreaBriefing, koreaBriefingQuotes} from '../src/briefing.js';

test('briefing windows advance at four-hour boundaries in Korea time', () => {
  assert.deepEqual(briefingWindow(Date.parse('2026-11-23T18:59:59Z')), {
    windowStart:'2026-11-23T15:00:00.000Z', nextUpdateAt:'2026-11-23T19:00:00.000Z',
  });
  assert.deepEqual(briefingWindow(Date.parse('2026-11-23T19:00:00Z')), {
    windowStart:'2026-11-23T19:00:00.000Z', nextUpdateAt:'2026-11-23T23:00:00.000Z',
  });
});

test('Korea briefing leads with dated domestic moves and keeps signed flows separate', () => {
  const now = Date.parse('2026-11-25T19:00:00Z');
  const quote = {value:3200, change:1.25, changeUnit:'%', status:'daily', observedAt:'2026-11-25', source:'공급자'};
  const rows = koreaBriefingQuotes([
    {...quote, id:'fut_es'}, {...quote, id:'kospi'}, {...quote, id:'kosdaq', change:-0.75},
    {...quote, id:'kr_foreign_kospi', value:-150, change:10, changeUnit:'억원'},
    {...quote, id:'kr3y', value:3.02}, {...quote, id:'usdkrw', value:1400, savedFrom:'cache'},
  ]);
  const result = buildKoreaBriefing(rows, now);
  assert.equal(result.headline, '11월 25일 종가 · 코스피 +1.25% · 코스닥 -0.75%');
  assert.deepEqual(result.points, ['코스피가 코스닥을 2.00%p 앞섰습니다.']);
  assert.deepEqual(result.items.map(item => item.id), ['kospi', 'kosdaq', 'kr_foreign_kospi', 'kr3y']);
  assert.equal(result.items[2].value, -150);
  assert.ok(result.items.every(item => !Object.hasOwn(item, 'source')));
  const mixed = buildKoreaBriefing([
    {...quote, id:'kospi'}, {...quote, id:'kosdaq', observedAt:'2026-11-24'},
  ], now);
  assert.equal(mixed.headline, '11월 25일 종가 · 코스피 +1.25%');
  assert.deepEqual(mixed.points, []);
  const stale = buildKoreaBriefing([{...quote, id:'kospi', observedAt:'2026-11-17'}], now);
  assert.match(stale.headline, /한국 증시.*시세 확인 중/);
  assert.deepEqual(stale.missing, ['코스피', '코스닥']);
});
