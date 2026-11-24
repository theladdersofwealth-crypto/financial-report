import {FUTURES_FRESHNESS_MS, usFutures} from '../public/futures-config.js';

const HOUR = 60 * 60 * 1000;
const INTERVAL = 4 * HOUR;
const KST_OFFSET = 9 * HOUR;

export function briefingWindow(now) {
  const start = Math.floor((now + KST_OFFSET) / INTERVAL) * INTERVAL - KST_OFFSET;
  return {windowStart:new Date(start).toISOString(), nextUpdateAt:new Date(start + INTERVAL).toISOString()};
}

export function buildUsBriefing(quotes, previous, now) {
  const window = briefingWindow(now);
  const prior = new Map(previous?.nextUpdateAt === window.windowStart
    ? previous.items.map(item => [item.id,item]) : []);
  const current = new Map(quotes.map(quote => [quote.id,quote]));
  const items = [];
  const missing = [];
  for (const product of usFutures) {
    const quote = current.get(product.id);
    const age = now - Date.parse(quote?.observedAt);
    if (quote?.status !== 'live' || quote?.unit !== 'USDT' || !(quote.value > 0)
        || !Number.isFinite(age) || age < -5000 || age > FUTURES_FRESHNESS_MS) {
      missing.push(product.liveName);
      continue;
    }
    const old = prior.get(quote.id);
    const comparable = old?.venue === quote.venue && old?.contract === quote.contract && old.value > 0;
    const change = comparable ? Number(((quote.value - old.value) / old.value * 100).toFixed(2)) : null;
    items.push({...quote, type:'future', change, changeBasis:comparable ? '직전 브리핑의 같은 상품·호가 대비' : null});
  }
  const headline = items.slice(0,2).map(item => {
    const move = item.change === null ? '' : item.change > 0 ? ' 상승' : item.change < 0 ? ' 하락' : ' 보합';
    return `${item.name}${move}`;
  }).join(' · ') || '미국 시장의 실시간 호가 확인 중';
  return {...window, generatedAt:new Date(now).toISOString(), headline, items, missing};
}
