/**
 * Pure helpers for observed market-index histories.
 * No price interpolation, no fabricated candles, and no live market queries.
 */
const DAY_MS = 86400000;

export function chartSeries(history) {
  if (!Array.isArray(history)) return [];
  const distinct = new Map();
  for (const row of history) {
    if (!row || typeof row !== 'object') continue;
    const date = String(row.date || '');
    const raw = row.value ?? row.close;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || raw === null || raw === undefined || String(raw).trim() === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) continue;
    const observed = new Date(date + 'T00:00:00Z');
    if (!Number.isFinite(observed.getTime()) || observed.toISOString().slice(0, 10) !== date) continue;
    distinct.set(date, { date, value });
  }
  return [...distinct.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-150);
}

export function chartPeriod(series, period = '3m') {
  if (!Array.isArray(series) || !series.length) return [];
  if (period === 'all') return series.slice();
  const days = period === '1m' ? 31 : period === '3m' ? 93 : period === '1y' ? 366 : null;
  if (days === null) return [];
  const last = Date.parse(series[series.length - 1].date + 'T00:00:00Z');
  return series.filter(p => Date.parse(p.date + 'T00:00:00Z') >= last - days * DAY_MS);
}

export function chartPeriodChange(series) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const first = series[0].value, last = series[series.length - 1].value;
  return Number.isFinite(first) && first > 0 && Number.isFinite(last)
    ? (last - first) / first * 100 : null;
}

// For close-only sources (e.g. FRED), use the last ACTUAL daily observation
// of each ISO week or calendar month. No artificial open/high/low.
export function chartFrequency(series, frequency='D') {
  if (!Array.isArray(series) || !['D','W','M'].includes(frequency)) return [];
  if (frequency === 'D') return series.slice();
  const groups = new Map();
  for (const point of series) {
    const date = new Date(point.date+'T00:00:00Z');
    if (!Number.isFinite(date.getTime())) continue;
    if (frequency === 'W') date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));
    const group=frequency === 'W' ? date.toISOString().slice(0,10) : point.date.slice(0,7);
    // Caller supplies a chronologically sorted chartSeries.
    groups.set(group,point);
  }
  return [...groups.values()];
}

// Validate KIS-supplied OHLC bars. A close-only row never becomes a candle.
export function candleSeries(rows) {
  if (!Array.isArray(rows)) return [];
  const valid = new Map();
  for (const row of rows) {
    if (!row || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    const date=new Date(row.date+'T00:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==row.date) continue;
    const fields=['open','high','low','close'];
    if (fields.some(key => row[key]===null || row[key]===undefined || String(row[key]).trim()==='' || !Number.isFinite(Number(row[key])) || Number(row[key])<=0)) continue;
    const {open,high,low,close}=Object.fromEntries(fields.map(key=>[key,Number(row[key])]));
    if (low > Math.min(open,close) || high < Math.max(open,close) || low>high) continue;
    valid.set(row.date,{date:row.date,open,high,low,close,value:close});
  }
  return [...valid.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-150);
}
