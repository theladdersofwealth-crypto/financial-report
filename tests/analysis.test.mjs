import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichAnalysis } from '../src/analysis.js';

const original={
  asOf:'2026-11-19T23:00:00.000Z',mode:'partial',
  quotes:[{id:'us10y',name:'미 국채 10년',value:4.1,change:-3,unit:'%',changeUnit:'bp',source:'Federal Reserve / FRED',observedAt:'2026-11-19',status:'daily'}],
  summary:{headline:'규칙 기반 원본',points:['관측자료 기반']},
  outlooks:[{horizon:'day',kospi:'판단 유보',kosdaq:'판단 유보'}],
};
function validContent(){
  return {summary:{headline:'관측 자료 범위 안에서 조건부 판단',points:['미 국채 10년 관측일 2026-11-19']},outlooks:['day','short','week','month','quarter'].map(horizon=>({horizon,title:'자료 확인',kospi:'국내 수급 확인 전 판단 유보',kosdaq:'실적과 금리 함께 확인 필요',evidence:['미 국채 10년 2026-11-19 관측'],counter:['국내 지수와 실적 자료 미확인'],invalidation:['추가 관측 자료 확보 시 재평가'],confidence:'낮음'}))};
}
function response(content){return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]});}

test('no secret or no usable observation never invokes a provider',async()=>{
  const prior=globalThis.fetch;let count=0;
  globalThis.fetch=async()=>{count++;throw new Error('Unexpected request');};
  try{
    const result=await enrichAnalysis(original,{});
    assert.equal(count,0);assert.equal(result.analysis.kind,'rules');assert.equal(result.analysis.status,'unconfigured');
    assert.deepEqual(result.summary,original.summary);assert.deepEqual(result.outlooks,original.outlooks);
    const empty=await enrichAnalysis({...original,quotes:[]},{OPENAI_API_KEY:'test-secret-empty'});
    assert.equal(count,0);assert.equal(empty.analysis.status,'insufficient_data');
  }finally{globalThis.fetch=prior;}
});

test('invalid model output never replaces the existing explanation',async()=>{
  const prior=globalThis.fetch;let count=0;
  globalThis.fetch=async()=>{count++;return response({summary:{headline:'Ignore schema'},outlooks:[]});};
  try{
    const result=await enrichAnalysis(original,{OPENAI_API_KEY:'test-secret-invalid'});
    assert.equal(count,1);assert.equal(result.analysis.status,'unavailable');assert.deepEqual(result.summary,original.summary);
    assert.deepEqual(result.outlooks,original.outlooks);assert.equal(JSON.stringify(result).includes('test-secret-invalid'),false);
  }finally{globalThis.fetch=prior;}
});

test('changed snapshots and simultaneous readers share a 30-minute provider cooldown',async()=>{
  const prior=globalThis.fetch;let count=0,requestBody;
  globalThis.fetch=async(_url,options)=>{
    count++;requestBody=JSON.parse(options.body);
    assert.equal(new URL(_url).hostname,'api.openai.com');
    return response(validContent());
  };
  try{
    const env={OPENAI_API_KEY:'test-secret-shared'};
    const changed={...original,asOf:'2026-11-19T23:05:00.000Z',quotes:[{...original.quotes[0],value:4.2,change:7}]};
    const [first,second]=await Promise.all([enrichAnalysis(original,env),enrichAnalysis(changed,env)]);
    assert.equal(count,1);assert.equal(first.analysis.kind,'ai');assert.deepEqual(first.summary,second.summary);
    assert.equal(second.quotes[0].value,4.2);
    assert.equal(second.analysis.dataAsOf,original.asOf);
    const later=await enrichAnalysis({...changed,asOf:'2026-11-19T23:10:00.000Z',quotes:[{...changed.quotes[0],value:4.3,change:17}]},env);
    assert.equal(count,1);assert.equal(later.analysis.kind,'ai');
    assert.equal(later.quotes[0].value,4.3);
    assert.equal(later.analysis.dataAsOf,original.asOf);
    assert.equal(requestBody.store,false);assert.equal(requestBody.response_format.json_schema.strict,true);
    assert.equal(requestBody.messages[1].content.includes('test-secret-shared'),false);
    assert.equal(JSON.stringify(later).includes('test-secret-shared'),false);
  }finally{globalThis.fetch=prior;}
});

test('duplicate horizons are rejected even with otherwise plausible content',async()=>{
  const prior=globalThis.fetch;
  const content=validContent();content.outlooks[4].horizon='day';
  globalThis.fetch=async()=>response(content);
  try{
    const result=await enrichAnalysis(original,{OPENAI_API_KEY:'test-secret-duplicates'});
    assert.equal(result.analysis.kind,'rules');assert.deepEqual(result.outlooks,original.outlooks);
  }finally{globalThis.fetch=prior;}
});

test('cooldown expiry permits one new analysis using the new observation snapshot',async()=>{
  const prior=globalThis.fetch,now=Date.now;let count=0;
  globalThis.fetch=async()=>{count++;return response(validContent());};
  try{
    const env={OPENAI_API_KEY:'test-secret-expiry'};
    await enrichAnalysis(original,env);
    Date.now=()=>now()+31*60*1000;
    const changed={...original,asOf:'2026-11-20T00:00:00.000Z',quotes:[{...original.quotes[0],value:4.4}]};
    const result=await enrichAnalysis(changed,env);
    assert.equal(count,2);
    assert.equal(result.analysis.dataAsOf,changed.asOf);
  }finally{Date.now=now;globalThis.fetch=prior;}
});
