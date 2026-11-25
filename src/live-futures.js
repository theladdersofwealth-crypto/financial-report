import {FUTURES_FRESHNESS_MS, futuresPeriods, futuresProducts, futuresScopes} from '../public/futures-config.js';

const urls = {
  gate:'https://api.gateio.ws/api/v4/futures/usdt/',
  binance:'https://fapi.binance.com/fapi/v1/',
  mexc:'https://api.mexc.com/api/v1/contract/',
  bybit:'https://api.bybit.com/v5/market/',
};
const labels = {gate:'Gate', binance:'바이낸스', mexc:'MEXC', bybit:'Bybit'};
const links = {gate:'https://www.gate.com/futures/USDT/', binance:'https://www.binance.com/en/futures/',
  mexc:'https://www.mexc.com/futures/', bybit:'https://www.bybit.com/trade/usdt/'};
const MINUTE = 60000;

async function providerJson(fetcher, venue, path, parameters) {
  const url = urls[venue] + path + '?' + new URLSearchParams(parameters);
  try {
    const response = await fetcher(url, {redirect:'manual', signal:AbortSignal.timeout(2600)});
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return {http:response.status, data:null};
    }
    return {http:response.status, data:await response.json()};
  } catch {
    return {http:null, data:null};
  }
}

function contractFields(product, venue, symbol) {
  const etfFallback = !product.productType && venue === 'binance' && product.id !== 'fut_sox';
  const productType = product.productType || (venue === 'binance' || product.id === 'fut_sox' ? 'ETF 연동' : '지수 연동');
  const etfName = symbol.split(/_?USDT$/)[0];
  return {
    id:product.id, name:etfFallback ? `${etfName} ETF` : product.liveName,
    group:product.group || 'futures', venue, contract:symbol, exchange:labels[venue], unit:'USDT',
    source:labels[venue], sourceUrl:links[venue] + symbol, productType,
  };
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function bookLevels(venue, data, symbol) {
  if (venue === 'gate') {
    const microseconds = positive(data.update_us);
    const update = Number(data.update);
    const time = microseconds ? microseconds / 1000 : update < 1e11 ? update * 1000 : update;
    return {bid:positive(data.bids?.[0]?.p), ask:positive(data.asks?.[0]?.p), time};
  }
  if (venue === 'binance' && data.symbol === symbol) return {
    bid:positive(data.bidPrice), ask:positive(data.askPrice), time:Number(data.time),
  };
  if (venue === 'mexc' && data.success === true) return {
    bid:positive(data.data?.bids?.[0]?.[0]), ask:positive(data.data?.asks?.[0]?.[0]), time:Number(data.data?.timestamp),
  };
  if (venue === 'bybit' && data.retCode === 0 && data.result?.s === symbol) return {
    bid:positive(data.result.b?.[0]?.[0]), ask:positive(data.result.a?.[0]?.[0]),
    time:Number(data.result.cts || data.result.ts),
  };
  return {};
}

async function quoteFor(product, venue, symbol, fetcher, clock, report) {
  const requests = {
    gate:['order_book',{contract:symbol,limit:1}], binance:['ticker/bookTicker',{symbol}],
    mexc:[`depth/${symbol}`,{limit:1}], bybit:['orderbook',{category:'linear',symbol,limit:1}],
  };
  const [path,parameters] = requests[venue];
  const {http, data} = await providerJson(fetcher, venue, path, parameters);
  const observed = data && typeof data === 'object' ? bookLevels(venue, data, symbol) : {};
  const now = clock();
  const {bid, ask, time} = observed;
  const age = now - time;
  const validBook = bid > 0 && ask >= bid && Number.isFinite(age);
  if (!validBook || age < -5000 || age > FUTURES_FRESHNESS_MS) {
    report({venue, symbol, http, reason:validBook ? 'quote_time' : 'no_book', ageMs:validBook ? age : null});
    return null;
  }
  const value = (bid + ask) / 2;
  return {...contractFields(product, venue, symbol), value, bid, ask, decimals:value < 0.01 ? 8 : value < 10 ? 4 : 2,
    change:null, changeUnit:'%', observedAt:new Date(time).toISOString(), retrievedAt:new Date(now).toISOString(),
    timestampPrecision:'book', status:'live', basis:'최우선 매수·매도 호가 중간값'};
}

async function productQuote(product, fetcher, clock, report) {
  for (const [venue, symbol] of Object.entries(product.markets)) {
    const quote = await quoteFor(product, venue, symbol, fetcher, clock, report);
    if (quote) return quote;
  }
  return null;
}

export async function collectLiveFutures(env = {}, report = () => {}, clock = Date.now, scope = 'indices') {
  const products = Object.hasOwn(futuresScopes,scope) ? futuresScopes[scope] : [];
  const fetcher = env.fetchProvider || fetch;
  const quotes = [];
  let next = 0;
  await Promise.all(Array.from({length:Math.min(5,products.length)}, async () => {
    while (next < products.length) {
      const index = next++;
      quotes[index] = await productQuote(products[index],fetcher,clock,report);
    }
  }));
  return quotes.filter(quote => quote && clock() - Date.parse(quote.observedAt) <= FUTURES_FRESHNESS_MS);
}

export async function lookupLiveFuture(env, market, ticker) {
  const fetcher = env.fetchProvider || fetch;
  const group = market === 'US' ? ['us-stock','us-sector'] : ['crypto'];
  const product = futuresProducts.find(item => group.includes(item.group) && item.symbol === ticker);
  if (product && Object.keys(product.markets).length) return productQuote(product,fetcher,Date.now,()=>{});

  const base = ticker === 'BRK.B' ? 'BRKB' : ticker;
  if (!/^[A-Z0-9]{1,15}$/.test(base)) return null;
  const symbol = `${base}USDT`;
  const {data} = await providerJson(fetcher,'bybit','instruments-info',{category:'linear',symbol});
  const instrument = data?.result?.list?.find(item => item.symbol === symbol);
  const types = market === 'US' ? ['stock','ETF'] : ['','crypto'];
  if (instrument?.status !== 'Trading' || instrument.contractType !== 'LinearPerpetual'
      || instrument.baseCoin !== base || instrument.quoteCoin !== 'USDT' || !types.includes(instrument.symbolType)) return null;
  const productType = market === 'CRYPTO' ? '코인 선물' : instrument.symbolType === 'ETF' ? 'ETF 연동' : '주식 연동';
  return quoteFor({id:`search_${base}`,liveName:ticker,group:group[0],productType},
    'bybit',symbol,fetcher,Date.now,()=>{});
}

const periods = {
  '1min':['1m','Min1'], '3min':['1m','Min1',3], '5min':['5m','Min5'], '10min':['5m','Min5',10],
  '60min':['1h','Min60'], '240min':['4h','Hour4'], D:['1d','Day1'], W:['1w','Week1'], M:['30d','Month1'],
};

function markRows(venue, data) {
  if (venue === 'gate') return Array.isArray(data) ? data.map(row => [Number(row.t)*1000,row.o,row.h,row.l,row.c]) : [];
  if (venue === 'binance') return Array.isArray(data) ? data : [];
  if (venue === 'bybit') return data?.retCode === 0 && Array.isArray(data.result?.list) ? data.result.list : [];
  const raw = data?.data;
  if (data?.success !== true || !Array.isArray(raw?.time)) return [];
  return raw.time.map((t,i) => [Number(t)*1000,raw.open?.[i],raw.high?.[i],raw.low?.[i],raw.close?.[i]]);
}

function candles(rows, period, bucketMinutes, now) {
  const bars = new Map();
  const daily = !period.endsWith('min');
  for (const [timestamp,o,h,l,c] of rows) {
    const time = Number(timestamp);
    const [open,high,low,close] = [o,h,l,c].map(positive);
    if (!Number.isFinite(time) || time < 0 || time > now + MINUTE || !open || !high || !low || !close
        || high < Math.max(open,close) || low > Math.min(open,close)) continue;
    bars.set(time,{open,high,low,close,value:close});
  }
  const grouped = new Map();
  for (const [time,bar] of [...bars].sort(([a],[b]) => a - b)) {
    const bucket = bucketMinutes ? Math.floor(time/(bucketMinutes*MINUTE))*bucketMinutes*MINUTE : time;
    const stamp = new Date(bucket).toISOString();
    const date = daily ? stamp.slice(0,10) : stamp;
    const earlier = grouped.get(date);
    if (earlier) {
      earlier.high = Math.max(earlier.high,bar.high);
      earlier.low = Math.min(earlier.low,bar.low);
      earlier.close = earlier.value = bar.close;
    } else grouped.set(date,{date,...bar});
  }
  return [...grouped.values()].slice(-150);
}

export async function loadLiveFuturesChart(env, id, period, venue, now = Date.now()) {
  const product = futuresProducts.find(candidate => candidate.id === id);
  if (!product || !Object.keys(product.markets).length || !futuresPeriods.some(([key]) => key === period)
      || venue && !Object.hasOwn(product.markets,venue)) return {status:'invalid',bars:[]};
  const source = venue || Object.keys(product.markets)[0];
  const symbol = product.markets[source];
  const [interval,mexcInterval,bucketMinutes] = periods[period];
  const limit = bucketMinutes ? 450 : 150;
  let path, parameters;
  if (source === 'gate') {
    path = 'candlesticks';
    parameters = {contract:`mark_${symbol}`,interval,limit};
  } else if (source === 'binance') {
    path = 'markPriceKlines';
    parameters = {symbol,interval:period === 'M' ? '1M' : interval,limit};
  } else if (source === 'mexc') {
    path = `kline/fair_price/${symbol}`;
    parameters = {interval:mexcInterval};
  } else {
    path = 'mark-price-kline';
    const bybitPeriod = {D:'D', W:'W', M:'M'}[period] || String(bucketMinutes ? parseInt(interval,10) : parseInt(period,10));
    parameters = {category:'linear',symbol,interval:bybitPeriod,limit:Math.min(limit,200)};
  }
  const {data} = await providerJson(env.fetchProvider || fetch, source, path, parameters);
  const bars = candles(markRows(source,data),period,bucketMinutes,now);
  return {...contractFields(product,source,symbol), status:bars.length ? 'ready' : 'unavailable',
    basis:'거래소 마크 가격 캔들',bars};
}
