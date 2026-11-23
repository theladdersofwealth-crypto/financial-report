import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {chartSeries,chartPeriod,chartPeriodChange,chartFrequency,candleSeries,minuteFrequencies,intradayMinutes,aggregateIndexMinutes} from '../public/chart-data.js';
import {fxCurrencies, featuredFxCodes} from '../public/fx-currencies.js';
import {usFutures, futuresPeriods} from '../public/futures-config.js';
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
    fxCurrencies,featuredFxCodes,usFutures,futuresPeriods,
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
  vm.runInContext(browserModule.replace(/^import [^\n]+\n/gm,'').trimStart(),ctx,{filename:'app.js'});
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
  const contrasts = vm.runInContext(`briefSignals({
    impact: {kospi: {state: '혼재', drivers: [{id: 'sox', name: '미국 반도체', stance: '우호', weight: 3}]},
      kosdaq: {state: '혼재', drivers: [{id: 'usreal10y', name: '미 실질금리', stance: '부담', weight: 2}]}},
    quotes: [{id: 'sox', change: 1.25, changeUnit: '%'}, {id: 'usreal10y', change: 3, changeUnit: 'bp'}],
  })`,ctx);
  assert.equal(contrasts.headline, '해외 지표의 신호가 엇갈립니다');
  assert.equal(contrasts.evidence, '미국 반도체 현물 +1.25% · 미 실질금리 +3.0bp');

  const topics=[...document.querySelectorAll('.metric-section-title')].map(el=>el.textContent);
  assert.deepEqual(topics.slice(0,6),[
    '한국 증시 · 외국인·연기금 수급','미국 지수선물','금리','원화 환율','원자재','디지털자산'
  ],'six distinct topic headings should be visible in order');
  assert.equal(document.querySelectorAll('.metric-jump-button').length,topics.length);
  assert.equal(document.querySelectorAll('.overview-section-intro').length, 2,
    'sector and outlook sections keep their own headings');
  for (const section of document.querySelectorAll('.metric-section')) {
    if (section.id !== 'metrics-korea') assert.ok(section.querySelector('.metric-section-description')?.textContent.trim());
    else assert.equal(section.querySelector('.metric-section-description'),null);
    assert.ok(section.querySelectorAll('.quote-card').length>0);
  }
  for(const view of ['overview','markets','fx','instrument','outlooks','calendar','sources','users','activity']) {
    const button=document.querySelector(`[data-view="${view}"]`);assert.ok(button,view);button.click();
    await new Promise(r=>nativeTimeout(r,5));
    assert.ok(document.querySelector('#main-column').textContent.trim().length>20,`${view} content`);
    assert.ok(document.querySelector('.demo-banner'),`${view} retains demo warning`);
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
  assert.match(document.querySelector('.quote-provenance').textContent, /한국투자증권.*2026-11-20 기준/);
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
  document.querySelector('.fx-list .quote-card').click();
  assert.match(document.querySelector('#modal-root').textContent, /베트남 동 · 일별 원화 환율 차트/);
  assert.ok(document.querySelector('.market-chart-svg'));
  assert.match(document.querySelector('.market-chart-svg').getAttribute('aria-label'), /기준환율 추이/);
  document.querySelector('#modal-root').replaceChildren();
  ctx.fetch = async path => {
    requested.push(String(path));
    return new Response(JSON.stringify({status:'ready',contract:'ESZ26',source:'한국투자증권 KIS 해외선물',bars:[
      {date:'2026-11-20 21:05:00',open:7000,high:7010,low:6995,close:7002,value:7002},
      {date:'2026-11-20 21:10:00',open:7002,high:7020,low:7001,close:7018,value:7018},
    ]}), {headers:{'Content-Type':'application/json'}});
  };
  vm.runInContext('openIndexChart(futuresRows()[0])',ctx);
  await new Promise(r=>nativeTimeout(r,10));
  assert.equal(requested.at(-1), '/api/futures?id=fut_es&period=5min');
  assert.match(document.querySelector('#modal-title').textContent, /S&P 500 선물 · 캔들 차트/);
  assert.equal(document.querySelectorAll('.market-chart-body').length, 2);
  assert.match(document.querySelector('.market-chart-footnote').textContent, /ESZ26.*TradingView/);
  timers.forEach(nativeClearTimeout);
});
