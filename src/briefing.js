import {usFutures} from '../public/futures-config.js';

const HOUR = 60 * 60 * 1000;
const INTERVAL = 4 * HOUR;
const KST_OFFSET = 9 * HOUR;
const cashByFuture = {fut_es:'sp500', fut_nq:'nasdaq', fut_sox:'sox'};
const cashIds = new Set(Object.values(cashByFuture));

export function briefingWindow(now) {
  const start = Math.floor((now + KST_OFFSET) / INTERVAL) * INTERVAL - KST_OFFSET;
  return {windowStart:new Date(start).toISOString(), nextUpdateAt:new Date(start + INTERVAL).toISOString()};
}

export function briefingCashQuotes(market) {
  return (market.quotes || []).filter(quote => cashIds.has(quote.id))
    .map(({id, value, change, changeUnit, observedAt, source, savedFrom, deploymentBackup}) =>
      ({id, value, change, changeUnit, observedAt, source, savedFrom, deploymentBackup}));
}

function recent(date, now, maxDays, allowedAhead = 0) {
  const day = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const time = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day
    && time <= now + allowedAhead && now - time < maxDays * 24 * HOUR;
}

function evidence(quote, name, type) {
  return {
    name, type, value:quote.value, unit:'pt',
    change:quote.changeUnit === '%' && Number.isFinite(quote.change) ? quote.change : null,
    changeUnit:'%',
    observedAt:quote.observedAt || null, retrievedAt:quote.retrievedAt || null,
    timestampPrecision:quote.timestampPrecision || 'day', source:quote.source || null,
    contract:quote.contract || null, saved:!!(quote.savedFrom || quote.deploymentBackup),
    basis:type === 'cash' ? '미국 정규장 종가' : quote.fallbackPeriod === 'D' ? '선물 일봉 종가'
      : quote.fallbackPeriod === '5min' ? '선물 5분봉 종가' : '선물 시세 · 지연 가능',
  };
}

export function buildUsBriefing(futures, cashQuotes, now) {
  const futuresById = new Map(futures.map(quote => [quote.id, quote]));
  const cash = new Map(cashQuotes.map(quote => [quote.id, quote]));
  const items = [];
  const missing = [];
  for (const product of usFutures) {
    const future = futuresById.get(product.id);
    if (Number.isFinite(future?.value) && future.value > 0 && ['daily','delayed','live'].includes(future.status)
        && recent(future.observedAt || future.retrievedAt, now, 4, KST_OFFSET)) {
      items.push(evidence(future, product.name, 'future'));
      continue;
    }
    const index = cash.get(cashByFuture[product.id]);
    if (Number.isFinite(index?.value) && index.value > 0 && recent(index.observedAt, now, 7)) {
      items.push(evidence(index, product.name.replace(/ 선물$/, ' 현물'), 'cash'));
    } else {
      missing.push(product.name);
    }
  }
  const prioritized = [...items.filter(item => item.type === 'future'), ...items.filter(item => item.type === 'cash')];
  const headline = prioritized.slice(0, 2).map(item => {
    const move = item.change === null ? '' : item.change > 0 ? ' 상승' : item.change < 0 ? ' 하락' : ' 보합';
    return `${item.name}${item.type === 'cash' ? ' 종가' : ''}${move}`;
  }).join(' · ') || '미국 지수의 최신 관측을 확인하지 못했습니다';
  return {...briefingWindow(now), generatedAt:new Date(now).toISOString(), headline, items:prioritized, missing};
}
