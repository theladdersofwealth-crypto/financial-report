/**
 * Read-only Korea Investment & Securities (KIS) public market-data adapter.
 * Credentials and bearer tokens never enter market snapshots or logs.
 * Excludes account, balance and order APIs entirely.
 * Official endpoints: FHKUP03500100 (index daily) and
 * FHPTJ04040000 (market daily investor flow).
 */
const BASE = 'https://openapi.koreainvestment.com:9443';
const TIMEOUT_MS = 8000;
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

async function jsonRequest(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), TIMEOUT_MS);
  try {
    const res=await fetch(url,{...init,redirect:'manual',signal:controller.signal});
    if (!res.ok || Number(res.headers.get('content-length'))>1000000) {
      await res.body?.cancel().catch(()=>{});
      return null;
    }
    const data=await res.json();
    return data && typeof data==='object' ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function tokenFor(env) {
  if (!kisConfigured(env)) return null;
  const appKey=env.KIS_APP_KEY, secret=env.KIS_APP_SECRET;
  if (tokenCache?.appKey === appKey && tokenCache.secret === secret && Date.now()<tokenCache.expiresAt) return tokenCache.token;
  if (pendingToken?.appKey===appKey && pendingToken.secret===secret) return pendingToken.promise;
  const task = (async()=>{
    const data=await jsonRequest(BASE+'/oauth2/tokenP', {
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({grant_type:'client_credentials',appkey:appKey,appsecret:secret}),
    });
    if (typeof data?.access_token!=='string' || !data.access_token) return null;
    const secs=Number(data.expires_in);
    const ttl = Number.isFinite(secs) && secs>60 ? Math.min(secs-300, 23*3600) : 3600;
    tokenCache={appKey,secret,token:data.access_token,expiresAt:Date.now()+ttl*1000};
    return data.access_token;
  })();
  pendingToken={appKey,secret,promise:task};
  try {return await task;} finally {if(pendingToken?.promise===task)pendingToken=null;}
}

async function kisGet(env, token, path, trId, parameters) {
  const params=new URLSearchParams(parameters);
  const request = async accessToken=>jsonRequest(BASE+path+'?'+params.toString(),{
    method:'GET',
    headers:{accept:'application/json','content-type':'application/json',authorization:'Bearer '+accessToken,
      appkey:env.KIS_APP_KEY,appsecret:env.KIS_APP_SECRET,tr_id:trId,custtype:'P'},
  });
  let data=await request(token);
  // A known expired token can be invalidated and refreshed only once.
  if (data?.msg_cd==='EGW00123') {
    tokenCache=null;
    const refreshed=await tokenFor(env);
    data=refreshed?await request(refreshed):null;
  }
  return data?.rt_cd==='0' ? data : null;
}
function canonicalQuote(id, rows, field, div=1) {
  const history=(Array.isArray(rows)?rows:[])
    .map(r=>({date:dateOf(r?.stck_bsop_date),value:val(r?.[field])}))
    .filter(r=>r.date && r.value!==null && r.date<=new Date().toISOString().slice(0,10))
    .map(r=>({date:r.date,value:r.value/div}))
    .sort((a,b)=>a.date.localeCompare(b.date));
  if (!history.length) return null;
  const last=history.at(-1), prev=history.at(-2);
  const flow=id.startsWith('kr_foreign_');
  const age=Date.now()-Date.parse(last.date+'T23:59:59+09:00');
  return {
    id,provider:'kis',source:'한국투자증권 KIS Open API',
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

async function indexQuote(env,token,id,iscd) {
  // KIS FHKUP03500100 supports actual D/W/M periods and complete OHLC.
  const timeframes = [
    ['D', 210],
    ['W', 1095],
    ['M', 3650],
  ];
  const replies = await Promise.all(timeframes.map(([period,days]) =>
    kisGet(env,token,'/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice',
      'FHKUP03500100',{
        FID_COND_MRKT_DIV_CODE:'U',FID_INPUT_ISCD:iscd,
        FID_INPUT_DATE_1:fromKstDaysAgo(days),FID_INPUT_DATE_2:todayKst(),
        FID_PERIOD_DIV_CODE:period,
      })));
  const quote = canonicalQuote(id,replies[0]?.output2,'bstp_nmix_prpr');
  if (!quote) return null;
  return {
    ...quote,
    // Missing or invalid periods stay empty; the browser never fabricates candles.
    chartPeriods: Object.fromEntries(timeframes.map(([period],i) => [period,indexCandles(replies[i]?.output2)])),
    chartBasis: 'KIS 공식 일봉·주봉·월봉별 시가·고가·저가·종가',
  };
}
async function investorQuote(env,token,id,iscd,market) {
  // KIS reference requires FID_INPUT_DATE_1 and _2 to be the SAME date.
  // Weekends use the previous business weekday; official holidays may yield
  // no rows, which must remain missing rather than inventing a flow.
  const ymd = todayKst();
  const weekday = new Date(`${ymd.slice(0,4)}-${ymd.slice(4,6)}-${ymd.slice(6,8)}T00:00:00Z`).getUTCDay();
  const date = fromKstDaysAgo(weekday === 0 ? 2 : weekday === 6 ? 1 : 0);
  const data=await kisGet(env,token,'/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market',
    'FHPTJ04040000',{
      FID_COND_MRKT_DIV_CODE:'U',FID_INPUT_ISCD:iscd,FID_INPUT_DATE_1:date,
      FID_INPUT_DATE_2:date,FID_INPUT_ISCD_1:market,FID_INPUT_ISCD_2:iscd,
    });
  // API may refuse a market/plan. Never replace actual flow with synthetic data.
  return canonicalQuote(id,data?.output,'frgn_ntby_tr_pbmn',100);
}
export async function collectKis(env) {
  if(!kisConfigured(env)) return [];
  const token=await tokenFor(env);
  if(!token) return [];
  const fetched=await Promise.all([
    indexQuote(env,token,'kospi','0001'),
    indexQuote(env,token,'kosdaq','1001'),
    investorQuote(env,token,'kr_foreign_kospi','0001','KSP'),
    investorQuote(env,token,'kr_foreign_kosdaq','1001','KSQ'),
  ]);
  return fetched.filter(Boolean);
}
