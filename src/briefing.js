import { FUTURES_FRESHNESS_MS } from '../public/futures-config.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const INTERVAL = 4 * HOUR;
const KST_OFFSET = 9 * HOUR;
const INDICES = new Map([['kospi', '코스피'], ['kosdaq', '코스닥']]);
const FLOWS = new Map([
  ['kr_foreign_kospi', '코스피 외국인'], ['kr_foreign_kosdaq', '코스닥 외국인'],
  ['kr_pension_kospi', '코스피 연기금'], ['kr_pension_kosdaq', '코스닥 연기금'],
]);
const REFERENCES = new Map([
  ['usdkrw', '달러/원'], ['kr3y', '한국 국고채 3년'], ['kr10y', '한국 국고채 10년'],
]);
const FUTURES = new Map([['fut_nq', '나스닥100 연동 선물'], ['fut_es', 'S&P 500 연동 선물']]);
const METRICS = new Map([...INDICES, ...FLOWS, ...REFERENCES, ...FUTURES]);
const flowFormatter = new Intl.NumberFormat('ko-KR', {maximumFractionDigits:0});

const kstDay = time => new Date(time + KST_OFFSET).toISOString().slice(0, 10);
const daily = quote => quote.status === 'daily';
const marketDay = quote => daily(quote) ? quote.observedAt.slice(0, 10) : kstDay(Date.parse(quote.observedAt));
const hasChange = (quote, unit = '%') => Number.isFinite(quote?.change) && quote.changeUnit === unit;
const direction = change => change >= 0.2 ? 1 : change <= -0.2 ? -1 : 0;
const movement = dir => dir > 0 ? '상승' : dir < 0 ? '하락' : '보합권';

export function briefingWindow(now) {
  const start = Math.floor((now + KST_OFFSET) / INTERVAL) * INTERVAL - KST_OFFSET;
  return {windowStart:new Date(start).toISOString(), nextUpdateAt:new Date(start + INTERVAL).toISOString()};
}

export function koreaBriefingQuotes(quotes) {
  return quotes.filter(quote => METRICS.has(quote.id)).map(quote => ({
    id:quote.id, value:quote.value, unit:quote.unit, change:quote.change, changeUnit:quote.changeUnit,
    status:quote.status, observedAt:quote.observedAt, timestampPrecision:quote.timestampPrecision,
    comparisonAt:quote.comparisonAt, deploymentBackup:quote.deploymentBackup, savedFrom:quote.savedFrom,
  }));
}

function validObservation(quote, now) {
  const age = now - Date.parse(quote.observedAt);
  if (!Number.isFinite(quote.value) || quote.deploymentBackup || quote.savedFrom || !(age >= -5000)) return false;
  if (FUTURES.has(quote.id)) return quote.status === 'live' && age <= FUTURES_FRESHNESS_MS && hasChange(quote);
  if (daily(quote)) return age <= 7 * DAY && marketDay(quote) <= kstDay(now);
  return ['delayed', 'live'].includes(quote.status) && age <= 10 * 60_000 && marketDay(quote) === kstDay(now);
}

function describeIndices(indices) {
  if (!indices.length) return {title:'한국 증시 동향 확인 중', gap:'', direction:0};
  const [first, second] = indices;
  const primary = direction(first.change);
  if (!second) return {title:`${first.name} ${movement(primary)}`, gap:'', direction:primary};
  const secondary = direction(second.change);
  const spread = first.change - second.change;
  const leading = spread > 0 ? first : second;
  const lagging = spread > 0 ? second : first;
  const title = primary === secondary
    ? `코스피·코스닥 ${primary ? '동반 ' : ''}${movement(primary)}`
    : `코스피 ${movement(primary)} · 코스닥 ${movement(secondary)}`;
  let gap = '';
  if (primary === secondary && Math.abs(spread) >= 0.75) {
    if (primary < 0) gap = `${lagging.name} 낙폭이 더 큽니다.`;
    if (primary > 0) gap = `${leading.name} 상승폭이 더 큽니다.`;
  }
  return {title, gap, direction:primary === secondary ? primary : 0, lagging:Math.abs(spread) >= 0.75 ? lagging : null};
}

function describeFlows(flows, lagging) {
  const active = flows.filter(quote => Math.abs(quote.value) >= (quote.id.endsWith('kospi') ? 100 : 50))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const flow = active.find(quote => quote.id === `kr_foreign_${lagging?.id}`)
    || active.find(quote => quote.id.startsWith('kr_foreign_')) || active[0];
  if (!flow) return null;
  const [, investor, market] = flow.id.split('_');
  const index = INDICES.get(market);
  const actor = investor === 'foreign' ? '외국인' : '연기금';
  const action = flow.value < 0 ? '순매도' : '순매수';
  const amount = flowFormatter.format(Math.abs(flow.value));
  const other = active.find(quote => quote.id.endsWith(market) && quote.id !== flow.id && Math.sign(quote.value) !== Math.sign(flow.value));
  const counter = other ? `${investor === 'foreign' ? '연기금' : '외국인'}은 같은 시장에서 ${flowFormatter.format(Math.abs(other.value))}억원 ${other.value < 0 ? '순매도' : '순매수'}했습니다.` : '';
  return {summary:`${actor}은 ${index}에서 ${amount}억원 ${action}했습니다.`, counter, actor, index, action, direction:Math.sign(flow.value)};
}

function describeExternal(futures, references, marketDirection) {
  const [nasdaq, sp] = futures.filter(item => direction(item.change));
  if (nasdaq && sp && nasdaq.comparisonAt && nasdaq.comparisonAt === sp.comparisonAt) {
    const dir = direction(nasdaq.change);
    if (dir !== direction(sp.change)) {
      return {summary:`미국 선물은 나스닥100 ${movement(dir)}·S&P 500 ${movement(-dir)}으로 엇갈립니다.`, watch:'미국 두 지수선물의 방향이 바뀌는지 보세요.'};
    }
    const reading = marketDirection && marketDirection !== dir ? '한국 증시와 반대로 ' : '';
    return {summary:`미국 지수선물은 ${reading}동반 ${movement(dir)} 중입니다.`,
      watch:`${dir > 0 ? '미국 선물 강세' : '미국 선물 약세'}가 이어지는지 보세요.`};
  }
  if (nasdaq) {
    const move = movement(direction(nasdaq.change));
    return {summary:`${nasdaq.name}은 ${move} 중입니다.`, watch:`${nasdaq.name} ${move}세가 이어지는지 보세요.`};
  }
  const fx = references.find(quote => quote.id === 'usdkrw');
  if (hasChange(fx) && Math.abs(fx.change) >= 0.3) {
    const weak = fx.change > 0;
    return {summary:`최근 기준환율은 달러당 ${flowFormatter.format(fx.value)}원으로 원화가 ${weak ? '약세' : '강세'}를 보였습니다.`,
      watch:`원화 ${weak ? '약세' : '강세'}가 이어지는지 보세요.`};
  }
  const yieldQuote = references.find(quote => quote.id === 'kr10y');
  if (hasChange(yieldQuote, 'bp') && Math.abs(yieldQuote.change) >= 3) {
    const move = yieldQuote.change > 0 ? '상승' : '하락';
    return {summary:`한국 10년물 국고채 금리는 최근 ${Math.abs(yieldQuote.change).toFixed(1)}bp ${move}했습니다.`,
      watch:`국고채 금리 ${move}세가 이어지는지 보세요.`};
  }
  return {summary:'', watch:''};
}

export function buildKoreaBriefing(quotes, now) {
  const valid = new Map(quotes.filter(quote => METRICS.has(quote.id) && validObservation(quote, now))
    .map(quote => [quote.id, quote]));
  const items = [...METRICS].flatMap(([id, name]) => valid.has(id) ? [{...valid.get(id), name}] : []);
  const indices = items.filter(item => INDICES.has(item.id) && hasChange(item));
  const anchor = indices.toSorted((a, b) => marketDay(b).localeCompare(marketDay(a)) || Number(daily(a)) - Number(daily(b)))[0];
  const referenceDay = anchor ? marketDay(anchor) : null;
  const sameSession = quote => anchor && marketDay(quote) === referenceDay && daily(quote) === daily(anchor);
  const current = indices.filter(sameSession);
  const flows = items.filter(item => FLOWS.has(item.id) && item.unit === '억원' && sameSession(item));
  const references = items.filter(item => REFERENCES.has(item.id) && now - Date.parse(item.observedAt) <= 4 * DAY);
  const futures = items.filter(item => FUTURES.has(item.id));
  const missing = [...INDICES].filter(([id]) => !current.some(quote => quote.id === id)).map(([, name]) => name);

  const session = anchor
    ? `${Number(referenceDay.slice(5, 7))}월 ${Number(referenceDay.slice(8))}일 ${daily(anchor) ? '종가' : '장중'}`
    : '';
  const moves = current.map(item => `${item.name} ${item.change > 0 ? '+' : ''}${item.change.toFixed(2)}%`);
  const headline = session ? [session, ...moves].join(' · ') : '한국 증시 · 코스피·코스닥 시세 확인 중';
  const domestic = describeIndices(current);
  const flow = describeFlows(flows, domestic.lagging);
  const previousSession = Boolean(referenceDay && referenceDay !== kstDay(now));
  const external = describeExternal(futures, references, previousSession ? 0 : domestic.direction);
  const summary = [flow?.summary || domestic.gap, external.summary || flow?.counter].filter(Boolean).join(' ')
    || (moves.length ? moves.join(' · ') : '코스피·코스닥 시세와 수급을 기다리고 있습니다.');
  let watch = external.watch;
  if (flow) {
    const nextSession = daily(anchor) ? '다음 장에서 ' : '';
    watch = `${nextSession}${flow.index} ${flow.actor} ${flow.action}가 ${flow.direction < 0 ? '줄어드는지' : '이어지는지'} 보세요.`;
  } else if (!watch && domestic.gap) {
    watch = '코스피와 코스닥의 등락률 차이가 좁혀지는지 보세요.';
  }
  const points = [flow && domestic.gap, external.summary && flow?.counter].filter(Boolean);
  return {...briefingWindow(now), generatedAt:new Date(now).toISOString(), headline, session,
    previousSession,
    insight:{title:domestic.title, summary, watch},
    items:[...current, ...flows, ...references, ...futures], missing, points};
}
