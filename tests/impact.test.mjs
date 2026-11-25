import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImpact } from '../src/impact.js';
import { latestUsSession } from '../src/us-session.js';

const now = Date.parse('2026-11-22T02:00:00Z');

test('US outlook follows New York closing time, weekends and exchange holidays', () => {
  const session = time => latestUsSession(Date.parse(time));
  assert.deepEqual(session('2026-11-23T20:59:00Z'), {date: '2026-11-20', previous: '2026-11-19'});
  assert.deepEqual(session('2026-11-24T01:41:00Z'), {date: '2026-11-23', previous: '2026-11-20'});
  assert.deepEqual(session('2026-11-27T02:00:00Z'), {date: '2026-11-25', previous: '2026-11-24'});
  assert.deepEqual(session('2026-04-04T00:00:00Z'), {date: '2026-04-02', previous: '2026-04-01'});
});
function quote(id, change, group = 'equity', unit = group === 'rates' ? 'bp' : '%', date = '2026-11-20', status = 'daily') {
  return { id, name: id, change, changeUnit: unit, group, status, observedAt: date, value: 100, source: '테스트 출처' };
}

test('abstains instead of inventing a direction when observations are absent', () => {
  const impact = buildImpact({quotes:[]}, now);
  assert.equal(impact.kospi.state, '판단 보류');
  assert.equal(impact.kosdaq.state, '판단 보류');
  assert.equal(impact.kospi.coverage, 0);
  assert.ok(impact.themes.every(item => item.state === '판단 보류'));
});

test('combines foreign indices, FX, yields, and volatility with provenance', () => {
  const quotes = [
    quote('sox', 2), quote('nasdaq', 1), quote('sp500', 0.5),
    quote('usdkrw', -1, 'fx'), quote('us10y', -5, 'rates'),
    quote('usreal10y', -4, 'rates'), quote('vix', -2, 'risk'),
  ];
  const impact = buildImpact({quotes}, now);
  assert.equal(impact.kospi.state, '우호');
  assert.equal(impact.kosdaq.state, '우호');
  assert.equal(impact.kospi.coverage, 1);
  assert.equal(impact.kospi.drivers.length, 6);
  assert.ok(impact.kospi.drivers.every(d => d.source === '테스트 출처' && d.observedAt));
  assert.ok(impact.kospi.drivers.some(d => d.text.includes('bp')));
  assert.equal(impact.themes.find(x => x.title === '성장주·할인율').state, '우호');
  assert.equal('probability' in impact, false);
});

test('stale, future, deployment backups, and mismatched units are excluded', () => {
  const quotes = [
    quote('sox', 2, 'equity', 'bp'),
    quote('nasdaq', 2, 'equity', '%', '2026-11-01'),
    {...quote('sp500', 2), deploymentBackup: true},
    quote('usdkrw', -2, 'fx', '%', '2026-11-25'),
    quote('vix', -2, 'risk', '%', '2026-11-20', 'stale'),
    quote('us10y', -4, 'rates', 'bp'),
  ];
  const impact = buildImpact({quotes}, now);
  assert.equal(impact.kospi.available, 1);
  assert.equal(impact.kospi.state, '판단 보류');
  assert.equal(impact.kospi.drivers[0].id, 'us10y');
});

test('mixed observation dates are disclosed and neutral evidence is not called bullish', () => {
  const quotes = [
    quote('sox', 0), quote('nasdaq', 0, 'equity', '%', '2026-11-19'),
    quote('sp500', 0), quote('usdkrw', 0, 'fx', '%', '2026-11-19'),
    quote('us10y', 0, 'rates'), quote('vix', 0, 'risk'),
  ];
  const impact = buildImpact({quotes}, now);
  assert.equal(impact.kospi.drivers.some(driver => driver.id === 'nasdaq'), false);
  assert.equal(impact.kospi.state, '혼재');
  assert.equal(impact.mixedDates, true);
  assert.ok(impact.cautions.some(text => text.includes('규칙 기반 가중치')));
  assert.ok(impact.kospi.drivers.every(driver => !driver.text.includes('관측')));
});

test('KOSPI and KOSDAQ use independent factor sets', () => {
  const quotes = [
    quote('sox', 2), quote('nasdaq', -2),
    quote('usdkrw', -2, 'fx'), quote('us10y', -2, 'rates'),
    quote('usreal10y', 6, 'rates'), quote('vix', 5, 'risk'),
  ];
  const impact = buildImpact({quotes}, now);
  assert.equal(impact.kospi.state, '우호');
  assert.equal(impact.kosdaq.state, '부담');
});

test('domestic actual closes and signed foreign flow are displayed as factual observations', () => {
  const quotes = [
    {...quote('kospi', -1.2, 'korea'), value: 5000, unit: 'pt', name: '코스피'},
    {...quote('kosdaq', 1.6, 'korea'), value: 900, unit: 'pt', name: '코스닥'},
    {...quote('kr_foreign_kospi', 400, 'korea', '억원'), value: -800, unit: '억원',
      name: '코스피 외국인 순매수'},
  ];
  const impact = buildImpact({quotes}, now);
  assert.equal(impact.domestic.kospi.value, 5000);
  assert.equal(impact.domestic.kosdaq.value, 900);
  assert.equal(impact.domestic.foreignKospi.value, -800);
  assert.equal(impact.kospi.state, '판단 보류', 'actual domestic closes do not leak into the overseas checklist');
  assert.ok(impact.cautions.some(s => s.includes('시장별 일별 관측값')));
});

test('stale or backup domestic observations never masquerade as current', () => {
  const impact = buildImpact({quotes: [
    {...quote('kospi', 2, 'korea', '%', '2026-10-01'), value: 5000},
    {...quote('kosdaq', 2, 'korea'), value: 900, deploymentBackup: true},
    {...quote('kr_foreign_kospi', 1, 'korea', '%'), value: -200},
  ]},now);
  assert.equal(impact.domestic.kospi,null);
  assert.equal(impact.domestic.kosdaq,null);
  assert.equal(impact.domestic.foreignKospi,null);
});
