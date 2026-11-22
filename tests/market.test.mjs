import test from 'node:test';
import assert from 'node:assert/strict';

let fixtureId = 0;
const day = (offset = 0) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
const freshModule = () => import(`../src/market.js?fixture=${++fixtureId}`);

function installFetch(t, implementation) {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  t.after(() => { globalThis.fetch = original; });
}

function providerFixture(overrides = {}) {
  return async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'fred.stlouisfed.org') {
      const series = url.searchParams.get('id');
      const firstOfMonth = (monthsAgo) => { const now = new Date(); return new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-monthsAgo,1)).toISOString().slice(0,10); };
      const rows = overrides[series] || (series === 'PNICKUSDM' ? [[firstOfMonth(2),'15000'],[firstOfMonth(1),'15400']] : [[day(1), '100'], [day(), '101']]);
      return new Response(`observation_date,${series}\n${rows.map(row => row.join(',')).join('\n')}\n`);
    }
    if (url.hostname === 'api.gold-api.com') {
      const symbol = url.pathname.split('/').at(-1);
      return Response.json({symbol,currency:'USD',price:({XAU:3500,XAG:40,HG:5.5})[symbol] ?? null,updatedAt:new Date().toISOString()});
    }
    if (url.hostname === 'api.frankfurter.dev') {
      return Response.json(['KRW', 'JPY', 'CNY'].flatMap(quote => [
        { date: day(1), base: 'USD', quote, rate: 100 },
        { date: day(), base: 'USD', quote, rate: 101 },
      ]));
    }
    if (url.hostname === 'www.bitstamp.net') {
      return Response.json({ last: '100', percent_change_24: '-1.25', timestamp: String(Math.floor(Date.now() / 1000)) });
    }
    throw new Error(`Unexpected provider: ${url.hostname}`);
  };
}

test('daily prices use percentage returns, yields use bp, and blank observations never become zero', async t => {
  installFetch(t, providerFixture({
    SP500: [[day(4), '100'], [day(3), '102'], [day(2), ''], [day(1), '.'], [day(), ' . ']],
    DGS10: [[day(1), '4.50'], [day(), '4.47']],
  }));
  const { getMarket } = await freshModule();
  const data = await getMarket();
  const sp500 = data.quotes.find(quote => quote.id === 'sp500');
  const us10y = data.quotes.find(quote => quote.id === 'us10y');
  assert.equal(sp500.value, 102);
  assert.equal(sp500.observedAt, day(3), 'retain the actual last valid observation date');
  assert.equal(sp500.change, 2);
  assert.equal(sp500.changeUnit, '%');
  assert.deepEqual(sp500.history.map(row => row.value), [100, 102]);
  assert.equal(us10y.value, 4.47);
  assert.equal(us10y.change, -3);
  assert.equal(us10y.changeUnit, 'bp');
  assert.equal(us10y.unit, '%');
});

test('the Fed broad dollar index never fills the distinct missing ICE DXY instrument', async t => {
  installFetch(t, providerFixture({ DTWEXBGS: [[day(1), '120'], [day(), '121']] }));
  const { getMarket } = await freshModule();
  const data = await getMarket();
  const dxy = data.quotes.find(quote => quote.id === 'dxy');
  const broad = data.quotes.find(quote => quote.id === 'broadusd');
  assert.equal(dxy.value, null);
  assert.equal(dxy.status, 'missing');
  assert.match(dxy.reason, /ICE DXY/);
  assert.equal(broad.value, 121);
  assert.equal(broad.status, 'daily');
  assert.match(broad.sourceUrl, /DTWEXBGS$/);
  assert.match(broad.basis, /ICE DXY와 다른/);
  assert.ok(data.quotes.filter(quote => quote.value !== null).every(quote => quote.source && quote.sourceUrl && quote.observedAt));
  assert.deepEqual(data.events, [], 'no fabricated economic calendar or news');
});

test('backup restores missing quotes only while their observations are recent', async t => {
  const fixture = providerFixture();
  const warning = t.mock.method(console, 'warn', () => {});
  installFetch(t, async input => {
    const host = new URL(input).hostname;
    if (host === 'fred.stlouisfed.org') return fixture(input);
    if (host === 'api.frankfurter.dev') throw new Error('DNS resolution failed (sensitive-url)');
    if (host === 'www.bitstamp.net') return new Response(null, {status: 302, headers: {Location: 'https://example.invalid/sensitive-url'}});
    throw new Error('Provider unavailable');
  });
  const { collectMarket } = await freshModule();
  const saved = [
    { id: 'sp500', value: 1, provider: 'fred', observedAt: day(1), retrievedAt: new Date().toISOString(), timestampPrecision: 'day' },
    { id: 'usdkrw', name: '달러/원', unit: '원/USD', value: 1300, change: null, source: 'ECB / Frankfurter', provider: 'frankfurter', observedAt: day(1), retrievedAt: new Date().toISOString(), timestampPrecision: 'day' },
    { id: 'btc', value: 60000, provider: 'coinbase', observedAt: day(3), retrievedAt: new Date().toISOString(), timestampPrecision: 'retrieval' },
  ];
  const data = await collectMarket({}, saved);
  const quotes = Object.fromEntries(data.quotes.map(quote => [quote.id, quote]));
  assert.equal(quotes.sp500.value, 101);
  assert.equal(quotes.usdkrw.value, 1300);
  assert.equal(quotes.usdkrw.observedAt, day(1));
  assert.equal(quotes.usdkrw.status, 'stale');
  assert.equal(quotes.btc.value, null);
  assert.equal(data.sources.find(source => source.id === 'frankfurter').status, 'backup');
  assert.match(data.summary.points[0], /1개 지표/);
  assert.match(data.summary.points[1], /api\.frankfurter\.dev DNS 오류/);
  assert.match(data.summary.points[1], /www\.bitstamp\.net HTTP 302/);
  assert.equal(warning.mock.callCount(), 1);
  assert.doesNotMatch(JSON.stringify(warning.mock.calls[0].arguments), /sensitive-url/);
  assert.doesNotMatch(JSON.stringify(data.summary), /sensitive-url/);
});

test('provider failures produce explicit missing values without sample prices or leaked credentials', async t => {
  const warning = t.mock.method(console, 'warn', () => {});
  installFetch(t, async (input) => {
    if (new URL(input).hostname === 'api.stlouisfed.org') {
      return new Response('Do not log upstream body', { status: 429 });
    }
    throw new Error('Do not log upstream error fixture-finnhub-secret');
  });
  const { getMarket } = await freshModule();
  const data = await getMarket({ FRED_API_KEY: 'fixture-fred-secret', FINNHUB_API_KEY: 'fixture-finnhub-secret' });
  assert.equal(data.mode, 'unconfigured');
  for (const quote of [...data.quotes, ...data.sectors, ...data.leaders]) {
    assert.equal(quote.value, null);
    assert.equal(quote.change, null);
    assert.equal(quote.observedAt, null);
    assert.equal(quote.status, 'missing');
    assert.ok(quote.reason);
  }
  assert.ok(data.outlooks.every(outlook => outlook.confidence === '판단 보류'));
  assert.doesNotMatch(JSON.stringify(data), /fixture-(fred|finnhub)-secret/);
  assert.equal(warning.mock.callCount(), 1);
  const [, failures] = warning.mock.calls[0].arguments;
  assert.ok(failures['api.stlouisfed.org HTTP_429'] > 0);
  assert.ok(failures['finnhub.io fetch_error'] > 0);
  assert.doesNotMatch(JSON.stringify(failures), /secret|Do not log/);
  assert.match(data.summary.points.at(-1), /api\.stlouisfed\.org HTTP 429/);
  assert.match(data.summary.points.at(-1), /finnhub\.io 요청 실패/);
});

test('keyless provider requests and configured Finnhub calls share the connection budget', async t => {
  const fixture = providerFixture();
  let active = 0;
  let peak = 0;
  installFetch(t, async (input, options) => {
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setImmediate(resolve));
      if (new URL(input).hostname === 'finnhub.io') {
        assert.equal(options.headers['X-Finnhub-Token'], 'test-token');
        return Response.json({ c: 100, dp: 1, t: Math.floor(Date.now() / 1000) });
      }
      return fixture(input);
    } finally {
      active--;
    }
  });

  const { getMarket } = await freshModule();
  const data = await getMarket({ FINNHUB_API_KEY: 'test-token' });
  assert.equal(peak, 4);
  assert.ok(data.sectors.every(sector => sector.value === 100));
  for (const id of ['sp500', 'usdkrw', 'btc', 'eth']) {
    assert.ok(data.quotes.find(quote => quote.id === id)?.value > 0);
  }
});

test('concurrent readers share provider requests and cached responses cannot mutate one another', async t => {
  const requests = new Map();
  const fixture = providerFixture();
  installFetch(t, async (input, options) => {
    const url = String(input);
    requests.set(url, (requests.get(url) || 0) + 1);
    await Promise.resolve();
    return fixture(input, options);
  });
  const { getMarket } = await freshModule();
  const [first, second, third] = await Promise.all([getMarket(), getMarket(), getMarket()]);
  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
  assert.ok(requests.size >= 12);
  assert.ok([...requests.values()].every(count => count === 1), 'one request per provider URL across concurrent readers');
  const count = [...requests.values()].reduce((sum, value) => sum + value, 0);
  first.quotes[0].value = -999;
  const cached = await getMarket();
  assert.equal([...requests.values()].reduce((sum, value) => sum + value, 0), count);
  assert.equal(cached.quotes[0].value, second.quotes[0].value);
  assert.notEqual(cached.quotes[0].value, -999);
});

test('optional ECOS feeds return official Korean daily yields and basis-point changes', async t => {
  const base = providerFixture();
  let ecosCalls = 0;
  installFetch(t, async (input, options) => {
    const url = new URL(String(input));
    if (url.hostname !== 'ecos.bok.or.kr') return base(input, options);
    ecosCalls++;
    const item = url.pathname.split('/').at(-1);
    const prior = day(2).replace(/-/g, '');
    const current = day(1).replace(/-/g, '');
    return Response.json({StatisticSearch:{row:[
      {STAT_CODE:'817Y002',ITEM_CODE1:item,TIME:prior,DATA_VALUE:'3.10'},
      {STAT_CODE:'817Y002',ITEM_CODE1:item,TIME:current,DATA_VALUE:'3.20'},
      // A different item must never contaminate the target series.
      {STAT_CODE:'817Y002',ITEM_CODE1:'bad-item',TIME:current,DATA_VALUE:'9999'},
    ]}});
  });
  const { collectMarket } = await freshModule();
  const secret = 'fixtureECOS2026';
  const data = await collectMarket({ECOS_API_KEY:secret});
  const kr3y = data.quotes.find(q => q.id === 'kr3y');
  const kr10y = data.quotes.find(q => q.id === 'kr10y');
  assert.equal(ecosCalls, 5, 'two yields, two index series, one foreign-flow series');
  for (const quote of [kr3y, kr10y]) {
    assert.equal(quote.value, 3.20);
    assert.equal(quote.change, 10);
    assert.equal(quote.changeUnit, 'bp');
    assert.equal(quote.provider, 'ecos');
    assert.equal(quote.observedAt, day(1));
    assert.equal(quote.source, '한국은행 ECOS');
  }
  assert.equal(data.sources.find(source => source.id === 'ecos')?.status, 'partial');
  assert.equal(data.sources.find(source => source.id === 'ecos')?.received, 2);
  assert.equal(data.sources.find(source => source.id === 'ecos')?.missing, 3);
  assert.equal(JSON.stringify(data).includes(secret), false, 'credentials must not enter responses');
  assert.equal(data.impact.method, 'weighted_directional_checklist_v1');
});

test('without an ECOS key, Korean yields remain missing without fetching ECOS', async t => {
  const base = providerFixture();
  let count = 0;
  installFetch(t, (input, options) => {
    if (new URL(String(input)).hostname === 'ecos.bok.or.kr') count++;
    return base(input, options);
  });
  const { collectMarket } = await freshModule();
  const data = await collectMarket({});
  assert.equal(count, 0);
  assert.equal(data.quotes.find(q => q.id === 'kr3y').value, null);
  assert.equal(data.sources.find(source => source.id === 'ecos')?.status, 'unconfigured');
  for (const id of ['kospi', 'kosdaq', 'kr_foreign_kospi']) {
    assert.equal(data.quotes.find(q => q.id === id)?.value, null);
  }
});

test('ECOS daily stock indices and KOSPI foreign flow distinguish levels from absolute net flows', async t => {
  const fixture = providerFixture();
  const calls = [];
  installFetch(t, async (input, options) => {
    const url = new URL(String(input));
    if (url.hostname !== 'ecos.bok.or.kr') return fixture(input, options);
    const parts = url.pathname.split('/');
    const table = parts.at(-5), item = parts.at(-1);
    calls.push({table,item});
    const yesterday = day(1).replace(/-/g,'');
    const previous = day(2).replace(/-/g,'');
    const isFlow = item === '0030000';
    if (table !== '802Y001') return Response.json({StatisticSearch:{row:[]}});
    return Response.json({StatisticSearch:{row:[
      {STAT_CODE:table,ITEM_CODE1:item,TIME:previous,DATA_VALUE:isFlow ? '-2000' : '2000'},
      {STAT_CODE:table,ITEM_CODE1:item,TIME:yesterday,DATA_VALUE:isFlow ? '-800' : '2100'},
      {STAT_CODE:table,ITEM_CODE1:'UNRELATED',TIME:yesterday,DATA_VALUE:'999999'},
      {STAT_CODE:'WRONG',ITEM_CODE1:item,TIME:yesterday,DATA_VALUE:'999999'},
    ]}});
  });
  const {collectMarket} = await freshModule();
  const data = await collectMarket({ECOS_API_KEY:'testECOS98765'});
  assert.deepEqual(calls.filter(call=>call.table==='802Y001').map(call=>call.item).sort(),['0001000','0030000','0089000']);
  for(const id of ['kospi','kosdaq']) {
    const quote=data.quotes.find(q=>q.id===id);
    assert.equal(quote.value,2100);
    assert.equal(quote.change,5);
    assert.equal(quote.changeUnit,'%');
    assert.equal(quote.observedAt,day(1));
    assert.equal(quote.source,'한국은행 ECOS / 한국거래소');
  }
  const net=data.quotes.find(q=>q.id==='kr_foreign_kospi');
  assert.equal(net.value,-800,'negative is a net sell, not missing');
  assert.equal(net.unit,'억원');
  assert.equal(net.change,1200,'difference in 100 million KRW, not percentage return');
  assert.equal(net.changeUnit,'억원');
  assert.equal(data.impact.domestic.foreignKospi.value,-800);
  assert.equal(data.impact.domestic.kospi.value,2100);
  assert.equal(data.impact.domestic.kosdaq.value,2100);
  assert.ok(data.impact.cautions.some(c=>c.includes('시장별 일별 관측값')));
});


test('an invalid FRED key does not suppress otherwise usable public CSV series', async t => {
  const publicFeed = providerFixture();
  let authCalls=0,csvCalls=0;
  installFetch(t, async (input, options) => {
    const host = new URL(String(input)).hostname;
    if (host === 'api.stlouisfed.org') { authCalls++; return new Response('rejected', {status: 401}); }
    if (host === 'fred.stlouisfed.org') { csvCalls++; return publicFeed(input, options); }
    return publicFeed(input, options);
  });
  const {collectMarket}=await freshModule();
  const data=await collectMarket({FRED_API_KEY:'bad-fixture-key'});
  assert.equal(authCalls,13);
  assert.equal(csvCalls,13);
  assert.equal(data.quotes.find(q=>q.id==='sp500')?.value,101);
  assert.equal(data.sources.find(x=>x.id==='fred')?.received,13);
  assert.equal(data.sources.find(x=>x.id==='fred')?.status,'connected');
  assert.ok(data.sources.find(x=>x.id==='fred')?.failures.some(e=>e.code==='HTTP_401'));
  assert.equal(JSON.stringify(data).includes('bad-fixture-key'),false);
});

test('ECB partial coverage falls back to separately attributed central bank blends', async t => {
  const fixture = providerFixture();
  let mixedCalls=0,ecbCalls=0;
  installFetch(t, async (input, options) => {
    const url=new URL(String(input));
    if (url.hostname !== 'api.frankfurter.dev') return fixture(input,options);
    const rows=await (await fixture(input)).json();
    if (url.searchParams.get('providers') === 'ECB') {
      ecbCalls++;
      return Response.json(rows.filter(r=>r.quote==='JPY'));
    }
    mixedCalls++;
    return Response.json(rows);
  });
  const {collectMarket}=await freshModule();
  const data=await collectMarket({});
  assert.equal(ecbCalls,1);
  assert.equal(mixedCalls,1);
  assert.equal(data.quotes.find(q=>q.id==='usdjpy')?.source,'ECB / Frankfurter');
  assert.equal(data.quotes.find(q=>q.id==='usdkrw')?.source,'중앙은행 혼합 / Frankfurter');
  assert.equal(data.quotes.find(q=>q.id==='usdcny')?.value,101);
});

test('stale FRED observations are no longer reported as a healthy provider', async t => {
  const old=[[day(20),'100'],[day(18),'101']];
  const oldMonth = n => {const d = new Date();return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-n,1)).toISOString().slice(0,10);};
  installFetch(t, providerFixture(Object.fromEntries(
    ['SP500','NASDAQ100','NASDAQSOX','NASDAQCOM','DGS2','DGS10','DFII10','DTWEXBGS','DCOILWTICO','DCOILBRENTEU','VIXCLS','BAMLH0A0HYM2','PNICKUSDM']
      .map(x=>[x,x==='PNICKUSDM'?[[oldMonth(7),'100'],[oldMonth(6),'101']]:old]))));
  const {collectMarket}=await freshModule();
  const data=await collectMarket({});
  const fred=data.sources.find(x=>x.id==='fred');
  assert.equal(fred.status,'stale');
  assert.equal(fred.received,0);
  assert.equal(fred.stale,13);
  assert.equal(data.quotes.find(q=>q.id==='sp500')?.status,'stale');
  assert.ok(!data.summary.points.some(p=>String(p).includes('S&P 500 101')));
});

test('failed Finnhub quotes expose safe provider diagnostic counts, not secrets', async t=>{
  const fixture=providerFixture();
  installFetch(t, async(input,options)=>{
    if(new URL(String(input)).hostname==='finnhub.io')return new Response('no permission',{status:403});
    return fixture(input,options);
  });
  const {collectMarket}=await freshModule();
  const data=await collectMarket({FINNHUB_API_KEY:'test-private-token'});
  const finnhub=data.sources.find(x=>x.id==='finnhub');
  assert.equal(finnhub.status,'no_data');
  assert.equal(finnhub.received,0);
  assert.equal(finnhub.expected,18);
  assert.equal(finnhub.missing,18);
  assert.ok(finnhub.failures.some(x=>x.code==='HTTP_403'));
  assert.equal(JSON.stringify(data).includes('test-private-token'),false);
});


test('keyless metal spot quotes and monthly nickel are distinct, timestamped products', async t => {
  installFetch(t, providerFixture());
  const { collectMarket } = await freshModule();
  const market = await collectMarket({});
  for(const [id,price,unit,symbol] of [['gold',3500,'USD/oz','XAU'],['silver',40,'USD/oz','XAG'],['copper',5.5,'USD/lb','HG']]){
    const q = market.quotes.find(q => q.id === id);
    assert.equal(q.value,price);
    assert.equal(q.unit,unit);
    assert.equal(q.change,null,'spot endpoint does not provide prior-day change');
    assert.equal(q.provider,'goldapi');
    assert.equal(q.source,'Gold API');
    assert.equal(q.status,'delayed');
    assert.ok(Date.parse(q.observedAt)>Date.now()-60_000);
    assert.match(q.basis, /참고/);
  }
  const nickel=market.quotes.find(q=>q.id==='nickel');
  assert.equal(nickel.value,15400);
  assert.equal(nickel.status,'monthly');
  assert.equal(nickel.unit,'USD/t');
  assert.equal(nickel.timestampPrecision,'month');
  assert.equal(nickel.changeUnit,'%');
  assert.match(nickel.delay,/실시간 시세 아님/);
  assert.equal(market.sources.find(x=>x.id==='goldapi')?.status,'connected');
  assert.equal(market.sources.find(x=>x.id==='goldapi')?.received,3);
  assert.equal(market.sources.find(x=>x.id==='fred')?.monthly,1);
});

test('metal feed never invents quote changes, units or present-time freshness', async t => {
  const fixture=providerFixture();
  installFetch(t, async(input,options)=>{
    const url = new URL(String(input));
    if(url.hostname==='api.gold-api.com'){
      const symbol=url.pathname.split('/').at(-1);
      if(symbol==='XAU')return Response.json({symbol,currency:'EUR',price:6000,updatedAt:new Date().toISOString()});
      if(symbol==='XAG')return Response.json({symbol,currency:'USD',price:45,updatedAt:new Date(Date.now()-5*86400000).toISOString()});
      return Response.json({symbol,currency:'USD',price:null,updatedAt:new Date().toISOString()});
    }
    return fixture(input,options);
  });
  const {collectMarket}=await freshModule();
  const market=await collectMarket({});
  assert.equal(market.quotes.find(x=>x.id==='gold')?.value,null,'EUR must never be presented as USD');
  assert.equal(market.quotes.find(x=>x.id==='silver')?.status,'stale','five-day-old quote must be shown as stale');
  assert.equal(market.quotes.find(x=>x.id==='copper')?.value,null,'empty quote must not count');
  assert.equal(market.sources.find(x=>x.id==='goldapi')?.status,'stale');
  assert.equal(market.sources.find(x=>x.id==='goldapi')?.received,0);
  assert.equal(market.sources.find(x=>x.id==='goldapi')?.stale,1);
  assert.equal(market.sources.find(x=>x.id==='goldapi')?.missing,2);
});

test('old IMF nickel month is explicitly stale, not a current LME spot quote',async t=>{
  const m=(n)=>{const d=new Date();return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-n,1)).toISOString().slice(0,10);};
  installFetch(t,providerFixture({PNICKUSDM:[[m(12),'12000'],[m(10),'13000']]}));
  const {collectMarket}=await freshModule();
  const market=await collectMarket({});
  const q=market.quotes.find(q=>q.id==='nickel');
  assert.equal(q.status,'stale');
  assert.equal(q.timestampPrecision,'month');
  assert.notEqual(q.status,'live');
  assert.match(q.basis,/월간/);
});


test('verified KIS overseas candidates win over FRED and missing Finnhub; mismatched indices fall back',async t=>{
  const publicFixture=providerFixture();
  const original=globalThis.fetch;
  globalThis.fetch=async (input,options={})=>{
    const u=new URL(String(input));
    if(u.hostname!=='openapi.koreainvestment.com')return publicFixture(input,options);
    if(u.pathname==='/oauth2/tokenP')return Response.json({access_token:'fixture-overseas-token',expires_in:86000});
    if(u.pathname.endsWith('inquire-daily-indexchartprice')){
      const code=u.searchParams.get('FID_INPUT_ISCD');
      return Response.json({rt_cd:'0',output2:[
        {stck_bsop_date:day(3).replace(/-/g,''),bstp_nmix_prpr:code==='0001'?'3100':'700',
          bstp_nmix_oprc:'3000',bstp_nmix_hgpr:'3200',bstp_nmix_lwpr:'690'},
        {stck_bsop_date:day(1).replace(/-/g,''),bstp_nmix_prpr:code==='0001'?'3110':'720',
          bstp_nmix_oprc:'3000',bstp_nmix_hgpr:'3200',bstp_nmix_lwpr:'690'},
      ]});
    }
    if(u.pathname.endsWith('inquire-investor-daily-by-market')){
      return Response.json({rt_cd:'0',output:[{stck_bsop_date:day(1).replace(/-/g,''),frgn_ntby_tr_pbmn:'1100'}]});
    }
    if(u.pathname.endsWith('inquire-daily-chartprice')){
      const isWrong=u.searchParams.get('FID_INPUT_ISCD')==='.NDX';
      return Response.json({rt_cd:'0',output2:[
        {stck_bsop_date:day(3).replace(/-/g,''),ovrs_nmix_prpr:'100'},
        {stck_bsop_date:day(1).replace(/-/g,''),ovrs_nmix_prpr:isWrong?'9000':'101'},
      ]});
    }
    if(u.pathname==='/uapi/overseas-price/v1/quotations/price'){
      const symbol=u.searchParams.get('SYMB');
      const code=u.searchParams.get('EXCD');
      return Response.json({rt_cd:'0',output:{last:'75.25',rate:'2.4',rsym:code+symbol}});
    }
    throw Error('unexpected KIS route');
  };
  t.after(()=>{globalThis.fetch=original});
  const {collectMarket}=await freshModule();
  const market=await collectMarket({KIS_APP_KEY:'unique-us-market-test-key',KIS_APP_SECRET:'unique-us-market-test-secret'});
  const sp=market.quotes.find(q=>q.id==='sp500');
  assert.equal(sp.provider,'kis');
  assert.equal(sp.value,101);
  const ndx=market.quotes.find(q=>q.id==='nasdaq');
  assert.equal(ndx.provider,'fred','wrong or unverified KIS index must never override FRED');
  assert.equal(ndx.value,101);
  assert.equal(market.sectors.find(q=>q.symbol==='XLK')?.provider,'kis');
  assert.equal(market.sectors.length,11);
  assert.equal(market.leaders.length,7);
  assert.equal(market.leaders.find(q=>q.symbol==='NVDA')?.provider,'kis');
  assert.equal(market.sources.find(x=>x.id==='kis')?.status,'partial');
  assert.equal(JSON.stringify(market).includes('unique-us-market-test-secret'),false);
  assert.equal(JSON.stringify(market).includes('fixture-overseas-token'),false);
});
