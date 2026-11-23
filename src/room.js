const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const PRESENCE_MS = 90_000;
const ACCOUNTING_CAP_MS = 60_000;
const PBKDF2_ITERATIONS = 100_000;
const PIN_ATTEMPT_WINDOW_MS = 30 * 60_000;
const encoder = new TextEncoder();

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function hex(bytes) { return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join(''); }
function unhex(value) { return new Uint8Array(value.match(/.{2}/g).map(part => parseInt(part, 16))); }
function randomHex(length = 32) { return hex(crypto.getRandomValues(new Uint8Array(length))); }
async function digest(value) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
function equal(a, b) {
  const left = encoder.encode(a), right = encoder.encode(b);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) difference |= (left[index] || 0) ^ (right[index] || 0);
  return difference === 0;
}

export async function hashPassword(password, salt = randomHex(16)) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unhex(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, key, 256);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${salt}$${hex(derived)}`;
}

export async function verifyPassword(password, encoded) {
  if (!/^pbkdf2-sha256\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(encoded || '')) return false;
  return equal(await hashPassword(password, encoded.split('$')[2]), encoded);
}

function publicUser(row) {
  return { id: row.id, username: row.username, name: row.name, role: row.role, pinLogin: row.auth_mode === 'pin', mustChangePassword: !!row.must_change_password, disabled: !!row.disabled, createdAt: new Date(row.created_at).toISOString(), lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : null };
}
// Legacy profiles can retain YYMMDD without asking new members for a birth date.
function ageAtBirth6(value, now = Date.now()) {
  if (typeof value !== 'string' || !/^[0-9]{6}$/.test(value)) return null;
  const today = new Date(now + 9 * 3600000);
  const year = today.getUTCFullYear();
  const shortYear = Number(value.slice(0, 2));
  const birthYear = shortYear <= year % 100 ? 2000 + shortYear : 1900 + shortYear;
  const month = Number(value.slice(2, 4)), day = Number(value.slice(4, 6));
  const birthday = new Date(Date.UTC(birthYear, month - 1, day));
  if (birthday.getUTCFullYear() !== birthYear || birthday.getUTCMonth() !== month - 1 || birthday.getUTCDate() !== day) return null;
  const beforeBirthday = today.getUTCMonth() < month - 1 || (today.getUTCMonth() === month - 1 && today.getUTCDate() < day);
  const age = year - birthYear - Number(beforeBirthday);
  return age >= 0 ? age : null;
}
function validateBirth6(value) {
  if (ageAtBirth6(value) === null) throw new ApiError(400, '실제 생년월일을 숫자 6자리로 입력해 주세요.');
  return value;
}
function validateAge(value) {
  if (!Number.isInteger(value) || value < 0 || value > 120) throw new ApiError(400, '만 나이를 0~120 사이의 숫자로 입력해 주세요.');
  return value;
}
function pinProfile(data, acceptsLegacyBirthDate) {
  const gender = validateGender(data.gender);
  if (acceptsLegacyBirthDate && data.age === undefined) return {age: null, birth6: validateBirth6(data.birth6), gender};
  return {age: validateAge(data.age), birth6: null, gender};
}
function validateGender(value) {
  if(value!=='남'&&value!=='여') throw new ApiError(400, '성별은 남 또는 여를 선택해 주세요.');
  return value;
}
function selfUser(row) {
  return {...publicUser(row), age: row.age ?? ageAtBirth6(row.birth_ymd), birth6: row.birth_ymd || null, gender: row.gender || null};
}
function validatePin(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}$/.test(value)) throw new ApiError(400, 'PIN은 숫자 4자리로 입력해 주세요.');
  return value;
}
function validateNickname(value) {
  if (typeof value !== 'string') throw new ApiError(400, '닉네임을 입력해 주세요.');
  const name = value.trim().normalize('NFC').replace(/ +/g, ' ');
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,23}$/u.test(name)) throw new ApiError(400, '닉네임은 한글·영문·숫자 등 1~24자로 입력해 주세요.');
  return name;
}
function clientNetwork(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  return ip.includes(':') ? ip.split(':').slice(0,4).join(':') : ip.split('.').slice(0,3).join('.');
}
function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) throw new ApiError(400, '비밀번호는 10~128자로 입력해 주세요.');
  return value;
}
function validateUsername(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._-]{3,40}$/.test(value)) throw new ApiError(400, '아이디는 영문·숫자·점·밑줄·하이픈 3~40자로 입력해 주세요.');
  return value.toLowerCase();
}
function validateName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 50) throw new ApiError(400, '이름은 1~50자로 입력해 주세요.');
  return value.trim();
}
async function jsonBody(request) {
  if (Number(request.headers.get('Content-Length') || 0) > 8192) throw new ApiError(413, '요청 내용이 너무 큽니다.');
  const body = await request.text();
  if (body.length > 8192) throw new ApiError(413, '요청 내용이 너무 큽니다.');
  try { const parsed = JSON.parse(body); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(); return parsed; }
  catch { throw new ApiError(400, '올바른 JSON 요청이 필요합니다.'); }
}
function result(data, status = 200, headers = {}) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } }); }
function sessionCookie(value, request, expires) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `desk_session=${value}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${expires ? Math.floor(SESSION_MS / 1000) : 0}`;
}
function requireOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) throw new ApiError(403, '동일한 사이트에서만 요청할 수 있습니다.');
}

export class DeskRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')),
        must_change_password INTEGER NOT NULL DEFAULT 1, disabled INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, last_seen INTEGER
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, ended_at INTEGER, last_seen INTEGER NOT NULL,
        connected_seconds REAL NOT NULL DEFAULT 0, active_seconds REAL NOT NULL DEFAULT 0,
        accounted_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_created ON messages(created_at);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS throttle (key TEXT PRIMARY KEY, count INTEGER NOT NULL, started_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS user_usage_state (user_id TEXT PRIMARY KEY, accounted_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS user_usage (
        user_id TEXT NOT NULL, day INTEGER NOT NULL, connected_seconds REAL NOT NULL DEFAULT 0,
        active_seconds REAL NOT NULL DEFAULT 0, PRIMARY KEY(user_id,day)
      );
      INSERT OR IGNORE INTO settings(key,value) VALUES ('chatThreshold','2');`);
      const columns=new Set(this.rows('PRAGMA table_info(users)').map(column=>column.name));
      if (!columns.has('auth_mode')) {
        this.sql.exec("ALTER TABLE users ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'password' CHECK(auth_mode IN ('password','pin'))");
      }
      // Additive, nullable migration: existing accounts and passwords unchanged.
      if (!columns.has('birth_ymd')) this.sql.exec('ALTER TABLE users ADD COLUMN birth_ymd TEXT');
      if (!columns.has('gender')) this.sql.exec('ALTER TABLE users ADD COLUMN gender TEXT');
      if (!columns.has('age')) this.sql.exec('ALTER TABLE users ADD COLUMN age INTEGER');
    });
  }

  rows(query, ...params) { return this.sql.exec(query, ...params).toArray(); }
  one(query, ...params) { return this.rows(query, ...params)[0] || null; }
  threshold() { return Number(this.one("SELECT value FROM settings WHERE key='chatThreshold'")?.value || 2); }
  sockets() { return this.ctx.getWebSockets(); }
  attachment(socket) { try { return socket.deserializeAttachment(); } catch { return null; } }

  async session(request) {
    const raw = request.headers.get('Cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith('desk_session='))?.slice('desk_session='.length);
    if (!raw || !/^[a-f0-9]{64}$/.test(raw)) throw new ApiError(401, '로그인이 필요합니다.');
    const sessionHash = await digest(raw);
    const row = this.one(`SELECT s.id AS session_hash, s.expires_at, s.ended_at, u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?`, sessionHash);
    if (!row || row.disabled || row.ended_at || row.expires_at <= Date.now()) throw new ApiError(401, '로그인이 만료되었습니다. 다시 로그인해 주세요.');
    return { user: row, sessionHash };
  }

  sessionByHash(hash) {
    const row = this.one(`SELECT s.id AS session_hash, s.expires_at, s.ended_at, u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?`, hash);
    if (!row || row.disabled || row.ended_at || row.expires_at <= Date.now()) return null;
    return row;
  }

  async loginSession(user, request) {
    const token = randomHex(), id = await digest(token), now = Date.now();
    const currentUser = user && this.one('SELECT * FROM users WHERE id=?', user.id);
    if (!currentUser || currentUser.disabled || currentUser.password_hash !== user.password_hash) throw new ApiError(401, '인증 정보가 변경되었습니다. 다시 로그인해 주세요.');
    this.accountUser(user.id, now);
    this.sql.exec('INSERT INTO sessions(id,user_id,created_at,expires_at,last_seen,accounted_at) VALUES(?,?,?,?,?,?)', id, user.id, now, now + SESSION_MS, now, now);
    this.sql.exec('UPDATE users SET last_seen=? WHERE id=?', now, user.id);
    await this.ensureAlarm();
    return result({ user: selfUser({ ...user, last_seen: now }) }, 200, { 'Set-Cookie': sessionCookie(token, request, true) });
  }

  rate(key, limit, duration, increment = true) {
    const now = Date.now();
    const row = this.one('SELECT count,started_at FROM throttle WHERE key=?', key);
    if (row && now - row.started_at < duration && row.count >= limit) throw new ApiError(429, '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
    if (increment) this.sql.exec('INSERT INTO throttle(key,count,started_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN started_at>? THEN count+1 ELSE 1 END, started_at=CASE WHEN started_at>? THEN started_at ELSE excluded.started_at END', key, now, now - duration, now - duration);
  }

  async createPinMember(request, {name, username, pin, network, profile}) {
    this.rate(`pin-signup:${network}`, 10, 60 * 60_000);
    if (!this.one("SELECT id FROM users WHERE role='admin' LIMIT 1")) throw new ApiError(503, '관리자 초기 설정 후 입장할 수 있습니다.');
    const id = crypto.randomUUID(), passwordHash = await hashPassword(pin);
    const created = this.one(`INSERT INTO users(id,username,name,password_hash,role,must_change_password,created_at,auth_mode,birth_ymd,gender,age)
      VALUES(?,?,?,?,'member',0,?,'pin',?,?,?) ON CONFLICT(username) DO NOTHING RETURNING *`,
      id, username, name, passwordHash, Date.now(), profile.birth6, profile.gender, profile.age);
    if (!created) throw new ApiError(409, '닉네임이 이미 등록되었습니다. 닉네임과 PIN으로 다시 시도해 주세요.');
    return this.loginSession(created, request);
  }

  async pinSession(request, mode = 'login') {
    const data = await jsonBody(request);
    const name = validateNickname(data.nickname), username = name.toLowerCase().normalize('NFC');
    const pin = validatePin(data.pin);
    const signupProfile = mode === 'register' ? pinProfile(data, true) : null;
    const network = await digest(clientNetwork(request));
    this.rate(`pin-ip:${network}`, 30, 15 * 60_000);
    const user = this.one('SELECT * FROM users WHERE username=?', username);
    if (signupProfile && user) throw new ApiError(409, '이미 사용 중인 닉네임입니다. 로그인해 주세요.');
    if (!user && (mode === 'entry' || signupProfile)) {
      const profile = signupProfile || pinProfile(data, false);
      return this.createPinMember(request, {name, username, pin, network, profile});
    }
    const accountKey = `pin-account:${await digest(username)}`;
    if (!user || user.auth_mode !== 'pin' || user.role !== 'member' || user.disabled)
      throw new ApiError(401, '닉네임 또는 PIN을 확인해 주세요.');
    this.rate(accountKey, 5, PIN_ATTEMPT_WINDOW_MS);
    if (!(await verifyPassword(pin, user.password_hash))) throw new ApiError(401, '닉네임 또는 PIN을 확인해 주세요.');
    const response = await this.loginSession(user, request);
    this.sql.exec('DELETE FROM throttle WHERE key=?', accountKey);
    return response;
  }

  async ensureAlarm() {
    const next = Date.now() + 30_000;
    const existing = await this.ctx.storage.getAlarm();
    if (!existing || existing > next) await this.ctx.storage.setAlarm(next);
  }

  online() {
    const now = Date.now(), map = new Map();
    for (const socket of this.sockets()) {
      const a = this.attachment(socket);
      if (!a || now - a.lastBeat > PRESENCE_MS) continue;
      const user = this.sessionByHash(a.sessionHash);
      if (!user || user.must_change_password) continue;
      const existing = map.get(user.id);
      map.set(user.id, { id: user.id, name: user.name, active: !!(existing?.active || (a.visible && a.active)) });
    }
    return Array.from(map.values());
  }

  accountSession(sessionHash, now = Date.now()) {
    const row = this.one('SELECT user_id,accounted_at,ended_at FROM sessions WHERE id=?', sessionHash);
    if (!row || row.ended_at) return;
    this.accountUser(row.user_id, now);
    const attachments = this.sockets().map(socket => this.attachment(socket)).filter(a => a?.sessionHash === sessionHash && now - a.lastBeat <= PRESENCE_MS);
    const delta = Math.min(ACCOUNTING_CAP_MS, Math.max(0, now - row.accounted_at)) / 1000;
    const connected = attachments.length > 0;
    const active = attachments.some(a => a.visible && a.active);
    this.sql.exec('UPDATE sessions SET connected_seconds=connected_seconds+?,active_seconds=active_seconds+?,accounted_at=?,last_seen=CASE WHEN ? THEN ? ELSE last_seen END WHERE id=?', connected ? delta : 0, active ? delta : 0, now, connected ? 1 : 0, now, sessionHash);
  }

  accountUser(userId, now = Date.now()) {
    const state = this.one('SELECT accounted_at FROM user_usage_state WHERE user_id=?', userId);
    this.sql.exec('INSERT INTO user_usage_state(user_id,accounted_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET accounted_at=excluded.accounted_at', userId, now);
    if (!state) return;
    const attachments = this.sockets().map(socket => this.attachment(socket)).filter(a => a?.userId === userId && now - a.lastBeat <= PRESENCE_MS && this.sessionByHash(a.sessionHash));
    if (!attachments.length) return;
    const active = attachments.some(a => a.visible && a.active);
    const intervalStart = Math.max(state.accounted_at, now - ACCOUNTING_CAP_MS);
    const dayMs = 24 * 60 * 60 * 1000;
    // Assign a cross-midnight interval to its actual UTC days, while counting all tabs/devices once.
    for (let start = intervalStart; start < now;) {
      const day = Math.floor(start / dayMs) * dayMs;
      const end = Math.min(now, day + dayMs), seconds = (end - start) / 1000;
      this.sql.exec('INSERT INTO user_usage(user_id,day,connected_seconds,active_seconds) VALUES(?,?,?,?) ON CONFLICT(user_id,day) DO UPDATE SET connected_seconds=connected_seconds+excluded.connected_seconds,active_seconds=active_seconds+excluded.active_seconds', userId, day, seconds, active ? seconds : 0);
      start = end;
    }
  }

  history() {
    return this.rows('SELECT id,user_id AS userId,name,text,created_at AS createdAt FROM messages ORDER BY created_at DESC LIMIT 100').reverse().map(row => ({ ...row, createdAt: new Date(row.createdAt).toISOString() }));
  }

  broadcastState() {
    const online = this.online();
    this.broadcast({ type: 'state', online, count: online.length, threshold: this.threshold(), messages: this.history() });
  }

  broadcast(value) {
    const data = JSON.stringify(value);
    for (const socket of this.sockets()) {
      const a = this.attachment(socket);
      const user = a && this.sessionByHash(a.sessionHash);
      if (!user || user.must_change_password) { try { socket.close(4001, '로그인이 필요합니다.'); } catch {} continue; }
      try { socket.send(data); } catch { try { socket.close(1011, '연결을 다시 시도해 주세요.'); } catch {} }
    }
  }

  closeSessions(userId, except = null) {
    const now = Date.now();
    const sessions = this.rows('SELECT id FROM sessions WHERE user_id=? AND ended_at IS NULL', userId);
    for (const { id } of sessions) {
      if (id === except) continue;
      this.accountSession(id, now);
      this.sql.exec('UPDATE sessions SET ended_at=? WHERE id=?', now, id);
      for (const socket of this.sockets()) if (this.attachment(socket)?.sessionHash === id) { try { socket.close(4001, '세션이 종료되었습니다.'); } catch {} }
    }
  }

  async fetch(request) {
    await this.ready;
    try {
      const url = new URL(request.url), path = url.pathname, method = request.method;
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) requireOrigin(request);
      if (path === '/api/status' && method === 'GET') return result({ initialized: !!this.one('SELECT id FROM users LIMIT 1'), setupAvailable: !!(this.env.BOOTSTRAP_TOKEN || this.env.BOOTSTRAP_TOKEN_SHA256) });
      if (path === '/api/setup' && method === 'POST') {
        const data = await jsonBody(request);
        if (!this.env.BOOTSTRAP_TOKEN && !this.env.BOOTSTRAP_TOKEN_SHA256) throw new ApiError(503, '관리자 설정 코드가 서버에 등록되지 않았습니다.');
        this.rate('setup', 12, 15 * 60_000);
        if (this.one('SELECT id FROM users LIMIT 1')) throw new ApiError(409, '초기 관리자 설정이 이미 완료되었습니다.');
        const providedHash = await digest(typeof data.token === 'string' ? data.token : '');
        const expectedHash = this.env.BOOTSTRAP_TOKEN_SHA256 || await digest(this.env.BOOTSTRAP_TOKEN);
        if (!equal(providedHash, String(expectedHash).toLowerCase())) throw new ApiError(403, '관리자 설정 코드가 올바르지 않습니다.');
        const username = validateUsername(data.username), name = validateName(data.name), password = validatePassword(data.password);
        const passwordHash = await hashPassword(password), id = crypto.randomUUID(), now = Date.now();
        // No awaits between the final count check and insert: only one bootstrap can claim ownership.
        this.ctx.storage.transactionSync(() => {
          if (this.one('SELECT id FROM users LIMIT 1')) throw new ApiError(409, '초기 관리자 설정이 이미 완료되었습니다.');
          this.sql.exec('INSERT INTO users(id,username,name,password_hash,role,must_change_password,created_at) VALUES(?,?,?,?,\'admin\',0,?)', id, username, name, passwordHash, now);
        });
        return await this.loginSession(this.one('SELECT * FROM users WHERE id=?', id), request);
      }
      if (path === '/api/pin-login' && method === 'POST') return await this.pinSession(request);
      if (path === '/api/pin-register' && method === 'POST') return await this.pinSession(request, 'register');
      if (path === '/api/pin-entry' && method === 'POST') return await this.pinSession(request, 'entry');
      if ((path === '/api/admin-login' || path === '/api/login') && method === 'POST') {
        const data = await jsonBody(request);
        const username = typeof data.username === 'string' ? data.username.toLowerCase().slice(0,100) : '';
        const coarseIp = clientNetwork(request);
        this.rate(`login-ip:${await digest(coarseIp)}`, 60, 15 * 60_000);
        const key = `login:${await digest(username + '|' + coarseIp)}`;
        this.rate(key, 8, 15 * 60_000, false);
        const user = this.one('SELECT * FROM users WHERE username=?', username);
        const password = typeof data.password === 'string' ? data.password.slice(0,129) : '';
        const dummy = 'pbkdf2-sha256$100000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000';
        const valid = await verifyPassword(password, user?.auth_mode === 'password' ? user.password_hash : dummy);
        const currentUser = user && this.one('SELECT * FROM users WHERE id=?', user.id);
        if (!currentUser || currentUser.disabled || !valid || currentUser.password_hash !== user.password_hash
            || (path === '/api/admin-login' && currentUser.role !== 'admin')) { this.rate(key, 8, 15 * 60_000); throw new ApiError(401, '아이디 또는 비밀번호를 확인해 주세요.'); }
        this.sql.exec('DELETE FROM throttle WHERE key=?', key);
        return await this.loginSession(currentUser, request);
      }

      const { user, sessionHash } = await this.session(request);
      if (path === '/api/me' && method === 'GET') return result({ user: selfUser(user) });
      if (path === '/api/logout' && method === 'POST') {
        this.accountSession(sessionHash);
        this.sql.exec('UPDATE sessions SET ended_at=? WHERE id=?', Date.now(), sessionHash);
        for (const socket of this.sockets()) if (this.attachment(socket)?.sessionHash === sessionHash) { try { socket.close(1000, '로그아웃'); } catch {} }
        this.broadcastState();
        return result({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', request, false) });
      }
      if (path === '/api/profile' && method === 'PATCH') {
        if (user.auth_mode !== 'pin') throw new ApiError(403, 'PIN 회원만 이 정보를 수정할 수 있습니다.');
        const data=await jsonBody(request);
        const {age, birth6, gender} = pinProfile(data, true), pin = validatePin(data.pin);
        this.rate(`profile:${user.id}`,5,30*60_000);
        if(!(await verifyPassword(pin,user.password_hash))) throw new ApiError(401,'현재 PIN이 올바르지 않습니다.');
        const currentUser = this.sessionByHash(sessionHash);
        if (!currentUser || currentUser.password_hash !== user.password_hash) throw new ApiError(401, '인증 정보가 변경되었습니다. 다시 로그인해 주세요.');
        this.sql.exec('UPDATE users SET birth_ymd=COALESCE(?,birth_ymd),gender=?,age=? WHERE id=?', birth6, gender, age, user.id);
        return result({user:selfUser(this.one('SELECT * FROM users WHERE id=?',user.id))});
      }
      if (path === '/api/password' && method === 'POST') {
        const data = await jsonBody(request);
        if (user.auth_mode === 'pin') validatePin(data.newPassword);
        else validatePassword(data.newPassword);
        this.rate(`password:${user.id}`, 8, 15 * 60_000);
        if (typeof data.currentPassword !== 'string' || !(await verifyPassword(data.currentPassword, user.password_hash))) throw new ApiError(400, '현재 비밀번호가 올바르지 않습니다.');
        if (data.newPassword === data.currentPassword) throw new ApiError(400, '현재 비밀번호와 다른 비밀번호를 입력해 주세요.');
        const passwordHash = await hashPassword(data.newPassword);
        const currentUser = this.sessionByHash(sessionHash);
        if (!currentUser || currentUser.password_hash !== user.password_hash) throw new ApiError(401, '인증 정보가 변경되었습니다. 다시 로그인해 주세요.');
        this.sql.exec('UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?', passwordHash, user.id);
        this.closeSessions(user.id, sessionHash);
        return result({ user: selfUser(this.one('SELECT * FROM users WHERE id=?', user.id)) });
      }
      if (user.must_change_password) throw new ApiError(403, '임시 비밀번호를 먼저 변경해 주세요.');
      if (user.auth_mode === 'pin' && (path === '/api/ws' || path.startsWith('/api/chat/'))) throw new ApiError(403, '대화방은 초대 계정으로 이용할 수 있습니다.');
      if (path === '/api/ws' && method === 'GET') {
        requireOrigin(request);
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') throw new ApiError(426, 'WebSocket 연결이 필요합니다.');
        if (this.sockets().filter(socket => this.attachment(socket)?.userId === user.id).length >= 8) throw new ApiError(429, '동시 연결 수가 너무 많습니다.');
        const now = Date.now();
        this.accountSession(sessionHash, now);
        const pair = new WebSocketPair(), client = pair[0], server = pair[1];
        server.serializeAttachment({ userId: user.id, sessionHash, lastBeat: now, visible: false, active: false });
        this.ctx.acceptWebSocket(server);
        this.sql.exec('UPDATE sessions SET accounted_at=?,last_seen=? WHERE id=?', now, now, sessionHash);
        await this.ensureAlarm();
        this.broadcastState();
        return new Response(null, { status: 101, webSocket: client });
      }
      if (path === '/api/settings' && method === 'GET') return result({ chatThreshold: this.threshold() });
      if (path === '/api/chat/history' && method === 'GET') return result({ messages: this.history() });
      if (path.startsWith('/api/admin/')) {
        if (user.role !== 'admin') throw new ApiError(403, '관리자 권한이 필요합니다.');
        if (path === '/api/admin/users' && method === 'GET') return result({ users: this.rows('SELECT * FROM users ORDER BY created_at').map(publicUser) });
        if (path === '/api/admin/users' && method === 'POST') {
          const data = await jsonBody(request), username = validateUsername(data.username), name = validateName(data.name);
          validatePassword(data.password);
          if (this.one('SELECT id FROM users WHERE username=?', username)) throw new ApiError(409, '이미 사용하는 아이디입니다.');
          if (data.role && !['admin','member'].includes(data.role)) throw new ApiError(400, '올바른 권한을 선택해 주세요.');
          const hash = await hashPassword(data.password), id = crypto.randomUUID();
          const currentCaller = this.sessionByHash(sessionHash);
          if (!currentCaller || currentCaller.role !== 'admin') throw new ApiError(403, '관리자 권한이 필요합니다.');
          try { this.sql.exec('INSERT INTO users(id,username,name,password_hash,role,must_change_password,created_at) VALUES(?,?,?,?,?,1,?)', id, username, name, hash, data.role || 'member', Date.now()); }
          catch { throw new ApiError(409, '이미 사용하는 아이디입니다.'); }
          return result({ user: publicUser(this.one('SELECT * FROM users WHERE id=?', id)) }, 201);
        }
        const match = path.match(/^\/api\/admin\/users\/([a-f0-9-]{36})$/);
        if (match && method === 'PATCH') {
          const target = this.one('SELECT * FROM users WHERE id=?', match[1]);
          if (!target) throw new ApiError(404, '계정을 찾을 수 없습니다.');
          const data = await jsonBody(request);
          if ('disabled' in data && typeof data.disabled !== 'boolean') throw new ApiError(400, '계정 상태가 올바르지 않습니다.');
          const name = 'name' in data ? validateName(data.name) : null;
          let passwordHash = null;
          if ('password' in data) {
            if (target.role === 'admin' && target.id === user.id) throw new ApiError(400, '본인 비밀번호는 비밀번호 변경 메뉴를 이용해 주세요.');
            if (target.auth_mode === 'pin') validatePin(data.password);
            else validatePassword(data.password);
            passwordHash = await hashPassword(data.password);
          }
          this.ctx.storage.transactionSync(() => {
            // Revalidate the caller and last-admin invariant after asynchronous password hashing.
            const currentCaller = this.sessionByHash(sessionHash);
            if (!currentCaller || currentCaller.role !== 'admin') throw new ApiError(403, '관리자 권한이 필요합니다.');
            if (data.disabled && target.role === 'admin' && this.one("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND disabled=0").count <= 1) throw new ApiError(409, '마지막 관리자는 정지할 수 없습니다.');
            if (name !== null) this.sql.exec('UPDATE users SET name=? WHERE id=?', name, target.id);
            if ('disabled' in data) this.sql.exec('UPDATE users SET disabled=? WHERE id=?', data.disabled ? 1 : 0, target.id);
            if (passwordHash) this.sql.exec('UPDATE users SET password_hash=?,must_change_password=? WHERE id=?', passwordHash, target.auth_mode === 'pin' ? 0 : 1, target.id);
          });
          if (passwordHash || data.disabled) this.closeSessions(target.id);
          this.broadcastState();
          return result({ user: publicUser(this.one('SELECT * FROM users WHERE id=?', target.id)) });
        }
        if (path === '/api/admin/activity' && method === 'GET') {
          const now = Date.now();
          for (const row of this.rows('SELECT id FROM sessions WHERE ended_at IS NULL AND expires_at>?', now)) this.accountSession(row.id, now);
          const sessions = this.rows(`SELECT s.user_id AS userId,u.username,u.name,s.created_at AS loginAt,s.ended_at AS logoutAt,s.last_seen AS lastSeen,s.connected_seconds AS connectedSeconds,s.active_seconds AS activeSeconds FROM sessions s JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC LIMIT 500`).map(row => ({ ...row, id: `${row.userId}:${row.loginAt}`, loginAt: new Date(row.loginAt).toISOString(), logoutAt: row.logoutAt ? new Date(row.logoutAt).toISOString() : null, lastSeen: new Date(row.lastSeen).toISOString(), connectedSeconds: Math.round(row.connectedSeconds), activeSeconds: Math.round(row.activeSeconds) }));
          const totals = this.rows(`SELECT u.id AS userId,u.name,u.username,COUNT(s.id) AS loginCount,COALESCE((SELECT SUM(connected_seconds) FROM user_usage a WHERE a.user_id=u.id),0) AS connectedSeconds,COALESCE((SELECT SUM(active_seconds) FROM user_usage a WHERE a.user_id=u.id),0) AS activeSeconds,MAX(s.last_seen) AS lastSeen FROM users u LEFT JOIN sessions s ON u.id=s.user_id GROUP BY u.id ORDER BY activeSeconds DESC`).map(row=>({...row, connectedSeconds:Math.round(row.connectedSeconds),activeSeconds:Math.round(row.activeSeconds),lastSeen:row.lastSeen?new Date(row.lastSeen).toISOString():null}));
          return result({ sessions, totals, online: this.online(), retentionDays: { activity: 90, chat: 30 }, measurement: '활동시간은 화면 표시 및 최근 활동 신호를 기준으로 한 추정치입니다. 회원별 합계는 여러 탭·기기의 겹친 시간을 한 번만 계산합니다. 세션별 기록은 각 로그인 기준입니다.' });
        }
        if (path === '/api/admin/settings' && method === 'PATCH') {
          const data = await jsonBody(request);
          if (!Number.isInteger(data.chatThreshold) || data.chatThreshold < 1 || data.chatThreshold > 100) throw new ApiError(400, '채팅 기준 인원은 1~100명으로 설정해 주세요.');
          this.sql.exec("UPDATE settings SET value=? WHERE key='chatThreshold'", String(data.chatThreshold));
          this.broadcastState();
          return result({ chatThreshold: this.threshold() });
        }
      }
      throw new ApiError(404, '요청한 기능을 찾을 수 없습니다.');
    } catch (error) {
      if (!(error instanceof ApiError)) console.error('Desk API failed', error?.name || 'Error');
      return result({ error: error instanceof ApiError ? error.message : '요청 처리 중 문제가 발생했습니다.' }, error instanceof ApiError ? error.status : 500);
    }
  }

  async webSocketMessage(socket, raw) {
    await this.ready;
    try {
      const a = this.attachment(socket);
      const user = a && this.sessionByHash(a.sessionHash);
      if (!user || user.must_change_password) { socket.close(4001, '다시 로그인해 주세요.'); return; }
      if (typeof raw !== 'string' || raw.length > 8192) throw new ApiError(400, '메시지 형식이 올바르지 않습니다.');
      let data;
      try { data = JSON.parse(raw); } catch { throw new ApiError(400, '메시지 형식이 올바르지 않습니다.'); }
      const now = Date.now();
      if (data.type === 'heartbeat') {
        this.accountSession(a.sessionHash, now);
        socket.serializeAttachment({ ...a, lastBeat: now, visible: data.visible === true, active: data.active === true });
        this.sql.exec('UPDATE users SET last_seen=? WHERE id=?', now, user.id);
        await this.ensureAlarm();
        this.broadcastState();
      } else if (data.type === 'chat') {
        if (now - a.lastBeat > PRESENCE_MS) throw new ApiError(409, '접속 상태를 확인한 후 다시 보내 주세요.');
        if (typeof data.text !== 'string' || !data.text.trim() || data.text.trim().length > 2000) throw new ApiError(400, '메시지는 1~2,000자로 입력해 주세요.');
        if (this.online().length < this.threshold()) throw new ApiError(409, `${this.threshold()}명 이상 접속하면 대화할 수 있습니다.`);
        this.rate(`chat:${user.id}`, 12, 10_000);
        const message = { id: crypto.randomUUID(), userId: user.id, name: user.name, text: data.text.trim(), createdAt: new Date(now).toISOString() };
        this.sql.exec('INSERT INTO messages(id,user_id,name,text,created_at) VALUES(?,?,?,?,?)', message.id, user.id, user.name, message.text, now);
        this.broadcast({ type: 'message', message });
      } else throw new ApiError(400, '알 수 없는 메시지입니다.');
    } catch (error) {
      try { socket.send(JSON.stringify({ type: 'error', error: error instanceof ApiError ? error.message : '메시지를 처리하지 못했습니다.' })); } catch {}
    }
  }

  async webSocketClose(socket, code, reason, wasClean) {
    await this.ready;
    const a = this.attachment(socket);
    if (a) { this.accountSession(a.sessionHash); socket.serializeAttachment({ ...a, lastBeat: 0, visible: false, active: false }); }
    try { socket.close(code === 1005 ? 1000 : code, reason); } catch {}
    this.broadcastState();
  }

  async webSocketError(socket) {
    await this.webSocketClose(socket, 1011, '연결 오류', false);
  }

  async alarm() {
    await this.ready;
    const now = Date.now(), sessionIds = new Set();
    for (const socket of this.sockets()) {
      const a = this.attachment(socket);
      if (a) sessionIds.add(a.sessionHash);
      if (!a || now - a.lastBeat > PRESENCE_MS || !this.sessionByHash(a.sessionHash)) {
        try { socket.close(4000, '접속 상태를 다시 확인해 주세요.'); } catch {}
      }
    }
    for (const id of sessionIds) this.accountSession(id, now);
    this.sql.exec('UPDATE sessions SET ended_at=expires_at WHERE ended_at IS NULL AND expires_at<=?', now);
    this.sql.exec('DELETE FROM sessions WHERE created_at<?', now - 90 * 24 * 60 * 60 * 1000);
    this.sql.exec('DELETE FROM messages WHERE created_at<?', now - 30 * 24 * 60 * 60 * 1000);
    this.sql.exec('DELETE FROM user_usage WHERE day<?', Math.floor(now / (24 * 60 * 60 * 1000)) * 24 * 60 * 60 * 1000 - 90 * 24 * 60 * 60 * 1000);
    this.sql.exec('DELETE FROM throttle WHERE started_at<?', now - 24 * 60 * 60 * 1000);
    this.broadcastState();
    await this.ctx.storage.setAlarm(now + (this.sockets().length ? 30_000 : 24 * 60 * 60 * 1000));
  }
}
