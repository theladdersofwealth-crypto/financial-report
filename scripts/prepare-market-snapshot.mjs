import { writeFile } from 'node:fs/promises';
import { collectMarket } from '../src/market.js';
import { collectCalendar } from '../src/calendar.js';

if (['dev', 'types'].includes(process.env.WRANGLER_COMMAND)) process.exit(0);

const file = new URL('../src/market-deploy-snapshot.js', import.meta.url);
const [market, calendar] = await Promise.all([collectMarket({}), collectCalendar()]);
const quotes = market.quotes.filter(quote => quote.value !== null && quote.status !== 'stale');
await writeFile(file, `// Generated at build time from public providers.\nexport default ${JSON.stringify(quotes)};\n`);
console.log(`Market backup: ${quotes.length} public observations collected.`);
const calendarFile = new URL('../src/calendar-deploy-snapshot.js', import.meta.url);
await writeFile(calendarFile, `// Generated at build time from official public calendars.\nexport default ${JSON.stringify(calendar.sections)};\n`);
console.log(`Calendar backup: ${calendar.sections.length} official source-months verified.`);
