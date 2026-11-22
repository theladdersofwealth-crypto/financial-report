import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {chartSeries,chartPeriod,chartPeriodChange,chartFrequency,candleSeries} from '../public/chart-data.js';
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
    chartSeries,chartPeriod,chartPeriodChange,chartFrequency,candleSeries,
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
  vm.runInContext(browserModule.replace(/^import [^\n]+\n/,'').trimStart(),ctx,{filename:'app.js'});
  await new Promise(r=>nativeTimeout(r,20));
  if(!document.querySelector('.demo-banner')) {
    const demo=document.querySelector('.demo-entry');assert.ok(demo,'로그인 화면의 체험 버튼');demo.click();
  }
  assert.match(document.querySelector('.demo-banner').textContent,/예시 데이터/);
  const topics=[...document.querySelectorAll('.metric-section-title')].map(el=>el.textContent);
  assert.deepEqual(topics.slice(0,5),[
    '한국 증시 · 외국인·연기금 수급','미국 증시 · 위험 심리','금리 · 환율','원자재','디지털자산'
  ],'five distinct topic headings should be visible in order');
  assert.equal(document.querySelectorAll('.metric-jump-button').length,topics.length);
  assert.ok(document.querySelectorAll('.overview-section-intro').length>=3,
    'interpretation, sector and forecast panels must have section titles');
  for (const section of document.querySelectorAll('.metric-section')) {
    assert.ok(section.querySelector('.metric-section-description')?.textContent.trim());
    assert.ok(section.querySelectorAll('.quote-card').length>0);
  }
  for(const view of ['overview','markets','instrument','outlooks','calendar','sources','users','activity']) {
    const button=document.querySelector(`[data-view="${view}"]`);assert.ok(button,view);button.click();
    await new Promise(r=>nativeTimeout(r,5));
    assert.ok(document.querySelector('#main-column').textContent.trim().length>20,`${view} content`);
    assert.ok(document.querySelector('.demo-banner'),`${view} retains demo warning`);
  }
  // Registration is a separate four-field flow; existing member and
  // administrator login modes retain their original credential formats.
  vm.runInContext('renderWelcome("register")',ctx);
  assert.ok(document.querySelector('input[name="nickname"]'));
  assert.ok(document.querySelector('input[name="birth6"]'));
  assert.equal(document.querySelector('input[name="birth6"]').getAttribute('maxlength'),'6');
  assert.ok(document.querySelector('#registerGender'));
  assert.equal(document.querySelector('#registerGender').querySelectorAll('option').length,3);
  assert.ok(document.querySelector('input[name="pin"]'));
  assert.equal(document.querySelector('input[name="pin"]').getAttribute('maxlength'),'4');
  vm.runInContext('renderWelcome("pin")',ctx);
  assert.equal(document.querySelector('input[name="birth6"]'),null,'existing PIN members are not blocked by new profile fields');
  assert.ok(document.querySelector('input[name="pin"]'));
  vm.runInContext('renderWelcome("login")',ctx);
  assert.ok(document.querySelector('input[name="username"]'),'legacy admin/password sign-in still exists');
  assert.equal(document.querySelector('input[name="birth6"]'),null);
  assert.equal(requested.length,0,'file preview never contacts a member or market API');
  timers.forEach(nativeClearTimeout);
});
