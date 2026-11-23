export const usFutures = [
  {id: 'fut_es', name: 'S&P 500 선물', root: 'ES', exchange: 'CME', ticker: 'CME_MINI:ES1!'},
  {id: 'fut_nq', name: '나스닥100 선물', root: 'NQ', exchange: 'CME', ticker: 'CME_MINI:NQ1!'},
  {id: 'fut_ym', name: '다우 선물', root: 'YM', exchange: 'CBOT', ticker: 'CBOT_MINI:YM1!'},
  {id: 'fut_rty', name: '러셀2000 선물', root: 'RTY', exchange: 'CME', ticker: 'CME_MINI:RTY1!'},
  {id: 'fut_sox', name: '필라델피아 반도체 선물', root: 'SOX', exchange: 'CME', ticker: 'CME_MINI:SOX1!'},
];
export const futuresPeriods = [
  ['1min', '1분봉'], ['3min', '3분봉'], ['5min', '5분봉'], ['10min', '10분봉'],
  ['60min', '1시간봉'], ['240min', '4시간봉'], ['D', '일봉'], ['W', '주봉'], ['M', '월봉'],
];
