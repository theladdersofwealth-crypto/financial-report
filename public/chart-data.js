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
  const days = period === '1m' ? 31 : period === '3m' ? 93 : null;
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
