import { DeskRoom } from './room.js';
import { getMarket, refreshMarket } from './market.js';
import { getCalendar } from './calendar.js';
import { enrichAnalysis } from './analysis.js';
import { searchInstrument } from './instrument-search.js';
import { collectKisFutures, loadKisFuturesChart } from './kis.js';
import {usFutures} from '../public/futures-config.js';

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

async function futuresSnapshot(env, reportSuccess = false) {
  const events = [];
  const quotes = await collectKisFutures(env, Date.now(), event => events.push(event));
  const details = [...new Map(events.filter(event => event.reason || event.code && !['MCA00000', 'EGW00000'].includes(event.code))
    .map(event => [JSON.stringify(event), event])).values()];
  const reason = events.some(event => event.reason === 'missing_configuration') ? 'configuration'
    : events.some(event => event.reason === 'no_token') ? 'token'
    : details.some(event => event.http === 401 || event.http === 403) ? 'permission'
    : details.some(event => event.http === 429 || event.code === 'EGW00201') ? 'rate_limit'
    : details.some(event => event.http >= 500 || ['network','timeout'].includes(event.reason)) ? 'network'
    : 'no_quote';
  if (reportSuccess || quotes.length < usFutures.length || details.length) {
    const sources = quotes.reduce((counts, quote) => {
      const source = quote.status === 'stale' ? 'saved' : quote.fallbackPeriod || 'quote';
      counts[source] = (counts[source] || 0) + 1;
      return counts;
    }, {});
    console.info('Futures upstream status', {received: quotes.length, contracts: quotes.map(quote => quote.contract), sources, details});
  }
  return {quotes, reason: quotes.length < usFutures.length ? reason : null};
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
            const result = id !== null || period !== null ? await loadKisFuturesChart(env, id, period) : await futuresSnapshot(env);
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
          return protect(Response.json(await enrichAnalysis(await getMarket(env), env)), true);
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
    if (controller.cron === FUTURES_CHECK_CRON && !refreshMarketNow) {
      ctx.waitUntil(futuresSnapshot(env, true));
      return;
    }
    const refresh = refreshMarket(env).then(market => enrichAnalysis(market, env));
    ctx.waitUntil(refresh);
  }
};
