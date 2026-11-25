import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chartSeries,chartPeriod,chartPeriodChange,chartFrequency,candleSeries} from '../public/chart-data.js';

test('chart history accepts only real dated positive observations, sorted without interpolation',()=>{
 const input=[
  {date:'2026-11-20',value:4869.96},
  {date:'2026-11-18',value:'5000'},
  {date:'2026-11-19',value:'4900'},
  {date:'2026-11-17',value:''},
  {date:'2026-11-16',value:null},
  {date:'2026-11-21',value:'.'},
  {date:'2026-02-30',value:4000},
  {date:'2026-11-14',value:-1},
  {date:'2026-11-13',value:Infinity},
  {date:'2026-11-18',value:4990},
  {date:'2026-11-20',value:4869.96},
 ];
 const h=chartSeries(input);
 assert.deepEqual(h,[{date:'2026-11-18',value:4990},{date:'2026-11-19',value:4900},{date:'2026-11-20',value:4869.96}]);
 assert.equal(chartSeries(null).length,0);
 assert.equal(chartSeries([200,300]).length,0,'undated demo numbers must not masquerade as real market history');
});

test('one- and three-month chart windows use last observation as the anchor, not server refresh time',()=>{
 const data=chartSeries([
  {date:'2026-07-01',value:2000},
  {date:'2026-08-19',value:2200},
  {date:'2026-09-15',value:2300},
  {date:'2026-10-01',value:2400},
  {date:'2026-10-20',value:2500},
  {date:'2026-11-20',value:2600},
 ]);
 assert.deepEqual(chartPeriod(data,'1m').map(x=>x.date),['2026-10-20','2026-11-20']);
 assert.deepEqual(chartPeriod(data,'3m').map(x=>x.date),['2026-08-19','2026-09-15','2026-10-01','2026-10-20','2026-11-20']);
 assert.equal(chartPeriod(data,'all').length,6);
 assert.deepEqual(chartPeriod(data,'bad-period'),[]);
});

test('range change is computed from selected range endpoints, not a fabricated daily delta',()=>{
 const series=[{date:'2026-11-18',value:100},{date:'2026-11-20',value:90}];
 assert.equal(chartPeriodChange(series),-10);
 assert.equal(chartPeriodChange(series.slice(0,1)),null);
 assert.equal(chartPeriodChange([]),null);
 assert.equal(chartPeriodChange([{date:'a',value:0},{date:'b',value:1}]),null);
});

test('main index cards and market table open an accessible chart modal from history',async()=>{
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const styles=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');
 const main=app.slice(app.indexOf('function renderQuotes()'),app.indexOf('function renderSectors()'));
 assert.match(main,/CHART_INDEX_IDS = new Set\(\['kospi','kosdaq'/);
 assert.match(main,/role: chartable \? 'button' : null/);
 assert.match(main,/tabindex: chartable \? 0 : null/);
 assert.match(main,/onClick: chartable \? \(\) => openIndexChart\(quote\)/);
 assert.match(main,/openIndexChart\(quote\)/);
 assert.match(main,/chartSeries\(chartQuote\.history\)/);
 assert.match(main,/chartPeriod\(all,activePeriod\)/);
 assert.match(main,/\['D','일봉'\],\['W','주봉'\],\['M','월봉'\]/);
 assert.match(main,/candleSeries\(chartQuote\.chartPeriods\?\.\[activeTimeframe\]\)/);
 assert.match(main,/market-chart-wick/);
 assert.match(main,/market-chart-body/);
 assert.match(main,/1개월/);
 assert.match(main,/3개월/);
 assert.match(main,/\['all','전체'\]/);
 assert.match(main,/showModal\(/);
 assert.match(main,/market-chart-scrubber/);
 assert.match(main,/chartFrequency\(chartSeries\(chartQuote\.history\),activeTimeframe\)/);
 assert.match(app,/class:'market-table-chart-link'/);
 assert.match(styles,/market-history-modal/);
});

test('official OHLC candles remain distinct from close-only data; reject fabricated highs and lows',()=>{
 const good=[
  {date:'2026-11-20',open:4890,high:4990,low:4800,close:4869.96},
  {date:'2026-11-18',open:4950,high:5010,low:4900,close:5000},
 ];
 const invalid=[
  {date:'2026-11-19',open:4900,close:4930},
  {date:'2026-11-17',open:5000,high:4980,low:4900,close:4990},
  {date:'2026-11-16',open:4800,high:5010,low:4900,close:4990},
  {date:'2026-11-14',open:4700,high:5000,low:4600,close:''},
 ];
 assert.deepEqual(candleSeries([...good,...invalid]).map(x=>({date:x.date,value:x.value})),[
   {date:'2026-11-18',value:5000},{date:'2026-11-20',value:4869.96}
 ]);
 assert.deepEqual(candleSeries([{date:'2026-11-20',value:4869.96}]),[]);
 assert.deepEqual(candleSeries(null),[]);
});

test('close-only global indices aggregate actual last observed close by calendar week or month',()=>{
 const daily=chartSeries([
  {date:'2026-09-30',value:100},{date:'2026-10-01',value:110},
  {date:'2026-10-02',value:105},{date:'2026-10-05',value:120},
  {date:'2026-10-07',value:115},{date:'2026-11-02',value:125},
 ]);
 assert.deepEqual(chartFrequency(daily,'D'),daily);
 assert.deepEqual(chartFrequency(daily,'W').map(x=>x.value),[105,115,125]);
 assert.deepEqual(chartFrequency(daily,'M').map(x=>x.value),[100,115,125]);
 assert.equal(chartFrequency(daily,'W').some(x=>x.open!==undefined),false,'weekly line cannot invent OHLC');
 assert.deepEqual(chartFrequency(daily,'bad'),[]);
 assert.equal(chartPeriod(daily,'1y').length,6);
});
