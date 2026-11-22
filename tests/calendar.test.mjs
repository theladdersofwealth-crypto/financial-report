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
