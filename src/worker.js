import { DeskRoom } from './room.js';
import { getMarket, refreshMarket } from './market.js';
import { getCalendar } from './calendar.js';
import { enrichAnalysis } from './analysis.js';
import { searchInstrument } from './instrument-search.js';
import { loadLiveFuturesChart } from './live-futures.js';
import { koreaBriefingQuotes } from './briefing.js';

export { DeskRoom };

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'"
};

function protect(response, isApi) {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  if (isApi) headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const FUTURES_CHECK_CRON = '*/5 * * * *';

async function getKoreaBriefing(env, market) {
  if (!env.US_BRIEFING) return null;
  try {
    return await env.US_BRIEFING.getByName('us-markets').current(koreaBriefingQuotes(market.quotes));
  } catch (error) {
    console.warn('Korea market briefing unavailable', error?.name || 'Error');
    return null;
  }
}

async function refreshBriefingIfDue(env) {
  if (!env.US_BRIEFING) return null;
  try {
    const briefing = env.US_BRIEFING.getByName('us-markets');
    if (!await briefing.needsRefresh()) return;
    const market = await getMarket(env);
    await briefing.current(koreaBriefingQuotes(market.quotes));
  } catch (error) {
    console.warn('Korea market briefing refresh failed', error?.name || 'Error');
  }
}

async function futuresSnapshot(env, scope = 'indices', reportSuccess = false) {
  if (!env.US_BRIEFING) return {quotes:[], reason:'configuration'};
  const groups = scope === 'extended' ? ['assets','equities'] : ['indices'];
  const snapshots = await Promise.all(groups.map(async group => {
    try {
      const name = group === 'indices' ? 'us-markets' : `futures-${group}`;
      return await env.US_BRIEFING.getByName(name).latestFutures(group);
    } catch (error) {
      return {quotes:[],issues:[{group,reason:error?.name || 'internal'}]};
    }
  }));
  const quotes = snapshots.flatMap(snapshot => snapshot.quotes);
  const issues = snapshots.flatMap(snapshot => snapshot.issues);
  if (reportSuccess) {
    const now = Date.now();
    console.info('Live futures snapshot', {scope,received:quotes.length, contracts:quotes.map(quote => ({
      venue:quote.venue, symbol:quote.contract, ageMs:now-Date.parse(quote.observedAt),
    })), issues});
  }
  return {quotes, reason:quotes.length ? null : 'network'};
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isApi = url.pathname.startsWith('/api/');
    try {
      if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
        url.protocol = 'https:';
        return Response.redirect(url.toString(), 308);
      }
      if (isApi) {
        if (!env.DESK) return protect(Response.json({ error: '서버 저장소가 아직 연결되지 않았습니다.' }, { status: 503 }), true);
        const room = env.DESK.get(env.DESK.idFromName('global-market-desk'));
        if (url.pathname === '/api/market' || url.pathname === '/api/calendar' || url.pathname === '/api/instrument' || url.pathname === '/api/futures') {
          const authUrl = new URL(request.url);
          authUrl.pathname = '/api/me';
          const authResponse = await room.fetch(new Request(authUrl, { headers: request.headers }));
          if (!authResponse.ok) return protect(authResponse, true);
          const { user } = await authResponse.json();
          if (user.mustChangePassword) return protect(Response.json({ error: '임시 비밀번호를 먼저 변경해 주세요.' }, { status: 403 }), true);
          if (request.method !== 'GET') return protect(Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 405 }), true);
          if (url.pathname === '/api/futures') {
            const id = url.searchParams.get('id');
            const period = url.searchParams.get('period');
            const venue = url.searchParams.get('venue');
            const scope = url.searchParams.get('scope') || 'indices';
            if (!['indices','extended'].includes(scope)) return protect(Response.json({status:'invalid'}, {status:400}), true);
            const result = id !== null || period !== null || venue !== null
              ? await loadLiveFuturesChart(env, id, period, venue)
              : await futuresSnapshot(env, scope);
            return protect(Response.json(result, {status: result.status === 'invalid' ? 400 : 200}), true);
          }
          if (url.pathname === '/api/calendar') return protect(Response.json(await getCalendar()), true);
          if (url.pathname === '/api/instrument') {
            const market=url.searchParams.get('market')||'';
            const symbol=url.searchParams.get('symbol')||'';
            const exchange=url.searchParams.get('exchange')||'';
            const result=await searchInstrument(env,market,symbol,exchange);
            return protect(Response.json(result,{status:result.status==='invalid'?400:200}),true);
          }
          const market = await getMarket(env);
          const [analysis, briefing] = await Promise.all([enrichAnalysis(market, env), getKoreaBriefing(env, market)]);
          return protect(Response.json({...analysis, briefing}), true);
        }
        return protect(await room.fetch(request), true);
      }
      if (!env.ASSETS) return protect(new Response('Static assets are not configured.', { status: 503 }), false);
      let response = await env.ASSETS.fetch(request);
      if (response.status === 404 && request.method === 'GET' && !url.pathname.split('/').pop().includes('.')) {
        const indexUrl = new URL(request.url);
        indexUrl.pathname = '/index.html';
        response = await env.ASSETS.fetch(new Request(indexUrl, request));
      }
      return protect(response, false);
    } catch (error) {
      console.error('Request failed', error?.name || 'Error');
      return protect(Response.json({ error: '요청 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 }), isApi);
    }
  },
  async scheduled(controller, env, ctx) {
    const time = new Date(controller.scheduledTime);
    const refreshMarketNow = time.getUTCMinutes() === 0 && [7, 23].includes(time.getUTCHours());
    if (refreshMarketNow) {
      ctx.waitUntil(refreshMarket(env).then(market =>
        Promise.all([enrichAnalysis(market, env), getKoreaBriefing(env, market)])));
    } else if (controller.cron === FUTURES_CHECK_CRON) {
      ctx.waitUntil(Promise.all([
        refreshBriefingIfDue(env),
        futuresSnapshot(env,'indices',true),
        futuresSnapshot(env,'extended',true),
      ]));
    }
  }
};
