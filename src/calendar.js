import { createMarketReader } from './market.js';

const BLS = 'https://www.bls.gov/schedule/news_release/';
const FED = 'https://www.federalreserve.gov/newsevents/';
const DAY = 86_400_000;
const WINDOW_DAYS = 35;
const EASTERN = 'America/New_York';
const easternOffset = new Intl.DateTimeFormat('en-US', {timeZone: EASTERN, timeZoneName: 'longOffset'});
const easternMonth = new Intl.DateTimeFormat('en-US', {timeZone: EASTERN, year: 'numeric', month: 'numeric'});
const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
let snapshot;

const releases = new Map([
  ['Consumer Price Index', ['미국 소비자물가지수 (CPI)', 'cpi.htm', 3, '소비자물가와 근원물가 발표']],
  ['Employment Situation', ['미국 고용보고서', 'empsit.htm', 3, '비농업 고용, 실업률, 평균임금 발표']],
  ['Producer Price Index', ['미국 생산자물가지수 (PPI)', 'ppi.htm', 2, '생산 단계 물가 발표']],
  ['Job Openings and Labor Turnover Survey', ['미국 구인·이직 보고서 (JOLTS)', 'jolts.htm', 2, '구인 건수와 이직 동향 발표']],
]);
const fomc = new Map([
  ['FOMC Meeting', ['미국 FOMC 정책 결정', 3, '연준 통화정책 성명 발표 일정']],
  ['FOMC Minutes', ['미국 FOMC 의사록', 2, '직전 정책회의 의사록 공개']],
  ['FOMC Press Conference', ['미국 FOMC 기자회견', 2, '연준 의장 기자회견']],
]);

function offsetAt(timestamp) {
  const zone = easternOffset.formatToParts(timestamp).find(part => part.type === 'timeZoneName')?.value;
  const match = /^GMT([+-])(\d\d):(\d\d)$/.exec(zone);
  if (!match) return Number.NaN;
  const [, sign, hours, minutes] = match;
  return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes)) * 60_000;
}

function releaseTime(year, month, day, hour, minute, second = 0, utc = false) {
  const nominal = Date.UTC(year, month - 1, day, hour, minute, second);
  if (new Date(nominal).getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  const timestamp = utc ? nominal : nominal - offsetAt(nominal - offsetAt(nominal));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function blsEvents(text, now, end) {
  if (!text?.trimStart().startsWith('BEGIN:VCALENDAR')) return null;
  const events = [];
  for (const [, event] of text.replace(/\r?\n[ \t]/g, '').matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)\r?\nEND:VEVENT/g)) {
    if (/^STATUS:CANCELLED\s*$/mi.test(event)) continue;
    const title = /^SUMMARY[^:\r\n]*:([^\r\n]+)/m.exec(event)?.[1]?.trim();
    const release = releases.get(title);
    if (!release) continue;
    const time = /^DTSTART(?:;TZID=(US-Eastern|America\/New_York))?:(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)(Z)?\s*$/m.exec(event);
    if (!time || (!time[1] && !time[8])) continue;
    const parts = time.slice(2, 8).map(Number);
    const nominalDay = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    if (nominalDay < now - DAY || nominalDay > end + DAY) continue;
    const at = releaseTime(...parts, Boolean(time[8]));
    if (!at) continue;
    const [name, page, importance, description] = release;
    events.push({name, at, country: 'US', importance, description, source: '미국 노동통계국', sourceUrl: BLS + page});
  }
  return events;
}

function fedEvents(html, year, month, sourceUrl) {
  if (!html) return null;
  const heading = /<h4\b[^>]*>\s*FOMC Meetings\s*<\/h4>/i.exec(html);
  if (!heading) {
    const monthHeading = new RegExp(`<h4\\b[^>]*>\\s*${monthNames[month - 1]}\\s+${year}\\s*<\\/h4>`, 'i');
    return monthHeading.test(html) ? [] : null;
  }
  const section = html.slice(heading.index + heading[0].length).split(/<h4\b/i, 1)[0];
  const rows = section.matchAll(/<div class="col-xs-2">\s*<p>\s*(\d{1,2}):(\d\d)\s*([ap])\.m\.\s*<\/p>\s*<\/div>\s*<div class="col-xs-7">\s*<p>([\s\S]*?)<\/p>[\s\S]*?<div class="col-xs-3">\s*<p>\s*(\d{1,2})\s*<\/p>/gi);
  const events = [];
  for (const [, clockHour, minute, meridiem, rawName, day] of rows) {
    const release = fomc.get(rawName.replace(/<[^>]*>/g, '').trim());
    if (!release || Number(clockHour) < 1 || Number(clockHour) > 12) continue;
    const hour = Number(clockHour) % 12 + (meridiem.toLowerCase() === 'p' ? 12 : 0);
    const at = releaseTime(year, month, Number(day), hour, Number(minute));
    if (!at) continue;
    const [name, importance, description] = release;
    events.push({name, at, country: 'US', importance, description, source: '미국 연방준비제도', sourceUrl});
  }
  return events;
}

export async function collectCalendar(now = Date.now(), readURL = createMarketReader().readURL) {
  const end = now + WINDOW_DAYS * DAY;
  function monthNumber(timestamp) {
    const parts = easternMonth.formatToParts(timestamp);
    return Number(parts.find(part => part.type === 'year').value) * 12 + Number(parts.find(part => part.type === 'month').value) - 1;
  }
  const firstMonth = monthNumber(now), lastMonth = monthNumber(end);
  const months = Array.from({length: lastMonth - firstMonth + 1}, (_, offset) => firstMonth + offset);
  const results = await Promise.all([
    readURL(BLS + 'bls.ics', 'text', {Accept: 'text/calendar'}).then(response => blsEvents(response?.data, now, end)),
    ...months.map(async index => {
      const year = Math.floor(index / 12), month = index % 12 + 1;
      const url = `${FED}${year}-${monthNames[month - 1]}.htm`;
      const response = await readURL(url, 'text', {Accept: 'text/html'});
      return fedEvents(response?.data, year, month, url);
    }),
  ]);
  const confirmed = results.filter(result => result !== null);
  const upcoming = new Map();
  for (const event of confirmed.flat()) {
    const at = Date.parse(event.at);
    if (at >= now && at <= end) upcoming.set(`${event.name}|${event.at}`, event);
  }
  return {
    status: confirmed.length === results.length ? 'ready' : confirmed.length ? 'partial' : 'unavailable',
    events: Array.from(upcoming.values()).sort((a, b) => a.at.localeCompare(b.at)),
  };
}

export async function getCalendar() {
  const now = Date.now();
  let data = snapshot?.expiresAt > now ? snapshot.data : null;
  if (!data) {
    const cacheRequest = new Request('https://market-desk-cache.invalid/calendar/v1');
    try { data = await (await globalThis.caches?.default?.match(cacheRequest))?.json(); }
    catch { /* Continue to the official sources. */ }
    if (!data) {
      data = await collectCalendar(now);
      const seconds = data.status === 'ready' ? 3600 : 300;
      snapshot = {data, expiresAt: Date.now() + seconds * 1000};
      try {
        await globalThis.caches?.default?.put(cacheRequest, Response.json(data, {headers: {'Cache-Control': `public, max-age=${seconds}`}}));
      } catch { /* The in-memory snapshot remains available. */ }
    }
  }
  return {...data, events: data.events.filter(event => Date.parse(event.at) >= now)};
}
