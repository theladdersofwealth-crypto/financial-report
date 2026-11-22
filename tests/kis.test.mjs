import test from 'node:test';
import assert from 'node:assert/strict';

function iso(days=0) {
  return new Date(Date.now()-days*86400000).toISOString().slice(0,10).replace(/-/g,'');
}
let importNo = 0;
const fresh=()=>import(`../src/kis.js?test=${++importNo}`);
function withFetch(t,fn) {
  const prev=globalThis.fetch;
  globalThis.fetch=fn;
  t.after(()=>{globalThis.fetch=prev;});
}

test('KIS requires both server-side secrets; without them no requests occur',async t=>{
  withFetch(t,()=>{throw Error('unexpected API request');});
  const {collectKis,kisConfigured}=await fresh();
  assert.equal(kisConfigured({KIS_APP_KEY:'abc'}),false);
  assert.deepEqual(await collectKis({}),[]);
  assert.deepEqual(await collectKis({KIS_APP_KEY:'abc'}),[]);
});

test('KIS index and market foreign flow are parsed, with a shared cached bearer token',async t=>{
  const calls=[];
  withFetch(t,async(input,opts={})=>{
    const url=new URL(String(input));
    assert.equal(url.hostname,'openapi.koreainvestment.com');
    calls.push({path:url.pathname,method:opts.method||'GET',trid:opts.headers?.tr_id,auth:opts.headers?.authorization});
    if(url.pathname==='/oauth2/tokenP') {
      assert.equal(opts.method,'POST');
      const credentials=JSON.parse(opts.body);
      assert.equal(credentials.appkey,'mock-app-key');
      assert.equal(credentials.appsecret,'mock-app-secret');
      return Response.json({access_token:'mock-bearer',expires_in:86400});
    }
    assert.equal(opts.headers.authorization,'Bearer mock-bearer');
    if(url.pathname.endsWith('inquire-daily-indexchartprice')){
      const code=url.searchParams.get('FID_INPUT_ISCD');
      assert.equal(opts.headers.tr_id,'FHKUP03500100');
      assert.equal(url.searchParams.get('FID_COND_MRKT_DIV_CODE'),'U');
      const base=code==='0001'?3000:900;
      return Response.json({rt_cd:'0',output2:[
        {stck_bsop_date:iso(3),bstp_nmix_prpr:String(base)},
        {stck_bsop_date:iso(1),bstp_nmix_prpr:String(base+30)},
        {stck_bsop_date:iso(1),bstp_nmix_prpr:''},
      ]});
    }
    assert.equal(opts.headers.tr_id,'FHPTJ04040000');
    assert.equal(url.searchParams.get('FID_INPUT_DATE_1'),url.searchParams.get('FID_INPUT_DATE_2'),'KIS daily investor inquiry requires a single same-day date');
    const kospi=url.searchParams.get('FID_INPUT_ISCD_1')==='KSP';
    return Response.json({rt_cd:'0',output:[
      {stck_bsop_date:iso(3),frgn_ntby_tr_pbmn:kospi?'-5000':'2000'},
      {stck_bsop_date:iso(1),frgn_ntby_tr_pbmn:kospi?'7000':'-1000'},
    ]});
  });
  const {collectKis}=await fresh();
  const env={KIS_APP_KEY:'mock-app-key',KIS_APP_SECRET:'mock-app-secret'};
  const quotes=await collectKis(env);
  assert.equal(quotes.length,4);
  const byId=Object.fromEntries(quotes.map(q=>[q.id,q]));
  assert.equal(byId.kospi.value,3030);
  assert.equal(byId.kosdaq.value,930);
  assert.equal(byId.kospi.change,1);
  assert.equal(byId.kr_foreign_kospi.value,70);
  assert.equal(byId.kr_foreign_kospi.change,120);
  assert.equal(byId.kr_foreign_kosdaq.value,-10);
  assert.equal(byId.kr_foreign_kosdaq.change,-30);
  assert.equal(byId.kr_foreign_kosdaq.unit,'억원');
  assert.equal(byId.kr_foreign_kosdaq.source,'한국투자증권 KIS Open API');
  assert.equal(byId.kospi.status,'daily');
  assert.equal(calls.filter(c=>c.path==='/oauth2/tokenP').length,1);
  assert.equal(calls.filter(c=>c.method==='GET').length,4);
  await collectKis(env);
  assert.equal(calls.filter(c=>c.path==='/oauth2/tokenP').length,1,'token must be reused');
  assert.equal(JSON.stringify(quotes).includes('mock-app-secret'),false);
  assert.equal(JSON.stringify(quotes).includes('mock-bearer'),false);
});

test('KIS rejects failed authentication and never invents an index',async t=>{
  let calls=0;
  withFetch(t,async()=>{calls++;return new Response('forbidden',{status:403});});
  const {collectKis}=await fresh();
  assert.deepEqual(await collectKis({KIS_APP_KEY:'rejected',KIS_APP_SECRET:'rejected-secret'}),[]);
  assert.equal(calls,1);
});

test('KIS malformed output or forbidden permissions yield no artificial quotes',async t=>{
  withFetch(t,async(input)=>{
    const url=new URL(String(input));
    if(url.pathname==='/oauth2/tokenP') return Response.json({access_token:'good-token',expires_in:86400});
    if(url.pathname.includes('inquire-daily-indexchartprice'))return Response.json({rt_cd:'0',output2:[{stck_bsop_date:'20261399',bstp_nmix_prpr:'4000'}]});
    return Response.json({rt_cd:'1',msg_cd:'ACCESS_DENIED',output:[{stck_bsop_date:iso(1),frgn_ntby_tr_pbmn:'9999'}]});
  });
  const {collectKis}=await fresh();
  assert.deepEqual(await collectKis({KIS_APP_KEY:'bad-data',KIS_APP_SECRET:'bad-data-secret'}),[]);
});
