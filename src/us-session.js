const eastern = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', hourCycle: 'h23',
});
const dateOnly = date => date.toISOString().slice(0, 10);

function observedHoliday(year, month, day, observeSaturday = true) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCDay() === 0) date.setUTCDate(day + 1);
  if (date.getUTCDay() === 6 && observeSaturday) date.setUTCDate(day - 1);
  return dateOnly(date);
}

// Gregorian Easter determines the exchange's Good Friday holiday.
function goodFriday(year) {
  const lunarYear = year % 19;
  const century = Math.floor(year / 100);
  const remainder = year % 100;
  const correction = Math.floor((century + 8) / 25);
  const epact = (19 * lunarYear + century - Math.floor(century / 4)
    - Math.floor((century - correction + 1) / 3) + 15) % 30;
  const weekday = (32 + 2 * (century % 4) + 2 * Math.floor(remainder / 4) - epact - remainder % 4) % 7;
  const offset = epact + weekday - 7 * Math.floor((lunarYear + 11 * epact + 22 * weekday) / 451) + 114;
  return dateOnly(new Date(Date.UTC(year, Math.floor(offset / 31) - 1, offset % 31 - 1)));
}

function isSession(date) {
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const year = date.getUTCFullYear(), month = date.getUTCMonth() + 1, day = date.getUTCDate();
  if (weekday === 1 && (([1, 2].includes(month) && day >= 15 && day <= 21)
    || (month === 5 && day >= 25) || (month === 9 && day <= 7))) return false;
  if (month === 11 && weekday === 4 && day >= 22 && day <= 28) return false;
  return ![
    observedHoliday(year, 1, 1, false), goodFriday(year), observedHoliday(year, 6, 19),
    observedHoliday(year, 7, 4), observedHoliday(year, 12, 25),
  ].includes(dateOnly(date));
}

export function latestUsSession(now = Date.now()) {
  const parts = Object.fromEntries(eastern.formatToParts(now).map(part => [part.type, Number(part.value)]));
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  // Use the standard close as the cutoff, including on early-close days.
  if (parts.hour < 16) date.setUTCDate(date.getUTCDate() - 1);
  while (!isSession(date)) date.setUTCDate(date.getUTCDate() - 1);
  const current = dateOnly(date);
  do { date.setUTCDate(date.getUTCDate() - 1); } while (!isSession(date));
  return {date: current, previous: dateOnly(date)};
}

export const US_CASH_INDEXES = new Set(['nasdaq', 'nasdaqcom', 'sox', 'sp500', 'vix']);

export function matchesUsClose(quote, session) {
  return quote?.observedAt === session.date && Number.isFinite(quote.change)
    && (!quote.comparisonAt || quote.comparisonAt === session.previous);
}
