import { createMarketReader } from './market.js';
import deploymentCalendar from './calendar-deploy-snapshot.js';

const BLS = 'https://www.bls.gov/schedule/news_release/';
const FED = 'https://www.federalreserve.gov/newsevents/';
const DAY = 86_400_000;
const WINDOW_DAYS = 35;
const EASTERN = 'America/New_York';
const easternOffset = new Intl.DateTimeFormat('en-US', {timeZone: EASTERN, timeZoneName: 'longOffset'});
const easternMonth = new Intl.DateTimeFormat('en-US', {timeZone: EASTERN, year: 'numeric', month: 'numeric'});
const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
let snapshot;
let lastGood = [];

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
  if (month < 1 || month > 12 || new Date(nominal).getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  const timestamp = utc ? nominal : nominal - offsetAt(nominal - offsetAt(nominal));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function blsEvents(text) {
  if (!text?.trimStart().startsWith('BEGIN:VCALENDAR') || !text.trimEnd().endsWith('END:VCALENDAR') || !text.includes('BEGIN:VEVENT')) return null;
  const events = [];
  for (const [, event] of text.replace(/\r?\n[ \t]/g, '').matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)\r?\nEND:VEVENT/g)) {
    if (/^STATUS:CANCELLED\s*$/mi.test(event)) continue;
    const title = /^SUMMARY[^:\r\n]*:([^\r\n]+)/m.exec(event)?.[1]?.trim();
    const release = releases.get(title);
    if (!release) continue;
    const time = /^DTSTART(?:;TZID=(US-Eastern|America\/New_York))?:(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)(Z)?\s*$/m.exec(event);
    if (!time || (!time[1] && !time[8])) continue;
    const parts = time.slice(2, 8).map(Number);
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
  return events.length ? events : null;
}

function monthNumber(timestamp) {
  const parts = easternMonth.formatToParts(timestamp);
  return Number(parts.find(part => part.type === 'year').value) * 12 + Number(parts.find(part => part.type === 'month').value) - 1;
}

function monthLabel(index) {
  return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`;
}

function blsMonthlyEvents(html, year, month, sourceUrl) {
  const monthName = monthNames[month - 1];
  if (!new RegExp(`<title>Schedule of Selected Releases for ${monthName} ${year}</title>`, 'i').test(html || '')) return null;
  const rows = [...html.matchAll(/<td\b[^>]*id="d(\d{2})(\d{2})"[^>]*>([\s\S]*?)<\/td>/gi)];
  const cells = rows.filter(([, cellMonth]) => Number(cellMonth) === month);
  if (!cells.length) return null;
  const events = [];
  for (const [, , day, content] of cells) {
    for (const [, title, detail] of content.matchAll(/<p>\s*<strong>([\s\S]*?)<\/strong>([\s\S]*?)<\/p>/gi)) {
      const release = releases.get(title.replace(/<[^>]*>/g, '').trim());
      if (!release) continue;
      const time = detail.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*$/i);
      if (!time) return null;
      const at = releaseTime(year, month, Number(day), Number(time[1]) % 12 + (time[3].toUpperCase() === 'PM' ? 12 : 0), Number(time[2]));
      if (!at) return null;
      const [name, , importance, description] = release;
      events.push({name, at, country: 'US', importance, description, source: '미국 노동통계국', sourceUrl});
    }
  }
  return events;
}

const FED_ANNUAL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
function fedMeetingDates(html, year, month) {
  const heading = new RegExp(`<h4\\b[^>]*>\\s*(?:<a\\b[^>]*>)?${year} FOMC Meetings\\s*(?:</a>)?\\s*</h4>`, 'i').exec(html || '');
  if (!heading) return null;
  const panel = html.slice(heading.index + heading[0].length).split(/<h4\b/i, 1)[0];
  const rows = [...panel.matchAll(/<div[^>]*class="[^"]*fomc-meeting__month\b[^"]*"[^>]*>\s*<strong>([^<]+)<\/strong>\s*<\/div>\s*<div[^>]*class="[^"]*fomc-meeting__date\b[^"]*"[^>]*>([^<]+)<\/div>/gi)];
  if (!rows.length) return null;
  return rows.flatMap(([, rawMonth, rawDays]) => {
    const endMonth = rawMonth.trim().split('/').at(-1).trim().toLowerCase();
    const fullMonth = monthNames[month - 1];
    if (endMonth !== fullMonth && endMonth.replace(/\.$/, '') !== fullMonth.slice(0, 3)) return [];
    const day = Number(rawDays.trim().match(/(\d{1,2})\s*\*?$/)?.[1]);
    if (!day || !releaseTime(year, month, day, 0, 0)) return [];
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return [{name: '미국 FOMC 회의 마지막 날', date, country: 'US', importance: 3,
      description: '연준 연간 공식 회의표 기준 · 정책 발표 시각과 기자회견은 월별 일정에서 확인합니다.',
      source: '미국 연방준비제도', sourceUrl: FED_ANNUAL}];
  });
}

function eventTime(event) {
  if (event.at) return Date.parse(event.at);
  const [year, month, day] = event.date.split('-').map(Number);
  return Date.parse(releaseTime(year, month, day, 0, 0));
}

function isUpcoming(event, now, end) {
  const time = eventTime(event);
  if (time > end) return false;
  if (event.at) return time >= now;
  return time + DAY > now;
}

const sourceIds = ['bls', 'fed'];

export async function collectCalendar(now = Date.now(), readURL = createMarketReader().readURL, saved = [], built = []) {
  const end = now + WINDOW_DAYS * DAY;
  const firstMonth = monthNumber(now), lastMonth = monthNumber(end);
  const months = Array.from({length: lastMonth - firstMonth + 1}, (_, offset) => firstMonth + offset);
  const checkedAt = new Date(now).toISOString();
  const html = url => readURL(url, 'text', {Accept: 'text/html'}).then(result => result?.data, () => null);
  const bls = readURL(BLS + 'bls.ics', 'text', {Accept: 'text/calendar'})
    .then(response => blsEvents(response?.data), () => null);
  let fedAnnual;
  const fresh = await Promise.all(months.flatMap(index => sourceIds.map(async id => {
    const month = monthLabel(index);
    const year = Math.floor(index / 12), number = index % 12 + 1;
    let route = 'primary';
    let events;
    if (id === 'bls') {
      const rows = await bls;
      if (rows !== null) events = rows.filter(event => monthNumber(Date.parse(event.at)) === index);
      else {
        const url = `https://www.bls.gov/schedule/${year}/${month.slice(5)}_sched.htm`;
        route = 'alternate';
        events = blsMonthlyEvents(await html(url), year, number, url);
      }
    } else {
      const url = `${FED}${year}-${monthNames[number - 1]}.htm`;
      events = fedEvents(await html(url), year, number, url);
      if (events === null) {
        fedAnnual ||= html(FED_ANNUAL);
        route = 'limited';
        events = fedMeetingDates(await fedAnnual, year, number);
      }
    }
    return {id, month, route: events === null ? 'unavailable' : route, checkedAt, events: events || []};
  })));
  const sections = fresh.map(section => {
    if (section.route !== 'unavailable') return section;
    const candidates = [{sections: saved, route: 'cache', maxDays: 7}, {sections: built, route: 'build', maxDays: WINDOW_DAYS}];
    for (const {sections, route, maxDays} of candidates) {
      const prior = sections.find(item => item.id === section.id && item.month === section.month);
      const age = now - Date.parse(prior?.checkedAt);
      if (age >= 0 && age <= maxDays * DAY && ['primary', 'alternate'].includes(prior?.route)) return {...prior, route};
    }
    return section;
  });
  const events = new Map();
  for (const section of sections) {
    for (const event of section.events) {
      if (isUpcoming(event, now, end)) events.set(`${event.name}|${event.at || event.date}`, {...event, route: section.route});
    }
  }
  return {
    status: sections.every(section => ['primary', 'alternate'].includes(section.route)) ? 'ready'
      : sections.every(section => section.route === 'unavailable') ? 'unavailable' : 'partial',
    events: [...events.values()].sort((a, b) => eventTime(a) - eventTime(b)),
    providers: sourceIds.map(id => ({id, periods: sections.filter(section => section.id === id)
      .map(({month, route, checkedAt}) => ({month, route, checkedAt}))})),
    sections: fresh.filter(section => ['primary', 'alternate'].includes(section.route)),
  };
}

export async function getCalendar() {
  const now = Date.now();
  let data = snapshot?.expiresAt > now ? snapshot.data : null;
  if (!data) {
    const cacheRequest = new Request('https://market-desk-cache.invalid/calendar/v2');
    const savedRequest = new Request('https://market-desk-cache.invalid/calendar/last-good/v1');
    const cache = globalThis.caches?.default;
    try { data = await (await cache?.match(cacheRequest))?.json(); }
    catch { /* Continue to the sources. */ }
    if (!data) {
      let saved = lastGood;
      try { if (!saved.length) saved = (await (await cache?.match(savedRequest))?.json()) || []; }
      catch { /* The build snapshot still covers previously verified releases. */ }
      data = await collectCalendar(now, undefined, saved, deploymentCalendar);
      const current = new Map(saved.filter(section => now - Date.parse(section.checkedAt) <= 7 * DAY)
        .map(section => [`${section.id}:${section.month}`, section]));
      for (const section of data.sections) current.set(`${section.id}:${section.month}`, section);
      lastGood = [...current.values()];
      const seconds = data.status === 'ready' ? 3600 : 300;
      snapshot = {data, expiresAt: Date.now() + seconds * 1000};
      try {
        await cache?.put(savedRequest, Response.json(lastGood, {headers: {'Cache-Control': 'public, max-age=604800'}}));
        await cache?.put(cacheRequest, Response.json(data, {headers: {'Cache-Control': `public, max-age=${seconds}`}}));
      } catch { /* The in-memory snapshot remains available. */ }
    }
  }
  return {status: data.status, providers: data.providers,
    events: data.events.filter(event => isUpcoming(event, now, now + WINDOW_DAYS * DAY))};
}
