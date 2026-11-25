import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {chartSeries,chartPeriod,chartPeriodChange,chartFrequency,candleSeries,minuteFrequencies,intradayMinutes,aggregateIndexMinutes} from '../public/chart-data.js';
import {fxCurrencies, featuredFxCodes} from '../public/fx-currencies.js';
import {usFutures, assetFutures, stockFutures, sectorFutures, futuresProducts, futuresPeriods, EXTENDED_FUTURES_REFRESH_MS, FUTURES_FRESHNESS_MS, FUTURES_REFRESH_MS} from '../public/futures-config.js';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {setTimeout as nativeTimeout,clearTimeout as nativeClearTimeout} from 'node:timers';

test('standalone demo renders every destination without accessing member APIs',async()=>{
  const {window:domWindow}=parseHTML(await readFile('public/index.html','utf8'));
  const {document}=domWindow;
  const timers=[];
  const requested=[];
  const localTimer=(fn,ms)=>{const id=nativeTimeout(fn,ms);id.unref();timers.push(id);return id};
  const location={protocol:'file:',pathname:'/market-desk-preview.html',hash:'',href:'file:///market-desk-preview.html'};
  const window={document,location,setTimeout:localTimer,clearTimeout:nativeClearTimeout,setInterval:()=>0,clearInterval(){},scrollTo(){},addEventListener:domWindow.addEventListener.bind(domWindow),matchMedia:()=>({matches:false,addEventListener(){}}),innerWidth:1200};
  const context={
    document,window,Node:domWindow.Node,HTMLElement:domWindow.HTMLElement,Element:domWindow.Element,
    chartSeries,chartPeriod,chartPeriodChange,chartFrequency,candleSeries,minuteFrequencies,intradayMinutes,aggregateIndexMinutes,
    fxCurrencies,featuredFxCodes,usFutures,assetFutures,stockFutures,sectorFutures,futuresProducts,futuresPeriods,EXTENDED_FUTURES_REFRESH_MS,FUTURES_FRESHNESS_MS,FUTURES_REFRESH_MS,
    location,navigator:{onLine:true},console,Intl,Date,URL,URLSearchParams,TextEncoder,queueMicrotask,
    setTimeout:localTimer,clearTimeout,setInterval:()=>0,clearInterval:()=>{},
    requestAnimationFrame:fn=>localTimer(fn,0),cancelAnimationFrame:clearTimeout,
    fetch:async path=>{requested.push(String(path));return new Response(JSON.stringify({initialized:true,setupAvailable:false}),{headers:{'Content-Type':'application/json'}})},
    WebSocket:class{static OPEN=1;},FormData,
  };
  domWindow.HTMLElement.prototype.focus=function(){};
  domWindow.HTMLElement.prototype.scrollIntoView=function(){};
  const ctx=vm.createContext(context);
  const browserModule=await readFile('public/app.js','utf8');
  vm.runInContext(browserModule.slice(browserModule.indexOf('const app = ')),ctx,{filename:'app.js'});
  await new Promise(r=>nativeTimeout(r,20));
  if(!document.querySelector('.demo-banner')) {
    vm.runInContext('enterDemo()',ctx);
  }
  assert.match(document.querySelector('.demo-banner').textContent,/예시 데이터/);
  const overview = document.querySelector('#main-column');
  const brief = overview.firstElementChild;
  assert.equal(brief.localName, 'details');
  assert.equal(brief.id, 'desk-brief');
  assert.equal(brief.hasAttribute('open'), false);
  assert.match(brief.querySelector('.brief-label').textContent, /오늘의 브리핑/);
  assert.equal(brief.querySelector('.brief-more-closed').textContent, '근거·상세 보기');
  assert.ok(brief.querySelector('.brief-details #korea-impact'));
  brief.setAttribute('open', '');
  vm.runInContext('renderView()',ctx);
  assert.ok(overview.firstElementChild.hasAttribute('open'));
  vm.runInContext(`
    state.demo = false;
    state.market.briefing = {headline:'11월 23일 종가 · 코스피 +1.25% · 코스닥 -0.40%', generatedAt:'2026-11-23T15:00:00Z',
      nextUpdateAt:'2026-11-23T19:00:00Z', items: [
        {id:'kospi',name:'코스피', value:3200, change:1.25, changeUnit:'%', unit:'pt',
          observedAt:'2026-11-23', timestampPrecision:'day', source:'KIS'},
        {id:'kr_foreign_kospi',name:'코스피 외국인', value:-300, change:150, changeUnit:'억원', unit:'억원',
          observedAt:'2026-11-23', timestampPrecision:'day', source:'KIS'}],
      missing:[]};
    state.market.impact = {
      kospi:{state:'부담',available:1,total:6,drivers:[{text:'나스닥 100 하락 (-1.99%)',stance:'부담', observedAt:'2026-11-23'}]},
      kosdaq:{state:'혼재',available:0,total:6,drivers:[]},
      domestic:{kospi:{id:'kospi',value:3200,unit:'pt',change:1.25,changeUnit:'%',
        observedAt:'2026-11-23T11:00:00Z',timestampPrecision:'retrieval'}},
      validation:{minimumClassifiedDays:40,kospi:{agreementRate:57.1,classifiedDays:42,from:'2026-09-14',until:'2026-11-23'},
        kosdaq:{agreementRate:null,classifiedDays:12},limitations:['미래 적중률을 뜻하지 않습니다.']},
      cautions:['지수의 실제 등락을 예측하는 값은 아닙니다.'],
    };
    updateBriefing();
    state.demo = true;
  `, ctx);
  assert.ok(overview.firstElementChild.hasAttribute('open'));
  assert.match(document.querySelector('.brief-headline').textContent,/코스피 \+1.25% · 코스닥 -0.40%/);
  assert.match(document.querySelector('.brief-evidence').textContent,/코스피 외국인 순매도 300.00억원/);
  assert.doesNotMatch(document.querySelector('.brief-content').textContent,/KIS|미국 시장|무기한|150/);
  const details = document.querySelector('.brief-details').textContent;
  assert.doesNotMatch(details,/2026-11-23|KST 조회|적중률|예측하는 값/);
  assert.doesNotMatch(document.querySelector('.brief-evidence').textContent,/\(11-23\)/);
  assert.match(details,/나스닥 100 하락 \(-1\.99%\).*일치율 57\.1% · 42거래일/);

  const topics=[...document.querySelectorAll('.metric-section-title')].map(el=>el.textContent);
  assert.deepEqual(topics,[
    '한국 증시 · 외국인·연기금 수급','미국 지수선물','금리','원화 환율','원자재 선물','코인 선물'
  ],'distinct trading instrument and reference sections stay in order');
  const namesIn = id => [...document.querySelectorAll('#'+id+' .quote-name')].map(node => node.textContent);
  assert.deepEqual(namesIn('metrics-macro'), ['미 국채 2년','미 국채 10년','한국 국고채 3년','한국 국고채 10년']);
  assert.deepEqual(namesIn('metrics-commodities'), ['WTI','브렌트유','금','은']);
  assert.deepEqual(namesIn('metrics-crypto'), ['비트코인','이더리움']);
  assert.equal(namesIn('metrics-korea').length,6);
  assert.doesNotMatch(namesIn('metrics-global').join(' '), /반도체/);
  assert.equal(document.querySelectorAll('.metric-jump-button').length,topics.length);
  assert.equal(document.querySelectorAll('.overview-section-intro').length, 2,
    'sector and outlook sections keep their own headings');
  for (const section of document.querySelectorAll('.metric-section')) {
    assert.ok(section.querySelector('.metric-section-description')?.textContent.trim());
    assert.ok(section.querySelectorAll('.quote-card').length>0);
  }
  for(const view of ['overview','markets','fx','instrument','outlooks','calendar','sources','users','activity']) {
    const button=document.querySelector(`[data-view="${view}"]`);assert.ok(button,view);button.click();
    await new Promise(r=>nativeTimeout(r,5));
    assert.ok(document.querySelector('#main-column').textContent.trim().length>20,`${view} content`);
    assert.ok(document.querySelector('.demo-banner'),`${view} retains demo warning`);
    if (view === 'markets') {
      const table = document.querySelector('#market-table-body').textContent;
      assert.doesNotMatch(table, /닛케이|구리|니켈|솔라나|달러 인덱스|무기한/);
      assert.match(table, /미 국채 2년.*한국 국고채 10년/);
      assert.deepEqual([...document.querySelectorAll('.market-prices-table th')].map(node=>node.textContent),['지표','최근 관측값','전일 대비']);
    }
  }
  vm.runInContext('renderWelcome()',ctx);
  const formFields = () => [...document.querySelectorAll('.welcome-form form input, .welcome-form form select')].map(field => field.name);
  assert.deepEqual(formFields(), ['nickname','gender','age','pin']);
  assert.equal(document.querySelector('.welcome-form input[name="pin"]').getAttribute('maxlength'), '4');
  assert.equal(document.querySelector('.welcome-mode-tabs'), null);
  assert.equal(document.querySelector('.demo-entry'), null);
  assert.equal(document.querySelector('.welcome-auth-switch').textContent, '관리자 로그인');
  document.querySelector('.welcome-auth-switch').click();
  assert.deepEqual(formFields(), ['username','password']);
  document.querySelector('.welcome-auth-switch').click();
  assert.deepEqual(formFields(), ['nickname','gender','age','pin']);
  assert.equal(requested.length,0,'file preview never contacts a member or market API');
  vm.runInContext(`state.demo = false;
    const saved = {id: 'kospi', name: '코스피', status: 'stale', savedFrom: 'cache', source: '한국투자증권 KIS Open API',
      observedAt: '2026-11-20', timestampPrecision: 'day', unit: 'pt', value: 2950, provider: 'kis',
      minuteCandles: [
        {date: '2026-11-20T09:34:00+09:00', open: 2945, high: 2955, low: 2944, close: 2950},
        {date: '2026-11-20T09:35:00+09:00', open: 2950, high: 2960, low: 2948, close: 2955},
      ]};
    document.getElementById('app').replaceChildren(quoteCard(saved));`,ctx);
  assert.equal(document.querySelector('.quote-status').textContent, '최근 저장값');
  assert.equal(document.querySelector('.quote-provenance').textContent, '2026-11-20 기준');
  document.querySelector('.quote-card').click();
  const button = label => [...document.querySelectorAll('.market-chart-range')].find(el => el.textContent === label);
  button('1분봉').click();
  assert.equal(document.querySelectorAll('.market-chart-body').length, 2);
  assert.ok(document.querySelector('.market-chart-extent').hidden);
  button('1시간봉').click();
  assert.equal(document.querySelectorAll('.market-chart-body').length, 1);
  button('일봉').click();
  assert.equal(document.querySelector('.market-chart-extent').hidden, false);
  document.querySelector('#modal-root').replaceChildren();
  vm.runInContext(`state.market = {quotes: [{id: 'vndkrw', fxCurrency: 'VND', fxAmount: 1000, name: '베트남 동',
    group: 'fx', unit: '원', value: 51.8, status: 'daily', observedAt: '2026-11-20', timestampPrecision: 'day',
    history: [{date: '2026-11-19', value: 51.5}, {date: '2026-11-20', value: 51.8}]}]};
    document.getElementById('app').replaceChildren(renderFxView());`,ctx);
  assert.equal(document.querySelectorAll('.fx-list .quote-card').length, 52);
  const search = document.querySelector('.fx-toolbar input');
  search.value = '다 낭';
  search.dispatchEvent(new domWindow.Event('input'));
  assert.equal(document.querySelectorAll('.fx-list .quote-card').length, 1);
  assert.match(document.querySelector('.fx-unit-label').textContent, /1,000 VND/);
  assert.equal(document.querySelector('.fx-list .quote-status').textContent, '2026-11-20');
  assert.equal(document.querySelector('.fx-list .quote-provenance'), null);
  document.querySelector('.fx-list .quote-card').click();
  assert.match(document.querySelector('#modal-root').textContent, /베트남 동 · 일별 원화 환율 차트/);
  assert.ok(document.querySelector('.market-chart-svg'));
  assert.match(document.querySelector('.market-chart-svg').getAttribute('aria-label'), /기준환율 추이/);
  document.querySelector('#modal-root').replaceChildren();
  ctx.fetch = async path => {
    requested.push(String(path));
    return new Response(JSON.stringify({status:'ready',contract:'SPX500_USDT',source:'Gate',
      sourceUrl:'https://www.gate.com/futures/USDT/SPX500_USDT',bars:[
      {date:'2026-11-20 21:05:00',open:7000,high:7010,low:6995,close:7002,value:7002},
      {date:'2026-11-20 21:10:00',open:7002,high:7020,low:7001,close:7018,value:7018},
    ]}), {headers:{'Content-Type':'application/json'}});
  };
  vm.runInContext('openIndexChart(futuresRows()[0])',ctx);
  await new Promise(r=>nativeTimeout(r,10));
  assert.equal(requested.at(-1), '/api/futures?id=fut_es&period=5min');
  assert.match(document.querySelector('#modal-title').textContent, /S&P 500 · 캔들 차트/);
  assert.equal(document.querySelectorAll('.market-chart-body').length, 2);
  assert.doesNotMatch(document.querySelector('#modal-root').textContent, /SPX500_USDT|Gate|거래소 원자료/);
  document.querySelector('#modal-root').replaceChildren();
  ctx.fetch = async path => {
    requested.push(String(path));
    return Response.json({status:'ok',quote:{id:'search_SOL',name:'SOL',symbol:'SOLUSDT',value:120,
      observedAt:new Date().toISOString(),unit:'USDT',status:'live',timestampPrecision:'book'}});
  };
  vm.runInContext(`state.futuresQuotes.extended = [{id:'sector_xlk',name:'기술 ETF',value:156.85,
    unit:'USDT',status:'live',timestampPrecision:'book',observedAt:new Date().toISOString()}];
    document.getElementById('app').replaceChildren(renderQuotes(), renderSectors());`,ctx);
  const sector = document.querySelector('#us-sector-panel .futures-list-row');
  assert.match(sector.textContent, /기술XLK156.85/);
  assert.doesNotMatch(sector.textContent, /호가 중간값|데이터 연결 필요/);
  document.querySelector('[data-coin-search]').click();
  assert.equal(document.querySelector('#modal-title').textContent, '코인 선물 검색');
  document.querySelector('.coin-search-modal .instrument-sample').click();
  await new Promise(r=>nativeTimeout(r,10));
  assert.equal(requested.at(-1), '/api/instrument?market=CRYPTO&symbol=SOL');
  assert.match(document.querySelector('.coin-search-result').textContent, /SOL.*120.00.*실시간 호가/);
  assert.doesNotMatch(document.querySelector('.coin-search-result').textContent, /호가 중간값/);
  vm.runInContext(`state.market.quotes = [
    {id:'kospi',name:'코스피',value:4800,change:-1.4,observedAt:'2026-11-25T02:37:00Z',status:'delayed',timestampPrecision:'retrieval'},
    {id:'kr_foreign_kospi',name:'외국인',value:-1382.35,change:-1500,changeUnit:'억원',observedAt:'2026-11-25T02:37:00Z',status:'delayed',timestampPrecision:'retrieval'},
  ];
  document.getElementById('app').replaceChildren(renderMarketTable());renderMarketRows();`,ctx);
  assert.match(document.querySelector('.market-table-section-inner').textContent,/한국시장11:37 KST/);
  const table = document.querySelector('#market-table-body').textContent;
  assert.match(table,/-1.40%.*-1500.00억원/);
  assert.doesNotMatch(table,/장중 조회|장중 집계/);
  assert.equal((table.match(/11:37 KST/g)||[]).length,1);
  timers.forEach(nativeClearTimeout);
});
