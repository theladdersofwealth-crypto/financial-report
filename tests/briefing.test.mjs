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
  const quote = {value:3200, unit:'pt', change:1.25, changeUnit:'%', status:'daily', observedAt:'2026-11-25', source:'공급자'};
  const rows = koreaBriefingQuotes([
    {...quote, id:'fut_es'}, {...quote, id:'kospi'}, {...quote, id:'kosdaq', change:-0.75},
    {...quote, id:'kr_foreign_kospi', value:-150, change:10, changeUnit:'억원', unit:'억원'},
    {...quote, id:'kr3y', value:3.02}, {...quote, id:'usdkrw', value:1400, savedFrom:'cache'},
  ]);
  const result = buildKoreaBriefing(rows, now);
  assert.equal(result.headline, '11월 25일 종가 · 코스피 +1.25% · 코스닥 -0.75%');
  assert.equal(result.insight.title, '코스피 상승 · 코스닥 하락');
  assert.match(result.insight.summary, /외국인은 코스피에서 150억원 순매도/);
  assert.match(result.insight.watch, /다음 장에서 코스피 외국인 순매도/);
  assert.equal(result.previousSession, true);
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

test('intraday insight connects the Korean selloff and signed flows with fresh US index futures', () => {
  const now = Date.parse('2026-11-25T04:16:00Z');
  const index = {value:3200, changeUnit:'%', unit:'pt', status:'delayed', observedAt:'2026-11-25T04:15:00Z'};
  const flow = {...index, unit:'억원', changeUnit:'억원'};
  const future = {value:7200, change:0.85, unit:'USDT', changeUnit:'%', status:'live',
    comparisonAt:'2026-11-24', observedAt:'2026-11-25T04:15:55Z'};
  const result = buildKoreaBriefing([
    {...index, id:'kospi', change:-5.53}, {...index, id:'kosdaq', change:-1.96},
    {...flow, id:'kr_foreign_kospi', value:-1188.73}, {...flow, id:'kr_pension_kospi', value:258.79},
    {...flow, id:'kr_foreign_kosdaq', value:-0.03},
    {...future, id:'fut_es'}, {...future, id:'fut_nq'},
  ], now);
  assert.deepEqual(result.insight, {
    title:'코스피·코스닥 동반 하락',
    summary:'외국인은 코스피에서 1,189억원 순매도했습니다. 미국 지수선물은 한국 증시와 반대로 동반 상승 중입니다.',
    watch:'코스피 외국인 순매도가 줄어드는지 보세요.',
  });
  assert.deepEqual(result.points, ['코스피 낙폭이 더 큽니다.', '연기금은 같은 시장에서 259억원 순매수했습니다.']);
  assert.deepEqual(result.items.slice(-2).map(item=>item.id), ['fut_nq','fut_es']);
});

test('briefing uses the Korean trading date and skips stale cash, unmatched flows and old futures', () => {
  const now = Date.parse('2026-11-25T15:01:00Z');
  const daily = {status:'daily', unit:'pt', value:3200, change:1.25, changeUnit:'%', observedAt:'2026-11-25'};
  const result = buildKoreaBriefing([
    {...daily, id:'kospi'}, {...daily, id:'kosdaq', observedAt:'2026-11-24', change:-1.25},
    {...daily, id:'kr_foreign_kospi', unit:'억원', value:-8500, observedAt:'2026-11-24'},
    {...daily, id:'kr_pension_kospi', unit:'억원', value:-8500, savedFrom:'last-good'},
    {...daily, id:'fut_nq', status:'live', observedAt:'2026-11-25T15:00:00Z', change:-3},
    {...daily, id:'usdkrw', value:1344.52, change:0.35},
  ], now);
  assert.equal(result.session, '11월 25일 종가');
  assert.equal(result.previousSession, true);
  assert.equal(result.insight.title, '코스피 상승');
  assert.match(result.insight.summary, /최근 기준환율.*원화가 약세/);
  assert.doesNotMatch(result.insight.summary, /순매도|선물/);
  assert.deepEqual(result.items.map(item=>item.id), ['kospi','usdkrw']);
});
