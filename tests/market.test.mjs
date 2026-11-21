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
      const rows = overrides[series] || [[day(1), '100'], [day(), '101']];
      return new Response(`observation_date,${series}\n${rows.map(row => row.join(',')).join('\n')}\n`);
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
  installFetch(t, async input => {
    const host = new URL(input).hostname;
    if (host === 'fred.stlouisfed.org') return fixture(input);
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
