import { writeFile } from 'node:fs/promises';
import { collectMarket } from '../src/market.js';

if (['dev', 'types'].includes(process.env.WRANGLER_COMMAND)) process.exit(0);

const file = new URL('../src/market-deploy-snapshot.js', import.meta.url);
const market = await collectMarket({});
const quotes = market.quotes.filter(quote => quote.value !== null && quote.status !== 'stale');
await writeFile(file, `// Generated at build time from public providers.\nexport default ${JSON.stringify(quotes)};\n`);
console.log(`Market backup: ${quotes.length} public observations collected.`);
