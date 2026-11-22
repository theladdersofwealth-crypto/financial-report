import { buildImpact } from './impact.js';

// Retrospective rule sanity check, not out-of-sample validation.
// A Korean session D only uses foreign observations strictly older than D;
// the matching Korean close is used solely as the observed outcome.
const FACTOR_IDS = ['sox','nasdaq','sp500','usdkrw','us10y','usreal10y','vix'];
const RATE_IDS = new Set(['us10y','usreal10y']);
const MS_DAY = 86400000;
const MIN_CLASSIFIED = 20;

function historyRows(quote) {
  return (Array.isArray(quote?.history) ? quote.history : [])
    .filter(row => row && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
      && Number.isFinite(row.value) && row.date === new Date(`${row.date}T00:00:00Z`).toISOString().slice(0,10))
    .map(row => ({date:row.date,value:row.value}))
    .sort((a,b) => a.date.localeCompare(b.date));
}

function foreignAt(quote, target) {
  if (!quote || !FACTOR_IDS.includes(quote.id)) return null;
  const history = historyRows(quote).filter(row => row.date < target);
  if (history.length < 2) return null;
  const last = history.at(-1), prior = history.at(-2);
  const end = Date.parse(`${target}T00:00:00Z`);
  const lastAge = end - Date.parse(`${last.date}T00:00:00Z`);
  const priorAge = end - Date.parse(`${prior.date}T00:00:00Z`);
  if (!(lastAge > 0 && lastAge <= 7 * MS_DAY && priorAge > lastAge && priorAge <= 14 * MS_DAY)) return null;
  if (!RATE_IDS.has(quote.id) && prior.value === 0) return null;
  const change = RATE_IDS.has(quote.id)
    ? (last.value-prior.value)*100 : (last.value-prior.value)/prior.value*100;
  if (!Number.isFinite(change)) return null;
  return {
    id:quote.id, group:quote.group, value:last.value, change,
    changeUnit:RATE_IDS.has(quote.id)?'bp':'%', status:'daily',
    observedAt:last.date, source:quote.source,
    changeBasis:'직전 유효 관측일 대비(사후 검증 재구성)',
  };
}

function evaluateIndex(index, quotes) {
  const target = quotes.find(q=>q.id===index);
  const history = historyRows(target);
  const rows = [];
  for (let i=1; i<history.length; i++) {
    const today=history[i], yesterday=history[i-1];
    if (!(yesterday.value>0 && today.value>0)) continue;
    const foreign = quotes.map(q=>foreignAt(q,today.date)).filter(Boolean);
    const impact=buildImpact({quotes:foreign},Date.parse(`${today.date}T00:00:00Z`));
    const prediction=impact[index].state;
    if (prediction!=='우호' && prediction!=='부담') continue;
    const actual=Math.sign(today.value-yesterday.value);
    if (!actual) continue;
    rows.push({day:today.date, match:(prediction==='우호'?1:-1)===actual, actual});
  }
  const evaluated = rows.length, matches = rows.filter(x=>x.match).length;
  return {
    index, indexTradingDays:Math.max(0,history.length-1),
    classifiedDays:evaluated, evaluatedDays:evaluated,
    agreementRate:evaluated>=MIN_CLASSIFIED?Number((matches/evaluated*100).toFixed(1)):null,
    baselineUpRate:evaluated>=MIN_CLASSIFIED?Number((rows.filter(x=>x.actual>0).length/evaluated*100).toFixed(1)):null,
    from:rows[0]?.day || null, until:rows.at(-1)?.day || null,
    status:evaluated>=MIN_CLASSIFIED?'exploratory':'insufficient_sample',
  };
}

export function validateHistoricalImpact(market) {
  const quotes=Array.isArray(market?.quotes)?market.quotes:[];
  return {
    method:'retrospective_prior_date_check_v1',
    minimumClassifiedDays:MIN_CLASSIFIED,
    kospi:evaluateIndex('kospi',quotes),
    kosdaq:evaluateIndex('kosdaq',quotes),
    limitations:[
      '같은 날짜의 해외 종가는 사용하지 않고 한국 거래일보다 이전 관측일 자료만 이용합니다.',
      '현재 조회한 사후 수정 가능 시계열을 사용하므로 데이터 공표 지연·수정 이력을 검증한 실제 워크포워드 성과는 아닙니다.',
      '우호·부담 상태일 때만 종가 방향 일치율을 계산하며 혼재·판단 보류와 등락 없는 날은 제외합니다.',
      '일치율은 투자 수익률, 확률 예측이나 미래 적중률을 의미하지 않습니다.',
    ],
  };
}
