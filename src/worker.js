import { DeskRoom } from './room.js';
import { getMarket, refreshMarket } from './market.js';
import { getCalendar } from './calendar.js';
import { enrichAnalysis } from './analysis.js';
import { searchInstrument } from './instrument-search.js';
import { collectKisFutures, loadKisFuturesChart } from './kis.js';

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
            const result = id !== null || period !== null ? await loadKisFuturesChart(env, id, period) : {quotes: await collectKisFutures(env)};
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
  async scheduled(_controller, env, ctx) {
    const refresh = refreshMarket(env).then(market => enrichAnalysis(market, env));
    ctx.waitUntil(refresh);
  }
};
