import test from 'node:test';
import assert from 'node:assert/strict';

let moduleNumber=0;
const fresh=()=>import(`../src/kis.js?flowrestore=${++moduleNumber}`);
const credentials={KIS_APP_KEY:'FLOW_TEST_APPKEY',KIS_APP_SECRET:'FLOW_TEST_APPSECRET'};
function expectedDay() {
  const kst=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replace(/\D/g,'');
  const date=new Date(`${kst.slice(0,4)}-${kst.slice(4,6)}-${kst.slice(6,8)}T00:00:00Z`);
  while(date.getUTCDay()===0||date.getUTCDay()===6)date.setUTCDate(date.getUTCDate()-1);
  return date.toISOString().slice(0,10).replace(/-/g,'');
}
function previousWeekday(date) {
  const d=new Date(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T00:00:00Z`);
  do{d.setUTCDate(d.getUTCDate()-1)}while(d.getUTCDay()===0||d.getUTCDay()===6);
  return d.toISOString().slice(0,10).replace(/-/g,'');
}
function mockFetch(calls,onFlow) {
  return async (input,options={})=>{
    const url=new URL(String(input));
    if(url.pathname==='/oauth2/tokenP')return Response.json({access_token:'TOKEN_DO_NOT_LOG',expires_in:86400});
    assert.equal(options.headers?.authorization,'Bearer TOKEN_DO_NOT_LOG');
    if(url.pathname.endsWith('/inquire-investor-daily-by-market')){
      const params=url.searchParams;
      assert.equal(options.headers.tr_id,'FHPTJ04040000');
      assert.equal(params.get('FID_INPUT_DATE_1'),params.get('FID_INPUT_DATE_2'));
      const market=params.get('FID_INPUT_ISCD_1');
      assert.ok(['KSP','KSQ'].includes(market));
      const date=params.get('FID_INPUT_DATE_1');
      calls.push({market,date});
      return onFlow({market,date,attempt:calls.filter(x=>x.market===market).length});
    }
    if(url.pathname.endsWith('/inquire-daily-indexchartprice'))return Response.json({rt_cd:'0',output2:[]});
    throw Error('unexpected KIS route');
  };
}
test('foreign flows are requested ahead of index histories; retry exact date once on transient error',async t=>{
  const original=globalThis.fetch,calls=[];
  const today=expectedDay();
  globalThis.fetch=mockFetch(calls,({market,date,attempt})=>attempt===1
    ? Response.json({rt_cd:'1',msg_cd:'EGW00201'})
    : Response.json({rt_cd:'0',output:[
      {stck_bsop_date:date,frgn_ntby_tr_pbmn:market==='KSP'?'-1095596':'-161611'},
    ]}));
  t.after(()=>globalThis.fetch=original);
  const {collectKis}=await fresh();
  const quotes=await collectKis(credentials);
  assert.deepEqual(quotes.map(q=>q.id).sort(),['kr_foreign_kosdaq','kr_foreign_kospi']);
  assert.equal(calls.length,4);
  assert.equal(calls[0].date,today);
  assert.equal(calls[1].date,today);
  assert.equal(quotes.find(q=>q.id==='kr_foreign_kospi').value,-10955.96);
  assert.equal(quotes.find(q=>q.id==='kr_foreign_kosdaq').value,-1616.11);
  assert.equal(quotes.every(q=>q.reason?.includes('재조회 성공')),true);
  assert.doesNotMatch(JSON.stringify(quotes),/TOKEN_DO_NOT_LOG|FLOW_TEST_APPSECRET/);
});
test('no observation on holiday or delay: use only previous weekday real KIS values',async t=>{
  const original=globalThis.fetch,calls=[],today=expectedDay(),previous=previousWeekday(today);
  globalThis.fetch=mockFetch(calls,({date,market})=>Response.json({rt_cd:'0',output:date===previous
    ? [{stck_bsop_date:previous,frgn_ntby_tr_pbmn:market==='KSP'?'4500':'-3400'}] : []}));
  t.after(()=>globalThis.fetch=original);
  const {collectKis}=await fresh();
  const flows=await collectKis(credentials);
  assert.equal(calls.length,6);
  assert.equal(calls.filter(c=>c.date===today).length,4);
  assert.equal(calls.filter(c=>c.date===previous).length,2);
  for(const f of flows){
    assert.equal(f.observedAt,previous.replace(/(\d{4})(\d{2})(\d{2})/,'$1-$2-$3'));
    assert.match(f.reason,/전 거래일 관측값/);
    assert.equal(f.provider,'kis');
  }
});
test('after confirmed observations, temporary KIS blackout displays same confirmed day with warning',async t=>{
  const original=globalThis.fetch,calls=[];
  let failing=false;
  globalThis.fetch=mockFetch(calls,({market,date})=>failing
    ? Response.json({rt_cd:'1',msg_cd:'EGW00201'})
    : Response.json({rt_cd:'0',output:[{stck_bsop_date:date,frgn_ntby_tr_pbmn:market==='KSP'?'50100':'-2100'}]}));
  t.after(()=>globalThis.fetch=original);
  const {collectKis}=await fresh();
  const normal=await collectKis(credentials);
  assert.equal(normal.length,2);
  failing=true;
  const backup=await collectKis(credentials);
  assert.equal(backup.length,2);
  for(const q of backup){
    assert.equal(q.status,'delayed');
    assert.match(q.reason,/재조회 실패/);
    assert.equal(q.value,normal.find(x=>x.id===q.id).value);
    assert.equal(q.observedAt,normal.find(x=>x.id===q.id).observedAt);
  }
});
