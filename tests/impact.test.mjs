import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImpact } from '../src/impact.js';

const now = Date.parse('2026-11-22T02:00:00Z');
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
    quote('sp500', 0), quote('usdkrw', 0, 'fx'),
    quote('us10y', 0, 'rates'), quote('vix', 0, 'risk'),
  ];
  const impact = buildImpact({quotes}, now);
  assert.equal(impact.kospi.state, '혼재');
  assert.equal(impact.mixedDates, true);
  assert.ok(impact.cautions.some(text => text.includes('예측모형')));
});

test('KOSPI and KOSDAQ use independent factor sets', () => {
  const quotes = [
    quote('sox', 2), quote('nasdaq', -2), quote('sp500', 2),
    quote('usdkrw', -2, 'fx'), quote('us10y', -2, 'rates'),
    quote('usreal10y', 6, 'rates'), quote('vix', 5, 'risk'),
  ];
  const impact = buildImpact({quotes}, now);
  assert.equal(impact.kospi.state, '우호');
  assert.equal(impact.kosdaq.state, '부담');
});
