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

test('US and Korean stock lookup use read-only KIS quotes, verify returned names and hide secret keys',async t=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(input,init={})=>{
    const u=new URL(String(input));
    assert.equal(u.hostname,'openapi.koreainvestment.com');
    if(u.pathname==='/oauth2/tokenP')return Response.json({access_token:'SECRET_BEARER_TEST',expires_in:86000});
    assert.equal(init.headers.authorization,'Bearer SECRET_BEARER_TEST');
    calls.push({path:u.pathname,tr:init.headers.tr_id,params:Object.fromEntries(u.searchParams)});
    if(u.pathname.endsWith('/domestic-stock/v1/quotations/inquire-price')){
      assert.equal(init.headers.tr_id,'FHKST01010100');
      assert.equal(u.searchParams.get('FID_INPUT_ISCD'),'005930');
      return Response.json({rt_cd:'0',output:{stck_prpr:'82000',prdy_ctrt:'-2.34'}});
    }
    if(u.pathname.endsWith('/domestic-stock/v1/quotations/search-stock-info')){
      assert.equal(init.headers.tr_id,'CTPF1002R');
      return Response.json({rt_cd:'0',output:{pdno:'005930',prdt_name:'삼성전자'}});
    }
    if(u.pathname.endsWith('/overseas-price/v1/quotations/price')){
      assert.equal(init.headers.tr_id,'HHDFS00000300');
      assert.equal(u.searchParams.get('EXCD'),'NAS');
      return Response.json({rt_cd:'0',output:{last:'235.80',rate:'1.53',rsym:'NASAAPL'}});
    }
    if(u.pathname.endsWith('/overseas-price/v1/quotations/search-info')){
      assert.equal(init.headers.tr_id,'CTPF1702R');
      return Response.json({rt_cd:'0',output:{pdno:'AAPL',ovrs_item_name:'Apple Inc.'}});
    }
    throw Error('unexpected KIS read');
  };
  t.after(()=>{globalThis.fetch=original});
  const env={KIS_APP_KEY:'PRIVATE_KEY_SAMPLE',KIS_APP_SECRET:'PRIVATE_SECRET_SAMPLE'};
  const kr=await searchInstrument(env,'KR','삼성전자');
  const us=await searchInstrument(env,'US','AAPL','NAS');
  assert.equal(kr.status,'ok');
  assert.equal(kr.quote.name,'삼성전자');
  assert.equal(kr.quote.unit,'KRW');
  assert.equal(kr.quote.value,82000);
  assert.equal(kr.quote.change,-2.34);
  assert.equal(us.status,'ok');
  assert.equal(us.quote.name,'Apple Inc.');
  assert.equal(us.quote.value,235.8);
  assert.equal(us.quote.unit,'USD');
  assert.equal(us.quote.exchange,'NAS');
  assert.equal(calls.length,4);
  assert.doesNotMatch(JSON.stringify([kr,us]),/PRIVATE_KEY_SAMPLE|PRIVATE_SECRET_SAMPLE|SECRET_BEARER_TEST/);
});

test('crypto user lookup uses Binance public BTC/USDT only, not an account API key',async t=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(input,init={})=>{
    const u=new URL(String(input));calls.push(u);
    assert.equal(u.hostname,'data-api.binance.vision');
    assert.equal(u.pathname,'/api/v3/ticker/24hr');
    assert.equal(u.searchParams.get('symbol'),'BTCUSDT');
    assert.equal(init.method,'GET');
    assert.equal(init.headers.Accept,'application/json');
    assert.equal(init.headers.Authorization,undefined);
    return Response.json({symbol:'BTCUSDT',lastPrice:'95600.13',priceChangePercent:'-1.25',closeTime:today(),count:5284});
  };
  t.after(()=>{globalThis.fetch=original});
  const res=await searchInstrument({},'CRYPTO','비트코인');
  assert.equal(res.status,'ok');
  assert.equal(res.quote.provider,'binance');
  assert.equal(res.quote.symbol,'BTCUSDT');
  assert.equal(res.quote.value,95600.13);
  assert.equal(res.quote.unit,'USDT');
  assert.equal(res.quote.change,-1.25);
  assert.equal(res.quote.timestampPrecision,'window_end');
  assert.equal(calls.length,1);
  assert.equal((await searchInstrument({},'CRYPTO','비트코인')).status,'ok');
  assert.equal(calls.length,1,'quick duplicate requests use short safe snapshot cache');
});

test('invalid search never touches KIS and stale/wrong pair is never represented as current',async t=>{
  const old=globalThis.fetch,names=[];
  globalThis.fetch=async(input)=>{
    const u=new URL(String(input));
    names.push(u.hostname);
    return Response.json({symbol:'ETHUSDT',lastPrice:'500',priceChangePercent:'2',
      closeTime:Date.now()-86_400_000});
  };
  t.after(()=>globalThis.fetch=old);
  assert.equal((await searchInstrument({},'KR','http://bad')).status,'invalid');
  assert.equal(names.length,0);
  assert.equal((await searchInstrument({},'CRYPTO','DOGE')).status,'unavailable');
  assert.deepEqual(names,['data-api.binance.vision','api.binance.com']);
});

test('worker search endpoint requires same authenticated active member as private market',async t=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({symbol:'SOLUSDT',lastPrice:'110',priceChangePercent:'1',
    closeTime:Date.now(),count:10});
  t.after(()=>globalThis.fetch=original);
  const requested=[];
  const stub={DESK:{idFromName:()=> 'private',get:()=>({
    fetch:async req=>{requested.push(new URL(req.url).pathname);return Response.json({user:{id:'member',role:'member',mustChangePassword:false}});}
  })}};
  const url='https://example.com/api/instrument?market=CRYPTO&symbol=SOL';
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
