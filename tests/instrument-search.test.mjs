import test from 'node:test';
import assert from 'node:assert/strict';
import {searchInstrument,normalizeSearch} from '../src/instrument-search.js';
import worker from '../src/worker.js';

const today=()=>Date.now();

test('input checks: supported market, Korean common names, exact six digits and US ticker (never free-form URLs)',()=>{
  assert.deepEqual(normalizeSearch('KR','삼성전자'),{market:'KR',symbol:'005930',exchange:''});
  assert.deepEqual(normalizeSearch('KR','SK하이닉스'),{market:'KR',symbol:'000660',exchange:''});
  assert.deepEqual(normalizeSearch('US','애플'),{market:'US',symbol:'AAPL',exchange:''});
  assert.deepEqual(normalizeSearch('US','BRK.B'),{market:'US',symbol:'BRK.B',exchange:''});
  assert.deepEqual(normalizeSearch('CRYPTO','비트코인'),{market:'CRYPTO',symbol:'BTC',exchange:''});
  assert.equal(normalizeSearch('KR','AAPL'),null);
  assert.equal(normalizeSearch('US','삼성전자'),null);
  assert.equal(normalizeSearch('US','http://evil.example'),null);
  assert.equal(normalizeSearch('CRYPTO','BTC?foo=bar'),null);
  assert.equal(normalizeSearch('KR','005930','NYS'),null);
});

test('Korean stock lookup retains the domestic KIS spot quote and its source',async t=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(input,init={})=>{
    const u=new URL(String(input));
    assert.equal(u.hostname,'openapi.koreainvestment.com');
    if(u.pathname==='/oauth2/tokenP')return Response.json({access_token:'SECRET_BEARER_TEST',expires_in:86000});
    assert.equal(init.headers.authorization,'Bearer SECRET_BEARER_TEST');
    calls.push(u.pathname);
    if(u.pathname.endsWith('/domestic-stock/v1/quotations/inquire-price')){
      assert.equal(u.searchParams.get('FID_INPUT_ISCD'),'005930');
      return Response.json({rt_cd:'0',output:{stck_prpr:'82000',prdy_ctrt:'-2.34'}});
    }
    return Response.json({rt_cd:'0',output:{pdno:'005930',prdt_name:'삼성전자'}});
  };
  t.after(()=>{globalThis.fetch=original});
  const kr=await searchInstrument({KIS_APP_KEY:'PRIVATE_KEY_SAMPLE',KIS_APP_SECRET:'PRIVATE_SECRET_SAMPLE'},'KR','삼성전자');
  assert.equal(kr.status,'ok');
  assert.equal(kr.quote.name,'삼성전자');
  assert.equal(kr.quote.productType,'국내 현물');
  assert.equal(kr.quote.unit,'KRW');
  assert.equal(kr.quote.value,82000);
  assert.equal(kr.quote.change,-2.34);
  assert.equal(calls.length,2);
  assert.doesNotMatch(JSON.stringify(kr),/PRIVATE_KEY_SAMPLE|PRIVATE_SECRET_SAMPLE|SECRET_BEARER_TEST/);
});

test('US and crypto searches show unsigned USDT perpetual order books',async t=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(input,init={})=>{
    const u=new URL(String(input));calls.push(u);
    assert.equal(u.hostname,'api.gateio.ws');
    assert.match(u.pathname,/futures\/usdt\/order_book$/);
    assert.equal(init.headers?.Authorization,undefined);
    const midpoint = u.searchParams.get('contract') === 'AAPL_USDT' ? 236 : 95600;
    return Response.json({update:today()/1000,bids:[{p:midpoint-1}],asks:[{p:midpoint+1}]});
  };
  t.after(()=>{globalThis.fetch=original});
  const us=await searchInstrument({},'US','AAPL','NAS');
  const crypto=await searchInstrument({},'CRYPTO','비트코인');
  assert.equal(us.quote.contract,'AAPL_USDT');
  assert.equal(us.quote.value,236);
  assert.equal(crypto.quote.symbol,'BTC_USDT');
  assert.equal(crypto.quote.value,95600);
  for (const result of [us,crypto]) {
    assert.equal(result.status,'ok');
    assert.equal(result.quote.unit,'USDT');
    assert.equal(result.quote.timestampPrecision,'book');
  }
  assert.equal((await searchInstrument({},'CRYPTO','비트코인')).status,'ok');
  assert.equal(calls.length,2);
});

test('dynamic lookup rejects a TradFi perpetual when searching for a coin',async t=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(input)=>{
    const u=new URL(String(input));calls.push(u.pathname);
    return Response.json({retCode:0,result:{list:[{
      symbol:'DOGEUSDT',baseCoin:'DOGE',quoteCoin:'USDT',contractType:'LinearPerpetual',status:'Trading',symbolType:'stock'
    }]}});
  };
  t.after(()=>globalThis.fetch=original);
  assert.equal((await searchInstrument({},'KR','http://bad')).status,'invalid');
  assert.equal(calls.length,0);
  assert.equal((await searchInstrument({},'CRYPTO','DOGE')).status,'unavailable');
  assert.deepEqual(calls,['/v5/market/instruments-info']);
});

test('worker search endpoint requires same authenticated active member as private market',async t=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({update:today()/1000,bids:[{p:109}],asks:[{p:111}]});
  t.after(()=>globalThis.fetch=original);
  const requested=[];
  const stub={DESK:{idFromName:()=> 'private',get:()=>({
    fetch:async req=>{requested.push(new URL(req.url).pathname);return Response.json({user:{id:'member',role:'member',mustChangePassword:false}});}
  })}};
  const url='https://example.com/api/instrument?market=CRYPTO&symbol=ETH';
  const response=await worker.fetch(new Request(url),stub);
  assert.equal(response.status,200);
  assert.equal((await response.json()).quote.value,110);
  assert.deepEqual(requested,['/api/me']);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const denied=await worker.fetch(new Request(url),{DESK:{idFromName:()=> 'private',get:()=>({
    fetch:async()=>Response.json({error:'login required'},{status:401})
  })}});
  assert.equal(denied.status,401);
  const forbidden=await worker.fetch(new Request(url,{method:'POST'}),stub);
  assert.equal(forbidden.status,405);
});
