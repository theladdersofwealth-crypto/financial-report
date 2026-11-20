import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
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
    location,navigator:{onLine:true},console,Intl,Date,URL,URLSearchParams,TextEncoder,queueMicrotask,
    setTimeout:localTimer,clearTimeout,setInterval:()=>0,clearInterval:()=>{},
    requestAnimationFrame:fn=>localTimer(fn,0),cancelAnimationFrame:clearTimeout,
    fetch:async path=>{requested.push(String(path));return new Response(JSON.stringify({initialized:true,setupAvailable:false}),{headers:{'Content-Type':'application/json'}})},
    WebSocket:class{static OPEN=1;},FormData,
  };
  domWindow.HTMLElement.prototype.focus=function(){};
  domWindow.HTMLElement.prototype.scrollIntoView=function(){};
  const ctx=vm.createContext(context);
  vm.runInContext(await readFile('public/app.js','utf8'),ctx,{filename:'app.js'});
  await new Promise(r=>nativeTimeout(r,20));
  if(!document.querySelector('.demo-banner')) {
    const demo=document.querySelector('.demo-entry');assert.ok(demo,'로그인 화면의 체험 버튼');demo.click();
  }
  assert.match(document.querySelector('.demo-banner').textContent,/예시 데이터/);
  for(const view of ['overview','markets','outlooks','calendar','sources','users','activity']) {
    const button=document.querySelector(`[data-view="${view}"]`);assert.ok(button,view);button.click();
    await new Promise(r=>nativeTimeout(r,5));
    assert.ok(document.querySelector('#main-column').textContent.trim().length>20,`${view} content`);
    assert.ok(document.querySelector('.demo-banner'),`${view} retains demo warning`);
  }
  assert.equal(requested.length,0,'file preview never contacts a member or market API');
  timers.forEach(nativeClearTimeout);
});
