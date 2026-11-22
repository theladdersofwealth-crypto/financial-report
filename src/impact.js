// Global-to-Korea overseas-market environment checklist.
// This is not a calibrated forecast, trading signal, or domestic fund-flow estimate.
const FACTORS = {
  kospi: [
    ['sox', 3, 1, '미국 반도체'], ['nasdaq', 2, 1, '나스닥 100'],
    ['sp500', 1, 1, 'S&P 500'], ['usdkrw', 2, -1, '달러/원'],
    ['us10y', 1, -1, '미 국채 10년'], ['vix', 1, -1, 'VIX'],
  ],
  kosdaq: [
    ['nasdaq', 3, 1, '나스닥 100'], ['sox', 2, 1, '미국 반도체'],
    ['usreal10y', 2, -1, '미 실질금리 10년'], ['vix', 2, -1, 'VIX'],
    ['usdkrw', 1, -1, '달러/원'], ['sp500', 1, 1, 'S&P 500'],
  ],
};
const STATUS_OK = new Set(['daily', 'delayed', 'live']);
const MAX_AGE_MS = 7 * 86400000;
const LABEL = { positive: '우호', negative: '부담', neutral: '중립' };
function valid(quote, now) {
  if (!quote || !STATUS_OK.has(quote.status) || quote.deploymentBackup) return false;
  if (typeof quote.value !== 'number' || !Number.isFinite(quote.value)) return false;
  if (typeof quote.change !== 'number' || !Number.isFinite(quote.change)) return false;
  const age = now - Date.parse(quote.observedAt);
  if (!Number.isFinite(age) || age < -5 * 60000 || age > MAX_AGE_MS) return false;
  return quote.changeUnit === (quote.group === 'rates' || quote.id === 'hyspread' ? 'bp' : '%');
}
function direction(quote, inverse = false) {
  const sign = Math.sign(quote.change) * (inverse ? -1 : 1);
  return sign > 0 ? 'positive' : sign < 0 ? 'negative' : 'neutral';
}
function describe(quote, label) {
  const move = quote.change > 0 ? '상승' : quote.change < 0 ? '하락' : '보합';
  return `${label} ${move} (${quote.change > 0 ? '+' : ''}${quote.change}${quote.changeUnit}; ${quote.observedAt.slice(0, 10)} 관측)`;
}
function marketImpact(name, factors, indexed, now) {
  const totalWeight = factors.reduce((sum, [, weight]) => sum + weight, 0);
  let validWeight = 0, score = 0;
  const drivers = [];
  for (const [id, weight, polarity, label] of factors) {
    const quote = indexed.get(id);
    if (!valid(quote, now)) continue;
    const stance = direction(quote, polarity < 0);
    validWeight += weight;
    score += weight * (stance === 'positive' ? 1 : stance === 'negative' ? -1 : 0);
    drivers.push({
      id, name: label, stance: LABEL[stance], weight,
      text: describe(quote, label), observedAt: quote.observedAt,
      source: quote.source || null, changeBasis: quote.changeBasis || null,
    });
  }
  const coverage = Number((validWeight / totalWeight).toFixed(2));
  const strength = validWeight ? score / validWeight : 0;
  const enough = drivers.length >= 3 && coverage >= 0.55;
  const state = !enough ? '판단 보류' : strength >= 0.3 ? '우호' : strength <= -0.3 ? '부담' : '혼재';
  return {
    name, state, coverage, available: drivers.length, total: factors.length, drivers,
    summary: state === '판단 보류'
      ? '최근 관측된 서로 다른 지표가 부족해 해외 환경 판단을 보류합니다.'
      : state === '혼재'
        ? '해외 지표의 신호가 엇갈립니다. 국내 수급·장중 가격 확인 전 방향 판단을 보류합니다.'
        : `해외 관측 지표 조합은 ${name}에 ${state === '우호' ? '상대적으로 우호적인' : '부담이 될 수 있는'} 환경입니다. 지수의 실제 등락을 예측하는 값은 아닙니다.`,
  };
}
function theme(indexed, id, title, positive, negative, now, inverse = false) {
  const quote = indexed.get(id);
  if (!valid(quote, now)) return { title, state: '판단 보류', reason: '관측 자료 부족' };
  const stance = direction(quote, inverse);
  return {
    title, state: LABEL[stance],
    reason: stance === 'positive' ? positive : stance === 'negative' ? negative : '보합으로 영향 판단 유보',
    evidence: describe(quote, quote.name || quote.id), source: quote.source || null,
  };
}
export function buildImpact(market, now = Date.now()) {
  const indexed = new Map((Array.isArray(market?.quotes) ? market.quotes : [])
    .filter(quote => quote && typeof quote.id === 'string').map(quote => [quote.id, quote]));
  const kospi = marketImpact('코스피', FACTORS.kospi, indexed, now);
  const kosdaq = marketImpact('코스닥', FACTORS.kosdaq, indexed, now);
  const rate = valid(indexed.get('usreal10y'), now) ? 'usreal10y' : 'us10y';
  const themes = [
    theme(indexed, 'sox', '반도체·수출주',
      '미국 반도체 강세는 국내 관련 업종의 외부 투자심리에 우호적일 수 있습니다.',
      '미국 반도체 약세는 국내 관련 업종의 외부 투자심리에 부담일 수 있습니다.', now),
    theme(indexed, rate, '성장주·할인율',
      '미국 금리 하락은 성장주 가치평가 부담을 완화할 가능성이 있습니다.',
      '미국 금리 상승은 성장주 가치평가 부담을 키울 가능성이 있습니다.', now, true),
    theme(indexed, 'usdkrw', '원화·외국인 수급 환경',
      '원화 강세 환경은 외국인 투자심리에 우호적일 수 있습니다. 실제 순매수 자료는 확인하지 않았습니다.',
      '원화 약세 환경은 외국인 투자심리에 부담일 수 있습니다. 실제 순매도 자료는 확인하지 않았습니다.', now, true),
    theme(indexed, 'wti', '에너지·원가',
      '유가 하락은 에너지 수입 비용에 우호적일 수 있으나 업종 영향은 기업별로 다릅니다.',
      '유가 상승은 에너지 수입 비용에 부담일 수 있으나 업종 영향은 기업별로 다릅니다.', now, true),
  ];
  const dated = [...kospi.drivers, ...kosdaq.drivers].map(d => d.observedAt.slice(0, 10));
  return {
    method: 'weighted_directional_checklist_v1', asOf: new Date(now).toISOString(),
    kospi, kosdaq, themes, mixedDates: new Set(dated).size > 1,
    cautions: [
      '국내 외국인 수급·거래대금·기업 실적을 수집하지 않은 조건부 해외 환경 점검입니다.',
      '일별 종가와 환율·금리의 관측일 및 비교 기준이 다르며, 지수 상승·하락 확률이 아닙니다.',
      '규칙 기반 가중치는 과거 성과로 보정된 예측모형이 아닙니다.',
    ],
  };
}
