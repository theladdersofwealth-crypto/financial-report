import {lookupKisInstrument} from './kis.js';

// A small convenience dictionary, not an assertion that we maintain a complete
// exchange master list. Any KRX six-digit code or US ticker is accepted.
const ALIASES = new Map(Object.entries({
  '삼성전자':['KR','005930'],'삼성전자우':['KR','005935'],
  'SK하이닉스':['KR','000660'],'에스케이하이닉스':['KR','000660'],
  '현대차':['KR','005380'],'기아':['KR','000270'],
  'NAVER':['KR','035420'],'네이버':['KR','035420'],
  '카카오':['KR','035720'],'셀트리온':['KR','068270'],
  'LG에너지솔루션':['KR','373220'],'엘지에너지솔루션':['KR','373220'],
  'KB금융':['KR','105560'],'포스코홀딩스':['KR','005490'],
  'POSCO홀딩스':['KR','005490'],'한화에어로스페이스':['KR','012450'],
  '애플':['US','AAPL'],'엔비디아':['US','NVDA'],'마이크로소프트':['US','MSFT'],
  '마소':['US','MSFT'],'테슬라':['US','TSLA'],'구글':['US','GOOGL'],
  '알파벳':['US','GOOGL'],'아마존':['US','AMZN'],'메타':['US','META'],
  '엔비디아 NVDA':['US','NVDA'],'버크셔해서웨이':['US','BRK.B'],
  '비트코인':['CRYPTO','BTC'],'이더리움':['CRYPTO','ETH'],'솔라나':['CRYPTO','SOL'],
  '도지코인':['CRYPTO','DOGE'],
}).map(([key,value])=>[key.replace(/\s/g,'').toUpperCase(),value]));

const recent=new Map();
const windowMs=20_000;

function number(value) {
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}

async function binanceSymbol(symbol){
  const base=symbol.replace(/[-\/ ]/g,'').replace(/USDT$/,'');
  if(!/^[A-Z0-9]{2,15}$/.test(base))return null;
  const pair=base+'USDT';
  for(const host of ['data-api.binance.vision','api.binance.com']){
    const ctrl=new AbortController();
    const timeout=setTimeout(()=>ctrl.abort(),5000);
    try{
      const response=await fetch(`https://${host}/api/v3/ticker/24hr?symbol=${pair}`,{
        method:'GET',redirect:'manual',signal:ctrl.signal,headers:{Accept:'application/json'}});
      if(!response.ok||Number(response.headers.get('content-length'))>50000)continue;
      const result=await response.json();
      const value=number(result?.lastPrice),closeTime=number(result?.closeTime);
      const change=number(result?.priceChangePercent);
      if(result?.symbol!==pair||value===null||value<=0
        ||closeTime===null||closeTime<=0||closeTime>Date.now()+60000
        ||Date.now()-closeTime>15*60000)continue;
      return {market:'CRYPTO',symbol:pair,name:base+'/USDT',
        exchange:'BINANCE',value,unit:'USDT',change:change!==null&&Math.abs(change)<500?change:null,
        changeUnit:'%',provider:'binance',source:'Binance Spot',
        sourceUrl:'https://developers.binance.com/en/docs/products/spot/rest-api',
        observedAt:new Date(closeTime).toISOString(),timestampPrecision:'window_end',
        status:'live',delay:'최근 24시간 이동창 통계 종료시각 · 최종 체결시각과 다름 · 데스크 검색 캐시 20초',
        basis:'USDT 현물 거래쌍 · 달러(USD) 현물과 동일한 통화가 아님'};
    }catch{/* inaccessible provider: fail closed */}
    finally{clearTimeout(timeout)}
  }
  return null;
}

export function normalizeSearch(market,query,exchange=''){
  const type=String(market||'').trim().toUpperCase(),raw=String(query||'').trim();
  if(!['KR','US','CRYPTO'].includes(type)||raw.length<1||raw.length>42)return null;
  const aliases=ALIASES.get(raw.replace(/\s/g,'').toUpperCase());
  // Do not silently search an unrelated market for an alias.
  const symbol=aliases?.[0]===type?aliases[1]:raw.toUpperCase();
  if(type==='KR'&&!/^[0-9]{6}$/.test(symbol))return null;
  if(type==='US'&&!/^[A-Z][A-Z0-9.\-]{0,10}$/.test(symbol))return null;
  if(type==='CRYPTO'&&!/^[A-Z0-9/\- ]{2,24}$/.test(symbol))return null;
  if(!['','NAS','NYS','AMS'].includes(exchange))return null;
  return {market:type,symbol,exchange:type==='US'?exchange:''};
}

export async function searchInstrument(env,market,query,exchange=''){
  const normalized=normalizeSearch(market,query,exchange);
  if(!normalized)return {status:'invalid',message:'국내 종목은 6자리 코드, 미국 종목은 영문 티커, 코인은 BTC 또는 BTCUSDT 형식으로 입력해 주세요.'};
  const key=[normalized.market,normalized.symbol,normalized.exchange].join(':');
  const cached=recent.get(key);
  if(cached&&Date.now()-cached.time<windowMs)return structuredClone(cached.result);
  const quote=normalized.market==='CRYPTO'
    ? await binanceSymbol(normalized.symbol)
    : await lookupKisInstrument(env,normalized.market,normalized.symbol,normalized.exchange);
  const result=quote
    ? {status:'ok',quote}
    : {status:'unavailable',message:normalized.market==='CRYPTO'
      ? '해당 바이낸스 현물 USDT 거래쌍의 시세를 받지 못했습니다. 상장 여부·접근 제한을 확인해 주세요.'
      : '한투 KIS에서 해당 코드의 시세가 확인되지 않았습니다. 거래소·조회 권한·종목코드를 확인해 주세요.'};
  if(recent.size>80)recent.clear();
  recent.set(key,{time:Date.now(),result});
  return structuredClone(result);
}
