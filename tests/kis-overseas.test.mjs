import test from 'node:test';
import assert from 'node:assert/strict';
import {collectKisOverseas} from '../src/kis.js';

function date(offset=0) {
  return new Date(Date.now()-offset*86400000).toISOString().slice(0,10).replace(/-/g,'');
}
function fetchMock(calls,{rejectSector=false,wrongIndex=false}={}){
  return async (input,options={})=>{
    const url=new URL(input);
    assert.equal(url.hostname,'openapi.koreainvestment.com');
    const headers=options.headers||{};
    if(url.pathname==='/oauth2/tokenP') {
      assert.equal(options.method,'POST');
      return Response.json({access_token:'TEST_TOKEN_PRIVATE',expires_in:86400});
    }
    assert.equal(headers.authorization,'Bearer TEST_TOKEN_PRIVATE');
    calls.push({path:url.pathname,code:headers.tr_id,params:Object.fromEntries(url.searchParams)});
    if(url.pathname.endsWith('inquire-daily-chartprice')){
      assert.equal(headers.tr_id,'FHKST03030100');
      assert.equal(url.searchParams.get('FID_COND_MRKT_DIV_CODE'),'N');
      assert.equal(url.searchParams.get('FID_PERIOD_DIV_CODE'),'D');
      const close=wrongIndex?9000:101;
      return Response.json({rt_cd:'0',output2:[
        {stck_bsop_date:date(3),ovrs_nmix_prpr:'100'},
        {stck_bsop_date:date(1),ovrs_nmix_prpr:String(close)},
      ]});
    }
    assert.equal(url.pathname,'/uapi/overseas-price/v1/quotations/price');
    assert.equal(headers.tr_id,'HHDFS00000300');
    assert.equal(url.searchParams.get('AUTH'),'');
    const symbol=url.searchParams.get('SYMB');
    const exchange=url.searchParams.get('EXCD');
    assert.ok(['NAS','AMS'].includes(exchange));
    if(rejectSector&&symbol==='XLK')return Response.json({rt_cd:'1',msg_cd:'ACCESS_DENIED'});
    return Response.json({rt_cd:'0',output:{last:'123.45',rate:'-2.75',rsym:exchange+symbol}});
  };
}

test('read-only KIS US quotes reuse credentials, accept overseas index daily and equity/ETF quotes',async t=>{
  const saved=globalThis.fetch,calls=[];
  globalThis.fetch=fetchMock(calls);
  t.after(()=>globalThis.fetch=saved);
  const env={KIS_APP_KEY:'us-fixture-key-1',KIS_APP_SECRET:'us-fixture-secret-1'};
  const result=await collectKisOverseas(env);
  assert.equal(result.indices.length,4);
  assert.equal(result.leaders.length,7);
  assert.equal(result.sectors.length,11);
  const sp=result.indices.find(x=>x.id==='sp500');
  assert.equal(sp.value,101);
  assert.equal(sp.change,1);
  assert.equal(sp.history.length,2);
  assert.equal(sp.observedAt,date(1).replace(/(\d{4})(\d{2})(\d{2})/,'$1-$2-$3'));
  const nvda=result.leaders.find(x=>x.id==='nvda');
  assert.equal(nvda.value,123.45);
  assert.equal(nvda.change,-2.75);
  assert.equal(nvda.timestampPrecision,'retrieval');
  assert.equal(nvda.status,'delayed');
  assert.match(nvda.delay,/체결시각 미제공/);
  assert.equal(result.sectors.find(x=>x.id==='xlk')?.symbol,'XLK');
  assert.equal(calls.length,22);
  const safe=JSON.stringify(result);
  assert.doesNotMatch(safe,/us-fixture-secret-1|TEST_TOKEN_PRIVATE|us-fixture-key-1/);
});

test('unauthorized overseas quotes are unavailable, not guessed from alternate symbols',async t=>{
  const saved=globalThis.fetch,calls=[];
  globalThis.fetch=fetchMock(calls,{rejectSector:true});
  t.after(()=>globalThis.fetch=saved);
  const env={KIS_APP_KEY:'us-fixture-key-2',KIS_APP_SECRET:'us-fixture-secret-2'};
  const result=await collectKisOverseas(env);
  assert.equal(result.sectors.some(x=>x.id==='xlk'),false);
  assert.equal(result.sectors.length,10);
  assert.equal(calls.length,22);
});

test('unconfigured KIS overseas never calls a provider',async t=>{
  const saved=globalThis.fetch;
  globalThis.fetch=()=>{throw Error('should not fetch');};
  t.after(()=>globalThis.fetch=saved);
  assert.deepEqual(await collectKisOverseas({}),{indices:[],sectors:[],leaders:[]});
});
