const HOUR = 60 * 60 * 1000;
const INTERVAL = 4 * HOUR;
const KST_OFFSET = 9 * HOUR;
const KOREA_METRICS = new Map([
  ['kospi', '코스피'], ['kosdaq', '코스닥'],
  ['kr_foreign_kospi', '코스피 외국인'], ['kr_foreign_kosdaq', '코스닥 외국인'],
  ['usdkrw', '달러/원'], ['kr3y', '한국 국고채 3년'], ['kr10y', '한국 국고채 10년'],
]);

export function briefingWindow(now) {
  const start = Math.floor((now + KST_OFFSET) / INTERVAL) * INTERVAL - KST_OFFSET;
  return {windowStart:new Date(start).toISOString(), nextUpdateAt:new Date(start + INTERVAL).toISOString()};
}

export function koreaBriefingQuotes(quotes) {
  return quotes.filter(quote => KOREA_METRICS.has(quote.id)).map(quote => ({
    id:quote.id, value:quote.value, unit:quote.unit, change:quote.change, changeUnit:quote.changeUnit,
    status:quote.status, observedAt:quote.observedAt, timestampPrecision:quote.timestampPrecision,
    deploymentBackup:quote.deploymentBackup, savedFrom:quote.savedFrom,
  }));
}

export function buildKoreaBriefing(quotes, now) {
  const valid = new Map(quotes.filter(quote => {
    const age = now - Date.parse(quote.observedAt);
    return Number.isFinite(quote.value) && ['daily', 'delayed', 'live'].includes(quote.status)
      && !quote.deploymentBackup && !quote.savedFrom && age >= -5000 && age <= 7 * 24 * HOUR;
  }).map(quote => [quote.id, quote]));
  const items = [...KOREA_METRICS].flatMap(([id, name]) => {
    const quote = valid.get(id);
    return quote ? [{...quote, name}] : [];
  });
  const indices = items.filter(item => item.id === 'kospi' || item.id === 'kosdaq');
  const latestDay = indices.map(item => item.observedAt.slice(0, 10)).sort().at(-1);
  const current = indices.filter(item => item.observedAt.startsWith(latestDay));
  const hasChange = item => Number.isFinite(item.change) && item.changeUnit === '%';
  const moves = current.map(item => {
    if (!hasChange(item)) return item.name;
    return `${item.name} ${item.change > 0 ? '+' : ''}${item.change.toFixed(2)}%`;
  });
  const headline = latestDay
    ? `${Number(latestDay.slice(5, 7))}월 ${Number(latestDay.slice(8))}일 ${current.every(item => item.status === 'daily') ? '종가' : '시황'} · ${moves.join(' · ')}`
    : '한국 증시 · 코스피·코스닥 시세 확인 중';
  const missing = ['kospi', 'kosdaq'].filter(id => !valid.has(id)).map(id => KOREA_METRICS.get(id));
  const gap = current.length === 2 && current.every(item => item.status === 'daily' && hasChange(item))
    ? current[1].change - current[0].change : 0;
  const points = Math.abs(gap) >= 0.01
    ? [`${gap > 0 ? '코스닥이 코스피를' : '코스피가 코스닥을'} ${Math.abs(gap).toFixed(2)}%p 앞섰습니다.`] : [];
  return {...briefingWindow(now), generatedAt:new Date(now).toISOString(), headline, items, missing, points};
}
