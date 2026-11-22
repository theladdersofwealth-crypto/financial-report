/**
 * Server-only market feeds. No demo prices, inferred prices, or fabricated news.
 * Observation dates describe the source; asOf describes when this desk fetched it.
 * A public endpoint does not grant redistribution rights: check the source terms
 * before opening the desk beyond the intended private audience.
 */
import deploymentSnapshot from './market-deploy-snapshot.js';
import { buildImpact } from './impact.js';
import { validateHistoricalImpact } from './validation.js';

const TTL = 5 * 60 * 1000;
const TIMEOUT = 4000;
const PROVIDER_CONCURRENCY = 4;
const HOSTS = new Set([
  'fred.stlouisfed.org', 'api.stlouisfed.org', 'home.treasury.gov',
  'api.frankfurter.dev', 'www.bitstamp.net', 'api.coinbase.com', 'finnhub.io',
  'www.bls.gov', 'www.federalreserve.gov', 'ecos.bok.or.kr',
]);
const snapshots = new Map();
const pending = new Map();
const configHashes = new Map();

const INSTRUMENTS = [
  { id: 'sp500', name: 'S&P 500', group: 'equity', unit: 'pt', fred: 'SP500', origin: 'S&P Dow Jones Indices', basis: '미국 정규장 종가' },
  { id: 'nasdaq', name: '나스닥 100', group: 'equity', unit: 'pt', fred: 'NASDAQ100', origin: 'Nasdaq', basis: '미국 정규장 종가' },
  { id: 'sox', name: '필라델피아 반도체', group: 'equity', unit: 'pt', fred: 'NASDAQSOX', origin: 'Nasdaq', basis: '미국 정규장 종가' },
  { id: 'nasdaqcom', name: '나스닥 종합', group: 'equity', unit: 'pt', fred: 'NASDAQCOM', origin: 'Nasdaq', basis: '미국 정규장 종가' },
  { id: 'us2y', name: '미 국채 2년', group: 'rates', unit: '%', fred: 'DGS2', origin: 'Federal Reserve H.15', basis: '일별 고정만기 수익률' },
  { id: 'us10y', name: '미 국채 10년', group: 'rates', unit: '%', fred: 'DGS10', origin: 'Federal Reserve H.15', basis: '일별 고정만기 수익률' },
  { id: 'usreal10y', name: '미 실질금리 10년', group: 'rates', unit: '%', fred: 'DFII10', origin: 'Federal Reserve H.15', basis: '일별 물가연동채 고정만기 수익률' },
  { id: 'usdkrw', name: '달러/원', group: 'fx', unit: '원/USD', fx: 'KRW', basis: 'ECB 일별 기준환율 · 서울 현물환 종가 아님' },
  { id: 'usdjpy', name: '달러/엔', group: 'fx', unit: 'JPY/USD', fx: 'JPY', basis: 'ECB 일별 기준환율' },
  { id: 'usdcny', name: '달러/위안', group: 'fx', unit: 'CNY/USD', fx: 'CNY', basis: 'ECB 일별 기준환율 · 역외 CNH 아님' },
  { id: 'dxy', name: '달러인덱스 DXY', group: 'fx', unit: 'pt', required: 'ICE DXY 시세 공급자 연결 필요' },
  { id: 'broadusd', name: '연준 광의달러지수', group: 'fx', unit: 'pt', fred: 'DTWEXBGS', origin: 'Federal Reserve', basis: '일별 무역가중 광의달러지수 · ICE DXY와 다른 지수' },
  { id: 'wti', name: 'WTI 현물', group: 'energy', unit: 'USD/bbl', fred: 'DCOILWTICO', origin: 'U.S. EIA', basis: '쿠싱 현물 일별 가격 · 선물 아님' },
  { id: 'brent', name: '브렌트 현물', group: 'energy', unit: 'USD/bbl', fred: 'DCOILBRENTEU', origin: 'U.S. EIA', basis: '유럽 브렌트 현물 일별 가격 · 선물 아님' },
  { id: 'gold', name: '금', group: 'metals', unit: 'USD/oz', required: '금 현물 또는 월물이 확인되는 선물 시세 공급자 연결 필요' },
  { id: 'silver', name: '은', group: 'metals', unit: 'USD/oz', required: '은 현물 또는 월물이 확인되는 선물 시세 공급자 연결 필요' },
  { id: 'copper', name: '구리', group: 'metals', unit: 'USD/t', required: 'LME 등 거래소·현물/선물 기준이 확인되는 공급자 연결 필요' },
  { id: 'nickel', name: '니켈', group: 'metals', unit: 'USD/t', required: 'LME 등 거래소·현물/선물 기준이 확인되는 공급자 연결 필요' },
  { id: 'vix', name: 'VIX 기대변동성', group: 'risk', unit: 'pt', fred: 'VIXCLS', origin: 'Cboe', basis: '일별 종가 · SPX 옵션 기반 30일 기대변동성의 연율화 수치' },
  { id: 'hyspread', name: '미 하이일드 스프레드', group: 'risk', unit: '%', fred: 'BAMLH0A0HYM2', origin: 'ICE Data Indices', basis: '일별 옵션조정 신용스프레드' },
  { id: 'btc', name: '비트코인', group: 'crypto', unit: 'USD', crypto: 'BTC', basis: '거래소 BTC/USD 현물' },
  { id: 'eth', name: '이더리움', group: 'crypto', unit: 'USD', crypto: 'ETH', basis: '거래소 ETH/USD 현물' },
  { id: 'sol', name: '솔라나', group: 'crypto', unit: 'USD', crypto: 'SOL', basis: '거래소 SOL/USD 현물' },
  { id: 'kospi', name: '코스피', group: 'korea', unit: 'pt', ecos: '0001000', ecosTable: '802Y001', required: '한국은행 ECOS API 인증키 연결 필요', basis: '한국거래소 작성 · 한국은행 ECOS 주식시장(일) · 일별 종가' },
  { id: 'kosdaq', name: '코스닥', group: 'korea', unit: 'pt', ecos: '0089000', ecosTable: '802Y001', required: '한국은행 ECOS API 인증키 연결 필요', basis: '한국거래소 작성 · 한국은행 ECOS 주식시장(일) · 일별 종가' },
  { id: 'kr_foreign_kospi', name: '외국인 순매수 (코스피)', group: 'korea', unit: '억원', flow: true, ecos: '0030000', ecosTable: '802Y001', required: '한국은행 ECOS API 인증키 연결 필요', basis: '유가증권시장 외국인 당일 순매수금액 · 실제 매매자료 · 일별, 단위 억원' },
  { id: 'kr3y', name: '한국 국채 3년', group: 'korea', unit: '%', ecos: '010200000', required: 'ECOS_API_KEY 연결 필요', basis: '한국은행 ECOS 시장금리(일별) · 국고채 3년' },
  { id: 'kr10y', name: '한국 국채 10년', group: 'korea', unit: '%', ecos: '010210000', required: 'ECOS_API_KEY 연결 필요', basis: '한국은행 ECOS 시장금리(일별) · 국고채 10년' },
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

const isoDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value));
const numeric = (value) => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const rounded = (value) => Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null;
const daysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const pct = (last, previous) => previous !== 0 ? rounded((last - previous) / previous * 100) : null;

export function createMarketReader() {
  const failures = new Map();
  const queue = [];
  let active = 0;

  function pump() {
    while (active < PROVIDER_CONCURRENCY && queue.length) {
      const { url, format, headers, resolve, reject } = queue.shift();
      active++;
      readProvider(url, format, headers, failures).then(resolve, reject).finally(() => {
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

async function readProvider(url, format, headers, failures) {
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
    const response = await fetch(parsed.toString(), {
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
    unit: instrument.unit, change: null, changeUnit: instrument.flow ? '억원' : instrument.group === 'rates' || instrument.id === 'hyspread' || (instrument.ecos && !instrument.ecosTable) ? 'bp' : '%',
    source: instrument.fred ? `${instrument.origin} / FRED` : '미연결',
    sourceUrl: instrument.fred ? `https://fred.stlouisfed.org/series/${instrument.fred}` : null,
    observedAt: null, retrievedAt: null, status: 'missing', reason,
    basis: instrument.basis || '', history: [],
  };
}

function fromHistory(instrument, entries, metadata) {
  const history = entries.filter((entry) => isoDay(entry.date) && numeric(entry.value) !== null && entry.date <= daysAgo(0))
    .map((entry) => ({ date: entry.date, value: Number(entry.value) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!history.length) return missing(instrument, '유효한 최신 관측값이 없습니다');
  const last = history.at(-1);
  const previous = history.at(-2);
  const isRate = instrument.group === 'rates' || instrument.id === 'hyspread' || Boolean(instrument.ecos && !instrument.ecosTable);
  const change = previous ? (instrument.flow ? rounded(last.value - previous.value) : isRate ? rounded((last.value - previous.value) * 100) : pct(last.value, previous.value)) : null;
  const stale = Date.now() - Date.parse(`${last.date}T23:59:59Z`) > 7 * 86400000;
  return {
    ...missing(instrument), ...metadata, value: last.value, change,
    changeUnit: instrument.flow ? '억원' : isRate ? 'bp' : '%', observedAt: last.date, timestampPrecision: 'day',
    comparisonAt: previous?.date || null, changeBasis: instrument.flow ? '직전 관측일 순매수금액 대비 증감(당일 순매수액 자체와 다름)' : '직전 유효 관측일 대비',
    status: stale ? 'stale' : 'daily', reason: stale ? '관측일이 7일 이상 지났습니다' : null,
    history: history.slice(-65), delay: '일별 자료 · 장중 실시간 시세 아님',
  };
}

async function fredQuote(instrument, env, readURL) {
  const start = daysAgo(100);
  let result;
  let entries;
  if (env.FRED_API_KEY) {
    const query = new URLSearchParams({ series_id: instrument.fred, api_key: env.FRED_API_KEY,
      file_type: 'json', observation_start: start, sort_order: 'asc' });
    result = await readURL(`https://api.stlouisfed.org/fred/series/observations?${query}`);
    entries = result?.data?.observations?.map((row) => ({ date: row.date, value: row.value }));
  } else {
    // One series per request. FRED may return a ZIP for a multi-series CSV URL.
    result = await readURL(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${instrument.fred}&cosd=${start}`, 'text');
    const rows = result?.data?.trim().split(/\r?\n/);
    if (rows?.[0]?.replace(/^\uFEFF/, '') === `observation_date,${instrument.fred}` || rows?.[0] === `DATE,${instrument.fred}`) {
      entries = rows.slice(1).map((line) => {
        const [date, value] = line.split(',');
        return { date, value };
      });
    }
  }
  if (!Array.isArray(entries)) return missing(instrument, env.FRED_API_KEY ? 'FRED 인증·이용권한 또는 공급자 응답을 확인해 주세요' : 'FRED 공개 일별 자료 응답을 확인할 수 없습니다');
  return fromHistory(instrument, entries, {
    provider: 'fred', source: `${instrument.origin} / FRED`,
    sourceUrl: `https://fred.stlouisfed.org/series/${instrument.fred}`,
    retrievedAt: result.retrievedAt,
  });
}

async function treasuryFallback(quotes, readURL) {
  const needed = quotes.filter((quote) => ['us2y', 'us10y', 'usreal10y'].includes(quote.id) && quote.value === null);
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

async function ecosQuote(instrument, env, readURL) {
  // ECOS 817Y002 daily yields and 802Y001 daily stock market; never access without a key.
  const token = env.ECOS_API_KEY;
  if (typeof token !== 'string' || !/^[A-Za-z0-9]{8,128}$/.test(token)) {
    return missing(instrument, '한국은행 ECOS 인증키가 연결되지 않았습니다');
  }
  const ymd = (date) => date.replace(/-/g, '');
  const from = ymd(daysAgo(100)), until = ymd(daysAgo(0));
  // ECOS requires the API key in the path; never log the URL or response body.
  const table = instrument.ecosTable || '817Y002';
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${token}/json/kr/1/100/${table}/D/${from}/${until}/${instrument.ecos}`;
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

async function fxQuotes(readURL) {
  const result = await readURL(`https://api.frankfurter.dev/v2/rates?base=USD&quotes=KRW,JPY,CNY&providers=ECB&from=${daysAgo(100)}`);
  return INSTRUMENTS.filter((item) => item.fx).map((instrument) => {
    if (!Array.isArray(result?.data)) return missing(instrument, 'ECB/Frankfurter 일별 기준환율 응답을 확인할 수 없습니다');
    return fromHistory(instrument, result.data.filter((row) => row.base === 'USD' && row.quote === instrument.fx)
      .map((row) => ({ date: row.date, value: row.rate })), {
      provider: 'frankfurter', source: 'ECB / Frankfurter', sourceUrl: 'https://frankfurter.dev/', retrievedAt: result.retrievedAt,
    });
  });
}

async function cryptoQuote(instrument, readURL) {
  const pair = `${instrument.crypto.toLowerCase()}usd`;
  const ticker = await readURL(`https://www.bitstamp.net/api/v2/ticker/${pair}/`);
  const price = numeric(ticker?.data?.last);
  const epoch = numeric(ticker?.data?.timestamp);
  if (price !== null && price > 0 && epoch !== null && epoch > 0 && epoch < 1e11) {
    const observedAt = new Date(epoch * 1000).toISOString();
    if (Date.parse(observedAt) <= Date.now() + 60000) return {
      ...missing(instrument), provider: 'bitstamp', value: price,
      change: numeric(ticker.data.percent_change_24), changeUnit: '%', changeBasis: '최근 24시간 대비',
      source: 'Bitstamp', sourceUrl: 'https://www.bitstamp.net/api/', observedAt,
      retrievedAt: ticker.retrievedAt, timestampPrecision: 'second',
      status: Date.now() - epoch * 1000 > 15 * 60000 ? 'stale' : 'live', reason: null,
      delay: '거래소 현물 스냅샷 · 데스크 최대 5분 캐시',
    };
  }
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
  return missing(instrument, '거래소 공개 API 접근 제한 또는 응답 오류');
}

async function finnhubList(entries, group, env, readURL) {
  if (!env.FINNHUB_API_KEY) return [];
  return Promise.all(entries.map(async ([symbol, name]) => {
    const instrument = { id: symbol.toLowerCase(), name, group, unit: 'USD' };
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
  if (!quote || quote.value === null) return null;
  const change = quote.change === null ? '등락 자료 없음' : `${quote.change > 0 ? '+' : ''}${quote.change.toFixed(2)}${quote.changeUnit}`;
  return `${quote.name} ${quote.value.toLocaleString('en-US', { maximumFractionDigits: 2 })}${quote.unit} / ${change} (${quote.observedAt}, ${quote.source})`;
}

function buildAnalysis(quotes) {
  const byId = Object.fromEntries(quotes.map((quote) => [quote.id, quote]));
  const evidence = ['sox', 'usdkrw', 'nasdaq', 'usreal10y', 'sp500', 'us10y', 'vix'].map((id) => fact(byId[id])).filter(Boolean);
  const available = quotes.filter((quote) => quote.value !== null).length;
  // These describe observed external conditions, not a price forecast. No news
  // attribution, probability, or causal assertion is inferred from price signs.
  function pairConditions(firstId, secondId, firstLabel, secondLabel, secondInverse = false) {
    const first = byId[firstId];
    const second = byId[secondId];
    const valid = (quote) => quote && quote.value !== null && quote.change !== null && quote.status !== 'stale' && quote.status !== 'missing';
    if (!valid(first) || !valid(second)) return { state: '판단 보류', text: '비교할 최근 관측 자료가 부족해 개장 전 외부 여건 판단을 보류합니다.' };
    const a = Math.sign(first.change);
    const b = Math.sign(second.change) * (secondInverse ? -1 : 1);
    const state = a > 0 && b > 0 ? '우호' : a < 0 && b < 0 ? '부담' : '혼재';
    const firstMove = first.change > 0 ? firstLabel[0] : first.change < 0 ? firstLabel[1] : firstLabel[2];
    const secondMove = second.change > 0 ? secondLabel[0] : second.change < 0 ? secondLabel[1] : secondLabel[2];
    return { state, text: `${firstMove}·${secondMove} 조합상 개장 전 외부 여건은 ${state === '우호' ? '우호적' : state === '부담' ? '부담 요인 우세' : '혼재'}입니다. 국내 수급을 확인하기 전 지수 방향은 확정하지 않습니다.` };
  }
  const kospiDay = pairConditions('sox', 'usdkrw', ['미국 반도체 상승', '미국 반도체 하락', '미국 반도체 보합'], ['원화 약세', '원화 강세', '원화 보합'], true);
  const kosdaqDay = pairConditions('nasdaq', 'usreal10y', ['나스닥 100 상승', '나스닥 100 하락', '나스닥 100 보합'], ['미 실질금리 상승', '미 실질금리 하락', '미 실질금리 보합'], true);
  const ruleSets = [
    ['day', '당일 · 최근 관측에 따른 개장 여건', kospiDay.text, kosdaqDay.text, ['미국 종가·ECB 기준환율은 서로 관측일이 다를 수 있고 한국 장중 움직임을 반영하지 않습니다.', '외국인 수급·국내 거래대금·개별 실적이 외부 여건과 다르게 움직일 수 있습니다.'], ['한국 장중 환율·반도체 흐름이 관측 조합과 반대로 전환하면 해석을 철회합니다.', '외국인 수급·거래대금이 동반 확인될 때에만 국내 방향 판단을 갱신합니다.']],
    ['short', '2~3거래일 · 흐름 지속 여부', '반도체 상대강도·환율·외국인 수급의 2~3일 지속 여부를 확인합니다. 현재 방향 판단 보류.', '거래대금 확산과 성장주 상대강도가 함께 지속되는지 확인합니다. 현재 방향 판단 보류.', ['하루의 반등은 추세 전환 근거로 부족합니다.'], ['미국 금리 재상승·원화 약세 전환 시 우호적 조건을 철회합니다.']],
    ['week', '1주 · 이벤트와 업종 순환', '경제 일정, 실적 발표와 주간 수급을 함께 확인해야 합니다. 실적·수급 자료가 부족해 방향 판단을 보류합니다.', '성장주 실적과 업종 내 상승 종목 확산을 확인해야 합니다. 실적 자료 미연동으로 판단 보류.', ['발표 전 전망과 발표 후 반응은 다를 수 있습니다.'], ['경제지표·실적 발표 후 금리와 이익 전망이 달라지면 다시 검토합니다.']],
    ['month', '1개월 · 거시와 이익 추세', '수출·이익 추정치·원화·글로벌 경기의 동반 개선 여부를 확인합니다. 해당 자료 미연동으로 판단 보류.', '실질금리·유동성·이익 추정치 개선이 함께 나타나는지 확인합니다. 해당 자료 미연동으로 판단 보류.', ['지수 상승과 이익 개선은 같은 의미가 아닙니다.'], ['실적 하향과 실질금리 상승이 지속되면 우호적 조건을 철회합니다.']],
    ['quarter', '분기 · 구조적 추세', '정책·수출 사이클·이익·밸류에이션으로 검토해야 합니다. 현재 자료만으로 분기 방향 판단 보류.', '정책·자금조달·기업 실적의 구조적 변화를 확인해야 합니다. 현재 자료만으로 분기 방향 판단 보류.', ['일별 시세만으로 분기 전망을 만들 수 없습니다.'], ['정책·이익 사이클의 변화가 확인되면 분석 전제를 갱신합니다.']],
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
      horizon, title, kospi, kosdaq, evidence: evidence.slice(0, 5), counter, invalidation,
      confidence: horizon === 'day' && (kospiDay.state !== '판단 보류' || kosdaqDay.state !== '판단 보류') ? '낮음 · 국내 수급 미확인' : '판단 보류',
      method: 'rules', label: horizon === 'day' ? '관측 조합의 조건부 해석 · 지수 방향 예측 아님' : '일반 조건 · 현재 방향 예측 아님',
    })),
  };
}

function sourceList(quotes, sectors, leaders, env) {
  const all = [...quotes, ...sectors, ...leaders];
  return [
    ['fred', 'FRED / 각 원자료 제공기관', 'https://fred.stlouisfed.org/', '일별 자료. 시리즈별 원천 이용조건·출처 표기 확인 필요', true],
    ['treasury', '미국 재무부', 'https://home.treasury.gov/policy-issues/financing-the-government/interest-rate-statistics/', '일별 수익률 곡선. FRED 금리 자료 실패 시 대체', true],
    ['frankfurter', 'ECB / Frankfurter', 'https://frankfurter.dev/', 'ECB 일별 기준환율. 실시간 현물환이 아님', true],
    ['bitstamp', 'Bitstamp', 'https://www.bitstamp.net/api/', '거래소 현물 스냅샷 및 24시간 등락', true],
    ['coinbase', 'Coinbase Spot', 'https://docs.cdp.coinbase.com/coinbase-app/docs/api-prices', 'Bitstamp 실패 시 대체. 수집시각 표시, 24시간 등락 미제공', true],
    ['finnhub', 'Finnhub', 'https://finnhub.io/docs/api/quote', '가입 권한에 따라 시세 지연·이용 범위가 다름. 섹터는 ETF 대용지표', Boolean(env.FINNHUB_API_KEY)],
    ['ecos', '한국은행 ECOS', 'https://ecos.bok.or.kr/', '국고채 3년·10년 금리(일별). 키 발급 및 이용조건 확인 필요', Boolean(env.ECOS_API_KEY)],
  ].map(([id, name, url, delay, enabled]) => ({
    id, name, url, delay, enabled,
    status: all.some((quote) => quote.provider === id && quote.value !== null && !quote.deploymentBackup) ? 'connected'
      : all.some((quote) => quote.provider === id && quote.deploymentBackup) ? 'backup'
      : ['treasury', 'coinbase'].includes(id) ? 'standby' : enabled ? 'no_data' : 'unconfigured',
  }));
}

function useDeploymentBackup(quotes, backup, now = Date.now()) {
  const saved = new Map(backup.map(quote => [quote.id, quote]));
  return quotes.map(quote => {
    if (quote.value !== null) return quote;
    const prior = saved.get(quote.id);
    if (!prior || !Number.isFinite(prior.value)) return quote;
    const observed = Date.parse(prior.observedAt);
    const retrieved = Date.parse(prior.retrievedAt);
    const ageLimit = (prior.timestampPrecision === 'day' ? 7 : 1) * 86400000;
    if (!Number.isFinite(observed) || !Number.isFinite(retrieved) || observed > now + 60000 || retrieved > now || now - observed > ageLimit || now - retrieved > ageLimit) return quote;
    return {
      ...prior,
      deploymentBackup: true,
      status: 'stale',
      reason: '공급자 요청 실패 · 배포 시 저장한 관측값',
      delay: '배포 시 저장한 관측값 · 현재 시세 아님',
    };
  });
}

export async function collectMarket(env, backup = []) {
  const { readURL, failures } = createMarketReader();
  const [initialQuotes, fx, sectors, leaders] = await Promise.all([
    Promise.all(INSTRUMENTS.map((instrument) => instrument.fred ? fredQuote(instrument, env, readURL) : instrument.ecos ? ecosQuote(instrument, env, readURL) : instrument.crypto ? cryptoQuote(instrument, readURL) : Promise.resolve(missing(instrument)))),
    fxQuotes(readURL), finnhubList(SECTORS, 'sector', env, readURL), finnhubList(LEADERS, 'equity', env, readURL),
  ]);
  const treasury = await treasuryFallback(initialQuotes, readURL);
  const replacements = new Map([...fx, ...treasury].map((quote) => [quote.id, quote]));
  const obtained = initialQuotes.map((quote) => replacements.get(quote.id) || quote);
  const quotes = useDeploymentBackup(obtained, backup);
  const available = quotes.filter((quote) => quote.value !== null).length;
  const { summary, outlooks } = buildAnalysis(quotes);
  const impact = buildImpact({ quotes });
  impact.validation = validateHistoricalImpact({ quotes });
  const restored = quotes.filter(quote => quote.deploymentBackup).length;
  if (restored) {
    summary.points.unshift(`실시간 공급자 요청 실패로 ${restored}개 지표에 배포 시 저장한 관측값을 표시합니다. 각 지표의 출처와 관측 시각을 확인하세요.`);
  }
  if (available === 0 || restored) {
    console.warn(available === 0 ? 'Market snapshot has no valid observations' : 'Market snapshot uses deployment backup', Object.fromEntries(failures));
    const labels = {
      response_received: '응답 수신 · 유효한 값 없음',
      invalid_json: '응답 형식 오류',
      response_too_large: '응답 크기 초과',
      timeout: '시간 초과',
      request_context: 'Worker 요청 범위 오류',
      dns_error: 'DNS 오류',
      tls_error: 'TLS 오류',
      outbound_denied: '외부 연결 거부',
      connection_lost: '연결 끊김',
      fetch_error: '요청 실패',
    };
    const report = [...failures].map(([key, count]) => {
      const [host, status] = key.split(' ');
      return `${host} ${labels[status] || status.replace('_', ' ')} ${count}건`;
    });
    if (report.length) summary.points.splice(restored ? 1 : summary.points.length, 0, `이번 조회 결과 · ${report.join(' / ')}`);
  }
  const mode = available === 0 ? 'unconfigured' : available === quotes.length && quotes.every((quote) => quote.status === 'live') ? 'live' : 'partial';
  return {
    asOf: new Date().toISOString(), mode, quotes, sectors, leaders, impact, events: [],
    summary, outlooks, sources: sourceList(quotes, sectors, leaders, env),
    analysis: { kind: 'rules', status: 'ready', label: '규칙 기반 · 조건부 점검' },
    cacheSeconds: TTL / 1000,
  };
}

async function configKey(env) {
  const identity = JSON.stringify([env.FRED_API_KEY || '', env.FINNHUB_API_KEY || '', env.ECOS_API_KEY || '']);
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
    const cacheRequest = new Request(`https://market-desk-cache.invalid/snapshot/v4/${key}`);
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
    const data = await collectMarket(env, deploymentSnapshot);
    if (snapshots.size > 8) snapshots.clear();
    snapshots.set(key, { data, time: Date.now() });
    if (cache) {
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
