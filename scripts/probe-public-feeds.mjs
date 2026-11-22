// Checks public, keyless endpoints from a GitHub runner, NOT from Cloudflare.
// No credentials, price histories, member data, or request URLs are logged.
// A green CI test alone does not certify market-data connectivity.
import { collectMarket } from '../src/market.js';

const KEYLESS = new Set([
  'sp500','nasdaq','sox','nasdaqcom','us2y','us10y','usreal10y',
  'broadusd','wti','brent','vix','hyspread',
  'usdkrw','usdjpy','usdcny','btc','eth','sol',
]);
try {
  const result = await collectMarket({});
  const quotes = result.quotes.filter(q => KEYLESS.has(q.id));
  const byStatus = {};
  for (const q of quotes) {
    const status = q.status === 'daily' || q.status === 'live' || q.status === 'delayed'
      ? 'received' : q.status === 'stale' ? 'stale' : 'missing';
    byStatus[status] = [...(byStatus[status] || []), q.id];
  }
  console.log('PUBLIC_FEED_PROBE (GitHub runner, unauthenticated, diagnostic only)');
  console.log(JSON.stringify({
    tested: quotes.length, categories: byStatus,
    sources: result.sources.filter(s => ['fred','treasury','frankfurter','bitstamp','coinbase'].includes(s.id))
      .map(s => ({id:s.id,status:s.status,received:s.received,expected:s.expected,
        failures:s.failures.map(f => ({code:f.code,count:f.count}))})),
  }, null, 2));
} catch (error) {
  console.error('PUBLIC_FEED_PROBE_NOT_VERIFIED:', error?.name || 'Error');
  process.exitCode = 1;
}
