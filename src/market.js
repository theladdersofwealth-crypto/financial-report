/**
 * Server-only market feeds. No demo prices, inferred prices, or fabricated news.
 * Observation dates describe the source; asOf describes when this desk fetched it.
 * A public endpoint does not grant redistribution rights: check the source terms
 * before opening the desk beyond the intended private audience.
 */
import deploymentSnapshot from './market-deploy-snapshot.js';
import {fxCurrencies, featuredFxCodes} from '../public/fx-currencies.js';
import { buildImpact } from './impact.js';
import { validateHistoricalImpact } from './validation.js';
import { collectKis, collectKisOverseas, collectKisMacro, kisConfigured } from './kis.js';
import { latestUsSession, matchesUsClose, US_CASH_INDEXES } from './us-session.js';

const TTL = 5 * 60 * 1000;
const TIMEOUT = 4000;
const PROVIDER_CONCURRENCY = 4;
const FREE_PLAN_PROVIDER_REQUESTS = 48;
const HOSTS = new Set([
  'fred.stlouisfed.org', 'api.stlouisfed.org', 'home.treasury.gov',
  'api.frankfurter.dev', 'data-api.binance.vision', 'api.binance.com',
  'www.bitstamp.net', 'api.coinbase.com', 'finnhub.io',
  'www.bls.gov', 'www.federalreserve.gov', 'ecos.bok.or.kr',
  'api.gold-api.com', 'api.nasdaq.com',
]);
const snapshots = new Map();
const pending = new Map();
const lastGoodQuotes = new Map();
const configHashes = new Map();

const NASDAQ_INDEXES = {nasdaq: 'NDX', nasdaqcom: 'COMP', sox: 'SOX'};
const DAY_MS = 86400000;

const orderedCurrencies = [...featuredFxCodes.map(code => fxCurrencies.find(currency => currency.code === code)),
  ...fxCurrencies.filter(currency => !featuredFxCodes.includes(currency.code))];

const INSTRUMENTS = [
  { id: 'sp500', name: 'S&P 500', group: 'equity', unit: 'pt', fred: 'SP500', origin: 'S&P Dow Jones Indices', basis: '미국 정규장 종가' },
  { id: 'nasdaq', name: '나스닥 100', group: 'equity', unit: 'pt', fred: 'NASDAQ100', origin: 'Nasdaq', basis: '미국 정규장 종가' },
  { id: 'sox', name: '필라델피아 반도체', group: 'equity', unit: 'pt', fred: 'NASDAQSOX', origin: 'Nasdaq', basis: '미국 정규장 종가' },
  { id: 'nasdaqcom', name: '나스닥 종합', group: 'equity', unit: 'pt', fred: 'NASDAQCOM', origin: 'Nasdaq', basis: '미국 정규장 종가' },
  { id: 'us2y', name: '미 국채 2년', group: 'rates', unit: '%', fred: 'DGS2', origin: 'Federal Reserve H.15', basis: '일별 고정만기 수익률' },
  { id: 'us10y', name: '미 국채 10년', group: 'rates', unit: '%', fred: 'DGS10', origin: 'Federal Reserve H.15', basis: '일별 고정만기 수익률' },
  { id: 'usreal10y', name: '미 실질금리 10년', group: 'rates', unit: '%', fred: 'DFII10', origin: 'Federal Reserve H.15', basis: '일별 물가연동채 고정만기 수익률' },
  { id: 'dxy', name: '달러인덱스 DXY', group: 'risk', unit: 'pt', required: 'ICE DXY 시세 공급자 연결 필요' },
  { id: 'broadusd', name: '연준 광의달러지수', group: 'risk', unit: 'pt', fred: 'DTWEXBGS', origin: 'Federal Reserve', basis: '일별 무역가중 광의달러지수 · ICE DXY와 다른 지수' },
  { id: 'wti', name: 'WTI 현물', group: 'energy', unit: 'USD/bbl', fred: 'DCOILWTICO', origin: 'U.S. EIA', basis: '쿠싱 현물 일별 가격 · 선물 아님' },
  { id: 'brent', name: '브렌트 현물', group: 'energy', unit: 'USD/bbl', fred: 'DCOILBRENTEU', origin: 'U.S. EIA', basis: '유럽 브렌트 현물 일별 가격 · 선물 아님' },
  { id: 'gold', name: '금 현물', group: 'metals', unit: 'USD/oz', metalSpot: 'XAU', basis: '금 1트로이온스당 USD 참고 현물가격 · 거래소 결제가격 아님' },
  { id: 'silver', name: '은 현물', group: 'metals', unit: 'USD/oz', metalSpot: 'XAG', basis: '은 1트로이온스당 USD 참고 현물가격 · 거래소 결제가격 아님' },
  { id: 'copper', name: '구리 참고 현물', group: 'metals', unit: 'USD/lb', metalSpot: 'HG', basis: '구리 1파운드당 USD 참고 가격 · COMEX 선물 또는 LME 공식 가격과 다름' },
  { id: 'nickel', name: '니켈 (월간 평균)', group: 'metals', unit: 'USD/t', fred: 'PNICKUSDM', monthly: true, origin: 'IMF Primary Commodity Prices', basis: 'IMF 세계 니켈 월간 평균 가격(USD/톤) · 실시간 시세가 아님' },
  { id: 'vix', name: 'VIX 기대변동성', group: 'risk', unit: 'pt', fred: 'VIXCLS', origin: 'Cboe', basis: '일별 종가 · SPX 옵션 기반 30일 기대변동성의 연율화 수치' },
  { id: 'hyspread', name: '미 하이일드 스프레드', group: 'risk', unit: '%', fred: 'BAMLH0A0HYM2', origin: 'ICE Data Indices', basis: '일별 옵션조정 신용스프레드' },
  { id: 'btc', name: '비트코인', group: 'crypto', unit: 'USD', crypto: 'BTC', basis: '거래소 BTC/USD 현물' },
  { id: 'eth', name: '이더리움', group: 'crypto', unit: 'USD', crypto: 'ETH', basis: '거래소 ETH/USD 현물' },
  { id: 'sol', name: '솔라나', group: 'crypto', unit: 'USD', crypto: 'SOL', basis: '거래소 SOL/USD 현물' },
  { id: 'kospi', name: '코스피', group: 'korea', unit: 'pt', ecos: '0001000', ecosTable: '802Y001', required: '한국은행 ECOS API 인증키 연결 필요', basis: '한국거래소 작성 · 한국은행 ECOS 주식시장(일) · 일별 종가' },
  { id: 'kosdaq', name: '코스닥', group: 'korea', unit: 'pt', ecos: '0089000', ecosTable: '802Y001', required: '한국은행 ECOS API 인증키 연결 필요', basis: '한국거래소 작성 · 한국은행 ECOS 주식시장(일) · 일별 종가' },
  { id: 'kr_foreign_kospi', name: '외국인 순매수 (코스피)', group: 'korea', unit: '억원', flow: true, ecos: '0030000', ecosTable: '802Y001', required: '한국투자증권 KIS 또는 ECOS 인증키 연결 필요', basis: '유가증권시장 외국인 당일 순매수금액 · 일별, 단위 억원' },
  { id: 'kr_foreign_kosdaq', name: '외국인 순매수 (코스닥)', group: 'korea', unit: '억원', flow: true, required: '한국투자증권 KIS API 인증키 연결 필요', basis: '코스닥시장 외국인 당일 순매수금액 · 일별, 단위 억원' },
  { id: 'kr_pension_kospi', name: '연기금 등 순매수 (코스피)', group: 'korea', unit: '억원', flow: true, required: '한국투자증권 KIS 기금 거래대금 필요', basis: '코스피시장 기금 순매수 거래대금 · 억원 · 국민연금 단독 아님' },
  { id: 'kr_pension_kosdaq', name: '연기금 등 순매수 (코스닥)', group: 'korea', unit: '억원', flow: true, required: '한국투자증권 KIS 기금 거래대금 필요', basis: '코스닥시장 기금 순매수 거래대금 · 억원 · 국민연금 단독 아님' },
  { id: 'kr3y', name: '한국 국채 3년', group: 'korea', unit: '%', ecos: '010200000', required: 'ECOS_API_KEY 연결 필요', basis: '한국은행 ECOS 시장금리(일별) · 국고채 3년' },
  { id: 'kr10y', name: '한국 국채 10년', group: 'korea', unit: '%', ecos: '010210000', required: 'ECOS_API_KEY 연결 필요', basis: '한국은행 ECOS 시장금리(일별) · 국고채 10년' },
  ...orderedCurrencies.map(({id, name, code, amount}) => ({
    id, name, group: 'fx', unit: '원', fx: code, fxAmount: amount,
    basis: `${amount.toLocaleString('ko-KR')} ${code}당 원화 · 일별 기준환율`,
  })),
];

const SECTORS = [
  ['XLK', '기술'], ['XLF', '금융'], ['XLE', '에너지'], ['XLV', '헬스케어'],
  ['XLY', '경기소비재'], ['XLP', '필수소비재'], ['XLI', '산업재'],
  ['XLB', '소재'], ['XLU', '유틸리티'], ['XLRE', '부동산'], ['XLC', '통신서비스'],
];
const LEADERS = [
  ['NVDA', '엔비디아'], ['AAPL', '애플'], ['MSFT', '마이크로소프트'],
  ['AMZN', '아마존'], ['GOOGL', '알파벳'], ['META', '메타'], ['TSLA', '테슬라'],
];

const isoDay = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const numeric = (value) => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const rounded = (value) => Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null;
const daysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const pct = (last, previous) => previous !== 0 ? rounded((last - previous) / previous * 100) : null;

export function createMarketReader(fetchProvider = fetch) {
  const failures = new Map();
  const queue = [];
  let active = 0;

  function pump() {
    while (active < PROVIDER_CONCURRENCY && queue.length) {
      const { url, format, headers, resolve, reject } = queue.shift();
      active++;
      readProvider(url, format, headers, failures, fetchProvider).then(resolve, reject).finally(() => {
        active--;
        pump();
      });
    }
  }

  return {
    failures,
    readURL(url, format = 'json', headers = {}) {
      return new Promise((resolve, reject) => {
        queue.push({ url, format, headers, resolve, reject });
        pump();
      });
    },
  };
}

async function readProvider(url, format, headers, failures, fetchProvider) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !HOSTS.has(parsed.hostname)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  function recordOutcome(reason) {
    const key = `${parsed.hostname} ${reason}`;
    failures.set(key, (failures.get(key) || 0) + 1);
  }
  function failed(reason) {
    recordOutcome(reason);
    return null;
  }
  try {
    const response = await fetchProvider(parsed.toString(), {
      method: 'GET', redirect: 'manual', signal: controller.signal,
      headers: { Accept: format === 'json' ? 'application/json' : 'text/csv,application/xml,text/plain', ...headers },
    });
    if (!response.ok || Number(response.headers.get('content-length')) > 2000000) {
      await response.body?.cancel().catch(() => {});
      return failed(response.ok ? 'response_too_large' : `HTTP_${response.status}`);
    }
    const text = await response.text();
    if (text.length > 2000000) return failed('response_too_large');
    let data = text;
    if (format === 'json') {
      try { data = JSON.parse(text); }
      catch { return failed('invalid_json'); }
    }
    recordOutcome('response_received');
    return { data, retrievedAt: new Date().toISOString() };
  } catch (error) {
    if (controller.signal.aborted) return failed('timeout');
    // Classify locally; never include the exception, request URL, or raw body.
    const detail = `${error?.cause?.code || ''} ${error?.message || ''}`;
    if (error?.code === 'MARKET_REQUEST_BUDGET') return failed('request_budget');
    if (/I\/O on behalf of a different request|outside of a request context/i.test(detail)) return failed('request_context');
    if (/ENOTFOUND|EAI_AGAIN|DNS|resolve (host|hostname)/i.test(detail)) return failed('dns_error');
    if (/TLS|SSL|certificate/i.test(detail)) return failed('tls_error');
    if (/egress|outbound|not allowed|blocked|forbidden|denied/i.test(detail)) return failed('outbound_denied');
    if (/ECONNRESET|ECONNREFUSED|network connection lost|connection reset|connection refused/i.test(detail)) return failed('connection_lost');
    return failed('fetch_error');
  } finally {
    clearTimeout(timer);
  }
}

function missing(instrument, reason = instrument.required || '공급자 응답을 확인할 수 없습니다') {
  return {
    id: instrument.id, name: instrument.name, group: instrument.group, value: null,
    ...(instrument.fx ? {fxCurrency: instrument.fx, fxAmount: instrument.fxAmount} : {}),
    unit: instrument.unit, change: null, changeUnit: instrument.flow ? '억원' : instrument.group === 'rates' || instrument.id === 'hyspread' || (instrument.ecos && !instrument.ecosTable) ? 'bp' : '%',
    provider: instrument.fred ? 'fred' : instrument.metalSpot ? 'goldapi' : instrument.ecos ? 'ecos' : instrument.fx ? 'frankfurter' : instrument.crypto ? 'binance' : instrument.provider || null,
    source: instrument.fred ? `${instrument.origin} / FRED` : instrument.metalSpot ? 'Gold API' : instrument.ecos ? '한국은행 ECOS' : instrument.fx ? 'Frankfurter' : instrument.crypto ? 'Bitstamp' : '미연결',
    sourceUrl: instrument.fred ? `https://fred.stlouisfed.org/series/${instrument.fred}` : instrument.metalSpot ? 'https://gold-api.com/docs' : instrument.ecos ? 'https://ecos.bok.or.kr/' : instrument.fx ? 'https://frankfurter.dev/' : null,
    observedAt: null, retrievedAt: null, status: 'missing', reason,
    basis: instrument.basis || '', history: [],
  };
}

function fromHistory(instrument, entries, metadata) {
  const today = daysAgo(0);
  const history = entries.filter((entry) => isoDay(entry.date) && numeric(entry.value) !== null && entry.date <= today)
    .map((entry) => ({ date: entry.date, value: Number(entry.value) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!history.length) return missing(instrument, '유효한 최신 관측값이 없습니다');
  const last = history.at(-1);
  const previous = history.at(-2);
  const isRate = instrument.group === 'rates' || instrument.id === 'hyspread' || Boolean(instrument.ecos && !instrument.ecosTable);
  const change = previous ? (instrument.flow ? rounded(last.value - previous.value) : isRate ? rounded((last.value - previous.value) * 100) : pct(last.value, previous.value)) : null;
  const monthlyEnd = Date.UTC(Number(last.date.slice(0, 4)), Number(last.date.slice(5, 7)), 0, 23, 59, 59);
  const stale = instrument.monthly ? Date.now() - monthlyEnd > 100 * 86400000
    : Date.now() - Date.parse(`${last.date}T23:59:59Z`) > 7 * 86400000;
  return {
    ...missing(instrument), ...metadata, value: last.value, change,
    changeUnit: instrument.flow ? '억원' : isRate ? 'bp' : '%', observedAt: last.date, timestampPrecision: instrument.monthly ? 'month' : 'day',
    comparisonAt: previous?.date || null, changeBasis: instrument.flow ? '직전 관측일 순매수금액 대비 증감(당일 순매수액 자체와 다름)' : '직전 유효 관측일 대비',
    status: stale ? 'stale' : instrument.monthly ? 'monthly' : 'daily',
    reason: stale ? (instrument.monthly ? '월간 기준일이 오래되었습니다' : '관측일이 7일 이상 지났습니다') : null,
    history: history.slice(instrument.fx ? -95 : -65),
    delay: metadata.delay || (instrument.monthly ? '월간 평균값 · 실시간 시세 아님 · 발표 시차 존재' : '일별 자료 · 장중 실시간 시세 아님'),
  };
}

async function fredQuote(instrument, env, readURL) {
  const start = daysAgo(instrument.monthly ? 460 : 100);
  const metadata = {provider: 'fred', source: `${instrument.origin} / FRED`,
    sourceUrl: `https://fred.stlouisfed.org/series/${instrument.fred}`};
  let apiQuote;
  if (env.FRED_API_KEY) {
    const query = new URLSearchParams({series_id: instrument.fred, api_key: env.FRED_API_KEY,
      file_type: 'json', observation_start: start, sort_order: 'asc'});
    const result = await readURL(`https://api.stlouisfed.org/fred/series/observations?${query}`);
    if (Array.isArray(result?.data?.observations)) {
      apiQuote = fromHistory(instrument, result.data.observations, {...metadata, retrievedAt: result.retrievedAt});
      if (isFreshQuote(apiQuote)) return apiQuote;
    }
  }
  const csv = await readURL(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${instrument.fred}&cosd=${start}`, 'text');
  const rows = csv?.data?.trim().split(/\r?\n/);
  const header = rows?.[0]?.replace(/^\uFEFF/, '');
  if (header === `observation_date,${instrument.fred}` || header === `DATE,${instrument.fred}`) {
    const entries = rows.slice(1).map(line => {
      const [date, value] = line.split(',');
      return {date, value};
    });
    const quote = fromHistory(instrument, entries, {...metadata, retrievedAt: csv.retrievedAt});
    if (quote.observedAt && (!apiQuote?.observedAt || quote.observedAt >= apiQuote.observedAt)) return quote;
  }
  return apiQuote?.observedAt ? apiQuote : missing(instrument, 'FRED 공개·인증 경로에서 유효한 자료를 받지 못했습니다');
}

const NASDAQ_MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

async function nasdaqClosingQuote(instrument, symbol, session, readURL, history = [], assetclass = 'index') {
  const result = await readURL(`https://api.nasdaq.com/api/quote/${symbol}/info?assetclass=${assetclass}`);
  const data = result?.data?.data;
  if (data?.symbol !== symbol) return null;
  const afterHours = assetclass === 'stocks' && data.marketStatus === 'After-Hours';
  if (!afterHours && data.marketStatus !== 'Closed') return null;
  const close = afterHours ? data.secondaryData : data.primaryData;
  const [year, month, day] = session.date.split('-').map(Number);
  const dateLabel = `${NASDAQ_MONTHS[month - 1]} ${day}, ${year}`;
  if (assetclass === 'index' ? close?.lastTradeTimestamp !== dateLabel
    : !close?.lastTradeTimestamp?.startsWith(`Closed at ${dateLabel} `)) return null;
  const value = numeric(String(close.lastSalePrice ?? '').replace(/[$,]/g, ''));
  const change = typeof close.percentageChange === 'string' && close.percentageChange.endsWith('%')
    ? numeric(close.percentageChange.slice(0, -1)) : null;
  if (value === null || value <= 0 || change === null) return null;
  return {
    ...missing(instrument), value, change, observedAt: session.date, comparisonAt: session.previous,
    provider: 'nasdaq', source: 'Nasdaq 공식 정규장 종가',
    sourceUrl: `https://www.nasdaq.com/market-activity/${assetclass}/${symbol.toLowerCase()}`,
    changeBasis: '직전 정규장 종가 대비', retrievedAt: result.retrievedAt,
    timestampPrecision: 'day', status: 'daily', reason: null,
    delay: '미국 정규장 종가', history: [...history.filter(row => row.date < session.date), {date: session.date, value}].slice(-65),
  };
}

async function nasdaqIndexFallback(quotes, session, readURL) {
  const needed = quotes.filter(quote => Object.hasOwn(NASDAQ_INDEXES, quote.id) && !matchesUsClose(quote, session));
  const answers = await Promise.all(needed.map(async quote => {
    const symbol = NASDAQ_INDEXES[quote.id];
    const instrument = INSTRUMENTS.find(item => item.id === quote.id);
    const latest = await nasdaqClosingQuote(instrument, symbol, session, readURL, quote.history);
    if (latest) return latest;
    const query = new URLSearchParams({assetclass: 'index', fromdate: daysAgo(100), limit: '100'});
    const result = await readURL(`https://api.nasdaq.com/api/quote/${symbol}/historical?${query}`);
    const data = result?.data?.data;
    if (data?.symbol !== symbol || !Array.isArray(data.tradesTable?.rows)) return null;
    const rows = data.tradesTable.rows.map(row => {
      const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(row?.date);
      const price = typeof row?.close === 'string' ? row.close.replaceAll(',', '') : row?.close;
      return match ? {date: `${match[3]}-${match[1]}-${match[2]}`, value: price} : null;
    }).filter(row => row && numeric(row.value) > 0);
    const official = fromHistory(instrument, rows, {
      provider: 'nasdaq', source: 'Nasdaq 공식 일별 종가',
      sourceUrl: `https://www.nasdaq.com/market-activity/index/${symbol.toLowerCase()}/historical`,
      retrievedAt: result.retrievedAt, basis: 'Nasdaq 공식 지수 정규장 종가 · FRED 대체',
    });
    return !isFreshQuote(quote) || official.observedAt > quote.observedAt || matchesUsClose(official, session) ? official : null;
  }));
  return answers.filter(isFreshQuote);
}

async function treasuryFallback(quotes, readURL) {
  const needed = quotes.filter((quote) => ['us2y', 'us10y', 'usreal10y'].includes(quote.id) && !isFreshQuote(quote));
  if (!needed.length) return [];
  const year = new Date().getUTCFullYear();
  const kinds = [...new Set(needed.map((quote) => quote.id === 'usreal10y' ? 'daily_treasury_real_yield_curve' : 'daily_treasury_yield_curve'))];
  const results = await Promise.all(kinds.map(async (kind) => {
    const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=${kind}&field_tdr_date_value=${year}`;
    const result = await readURL(url, 'text');
    if (!result) return [];
    const rows = [...result.data.matchAll(/<m:properties>([\s\S]*?)<\/m:properties>/g)].map((match) => match[1]);
    return needed.filter((quote) => (quote.id === 'usreal10y') === (kind === 'daily_treasury_real_yield_curve')).map((quote) => {
      const field = quote.id === 'us2y' ? 'BC_2YEAR' : quote.id === 'us10y' ? 'BC_10YEAR' : 'TC_10YEAR';
      const entries = rows.map((row) => ({
        date: row.match(/<d:NEW_DATE[^>]*>([^<]+)/)?.[1]?.slice(0, 10),
        value: row.match(new RegExp(`<d:${field}[^>]*>([^<]+)`))?.[1],
      }));
      const instrument = INSTRUMENTS.find((item) => item.id === quote.id);
      return fromHistory(instrument, entries, {
        provider: 'treasury', source: 'U.S. Treasury', sourceUrl: 'https://home.treasury.gov/policy-issues/financing-the-government/interest-rate-statistics/',
        retrievedAt: result.retrievedAt, basis: '미 재무부 일별 수익률 곡선 · 장중 호가 아님',
      });
    });
  }));
  return results.flat().filter((quote) => quote.value !== null);
}

async function ecosQuote(instrument, env, readURL, publicAccess = false) {
  const token = publicAccess ? 'sample' : env.ECOS_API_KEY;
  if (!publicAccess && (typeof token !== 'string' || !/^[A-Za-z0-9]{8,128}$/.test(token))) {
    return missing(instrument, '한국은행 ECOS 인증키가 연결되지 않았습니다');
  }
  const ymd = (date) => date.replace(/-/g, '');
  const from = ymd(daysAgo(publicAccess ? 12 : 100)), until = ymd(daysAgo(0));
  const limit = publicAccess ? 10 : 100;
  // ECOS requires the API key in the path; never log the URL or response body.
  const table = instrument.ecosTable || '817Y002';
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${token}/json/kr/1/${limit}/${table}/D/${from}/${until}/${instrument.ecos}`;
  const result = await readURL(url);
  const entries = result?.data?.StatisticSearch?.row;
  if (!Array.isArray(entries)) return missing(instrument, '한국은행 ECOS 응답 또는 이용권한을 확인할 수 없습니다');
  const history = entries.filter(row => row?.STAT_CODE === table && row?.ITEM_CODE1 === instrument.ecos && /^\d{8}$/.test(String(row?.TIME || '')))
    .map(row => ({ date: `${row.TIME.slice(0, 4)}-${row.TIME.slice(4, 6)}-${row.TIME.slice(6, 8)}`, value: row.DATA_VALUE }));
  return fromHistory(instrument, history, {
    provider: 'ecos', source: instrument.ecosTable ? '한국은행 ECOS / 한국거래소' : '한국은행 ECOS',
    sourceUrl: 'https://ecos.bok.or.kr/', retrievedAt: result.retrievedAt,
  });
}

async function publicEcosFallback(quotes, readURL) {
  const received = new Set(quotes.filter(quote => isFreshQuote(quote)
    && (!['kr3y','kr10y'].includes(quote.id) || Number.isFinite(quote.change))).map(quote => quote.id));
  const needed = INSTRUMENTS.filter(instrument => instrument.ecos && !received.has(instrument.id));
  return Promise.all(needed.map(instrument => ecosQuote(instrument, {}, readURL, true)));
}

async function fxQuotes(readURL) {
  const instruments = INSTRUMENTS.filter(instrument => instrument.fx);
  const codes = instruments.map(instrument => instrument.fx);
  const query = new URLSearchParams({base: 'KRW', quotes: codes.join(','), from: daysAgo(94)});
  const url = `https://api.frankfurter.dev/v2/rates?${query}`;
  const [ecb, mixed] = await Promise.all([readURL(`${url}&providers=ECB`), readURL(url)]);

  function observations(result) {
    const byCurrency = new Map(codes.map(code => [code, new Map()]));
    const days = new Map();
    for (const row of Array.isArray(result?.data) ? result.data : []) {
      if (row?.base !== 'KRW' || !byCurrency.has(row.quote)) continue;
      if (!days.has(row.date)) days.set(row.date, isoDay(row.date));
      if (!days.get(row.date)) continue;
      const rate = numeric(row.rate);
      if (rate !== null && rate > 0) byCurrency.get(row.quote).set(row.date, rate);
    }
    return byCurrency;
  }

  const official = observations(ecb);
  const blended = observations(mixed);
  return instruments.map(instrument => {
    const makeQuote = (series, source, result) => fromHistory(instrument,
      [...series.get(instrument.fx)].map(([date, rate]) => ({date, value: instrument.fxAmount / rate})),
      {provider: 'frankfurter', source, sourceUrl: 'https://frankfurter.dev/', retrievedAt: result?.retrievedAt,
        delay: '일별 기준환율 · 현찰·카드 결제에는 환전 수수료와 적용 환율이 반영될 수 있습니다.'});
    const ecbQuote = makeQuote(official, 'ECB / Frankfurter', ecb);
    if (isFreshQuote(ecbQuote)) return ecbQuote;
    const mixedQuote = makeQuote(blended, '다중 공급처 / Frankfurter', mixed);
    if (mixedQuote.observedAt && (!ecbQuote.observedAt || mixedQuote.observedAt > ecbQuote.observedAt)) return mixedQuote;
    if (ecbQuote.observedAt) return ecbQuote;
    return missing(instrument, '해당 통화의 일별 원화 기준환율을 받지 못했습니다');
  });
}

async function metalSpotQuote(instrument, readURL) {
  // Gold API keyless indicative spot endpoints. Validate original timestamps;
  // a successful HTTP response must never count as a new market observation.
  const result = await readURL(`https://api.gold-api.com/price/${instrument.metalSpot}`);
  const row = result?.data;
  const value = numeric(row?.price);
  const observedMs = Date.parse(row?.updatedAt);
  const age = Date.now() - observedMs;
  if (!row || row.symbol !== instrument.metalSpot || row.currency !== 'USD'
      || value === null || value <= 0
      || !Number.isFinite(observedMs) || age < -5 * 60000) {
    return missing(instrument, '금속 가격 API 응답·통화·기준시각을 검증하지 못했습니다');
  }
  const stale = age > 3 * 86400000;
  return {
    ...missing(instrument), provider: 'goldapi',
    value, change: null, changeUnit: '%',
    changeBasis: '비교 종가 미제공 · 전일 대비 등락 산출 안 함',
    source: 'Gold API', sourceUrl: 'https://gold-api.com/docs',
    observedAt: new Date(observedMs).toISOString(),
    retrievedAt: result.retrievedAt, timestampPrecision: 'second',
    status: stale ? 'stale' : 'delayed',
    reason: stale ? '가격 제공자의 관측시각이 3일을 초과했습니다' : null,
    delay: '가격 API 참고 현물 시세 · 공급자 시각 기준 · 거래소 공식 결제시세 아님',
  };
}

async function cryptoQuote(instrument, readURL) {
  // Binance Spot public market data has NONE security: no account, position or
  // trading API keys. USDT pairs are denominated in USDT, NOT USD.
  const symbol = `${instrument.crypto}USDT`;
  for (const host of ['data-api.binance.vision', 'api.binance.com']) {
    const result = await readURL(`https://${host}/api/v3/ticker/24hr?symbol=${symbol}`);
    const row = result?.data;
    const price = numeric(row?.lastPrice);
    const change = numeric(row?.priceChangePercent);
    const closeTime = numeric(row?.closeTime);
    const count = numeric(row?.count);
    // closeTime is the end of the 24h statistics window, not the timestamp
    // of the last executed trade. Reject expired, future and wrong-pair data.
    if (row?.symbol === symbol && price !== null && price > 0
      && closeTime !== null && closeTime > 0
      && closeTime <= Date.now() + 60000
      && Date.now() - closeTime <= 15 * 60000
      && (count === null || count > 0)) {
      return {
        ...missing(instrument), provider: 'binance', value: price, unit: 'USDT',
        change, changeUnit: '%',
        changeBasis: 'Binance 현물 24시간 이동창 가격 변동률',
        source: 'Binance Spot',
        sourceUrl: 'https://developers.binance.com/en/docs/products/spot/rest-api',
        observedAt: new Date(closeTime).toISOString(),
        retrievedAt: result.retrievedAt,
        timestampPrecision: 'window_end', status: 'live', reason: null,
        basis: `Binance ${instrument.crypto}/USDT 현물 가격 · USD 시세 또는 선물가격이 아님`,
        delay: '24시간 통계창 종료시각(마지막 체결시각 아님) · 최대 5분 캐시',
      };
    }
  }
  // Binance unavailable or geo-restricted: retain prior exchange fallbacks,
  // explicitly preserving their original USD denomination.
  const pair = `${instrument.crypto.toLowerCase()}usd`;
  const ticker = await readURL(`https://www.bitstamp.net/api/v2/ticker/${pair}/`);
  const price = numeric(ticker?.data?.last);
  const epoch = numeric(ticker?.data?.timestamp);
  let priorBitstamp;
  if (price !== null && price > 0 && epoch !== null && epoch > 0 && epoch < 1e11) {
    const observedAt = new Date(epoch * 1000).toISOString();
    if (Date.parse(observedAt) <= Date.now() + 60000) priorBitstamp = {
      ...missing(instrument), provider: 'bitstamp', value: price,
      change: numeric(ticker.data.percent_change_24), changeUnit: '%', changeBasis: '최근 24시간 대비',
      source: 'Bitstamp', sourceUrl: 'https://www.bitstamp.net/api/', observedAt,
      retrievedAt: ticker.retrievedAt, timestampPrecision: 'second',
      status: Date.now() - epoch * 1000 > 15 * 60000 ? 'stale' : 'live', reason: null,
      delay: '거래소 현물 스냅샷 · 데스크 최대 5분 캐시',
    };
  }
  if (isFreshQuote(priorBitstamp)) return priorBitstamp;
  // Coinbase spot provides no trade timestamp or comparable 24h change.
  // Use retrieval time explicitly, never invent either missing field.
  const spot = await readURL(`https://api.coinbase.com/v2/prices/${instrument.crypto}-USD/spot`);
  const amount = numeric(spot?.data?.data?.amount);
  if (amount !== null && amount > 0 && spot.data.data.base === instrument.crypto && spot.data.data.currency === 'USD') return {
    ...missing(instrument), provider: 'coinbase', value: amount,
    source: 'Coinbase Spot', sourceUrl: 'https://docs.cdp.coinbase.com/coinbase-app/docs/api-prices',
    observedAt: spot.retrievedAt, retrievedAt: spot.retrievedAt, timestampPrecision: 'retrieval',
    status: 'live', reason: null, changeBasis: '24시간 등락 자료 미제공',
    delay: '현재 현물 스냅샷 · 관측시각 미제공으로 수집시각 표시 · 최대 5분 캐시',
  };
  return priorBitstamp || missing(instrument, '바이낸스 및 대체 거래소 공개 시세 조회 실패 · 접근 제한 또는 응답 오류');
}

async function finnhubList(entries, group, env, readURL) {
  if (!env.FINNHUB_API_KEY) return [];
  return Promise.all(entries.map(async ([symbol, name]) => {
    const instrument = { id: symbol.toLowerCase(), name, group, unit: 'USD', provider: 'finnhub' };
    const query = new URLSearchParams({ symbol });
    // Finnhub accepts an API token header. Keep it out of URLs and logs.
    const result = await readURL(`https://finnhub.io/api/v1/quote?${query}`, 'json', {
      'X-Finnhub-Token': env.FINNHUB_API_KEY,
    });
    if (!result) return { ...missing(instrument, 'Finnhub 이용권한·요청 한도 또는 응답 오류'), symbol };
    const row = result.data;
    const value = numeric(row?.c);
    const epoch = numeric(row?.t);
    if (value === null || value <= 0 || epoch === null || epoch <= 0 || epoch > Date.now() / 1000 + 60) return { ...missing(instrument, '유효한 시세가 없습니다'), symbol };
    const stale = Date.now() - epoch * 1000 > 7 * 86400000;
    return {
      ...missing(instrument), symbol, provider: 'finnhub', value,
      change: numeric(row.dp), changeUnit: '%', changeBasis: '공급자 전장 종가 대비',
      source: 'Finnhub', sourceUrl: 'https://finnhub.io/docs/api/quote',
      observedAt: new Date(epoch * 1000).toISOString(), retrievedAt: result.retrievedAt,
      timestampPrecision: 'second', status: stale ? 'stale' : 'delayed', reason: null,
      basis: group === 'sector' ? '미국 섹터 ETF · 섹터 지수의 대용지표' : '미국 상장 종목',
      delay: '장중·장마감 여부 및 시세 지연은 Finnhub 가입 권한에 따름 · 최대 5분 캐시',
    };
  }));
}

function fact(quote) {
  if (!quote || quote.value === null || quote.deploymentBackup || quote.status === 'stale') return null;
  const change = quote.change === null ? '등락 자료 없음' : `${quote.change > 0 ? '+' : ''}${quote.change.toFixed(2)}${quote.changeUnit}`;
  return `${quote.name} ${quote.value.toLocaleString('en-US', { maximumFractionDigits: 2 })}${quote.unit} · ${change}`;
}

function buildAnalysis(quotes, session, company) {
  const byId = Object.fromEntries(quotes.map((quote) => [quote.id, quote]));
  const sessionIndexes = ['nasdaq', 'nasdaqcom', 'sox', 'sp500'];
  const dayEvidence = [...sessionIndexes.map(id => byId[id]).filter(quote => matchesUsClose(quote, session)),
    company, ...['usdkrw', 'usreal10y'].map(id => byId[id]).filter(quote => quote?.observedAt >= session.date)]
    .map(fact).filter(Boolean);
  const evidence = ['sox', 'usdkrw', 'nasdaq', 'usreal10y', 'sp500', 'us10y', 'vix'].map(id => byId[id])
    .filter(quote => quote && (!US_CASH_INDEXES.has(quote.id) || matchesUsClose(quote, session))).map(fact).filter(Boolean);
  const available = quotes.filter((quote) => quote.value !== null).length;
  // These describe observed external conditions, not a price forecast. No news
  // attribution, probability, or causal assertion is inferred from price signs.
  function pairConditions(firstId, secondId, firstLabel, secondLabel, secondInverse = false) {
    const first = byId[firstId];
    const second = byId[secondId];
    const valid = (quote) => quote && quote.value !== null && quote.change !== null && quote.status !== 'stale' && quote.status !== 'missing' && !quote.deploymentBackup;
    if (!valid(first) || !matchesUsClose(first, session)) {
      return {state: '판단 보류', text: `${first?.name || firstId} 종가 확인 대기`};
    }
    const firstMove = first.change > 0 ? firstLabel[0] : first.change < 0 ? firstLabel[1] : firstLabel[2];
    if (!valid(second) || second.observedAt < session.date) {
      return {state: '판단 보류', text: `${firstMove} · ${second?.name || secondId} 자료 대기`};
    }
    const a = Math.sign(first.change);
    const b = Math.sign(second.change) * (secondInverse ? -1 : 1);
    const state = a > 0 && b > 0 ? '우호' : a < 0 && b < 0 ? '부담' : '혼재';
    const secondMove = second.change > 0 ? secondLabel[0] : second.change < 0 ? secondLabel[1] : secondLabel[2];
    return { state, text: `${firstMove} · ${secondMove} · 외부 여건 ${state}` };
  }
  const kospiDay = pairConditions('sox', 'usdkrw', ['미국 반도체 상승', '미국 반도체 하락', '미국 반도체 보합'], ['원화 약세', '원화 강세', '원화 보합'], true);
  const kosdaqDay = pairConditions('nasdaq', 'usreal10y', ['나스닥 100 상승', '나스닥 100 하락', '나스닥 100 보합'], ['미 실질금리 상승', '미 실질금리 하락', '미 실질금리 보합'], true);
  const ruleSets = [
    ['day', `오늘의 개장 여건 · 미국 ${session.date} 정규장`, kospiDay.text, kosdaqDay.text, ['미국 정규장 이후 움직임은 미국 선물에서 확인하세요.', '외국인 수급·국내 거래대금·개별 실적이 외부 여건과 다르게 움직일 수 있습니다.'], ['한국 장중 환율·반도체 흐름이 관측 조합과 반대로 전환하면 해석을 철회합니다.', '외국인 수급·거래대금이 동반 확인될 때에만 국내 방향 판단을 갱신합니다.']],
    ['short', '2~3거래일 · 흐름 지속 여부', '반도체 상대강도·환율·외국인 수급의 2~3일 지속 여부를 확인합니다. 현재 방향 판단 보류.', '거래대금 확산과 성장주 상대강도가 함께 지속되는지 확인합니다. 현재 방향 판단 보류.', ['하루의 반등은 추세 전환 근거로 부족합니다.'], ['미국 금리 재상승·원화 약세 전환 시 우호적 조건을 철회합니다.']],
    ['week', '1주 · 이벤트와 업종 순환', '경제 일정, 실적 발표와 주간 수급을 함께 확인해야 합니다. 실적·수급 자료가 부족해 방향 판단을 보류합니다.', '성장주 실적과 업종 내 상승 종목 확산을 확인해야 합니다. 실적 자료 미연동으로 판단 보류.', ['발표 전 전망과 발표 후 반응은 다를 수 있습니다.'], ['경제지표·실적 발표 후 금리와 이익 전망이 달라지면 다시 검토합니다.']],
    ['month', '1개월 · 거시와 이익 추세', '수출·이익 추정치·원화·글로벌 경기', '실질금리·유동성·이익 추정치', ['이익 추정치와 실질금리'], ['실적 하향과 실질금리 상승이 지속되면 우호적 조건을 철회합니다.']],
    ['quarter', '분기 · 구조적 추세', '정책·수출 사이클·이익·밸류에이션', '정책·자금 조달·기업 실적', ['경기와 기업 이익 흐름'], ['정책·이익 사이클의 변화가 확인되면 분석 전제를 갱신합니다.']],
  ];
  return {
    summary: {
      headline: available ? `최근 관측 기준 개장 여건: 코스피 ${kospiDay.state} · 코스닥 ${kosdaqDay.state}` : '공급자 연결 확인 필요 · 실제 시세를 가져오지 못했습니다',
      points: [
        ...evidence.slice(0, 3),
        `실제 자료 ${available}/${quotes.length}개 확인. 관측 지표로 개장 전 외부 여건을 해석합니다.`,
        '일별 통계와 거래소 스냅샷의 기준시각이 다릅니다. 각 지표의 관측일·시세 기준을 확인하세요.',
      ],
      method: 'rules', label: '규칙 기반 · 조건부 점검',
    },
    outlooks: ruleSets.map(([horizon, title, kospi, kosdaq, counter, invalidation]) => ({
      horizon, title, kospi, kosdaq, evidence: horizon === 'day' ? dayEvidence : evidence.slice(0, 5), counter, invalidation,
      ...(horizon === 'day' ? {usSessionDate: session.date} : {}),
      confidence: horizon === 'day' && (kospiDay.state !== '판단 보류' || kosdaqDay.state !== '판단 보류') ? '낮음 · 국내 수급 미확인' : '판단 보류',
      method: 'rules', label: horizon === 'day' ? '개장 여건' : '기간별 점검',
    })),
  };
}

function sourceList(quotes, sectors, leaders, env, failures = new Map()) {
  const all = [...quotes, ...sectors, ...leaders];
  const definitions = [
    ['fred', 'FRED / 각 원자료 제공기관', 'https://fred.stlouisfed.org/', '일별 자료 · 원천 이용조건 확인 필요', true, ['api.stlouisfed.org', 'fred.stlouisfed.org']],
    ['nasdaq', 'Nasdaq 지수 종가', 'https://www.nasdaq.com/market-activity/index/ndx/historical', 'FRED 지연·실패 시 Nasdaq 공식 일별 종가', true, ['api.nasdaq.com']],
    ['treasury', '미국 재무부', 'https://home.treasury.gov/policy-issues/financing-the-government/interest-rate-statistics/', 'FRED 금리 실패 시 공식 대체 자료', true, ['home.treasury.gov']],
    ['frankfurter', 'ECB / Frankfurter', 'https://frankfurter.dev/', 'ECB 일별 원화 환율 우선 · 누락 통화는 Frankfurter 다중 공급처 기준환율로 대체', true, ['api.frankfurter.dev']],
    ['binance', 'Binance Spot', 'https://developers.binance.com/en/docs/products/spot/rest-api', 'BTC/ETH/SOL USDT 현물 24시간 시세 · 최우선 · 키 필요 없음 · USD와 구분', true, ['data-api.binance.vision', 'api.binance.com']],
    ['bitstamp', 'Bitstamp', 'https://www.bitstamp.net/api/', 'Binance 수신 실패 시 USD 현물 대체 · 실패 시 Coinbase', true, ['www.bitstamp.net']],
    ['coinbase', 'Coinbase Spot', 'https://docs.cdp.coinbase.com/coinbase-app/docs/api-prices', 'Binance·Bitstamp 모두 실패할 때 USD 현물 대체 (24시간 등락 미제공)', true, ['api.coinbase.com']],
    ['goldapi', 'Gold API', 'https://gold-api.com/docs', '금·은·구리 참고 현물가격 · 구리는 USD/파운드 · 키 불필요', true, ['api.gold-api.com']],
    ['finnhub', 'Finnhub', 'https://finnhub.io/docs/api/quote', '미국 섹터 ETF·대표 종목 · API 키 필요 · 등락 시각과 가입 권한 확인', Boolean(env.FINNHUB_API_KEY), ['finnhub.io']],
    ['ecos', '한국은행 ECOS', 'https://ecos.bok.or.kr/', '국내 지수·수급·국고채 일별 자료 · 인증 연결 실패 시 공개 최근 관측', true, ['ecos.bok.or.kr']],
    ['kis', '한국투자증권 KIS', 'https://apiportal.koreainvestment.com/', '국내 지수·외국인 수급 및 미국 지수·주식·섹터 ETF 우선 공급원 (권한 또는 종목 확인 실패 시 기존 자료 유지)', kisConfigured(env), ['openapi.koreainvestment.com']],
  ];
  const expected = {
    fred: INSTRUMENTS.filter(x => x.fred).length,
    frankfurter: INSTRUMENTS.filter(x => x.fx).length,
    binance: INSTRUMENTS.filter(x => x.crypto).length,
    bitstamp: INSTRUMENTS.filter(x => x.crypto).length,
    finnhub: SECTORS.length + LEADERS.length,
    goldapi: INSTRUMENTS.filter(x => x.metalSpot).length,
    ecos: INSTRUMENTS.filter(x => x.ecos).length,
    kis: 6 + SECTORS.length + LEADERS.length + 4 + 3,
  };
  return definitions.map(([id, name, url, note, enabled, hosts]) => {
    const records = all.filter(quote => quote.provider === id);
    const valid = records.filter(quote => Number.isFinite(quote.value) && ['live', 'delayed', 'daily', 'monthly'].includes(quote.status) && !quote.deploymentBackup);
    const backups = records.filter(quote => quote.deploymentBackup || quote.savedFrom);
    const stale = records.filter(quote => quote.status === 'stale' && !quote.deploymentBackup && !quote.savedFrom);
    const errors = [...failures].filter(([key]) => {
      const [host, code] = key.split(' ');
      return hosts.includes(host) && code !== 'response_received';
    }).map(([key, count]) => {
      const code = key.slice(key.indexOf(' ') + 1);
      return { code, count };
    });
    const state = !enabled ? 'unconfigured'
      : valid.length ? ((stale.length || backups.length || records.some(q => q.value === null) || (expected[id] && valid.length < expected[id])) ? 'partial' : 'connected')
      : backups.length ? 'backup'
      : stale.length ? 'stale'
      : ['nasdaq', 'treasury', 'coinbase', 'bitstamp'].includes(id) ? 'standby' : 'no_data';
    return {
      id, name, url, note, enabled, status: state,
      received: valid.length, expected: expected[id] || null,
      monthly: valid.filter(quote => quote.status === 'monthly').length,
      stale: stale.length, backup: backups.length, missing: records.filter(q => q.value === null).length,
      failures: errors.slice(0, 8),
    };
  });
}

function isFreshQuote(quote) {
  return Number.isFinite(quote?.value) && ['live', 'delayed', 'daily', 'monthly'].includes(quote.status)
    && !quote.deploymentBackup && !quote.savedFrom;
}

function canRestoreQuote(quote, now) {
  if (!Number.isFinite(quote?.value) || (quote.status && !isFreshQuote(quote))) return false;
  const observed = Date.parse(quote.observedAt), retrieved = Date.parse(quote.retrievedAt);
  const age = quote.timestampPrecision === 'month' ? 100 : quote.timestampPrecision === 'day' ? 7 : 1;
  return Number.isFinite(observed) && Number.isFinite(retrieved) && observed <= now + 60000 && retrieved <= now
    && now - observed <= age * DAY_MS && now - retrieved <= age * DAY_MS;
}

function restoreQuotes(quotes, backup, lastGood, session, now = Date.now()) {
  const saved = new Map(lastGood.map(quote => [quote.id, quote]));
  const built = new Map(backup.map(quote => [quote.id, quote]));
  return quotes.map(quote => {
    if (US_CASH_INDEXES.has(quote.id) && !matchesUsClose(quote, session)) {
      const confirmed = [saved.get(quote.id), built.get(quote.id)].find(prior =>
        canRestoreQuote(prior, now) && matchesUsClose(prior, session));
      // A completed session's verified close is still valid for that same session.
      if (confirmed) return confirmed;
    }
    if (isFreshQuote(quote)) return quote;
    const choices = [{prior: saved.get(quote.id), savedFrom: 'cache'}, {prior: built.get(quote.id), savedFrom: 'build'}]
      .filter(({prior}) => canRestoreQuote(prior, now) && (!quote.observedAt || prior.observedAt > quote.observedAt))
      .sort((a, b) => b.prior.observedAt.localeCompare(a.prior.observedAt));
    if (!choices.length) return quote;
    const {prior, savedFrom} = choices[0];
    const label = savedFrom === 'cache' ? '최근 저장한 관측값' : '배포 시 저장한 관측값';
    return {...prior, savedFrom, deploymentBackup: savedFrom === 'build', status: 'stale',
      reason: `최신 공급자 조회 실패 · ${label}`, delay: `${label} · 현재 시세 아님`};
  });
}

// Compare overlapping sessions from a known official series, never different
// trading dates or an ETF/futures proxy for the underlying cash index.
function sameIndex(kis, reference, now = Date.now()) {
  if (!validQuote(kis) || !['fred', 'nasdaq'].includes(reference?.provider)) return false;
  const prices = new Map(reference.history?.map(row => [row.date, row.value]));
  const shared = kis.history?.findLast(row => prices.has(row.date));
  if (!shared || now - Date.parse(shared.date) > 14 * DAY_MS) return false;
  const official = prices.get(shared.date);
  return Number.isFinite(official) && official > 0 && Math.abs(shared.value - official) / official <= 0.015;
}
function validQuote(q) {
  if (!q || !Number.isFinite(q.value) || !['daily','delayed','live'].includes(q.status) || q.deploymentBackup) return false;
  // Unlike index levels, stock prices or yields, net investor BUYING is a
  // signed amount. Negative = net selling; zero = exactly balanced flow.
  // Both are valid KIS observations and must not be discarded by the
  // positive-price validator used for foreign-market instruments.
  const signedInvestorFlow=q.provider==='kis' && /^kr_(foreign|pension)_(kospi|kosdaq)$/.test(q.id);
  return signedInvestorFlow || q.value>0;
}
function selectKisFirst(previous,kisItems) {
  const map=new Map(previous.map(q=>[q.id,q]));
  for(const candidate of kisItems)if(validQuote(candidate))map.set(candidate.id,candidate);
  return [...map.values()];
}

export async function collectMarket(env, backup = [], lastGood = [], requestLimit = FREE_PLAN_PROVIDER_REQUESTS) {
  const session = latestUsSession();
  let remaining = requestLimit;
  const fetchProvider = (url, init) => {
    if (remaining <= 0) throw Object.assign(new Error('Market provider request budget exhausted'), {code: 'MARKET_REQUEST_BUDGET'});
    remaining--;
    return fetch(url, init);
  };
  const kisEnv = {...env, fetchProvider, hasProviderBudget: () => remaining > 0};
  const { readURL, failures } = createMarketReader(fetchProvider);
  const [initialQuotes, fx, kis, overseasIndices, macro] = await Promise.all([
    Promise.all(INSTRUMENTS.map((instrument) => instrument.fred ? fredQuote(instrument, env, readURL) : instrument.metalSpot ? metalSpotQuote(instrument, readURL) : instrument.ecos ? ecosQuote(instrument, env, readURL) : instrument.crypto ? cryptoQuote(instrument, readURL) : Promise.resolve(missing(instrument)))),
    fxQuotes(readURL), collectKis(kisEnv), collectKisOverseas(kisEnv, 'indices'), collectKisMacro(kisEnv),
  ]);
  const [treasury, nasdaq, nvda, publicKorea] = await Promise.all([
    treasuryFallback(initialQuotes, readURL), nasdaqIndexFallback(initialQuotes, session, readURL),
    nasdaqClosingQuote({id: 'nvda', name: '엔비디아', group: 'equity', unit: ' USD', basis: '미국 정규장 종가'},
      'NVDA', session, readURL, [], 'stocks'),
    publicEcosFallback([...initialQuotes, ...kis, ...macro], readURL),
  ]);
  const overseas = remaining > 0 ? await collectKisOverseas(kisEnv, 'securities') : {sectors: [], leaders: []};
  // Actual request priority: KIS FIRST. Ask paid Finnhub only for
  // securities that KIS did not return as valid observations.
  const overseasSectorIds = new Set(overseas.sectors.filter(validQuote).map(q=>q.id));
  const overseasLeaderIds = new Set(overseas.leaders.filter(validQuote).map(q=>q.id));
  const [finnhubSectors, finnhubLeaders] = await Promise.all([
    finnhubList(SECTORS.filter(([symbol])=>!overseasSectorIds.has(symbol.toLowerCase())), 'sector', env, readURL),
    finnhubList(LEADERS.filter(([symbol])=>!overseasLeaderIds.has(symbol.toLowerCase())), 'equity', env, readURL),
  ]);
  const base = new Map(initialQuotes.map(quote => [quote.id, quote]));
  const nasdaqById = new Map(nasdaq.map(quote => [quote.id, quote]));
  const verifiedUSIndices = overseasIndices.indices.filter(quote => {
    const current = nasdaqById.get(quote.id) || base.get(quote.id);
    const reference = isFreshQuote(current) ? current : [current, ...lastGood, ...backup]
      .filter(candidate => candidate?.id === quote.id && ['fred', 'nasdaq'].includes(candidate.provider) && candidate.observedAt)
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
    return sameIndex(quote, reference) && (!matchesUsClose(current, session) || matchesUsClose(quote, session))
      && (!isFreshQuote(current) || quote.observedAt > current.observedAt
        || (quote.observedAt === current.observedAt && current.provider !== 'nasdaq'));
  });
  const preferredMacro = macro.filter(quote => {
    const official = base.get(quote.id);
    return Number.isFinite(quote.change) || !Number.isFinite(official?.change) || official.observedAt < quote.observedAt;
  });
  const replacements = new Map([...fx, ...treasury, ...nasdaq, ...kis, ...verifiedUSIndices, ...preferredMacro]
    .filter(validQuote).map(quote => [quote.id, quote]));
  // Foreign net purchases can be negative. A valid ECOS fallback is still usable.
  for (const quote of publicKorea.filter(quote => isFreshQuote(quote) && (quote.id === 'kr_foreign_kospi' || quote.value > 0))) {
    const current = replacements.get(quote.id);
    if (!current || quote.observedAt >= current.observedAt) replacements.set(quote.id, quote);
  }
  const obtained = initialQuotes.map(quote => {
    const replacement = replacements.get(quote.id);
    return replacement ? {...quote, ...replacement} : quote;
  });
  const quotes = restoreQuotes(obtained, backup, lastGood, session);
  const sectors = selectKisFirst(finnhubSectors, overseas.sectors);
  const leaders = selectKisFirst(finnhubLeaders, overseas.leaders);
  const available = quotes.filter((quote) => quote.value !== null).length;
  const company = nvda || [...lastGood, ...backup].find(quote =>
    quote.id === 'nvda' && quote.provider === 'nasdaq' && canRestoreQuote(quote, Date.now()) && matchesUsClose(quote, session));
  const { summary, outlooks } = buildAnalysis(quotes, session, company);
  const impact = buildImpact({ quotes });
  impact.validation = validateHistoricalImpact({ quotes });
  const restored = quotes.filter(quote => quote.savedFrom).length;
  if (restored) {
    summary.points.unshift(`최신 조회 실패로 ${restored}개 지표에 저장한 관측값을 표시합니다. 각 지표의 출처와 관측 시각을 확인하세요.`);
  }
  if (available === 0 || restored) {
    console.warn(available === 0 ? 'Market snapshot has no valid observations' : 'Market snapshot uses saved observations', Object.fromEntries(failures));
    const labels = {
      response_received: '응답 수신 · 유효한 값 없음',
      invalid_json: '응답 형식 오류',
      response_too_large: '응답 크기 초과',
      timeout: '시간 초과',
      request_context: 'Worker 요청 범위 오류',
      dns_error: 'DNS 오류',
      tls_error: 'TLS 오류',
      outbound_denied: '외부 연결 거부',
      request_budget: '한 번에 조회할 수 있는 외부 요청 한도 도달',
      connection_lost: '연결 끊김',
      fetch_error: '요청 실패',
    };
    const report = [...failures].map(([key, count]) => {
      const [host, status] = key.split(' ');
      return `${host} ${labels[status] || status.replace('_', ' ')} ${count}건`;
    });
    if (report.length) summary.points.splice(restored ? 1 : summary.points.length, 0, `이번 조회 결과 · ${report.join(' / ')}`);
  }
  // "Connected" measures valid received observations, not intraday streaming.
  // Legitimate KIS/FRED daily closes and IMF monthly averages count as received.
  const healthy = quotes.filter(isFreshQuote).length;
  const mode = healthy === 0 ? 'unconfigured' : healthy === quotes.length ? 'live' : 'partial';
  return {
    asOf: new Date().toISOString(), mode, quotes, sectors, leaders, impact, events: [],
    summary, outlooks, usSession: {date: session.date, company: company || null},
    sources: sourceList(quotes, sectors, leaders, env, failures),
    analysis: { kind: 'rules', status: 'ready', label: '규칙 기반 · 조건부 점검' },
    cacheSeconds: TTL / 1000,
    providerBudgetReached: remaining === 0,
  };
}

async function configKey(env) {
  const identity = JSON.stringify([env.FRED_API_KEY || '', env.FINNHUB_API_KEY || '', env.ECOS_API_KEY || '', env.KIS_APP_KEY || '', env.KIS_APP_SECRET || '']);
  if (!configHashes.has(identity)) {
    if (configHashes.size > 8) configHashes.clear();
    configHashes.set(identity, crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity)).then((digest) =>
      Array.from(new Uint8Array(digest)).slice(0, 16).map((byte) => byte.toString(16).padStart(2, '0')).join('')));
  }
  return configHashes.get(identity);
}

function edgeCache() {
  try { return globalThis.caches?.default || null; } catch { return null; }
}

async function loadOrRefresh(env, force) {
  const key = await configKey(env);
  const cached = snapshots.get(key);
  if (!force && cached && Date.now() - cached.time < TTL) return structuredClone(cached.data);
  if (pending.has(key)) return structuredClone(await pending.get(key));
  const task = (async () => {
    const cache = edgeCache();
    const cacheRequest = new Request(`https://market-desk-cache.invalid/snapshot/v11/${key}`);
    if (!force && cache) {
      try {
        const response = await cache.match(cacheRequest);
        if (response) {
          const data = await response.json();
          if (Date.now() - Date.parse(data.asOf) < TTL) {
            snapshots.set(key, { data, time: Date.parse(data.asOf) });
            return data;
          }
        }
      } catch { /* Cache outages must not prevent retrieving actual data. */ }
    }
    const savedRequest = new Request(`https://market-desk-cache.invalid/last-good/v2/${key}`);
    let lastGood = lastGoodQuotes.get(key);
    if (!lastGood && cache) {
      try { lastGood = await (await cache.match(savedRequest))?.json(); }
      catch { /* Public build data remains available. */ }
    }
    lastGood = (lastGood || []).filter(quote => canRestoreQuote(quote, Date.now()));
    const data = await collectMarket(env, deploymentSnapshot, lastGood);
    const nextGood = new Map(lastGood.map(quote => [quote.id, quote]));
    for (const quote of [...data.quotes, data.usSession.company].filter(isFreshQuote)) {
      const prior = nextGood.get(quote.id);
      if (!prior || quote.observedAt >= prior.observedAt) nextGood.set(quote.id, quote);
    }
    const saved = [...nextGood.values()];
    if (lastGoodQuotes.size > 8) lastGoodQuotes.clear();
    lastGoodQuotes.set(key, saved);
    if (snapshots.size > 8) snapshots.clear();
    snapshots.set(key, { data, time: Date.now() });
    if (cache) {
      try {
        await cache.put(savedRequest, Response.json(saved, {headers: {'Cache-Control': 'public, max-age=604800'}}));
      } catch { /* Retain the verified data in memory when edge cache is unavailable. */ }
      try {
        await cache.put(cacheRequest, new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${TTL / 1000}` },
        }));
      } catch { /* The module TTL also bounds request volume without edge cache. */ }
    }
    return data;
  })();
  pending.set(key, task);
  try { return structuredClone(await task); } finally { pending.delete(key); }
}

/** Returns a shared five-minute snapshot. No credential ever enters the result. */
export async function getMarket(env = {}) {
  return loadOrRefresh(env, false);
}

/** For an authenticated admin action or scheduled job; bypasses snapshot TTL. */
export async function refreshMarket(env = {}) {
  return loadOrRefresh(env, true);
}
