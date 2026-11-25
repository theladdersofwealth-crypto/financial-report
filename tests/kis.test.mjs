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
  t.mock.timers.enable({apis:['Date'], now:new Date('2026-11-25T07:00:00Z')});
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
      const period=url.searchParams.get('FID_PERIOD_DIV_CODE');
      assert.ok(['D','W','M'].includes(period));
      const candle=(date,open,close)=>({
        stck_bsop_date:date,bstp_nmix_oprc:String(open),
        bstp_nmix_hgpr:String(Math.max(open,close)+12),
        bstp_nmix_lwpr:String(Math.min(open,close)-12),
        bstp_nmix_prpr:String(close),
      });
      return Response.json({rt_cd:'0',output2:[
        candle(iso(period==='M'?30:period==='W'?10:3),base-15,base),
        candle(iso(1),base+9,base+30),
        {stck_bsop_date:iso(1),bstp_nmix_prpr:''},
      ]});
    }
    if(url.pathname.endsWith('inquire-time-indexchartprice')) {
      assert.equal(opts.headers.tr_id,'FHKUP03500200');
      return Response.json({rt_cd:'0',output2:[{stck_bsop_date:iso(0),stck_cntg_hour:'090100',bstp_nmix_oprc:'3000',bstp_nmix_hgpr:'3003',bstp_nmix_lwpr:'2998',bstp_nmix_prpr:'3001'}]});
    }
    if(url.pathname.endsWith('inquire-index-price')) {
      assert.equal(opts.headers.tr_id,'FHPUP02100000');
      return Response.json({rt_cd:'0',output:{bstp_nmix_prpr:'',bstp_nmix_prdy_ctrt:''}});
    }
    assert.equal(opts.headers.tr_id,'FHPTJ04040000');
    assert.equal(url.searchParams.get('FID_INPUT_DATE_1'),url.searchParams.get('FID_INPUT_DATE_2'),'KIS daily investor inquiry requires a single same-day date');
    const kospi=url.searchParams.get('FID_INPUT_ISCD_1')==='KSP';
    return Response.json({rt_cd:'0',output:[
      {stck_bsop_date:iso(3),frgn_ntby_tr_pbmn:kospi?'-5000':'2000',fund_ntby_tr_pbmn:kospi?'1500':'-500'},
      {stck_bsop_date:iso(1),frgn_ntby_tr_pbmn:kospi?'7000':'-1000',fund_ntby_tr_pbmn:kospi?'-2300':'0'},
    ]});
  });
  const {collectKis}=await fresh();
  const env={KIS_APP_KEY:'mock-app-key',KIS_APP_SECRET:'mock-app-secret'};
  const quotes=await collectKis(env);
  assert.equal(quotes.length,6);
  const byId=Object.fromEntries(quotes.map(q=>[q.id,q]));
  assert.equal(byId.kospi.value,3030);
  assert.equal(byId.kospi.minuteCandles.length,1);
  assert.equal(byId.kospi.minuteCandles[0].close,3001);
  assert.equal(byId.kosdaq.value,930);
  assert.equal(byId.kospi.change,1);
  assert.equal(byId.kr_foreign_kospi.value,70);
  assert.equal(byId.kr_foreign_kospi.change,120);
  assert.equal(byId.kr_foreign_kosdaq.value,-10);
  assert.equal(byId.kr_foreign_kosdaq.change,-30);
  assert.equal(byId.kr_foreign_kosdaq.unit,'억원');
  assert.equal(byId.kr_foreign_kosdaq.source,'한국투자증권 KIS Open API');
  assert.equal(byId.kr_pension_kospi.value,-23);
  assert.equal(byId.kr_pension_kosdaq.value,0);
  assert.equal(byId.kospi.status,'daily');
  assert.equal(calls.filter(c=>c.path==='/oauth2/tokenP').length,1);
  assert.equal(calls.filter(c=>c.method==='GET').length,10);
  for (const id of ['kospi','kosdaq']) {
    const periods=byId[id].chartPeriods;
    assert.deepEqual(Object.keys(periods),['D','W','M']);
    for (const tf of ['D','W','M']) {
      assert.equal(periods[tf].length,2);
      assert.equal(periods[tf][1].close,byId[id].value);
      assert.ok(periods[tf][1].high >= periods[tf][1].close);
      assert.ok(periods[tf][1].low <= periods[tf][1].open);
    }
  }
  await collectKis(env);
  assert.equal(calls.filter(c=>c.path==='/oauth2/tokenP').length,1,'token must be reused');
  assert.equal(JSON.stringify(quotes).includes('mock-app-secret'),false);
  assert.equal(JSON.stringify(quotes).includes('mock-bearer'),false);
});

test('intraday KIS polls both markets, retains signed foreign and pension flow, and labels retrieval time', async t => {
  t.mock.timers.enable({apis:['Date'], now:new Date('2026-11-25T02:00:00Z')});
  const calls = [];
  withFetch(t, async (input, init) => {
    const url = new URL(input);
    calls.push(init.headers.tr_id);
    if (url.pathname.endsWith('/tokenP')) return Response.json({access_token:'test-intraday',expires_in:86400});
    if (init.headers.tr_id === 'FHPUP02100000') {
      return Response.json({rt_cd:'0', output:{bstp_nmix_prpr:'5000', bstp_nmix_prdy_ctrt:'-1.1'}});
    }
    assert.equal(init.headers.tr_id, 'FHPTJ04030000');
    assert.equal(url.searchParams.get('FID_INPUT_ISCD'), '999');
    const group = url.searchParams.get('FID_INPUT_ISCD_2');
    assert.ok(['S001','S101'].includes(group));
    return Response.json({rt_cd:'0', output:[{frgn_ntby_tr_pbmn:group==='S001'?'-150000':'12000',fund_ntby_tr_pbmn:'0'}]});
  });
  const {collectKisIntraday} = await fresh();
  const env = {KIS_APP_KEY:'intraday-key',KIS_APP_SECRET:'intraday-secret'};
  const quotes = await collectKisIntraday(env);
  assert.equal(quotes.length,6);
  assert.equal(quotes.find(q=>q.id==='kr_foreign_kospi').value,-1500);
  assert.equal(quotes.find(q=>q.id==='kr_foreign_kosdaq').value,120);
  assert.equal(quotes.find(q=>q.id==='kr_pension_kospi').value,0);
  assert.ok(quotes.every(q=>q.timestampPrecision==='retrieval' && q.marketPhase==='intraday'));
  t.mock.timers.setTime(Date.parse('2026-11-25T06:30:00Z'));
  assert.deepEqual(await collectKisIntraday(env), []);
  assert.equal(calls.length,5);
});

test('intraday net flow difference uses matching prior-session final amounts and reuses the baseline', async t => {
  t.mock.timers.enable({apis:['Date'], now:new Date('2026-11-25T02:00:00Z')});
  let dailyCalls=0;
  withFetch(t, async (input, init) => {
    const url=new URL(input);
    if (url.pathname.endsWith('/tokenP')) return Response.json({access_token:'test-comparison',expires_in:86400});
    if (init.headers.tr_id==='FHPUP02100000') return Response.json({rt_cd:'0',output:{bstp_nmix_prpr:'5000',bstp_nmix_prdy_ctrt:'1'}});
    if (init.headers.tr_id==='FHPTJ04030000') return Response.json({rt_cd:'0',output:[{frgn_ntby_tr_pbmn:'-15000',fund_ntby_tr_pbmn:'0'}]});
    assert.equal(init.headers.tr_id,'FHPTJ04040000');
    assert.equal(url.searchParams.get('FID_INPUT_DATE_1'),'20261124');
    assert.equal(url.searchParams.get('FID_INPUT_DATE_2'),'20261124');
    dailyCalls++;
    return Response.json({rt_cd:'0',output:[
      {stck_bsop_date:'20261125',frgn_ntby_tr_pbmn:'-18000',fund_ntby_tr_pbmn:'20000'},
      {stck_bsop_date:'20261124',frgn_ntby_tr_pbmn:'20000',fund_ntby_tr_pbmn:'-4000'},
    ]});
  });
  const {collectKisIntraday}=await fresh();
  const cache=new Map(),env={KIS_APP_KEY:'comparison-key',KIS_APP_SECRET:'comparison-secret'};
  const rows=await collectKisIntraday(env,undefined,cache);
  for (const quote of rows.filter(row=>row.unit==='억원')) {
    assert.equal(quote.comparisonAt,'2026-11-24');
    assert.equal(quote.change,quote.id.includes('_foreign_') ? -350 : 40);
  }
  await collectKisIntraday(env,undefined,cache);
  assert.equal(dailyCalls,2);
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

test('CME futures roll on the regular expiry-week opening and serve validated contract candles', async t => {
  const {futuresContract, collectKisFutures, loadKisFuturesChart} = await fresh();
  const now = Date.parse('2026-11-23T08:00:00Z');
  const env = {KIS_APP_KEY:'fixture-futures', KIS_APP_SECRET:'fixture-secret'};
  assert.equal(futuresContract('ES', now), 'ESZ26');
  assert.equal(futuresContract('ES', Date.parse('2026-12-13T22:59:59Z')), 'ESZ26');
  assert.equal(futuresContract('ES', Date.parse('2026-12-13T23:00:00Z')), 'ESH27');
  const requests=[];
  withFetch(t, async (input, options) => {
    const url = new URL(input);
    if (url.pathname === '/oauth2/tokenP') return Response.json({access_token:'test-token'});
    requests.push([url.pathname.split('/').at(-1), options.headers.tr_id, Object.fromEntries(url.searchParams)]);
    if (url.pathname.endsWith('inquire-price')) {
      const code=url.searchParams.get('SRS_CD');
      return Response.json({rt_cd:'0',output1:{srs_cd:code==='SOXZ26'?'SOXH27':code, crc_cd:'USD',exch_cd:'CME',proc_date:'20261123',proc_time:'074200',last_price:'7005.25',prev_price:'7000'}});
    }
    const intraday=url.pathname.endsWith('inquire-time-futurechartprice');
    const rows = [
      {data_date:'20261123',data_time:'075000',open_price:'7001',high_price:'7010',low_price:'7000',last_price:'7009'},
      {data_date:intraday?'20261123':'20261120',data_time:'074500',open_price:'6999',high_price:'7005',low_price:'6998',last_price:'7001'},
      {data_date:'20261123',data_time:'075500',open_price:'0',high_price:'10000',low_price:'6998',last_price:'7001'},
    ];
    return Response.json({rt_cd:'0',output1:rows,output2:{index_key:'irrelevant'}});
  });
  const quotes = await collectKisFutures(env,now);
  assert.equal(quotes.length,4,'exclude a response labelled as a different futures contract');
  assert.equal(quotes.find(q=>q.id==='fut_es').contract,'ESZ26');
  assert.deepEqual(await collectKisFutures(env,now+1000),quotes);
  const minute = await loadKisFuturesChart(env,'fut_es','5min',now);
  assert.equal(minute.status,'ready');
  assert.equal(minute.bars.length,2);
  assert.equal(minute.bars.at(-1).close,7009);
  assert.equal(requests.at(-1)[2].QRY_GAP,'5');
  const daily = await loadKisFuturesChart(env,'fut_es','D',now);
  assert.equal(daily.bars[0].date,'2026-11-20');
  const monthly = await loadKisFuturesChart(env,'fut_es','M',now);
  assert.deepEqual(monthly.bars,[{date:'2026-11-20',open:6999,high:7010,low:6998,close:7009,value:7009}]);
  assert.equal((await loadKisFuturesChart(env,'es','5min',now)).status,'invalid');
});

test('futures use a valid untimed quote or the same contract’s observed candle closes', async t => {
  const {collectKisFutures} = await fresh();
  const now = Date.parse('2026-11-23T09:00:00Z');
  const env = {KIS_APP_KEY:'futures-fallback', KIS_APP_SECRET:'fixture-not-for-logs'};
  let sAndPCalls = 0;
  withFetch(t, async input => {
    const u = new URL(input);
    if (u.pathname === '/oauth2/tokenP') return Response.json({access_token:'fixture-token'});
    const contract = u.searchParams.get('SRS_CD');
    if (u.pathname.endsWith('inquire-price')) {
      if (contract==='ESZ26') {
        sAndPCalls++;
        if (sAndPCalls === 1) return Response.json({rt_cd:'1',msg_cd:'EGW00552'}, {status:500});
        return Response.json({rt_cd:'0',output:{srs_cd:contract,last_price:'7000.25'}});
      }
      return Response.json({rt_cd:'1',msg_cd:'OPSP1234',msg1:'fixture-not-for-logs'}, {status:403});
    }
    if (u.pathname.endsWith('inquire-time-futurechartprice') && contract==='NQZ26') {
      return Response.json({rt_cd:'0',output2:[{data_date:'2026-11-23',data_time:'08:55:00',open_price:'24000',high_price:'24400',low_price:'23900',last_price:'24310'}]});
    }
    if (u.pathname.endsWith('daily-ccnl') && contract==='YMZ26') {
      assert.equal(u.searchParams.get('EXCH_CD'),'CME');
      return Response.json({rt_cd:'0',output1:[{data_date:'20261121',open_price:'40000',high_price:'40400',low_price:'39900',last_price:'40310'}]});
    }
    return Response.json({rt_cd:'1',msg_cd:'OPSP1234'}, {status:403});
  });
  const diagnostics=[];
  const quotes=await collectKisFutures(env,now,event=>diagnostics.push(event));
  const byId=Object.fromEntries(quotes.map(quote=>[quote.id,quote]));
  assert.equal(byId.fut_es.value,7000.25);
  assert.equal(sAndPCalls,2);
  assert.equal(byId.fut_es.observedAt,null);
  assert.equal(byId.fut_es.timestampPrecision,'retrieval');
  assert.equal(byId.fut_nq.value,24310);
  assert.equal(byId.fut_nq.fallbackPeriod,'5min');
  assert.equal(byId.fut_nq.change,null);
  assert.equal(byId.fut_ym.fallbackPeriod,'D');
  assert.equal(byId.fut_ym.status,'daily');
  assert.equal(byId.fut_ym.exchange,'CBOT');
  assert.equal(byId.fut_rty,undefined);
  assert.ok(diagnostics.some(event=>event.stage==='quote' && event.http===403 && event.code==='OPSP1234'));
  assert.ok(diagnostics.some(event=>event.contract==='ESZ26' && event.http===500 && event.code==='EGW00552'));
  assert.doesNotMatch(JSON.stringify(diagnostics),/fixture/);
});
