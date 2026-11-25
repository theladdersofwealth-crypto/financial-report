export const usFutures = [
  {id: 'fut_es', name: 'S&P 500 선물', root: 'ES', exchange: 'CME', ticker: 'CME_MINI:ES1!',
    liveName: 'S&P 500', markets: {gate:'SPX500_USDT', binance:'SPYUSDT'}},
  {id: 'fut_nq', name: '나스닥100 선물', root: 'NQ', exchange: 'CME', ticker: 'CME_MINI:NQ1!',
    liveName: '나스닥100', markets: {gate:'NAS100_USDT', binance:'QQQUSDT'}},
  {id: 'fut_ym', name: '다우 선물', root: 'YM', exchange: 'CBOT', ticker: 'CBOT_MINI:YM1!',
    liveName: '다우', markets: {gate:'US30_USDT', mexc:'US30_USDT'}},
  {id: 'fut_rty', name: '러셀2000 선물', root: 'RTY', exchange: 'CME', ticker: 'CME_MINI:RTY1!',
    liveName: '러셀2000', markets: {gate:'US2000_USDT', binance:'IWMUSDT'}},
];

function perpetual(id, name, group, productType, markets, symbol = null) {
  return {id, liveName:name, group, productType, markets, symbol};
}

export const assetFutures = [
  perpetual('wti','WTI','energy','원자재 연동',{gate:'CL_USDT',bybit:'CLUSDT',binance:'CLUSDT'}),
  perpetual('brent','브렌트유','energy','원자재 연동',{gate:'BZ_USDT',bybit:'BZUSDT',binance:'BZUSDT'}),
  perpetual('gold','금','metals','원자재 연동',{gate:'XAU_USDT',mexc:'XAU_USDT',bybit:'XAUUSDT'}),
  perpetual('silver','은','metals','원자재 연동',{gate:'XAG_USDT',bybit:'XAGUSDT',binance:'XAGUSDT'}),
  perpetual('btc','비트코인','crypto','코인 선물',{gate:'BTC_USDT',mexc:'BTC_USDT',bybit:'BTCUSDT'},'BTC'),
  perpetual('eth','이더리움','crypto','코인 선물',{gate:'ETH_USDT',mexc:'ETH_USDT',bybit:'ETHUSDT'},'ETH'),
];

export const stockFutures = [
  ['NVDA','엔비디아'], ['AAPL','애플','AAPLSTOCK_USDT'], ['MSFT','마이크로소프트','MSFTSTOCK_USDT'],
  ['AMZN','아마존','AMZNSTOCK_USDT'], ['GOOGL','알파벳','GOOGLSTOCK_USDT'],
  ['META','메타','METASTOCK_USDT'], ['TSLA','테슬라'],
].map(([symbol,name,mexc]) => perpetual(`stock_${symbol.toLowerCase()}`,name,'us-stock','주식 연동',
  {gate:`${symbol}_USDT`, ...(mexc ? {mexc} : {}), bybit:`${symbol}USDT`},symbol));

export const sectorFutures = [
  ['XLK','기술','gate'], ['XLF','금융','gate'], ['XLE','에너지','gate'], ['XLV','헬스케어','gate'],
  ['XLY','경기소비재'], ['XLP','필수소비재','bybit'], ['XLI','산업재','mexc'], ['XLB','소재'],
  ['XLU','유틸리티','gate'], ['XLRE','부동산'], ['XLC','커뮤니케이션'],
].map(([symbol,name,venue]) => perpetual(`sector_${symbol.toLowerCase()}`,`${name} ETF`,'us-sector','ETF 연동',
  venue === 'gate' ? {gate:`${symbol}_USDT`,mexc:`${symbol}_USDT`,bybit:`${symbol}USDT`}
    : venue === 'mexc' ? {mexc:`${symbol}_USDT`,bybit:`${symbol}USDT`}
    : venue === 'bybit' ? {bybit:`${symbol}USDT`} : {}, symbol));

export const futuresScopes = {indices:usFutures, assets:assetFutures, equities:[...stockFutures,...sectorFutures]};
export const futuresProducts = Object.values(futuresScopes).flat();
export const FUTURES_REFRESH_MS = 8000;
export const EXTENDED_FUTURES_REFRESH_MS = 16000;
export const FUTURES_FRESHNESS_MS = 30000;
export const futuresPeriods = [
  ['1min', '1분봉'], ['3min', '3분봉'], ['5min', '5분봉'], ['10min', '10분봉'],
  ['60min', '1시간봉'], ['240min', '4시간봉'], ['D', '일봉'], ['W', '주봉'], ['M', '월봉'],
];
