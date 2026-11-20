import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { DeskRoom } from '../src/room.js';

async function fixture(t, now = Date.now()) {
  const database = new DatabaseSync(':memory:');
  t.after(() => database.close());
  const sockets = [];
  let alarm = null;
  const sql = {
    exec(query, ...parameters) {
      if (query.split(';').filter(part => part.trim()).length > 1) {
        database.exec(query);
        return { toArray: () => [] };
      }
      // Durable Object SQL executes when exec() is called, not when its cursor is read.
      const rows = database.prepare(query).all(...parameters);
      return { toArray: () => rows };
    }
  };
  const ctx = {
    storage: {
      sql,
      async getAlarm() { return alarm; },
      async setAlarm(value) { alarm = value; },
      transactionSync(callback) {
        database.exec('BEGIN');
        try { const value = callback(); database.exec('COMMIT'); return value; }
        catch (error) { database.exec('ROLLBACK'); throw error; }
      }
    },
    blockConcurrencyWhile(callback) { return callback(); },
    getWebSockets() { return sockets; }
  };
  const room = new DeskRoom(ctx, {});
  await room.ready;
  room.sql.exec("INSERT INTO users(id,username,name,password_hash,role,must_change_password,created_at) VALUES('user-one','member','회원','unused','member',0,?)", now);
  room.sql.exec('INSERT INTO user_usage_state(user_id,accounted_at) VALUES(?,?)', 'user-one', now);
  function addSession(id) {
    room.sql.exec('INSERT INTO sessions(id,user_id,created_at,expires_at,last_seen,accounted_at) VALUES(?,?,?,?,?,?)', id, 'user-one', now, now + 86_400_000, now, now);
    const socket = {
      state: { userId: 'user-one', sessionHash: id, lastBeat: now, visible: true, active: true },
      deserializeAttachment() { return structuredClone(this.state); },
      serializeAttachment(value) { this.state = structuredClone(value); },
      send() {},
      close() {}
    };
    sockets.push(socket);
    return socket;
  }
  function total() {
    return room.one('SELECT COALESCE(SUM(connected_seconds),0) AS connected,COALESCE(SUM(active_seconds),0) AS active FROM user_usage WHERE user_id=?', 'user-one');
  }
  return { room, sockets, addSession, total, now };
}

test('overlapping device sessions count once in member totals, with session durations retained separately', async t => {
  const { room, addSession, total, now } = await fixture(t);
  addSession('session-device-one');
  addSession('session-device-two');
  room.accountSession('session-device-one', now + 10_000);
  room.accountSession('session-device-two', now + 10_000);
  assert.deepEqual({ ...total() }, { connected: 10, active: 10 });
  assert.equal(room.one('SELECT SUM(active_seconds) AS seconds FROM sessions').seconds, 20);
  assert.equal(room.online().length, 1, 'the same member on two devices is one online person');
});

test('hidden devices remain connected while activity uses the union of visible active devices', async t => {
  const { room, addSession, total, now } = await fixture(t);
  const first = addSession('session-one');
  const second = addSession('session-two');
  first.state.visible = false;
  first.state.active = false;
  room.accountSession('session-one', now + 10_000);
  room.accountSession('session-two', now + 10_000);
  assert.deepEqual({ ...total() }, { connected: 10, active: 10 });

  second.state.visible = false;
  second.state.active = false;
  room.accountSession('session-one', now + 20_000);
  room.accountSession('session-two', now + 20_000);
  assert.deepEqual({ ...total() }, { connected: 20, active: 10 });

  first.state.visible = true;
  first.state.active = true;
  room.accountSession('session-one', now + 30_000);
  room.accountSession('session-two', now + 30_000);
  assert.deepEqual({ ...total() }, { connected: 30, active: 20 });
});

test('long heartbeat gaps are capped and stale connections add no activity', async t => {
  const { room, addSession, total, now } = await fixture(t);
  addSession('session-one');
  room.accountSession('session-one', now + 80_000);
  assert.deepEqual({ ...total() }, { connected: 60, active: 60 });
  room.accountSession('session-one', now + 100_000);
  assert.deepEqual({ ...total() }, { connected: 60, active: 60 });
});

test('an interval crossing UTC midnight is assigned to each actual day', async t => {
  const dayMs = 86_400_000;
  const midnight = Math.floor(Date.now() / dayMs) * dayMs + dayMs;
  const { room, addSession } = await fixture(t, midnight - 5_000);
  addSession('session-one');
  room.accountSession('session-one', midnight + 5_000);
  const days = room.rows('SELECT day,connected_seconds,active_seconds FROM user_usage ORDER BY day');
  assert.equal(days.length, 2);
  assert.equal(days[0].day, midnight - dayMs);
  assert.equal(days[1].day, midnight);
  assert.equal(days[0].active_seconds, 5);
  assert.equal(days[1].active_seconds, 5);
});
