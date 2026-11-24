import {lookupKisInstrument} from './kis.js';
import {lookupLiveFuture} from './live-futures.js';

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

export function normalizeSearch(market,query,exchange=''){
  const type=String(market||'').trim().toUpperCase(),raw=String(query||'').trim();
  if(!['KR','US','CRYPTO'].includes(type)||raw.length<1||raw.length>42)return null;
  const aliases=ALIASES.get(raw.replace(/\s/g,'').toUpperCase());
  // Do not silently search an unrelated market for an alias.
  const symbol=aliases?.[0]===type?aliases[1]:raw.toUpperCase();
  if(type==='KR'&&!/^[0-9]{6}$/.test(symbol))return null;
  if(type==='US'&&!/^[A-Z][A-Z0-9.\-]{0,10}$/.test(symbol))return null;
  if(type==='CRYPTO'&&!/^[A-Z0-9/\- ]{2,24}$/.test(symbol))return null;
  if(!['','NAS','NYS','AMS'].includes(exchange) || (type!=='US' && exchange))return null;
  return {market:type,symbol,exchange:type==='US'?exchange:''};
}

export async function searchInstrument(env,market,query,exchange=''){
  const normalized=normalizeSearch(market,query,exchange);
  if(!normalized)return {status:'invalid',message:'국내 종목은 6자리 코드, 미국 종목은 영문 티커, 코인은 BTC 또는 BTCUSDT 형식으로 입력해 주세요.'};
  const key=[normalized.market,normalized.symbol,normalized.exchange].join(':');
  const cached=recent.get(key);
  if(cached && Date.now()-cached.time<windowMs
    && (normalized.market==='KR' || !cached.result.quote || Date.now()-Date.parse(cached.result.quote.observedAt)<30000)) {
    return structuredClone(cached.result);
  }
  const domestic = normalized.market==='KR';
  const ticker = normalized.market==='CRYPTO'
    ? normalized.symbol.replace(/[-\/ ]/g,'').replace(/USDT$/,'') : normalized.symbol;
  const quote = domestic
    ? await lookupKisInstrument(env,'KR',ticker)
    : await lookupLiveFuture(env,normalized.market,ticker);
  const result=quote
    ? {status:'ok',quote:{...quote,market:normalized.market,symbol:domestic ? quote.symbol : quote.contract,
      productType:domestic ? '국내 현물' : quote.productType}}
    : {status:'unavailable',message:domestic ? '해당 국내 현물 종목의 시세를 확인하지 못했습니다.'
      : '해당 종목의 상장 무기한 선물과 최신 호가를 확인하지 못했습니다.'};
  if(recent.size>80)recent.clear();
  recent.set(key,{time:Date.now(),result});
  return structuredClone(result);
}
