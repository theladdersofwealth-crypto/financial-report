import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHistoricalImpact } from '../src/validation.js';

function series(id, values, group='equity') {
  return {id,group,source:'test provider',history:values};
}
function dataDays(count=48) {
  return Array.from({length:count},(_,i)=>{
    const d=new Date(Date.UTC(2026,8,1+i));
    return d.toISOString().slice(0,10);
  });
}

test('absence of historical Korean closes never yields a backtest percentage',()=>{
  const review=validateHistoricalImpact({quotes:[]});
  assert.equal(review.kospi.status,'insufficient_sample');
  assert.equal(review.kospi.agreementRate,null);
  assert.equal(review.kosdaq.classifiedDays,0);
});

test('reconstructed signals use strictly earlier foreign dates and minimum observations',()=>{
  const days=dataDays(50);
  const history=(fn)=>days.map((date,i)=>({date,value:fn(i)}));
  const quotes=[
    series('kospi',history(i=>2000+i*10),'korea'),
    series('kosdaq',history(i=>900+i*5),'korea'),
    series('sox',history(i=>100+i)),
    series('nasdaq',history(i=>200+i)),
    series('sp500',history(i=>300+i)),
    series('usdkrw',history(i=>1400-i),'fx'),
    series('us10y',history(i=>6-i*0.01),'rates'),
    series('usreal10y',history(i=>3-i*0.01),'rates'),
    series('vix',history(i=>40-i*0.1),'risk'),
  ];
  const review=validateHistoricalImpact({quotes});
  assert.equal(review.kospi.status,'exploratory');
  assert.equal(review.kosdaq.status,'exploratory');
  assert.ok(review.kospi.classifiedDays>=20);
  assert.equal(review.kospi.agreementRate,100);
  assert.equal(review.kosdaq.agreementRate,100);
  assert.equal(review.kospi.baselineUpRate,100);
  assert.equal(review.method,'retrospective_prior_date_check_v1');
});

test('same-day-only foreign observation is never counted as a pre-open signal',()=>{
  const quotes=[
    series('kospi', [{date:'2026-11-19',value:100},{date:'2026-11-20',value:110}],'korea'),
    series('sox', [{date:'2026-11-20',value:100}]),
    series('nasdaq', [{date:'2026-11-20',value:100}]),
    series('sp500', [{date:'2026-11-20',value:100}]),
  ];
  const review=validateHistoricalImpact({quotes});
  assert.equal(review.kospi.classifiedDays,0);
  assert.equal(review.kospi.agreementRate,null);
});

test('invalid dates and zero denominators cannot invent historical observations',()=>{
  const quotes=[
    series('kospi', [{date:'2026-13-99',value:100},{date:'2026-11-20',value:200},{date:'2026-11-21',value:210}],'korea'),
    series('sox', [{date:'2026-11-18',value:0},{date:'2026-11-19',value:120}]),
  ];
  assert.doesNotThrow(()=>validateHistoricalImpact({quotes}));
  assert.equal(validateHistoricalImpact({quotes}).kospi.classifiedDays,0);
});
