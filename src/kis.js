/**
 * Read-only Korea Investment & Securities (KIS) public market-data adapter.
 * Credentials and bearer tokens never enter market snapshots or logs.
 * Excludes account, balance and order APIs entirely.
 * Official endpoints: FHKUP03500100 (index daily) and
 * FHPTJ04030000 (intraday) and FHPTJ04040000 (daily investor flow).
 */
import {usFutures, futuresPeriods} from '../public/futures-config.js';

const BASE = 'https://openapi.koreainvestment.com:9443';
const TIMEOUT_MS = 8000;
const domesticMarkets = [
  {id:'kospi', index:'0001', daily:'KSP', intraday:'S001'},
  {id:'kosdaq', index:'1001', daily:'KSQ', intraday:'S101'},
];
let tokenCache = null;
let pendingToken = null;

function val(x) {
  return x !== undefined && x !== null && String(x).trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : null;
}
function dateOf(s) {
  const text = String(s || '');
  if (!/^\d{8}$/.test(text)) return null;
  const result = `${text.slice(0,4)}-${text.slice(4,6)}-${text.slice(6,8)}`;
  return Number.isFinite(Date.parse(result + 'T00:00:00Z')) &&
    new Date(result + 'T00:00:00Z').toISOString().slice(0,10) === result ? result : null;
}
function todayKst() {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  return parts.replace(/\D/g, '');
}
function fromKstDaysAgo(days) {
  const now = new Date(Date.now()-days*86400000);
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now).replace(/\D/g,'');
}

export function kisConfigured(env) {
  return Boolean(typeof env?.KIS_APP_KEY==='string' && env.KIS_APP_KEY.trim() &&
    typeof env?.KIS_APP_SECRET==='string' && env.KIS_APP_SECRET.trim());
}

async function jsonRequest(url, init, fetchProvider = fetch, report) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), TIMEOUT_MS);
  try {
    const res=await fetchProvider(url,{...init,redirect:'manual',signal:controller.signal});
    if (Number(res.headers.get('content-length'))>1000000) {
      await res.body?.cancel().catch(()=>{});
      report?.({http:res.status,reason:'response_size'});
      return null;
    }
    if (!res.ok && !report) {
      await res.body?.cancel().catch(()=>{});
      return null;
    }
    const data=await res.json().catch(()=>null);
    const responseCode = data?.msg_cd || data?.error_code;
    const code = typeof responseCode === 'string' && /^[A-Z]{2,5}[0-9]{3,10}$/.test(responseCode) ? responseCode : undefined;
    report?.({http:res.status,code,reason:!res.ok ? 'http' : !data || typeof data!=='object' ? 'response_format' : undefined});
    return res.ok && data && typeof data==='object' ? data : null;
  } catch {
    report?.({reason:controller.signal.aborted ? 'timeout' : 'network'});
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function issueKisToken(env, report) {
  const data = await jsonRequest(BASE + '/oauth2/tokenP', {
    method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({grant_type:'client_credentials',appkey:env.KIS_APP_KEY,appsecret:env.KIS_APP_SECRET}),
  }, env.fetchProvider, report);
  if (typeof data?.access_token !== 'string' || !data.access_token) return null;
  const seconds = Number(data.expires_in);
  const ttl = seconds > 0 && Number.isFinite(seconds)
    ? Math.min(seconds - Math.min(300, Math.floor(seconds / 10)), 23 * 3600)
    : 3600;
  return {token:data.access_token, expiresAt:Date.now()+ttl*1000};
}

async function tokenFor(env, report, rejectedToken = null) {
  if (!kisConfigured(env)) return null;
  const appKey=env.KIS_APP_KEY, secret=env.KIS_APP_SECRET;
  if (tokenCache?.appKey === appKey && tokenCache.secret === secret && tokenCache.token !== rejectedToken
      && Date.now()<tokenCache.expiresAt) return tokenCache.token;
  if (env.KIS_TOKEN_BROKER) {
    try {
      const response = await env.KIS_TOKEN_BROKER.getByName('market-data').getToken(rejectedToken);
      for (const event of response.events || []) report?.(event);
      if (response.session?.token) {
        tokenCache = {appKey, secret, ...response.session};
        return response.session.token;
      }
    } catch {
      report?.({reason:'broker_unavailable'});
    }
    return null;
  }
  if (pendingToken?.appKey===appKey && pendingToken.secret===secret && pendingToken.rejectedToken === rejectedToken) return pendingToken.promise;
  const task = (async()=>{
    const issued = await issueKisToken(env, report);
    if (!issued?.token) return null;
    tokenCache={appKey,secret,...issued};
    return issued.token;
  })();
  pendingToken={appKey,secret,rejectedToken,promise:task};
  try {return await task;} finally {if(pendingToken?.promise===task)pendingToken=null;}
}

async function kisGet(env, token, path, trId, parameters, report) {
  const params=new URLSearchParams(parameters);
  let expired = false;
  const request = async accessToken=>jsonRequest(BASE+path+'?'+params.toString(),{
    method:'GET',
    headers:{accept:'application/json','content-type':'application/json',authorization:'Bearer '+accessToken,
      appkey:env.KIS_APP_KEY,appsecret:env.KIS_APP_SECRET,tr_id:trId,custtype:'P'},
  }, env.fetchProvider, event => {
    expired = event.code === 'EGW00123';
    report?.(event);
  });
  let data=await request(token);
  // A known expired token can be invalidated and refreshed only once.
  if (expired) {
    const refreshed=await tokenFor(env, report, token);
    data=refreshed?await request(refreshed):null;
  }
  return data?.rt_cd==='0' ? data : null;
}
function canonicalQuote(id, rows, field, div=1) {
  const newest = dateOf(todayKst());
  const history=(Array.isArray(rows)?rows:[])
    .map(r=>({date:dateOf(r?.stck_bsop_date),value:val(r?.[field])}))
    .filter(r=>r.date && r.value!==null && r.date<=newest)
    .map(r=>({date:r.date,value:r.value/div}))
    .sort((a,b)=>a.date.localeCompare(b.date));
  if (!history.length) return null;
  const last=history.at(-1), prev=history.findLast(row=>row.date<last.date);
  const flow=/^kr_(foreign|pension)_/.test(id);
  const age=Date.now()-Date.parse(last.date+'T23:59:59+09:00');
  return {
    id,group:'korea',provider:'kis',source:'한국투자증권 KIS Open API',
    sourceUrl:'https://apiportal.koreainvestment.com/',
    observedAt:last.date,retrievedAt:new Date().toISOString(),
    timestampPrecision:'day',status:age>7*86400000?'stale':'daily',
    value:last.value,change:prev?(flow?Number((last.value-prev.value).toFixed(4)) :
      prev.value?Number(((last.value-prev.value)/prev.value*100).toFixed(4)):null):null,
    changeUnit:flow?'억원':'%',unit:flow?'억원':'pt',
    comparisonAt:prev?.date||null,
    changeBasis:flow?'직전 관측일 외국인 순매수액과의 차이 · 당일 순매수 실측값과 구분':'직전 관측 종가 대비',
    history:history.slice(-65),
    delay:'일별 조회 · 장중 실시간 시세 아님',
    reason:age>7*86400000?'최근 지수/수급 관측일이 7일을 초과했습니다':null,
    basis:flow?'시장별 외국인 순매수 거래대금 · 백만원 단위 응답을 억원으로 변환':'국내 주가지수 일별 종가',
  };
}
// Use actual KIS OHLC rows. Never derive high/low/open from closing values.
function indexCandles(rows) {
  const observations = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const date = dateOf(row?.stck_bsop_date);
    const open = val(row?.bstp_nmix_oprc);
    const high = val(row?.bstp_nmix_hgpr);
    const low = val(row?.bstp_nmix_lwpr);
    const close = val(row?.bstp_nmix_prpr);
    if (!date || date > new Date().toISOString().slice(0,10)
      || [open,high,low,close].some(v => v === null || v <= 0)
      || low > high || low > Math.min(open,close) || high < Math.max(open,close)) continue;
    observations.set(date, {date,open,high,low,close});
  }
  return [...observations.values()].sort((a,b) => a.date.localeCompare(b.date)).slice(-150);
}

export function koreaSessionOpen(now = Date.now()) {
  const kst = new Date(now + 9 * 3600000);
  const day = kst.getUTCDay(), minute = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return day >= 1 && day <= 5 && minute >= 540 && minute < 930;
}

// The REST quote supplies the index value but no exchange observation timestamp.
async function intradayIndexQuote(env,token,id,iscd) {
  if (!koreaSessionOpen()) return null;
  const data=await kisGet(env,token,
    '/uapi/domestic-stock/v1/quotations/inquire-index-price','FHPUP02100000',
    {FID_COND_MRKT_DIV_CODE:'U',FID_INPUT_ISCD:iscd});
  const row=data?.output;
  const value=val(row?.bstp_nmix_prpr);
  const change=val(row?.bstp_nmix_prdy_ctrt);
  if(value===null || value<=0 || change===null || Math.abs(change)>30) return null;
  if (!koreaSessionOpen()) return null;
  const observedAt=new Date().toISOString();
  return {id,group:'korea',provider:'kis',source:'한국투자증권 KIS Open API',
    sourceUrl:'https://apiportal.koreainvestment.com/',
    value,change,changeUnit:'%',unit:'pt',
    observedAt,retrievedAt:observedAt,timestampPrecision:'retrieval',
    status:'delayed',marketPhase:'intraday',delay:'장중 지수 조회 · 실제 체결 시각 미제공',
    basis:'KIS 국내 업종지수 현재가 · 장중 조회',reason:null};
}
// KIS index minute OHLC; never infer intraday bars from daily closes.
function indexMinuteCandles(rows) {
  const seen=new Map();
  for(const row of Array.isArray(rows)?rows:[]) {
    const raw=String(row?.stck_bsop_date||'');
    const time=String(row?.stck_cntg_hour||'').padStart(6,'0');
    const date=dateOf(raw);
    if(!date || !/^\d{6}$/.test(time)) continue;
    const hh=Number(time.slice(0,2)),mm=Number(time.slice(2,4)),ss=Number(time.slice(4));
    if(hh<9 || hh>15 || mm>59 || ss>59 || hh===15 && mm>30)continue;
    const open=val(row.bstp_nmix_oprc),high=val(row.bstp_nmix_hgpr);
    const low=val(row.bstp_nmix_lwpr),close=val(row.bstp_nmix_prpr);
    if([open,high,low,close].some(x=>x===null||x<=0) || high<Math.max(open,close) || low>Math.min(open,close))continue;
    const stamp=`${date}T${time.slice(0,2)}:${time.slice(2,4)}:00+09:00`;
    if(Number.isNaN(Date.parse(stamp)))continue;
    seen.set(stamp,{date:stamp,open,high,low,close,value:close});
  }
  return [...seen.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-500);
}
async function indexMinuteQuote(env,token,iscd) {
  const data=await kisGet(env,token,'/uapi/domestic-stock/v1/quotations/inquire-time-indexchartprice',
    'FHKUP03500200',{FID_COND_MRKT_DIV_CODE:'U',FID_ETC_CLS_CODE:'0',
      FID_INPUT_ISCD:iscd,FID_INPUT_HOUR_1:'60',FID_PW_DATA_INCU_YN:'Y'});
  return indexMinuteCandles(data?.output2);
}
async function indexQuote(env,token,id,iscd) {
  // KIS FHKUP03500100 supports actual D/W/M periods and complete OHLC.
  const timeframes = [
    ['D', 210],
    ['W', 1095],
    ['M', 3650],
  ];
  const minutePromise=indexMinuteQuote(env,token,iscd);
  const replies = await Promise.all(timeframes.map(([period,days]) =>
    kisGet(env,token,'/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice',
      'FHKUP03500100',{
        FID_COND_MRKT_DIV_CODE:'U',FID_INPUT_ISCD:iscd,
        FID_INPUT_DATE_1:fromKstDaysAgo(days),FID_INPUT_DATE_2:todayKst(),
        FID_PERIOD_DIV_CODE:period,
      })));
  const minuteCandles=await minutePromise;
  const quote = canonicalQuote(id,replies[0]?.output2,'bstp_nmix_prpr');
  if (!quote) return null;
  return {
    ...quote,
    // Missing or invalid periods stay empty; the browser never fabricates candles.
    chartPeriods: Object.fromEntries(timeframes.map(([period],i) => [period,indexCandles(replies[i]?.output2)])),
    chartBasis: 'KIS 공식 일봉·주봉·월봉 및 조회된 1분 OHLC',
    minuteCandles,
  };
}
async function investorQuotes(env,token,iscd,market,suffix,sessionDate = null) {
  // KIS reference requires FID_INPUT_DATE_1 and _2 to be the SAME date.
  // Weekends use the previous business weekday; official holidays may yield
  // no rows, which must remain missing rather than inventing a flow.
  const ymd = todayKst();
  const weekday = new Date(`${ymd.slice(0,4)}-${ymd.slice(4,6)}-${ymd.slice(6,8)}T00:00:00Z`).getUTCDay();
  const date = sessionDate || fromKstDaysAgo(weekday === 0 ? 2 : weekday === 6 ? 1 : 0);
  const data=await kisGet(env,token,'/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market',
    'FHPTJ04040000',{
      FID_COND_MRKT_DIV_CODE:'U',FID_INPUT_ISCD:iscd,FID_INPUT_DATE_1:date,
      FID_INPUT_DATE_2:date,FID_INPUT_ISCD_1:market,FID_INPUT_ISCD_2:iscd,
    });
  // API may refuse a market/plan. Never replace actual flow with synthetic data.
  const rows = sessionDate
    ? (Array.isArray(data?.output) ? data.output.filter(row=>String(row?.stck_bsop_date) === sessionDate) : [])
    : data?.output;
  const quotes = [
    canonicalQuote(`kr_foreign_${suffix}`,rows,'frgn_ntby_tr_pbmn',100),
    canonicalQuote(`kr_pension_${suffix}`,rows,'fund_ntby_tr_pbmn',100),
  ].filter(Boolean);
  const today = dateOf(ymd);
  return quotes.map(quote => koreaSessionOpen() && quote.observedAt === today
    ? {...quote, marketPhase:'intraday', status:'delayed', delay:'당일 잠정 집계'} : quote);
}

async function intradayInvestorQuotes(env, token, market, report) {
  if (!koreaSessionOpen()) return [];
  const data = await kisGet(env, token,
    '/uapi/domestic-stock/v1/quotations/inquire-investor-time-by-market', 'FHPTJ04030000',
    {FID_INPUT_ISCD:'999', FID_INPUT_ISCD_2:market.intraday},
    event => { if (event.reason || event.code && event.code !== 'MCA00000') report?.({market:market.id, ...event}); });
  const row = Array.isArray(data?.output) ? data.output.length === 1 ? data.output[0] : null : data?.output;
  if (!row || !koreaSessionOpen()) return [];
  const retrievedAt = new Date().toISOString();
  return [
    ['foreign', row.frgn_ntby_tr_pbmn], ['pension', row.fund_ntby_tr_pbmn],
  ].flatMap(([investor, raw]) => {
    const amount = val(raw);
    return amount === null ? [] : [{
      id:`kr_${investor}_${market.id}`, group:'korea', provider:'kis',
      source:'한국투자증권 KIS Open API', sourceUrl:'https://apiportal.koreainvestment.com/',
      unit:'억원', value:amount / 100, change:null, changeUnit:'억원',
      observedAt:retrievedAt, retrievedAt, timestampPrecision:'retrieval', status:'delayed', marketPhase:'intraday',
      basis:'장중 누적 순매수 거래대금', delay:'장중 집계 · 실제 집계 시각 미제공',
    }];
  });
}

async function intradayKorea(env, token, report) {
  return (await Promise.all(domesticMarkets.flatMap(market => [
    intradayIndexQuote(env, token, market.id, market.index),
    intradayInvestorQuotes(env, token, market, report),
  ]))).flat().filter(Boolean);
}

async function previousInvestorSession(env, token, market, today) {
  const weekday = new Date(dateOf(today) + 'T00:00:00Z').getUTCDay();
  const expected = fromKstDaysAgo(weekday === 1 ? 3 : 1);
  const read = date => investorQuotes(env, token, market.index, market.daily, market.id, date);
  const regular = await read(expected);
  if (regular.length) return regular;

  // The most recent weekday can be an exchange holiday. Confirm any earlier session using index history.
  const data = await kisGet(env, token, '/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice',
    'FHKUP03500100', {FID_COND_MRKT_DIV_CODE:'U', FID_INPUT_ISCD:market.index,
      FID_INPUT_DATE_1:fromKstDaysAgo(12), FID_INPUT_DATE_2:expected, FID_PERIOD_DIV_CODE:'D'});
  const previous = canonicalQuote(market.id, data?.output2, 'bstp_nmix_prpr')?.observedAt?.replaceAll('-','');
  return previous && previous < expected ? read(previous) : [];
}

async function withInvestorChanges(quotes, env, token, cache) {
  if (!quotes.some(quote=>quote.unit==='억원')) return quotes;
  const now = Date.now(), today = todayKst();
  const references = await Promise.all(domesticMarkets.map(async market=>{
    if (!quotes.some(quote=>quote.unit==='억원' && quote.id.endsWith(market.id))) return [];
    const entry = cache.get(market.id);
    if (entry?.today === today && now < entry.expiresAt) return entry.rows;
    const rows = await previousInvestorSession(env, token, market, today);
    cache.set(market.id, {today, rows, expiresAt: rows.length === 2 ? Infinity : now + 120_000});
    return rows;
  }));
  const byId = new Map(references.flat().map(row=>[row.id,row]));
  return quotes.map(quote=>{
    const previous = byId.get(quote.id);
    return previous ? {...quote, change:Number((quote.value - previous.value).toFixed(2)),
      comparisonAt:previous.observedAt, changeBasis:'직전 거래일 최종 순매수액 대비'} : quote;
  });
}

export async function collectKisIntraday(env, report, flowCache) {
  if (!koreaSessionOpen() || !kisConfigured(env)) return [];
  const token = await tokenFor(env, report);
  if (!token) return [];
  const quotes = await intradayKorea(env, token, report);
  return flowCache ? withInvestorChanges(quotes, env, token, flowCache) : quotes;
}

async function currentKorea(env, token) {
  if (!koreaSessionOpen()) return [];
  if (env.US_BRIEFING) {
    try { return (await env.US_BRIEFING.getByName('korea-intraday').latestKorea()).quotes; }
    catch { /* A cold binding can still use the same read-only endpoint. */ }
  }
  return intradayKorea(env, token);
}

export async function collectKis(env) {
  if(!kisConfigured(env)) return [];
  const token=await tokenFor(env);
  if(!token) return [];
  const [charts, current] = await Promise.all([
    Promise.all(domesticMarkets.map(market => indexQuote(env, token, market.id, market.index))),
    currentKorea(env, token),
  ]);
  const flows = await Promise.all(domesticMarkets.filter(({id}) =>
    !['foreign','pension'].every(investor => current.some(quote => quote.id === `kr_${investor}_${id}`)))
    .map(market => investorQuotes(env, token, market.index, market.daily, market.id)));
  // Intraday observations override the corresponding daily snapshot only when validated.
  const byId=new Map();
  for(const quote of [...charts, ...flows.flat(), ...current].filter(Boolean)) {
    const prior=byId.get(quote.id);
    byId.set(quote.id,prior ? {...prior,...quote,chartPeriods:prior.chartPeriods,chartBasis:prior.chartBasis,minuteCandles:prior.minuteCandles,history:prior.history} : quote);
  }
  return [...byId.values()];
}

/**
 * Overseas KIS quote-first candidates, strictly read-only. The configured
 * index symbols are probed; any invalid/missing response preserves FRED.
 * US sector ETFs use the AMEX/NYSE Arca pricing code AMS; invalid responses
 * preserve Finnhub without attributing an unsupported exchange.
 */
const OVERSEAS_INDEXES = [
  ['sp500', '.INX'],
  ['nasdaq', '.NDX'],
  ['nasdaqcom', '.IXIC'],
  ['sox', '.SOX'],
];
const OVERSEAS_SECURITIES = [
  ['NVDA','엔비디아','equity','NAS'],['AAPL','애플','equity','NAS'],
  ['MSFT','마이크로소프트','equity','NAS'],['AMZN','아마존','equity','NAS'],
  ['GOOGL','알파벳','equity','NAS'],['META','메타','equity','NAS'],
  ['TSLA','테슬라','equity','NAS'],
  ['XLK','기술','sector','AMS'],['XLF','금융','sector','AMS'],
  ['XLE','에너지','sector','AMS'],['XLV','헬스케어','sector','AMS'],
  ['XLY','경기소비재','sector','AMS'],['XLP','필수소비재','sector','AMS'],
  ['XLI','산업재','sector','AMS'],['XLB','소재','sector','AMS'],
  ['XLU','유틸리티','sector','AMS'],['XLRE','부동산','sector','AMS'],
  ['XLC','통신서비스','sector','AMS'],
];

function overseasSecurityQuote(id,name,group,exchange,symbol,row) {
  const value=val(row?.last),change=val(row?.rate);
  if(value===null||value<=0||!Number.isFinite(change)||Math.abs(change)>100) return null;
  if(typeof row.rsym==='string' && row.rsym.trim() &&
     !row.rsym.trim().toUpperCase().endsWith(symbol)) return null;
  // KIS last-price response has NO actual observation timestamp.
  // fetchedAt is a retrieval time, not an exchange trade time.
  const fetchedAt=new Date().toISOString();
  return {
    id,provider:'kis',source:'한국투자증권 KIS Open API',sourceUrl:'https://apiportal.koreainvestment.com/',
    name,symbol,group,unit:'USD',value,change,changeUnit:'%',
    changeBasis:'한투 제공 전일 종가 대비 변동률',
    observedAt:fetchedAt,retrievedAt:fetchedAt,timestampPrecision:'retrieval',
    status:'delayed',history:[],reason:null,
    basis:group==='sector'?'미국 상장 섹터 ETF · 실제 섹터 지수는 아님':'미국 상장 종목',
    delay:'해외주식 현재체결가 · 거래소 체결시각 미제공 · 조회시각 별도 표시 · 실시간 여부는 이용권한에 따름',
  };
}

async function overseasIndexQuote(env,token,id,code) {
  const data=await kisGet(env,token,'/uapi/overseas-price/v1/quotations/inquire-daily-chartprice',
    'FHKST03030100',{
      FID_COND_MRKT_DIV_CODE:'N',FID_INPUT_ISCD:code,
      FID_INPUT_DATE_1:fromKstDaysAgo(145),FID_INPUT_DATE_2:todayKst(),
      FID_PERIOD_DIV_CODE:'D',
    });
  const bars=Array.isArray(data?.output2) ? data.output2 : [];
  const history=bars.map(row=>({
    date:dateOf(row?.stck_bsop_date),value:val(row?.ovrs_nmix_prpr),
    open:val(row?.ovrs_nmix_oprc),high:val(row?.ovrs_nmix_hgpr),
    low:val(row?.ovrs_nmix_lwpr),
  })).filter(row=>row.date&&row.value!==null&&row.value>0
    && row.date<=new Date().toISOString().slice(0,10))
    .sort((a,b)=>a.date.localeCompare(b.date));
  if(!history.length) return null;
  const last=history.at(-1),prev=history.at(-2);
  const age=Date.now()-Date.parse(last.date+'T23:59:59-04:00');
  if(age>7*86400000 || age < -86400000) return null;
  return {
    id,provider:'kis',source:'한국투자증권 KIS Open API',
    sourceUrl:'https://apiportal.koreainvestment.com/',observedAt:last.date,
    retrievedAt:new Date().toISOString(),timestampPrecision:'day',status:'daily',
    value:last.value,change:prev?.value ? (last.value-prev.value)/prev.value*100:null,
    changeUnit:'%',changeBasis:'KIS 해외지수 직전 관측 종가 대비',unit:'pt',
    history:history.map(({date,value})=>({date,value})).slice(-65),
    basis:'한투 해외지수 일별 종가 · FRED 동일 지수 대조 후 우선 적용',
    delay:'해외지수 종가 · 장중 실시간 시세 아님',reason:null,
  };
}

async function overseasSecurity(env,token,[symbol,name,group,exchange]) {
  const data=await kisGet(env,token,'/uapi/overseas-price/v1/quotations/price',
    'HHDFS00000300',{AUTH:'',EXCD:exchange,SYMB:symbol});
  return overseasSecurityQuote(symbol.toLowerCase(),name,group,exchange,symbol,data?.output);
}

/**
 * Read-only overseas quote candidates, and never a reason to lose older
 * FRED/Finnhub feeds. Limits concurrent requests to respect KIS rate limits.
 */
export async function collectKisOverseas(env, kind) {
  if(!kisConfigured(env)) return {indices:[],sectors:[],leaders:[]};
  const token=await tokenFor(env);
  if(!token) return {indices:[],sectors:[],leaders:[]};
  const tasks=[
    ...(kind === 'securities' ? [] : OVERSEAS_INDEXES.map(([id,code])=>()=>overseasIndexQuote(env,token,id,code))),
    ...(kind === 'indices' ? [] : OVERSEAS_SECURITIES.map(entry=>()=>overseasSecurity(env,token,entry))),
  ];
  const results=[];
  for(let i=0;i<tasks.length;i+=4) {
    // Domestic KIS uses the same key. Pace overseas batches so concurrent
    // domestic D/W/M requests do not exhaust the account's per-second limit.
    await new Promise(resolve=>setTimeout(resolve,350));
    if (env.hasProviderBudget && !env.hasProviderBudget()) break;
    const batch=await Promise.all(tasks.slice(i,i+4).map(task=>task().catch(()=>null)));
    results.push(...batch.filter(Boolean));
  }
  return {
    indices:results.filter(q=>OVERSEAS_INDEXES.some(([id])=>id===q.id)),
    sectors:results.filter(q=>q.group==='sector'),
    leaders:results.filter(q=>q.group==='equity'),
  };
}


/**
 * Read-only capability probes for exact KR sovereign benchmark yields and
 * ICE DXY spot index. Do not assume a bond coupon/YTM or USD futures contract
 * is the benchmark index. Official comp-interest examples document class 1
 * as overseas rates; class 2 is probed only, never assumed supported.
 */
function rateQuoteByName(rows,id,years) {
  const matches=(Array.isArray(rows)?rows:[]).filter(row=>{
    const label=String(row?.hts_kor_isnm||'').replace(/\s+/g,'');
    const isKoreanSovereign=/(국고채|대한민국국채|한국국채|KTB|Korea(?:n)?Treasury)/i.test(label) && !/(미국|선물|futures|future|ETF)/i.test(label);
    const maturity = years===3 ? /(3년|3Y|3YR|3YEAR)/i : /(10년|10Y|10YR|10YEAR)/i;
    return isKoreanSovereign && maturity.test(label);
  }).map(row=>{
    const rate=val(row?.bond_mnrt_prpr);
    const date=dateOf(row?.stck_bsop_date);
    if(!date||date>new Date().toISOString().slice(0,10)
      || rate===null||rate<=0||rate>=25)return null;
    return {date,value:rate};
  }).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date));
  if(!matches.length)return null;
  const last=matches.at(-1);
  const previous=matches.findLast(row=>row.date<last.date);
  const age=Date.now()-Date.parse(last.date+'T23:59:59+09:00');
  if(age>7*86400000 || age < -86400000)return null;
  return {
    id,provider:'kis',source:'한국투자증권 KIS Open API',sourceUrl:'https://apiportal.koreainvestment.com/',
    observedAt:last.date,retrievedAt:new Date().toISOString(),timestampPrecision:'day',
    status:'daily',value:last.value,unit:'%',change:previous ? Number(((last.value-previous.value)*100).toFixed(4)) : null,changeUnit:'bp',
    comparisonAt:previous?.date || null, changeBasis:'직전 관측일 대비',
    history:matches.slice(-65),basis:`국고채 ${years}년 대표금리 명칭을 가진 한투 금리종합 관측값`,
    delay:'한투 금리종합 일별 관측 · 체결 시각 보증 없음',reason:null,
  };
}

async function probeKisRates(env,token) {
  const path='/uapi/domestic-stock/v1/quotations/comp-interest';
  const calls=['1','2'].map(cls=>kisGet(env,token,path,'FHPST07020000',{
    FID_COND_MRKT_DIV_CODE:'I',FID_COND_SCR_DIV_CODE:'20702',
    FID_DIV_CLS_CODE:cls,FID_DIV_CLS_CODE1:'',
  }));
  const responses=await Promise.all(calls);
  const normalize=output=>Array.isArray(output)?output:output&&typeof output==='object'?[output]:[];
  const rows=responses.flatMap(data=>[...normalize(data?.output1),...normalize(data?.output2)]);
  return [rateQuoteByName(rows,'kr3y',3),rateQuoteByName(rows,'kr10y',10)].filter(Boolean);
}

async function probeKisDxy(env,token) {
  // .DXY is a candidate only; validate provider metadata explicitly.
  // N means OVERSEAS INDEX, not the separate ICE currency-futures contract.
  const data=await kisGet(env,token,'/uapi/overseas-price/v1/quotations/inquire-daily-chartprice',
    'FHKST03030100',{
      FID_COND_MRKT_DIV_CODE:'N',FID_INPUT_ISCD:'.DXY',
      FID_INPUT_DATE_1:fromKstDaysAgo(90),FID_INPUT_DATE_2:todayKst(),
      FID_PERIOD_DIV_CODE:'D',
    });
  const info=Array.isArray(data?.output1)?data.output1[0]:data?.output1;
  const name=String(info?.hts_kor_isnm||'');
  if (!/(dxy|u\.?s\.?\s*dollar\s*index|미국\s*달러\s*(지수|인덱스))/i.test(name)
      || /(선물|futures|future|ETF)/i.test(name))return null;
  const index=overseasIndexQuoteFromResponse(data);
  return index ? {...index,id:'dxy',
    basis:'한투 해외지수 DXY · 원자료 명칭 검증 · ICE 선물 시세가 아님',
    changeBasis:'직전 관측 종가 대비',
  } : null;
}

function overseasIndexQuoteFromResponse(data) {
  const history=(Array.isArray(data?.output2)?data.output2:[]).map(row=>({
    date:dateOf(row?.stck_bsop_date),value:val(row?.ovrs_nmix_prpr),
  })).filter(x=>x.date&&x.value!==null&&x.value>0&&
    x.date<=new Date().toISOString().slice(0,10)).sort((a,b)=>a.date.localeCompare(b.date));
  if(!history.length)return null;
  const last=history.at(-1),prev=history.at(-2);
  const age=Date.now()-Date.parse(last.date+'T23:59:59-04:00');
  if(age>7*86400000||age< -86400000)return null;
  return {
    provider:'kis',source:'한국투자증권 KIS Open API',
    sourceUrl:'https://apiportal.koreainvestment.com/',
    observedAt:last.date,retrievedAt:new Date().toISOString(),timestampPrecision:'day',
    status:'daily',value:last.value,unit:'pt',change:prev?.value?
      (last.value-prev.value)/prev.value*100:null,changeUnit:'%',
    history:history.slice(-65),delay:'해외지수 일별 종가 · 실시간 시세 아님',
    reason:null,
  };
}

// Called only server-side, with existing Cloudflare KIS Secrets and cached token.
// Invalid response / unrelated instrument => no substitution.
let macroCache = null;
let macroPending = null;
export async function collectKisMacro(env) {
  if(!kisConfigured(env))return [];
  const key=env.KIS_APP_KEY;
  if(macroCache?.appKey===key && macroCache.secret===env.KIS_APP_SECRET && Date.now()<macroCache.expiresAt)
    return structuredClone(macroCache.result);
  if(macroPending?.appKey===key && macroPending.secret===env.KIS_APP_SECRET)return structuredClone(await macroPending.promise);
  const task=(async()=>{
    const token=await tokenFor(env);
    if(!token)return [];
    const [rates,dxy]=await Promise.all([
      probeKisRates(env,token).catch(()=>[]),
      probeKisDxy(env,token).catch(()=>null),
    ]);
    const result=[...rates,...(dxy?[dxy]:[])];
    // Negative probes are deliberately cached too: no repeated blind requests
    // for an unsupported code every five-minute market refresh.
    macroCache={appKey:key,secret:env.KIS_APP_SECRET,expiresAt:Date.now()+60*60000,result};
    return result;
  })();
  macroPending={appKey:key,secret:env.KIS_APP_SECRET,promise:task};
  try{return structuredClone(await task)}
  finally{if(macroPending?.promise===task)macroPending=null}
}


/**
 * Exact-symbol lookup for the member-only instrument search. Query API is
 * read-only, one submitted symbol at a time; this does not enumerate accounts
 * or use stock-order endpoints.
 */
export async function lookupKisInstrument(env, market, symbol, requestedExchange = '') {
  if (!kisConfigured(env)) return null;
  const token=await tokenFor(env);
  if(!token) return null;
  const currentTime=new Date().toISOString();
  if (market==='KR' && /^[0-9]{6}$/.test(symbol)) {
    const quote=await kisGet(env,token,'/uapi/domestic-stock/v1/quotations/inquire-price',
      'FHKST01010100',{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:symbol});
    const value=val(quote?.output?.stck_prpr);
    if(value===null || value<=0)return null;
    const info=await kisGet(env,token,'/uapi/domestic-stock/v1/quotations/search-stock-info',
      'CTPF1002R',{PRDT_TYPE_CD:'300',PDNO:symbol});
    const row=Array.isArray(info?.output)?info.output[0]:info?.output;
    const verifiedInfo=String(row?.pdno||'')===symbol?row:null;
    const change=val(quote.output.prdy_ctrt);
    return {
      market:'KR',symbol,exchange:'KRX',
      name:String(verifiedInfo?.prdt_name||verifiedInfo?.prdt_abrv_name||symbol).slice(0,85),
      value,unit:'KRW',change:change!==null&&Math.abs(change)<=100?change:null,changeUnit:'%',
      provider:'kis',source:'한국투자증권 KIS Open API',
      sourceUrl:'https://apiportal.koreainvestment.com/',
      observedAt:currentTime,timestampPrecision:'retrieval',status:'delayed',
      delay:'국내주식 현재가 조회 · 거래소 최종 체결시각 미제공 · 조회시각 표시 (실시간 여부 미보장)',
    };
  }
  if(market!=='US' || !/^[A-Z][A-Z0-9.\-]{0,10}$/.test(symbol))return null;
  const codes={NAS:'512',NYS:'513',AMS:'529'};
  const exchanges=requestedExchange && codes[requestedExchange]?[requestedExchange]:['NAS','NYS','AMS'];
  for(const exchange of exchanges){
    const quote=await kisGet(env,token,'/uapi/overseas-price/v1/quotations/price',
      'HHDFS00000300',{AUTH:'',EXCD:exchange,SYMB:symbol});
    const row=quote?.output;
    const value=val(row?.last);
    if(value===null||value<=0 || (typeof row?.rsym==='string' && row.rsym.trim()
       && !row.rsym.trim().toUpperCase().endsWith(symbol)))continue;
    const info=await kisGet(env,token,'/uapi/overseas-price/v1/quotations/search-info',
      'CTPF1702R',{PRDT_TYPE_CD:codes[exchange],PDNO:symbol});
    const metadata=Array.isArray(info?.output)?info.output[0]:info?.output;
    const verifiedInfo=String(metadata?.pdno||'').toUpperCase()===symbol?metadata:null;
    const change=val(row?.rate);
    return {
      market:'US',symbol,exchange,
      name:String(verifiedInfo?.ovrs_item_name||verifiedInfo?.prdt_eng_name||verifiedInfo?.prdt_name||symbol).slice(0,85),
      value,unit:'USD',change:change!==null&&Math.abs(change)<=100?change:null,changeUnit:'%',
      provider:'kis',source:'한국투자증권 KIS Open API',
      sourceUrl:'https://apiportal.koreainvestment.com/',
      observedAt:currentTime,timestampPrecision:'retrieval',status:'delayed',
      delay:'해외주식 현재체결가 · 거래소 체결시각 미제공 · 이용권한에 따라 지연 가능',
    };
  }
  return null;
}

const futuresBase = '/uapi/overseas-futureoption/v1/quotations/';
const chicagoClock = new Intl.DateTimeFormat('en-US', {timeZone: 'America/Chicago',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'});
const futuresQuotes = new Map();
const futuresCharts = new Map();
const futuresQuoteSource = '한국투자증권 KIS 해외선물';
const futuresSourceUrl = 'https://apiportal.koreainvestment.com/';

async function kisFuturesGet(env, token, path, trId, parameters, stage, report) {
  let retry = false;
  const record = event => {
    // Record only the instrument identifier and response classification.
    report({stage, contract: parameters.SRS_CD, ...event});
  };
  const result = await kisGet(env, token, path, trId, parameters, event => {
    retry = (event.http >= 500 || event.reason === 'network') && event.code !== 'EGW00201';
    record(event);
  });
  if (result || !retry) return result;
  await new Promise(resolve => setTimeout(resolve, 400));
  return kisGet(env, token, path, trId, parameters, record);
}

function chicago(now) {
  return Object.fromEntries(chicagoClock.formatToParts(now)
    .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

export function futuresContract(root, now = Date.now()) {
  const {year, month, day, hour} = chicago(now);
  const quarter = Math.ceil(month / 3);
  const expiration = quarter * 3;
  const firstWeekday = new Date(Date.UTC(year, expiration - 1, 1)).getUTCDay();
  const thirdFriday = 15 + (5 - firstWeekday + 7) % 7;
  // Use the customary roll on Monday of expiry week at the Sunday evening open.
  const roll = month === expiration && (day >= thirdFriday - 4 || (day === thirdFriday - 5 && hour >= 17));
  const index = quarter - 1 + Number(roll);
  return `${root}${'HMUZ'[index % 4]}${String(year + Math.floor(index / 4)).slice(-2)}`;
}

function futuresSession(now) {
  const {year, month, day, hour} = chicago(now);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (weekday === 6 || (weekday === 0 && hour < 17) || (weekday === 5 && hour >= 16)) return '주말 휴장 시간';
  if (weekday >= 1 && weekday <= 4 && hour === 16) return '일일 점검 시간';
  return '거래 시간대 · 휴일 일정 별도';
}

function futuresDate(value) {
  return dateOf(String(value ?? '').trim().replaceAll('-', ''));
}

function providerStamp(day, clock) {
  const date = futuresDate(day);
  const rawTime = String(clock ?? '').trim().replaceAll(':', '');
  const time = rawTime.padStart(6, '0');
  if (!date || !rawTime || !/^([01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(time)) return null;
  return `${date} ${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4)}`;
}

function validFuturesDate(date, now) {
  return date && Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - now <= 86400000;
}

function futuresIdentity(row, contract) {
  const returned = String(row?.srs_cd || contract).trim().toUpperCase();
  const currency = String(row?.crc_cd || 'USD').trim().toUpperCase();
  return returned === contract && currency === 'USD';
}

function futuresQuote(row, product, contract, now) {
  const value = val(row?.last_price);
  if (!(value > 0) || !futuresIdentity(row, contract)) return null;
  const date = futuresDate(row?.proc_date);
  if (date && !validFuturesDate(date, now)) return null;
  const timestamp = providerStamp(row?.proc_date, row?.proc_time);
  const observedAt = timestamp || date;
  const previous = val(row.prev_price);
  const stale = date && now - Date.parse(`${date}T23:59:59Z`) > 3 * 86400000;
  return {id: product.id, name: product.name, group: 'futures', contract, exchange: product.exchange,
    value, change: previous > 0 ? (value - previous) / previous * 100 : null, changeUnit: '%', unit: 'pt',
    source: futuresQuoteSource, sourceUrl: futuresSourceUrl, observedAt, retrievedAt: new Date(now).toISOString(),
    timestampPrecision: timestamp ? 'provider_clock' : date ? 'day' : 'retrieval',
    expiresOn: futuresDate(row.expr_date) || null, status: stale ? 'stale' : 'delayed', session: futuresSession(now),
    basis: '선물 계약 현재가 · 전일종가 대비', delay: timestamp ? 'KIS 제공 시각 기준 · 지연 가능' : '체결 시각 미제공 · 확인 가능한 날짜 또는 조회 시각 표시'};
}

function futuresQuoteFromBars(product, contract, result, period, now) {
  if (result.status !== 'ready') return null;
  const latest = result.bars.at(-1);
  const previous = result.bars.at(-2);
  if (!latest || now - Date.parse(`${latest.date.slice(0, 10)}T23:59:59Z`) > 3 * 86400000) return null;
  const daily = period === 'D';
  return {id: product.id, name: product.name, group: 'futures', contract, exchange: product.exchange,
    value: latest.close, change: daily && previous ? (latest.close - previous.close) / previous.close * 100 : null,
    changeUnit: '%', unit: 'pt', source: futuresQuoteSource, sourceUrl: futuresSourceUrl,
    observedAt: latest.date, timestampPrecision: daily ? 'day' : 'provider_clock', status: daily ? 'daily' : 'delayed',
    session: futuresSession(now), basis: daily ? '동일 계약의 최근 일봉 종가' : '동일 계약의 최근 5분봉 종가',
    fallbackPeriod: period, delay: '한투 현재가 조회 실패 시 같은 선물 계약의 관측 봉 사용'};
}

export async function collectKisFutures(env, now = Date.now(), report = () => {}) {
  if (!kisConfigured(env)) { report({stage:'token',reason:'missing_configuration'}); return []; }
  const token = await tokenFor(env, event => report({stage:'token',...event}));
  if (!token) { report({stage:'token',reason:'no_token'}); return []; }
  const rows = await Promise.all(usFutures.map(async (product, index) => {
    const contract = futuresContract(product.root, now);
    const key = `${env.KIS_APP_KEY}:${contract}`;
    const saved = futuresQuotes.get(key);
    if (saved && now - saved.time < 60000) return {...saved.quote, session: futuresSession(now)};
    if (index) await new Promise(resolve => setTimeout(resolve, index * 250));
    const data = await kisFuturesGet(env, token, futuresBase + 'inquire-price', 'HHDFC55010000', {SRS_CD: contract}, 'quote', report);
    const candidates = [data?.output1, data?.output, data?.output2].flat().filter(Boolean);
    const row = candidates.find(item => item.last_price != null);
    const canUseBars = !row || futuresIdentity(row, contract);
    let quote = futuresQuote(row, product, contract, now);
    if (!quote && canUseBars) {
      if (data) report({stage:'quote',contract,reason:'no_price'});
      for (const period of ['5min', 'D']) {
        const result = await loadKisFuturesChart(env, product.id, period, now, report);
        quote = futuresQuoteFromBars(product, contract, result, period, now);
        if (quote) break;
      }
    }
    if (!quote) return saved && now - saved.time < 36 * 3600000
      ? {...saved.quote, status: 'stale', savedFrom: 'cache', session: futuresSession(now)} : null;
    if (futuresQuotes.size >= 24) futuresQuotes.clear();
    futuresQuotes.set(key, {time: now, quote});
    return quote;
  }));
  return rows.filter(Boolean);
}

function priceBars(data, intraday, now) {
  // Overseas KIS endpoints include separate metadata and price records.
  const rows = [...[data?.output1, data?.output2].flat()].filter(Boolean);
  const bars = new Map();
  for (const row of rows) {
    const date = intraday ? providerStamp(row.data_date, row.data_time) : futuresDate(row.data_date);
    const [open, high, low, close] = [row.open_price, row.high_price, row.low_price, row.last_price].map(val);
    if (!validFuturesDate(date, now) || ![open, high, low, close].every(x => x > 0) || high < Math.max(open, close) || low > Math.min(open, close)) continue;
    bars.set(date, {date, open, high, low, close, value: close});
  }
  return [...bars.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function futuresBarBucket(date, period) {
  if (period === 'M') return date.slice(0, 7);
  if (period === 'W') {
    const start = new Date(`${date}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
    return start.toISOString().slice(0, 10);
  }
  const minutes = Number.parseInt(period, 10);
  const minuteOfDay = Number(date.slice(11, 13)) * 60 + Number(date.slice(14, 16));
  return `${date.slice(0, 10)}:${Math.floor(minuteOfDay / minutes)}`;
}

function regroupFuturesBars(bars, period) {
  if (!['W', 'M', '3min', '240min'].includes(period)) return bars;
  const grouped = new Map();
  for (const bar of bars) {
    const key = futuresBarBucket(bar.date, period);
    const group = grouped.get(key);
    if (group) {
      group.high = Math.max(group.high, bar.high);
      group.low = Math.min(group.low, bar.low);
      group.close = group.value = bar.close;
    } else grouped.set(key, {...bar});
  }
  return [...grouped.values()];
}

export async function loadKisFuturesChart(env, id, period, now = Date.now(), report = () => {}) {
  const product = usFutures.find(item => item.id === id);
  if (!product || !futuresPeriods.some(([key]) => key === period)) return {status: 'invalid', bars: []};
  const contract = futuresContract(product.root, now);
  const token = await tokenFor(env);
  if (!token) return {status: 'unavailable', contract, bars: [], reason: 'auth'};
  const key = `${env.KIS_APP_KEY}:${contract}:${period}`;
  const saved = futuresCharts.get(key);
  if (saved && now - saved.time < 60000) return saved.result;
  const intraday = period.endsWith('min');
  const gap = period === '3min' ? '1' : period === '240min' ? '60' : period.replace('min', '');
  // KIS's official overseas futures master uses CME for its Mini Dow contracts as well.
  const kisExchange = product.root === 'YM' ? 'CME' : product.exchange;
  const stage = intraday ? 'intraday' : 'daily';
  const data = await kisFuturesGet(env, token, futuresBase + (intraday ? 'inquire-time-futurechartprice' : 'daily-ccnl'),
    intraday ? 'HHDFC55020400' : 'HHDFC55020100', {SRS_CD: contract, EXCH_CD: kisExchange,
      START_DATE_TIME: '', CLOSE_DATE_TIME: todayKst(), QRY_TP: 'Q', QRY_CNT: intraday ? '120' : '100',
      QRY_GAP: intraday ? gap : '', INDEX_KEY: ''}, stage, report);
  const bars = regroupFuturesBars(priceBars(data, intraday, now), period);
  if (!bars.length && saved && now - saved.time < 36 * 3600000) return {...saved.result, status: 'stale'};
  if (!bars.length && data) report({stage,contract,reason:'no_bars'});
  const result = {status: bars.length ? 'ready' : 'unavailable', bars, contract, source: futuresQuoteSource, sourceUrl: futuresSourceUrl,
    ...(bars.length ? {} : {reason: data ? 'no_bars' : 'supplier'})};
  if (futuresCharts.size >= 60) futuresCharts.clear();
  if (bars.length) futuresCharts.set(key, {time: now, result});
  return result;
}
