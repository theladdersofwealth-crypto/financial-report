import test from 'node:test';
import assert from 'node:assert/strict';

let counter=0;
const fresh=()=>import(`../src/kis.js?macrotest=${++counter}`);
const day=()=>new Date(Date.now()-86400000).toISOString().slice(0,10).replace(/-/g,'');
const credentials={KIS_APP_KEY:'TEST_APP_KEY_ONLY',KIS_APP_SECRET:'TEST_APP_SECRET_ONLY'};

test('KIS rate and DXY probes use read-only endpoints, validate exact identity and share cached token',async t=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(input,opts={})=>{
    const u=new URL(String(input));
    if(u.pathname==='/oauth2/tokenP')return Response.json({access_token:'TEST_TOKEN',expires_in:86400});
    assert.equal(opts.headers?.authorization,'Bearer TEST_TOKEN');
    calls.push({path:u.pathname,tr:opts.headers?.tr_id,params:Object.fromEntries(u.searchParams)});
    if(u.pathname.endsWith('/comp-interest')){
      assert.equal(opts.headers?.tr_id,'FHPST07020000');
      assert.equal(u.searchParams.get('FID_COND_SCR_DIV_CODE'),'20702');
      const group=u.searchParams.get('FID_DIV_CLS_CODE');
      return Response.json({rt_cd:'0',output1:group==='2' ? [
        {hts_kor_isnm:'국고채 3년',bond_mnrt_prpr:'2.872',stck_bsop_date:day()},
        {hts_kor_isnm:'국고채 10년',bond_mnrt_prpr:'3.019',stck_bsop_date:day()},
        {hts_kor_isnm:'미국 국채 3년',bond_mnrt_prpr:'7.000',stck_bsop_date:day()},
      ]:[]});
    }
    assert.equal(u.pathname,'/uapi/overseas-price/v1/quotations/inquire-daily-chartprice');
    assert.equal(opts.headers?.tr_id,'FHKST03030100');
    assert.equal(u.searchParams.get('FID_COND_MRKT_DIV_CODE'),'N');
    assert.equal(u.searchParams.get('FID_INPUT_ISCD'),'.DXY');
    return Response.json({rt_cd:'0',output1:{hts_kor_isnm:'US Dollar Index'},output2:[
      {stck_bsop_date:day(),ovrs_nmix_prpr:'101.1'},
      {stck_bsop_date:new Date(Date.now()-3*86400000).toISOString().slice(0,10).replace(/-/g,''),ovrs_nmix_prpr:'100'},
    ]});
  };
  t.after(()=>globalThis.fetch=original);
  const {collectKisMacro}=await fresh();
  const quotes=await collectKisMacro(credentials);
  assert.deepEqual(quotes.map(q=>q.id).sort(),['dxy','kr10y','kr3y']);
  const byId=Object.fromEntries(quotes.map(q=>[q.id,q]));
  assert.equal(byId.kr3y.value,2.872);
  assert.equal(byId.kr10y.value,3.019);
  assert.equal(byId.kr3y.unit,'%');
  assert.equal(byId.kr3y.change,null);
  assert.equal(byId.dxy.value,101.1);
  assert.equal(byId.dxy.unit,'pt');
  assert.equal(calls.length,3);
  assert.equal((await collectKisMacro(credentials)).length,3);
  assert.equal(calls.length,3,'unsupported and successful probes are cached for one hour');
  assert.doesNotMatch(JSON.stringify(quotes),/TEST_APP_KEY_ONLY|TEST_APP_SECRET_ONLY|TEST_TOKEN/);
});

test('KIS macro mismatched, stale and futures-labelled responses never become DXY or Korean benchmark rates',async t=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(input)=>{
    const u=new URL(String(input));
    if(u.pathname==='/oauth2/tokenP')return Response.json({access_token:'SAFE',expires_in:86400});
    if(u.pathname.endsWith('/comp-interest'))return Response.json({rt_cd:'0',output1:[
      {hts_kor_isnm:'미국 국채 3년',bond_mnrt_prpr:'4.0',stck_bsop_date:day()},
      {hts_kor_isnm:'국고채 10년',bond_mnrt_prpr:'0',stck_bsop_date:day()},
      {hts_kor_isnm:'국고채 3년',bond_mnrt_prpr:'3.05',stck_bsop_date:'20241231'},
    ]});
    return Response.json({rt_cd:'0',output1:{hts_kor_isnm:'US Dollar Index Futures'},output2:[
      {stck_bsop_date:day(),ovrs_nmix_prpr:'105'},
    ]});
  };
  t.after(()=>globalThis.fetch=original);
  const {collectKisMacro}=await fresh();
  assert.deepEqual(await collectKisMacro({KIS_APP_KEY:'DIFFERENT_K',KIS_APP_SECRET:'DIFFERENT_S'}),[]);
});

test('missing KIS configuration cannot start macro probe',async t=>{
  const original=globalThis.fetch;
  globalThis.fetch=()=>{throw Error('must not fetch');};
  t.after(()=>globalThis.fetch=original);
  const {collectKisMacro}=await fresh();
  assert.deepEqual(await collectKisMacro({}),[]);
});
