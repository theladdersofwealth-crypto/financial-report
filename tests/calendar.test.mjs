import test from 'node:test';
import assert from 'node:assert/strict';
import {collectCalendar} from '../src/calendar.js';

function calendarFeed(events) {
  return ['BEGIN:VCALENDAR', ...events.map(fields => ['BEGIN:VEVENT', ...fields, 'END:VEVENT'].join('\r\n')), 'END:VCALENDAR'].join('\r\n');
}

test('official calendar events are sorted and converted across daylight saving time', async () => {
  const feed = calendarFeed([
    ['SUMMARY:Consumer Price Index', 'DTSTART;TZID=US-Eastern:20261029T083000'],
    ['SUMMARY:Consumer Price Index', 'DTSTART;TZID=US-Eastern:20261112T083000'],
    ['SUMMARY:Employment Situation', 'DTSTART;TZID=US-Eastern:20261106T083000'],
    ['SUMMARY:Producer Price Index', 'DTSTART;TZID=US-Eastern:20261119T083000', 'STATUS:CANCELLED'],
    ['SUMMARY:Employment Situation', 'DTSTART;TZID=US-Eastern:20261001T083000'],
    ['SUMMARY:Another release', 'DTSTART;TZID=US-Eastern:20261119T083000'],
  ]);
  const meeting = `<h4 class="col-md-12">FOMC Meetings </h4>
    <div class="col-xs-2"><p>2:00 p.m.</p></div>
    <div class="col-xs-7"><p>FOMC Meeting</p><p>Two-day meeting, November 17-18</p></div>
    <div class="col-xs-3"><p>18</p></div>`;
  const read = async url => ({data: url.endsWith('.ics') ? feed : url.endsWith('november.htm') ? meeting : '<h4>October 2026</h4>'});
  const result = await collectCalendar(Date.parse('2026-10-26T09:00:00Z'), read);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.events.map(event => event.at), [
    '2026-10-29T12:30:00.000Z', '2026-11-06T13:30:00.000Z', '2026-11-12T13:30:00.000Z', '2026-11-18T19:00:00.000Z',
  ]);
  assert.equal(result.events[3].name, '미국 FOMC 정책 결정');
  assert.match(result.events[3].sourceUrl, /federalreserve\.gov/);
  assert.match(result.events[0].sourceUrl, /bls\.gov/);
});

test('a feed failure preserves events from the other provider and reports partial availability', async () => {
  const read = async url => url.endsWith('.ics')
    ? {data: calendarFeed([['SUMMARY:Employment Situation', 'DTSTART:20261204T133000Z']])}
    : null;
  const result = await collectCalendar(Date.parse('2026-11-22T00:00:00Z'), read);
  assert.equal(result.status, 'partial');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].at, '2026-12-04T13:30:00.000Z');
});

test('monthly BLS and annual Fed official alternatives preserve actual release times and disclose unknown times', async () => {
  const read = async url => {
    if (url.includes('12_sched.htm')) return {data: `<title>Schedule of Selected Releases for December 2026</title>
      <td id="d1204"><p class="day">4</p><p><strong>Employment Situation<br></strong>November 2026<br>08:30 AM</p></td>
      <td id="d1210"><p class="day">10</p><p><strong>Consumer Price Index<br></strong>November 2026<br>08:30 AM</p></td>`};
    if (url.endsWith('fomccalendars.htm')) return {data: `<h4><a id="2026">2026 FOMC Meetings</a></h4>
      <div class="fomc-meeting__month"><strong>December</strong></div><div class="fomc-meeting__date">8-9*</div>`};
    return null;
  };
  const risk = await collectCalendar(Date.parse('2026-11-23T05:00:00Z'), read);
  assert.equal(risk.status, 'partial');
  assert.equal(risk.events.find(event => event.name.includes('CPI')).at, '2026-12-10T13:30:00.000Z');
  assert.equal(risk.events.find(event => event.name.includes('고용')).route, 'alternate');
  const meeting = risk.events.find(event => event.name.includes('FOMC'));
  assert.equal(meeting.date, '2026-12-09');
  assert.equal(meeting.at, undefined);
  assert.equal(meeting.route, 'limited');
  assert.deepEqual(risk.providers[0].periods.map(item => [item.month, item.route]), [
    ['2026-11', 'unavailable'], ['2026-12', 'alternate'],
  ]);
});

test('individual outages use the corresponding saved month without reviving past events', async () => {
  const now = Date.parse('2026-11-23T05:00:00Z');
  const fixture = (id, month, checkedAt, at) => ({id, month, checkedAt, route: 'primary', events: [{name: id, at}]});
  const saved = [fixture('bls', '2026-12', '2026-11-22T00:00:00Z', '2026-12-04T13:30:00.000Z'),
    fixture('bls', '2026-11', '2026-11-22T00:00:00Z', '2026-11-19T13:30:00.000Z')];
  const built = [fixture('fed', '2026-12', '2026-11-02T00:00:00Z', '2026-12-09T19:00:00.000Z'),
    fixture('fed', '2026-11', '2026-10-01T00:00:00Z', '2026-11-28T19:00:00.000Z')];
  const result = await collectCalendar(now, async () => null, saved, built);
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.events.map(item => item.route), ['cache', 'build']);
  assert.equal(result.providers[1].periods[0].route, 'unavailable');
  assert.deepEqual(result.sections, [], 'restored dates must not be marked as fresh again');
});
