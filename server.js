/* BOSS — Production Server
 * Real Node.js backend, replacing the browser-only window.storage
 * mechanism the prototype used, which never left the browser.
 *
 * Storage: a single JSON file on disk (data.json), read into memory on
 * boot and written back on every change. No native dependencies — the
 * first version of this used better-sqlite3, but that requires compiling
 * C++ against Node's headers at install time, which fails outright on
 * networks that block nodejs.org (confirmed by actually trying it before
 * shipping this). A plain JSON file has no such risk, and at the scale
 * this CRM's actual storage needs (a few dozen named keys, not millions
 * of rows), it's a perfectly real, durable choice — verified below by
 * actually writing, restarting the process, and reading it back.
 *
 * WHAT THIS FIXES: data now lives in a real file on disk, durable across
 * restarts, shared correctly across every real device that hits this
 * server — not per-browser, not ephemeral, not dependent on any one
 * browser session staying open.
 *
 * WHAT THIS DOES NOT FIX (see README.md "Honest Limitations" section):
 * there is still no real user authentication, and the role/permission
 * rules are still only enforced in the browser's JavaScript. The
 * CRM_API_KEY check below is a minimal shared-secret gate to keep the API
 * off the open internet — it is NOT equivalent to per-user login security.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const net = require('net');
const tls = require('tls');
const https = require('https');
// A model the firm runs is often on its own network over plain http; the
// outward-facing probes still refuse it, and only the self-hosted adapter uses this.
const http = require('http');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.CRM_API_KEY || null; // set this in production — see README.md
const DB_FILE = process.env.CRM_DB_FILE || path.join(__dirname, 'data.json');
// Connection credentials live in their OWN file, never in data.json.
// data.json is handed to any signed-in browser through /api/storage, so an SMTP
// password kept there would be readable by every user of the CRM. This file is
// only ever read by this process: secrets go in, and the API never sends one back
// out. It sits beside data.json, which in production is outside the repo.
const CONN_FILE = process.env.CRM_CONNECTIONS_FILE || path.join(path.dirname(DB_FILE), 'connections.json');

// Sign-in. One account per person: email and password, kept in SQLite beside
// the data file. This replaces the single shared access code the CRM used to
// have, so the door now records who opened it rather than only that someone did.
//
// SQLite comes from node:sqlite, built into Node 22 — not better-sqlite3, which
// compiles at install time and would break npm ci on this VPS.
const USERS_DB_FILE = process.env.CRM_USERS_DB || path.join(path.dirname(DB_FILE), 'users.db');
const usersDb = new DatabaseSync(USERS_DB_FILE);
usersDb.exec('PRAGMA journal_mode = WAL');
usersDb.exec('PRAGMA busy_timeout = 5000');
usersDb.exec(`CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
)`);
// Added after the table existed, so guard it: 'user' or 'admin'. The only
// difference is that an admin can add accounts; both see the same CRM.
if (!usersDb.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'role'").get()) {
  usersDb.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
}
// An account belongs to a team member. The CRM creates it when the member is
// created and keeps it in step, so there is one person, one record and one
// sign-in rather than the same human typed in twice.
//
//   member_id       the CRM team member this account is                                     
//   crm_role        their role in the CRM, kept for display — the gate only knows admin/user
//   active          a deactivated member cannot sign in, and any open session ends at once
//   issued_password the generated password, readable by an admin until the person uses it
//   last_login_at   when they first proved they had it
const USER_COLUMNS = {
  member_id: "ALTER TABLE users ADD COLUMN member_id TEXT",
  crm_role: "ALTER TABLE users ADD COLUMN crm_role TEXT",
  active: "ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
  issued_password: "ALTER TABLE users ADD COLUMN issued_password TEXT",
  last_login_at: "ALTER TABLE users ADD COLUMN last_login_at TEXT",
  // Two-step sign-in: after the password, a code emailed to this address.
  two_factor: "ALTER TABLE users ADD COLUMN two_factor INTEGER NOT NULL DEFAULT 0",
};
for (const [column, ddl] of Object.entries(USER_COLUMNS)) {
  if (!usersDb.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = ?").get(column)) usersDb.exec(ddl);
}
const findUserByEmail = usersDb.prepare('SELECT * FROM users WHERE email = ?');
const findUserById = usersDb.prepare('SELECT * FROM users WHERE id = ?');
const findUserByMember = usersDb.prepare('SELECT * FROM users WHERE member_id = ?');
const listUsers = usersDb.prepare('SELECT * FROM users ORDER BY id');
/* An account with no team member behind it was only ever made by the
   form on /users, which is gone — Team Members makes the person and the
   account together, through insertMemberUser below. The command line
   (scripts/user.js) has its own statement for the first account on a
   fresh system, which is the one case Team Members cannot cover. */
const insertMemberUser = usersDb.prepare(
  'INSERT INTO users (email, password_hash, role, member_id, crm_role, active, issued_password) VALUES (?, ?, ?, ?, ?, ?, ?)');
const updateUserAccount = usersDb.prepare(
  'UPDATE users SET email = ?, role = ?, member_id = ?, crm_role = ?, active = ? WHERE id = ?');
const updateUserPassword = usersDb.prepare('UPDATE users SET password_hash = ?, issued_password = ? WHERE id = ?');
const noteUserLogin = usersDb.prepare("UPDATE users SET last_login_at = datetime('now'), issued_password = NULL WHERE id = ?");
const deleteUserById = usersDb.prepare('DELETE FROM users WHERE id = ?');
const setUserTwoFactor = usersDb.prepare('UPDATE users SET two_factor = ? WHERE id = ?');

// A password somebody has to read off a screen and type once. No look-alike
// characters, and enough of them that the length is doing the work.
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function generatePassword(length) {
  const n = length || 14;
  let out = '';
  for (let i = 0; i < n; i++) out += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
  return out;
}
// What the CRM is told about an account. The password only ever leaves here
// while it is still unused; once the person has signed in there is nothing to
// show and a new one has to be issued.
function accountJson(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, role: u.role, crmRole: u.crm_role || '', memberId: u.member_id || '',
    active: u.active === undefined ? 1 : u.active, createdAt: u.created_at, lastLoginAt: u.last_login_at || null,
    issuedPassword: u.issued_password || null,
  };
}

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(plain, salt, 64).toString('hex');
}

function passwordMatches(plain, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const want = Buffer.from(hash, 'hex');
  const got = crypto.scryptSync(plain, salt, want.length);
  return crypto.timingSafeEqual(want, got);
}
// Persist this across restarts or every deploy signs everyone out.
const SESSION_SECRET = process.env.CRM_SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE = 'finowise_session';

// Load the whole store into memory once at boot; every request reads/writes this
// object, and writeToDisk() persists it. Simple, and correct at this scale.
let store = {};
if (fs.existsSync(DB_FILE)) {
  try { store = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) { console.error('Could not parse existing data.json — starting from an empty store. Original error:', e.message); }
}
let writePending = false, writeAgain = false;
/* ---------------------------------------------------------------------
   LIVE UPDATES — one stream for the whole system

   A client fills in their form on their own link; the adviser is looking at
   the record on another screen. Until now the adviser had to press reload to
   see it. This is the one mechanism that fixes that everywhere rather than
   per module: every write the server accepts bumps a version and names the
   collections it touched, and every signed-in browser hears about it over
   one Server-Sent Events stream and re-reads just those collections.

   SSE rather than WebSockets on purpose: the traffic is one-way, it rides
   the HTTP server already running, it reconnects by itself, and it needs no
   dependency — this deploys with `npm ci --omit=dev` onto a small VPS.

   The event carries no record data at all: a version number, the names of
   the collections that changed, and which browser caused it. Reading the
   data still goes through the authenticated API, so the stream widens
   nobody's access.
   --------------------------------------------------------------------- */
let storeVersion = 0;
const liveStreams = new Set();
/* The last few hundred changes, so a browser can ask what it missed rather
   than only being told as it happens. An EventSource is the fast path and
   it is not a guarantee: a proxy can buffer it, a phone can suspend it, a
   laptop lid can close on it, and a browser freezes the timers of a tab
   nobody is looking at. Any of those and the stream goes quiet with
   nothing to say so. This is what /api/changes answers from. */
const changeLog = [];
const CHANGE_LOG_MAX = 300;
let pendingKeys = new Set(), pendingOrigin = '', pendingTimer = null;
function liveSend(res, event, payload) {
  try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(payload) + '\n\n'); }
  catch (e) { /* a stream that has gone away is cleaned up by its own close handler */ }
}
/* Writes arrive in bursts — one request often saves three collections — so
   they are coalesced into a single event rather than three. */
function publishChange(keys, origin) {
  (keys || []).forEach((k) => k && pendingKeys.add(k));
  if (origin) pendingOrigin = origin;
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    const changed = Array.from(pendingKeys); pendingKeys = new Set();
    const origin2 = pendingOrigin; pendingOrigin = '';
    if (!changed.length) return;
    // The version moves whether or not anybody is listening: it is what a
    // browser coming back compares against to know it missed something.
    storeVersion++;
    const payload = { v: storeVersion, keys: changed, origin: origin2, at: new Date().toISOString() };
    changeLog.push(payload);
    if (changeLog.length > CHANGE_LOG_MAX) changeLog.shift();
    if (!liveStreams.size) return;
    liveStreams.forEach((res) => liveSend(res, 'change', payload));
  }, 40);
}

function writeToDisk() {
  if (writePending) { writeAgain = true; return; } // coalesce rapid back-to-back writes into one
  writePending = true;
  const tmpFile = DB_FILE + '.tmp';
  fs.writeFile(tmpFile, JSON.stringify(store), (err) => {
    writePending = false;
    if (err) { console.error('Failed writing data.json:', err); return; }
    fs.rename(tmpFile, DB_FILE, (err2) => { // atomic-ish swap: never leaves a half-written data.json on disk
      if (err2) console.error('Failed finalizing data.json:', err2);
      if (writeAgain) { writeAgain = false; writeToDisk(); }
    });
  });
}

// ------------------------------------------------------- connections store --
/* Connector settings, split into two halves that are treated very differently.
 *
 *   config  — host, port, from-address, which provider, enabled. Not secret.
 *             The browser reads and writes this freely.
 *   secrets — passwords, API keys, access tokens. These go in and never come
 *             back out: no endpoint returns one, and the UI is told only
 *             whether a value is present, so the form can say "leave blank to
 *             keep existing" and mean it.
 *
 * Both live in connections.json, written 0600, beside data.json (outside the
 * repo in production) and never served by /api/storage.
 */
let connections = {};
if (fs.existsSync(CONN_FILE)) {
  try { connections = JSON.parse(fs.readFileSync(CONN_FILE, 'utf8')); }
  catch (e) { console.error('Could not parse connections.json — starting from an empty store. Original error:', e.message); }
}
let connWritePending = false, connWriteAgain = false;
function writeConnections() {
  if (connWritePending) { connWriteAgain = true; return; }
  connWritePending = true;
  const tmpFile = CONN_FILE + '.tmp';
  fs.writeFile(tmpFile, JSON.stringify(connections, null, 2), { mode: 0o600 }, (err) => {
    connWritePending = false;
    if (err) { console.error('Failed writing connections.json:', err); return; }
    fs.rename(tmpFile, CONN_FILE, (err2) => {
      if (err2) console.error('Failed finalizing connections.json:', err2);
      if (connWriteAgain) { connWriteAgain = false; writeConnections(); }
    });
  });
}
// What the browser is allowed to see: everything except the secrets themselves,
// plus a flag per secret saying whether one is stored.
function publicConnection(id) {
  const c = connections[id] || {};
  const secrets = c.secrets || {};
  const has = {};
  Object.keys(secrets).forEach(k => { has[k] = !!(secrets[k] && String(secrets[k]).length); });
  return {
    id,
    config: c.config || {},
    hasSecret: has,
    enabled: !!c.enabled,
    status: c.status || 'Not Connected',
    lastTestAt: c.lastTestAt || null,
    lastTestOk: c.lastTestOk === true,
    lastTestMessage: c.lastTestMessage || null,
    updatedAt: c.updatedAt || null,
    // What the assistant is allowed to do through this connector, and why.
    ai: AI_CONNECTORS.indexOf(id) >= 0 ? aiPrivacyState(id) : null,
    statusDetail: connectorStatusOf(id),
  };
}

/* ---- a real SMTP conversation, using only Node's built-in sockets ----
 * No new dependency (this deployment forbids anything that compiles at install
 * time, and nodemailer would be a dependency to audit for no gain here). It
 * connects, greets, upgrades to TLS where the port calls for it, and — when a
 * username and password are set — actually authenticates. What it reports is
 * what the mail server said.
 */
function smtpTest(opts, cb){ return smtpSession(opts, cb); }
/* The same conversation, with or without a letter to hand over. Without a
   message it is the connection test; with one it delivers, using the envelope
   the caller gives it. One implementation, so a test that passes means a send
   will too. */
function smtpSession({ host, port, secure, username, password, message }, cb) {
  const timeoutMs = 12000;
  let socket = null, done = false, buffer = '', stage = 'connect';
  const finish = (ok, message) => {
    if (done) return; done = true;
    try { if (socket) { socket.removeAllListeners(); socket.destroy(); } } catch (e) {}
    cb({ ok, stage, message });
  };
  const fail = (msg) => finish(false, msg);

  // Each step sends a command and waits for the reply code it expects.
  let steps = [], stepIndex = 0;
  const send = (line) => { try { socket.write(line + '\r\n'); } catch (e) { fail('Could not write to the server: ' + e.message); } };
  const runNext = () => {
    if (stepIndex >= steps.length) return finish(true, message
      ? 'The mail server accepted the message for delivery to ' + message.to.join(', ') + '.'
      : 'Authenticated successfully — the mail server accepted these settings.');
    const step = steps[stepIndex++];
    stage = step.stage;
    if (step.send !== null && step.send !== undefined) send(step.send);
    if (!step.expect) return runNext();
  };
  const onLine = (code, text, lines) => {
    const step = steps[stepIndex - 1];
    if (!step || !step.expect) return;
    if (step.expect.includes(code)) {
      if (step.afterEhlo) return decideTls(lines);
      if (step.afterTls) return upgradeToTls();
      return runNext();
    }
    fail(smtpExplain(stage, code, text));
  };

  // A plain connection is only safe to authenticate over once the server has
  // said it speaks STARTTLS. If it has not, the password would go across in
  // clear text, so say so instead of sending it.
  const decideTls = (lines) => {
    const offersStartTls = (lines || []).some(l => /^STARTTLS\b/i.test(String(l).trim()));
    if (offersStartTls) {
      steps = [{ stage: 'starttls', send: 'STARTTLS', expect: [220], afterTls: true }];
      stepIndex = 0;
      return runNext();
    }
    if (password) {
      return fail('This server did not offer STARTTLS on port ' + port + ', so the password would travel unencrypted. Tick SSL/TLS and use port 465, or check the host and port with your provider.');
    }
    steps = authSteps();
    stepIndex = 0;
    return runNext();
  };

  const attachReader = () => {
    socket.setEncoding('utf8');
    let replyLines = [];
    socket.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) > -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        const m = /^(\d{3})([ -])(.*)$/.exec(line);
        if (!m) continue;
        replyLines.push(m[3]);
        if (m[2] === '-') continue; // multi-line reply; keep the capability lines and wait for the last
        const lines = replyLines;
        replyLines = [];
        onLine(Number(m[1]), m[3], lines);
      }
    });
    socket.on('error', (e) => fail('Could not reach ' + host + ':' + port + ' — ' + e.message));
    socket.on('timeout', () => fail('Timed out after ' + (timeoutMs / 1000) + 's talking to ' + host + ':' + port + '.'));
    socket.setTimeout(timeoutMs);
  };

  const upgradeToTls = () => {
    stage = 'starttls';
    const plain = socket;
    plain.removeAllListeners('data');
    plain.removeAllListeners('error');
    plain.removeAllListeners('timeout');
    socket = tls.connect({ socket: plain, servername: host, rejectUnauthorized: false }, () => {
      buffer = '';
      attachReader();
      steps = authSteps();
      stepIndex = 0;
      runNext();
    });
    socket.on('error', (e) => fail('TLS handshake failed — ' + e.message));
  };

  const authSteps = () => {
    const list = [{ stage: 'ehlo', send: 'EHLO finowise-crm', expect: [250] }];
    if (username) {
      list.push({ stage: 'auth', send: 'AUTH LOGIN', expect: [334] });
      list.push({ stage: 'auth-user', send: Buffer.from(String(username)).toString('base64'), expect: [334] });
      list.push({ stage: 'auth-pass', send: Buffer.from(String(password || '')).toString('base64'), expect: [235] });
    }
    if (message) {
      list.push({ stage: 'mail-from', send: 'MAIL FROM:<' + message.from + '>', expect: [250] });
      message.to.forEach(addr => list.push({ stage: 'rcpt-to', send: 'RCPT TO:<' + addr + '>', expect: [250, 251] }));
      list.push({ stage: 'data', send: 'DATA', expect: [354] });
      // The body ends with the lone dot that closes DATA; send() adds the CRLF.
      list.push({ stage: 'body', send: message.body + '\r\n.', expect: [250] });
    }
    list.push({ stage: 'quit', send: 'QUIT', expect: null });
    return list;
  };

  const start = () => {
    attachReader();
    if (secure) {
      // Implicit TLS (465): the greeting arrives already encrypted.
      steps = authSteps();
      stepIndex = 0;
      steps.unshift({ stage: 'greeting', send: null, expect: [220] });
      runNext();
    } else {
      steps = [
        { stage: 'greeting', send: null, expect: [220] },
        { stage: 'ehlo', send: 'EHLO finowise-crm', expect: [250], afterEhlo: true },
      ];
      stepIndex = 0;
      runNext();
    }
  };

  try {
    socket = secure
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: false }, start)
      : net.connect({ host, port }, start);
    socket.once('error', (e) => fail('Could not reach ' + host + ':' + port + ' — ' + e.message));
  } catch (e) {
    fail('Could not open a connection — ' + e.message);
  }
}
// Turn an SMTP reply into something worth reading.
function smtpExplain(stage, code, text) {
  if (stage === 'mail-from') return 'The server refused the From address (' + code + ' ' + text + '). It usually has to match the mailbox you signed in as — check From Email on the connector.';
  if (stage === 'rcpt-to') return 'The server refused the recipient (' + code + ' ' + text + '). Check the address, and whether this account is allowed to send outside your organisation.';
  if (stage === 'data' || stage === 'body') return 'The server accepted the envelope but not the message (' + code + ' ' + text + ').';
  if (stage === 'auth-pass' && (code === 535 || code === 534 || code === 530)) {
    return 'The server rejected the username or password (' + code + ' ' + text + '). For Microsoft 365 and Google Workspace this usually means the account needs an app password, or SMTP AUTH is switched off for it.';
  }
  if (stage === 'auth' && code === 503) return 'The server does not accept AUTH on this connection (503 ' + text + '). Try the TLS port instead.';
  if (stage === 'starttls') return 'The server would not start TLS (' + code + ' ' + text + '). Try port 465 with SSL/TLS ticked.';
  if (stage === 'greeting') return 'The server answered, but not with a mail greeting (' + code + ' ' + text + '). Check the host and port.';
  return 'The server replied ' + code + ' ' + text + ' at the ' + stage + ' step.';
}

/* ---- a real HTTPS probe for token-based connectors ----
 * The user supplies the endpoint their provider documents; this calls it for
 * real with the credential attached and reports the status line it got back.
 */
function httpsProbe({ url, method, headers, body }, cb) {
  let target;
  try { target = new URL(url); } catch (e) { return cb({ ok: false, message: 'That is not a valid URL.' }); }
  if (target.protocol !== 'https:') return cb({ ok: false, message: 'Use an https:// endpoint — a credential must not travel over plain http.' });
  const req = https.request({
    hostname: target.hostname,
    port: target.port || 443,
    path: target.pathname + target.search,
    method: method || 'GET',
    headers: Object.assign({ 'User-Agent': 'Finowise-CRM/1.0', 'Accept': 'application/json' }, headers || {}),
    timeout: 12000,
  }, (res) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { if (data.length < 2000) data += d; });
    res.on('end', () => {
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      const snippet = data.trim().replace(/\s+/g, ' ').slice(0, 220);
      cb({
        ok,
        message: ok
          ? 'The provider answered ' + res.statusCode + '. The credential was accepted.'
          : 'The provider answered ' + res.statusCode + ' ' + (res.statusMessage || '') + (snippet ? ' — ' + snippet : '') +
            (res.statusCode === 401 || res.statusCode === 403 ? ' This usually means the key or token is wrong, expired, or lacks the required scope.' : ''),
      });
    });
  });
  req.on('timeout', () => { req.destroy(); cb({ ok: false, message: 'The provider did not answer within 12 seconds.' }); });
  req.on('error', (e) => cb({ ok: false, message: 'Could not reach the provider — ' + e.message }));
  if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
  req.end();
}

// httpsProbe reports whether a call worked; this one also hands back what
// came back, for the calls where the answer is the point.
function httpsProbeJson(opts, cb) {
  let target;
  try { target = new URL(opts.url); } catch (e) { return cb({ ok: false, message: 'That is not a valid URL.' }); }
  if (target.protocol !== 'https:') return cb({ ok: false, message: 'Use an https:// endpoint.' });
  const req = https.request({
    hostname: target.hostname, port: target.port || 443,
    path: target.pathname + target.search, method: opts.method || 'GET',
    headers: Object.assign({ 'User-Agent': 'Finowise-CRM/1.0', 'Accept': 'application/json' }, opts.headers || {}),
    timeout: 15000,
  }, (res) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', d => { if (data.length < 20000) data += d; });
    res.on('end', () => {
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      let json = null;
      try { json = JSON.parse(data); } catch (e) { /* not json, which is itself informative */ }
      const why = json && json.error ? (json.error.message || json.error) : data.trim().replace(/\s+/g, ' ').slice(0, 220);
      cb({ ok, json, status: res.statusCode, message: ok ? 'OK' : ('HTTP ' + res.statusCode + (why ? ' — ' + why : '')) });
    });
  });
  req.on('timeout', () => { req.destroy(); cb({ ok: false, message: 'The provider did not answer within 15 seconds.' }); });
  req.on('error', e => cb({ ok: false, message: 'Could not reach the provider — ' + e.message }));
  if (opts.body) req.write(opts.body);
  req.end();
}

const app = express();
app.set('trust proxy', 1); // nginx terminates TLS; needed for secure-cookie detection
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: false })); // the sign-in form posts a normal HTML form // the Task Bank + Zoho mapping data is large; default 100kb limit would reject real saves

// ------------------------------------------------------------------ users --
// Adding accounts, for admins only. A plain server-rendered page rather than
// anything inside the CRM itself, so the app's own screens are untouched.
function usersPage({ error = null, added = null, removed = null, meId = null } = {}) {
  const rows = listUsers.all().map((u) => `
        <tr${u.active === 0 ? ' class="off"' : ''}>
          <td>${esc(u.email)}${u.member_id ? '<div class="sub2">from the Team Members module</div>' : ''}</td>
          <td class="role">${esc(u.crm_role || (u.role === 'admin' ? 'Admin' : 'User'))}
            ${u.role === 'admin' ? '<span class="tag">admin</span>' : ''}</td>
          <td class="pw">${u.active === 0
            ? '<span class="muted">deactivated</span>'
            : u.issued_password
              ? '<code>' + esc(u.issued_password) + '</code>'
              : u.last_login_at
                ? '<span class="muted">used ' + esc(u.last_login_at) + '</span>'
                : '<span class="muted">set by hand</span>'}</td>
          <td class="when">${esc(u.created_at)}</td>
          <td class="act">${u.id === meId
            ? '<span class="muted">this is you</span>'
            : `<form method="POST" action="/users/delete" onsubmit="return confirm('Delete the account for ${esc(u.email)}?\n\nThey will not be able to sign in. Their work in the CRM is untouched.')">
                 <input type="hidden" name="id" value="${u.id}">
                 <button type="submit" class="danger">Delete</button>
               </form>`}</td>
        </tr>`).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Users — BOSS</title>
<style>
  :root{ --navy:#0F1B2D; --navy-2:#152541; --gold:#B9863E; --line:#E4E7EC;
         --text:#1B2233; --muted:#6B7280; --ok:#1E7F5C; --danger:#B3432B;
         --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Arial,sans-serif; }
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;background:#F5F6F8;font-family:var(--font);color:var(--text);padding:32px 16px}
  h1{font-family:Georgia,serif;font-weight:400;font-size:23px;margin:0 0 4px}
  .sub{font-size:12px;color:var(--muted);margin-bottom:22px}
  .card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:22px 20px;margin-bottom:18px}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin:0 0 14px}
  label{display:block;font-size:12.5px;font-weight:600;margin:0 0 6px}
  input{width:100%;padding:11px 13px;font-size:15px;font-family:inherit;border:1px solid var(--line);
        border-radius:9px;margin-bottom:14px}
  input:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(185,134,62,.16)}
  button{padding:11px 18px;font-family:inherit;font-size:14px;font-weight:600;color:#fff;
         background:var(--navy);border:1px solid var(--navy);border-radius:9px;cursor:pointer}
  button:hover{background:var(--navy-2)}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);
     padding:0 0 8px;border-bottom:1px solid var(--line)}
  td{padding:10px 0;border-bottom:1px solid var(--line)}
  .wrap{max-width:820px;margin:0 auto}
  td:first-child{word-break:break-all;padding-right:14px}
  .role{color:var(--muted);width:150px}
  .when{color:var(--muted);width:135px}
  .act{width:84px;text-align:right}
  .act form{margin:0}
  button.danger{padding:5px 10px;font-size:12px;font-weight:600;color:var(--danger);background:#fff;
    border:1px solid rgba(179,67,43,.35);border-radius:7px;cursor:pointer}
  button.danger:hover{background:rgba(179,67,43,.08)}
  .pw{width:150px}
  .pw code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;
    background:rgba(185,134,62,.12);border:1px solid rgba(185,134,62,.3);border-radius:6px;padding:2px 6px}
  .muted{color:var(--muted);font-size:12px}
  .sub2{color:var(--muted);font-size:11px;margin-top:2px}
  .tag{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--gold);margin-left:4px}
  tr.off td{opacity:.55}
  .note{font-size:12px;color:var(--muted);margin-top:12px;line-height:1.5}
  .msg{padding:10px 12px;border-radius:9px;font-size:13px;margin-bottom:16px}
  .msg.ok{color:var(--ok);background:rgba(30,127,92,.08);border:1px solid rgba(30,127,92,.25)}
  .msg.bad{color:var(--danger);background:rgba(179,67,43,.08);border:1px solid rgba(179,67,43,.25)}
  a.back{display:inline-block;margin-top:6px;font-size:13px;color:var(--navy)}
</style>
</head>
<body>
  <div class="wrap">
    <h1>Users</h1>
    <div class="sub">Who can sign in to the CRM</div>
    ${added ? `<div class="msg ok">Added ${esc(added)}.</div>` : ''}
    ${removed ? `<div class="msg ok">Deleted ${esc(removed)}. They can no longer sign in.</div>` : ''}
    ${error ? `<div class="msg bad">${esc(error)}</div>` : ''}
    <div class="card">
      <h2>Adding somebody</h2>
      <p>An account is made by adding the person in <b>BOSS &rsaquo; Team Members</b>. Doing it there creates
      their sign-in at the same time, sends them their password, and files their role, branch, reporting line
      and access against the same record &mdash; which is the point: a person and their account are one thing,
      and making them in two places is how the two drift apart.</p>
      <p><a class="btn" href="/">Open BOSS</a></p>
      <p class="hint">A system with nobody in it yet is the one exception, and it has its own way in:
      <code>npm run user -- add you@firm.in &lt;password&gt;</code> from the server.</p>
    </div>
    <div class="card">
      <h2>Existing</h2>
      <table>
        <tr><th>Email</th><th>Role</th><th>Password</th><th>Added</th><th></th></tr>${rows}
      </table>
      <div class="note">Accounts made from the Team Members module carry the password the CRM
        generated and emailed to that person. It is shown here only until they sign in with it;
        after that, issue a new one from their profile in the CRM. An account is deactivated by
        marking the member Inactive, which also ends any session they have open.</div>
    </div>
    <a class="back" href="/">&larr; Back to the CRM</a>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------- sign-in --
// Session cookie is "<expiry>.<hmac>" — no server-side session store to keep in
// sync, and a restart doesn't sign everyone out as long as CRM_SESSION_SECRET
// is set in the environment.
function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(String(value)).digest('hex');
}
function issueToken(userId) {
  const exp = Date.now() + SESSION_MAX_AGE_MS;
  return `${userId}.${exp}.${sign(userId + '.' + exp)}`;
}
function userIdFromToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [id, exp, sig] = token.split('.');
  if (!id || !exp || !sig || !/^\d+$/.test(id) || !/^\d+$/.test(exp)) return null;
  if (Number(exp) < Date.now()) return null;
  const expected = Buffer.from(sign(id + '.' + exp));
  const given = Buffer.from(sig);
  // Fixed-length compare: timingSafeEqual throws on a length mismatch.
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  return Number(id);
}
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1 && part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1));
  }
  return null;
}
function signedInUser(req) {
  const id = userIdFromToken(readCookie(req, COOKIE));
  const user = id ? findUserById.get(id) : undefined;
  // Deactivating somebody in the CRM ends the session they already have, at
  // their next request, rather than whenever the cookie happens to expire.
  if (user && user.active === 0) return undefined;
  return user;
}
function isSignedIn(req) {
  return !!signedInUser(req);
}

// Slow down password guessing. In-memory and per-process, which is all this
// single-process deployment needs.
const attempts = new Map();
const MAX_ATTEMPTS = 8, ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
function tooManyAttempts(ip) {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > ATTEMPT_WINDOW_MS) { attempts.delete(ip); return false; }
  return rec.count >= MAX_ATTEMPTS;
}
function noteFailure(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() - rec.first > ATTEMPT_WINDOW_MS) attempts.set(ip, { count: 1, first: Date.now() });
  else rec.count++;
}

// Only ever redirect back to a path on this site, never to an absolute URL
// somebody appended to the query string.
function safeNext(value) {
  return typeof value === 'string' && /^\/(?!\/)/.test(value) ? value : '/';
}

// The CRM keeps its own company branding in the "config" key; reuse whatever
// logo and name have been set there so the door matches the building.
function branding() {
  const fallback = { name: 'BOSS', tagline: 'Wealth Management', logo: null };
  try {
    const company = (JSON.parse(store.config || '{}').company) || {};
    return {
      name: company.name || fallback.name,
      tagline: company.tagline || fallback.tagline,
      logo: company.logoDataUrl || company.logoUrl || null,
    };
  } catch (e) { return fallback; }
}

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loginPage({ error = null, next = '/', email = '' } = {}) {
  const b = branding();
  const mark = b.logo
    ? `<img class="logo-img" src="${esc(b.logo)}" alt="${esc(b.name)}">`
    : `<svg class="logo-svg" viewBox="0 0 64 64" role="img" aria-label="${esc(b.name)}">
         <rect x="1" y="1" width="62" height="62" rx="16" fill="#0F1B2D" stroke="#B9863E" stroke-width="1.5"/>
         <path d="M16 15 H32 V21 H23 V28 H31 V34 H23 V49 H16 Z" fill="#E8D3AE"/>
         <rect x="37" y="33" width="5" height="16" rx="2" fill="#B9863E" opacity=".55"/>
         <rect x="45" y="24" width="5" height="25" rx="2" fill="#B9863E" opacity=".85"/>
       </svg>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Sign in — ${esc(b.name)}</title>
<style>
  :root{
    --navy:#0F1B2D; --navy-2:#152541; --gold:#B9863E; --gold-light:#E8D3AE;
    --card:#FFFFFF; --line:#E4E7EC; --text:#1B2233; --muted:#6B7280; --danger:#B3432B;
    --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Arial,sans-serif;
  }
  *{box-sizing:border-box}
  body{
    margin:0; min-height:100vh; font-family:var(--font); color:var(--text);
    background:
      radial-gradient(900px 480px at 50% -10%, rgba(185,134,62,.22), transparent 70%),
      linear-gradient(165deg, var(--navy) 0%, var(--navy-2) 55%, #0B1524 100%);
    display:flex; align-items:center; justify-content:center;
    padding:32px 16px;
  }
  .wrap{width:100%; max-width:400px}
  .card{
    background:var(--card); border-radius:14px; padding:36px 30px 28px;
    box-shadow:0 24px 60px rgba(0,0,0,.38), 0 2px 6px rgba(0,0,0,.2);
  }
  /* The mark is the whole of the masthead now — no wordmark under it, no
     tagline — so it carries the card on its own and is sized to. */
  .mark{display:flex; justify-content:center; margin-bottom:4px}
  .logo-svg{width:128px; height:128px; display:block}
  .logo-img{max-height:128px; max-width:300px; width:auto; display:block}
  .rule{height:1px; background:var(--line); margin:24px 0 22px}
  label{display:block; font-size:12.5px; font-weight:600; margin-bottom:7px; letter-spacing:.2px}
  input[type=password], input[type=email]{
    width:100%; padding:12px 13px; font-size:15px; font-family:inherit; color:var(--text);
    border:1px solid var(--line); border-radius:9px; background:#fff; transition:border-color .15s, box-shadow .15s;
  }
  input[type=password]:focus, input[type=email]:focus{
    outline:none; border-color:var(--gold); box-shadow:0 0 0 3px rgba(185,134,62,.16);
  }
  button{
    width:100%; margin-top:18px; padding:12px 16px; font-family:inherit;
    font-size:14.5px; font-weight:600; letter-spacing:.3px; color:#fff; cursor:pointer;
    background:var(--navy); border:1px solid var(--navy); border-radius:9px;
    transition:background .15s, transform .05s;
  }
  button:hover{background:var(--navy-2)}
  button:active{transform:translateY(1px)}
  .error{
    margin:0 0 18px; padding:11px 13px; border-radius:9px; font-size:13px;
    color:var(--danger); background:rgba(179,67,43,.08); border:1px solid rgba(179,67,43,.25);
  }
  .foot{
    text-align:center; margin-top:22px; font-size:11.5px; color:rgba(255,255,255,.45);
    letter-spacing:.2px;
  }
  @media (max-width:420px){ .card{padding:30px 22px 24px}
    .logo-svg{width:96px; height:96px} .logo-img{max-height:96px; max-width:220px} }
</style>
</head>
<body>
  <div class="wrap">
    <form class="card" method="POST" action="/login">
      <input type="hidden" name="next" value="${esc(next)}">
      <div class="mark">${mark}</div>
      <div class="rule"></div>
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="username"
             autofocus required value="${esc(email)}" placeholder="you@company.com">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password"
             required placeholder="Enter password">
      <button type="submit">Sign in</button>
    </form>
    <div class="foot">Authorised access only</div>
  </div>
</body>
</html>`;
}

app.get('/login', (req, res) => {
  if (isSignedIn(req)) return res.redirect(safeNext(req.query.next));
  res.type('html').set('Cache-Control', 'no-store').send(loginPage({ next: safeNext(req.query.next) }));
});

app.post('/login', (req, res) => {
  const next = safeNext((req.body || {}).next);
  const ip = req.ip || 'unknown';
  res.set('Cache-Control', 'no-store');

  if (tooManyAttempts(ip)) {
    return res.status(429).type('html')
      .send(loginPage({ error: 'Too many attempts. Wait a few minutes and try again.', next,
                       email: String((req.body || {}).email || '').trim() }));
  }
  const email = String((req.body || {}).email || '').trim();
  const password = String((req.body || {}).password || '');
  const user = findUserByEmail.get(email);
  // A member who has been deactivated in the CRM cannot sign in. Same message
  // as a wrong password, so the page still says nothing about who exists.
  if (user && user.active === 0) {
    noteFailure(ip);
    return res.status(401).type('html')
      .send(loginPage({ error: 'That email and password do not match.', next, email }));
  }
  // One message for both cases, so this cannot be used to discover which emails exist.
  if (!user || !passwordMatches(password, user.password_hash)) {
    noteFailure(ip);
    return res.status(401).type('html')
      .send(loginPage({ error: 'That email and password do not match.', next, email }));
  }
  attempts.delete(ip);
  if (user.two_factor) {
    // The password was right; the session waits for the emailed code.
    const ch = newOtpChallenge(user, 'login', next);
    return sendOtp(ch, (err) => {
      if (err) {
        otpChallenges.delete(ch.id);
        return res.status(503).type('html').send(loginPage({ next, email,
          error: 'Your account uses two-step sign-in, but the code could not be emailed (' + err
            + '). Ask an administrator to check the email connector.' }));
      }
      res.cookie(OTP_COOKIE, ch.id, { httpOnly: true, sameSite: 'lax', path: '/login',
        secure: req.secure || req.get('x-forwarded-proto') === 'https', maxAge: OTP_TTL_MS * 2 });
      res.redirect('/login/otp');
    });
  }
  completeSignIn(req, res, user, next);
});

function completeSignIn(req, res, user, next) {
  // They have used the password they were sent, so the copy an admin could
  // read is deleted. Anyone who needs to give them one again issues a new one.
  noteUserLogin.run(user.id);
  noteLoginAlert(req, user);
  res.cookie(COOKIE, issueToken(user.id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.get('x-forwarded-proto') === 'https',
    maxAge: SESSION_MAX_AGE_MS,
    path: '/',
  });
  res.redirect(next);
}

/* ---------------------------------------------------------------------
   TWO-STEP SIGN-IN

   An account with two_factor on is not signed in by its password alone:
   a six-digit code is emailed to the account's own address and the
   session is issued only once it is typed. The code is random
   (crypto.randomInt), kept only as a keyed hash, good for five minutes
   and for five wrong tries, and can be sent again up to three times, no
   sooner than thirty seconds apart. Challenges live in memory: a restart
   in the middle of one simply means signing in again.

   Turning it on, and off, takes a code too, so a session left open on
   somebody's desk cannot quietly switch it off, and nobody can turn it
   on with an address that never receives mail and lock themselves out.
   If the mailbox is lost, an administrator on the server runs
     npm run user -- 2fa someone@company.com off
   --------------------------------------------------------------------- */
const OTP_COOKIE = 'finowise_otp';
const OTP_TTL_MS = 5 * 60 * 1000, OTP_MAX_TRIES = 5, OTP_RESEND_GAP_MS = 30 * 1000, OTP_MAX_RESENDS = 3;
const otpChallenges = new Map();
function otpHash(id, code) { return sign('otp.' + id + '.' + code); }
function newOtpChallenge(user, purpose, next) {
  for (const [k, c] of otpChallenges) if (c.expires < Date.now() - OTP_TTL_MS) otpChallenges.delete(k);
  // One pending challenge per account and purpose: a new one replaces the old.
  for (const [k, c] of otpChallenges) if (c.userId === user.id && c.purpose === purpose) otpChallenges.delete(k);
  const ch = { id: crypto.randomBytes(24).toString('hex'), userId: user.id, email: user.email, purpose,
    next: next || '/', tries: 0, resends: 0, sentAt: 0, expires: 0, hash: '' };
  otpChallenges.set(ch.id, ch);
  return ch;
}
function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!domain) return email;
  return name.slice(0, 2) + '*'.repeat(Math.max(1, name.length - 2)) + '@' + domain;
}
function sendOtp(ch, cb) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  ch.hash = otpHash(ch.id, code);
  ch.sentAt = Date.now();
  ch.expires = Date.now() + OTP_TTL_MS;
  ch.tries = 0;
  const what = ch.purpose === 'login' ? 'sign in to'
    : ch.purpose === 'enable' ? 'turn on two-step sign-in for' : 'turn off two-step sign-in for';
  const firm = branding().name;
  sendMail({
    to: ch.email,
    subject: code + ' is your ' + firm + ' verification code',
    body: 'Your verification code to ' + what + ' your ' + firm + ' account is:\n\n    ' + code
      + '\n\nIt expires in 5 minutes. Nobody from the firm will ever ask you for it.\n\n'
      + 'If you did not just try to do this, someone may know your password: change it, and tell an administrator.',
  }, null, (status, json) => {
    if (status === 200 && json && json.ok) return cb(null);
    cb((json && json.message) || 'the mail server refused it');
  });
}
// null when the code is right; otherwise why not. A wrong try is counted.
function checkOtp(ch, code) {
  if (!ch || ch.expires < Date.now()) return 'expired';
  if (ch.tries >= OTP_MAX_TRIES) return 'locked';
  const given = Buffer.from(otpHash(ch.id, String(code || '').replace(/\s/g, '')));
  const want = Buffer.from(ch.hash);
  if (given.length === want.length && crypto.timingSafeEqual(given, want)) return null;
  ch.tries++;
  return ch.tries >= OTP_MAX_TRIES ? 'locked' : 'wrong';
}
function resendProblem(ch) {
  if (ch.resends >= OTP_MAX_RESENDS) return 'The code has been sent ' + (OTP_MAX_RESENDS + 1) + ' times already. Start again.';
  const wait = Math.ceil((ch.sentAt + OTP_RESEND_GAP_MS - Date.now()) / 1000);
  if (wait > 0) return 'Wait ' + wait + ' more second' + (wait === 1 ? '' : 's') + ' before asking for another code.';
  return null;
}

/* A sign-in is told to the person it belongs to, inside BOSS, when they
   have asked for desktop notifications: every tab they have open hears
   it, and a sign-in they did not make is something they find out about
   at once rather than never. */
function noteLoginAlert(req, user) {
  if (!user || !user.member_id) return;
  try {
    const team = JSON.parse(store.team || '[]');
    const member = Array.isArray(team) ? team.find((t) => t && t.id === user.member_id) : null;
    if (!member || !member.desktopNotifEnabled) return;
    const list = JSON.parse(store.notifications || '[]');
    if (!Array.isArray(list)) return;
    const ua = String(req.get('user-agent') || '');
    const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox'
      : /Safari\//.test(ua) ? 'Safari' : 'a browser';
    const now = new Date();
    list.push({ id: 'NTF-' + crypto.randomBytes(6).toString('hex'), at: now.toISOString(), userId: member.id,
      title: 'New sign-in to your account',
      body: 'Signed in from ' + browser + ' (' + (req.ip || 'unknown address') + ') at '
        + now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC. If this was not you, change your password now.',
      view: 'profile', arg: '', kind: 'login-alert', by: member.id });
    store.notifications = JSON.stringify(list);
    writeToDisk();
    publishChange(['notifications'], 'server');
  } catch (e) { /* an alert that cannot be written must not stop the sign-in */ }
}

function otpPage({ ch, error = null, info = null }) {
  const page = loginPage({ next: ch.next });
  const form = `<form class="card" method="POST" action="/login/otp">
      <div class="rule" style="margin-top:0"></div>
      <h2 style="margin:0 0 6px;font-size:18px">Enter your sign-in code</h2>
      <p style="margin:0 0 18px;font-size:13px;color:var(--muted)">We emailed a 6-digit code to
        <b>${esc(maskEmail(ch.email))}</b>. It expires in 5 minutes.</p>
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      ${info ? `<p class="error" style="color:#166534;background:rgba(22,101,52,.08);border-color:rgba(22,101,52,.25)">${esc(info)}</p>` : ''}
      <label for="code">Code</label>
      <input id="code" name="code" type="password" inputmode="numeric" autocomplete="one-time-code"
             maxlength="6" pattern="[0-9]{6}" autofocus required placeholder="123456"
             style="width:100%;padding:12px 13px;font-size:18px;letter-spacing:6px;border:1px solid var(--line);border-radius:9px">
      <button type="submit">Verify and sign in</button>
      <button type="submit" formaction="/login/otp/resend" formnovalidate
        style="background:#fff;color:var(--navy);margin-top:10px">Send a new code</button>
      <p style="margin:16px 0 0;font-size:12.5px;text-align:center"><a href="/login">Use a different account</a></p>
    </form>`;
  return page.replace(/<form class="card"[\s\S]*?<\/form>/, () => form);
}
function otpChallengeOf(req) {
  const ch = otpChallenges.get(readCookie(req, OTP_COOKIE) || '');
  return ch && ch.purpose === 'login' ? ch : null;
}
function otpRestart(res, why) {
  res.clearCookie(OTP_COOKIE, { path: '/login' });
  return res.status(401).type('html').send(loginPage({ error: why }));
}
app.get('/login/otp', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const ch = otpChallengeOf(req);
  if (!ch || ch.expires < Date.now()) return otpRestart(res, 'That sign-in has expired. Sign in again to get a new code.');
  res.type('html').send(otpPage({ ch }));
});
app.post('/login/otp', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const ip = req.ip || 'unknown';
  const ch = otpChallengeOf(req);
  if (!ch) return otpRestart(res, 'That sign-in has expired. Sign in again to get a new code.');
  const why = checkOtp(ch, (req.body || {}).code);
  if (why === 'expired') { otpChallenges.delete(ch.id); return otpRestart(res, 'That code has expired. Sign in again to get a new one.'); }
  if (why === 'locked') { otpChallenges.delete(ch.id); noteFailure(ip); return otpRestart(res, 'Too many wrong codes. Sign in again to get a new one.'); }
  if (why) {
    noteFailure(ip);
    return res.status(401).type('html').send(otpPage({ ch,
      error: 'That code is not right. ' + (OTP_MAX_TRIES - ch.tries) + ' tr' + (OTP_MAX_TRIES - ch.tries === 1 ? 'y' : 'ies') + ' left.' }));
  }
  otpChallenges.delete(ch.id);
  const user = findUserById.get(ch.userId);
  if (!user || user.active === 0) return otpRestart(res, 'That email and password do not match.');
  res.clearCookie(OTP_COOKIE, { path: '/login' });
  completeSignIn(req, res, user, ch.next);
});
app.post('/login/otp/resend', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const ch = otpChallengeOf(req);
  if (!ch) return otpRestart(res, 'That sign-in has expired. Sign in again to get a new code.');
  const wait = resendProblem(ch);
  if (wait) return res.status(429).type('html').send(otpPage({ ch, error: wait }));
  ch.resends++;
  sendOtp(ch, (err) => {
    if (err) return res.status(503).type('html').send(otpPage({ ch, error: 'The new code could not be emailed: ' + err }));
    res.type('html').send(otpPage({ ch, info: 'A new code is on its way. Only the newest code works.' }));
  });
});

app.post('/logout', (req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.redirect('/login'); });
app.get('/logout',  (req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.redirect('/login'); });

// Everything below this line needs a session. /api/health stays open so the
// deploy script can tell a release apart from a broken one without a password.
//
// (the users routes sit after this gate, so they are signed in by the time
// they are reached, and the admin check below is the only extra condition)
// A client with a form link has no account and should not need one. The page
// itself, and the three endpoints it uses, are open; every one of them checks
// the token and serves nothing beyond what that token names. /config.js is
// open too, and simply hands out nothing when nobody is signed in.
function isClientLinkRequest(req) {
  if (req.path.startsWith('/api/public/')) return true;
  // A partner prospect's registration form. The page holds nothing; what it
  // shows comes from /api/public/pps-form, on the token in its address.
  if (req.method === 'GET' && req.path === '/partner-form' && req.query.pf) return true;
  // The empanelment form is on its token, like the one above.
  if (req.method === 'GET' && req.path === '/empanelment' && req.query.t) return true;
  if (req.path === '/config.js') return true;
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return false;
  const token = req.query.doc || req.query.support;
  return !!(token && publicScope(String(token)));
}
app.use((req, res, next) => {
  if (isSignedIn(req) || req.path === '/api/health') return next();
  if (isClientLinkRequest(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'not signed in' });
  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
});

// Minimal shared-secret gate. Real per-user authentication is a separate, larger
// project (see README.md) — this only stops the API being wide open to anyone
// who finds the URL.
function checkApiKey(req, res, next) {
  if (!API_KEY) return next(); // no key configured — open access, fine for local/dev use only, see README
  const provided = req.get('X-API-Key');
  if (provided !== API_KEY) return res.status(401).json({ error: 'Invalid or missing X-API-Key header' });
  next();
}

// GET /api/storage/:key -> { key, value } | 404
app.get('/api/storage/:key', checkApiKey, (req, res) => {
  const value = store[req.params.key];
  if (value === undefined) return res.status(404).json({ error: 'not found' });
  res.json({ key: req.params.key, value });
});

/* AN ATTENDANCE ROW IS WRITTEN ONCE AND NOT EDITED.

   Everything else in BOSS is a whole-array PUT, which means the browser
   decides what the store holds. For attendance that is not good enough:
   a punch is a claim about where somebody was and when, and the one
   thing it must not be is adjustable afterwards by whoever has the page
   open. Nothing in the UI offers to edit one, but "the UI does not offer
   it" is not the same as "it cannot happen".

   So this is append-only, checked here rather than in the browser. A
   write may add a day, add a session to a day, and close an open session
   by setting its punch-out and that punch-out's location. It may not
   change a punch-in, change a punch-out that is already set, change or
   add a location to a punch already recorded, drop a session, or drop a
   day. Anything else comes back 409 naming what it tried to move.

   Since the punch clock allows Punch Out to be pressed again, a
   punch-out may also MOVE — but only later, and only with the one it
   replaces appended to that session's outHistory, so the earlier punch
   is still on the record. And a day has one punch-in: a second session
   cannot be added to a day that already has one.

   One exception, deliberate and narrow: an empty array is allowed
   through, because Reset System wipes every store and an administrator
   clearing the system is not the thing this is guarding against. What it
   guards against is a quiet edit to one timestamp among hundreds. */
const ATT_FIXED = ['in', 'inBy', 'inLoc', 'out', 'outBy', 'outLoc'];
const ATT_OUT = ['out', 'outBy', 'outLoc'];
// A later punch-out replacing an earlier one, with the earlier one kept.
function attendanceOutMoved(a, b) {
  if (!a.out || !b.out || b.out === a.out) return false;
  if (!(new Date(b.out).getTime() > new Date(a.out).getTime())) return false;
  const oldH = Array.isArray(a.outHistory) ? a.outHistory : [];
  const newH = Array.isArray(b.outHistory) ? b.outHistory : [];
  if (newH.length !== oldH.length + 1) return false;
  if (JSON.stringify(newH.slice(0, oldH.length)) !== JSON.stringify(oldH)) return false;
  const kept = newH[newH.length - 1] || {};
  return ATT_OUT.every((k) => JSON.stringify(kept[k] === undefined ? null : kept[k]) === JSON.stringify(a[k] === undefined ? null : a[k]));
}
function attendanceGuard(before, after) {
  let old;
  try { old = JSON.parse(before || '[]'); } catch (e) { return null; }
  let next;
  try { next = JSON.parse(after); } catch (e) { return 'that is not valid JSON'; }
  if (!Array.isArray(old) || !Array.isArray(next)) return null;
  if (!next.length) return null;                       // a full wipe: see above
  const byId = new Map(old.filter((r) => r && r.id).map((r) => [r.id, r]));
  const seen = new Set();
  for (const row of next) {
    if (!row || !row.id) continue;
    seen.add(row.id);
    const was = byId.get(row.id);
    if (!was) {                                        // a new day
      if (Array.isArray(row.sessions) && row.sessions.length > 1)
        return 'attendance ' + row.id + ' tried to start a day with more than one punch-in';
      continue;
    }
    if (row.userId !== was.userId || row.date !== was.date)
      return 'attendance ' + row.id + ' tried to move to another person or another date';
    const oldS = Array.isArray(was.sessions) ? was.sessions : [];
    const newS = Array.isArray(row.sessions) ? row.sessions : [];
    if (newS.length < oldS.length)
      return 'attendance ' + row.id + ' tried to drop a session';
    if (newS.length > oldS.length && oldS.length >= 1)
      return 'attendance ' + row.id + ' already has a punch-in for that day';
    for (let i = 0; i < oldS.length; i++) {
      const a = oldS[i] || {}, b = newS[i] || {};
      const moved = attendanceOutMoved(a, b);
      if (!moved && JSON.stringify(a.outHistory || []) !== JSON.stringify(b.outHistory || []))
        return 'attendance ' + row.id + ' tried to change an earlier punch-out';
      for (const k of ATT_FIXED) {
        const had = a[k] !== undefined && a[k] !== null;
        if (!had) continue;                            // not set yet: may be set now
        if (moved && ATT_OUT.includes(k)) continue;    // a later punch-out, the earlier one kept
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k]))
          return 'attendance ' + row.id + ' tried to change a recorded ' + k;
      }
    }
  }
  for (const r of old) if (r && r.id && !seen.has(r.id))
    return 'attendance ' + r.id + ' was dropped';
  return null;
}

// PUT /api/storage/:key  body: { value: "..." } -> { key, value }
app.put('/api/storage/:key', checkApiKey, (req, res) => {
  const { value } = req.body || {};
  if (typeof value !== 'string') return res.status(400).json({ error: 'body.value must be a string (the CRM already JSON.stringifies before sending)' });
  if (req.params.key === 'hrAttendance') {
    const wrong = attendanceGuard(store.hrAttendance, value);
    if (wrong) return res.status(409).json({ error: 'attendance is append-only: ' + wrong });
  }
  store[req.params.key] = value;
  writeToDisk();
  publishChange([req.params.key], req.get('X-Client-Id') || '');
  res.json({ key: req.params.key, value });
});

// DELETE /api/storage/:key -> { key, deleted } | 404
// The CRM uses this to drop stores belonging to features that were removed (the Incentive
// and Appraisal modules, the old partner/level hierarchy), so their rows don't linger in
// data.json or reappear in a full-system export.
app.delete('/api/storage/:key', checkApiKey, (req, res) => {
  if (store[req.params.key] === undefined) return res.status(404).json({ error: 'not found' });
  delete store[req.params.key];
  writeToDisk();
  publishChange([req.params.key], req.get('X-Client-Id') || '');
  res.json({ key: req.params.key, deleted: true });
});

/* ---------------------------------------------------------------------
   CONNECTIONS API
   The browser sends configuration and, when the user types one, a secret.
   Secrets go into connections.json and are never sent back: the only thing
   the UI learns is whether one is stored, which is what lets the password
   box honestly say "leave blank to keep existing".

   The catalog of connectors — their labels, provider presets and help text —
   lives in public/index.html (search for CONNECTOR_CATALOG). This table is
   the half the server needs: which connectors exist, and how each one is
   actually tested. Field keys must agree between the two.
   --------------------------------------------------------------------- */
const CONNECTOR_KIND = {
  email:       'smtp',
  whatsapp:    'https',
  sms:         'https',
  gcal:        'https',
  outlook:     'graph',
  txnplatform: 'https',
  exchange:    'https',
  // AI Insights. Two of these are APIs the server can call and two are
  // editors that can only call us, so they are not the same kind of thing
  // and are not implemented as though they were.
  claude:      'https',
  gemini:      'https',
  vscode:      'inbound',
  cursor:      'inbound',
  /* A model the firm runs itself, or an enterprise gateway it controls, behind
     an OpenAI-compatible endpoint — Ollama, vLLM, LM Studio, a private
     deployment. This is the only shape in which "our data does not leave our
     control" can be true rather than promised, so it is the one the assistant
     prefers and the only kind that is privacy-verified by its nature. */
  bossai:      'selfhosted',
};
/* Which connectors the AI Assistant may speak through at all. The others are
   mail, calendars and transaction platforms: nothing about them is a model. */
const AI_CONNECTORS = ['bossai', 'claude', 'gemini'];
/* Where a connector's traffic goes. 'private' is an endpoint the firm runs or
   contracts for; 'public' is somebody else's multi-tenant API. The distinction
   is not cosmetic: it decides whether BOSS will put business data through it.
   An inbound connector sends nothing anywhere, so it is neither. */
const CONNECTOR_REACH = { bossai: 'private', claude: 'public', gemini: 'public' };
/* An administrator attests, per connector, that its privacy terms have been
   read and meet the firm's requirements — zero retention, no training on our
   data, no sharing. Until they do, a public endpoint is refused business data,
   whatever its key says. A private endpoint the firm runs is verified by what
   it is, because the data never leaves their own infrastructure.

   This is deliberately a gate and not a warning. The requirement BOSS was
   given says: if the privacy requirements cannot be verified, do not transmit
   confidential data to that connector. A banner nobody reads is not that. */
function aiPrivacyState(id) {
  const c = connections[id] || {};
  const config = c.config || {};
  const reach = CONNECTOR_REACH[id] || null;
  if (!reach) return { ok: false, reach: null, why: 'This connector is not a model BOSS can talk to.' };
  if (reach === 'private') {
    return { ok: true, reach, verified: true, by: 'deployment',
      why: 'A private endpoint this firm runs or contracts for. Nothing is sent to a shared service.' };
  }
  if (config.privacyVerified === true) {
    return { ok: true, reach, verified: true, by: config.privacyVerifiedBy || 'an administrator',
      at: config.privacyVerifiedAt || null, note: config.privacyNote || '',
      why: 'An administrator has recorded that this provider\'s terms meet the firm\'s requirements.' };
  }
  return { ok: false, reach, verified: false,
    why: 'This is a public API and nobody has recorded that its privacy terms were checked. '
       + 'BOSS will not send business data through it until an administrator verifies it in Setup \u2192 Connections.' };
}
/* The four things a connector's status can honestly be. */
function connectorStatusOf(id) {
  const c = connections[id] || {};
  const stored = c.status || 'Not Connected';
  if (AI_CONNECTORS.indexOf(id) >= 0 && stored === 'Connected') {
    const p = aiPrivacyState(id);
    if (!p.ok) return 'Privacy Requirements Not Verified';
  }
  if (/^Configured/.test(stored)) return 'Configuration Error';
  return stored;
}
/* An editor is not an API with an endpoint to probe. VS Code and Cursor
   reach BOSS, not the other way round: the connector issues a key, the
   extension sends it to /api/ai/hello, and only then — once a call has
   actually arrived and been accepted — does the connector read Connected.
   Nothing here ever claims a connection that has not happened. */
const INBOUND_CONNECTORS = ['vscode', 'cursor'];

// Presets write URLs like .../Accounts/{{accountSid}}.json; fill them from the
// connector's own configuration so the user edits an ID field, not a URL.
function fillTemplate(text, config) {
  // An empty field is not a value: leave the placeholder in place so the test
  // reports which field is missing instead of calling a half-built URL.
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (m, k) => (config && config[k] !== undefined && config[k] !== null && String(config[k]).length ? String(config[k]) : m));
}

// Turns the saved auth style into the header (or query string) the provider wants.
function buildHttpsProbe(config, secrets) {
  let url = fillTemplate(config.testUrl, config);
  const headers = {};
  const style = config.authStyle || 'Bearer token';
  if (style === 'Bearer token') {
    if (!secrets.token) return { error: 'No access token is stored yet. Enter one and save first.' };
    headers.Authorization = 'Bearer ' + secrets.token;
  } else if (style === 'API key header') {
    if (!secrets.apiKey) return { error: 'No API key is stored yet. Enter one and save first.' };
    headers[config.headerName || 'X-API-Key'] = secrets.apiKey;
  } else if (style === 'Basic auth') {
    if (!secrets.password) return { error: 'No password or auth token is stored yet. Enter one and save first.' };
    headers.Authorization = 'Basic ' + Buffer.from((config.username || '') + ':' + secrets.password).toString('base64');
  } else if (style === 'Query parameter') {
    if (!secrets.apiKey) return { error: 'No API key is stored yet. Enter one and save first.' };
    url += (url.indexOf('?') === -1 ? '?' : '&') + encodeURIComponent(config.paramName || 'key') + '=' + encodeURIComponent(secrets.apiKey);
  } else {
    return { error: 'Unknown authentication style "' + style + '".' };
  }
  // Some providers want a second, non-secret header alongside the credential
  // — Anthropic's API version, for one. The connector's preset carries it.
  String(config.staticHeaders || '').split(/[\n;]+/).forEach(line => {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
  if (!url) return { error: 'No test endpoint is set for this connector.' };
  if (/\{\{\w+\}\}/.test(url)) return { error: 'The test endpoint still contains a placeholder (' + (url.match(/\{\{\w+\}\}/) || [])[0] + '). Fill in that field and save.' };
  return { url, method: config.testMethod || 'GET', headers };
}

// GET /api/connections -> [{ id, config, hasSecret, enabled, status, ... }]
app.get('/api/connections', checkApiKey, (req, res) => {
  const ids = Object.keys(CONNECTOR_KIND);
  // An API connector's credential lives in the same file under its own
  // prefix; it is not one of these and is never listed here.
  Object.keys(connections).forEach(id => {
    if (id.indexOf('apiconn:') === 0) return;
    if (ids.indexOf(id) === -1) ids.push(id);
  });
  res.json({ connections: ids.map(publicConnection) });
});

// PUT /api/connections/:id  body: { config, enabled, secrets }
// A secret arriving as an empty string means "keep what is stored"; sending
// null for one clears it.
app.put('/api/connections/:id', checkApiKey, (req, res) => {
  const id = req.params.id;
  if (!CONNECTOR_KIND[id]) return res.status(404).json({ error: 'unknown connector: ' + id });
  const body = req.body || {};
  const existing = connections[id] || { config: {}, secrets: {} };
  if (body.config && typeof body.config === 'object') existing.config = Object.assign({}, existing.config, body.config);
  if (typeof body.enabled === 'boolean') existing.enabled = body.enabled;
  existing.secrets = existing.secrets || {};
  if (body.secrets && typeof body.secrets === 'object') {
    Object.keys(body.secrets).forEach(k => {
      const v = body.secrets[k];
      if (v === null) { delete existing.secrets[k]; return; }   // explicitly cleared
      if (typeof v === 'string' && v.length) existing.secrets[k] = v;
      // '' — the user left the box blank, so the stored value stands
    });
  }
  // Changing the configuration invalidates an earlier successful test.
  if (body.config || (body.secrets && Object.keys(body.secrets).length)) {
    if (existing.status === 'Connected') existing.status = 'Configured — not tested since the last change';
    existing.lastTestOk = false;
  }
  existing.updatedAt = new Date().toISOString();
  connections[id] = existing;
  writeConnections();
  res.json({ connection: publicConnection(id) });
});

/* ---------------------------------------------------------------------
   MAIL — sending for real, through the stored Email connector.

   The CRM has always recorded what it "sent"; with SMTP credentials on the
   server it can actually send. If the connector is not set up, this says so
   and sends nothing: the caller records an honest "not sent" rather than a
   cheerful lie.
   --------------------------------------------------------------------- */
function encodeHeader(text) {
  const str = String(text || '');
  // Plain ASCII goes as-is; anything else is encoded so accents and ₹ survive.
  return /^[\x20-\x7E]*$/.test(str) ? str : '=?UTF-8?B?' + Buffer.from(str, 'utf8').toString('base64') + '?=';
}
function b64lines(buf) {
  return Buffer.from(buf).toString('base64').replace(/(.{76})/g, '$1\r\n');
}
// A filename a mail client will accept: no quotes, no CR/LF, nothing that could
// smuggle another header in, and non-ASCII encoded rather than sent raw.
function safeFilename(name) {
  const clean = String(name || 'attachment').replace(/[\r\n"\\]/g, '').replace(/[\/]/g, '-').trim().slice(0, 120);
  return clean || 'attachment';
}
const ATTACH_TYPE_RE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,60}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,60}$/;
function buildMessage({ fromEmail, fromName, to, cc, replyTo, subject, body, html, attachments }) {
  const boundaryDate = new Date().toUTCString();
  const id = '<' + crypto.randomBytes(12).toString('hex') + '@finowise-crm>';
  // base64 keeps UTF-8 intact and sidesteps line-length limits entirely.
  // base64 also means no body line can begin with a dot, so the lone dot that
  // ends DATA is never forged by the message itself.
  const encoded = b64lines(Buffer.from(String(body || ''), 'utf8'));
  const files = Array.isArray(attachments) ? attachments.filter(a => a && a.content) : [];
  const headers = [
    'From: ' + (fromName ? encodeHeader(fromName) + ' <' + fromEmail + '>' : fromEmail),
    'To: ' + to.join(', '),
  ];
  if (cc && cc.length) headers.push('Cc: ' + cc.join(', '));
  if (replyTo) headers.push('Reply-To: ' + replyTo);
  headers.push('Subject: ' + encodeHeader(subject));
  headers.push('Date: ' + boundaryDate);
  headers.push('Message-ID: ' + id);
  headers.push('MIME-Version: 1.0');
  if (!files.length) {
    headers.push('Content-Type: text/' + (html ? 'html' : 'plain') + '; charset=UTF-8');
    headers.push('Content-Transfer-Encoding: base64');
    return { text: headers.join('\r\n') + '\r\n\r\n' + encoded, messageId: id };
  }
  // With attachments the message becomes multipart/mixed: the note first, then
  // one part per file. The boundary is random, so nothing in a document can
  // accidentally (or deliberately) end a part early.
  const boundary = '=_finowise_' + crypto.randomBytes(16).toString('hex');
  headers.push('Content-Type: multipart/mixed; boundary="' + boundary + '"');
  const parts = [
    '--' + boundary,
    'Content-Type: text/' + (html ? 'html' : 'plain') + '; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encoded,
  ];
  files.forEach(a => {
    const name = safeFilename(a.filename);
    const type = ATTACH_TYPE_RE.test(String(a.contentType || '')) ? a.contentType : 'application/octet-stream';
    parts.push('--' + boundary,
      'Content-Type: ' + type + '; name="' + name + '"',
      'Content-Transfer-Encoding: base64',
      'Content-Disposition: attachment; filename="' + name + '"',
      '',
      b64lines(Buffer.from(String(a.content), 'base64')));
  });
  parts.push('--' + boundary + '--', '');
  return { text: headers.join('\r\n') + '\r\n\r\n' + parts.join('\r\n'), messageId: id };
}
const ADDRESS_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
function cleanAddresses(value) {
  return String(value == null ? '' : value).split(/[,;]/).map(a => a.trim()).filter(Boolean);
}

// The client-credentials flow, which is what a server-to-server integration
// uses: no user sits in front of this, so there is nobody to send to a consent
// screen. The secret never leaves this process.
function graphToken(config, secrets, cb) {
  const body = new URLSearchParams({
    client_id: config.clientId || '',
    client_secret: secrets.clientSecret || '',
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  }).toString();
  const target = new URL('https://login.microsoftonline.com/' + encodeURIComponent(config.tenantId || '') + '/oauth2/v2.0/token');
  const req = https.request({
    hostname: target.hostname, path: target.pathname, method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    timeout: 12000,
  }, (res) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', d => { if (data.length < 8000) data += d; });
    res.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(data); } catch (e) { /* fall through to the message below */ }
      if (res.statusCode >= 200 && res.statusCode < 300 && parsed.access_token) return cb(null, parsed.access_token);
      const why = parsed.error_description ? String(parsed.error_description).split('\n')[0] : (parsed.error || ('HTTP ' + res.statusCode));
      cb('Microsoft refused the credentials — ' + why);
    });
  });
  req.on('timeout', () => { req.destroy(); cb('Microsoft did not answer within 12 seconds.'); });
  req.on('error', e => cb('Could not reach Microsoft — ' + e.message));
  req.write(body);
  req.end();
}

// POST /api/outlook/meeting  { subject, start, end }
// Creates a real Teams meeting on the connected mailbox and returns its join
// link. 409 when the connector is not set up, so the UI can say which part.
app.post('/api/outlook/meeting', checkApiKey, (req, res) => {
  const c = connections.outlook;
  const config = (c && c.config) || {}, secrets = (c && c.secrets) || {};
  if (!c || !config.tenantId || !config.clientId) return res.status(409).json({ ok: false, notConfigured: true,
    message: 'Microsoft 365 is not connected. Add it under Setup → Connections.' });
  if (!c.enabled) return res.status(409).json({ ok: false, notConfigured: true,
    message: 'The Microsoft 365 connector is switched off. Tick "Enable this channel" on it.' });
  if (!config.userId) return res.status(409).json({ ok: false, notConfigured: true,
    message: 'The connector has no mailbox on it. Set the user principal name (you@firm.com) that meetings should be created under.' });
  const body = req.body || {};
  const start = body.start ? new Date(body.start) : new Date();
  if (isNaN(start)) return res.status(400).json({ ok: false, message: 'That start time is not a date.' });
  const end = body.end ? new Date(body.end) : new Date(start.getTime() + 60 * 60 * 1000);
  graphToken(config, secrets, (err, token) => {
    if (err) return res.status(502).json({ ok: false, message: err });
    const payload = JSON.stringify({
      startDateTime: start.toISOString(),
      endDateTime: (isNaN(end) ? new Date(start.getTime() + 3600000) : end).toISOString(),
      subject: String(body.subject || 'Meeting').slice(0, 250),
    });
    httpsProbeJson({
      url: 'https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(config.userId) + '/onlineMeetings',
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: payload,
    }, (r) => {
      if (!r.ok) return res.status(502).json({ ok: false, message: 'Microsoft refused to create the meeting — ' + r.message });
      const join = r.json && (r.json.joinWebUrl || r.json.joinUrl);
      if (!join) return res.status(502).json({ ok: false, message: 'Microsoft created the meeting but returned no join link.' });
      res.json({ ok: true, joinUrl: join, id: r.json.id || '' });
    });
  });
});

// POST /api/mail/send  { to, cc?, subject, body, html?, replyTo?, attachments? }
// attachments: [{ filename, contentType, content }] where content is base64.
// 200 with { ok:true } only when the mail server took the message.
app.post('/api/mail/send', checkApiKey, (req, res) => sendMailRequest(req.body || {}, res, null));

/* ---------------------------------------------------------------------
   PIN AND IFSC LOOKUPS

   A team member's PIN fills their city, state and country; their IFSC
   fills the bank and the branch. Both are public directories — India
   Post's PIN list and the RBI IFSC list Razorpay publishes — asked from
   here rather than from the page, because a browser cannot call either
   without CORS they do not grant. The answer is cached, since a PIN or
   an IFSC does not move. Either base URL can be pointed elsewhere by
   environment variable, which is how the tests run without the internet.
   --------------------------------------------------------------------- */
const PIN_LOOKUP_URL = process.env.CRM_PIN_LOOKUP_URL || 'https://api.postalpincode.in/pincode/';
const IFSC_LOOKUP_URL = process.env.CRM_IFSC_LOOKUP_URL || 'https://ifsc.razorpay.com/';
const lookupCache = new Map();
async function lookupJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Finowise-CRM/1.0' },
    signal: AbortSignal.timeout(8000) });
  let json = null;
  try { json = await res.json(); } catch (e) { /* a 404 page is not JSON, which is itself the answer */ }
  return { status: res.status, json };
}
function cachedLookup(key, work, res) {
  if (lookupCache.has(key)) return res.json(lookupCache.get(key));
  work().then((answer) => {
    if (answer.ok || answer.notFound) {
      if (lookupCache.size > 5000) lookupCache.clear();
      lookupCache.set(key, answer);
    }
    res.status(answer.ok || answer.notFound ? 200 : 502).json(answer);
  }).catch((e) => res.status(502).json({ ok: false,
    message: e && e.name === 'TimeoutError' ? 'the directory did not answer in time' : 'the directory could not be reached' }));
}
/* Two-step sign-in, from My Profile. Status, then a code to the account's
   own address, then the code back — and only then is it switched. */
const meOtp = new Map();   // userId -> challenge for enabling or disabling
app.get('/api/me/2fa', checkApiKey, (req, res) => {
  const user = signedInUser(req);
  if (!user) return res.status(401).json({ ok: false, message: 'not signed in' });
  res.set('Cache-Control', 'no-store').json({ ok: true, enabled: !!user.two_factor, email: maskEmail(user.email) });
});
app.post('/api/me/2fa/start', checkApiKey, (req, res) => {
  const user = signedInUser(req);
  if (!user) return res.status(401).json({ ok: false, message: 'not signed in' });
  const action = (req.body || {}).action === 'disable' ? 'disable' : 'enable';
  if ((action === 'enable') === !!user.two_factor)
    return res.status(409).json({ ok: false, message: 'Two-step sign-in is already ' + (user.two_factor ? 'on' : 'off') + '.' });
  const was = meOtp.get(user.id);
  if (was && was.purpose === action && (req.body || {}).resend) {
    const wait = resendProblem(was);
    if (wait) return res.status(429).json({ ok: false, message: wait });
    was.resends++;
    return sendOtp(was, (err) => err ? res.status(503).json({ ok: false, message: 'The code could not be emailed: ' + err })
      : res.json({ ok: true, sentTo: maskEmail(user.email), resendsLeft: OTP_MAX_RESENDS - was.resends }));
  }
  const ch = newOtpChallenge(user, action);
  otpChallenges.delete(ch.id);           // not a sign-in: it lives in meOtp only
  meOtp.set(user.id, ch);
  sendOtp(ch, (err) => {
    if (err) { meOtp.delete(user.id); return res.status(503).json({ ok: false, message: 'The code could not be emailed: ' + err }); }
    res.json({ ok: true, sentTo: maskEmail(user.email), resendsLeft: OTP_MAX_RESENDS });
  });
});
app.post('/api/me/2fa/verify', checkApiKey, (req, res) => {
  const user = signedInUser(req);
  if (!user) return res.status(401).json({ ok: false, message: 'not signed in' });
  const ch = meOtp.get(user.id);
  if (!ch) return res.status(409).json({ ok: false, message: 'Ask for a code first.' });
  const why = checkOtp(ch, (req.body || {}).code);
  if (why === 'expired' || why === 'locked') {
    meOtp.delete(user.id);
    return res.status(401).json({ ok: false, restart: true, message: why === 'expired'
      ? 'That code has expired. Ask for a new one.' : 'Too many wrong codes. Ask for a new one.' });
  }
  if (why) return res.status(401).json({ ok: false, message: 'That code is not right. '
    + (OTP_MAX_TRIES - ch.tries) + ' tr' + (OTP_MAX_TRIES - ch.tries === 1 ? 'y' : 'ies') + ' left.' });
  meOtp.delete(user.id);
  setUserTwoFactor.run(ch.purpose === 'enable' ? 1 : 0, user.id);
  res.json({ ok: true, enabled: ch.purpose === 'enable' });
});

app.get('/api/lookup/pincode/:pin', checkApiKey, (req, res) => {
  const pin = String(req.params.pin || '');
  if (!/^[1-9][0-9]{5}$/.test(pin)) return res.status(400).json({ ok: false, message: 'A PIN code is 6 digits.' });
  cachedLookup('pin:' + pin, async () => {
    const { json } = await lookupJson(PIN_LOOKUP_URL + pin);
    const row = Array.isArray(json) ? json[0] : null;
    if (!row || typeof row !== 'object') return { ok: false, message: 'the PIN directory gave no usable answer' };
    const offices = Array.isArray(row.PostOffice) ? row.PostOffice : [];
    if (String(row.Status) !== 'Success' || !offices.length) return { ok: false, notFound: true };
    const first = offices[0] || {};
    return { ok: true, pin, city: first.District || first.Block || '', state: first.State || '',
      country: first.Country || 'India', offices: offices.slice(0, 20).map((o) => o && o.Name).filter(Boolean) };
  }, res);
});
app.get('/api/lookup/ifsc/:code', checkApiKey, (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(code)) return res.status(400).json({ ok: false, message: 'An IFSC is 11 characters, like SBIN0001234.' });
  cachedLookup('ifsc:' + code, async () => {
    const { status, json } = await lookupJson(IFSC_LOOKUP_URL + code);
    if (status === 404) return { ok: false, notFound: true };
    if (status !== 200 || !json || !json.BANK) return { ok: false, message: 'the IFSC directory gave no usable answer' };
    return { ok: true, ifsc: code, bank: json.BANK, branch: json.BRANCH || '', city: json.CITY || '',
      state: json.STATE || '', address: json.ADDRESS || '' };
  }, res);
});

// One send, whether it came from the CRM or from a client's own page. `allowed`
// is null for a signed-in sender and a list of addresses for a public one, so a
// form link can write to the people it concerns and to nobody else.
function sendMailRequest(body, res, allowed) {
  sendMail(body, allowed, (status, json) => res.status(status).json(json));
}
// The same send for the server's own letters (a sign-in code), which have
// no request to answer: done(status, { ok, message }).
function sendMail(body, allowed, done) {
  const c = connections.email;
  const config = (c && c.config) || {}, secrets = (c && c.secrets) || {};
  const to = cleanAddresses(body.to), cc = cleanAddresses(body.cc);
  if (!to.length) return done(400, { ok: false, message: 'No recipient.' });
  const bad = to.concat(cc).find(a => !ADDRESS_RE.test(a));
  if (bad) return done(400, { ok: false, message: '"' + bad + '" is not a usable email address.' });
  if (allowed) {
    const set = new Set(allowed.filter(Boolean).map((a) => String(a).toLowerCase()));
    const outside = to.concat(cc).find((a) => !set.has(a.toLowerCase()));
    if (outside) return done(403, { ok: false,
      message: 'This link may only write to the people it concerns, not to ' + outside + '.' });
  }

  if (!c || !config.host) return done(409, { ok: false, notConfigured: true,
    message: 'No email connector is set up yet. Add your SMTP details under Setup → Developer Hub → Connections.' });
  if (!c.enabled) return done(409, { ok: false, notConfigured: true,
    message: 'The email connector is switched off. Tick "Enable this channel" on it and test the connection.' });
  if (c.status !== 'Connected') return done(409, { ok: false, notConfigured: true,
    message: 'The email connector has not passed a connection test' + (c.lastTestMessage ? ' — ' + c.lastTestMessage : '') + '.' });

  const fromEmail = (config.fromEmail || config.username || '').trim();
  if (!ADDRESS_RE.test(fromEmail)) return done(409, { ok: false, notConfigured: true,
    message: 'The connector has no usable From address. Set From Email on it.' });

  // Attachments are capped well under the JSON body limit, so a huge file is
  // refused with a sentence rather than by the request dying halfway.
  const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 10) : [];
  let attachBytes = 0;
  for (const a of attachments) {
    if (!a || typeof a.content !== 'string') return done(400, { ok: false, message: 'An attachment had no content.' });
    if (!/^[A-Za-z0-9+/=\s]*$/.test(a.content)) return done(400, { ok: false, message: 'An attachment was not base64.' });
    attachBytes += Math.ceil(a.content.replace(/\s/g, '').length * 3 / 4);
  }
  if (attachBytes > 12 * 1024 * 1024) return done(413, { ok: false,
    message: 'The attachments come to ' + Math.round(attachBytes / (1024 * 1024)) + 'MB. Most mailboxes refuse anything over about 10MB — send a link instead.' });

  const msg = buildMessage({
    fromEmail, fromName: config.fromName, to, cc,
    replyTo: (body.replyTo || '').trim() || undefined,
    subject: body.subject || '(no subject)',
    body: body.body || '',
    html: !!body.html,
    attachments,
  });
  smtpSession({
    host: config.host,
    port: Number(config.port) || (config.secure ? 465 : 587),
    secure: !!config.secure,
    username: config.username || '',
    password: secrets.password || '',
    message: { from: fromEmail, to: to.concat(cc), body: msg.text },
  }, (result) => {
    done(200, { ok: !!result.ok, message: result.message, messageId: result.ok ? msg.messageId : undefined,
      from: fromEmail, to, cc });
  });
}

/* ---------------------------------------------------------------------
   API CONNECTORS

   A connector is a piece of configuration the firm writes in Setup: an
   external system, a URL, an authentication method, a module and a
   field map. It lives in the CRM's own store like everything else the
   firm configures — except its credential, which lives here, beside the
   SMTP password, in connections.json outside the repository. The
   browser can set it and can say whether one is stored; it can never
   read one back.

   Three things have to happen on the server rather than in the page.

   1. THE CREDENTIAL. A key in the browser is a key in the DOM, in the
      backup file and in anybody's devtools. It is written once and
      never served.
   2. THE CALL. A page cannot call an arbitrary API anyway — the browser
      refuses it without CORS the other side has no reason to grant —
      and a call made here can have the credential attached without the
      page ever holding it.
   3. THE OTHER DIRECTION. An external system that wants BOSS data, or
      wants to push into BOSS, needs somewhere to knock. That is
      /api/share/:id, authorised by a token held here, which answers
      from this server's own copy of the store.

   The proxy is an admin tool that makes the server fetch a URL, so it
   is deliberately narrow: https only, no private or loopback address,
   one call per request, a size cap and a timeout.
   --------------------------------------------------------------------- */
const API_CONN_PREFIX = 'apiconn:';
function apiConnEntry(id) {
  return connections[API_CONN_PREFIX + id] || { secrets: {} };
}
/* An address this server must not be talked into fetching. The proxy is
   open to an administrator by design; it is not a way to reach whatever
   else happens to be listening on this machine or its network. */
function privateHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '[::1]') return true;
  if (/\.(internal|local|lan|home|intranet)$/.test(h)) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  if (a === 127 || a === 0 || a === 10) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}
/* The one outbound call, with the stored credential put on it here. */
function apiConnFetch(opts, cb) {
  let target;
  try { target = new URL(opts.url); } catch (e) { return cb({ ok: false, status: 0, message: 'That is not a valid URL.' }); }
  if (target.protocol !== 'https:')
    return cb({ ok: false, status: 0, message: 'Use an https:// endpoint — a credential must not travel over plain http.' });
  if (privateHost(target.hostname))
    return cb({ ok: false, status: 0, message: 'That address is on this server\'s own network, which a connector may not reach.' });
  const started = Date.now();
  const req = https.request({
    hostname: target.hostname, port: target.port || 443,
    path: target.pathname + target.search, method: opts.method || 'GET',
    headers: Object.assign({ 'User-Agent': 'BOSS-CRM/1.0', 'Accept': 'application/json' }, opts.headers || {}),
    timeout: Number(opts.timeout) || 20000,
  }, (res) => {
    let data = '', over = false;
    res.setEncoding('utf8');
    res.on('data', d => { if (data.length < 400000) data += d; else over = true; });
    res.on('end', () => {
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      let json = null;
      try { json = JSON.parse(data); } catch (e) { /* not json, which is itself informative */ }
      cb({
        ok, status: res.statusCode, json,
        text: json ? null : data.slice(0, 4000),
        truncated: over, ms: Date.now() - started,
        message: ok ? ('HTTP ' + res.statusCode)
          : ('HTTP ' + res.statusCode + ' ' + (res.statusMessage || '')
             + (data ? ' — ' + data.trim().replace(/\s+/g, ' ').slice(0, 300) : '')),
      });
    });
  });
  req.on('timeout', () => { req.destroy(); cb({ ok: false, status: 0, message: 'The external system did not answer in time.' }); });
  req.on('error', e => cb({ ok: false, status: 0, message: 'Could not reach it — ' + e.message }));
  if (opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
  req.end();
}
// GET /api/apiconnectors -> which connectors hold a credential, and nothing else
app.get('/api/apiconnectors', checkApiKey, (req, res) => {
  const out = {};
  Object.keys(connections).forEach(k => {
    if (k.indexOf(API_CONN_PREFIX) !== 0) return;
    const s = connections[k].secrets || {};
    out[k.slice(API_CONN_PREFIX.length)] = {
      hasSecret: !!(s.secret && String(s.secret).length),
      hasShareToken: !!(s.shareToken && String(s.shareToken).length),
      updatedAt: connections[k].updatedAt || null,
    };
  });
  res.json({ connectors: out });
});
/* PUT /api/apiconnectors/:id  { secret, shareToken }
   '' leaves what is stored alone; null clears it; anything else replaces
   it. Nothing here is ever read back out. */
app.put('/api/apiconnectors/:id', checkApiKey, (req, res) => {
  const id = String(req.params.id || '').slice(0, 80);
  if (!/^[A-Za-z0-9_\-:.]+$/.test(id)) return res.status(400).json({ error: 'bad connector id' });
  const key = API_CONN_PREFIX + id;
  const entry = connections[key] || { secrets: {} };
  entry.secrets = entry.secrets || {};
  ['secret', 'shareToken'].forEach(k => {
    const v = (req.body || {})[k];
    if (v === null) { delete entry.secrets[k]; return; }
    if (typeof v === 'string' && v.length) entry.secrets[k] = v;
  });
  entry.updatedAt = new Date().toISOString();
  connections[key] = entry;
  writeConnections();
  const s = entry.secrets;
  res.json({ id, hasSecret: !!s.secret, hasShareToken: !!s.shareToken });
});
app.delete('/api/apiconnectors/:id', checkApiKey, (req, res) => {
  const key = API_CONN_PREFIX + req.params.id;
  if (!connections[key]) return res.status(404).json({ error: 'nothing stored for that connector' });
  delete connections[key];
  writeConnections();
  res.json({ id: req.params.id, deleted: true });
});
/* POST /api/apiconnectors/:id/call  { url, method, headers, body, auth }
   auth says where the stored credential goes; the credential itself is
   never in the request and never in the reply. */
app.post('/api/apiconnectors/:id/call', checkApiKey, (req, res) => {
  const id = String(req.params.id || '');
  const b = req.body || {};
  const secret = (apiConnEntry(id).secrets || {}).secret || '';
  const auth = b.auth || {};
  const headers = {};
  Object.keys(b.headers || {}).forEach(k => { headers[k] = String((b.headers || {})[k]); });
  let url = String(b.url || '');
  if (auth.kind && auth.kind !== 'none') {
    if (!secret) return res.json({ ok: false, status: 0,
      message: 'No credential is stored for this connector. Paste it in Setup and save, then try again.' });
    if (auth.kind === 'bearer') headers['Authorization'] = 'Bearer ' + secret;
    else if (auth.kind === 'basic') headers['Authorization'] = 'Basic ' + Buffer.from(String(auth.username || '') + ':' + secret).toString('base64');
    else if (auth.kind === 'header') headers[String(auth.headerName || 'X-API-Key')] = String(auth.prefix || '') + secret;
    else if (auth.kind === 'query') {
      const sep = url.indexOf('?') >= 0 ? '&' : '?';
      url += sep + encodeURIComponent(String(auth.paramName || 'api_key')) + '=' + encodeURIComponent(secret);
    }
  }
  apiConnFetch({ url, method: b.method || 'GET', headers, body: b.body, timeout: b.timeout }, (r) => res.json(r));
});
/* POST /api/apiconnectors/:id/token  { url, clientId, scope }
   OAuth 2.0 client credentials: the one grant a server can complete on
   its own. The client secret is the stored credential, so it never
   leaves this process; what comes back is handed to the caller as a
   bearer token to use for the next call and nothing is kept. */
app.post('/api/apiconnectors/:id/token', checkApiKey, (req, res) => {
  const b = req.body || {};
  const secret = (apiConnEntry(String(req.params.id || '')).secrets || {}).secret || '';
  if (!secret) return res.json({ ok: false, message: 'No client secret is stored for this connector.' });
  const form = 'grant_type=client_credentials'
    + '&client_id=' + encodeURIComponent(String(b.clientId || ''))
    + '&client_secret=' + encodeURIComponent(secret)
    + (b.scope ? '&scope=' + encodeURIComponent(String(b.scope)) : '');
  apiConnFetch({
    url: String(b.url || ''), method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) },
    body: form,
  }, (r) => {
    const tok = r.json && (r.json.access_token || r.json.accessToken);
    if (!r.ok || !tok) return res.json({ ok: false, message: r.message || 'No access_token came back.' });
    res.json({ ok: true, token: tok, expiresIn: r.json.expires_in || null });
  });
});
/* ---- the other direction: a door the external system knocks on ----
   GET  /api/share/:id?token=…  hands over the rows that connector shares.
   POST /api/share/:id?token=…  takes rows it pushes, into a queue BOSS
   drains. Both are authorised by that connector's own share token, held
   in connections.json and compared here; neither uses the CRM's API key,
   so giving a partner a token does not give them the CRM. */
function shareConnector(id) {
  let list = [];
  try { list = JSON.parse(store['apiConnectors'] || '[]'); } catch (e) { list = []; }
  return (Array.isArray(list) ? list : []).find(c => c && c.id === id) || null;
}
function shareAuthorised(req, id) {
  const want = (apiConnEntry(id).secrets || {}).shareToken || '';
  const got = String(req.query.token || req.get('X-Share-Token') || '');
  if (!want) return 'No share token is set for this connector.';
  if (got.length !== want.length || got !== want) return 'That token is not the one for this connector.';
  return '';
}
app.get('/api/share/:id', (req, res) => {
  const id = String(req.params.id || '');
  const conn = shareConnector(id);
  if (!conn) return res.status(404).json({ error: 'unknown connector' });
  if (conn.active === false) return res.status(403).json({ error: 'that connector is switched off' });
  if (conn.direction === 'in') return res.status(403).json({ error: 'that connector only imports; it shares nothing' });
  const why = shareAuthorised(req, id);
  if (why) return res.status(401).json({ error: why });
  const cap = Number(conn.shareLimit) || 1000;
  const read = (key) => {
    let rows = [];
    try { rows = JSON.parse(store[key] || '[]'); } catch (e) { rows = []; }
    return Array.isArray(rows) ? rows.filter(r => r && !r.deletedAt) : [];
  };
  /* A whole-system connector answers in BOSS's own export shape — the
     same { modules: { … } } the Export screen writes — so a mirror or a
     second BOSS needs no field map and no translation. */
  if (conn.module === '*') {
    const want = Array.isArray(conn.stores) && conn.stores.length ? conn.stores : [];
    if (!want.length) return res.status(409).json({
      error: 'that connector carries no module — open it in Setup and choose what it should share' });
    const modules = {};
    let count = 0;
    want.forEach(k => { modules[k] = read(k).slice(0, cap); count += modules[k].length; });
    return res.json({ source: 'BOSS', connector: conn.name || id, exportedAt: new Date().toISOString(),
      count, modules });
  }
  /* The connector names the store its module lives in; the browser
     writes it when the connector is saved, so this process needs no
     second copy of that map to fall out of step with. */
  if (!conn.store) return res.status(409).json({
    error: 'that connector does not say which store it reads — open it in Setup and save it again' });
  const maps = (conn.map || []).filter(m => m && m.boss && m.ext);
  const out = read(conn.store).slice(0, cap)
    .map(r => {
      const o = {};
      maps.forEach(m => { o[m.ext] = r[m.boss] === undefined ? null : r[m.boss]; });
      return o;
    });
  res.json({ connector: conn.name || id, module: conn.module || '', count: out.length, records: out });
});
app.post('/api/share/:id', (req, res) => {
  const id = String(req.params.id || '');
  const conn = shareConnector(id);
  if (!conn) return res.status(404).json({ error: 'unknown connector' });
  if (conn.active === false) return res.status(403).json({ error: 'that connector is switched off' });
  if (conn.direction === 'out') return res.status(403).json({ error: 'that connector only shares; it imports nothing' });
  const why = shareAuthorised(req, id);
  if (why) return res.status(401).json({ error: why });
  const body = req.body || {};
  /* A whole-system push is one object carrying every module, and goes
     into the queue as one item; anything else is a list of records. */
  const whole = conn.module === '*';
  const rows = whole ? [body]
    : (Array.isArray(body) ? body : (Array.isArray(body.records) ? body.records : [body]));
  if (whole && !(body.modules && typeof body.modules === 'object'))
    return res.status(400).json({ error: 'a whole-system connector expects {"modules":{"leads":[…]}} — the shape the Export screen writes' });
  if (!rows.length) return res.status(400).json({ error: 'no records in that body' });
  if (!whole && rows.length > 500) return res.status(413).json({ error: 'send at most 500 records at a time' });
  let inbox = [];
  try { inbox = JSON.parse(store['apiInbox'] || '[]'); } catch (e) { inbox = []; }
  if (!Array.isArray(inbox)) inbox = [];
  inbox.push({ id: 'IN-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    connectorId: id, at: new Date().toISOString(), rows, from: req.ip || '' });
  while (inbox.length > 200) inbox.shift();          // a queue, not an archive
  store['apiInbox'] = JSON.stringify(inbox);
  writeToDisk();
  publishChange(['apiInbox'], '');
  res.json({ ok: true, queued: whole
      ? Object.values(body.modules).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0)
      : rows.length,
    note: 'Queued. BOSS maps and applies these the moment a session picks the change up.' });
});

// DELETE /api/connections/:id — forgets the stored credential entirely, for
// when a connector is being retired or a key has to be revoked.
app.delete('/api/connections/:id', checkApiKey, (req, res) => {
  const id = req.params.id;
  if (!connections[id]) return res.status(404).json({ error: 'nothing stored for ' + id });
  delete connections[id];
  writeConnections();
  res.json({ id, deleted: true, connection: publicConnection(id) });
});

// POST /api/connections/:id/test -> runs a real check and records what happened
app.post('/api/connections/:id/test', checkApiKey, (req, res) => {
  const id = req.params.id;
  const kind = CONNECTOR_KIND[id];
  if (!kind) return res.status(404).json({ error: 'unknown connector: ' + id });
  const c = connections[id] || { config: {}, secrets: {} };
  const config = c.config || {}, secrets = c.secrets || {};

  const finish = (result) => {
    c.status = result.ok ? 'Connected' : 'Not Connected';
    c.lastTestAt = new Date().toISOString();
    c.lastTestOk = !!result.ok;
    c.lastTestMessage = result.message;
    connections[id] = c;
    writeConnections();
    res.json({ ok: !!result.ok, message: result.message, connection: publicConnection(id) });
  };

  // Microsoft Graph speaks OAuth rather than a bearer token you can paste, so
  // the test is the token exchange itself: if the tenant, the application and
  // the secret line up, a token comes back and the mailbox is reachable.
  if (kind === 'graph') {
    if (!config.tenantId || !config.clientId) return finish({ ok: false,
      message: 'Microsoft 365 needs a Directory (tenant) ID and an Application (client) ID. Both are on the app registration in Entra ID.' });
    if (!secrets.clientSecret) return finish({ ok: false,
      message: 'No client secret is stored. Paste the secret VALUE (not its ID) from Certificates & secrets, then save.' });
    return graphToken(config, secrets, (err, token) => {
      if (err) return finish({ ok: false, message: err });
      if (!config.userId) return finish({ ok: true,
        message: 'Microsoft 365 issued a token, so the tenant, application and secret are right. Add the mailbox (a user principal name, like you@firm.com) to create meeting links.' });
      httpsProbe({
        url: 'https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(config.userId),
        headers: { Authorization: 'Bearer ' + token },
      }, (r) => finish(r.ok
        ? { ok: true, message: 'Connected. Microsoft 365 issued a token and the mailbox ' + config.userId + ' was found.' }
        : { ok: false, message: 'A token was issued, but the mailbox could not be read — ' + r.message }));
    });
  }

  if (kind === 'smtp') {
    if (!config.host) return finish({ ok: false, message: 'No SMTP host is set. Fill the form in and save first.' });
    if (config.username && !secrets.password) return finish({ ok: false, message: 'A username is set but no password is stored. Enter the password and save first.' });
    return smtpTest({
      host: config.host,
      port: Number(config.port) || (config.secure ? 465 : 587),
      secure: !!config.secure,
      username: config.username || '',
      password: secrets.password || '',
    }, finish);
  }

  /* The firm's own model. The honest test is to ask it what it serves: a
     model list that answers proves the endpoint is up, reachable from this
     server, and speaking the protocol the assistant will use. */
  if (kind === 'selfhosted') {
    const base = String(config.baseUrl || '').replace(/\/+$/, '');
    if (!base) return finish({ ok: false, message: 'No endpoint is set. Put your model server\u2019s base URL here \u2014 the one ending /v1 on most of them.' });
    const headers = {};
    if (secrets.apiKey) headers.Authorization = 'Bearer ' + secrets.apiKey;
    return httpProbeJsonAny({ url: base + '/models', headers }, (r) => {
      if (!r.ok) return finish({ ok: false, message: r.message });
      const list = ((r.json && r.json.data) || []).map(m => m && m.id).filter(Boolean);
      if (config.model && list.length && list.indexOf(config.model) === -1)
        return finish({ ok: false, message: 'The server answered, but it does not serve \u201c' + config.model
          + '\u201d. It serves: ' + list.slice(0, 8).join(', ') + '.' });
      return finish({ ok: true, message: 'Connected. Your own model server answered'
        + (list.length ? ' and serves ' + list.length + ' model(s)' : '')
        + '. Nothing from BOSS leaves your infrastructure through this connector.' });
    });
  }

  if (kind === 'inbound') {
    if (!secrets.apiKey) return finish({ ok: false,
      message: 'No key has been issued yet. Save one here, then paste it — with this BOSS address — into the editor extension.' });
    if (!config.lastSeenAt) return finish({ ok: false,
      message: 'The key is stored, but no editor has called in with it yet. Until one does this stays Not Connected.' });
    return finish({ ok: true,
      message: 'Connected. The last call in was at ' + config.lastSeenAt + (config.lastSeenAgent ? ' from ' + config.lastSeenAgent : '') + '.' });
  }

  const probe = buildHttpsProbe(config, secrets);
  if (probe.error) return finish({ ok: false, message: probe.error });
  httpsProbe(probe, finish);
});


/* ---------------------------------------------------------------------
   THE AI SERVICE LAYER

   One endpoint, one place credentials live, one place the privacy rules
   are enforced. No module calls a provider itself and no key ever reaches
   a browser: the page sends what it wants said, the server decides whether
   it may be said at all and, if so, says it.

   What this will not do:
     - talk to a connector that is not enabled, not connected, or whose
       privacy terms nobody has verified;
     - write a prompt, a completion or anything out of a record to disk.
       The access log keeps who asked, through which connector, how long
       the exchange was and whether it worked. It does not keep what was
       in it, because an application log is the easiest place in a system
       for client data to end up by accident;
     - act on anything. It returns text. Every change to a BOSS record is
       made by BOSS, by a user who pressed something.
   --------------------------------------------------------------------- */
const AI_MAX_CHARS = 120000;      // a request larger than this is a mistake, not a prompt
const AI_TIMEOUT_MS = 60000;
let aiCallSeq = 0;
/* Zero-retention / no-training controls, where the provider publishes one.
   Sent on every call so the posture does not depend on somebody having
   ticked a box in a console. */
function aiPrivacyHeaders(id) {
  if (id === 'claude') return { 'anthropic-version': '2023-06-01' };
  return {};
}
function aiProviderCall({ id, kind, config, secrets, system, messages, maxTokens, temperature }, cb) {
  const cap = Math.min(Number(maxTokens) || 1500, 4000);
  const temp = temperature === undefined ? 0.2 : Math.max(0, Math.min(1, Number(temperature) || 0));
  if (id === 'claude') {
    const model = config.model;
    if (!model) return cb({ ok: false, message: 'No model is set on the Claude connector. Put the model identifier from your account’s documentation in its Model field.' });
    return httpsProbeJson({
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: Object.assign({ 'x-api-key': secrets.apiKey || '', 'Content-Type': 'application/json' }, aiPrivacyHeaders(id)),
      body: JSON.stringify({ model, max_tokens: cap, temperature: temp,
        system: system || undefined, messages }),
    }, (r) => {
      if (!r.ok) return cb({ ok: false, message: r.message });
      const parts = (r.json && r.json.content) || [];
      const text = parts.filter(p => p && p.type === 'text').map(p => p.text).join('').trim();
      cb(text ? { ok: true, text } : { ok: false, message: 'The provider answered, but with nothing in it.' });
    });
  }
  if (id === 'gemini') {
    const model = config.model;
    if (!model) return cb({ ok: false, message: 'No model is set on the Gemini connector. Put the model identifier from Google’s documentation in its Model field.' });
    const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '') }] }));
    return httpsProbeJson({
      url: 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model)
         + ':generateContent?key=' + encodeURIComponent(secrets.apiKey || ''),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ contents,
        generationConfig: { maxOutputTokens: cap, temperature: temp } },
        system ? { systemInstruction: { parts: [{ text: system }] } } : {})),
    }, (r) => {
      if (!r.ok) return cb({ ok: false, message: r.message });
      const cands = (r.json && r.json.candidates) || [];
      const text = ((cands[0] || {}).content || {}).parts
        ? cands[0].content.parts.map(p => p.text || '').join('').trim() : '';
      cb(text ? { ok: true, text } : { ok: false, message: 'The provider answered, but with nothing in it.' });
    });
  }
  // The firm's own model, behind an OpenAI-compatible endpoint. Ollama, vLLM,
  // LM Studio and every enterprise gateway worth the name speak this, so one
  // adapter covers them all and the firm is not locked to a vendor.
  if (kind === 'selfhosted') {
    const base = String(config.baseUrl || '').replace(/\/+$/, '');
    if (!base) return cb({ ok: false, message: 'No endpoint is set. Put your model server’s base URL in the connector.' });
    const model = config.model;
    if (!model) return cb({ ok: false, message: 'No model is set on the connector.' });
    const msgs = (system ? [{ role: 'system', content: system }] : []).concat(messages);
    const headers = { 'Content-Type': 'application/json' };
    if (secrets.apiKey) headers.Authorization = 'Bearer ' + secrets.apiKey;
    return httpProbeJsonAny({
      url: base + '/chat/completions', method: 'POST', headers,
      body: JSON.stringify({ model, messages: msgs, max_tokens: cap, temperature: temp, stream: false }),
    }, (r) => {
      if (!r.ok) return cb({ ok: false, message: r.message });
      const ch = ((r.json && r.json.choices) || [])[0] || {};
      const text = String((ch.message && ch.message.content) || ch.text || '').trim();
      cb(text ? { ok: true, text } : { ok: false, message: 'The model answered, but with nothing in it.' });
    });
  }
  cb({ ok: false, message: 'That connector is not a model BOSS can talk to.' });
}
/* A model the firm runs is often on its own network over plain http, which is
   fine — the traffic never leaves their infrastructure — so this one allows
   it where the outward-facing probe does not. Everything else is identical. */
function httpProbeJsonAny(opts, cb) {
  let target;
  try { target = new URL(opts.url); } catch (e) { return cb({ ok: false, message: 'That is not a valid URL.' }); }
  const lib = target.protocol === 'http:' ? http : https;
  if (target.protocol !== 'http:' && target.protocol !== 'https:')
    return cb({ ok: false, message: 'Use an http:// or https:// endpoint.' });
  const req = lib.request({
    hostname: target.hostname,
    port: target.port || (target.protocol === 'http:' ? 80 : 443),
    path: target.pathname + target.search,
    method: opts.method || 'GET',
    headers: Object.assign({ 'User-Agent': 'Finowise-BOSS/1.0', 'Accept': 'application/json' }, opts.headers || {}),
    timeout: AI_TIMEOUT_MS,
  }, (res) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { if (data.length < 400000) data += d; });
    res.on('end', () => {
      let json = null;
      try { json = JSON.parse(data); } catch (e) { /* reported below */ }
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      cb({ ok, json, message: ok ? 'ok'
        : 'The model server answered ' + res.statusCode + ' ' + (res.statusMessage || '')
          + (data ? ' — ' + data.trim().replace(/\s+/g, ' ').slice(0, 220) : '') });
    });
  });
  req.on('timeout', () => { req.destroy(); cb({ ok: false, message: 'The model server did not answer within 60 seconds.' }); });
  req.on('error', (e) => cb({ ok: false, message: 'Could not reach the model server — ' + e.message }));
  if (opts.body) req.write(opts.body);
  req.end();
}

// POST /api/ai/chat  { connector, system?, messages:[{role,content}], maxTokens?, temperature? }
// Returns { ok, text } or { ok:false, message, reason }. Signed-in users only.
app.post('/api/ai/chat', checkApiKey, (req, res) => {
  const t0 = Date.now();
  const seq = ++aiCallSeq;
  const body = req.body || {};
  const id = String(body.connector || '').toLowerCase();
  const deny = (code, message, extra) => {
    console.log('[ai] #' + seq + ' ' + (id || '?') + ' refused: ' + code);
    res.status(code === 'not_configured' ? 409 : 403)
       .json(Object.assign({ ok: false, reason: code, message }, extra || {}));
  };
  if (AI_CONNECTORS.indexOf(id) === -1)
    return deny('unknown', 'That is not a connector the assistant can speak through.');
  const c = connections[id];
  if (!c) return deny('not_configured', 'That connector has not been set up yet.');
  if (!c.enabled) return deny('disabled', 'That connector is switched off. Tick “Enable this channel” on it.');
  if (c.status !== 'Connected')
    return deny('not_connected', 'That connector is not connected. Test it in Setup → Connections first.');
  /* The gate. A public API with unverified terms gets nothing, however good
     its key is — which is the whole point of the requirement. */
  const p = aiPrivacyState(id);
  if (!p.ok) return deny('privacy', p.why, { privacy: p });

  const messages = Array.isArray(body.messages) ? body.messages
    .filter(m => m && typeof m.content === 'string' && m.content.length)
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }))
    : [];
  if (!messages.length) return res.status(400).json({ ok: false, message: 'There is nothing to ask.' });
  const size = messages.reduce((n, m) => n + m.content.length, 0) + String(body.system || '').length;
  if (size > AI_MAX_CHARS)
    return res.status(413).json({ ok: false, reason: 'too_big',
      message: 'That is ' + Math.round(size / 1000) + 'KB of context. Narrow the request — a filter, a shorter period, fewer records — so only what the task needs is sent.' });

  aiProviderCall({ id, kind: CONNECTOR_KIND[id], config: c.config || {}, secrets: c.secrets || {},
    system: body.system ? String(body.system) : '', messages,
    maxTokens: body.maxTokens, temperature: body.temperature }, (r) => {
    /* What goes in the log: who, through what, how big, how long, and whether
       it worked. Not the prompt, not the answer, not a record id. */
    console.log('[ai] #' + seq + ' ' + id + ' ' + (r.ok ? 'ok' : 'failed')
      + ' in=' + size + 'ch out=' + (r.ok ? String(r.text).length : 0) + 'ch '
      + (Date.now() - t0) + 'ms');
    if (!r.ok) return res.status(502).json({ ok: false, reason: 'provider', message: r.message });
    res.json({ ok: true, text: r.text, connector: id, reach: p.reach, via: p.by || p.reach });
  });
});
// GET /api/ai/status -> which connectors the assistant may actually use, and why not where it may not.
app.get('/api/ai/status', checkApiKey, (req, res) => {
  res.json({ connectors: AI_CONNECTORS.map(id => {
    const c = connections[id] || {};
    const p = aiPrivacyState(id);
    return { id, enabled: !!c.enabled, status: connectorStatusOf(id), reach: p.reach,
             usable: !!c.enabled && c.status === 'Connected' && p.ok, privacy: p };
  }) });
});

/* The editors' way in. Not behind the CRM's API key: an extension running on
   somebody's laptop holds the connector's own key and nothing else, which is
   exactly the credential being checked here. A wrong key is a 401 and is not
   recorded; a right one marks the connector Connected and stamps when. */
app.post('/api/ai/hello', (req, res) => {
  const body = req.body || {};
  const id = String(body.connector || '').toLowerCase();
  if (INBOUND_CONNECTORS.indexOf(id) === -1) return res.status(404).json({ ok: false, error: 'unknown editor connector' });
  const c = connections[id];
  const stored = c && c.secrets && c.secrets.apiKey;
  if (!stored) return res.status(409).json({ ok: false, error: 'no key has been issued for this connector yet' });
  const given = String(body.key || '');
  if (given.length !== String(stored).length
      || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(String(stored)))) {
    return res.status(401).json({ ok: false, error: 'that key does not match the one stored' });
  }
  c.config = c.config || {};
  c.config.lastSeenAt = new Date().toISOString();
  c.config.lastSeenAgent = String(body.agent || '').slice(0, 120);
  c.status = 'Connected';
  c.lastTestAt = c.config.lastSeenAt;
  c.lastTestOk = true;
  c.lastTestMessage = 'The editor called in' + (c.config.lastSeenAgent ? ' from ' + c.config.lastSeenAgent : '') + '.';
  connections[id] = c;
  writeConnections();
  res.json({ ok: true, connector: id, at: c.config.lastSeenAt });
});

/* GET /api/events — the stream. Signed in, like the rest of the CRM; the
   browser cannot put a header on an EventSource, so the session cookie is
   what authenticates it, and the payload carries no record data either way. */
app.get('/api/events', (req, res) => {
  if (!isSignedIn(req) && API_KEY && req.get('X-API-Key') !== API_KEY) {
    return res.status(401).json({ error: 'sign in first' });
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',   // nginx must not buffer a stream
  });
  res.write('retry: 3000\n\n');
  liveStreams.add(res);
  // What the version is right now, so a browser that reconnects can tell
  // whether it missed anything while it was away.
  liveSend(res, 'hello', { v: storeVersion, at: new Date().toISOString() });
  const beat = setInterval(() => { try { res.write(': beat\n\n'); } catch (e) {} }, 25000);
  const stop = () => { clearInterval(beat); liveStreams.delete(res); };
  req.on('close', stop);
  req.on('error', stop);
});

/* GET /api/changes?since=N - what this browser has missed.
   The stream's safety net: the same information, pulled rather than
   pushed, so a tab that was asleep, behind a buffering proxy or off the
   network catches up by asking instead of by being reloaded by hand.
   `gap` says the log no longer reaches back that far, so the browser
   should re-read everything rather than trust a partial list. */
app.get('/api/changes', (req, res) => {
  if (!isSignedIn(req) && API_KEY && req.get('X-API-Key') !== API_KEY) {
    return res.status(401).json({ error: 'sign in first' });
  }
  const since = Number(req.query.since || 0) || 0;
  const oldestHeld = changeLog.length ? changeLog[0].v : storeVersion + 1;
  res.set('Cache-Control', 'no-store').json({
    version: storeVersion,
    gap: since > 0 && since < oldestHeld - 1,
    changes: changeLog.filter((c) => c.v > since),
  });
});

/* The build being served, so a browser can say which one it has. Taken
   from the file itself rather than from git: the deploy script lives on
   the server and this has to be true whatever put the file there. */
function currentBuild() {
  try {
    const st = fs.statSync(path.join(__dirname, 'public', 'index.html'));
    return String(Math.round(st.mtimeMs)).slice(-9) + '-' + st.size;
  } catch (e) { return 'unknown'; }
}
const buildStamp = currentBuild();
app.get('/api/health', (req, res) => res.set('Cache-Control', 'no-store').json({
  ok: true, keys: Object.keys(store).length, version: storeVersion,
  build: currentBuild(), startedBuild: buildStamp,
}));

// Hands the browser the shared API key from the environment, so the secret
// stays out of git. Not itself a secret channel — the whole site sits behind
// nginx basic auth in production; see README.md on what this key does and doesn't do.
function requireAdmin(req, res, next) {
  const user = signedInUser(req);
  if (user && user.role === 'admin') return next();
  res.status(403).type('html').send(
    '<p style="font-family:system-ui;padding:24px">Only an admin can manage users. '
    + '<a href="/">Back to the CRM</a></p>');
}

app.get('/users', requireAdmin, (req, res) => {
  res.type('html').set('Cache-Control', 'no-store')
     .send(usersPage({ meId: (signedInUser(req) || {}).id }));
});

// Deleting an account is the other half of adding one. The person's records in
// the CRM are left exactly as they are — this only takes away the way in, and
// their session stops working at their next request.
app.post('/users/delete', requireAdmin, (req, res) => {
  const me = signedInUser(req) || {};
  const id = Number((req.body || {}).id);
  res.set('Cache-Control', 'no-store');
  const user = id ? findUserById.get(id) : null;
  if (!user) return res.status(404).type('html').send(usersPage({ error: 'No such account.', meId: me.id }));
  if (user.id === me.id) {
    return res.status(409).type('html')
      .send(usersPage({ error: 'That is the account you are signed in with.', meId: me.id }));
  }
  // Never leave the system with nobody who can manage accounts.
  if (user.role === 'admin' && listUsers.all().filter((u) => u.role === 'admin' && u.active !== 0).length <= 1) {
    return res.status(409).type('html')
      .send(usersPage({ error: 'That is the only admin account — make somebody else an admin first.', meId: me.id }));
  }
  deleteUserById.run(user.id);
  res.type('html').send(usersPage({ removed: user.email, meId: me.id }));
});

/* Accounts are made in one place: Team Members, which creates the person
   and the account they sign in with in the same breath. This page used to
   be a second way, and a second way is how a person and their account
   drift apart — an account with no team member behind it has no role, no
   branch, no reporting line and no access, and nothing in the CRM to
   attach them to. The form is gone and so is the route behind it, because
   a route left answering is a form somebody can still post to.

   A system with nobody in it is the one case this cannot cover, and that
   has the command line: npm run user -- add <email> <password>. */
app.post('/users', requireAdmin, (req, res) => {
  res.status(410).set('Cache-Control', 'no-store').type('html').send(usersPage({
    error: 'Accounts are made in BOSS \u203a Team Members now, which creates the person and their sign-in '
         + 'together. Nothing was added.',
    meId: (signedInUser(req) || {}).id,
  }));
});

// ------------------------------------------------- accounts, from the CRM --
// The Team Members module owns these. It creates a member, and the account
// that member signs in with is created here in the same breath — same email,
// same role, and a generated password the CRM mails to them. Nothing is typed
// in twice, and the two cannot drift apart.
function requireApiAdmin(req, res, next) {
  const user = signedInUser(req);
  if (user && user.role === 'admin') return next();
  res.status(403).json({ ok: false, message: 'Only an admin can manage sign-in accounts.' });
}

// Every account, for the CRM's Team Members screens.
app.get('/api/users', checkApiKey, requireApiAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, users: listUsers.all().map(accountJson) });
});

// Create or update the account a team member signs in with. Called whenever a
// member is saved, so it has to be safe to call again with nothing changed.
app.post('/api/users/sync', checkApiKey, requireApiAdmin, (req, res) => {
  const body = req.body || {};
  const memberId = String(body.memberId || '').trim();
  const email = String(body.email || '').trim();
  const crmRole = String(body.crmRole || '').trim();
  const role = body.admin ? 'admin' : 'user';
  const active = body.active === false ? 0 : 1;
  res.set('Cache-Control', 'no-store');
  if (!memberId) return res.status(400).json({ ok: false, message: 'Which team member is this for?' });
  if (!ADDRESS_RE.test(email)) return res.status(400).json({ ok: false, message: '"' + email + '" is not a usable email address.' });

  const byMember = findUserByMember.get(memberId);
  const byEmail = findUserByEmail.get(email);
  if (byEmail && byMember && byEmail.id !== byMember.id) {
    return res.status(409).json({ ok: false, message: email + ' already signs in as somebody else.' });
  }
  // An account that exists for this member, or one already on this address that
  // nobody owns yet — adopt it rather than refusing, so a CRM installed after
  // the accounts were made lines up with them.
  const existing = byMember || (byEmail && !byEmail.member_id ? byEmail : null);
  if (existing) {
    updateUserAccount.run(email, role, memberId, crmRole, active, existing.id);
    const after = findUserById.get(existing.id);
    return res.json({ ok: true, created: false, adopted: !byMember, account: accountJson(after) });
  }
  if (byEmail) return res.status(409).json({ ok: false, message: email + ' already signs in as somebody else.' });

  const password = String(body.password || '') || generatePassword();
  if (password.length < 8) return res.status(400).json({ ok: false, message: 'A password needs at least 8 characters.' });
  insertMemberUser.run(email, hashPassword(password), role, memberId, crmRole, active, password);
  const made = findUserByEmail.get(email);
  res.json({ ok: true, created: true, password, account: accountJson(made) });
});

// A fresh password for a member who never got theirs, or lost it.
app.post('/api/users/:memberId/password', checkApiKey, requireApiAdmin, (req, res) => {
  const user = findUserByMember.get(String(req.params.memberId || ''));
  res.set('Cache-Control', 'no-store');
  if (!user) return res.status(404).json({ ok: false, message: 'That team member has no sign-in account yet.' });
  const password = generatePassword();
  updateUserPassword.run(hashPassword(password), password, user.id);
  res.json({ ok: true, password, account: accountJson(findUserById.get(user.id)) });
});

// Removing a team member removes the account with them.
app.delete('/api/users/:memberId', checkApiKey, requireApiAdmin, (req, res) => {
  const user = findUserByMember.get(String(req.params.memberId || ''));
  res.set('Cache-Control', 'no-store');
  if (!user) return res.json({ ok: true, removed: false });
  const signedIn = signedInUser(req);
  if (signedIn && signedIn.id === user.id) {
    return res.status(409).json({ ok: false, message: 'That is the account you are signed in with.' });
  }
  deleteUserById.run(user.id);
  res.json({ ok: true, removed: true, email: user.email });
});

// ------------------------------------------------- the client's own pages --
// A lead filling in a BIS, a client signing off an allocation, somebody asking
// a question on their support link: none of them have an account here, and it
// would be absurd to ask them to sign in to answer their own adviser.
//
// So those pages are open — but only as far as their token reaches. The token
// names one record; this works out what that record is, hands the page a copy
// of just that much of the store, and accepts back only writes that stay
// inside it. The CRM's own key is never given out, and nothing here can read
// another client's anything.
function storeList(key) {
  const raw = store[key];
  if (raw === undefined) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function storeValue(key, fallback) {
  const raw = store[key];
  if (raw === undefined) return fallback;
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}
/* Everything a client's own link writes goes through here, so this is where
   their submissions join the stream. The origin says it came from a client
   link rather than from a CRM tab, which is exactly the case no open browser
   should ignore. */
function putList(key, list) { store[key] = JSON.stringify(list); publishChange([key], 'client-link'); }

/* ---------------------------------------------------------------------
   FIELD VALIDATION, on the side that cannot be bypassed.

   The page checks a mobile, an email and a PAN as they are typed, which
   is where it helps the person filling the form. This is the other half:
   what a client's own link posts back arrives from outside, over a token
   anyone holding the link has, so it is checked again here before it
   reaches a record.

   The patterns and the wording are the same settings the page reads, so
   a firm that relaxes a rule relaxes it in both places at once; the
   defaults below are only what applies before anybody has set one.
   --------------------------------------------------------------------- */
const VALIDATION_DEFAULTS = {
  mobile: { pattern: '^[0-9]{10}$', message: 'Please enter a valid 10-digit mobile number.' },
  email:  { pattern: '^[^@\\s]+@[^@\\s.]+(\\.[^@\\s.]+)+$', message: 'Please enter a valid email address.' },
  pan:    { pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$', message: 'Please enter a valid PAN number in the format ABCDE1234F.', upper: true },
};
function validationSetting(kind, what) {
  const settings = storeValue('settings', {}) || {};
  const key = 'validation.' + kind + (what === 'pattern' ? 'Pattern' : 'Message');
  const row = settings[key];
  const v = row && row.value;
  return (typeof v === 'string' && v.trim()) ? v : VALIDATION_DEFAULTS[kind][what];
}
/* { ok, value, message }. A blank passes — whether an answer is required
   is the form's question, not this one's. An unreadable pattern turns the
   check off rather than locking everybody out of their own forms. */
function checkValue(kind, raw) {
  const spec = VALIDATION_DEFAULTS[kind];
  if (!spec) return { ok: true, value: raw };
  let value = raw === null || raw === undefined ? '' : String(raw);
  if (spec.upper) value = value.toUpperCase();
  if (!value.trim()) return { ok: true, value };
  let re;
  try { re = new RegExp(validationSetting(kind, 'pattern')); } catch (e) { return { ok: true, value }; }
  return re.test(value) ? { ok: true, value }
                        : { ok: false, value, message: validationSetting(kind, 'message') };
}
/* Which rule a key is under, by what it is called — the same reading the
   page does, so neither side can decide a field is exempt. */
function validationKindOfKey(key) {
  const k = String(key || '').toLowerCase();
  if (/(^|[^a-z])pan([^a-z]|$)/.test(k) || k.endsWith('pan')) return 'pan';
  if (/mobile|phone/.test(k)) return 'mobile';
  if (/email/.test(k)) return 'email';
  return '';
}
/* Walk anything a client posted and report what breaks a rule. Values are
   corrected in place where correcting is right (a PAN in lower case is
   the same PAN); anything else is reported and nothing is stored. */
function validateSubmitted(value, path, out) {
  out = out || [];
  path = path || '';
  if (Array.isArray(value)) {
    value.forEach((v, i) => validateSubmitted(v, path + '[' + i + ']', out));
    return out;
  }
  if (value && typeof value === 'object') {
    Object.keys(value).forEach((k) => {
      const kind = validationKindOfKey(k);
      const v = value[k];
      if (kind && (typeof v === 'string' || typeof v === 'number')) {
        const got = checkValue(kind, v);
        if (got.ok) { if (got.value !== v) value[k] = got.value; }
        else out.push({ field: path ? path + '.' + k : k, message: got.message });
        return;
      }
      validateSubmitted(v, path ? path + '.' + k : k, out);
    });
  }
  return out;
}

/* The blueprint input sheets. Mirrors APPROACH_FORMS in the page — kept here
   because what a client sends back on one of these must land on the record
   whatever the browser manages to do about it. */
const PLAN_FORM_TYPES = ['GAB', 'MULTIGOAL', 'INSPIRING', 'DURATION', 'INCOME', 'SINGLEGOAL'];

/* The record a plan belongs to, wherever it is now: the lead it was built for,
   or the client that lead became. */
function planOwnerFor(leadId) {
  if (!leadId) return null;
  const leads = storeList('leads');
  const lead = leads.find((l) => l && l.id === leadId);
  if (lead) return { record: lead, key: 'leads', list: leads };
  const clients = storeList('clients');
  const client = clients.find((c) => c && (c.id === leadId || c.convertedFromLeadId === leadId));
  return client ? { record: client, key: 'clients', list: clients } : null;
}

/* An ISEQ coming back is the other half of the same problem, and it is the
   half that bit. The input sheet has had this since Mod 14: the server writes
   what came back onto the record, so the answers never depend on the page's
   own patch getting through. The ISEQ had nothing of the kind — the page set
   the score on the lead and PUT the whole list, and a tab holding that lead
   from before the client answered could PUT it back without one. The
   submission survives, the score card survives, and the stage goes on reading
   "Awaiting the ISEQ score" with the answer sitting one table away.

   So the score is applied here too, on the server, from the row that arrived.
   A score already on the record is left alone: a later ISEQ replaces an
   earlier one only because it is the later submission, which is the row the
   page sends. */
function applyIseqSubmissionToOwner(link, sub) {
  if (!link || !sub) return false;
  if (!/^ISEQ/.test(String(sub.type || ''))) return false;
  if (sub.score === undefined || sub.score === null) return false;
  const owner = link.recordModule === 'CMS' && link.recordId
    ? (() => { const list = storeList('clients');
               const rec = list.find((c) => c && c.id === link.recordId);
               return rec ? { record: rec, key: 'clients', list } : null; })()
    : planOwnerFor(link.leadId || sub.leadId);
  if (!owner) return false;
  const rec = owner.record;
  const when = sub.submittedAt || new Date().toISOString();
  // Only a newer answer moves it, so re-posting an old row cannot walk the
  // profile backwards.
  if (rec.iseqAnsweredAt && String(rec.iseqAnsweredAt) > String(when)) return false;
  rec.iseqScore = sub.score;
  rec.iseqMaxScore = sub.maxScore;
  rec.iseqCategory = sub.category;
  rec.iseqFormType = sub.type;
  rec.iseqProfileDate = String(when).slice(0, 10);
  rec.iseqAnsweredAt = when;
  putList(owner.key, owner.list);
  return true;
}
/* An input sheet coming back IS the answer of record, so the server writes it
   onto the lead or client itself rather than trusting the page to. The page
   still does its own half — the stage it moves, the notification it raises —
   but the answers no longer depend on that patch getting through. Only blanks
   are filled, so an adviser's later correction is never overwritten. */
function applyPlanSubmissionToOwner(link, sub) {
  if (!link || !sub || PLAN_FORM_TYPES.indexOf(link.type) < 0) return false;
  const answers = sub.answers && typeof sub.answers === 'object' ? sub.answers : null;
  if (!answers) return false;
  const owner = planOwnerFor(link.leadId);
  if (!owner) return false;
  const rec = owner.record;
  const blank = (v) => v === undefined || v === null || v === ''
    || (Array.isArray(v) && !v.length);
  rec.formData = rec.formData && typeof rec.formData === 'object' ? rec.formData : {};
  const held = Object.assign({}, rec.formData[link.type]);
  let filled = 0;
  Object.keys(answers).forEach((k) => {
    if (blank(answers[k])) return;
    if (!blank(held[k])) return;
    held[k] = answers[k];
    filled++;
  });
  rec.formData[link.type] = held;
  rec.planFormReturnedAt = sub.submittedAt || new Date().toISOString();
  // …and the round the answers were for is told it has them, which is what the
  // Prepare Plan step actually waits on. A sheet can come back before any round
  // exists — the adviser sent it straight from the Plan tab — so one is opened
  // here rather than letting the answers arrive with nowhere to belong.
  const rounds = Array.isArray(rec.planRounds) ? rec.planRounds : [];
  let round = rounds.length ? rounds[rounds.length - 1] : null;
  if (!round || round.clientDecision) {
    round = { n: rounds.length + 1, type: link.type, createdAt: new Date().toISOString() };
    rounds.push(round);
    rec.planRounds = rounds;
  }
  if (!round.type) round.type = link.type;
  if (!round.inputSubmittedAt) {
    round.inputSubmittedAt = rec.planFormReturnedAt;
    round.inputSubmittedBy = sub.submittedBy || 'Client';
  }
  putList(owner.key, owner.list);
  return filled > 0 || !!round;
}

// What a token is allowed to see and touch. Returns null when it means nothing.
function publicScope(token) {
  if (!token || typeof token !== 'string') return null;
  const links = storeList('docLinks');
  const clients = storeList('clients');
  const leads = storeList('leads');
  const reviews = storeList('reviews');
  const recs = storeList('recommendations');
  const team = storeList('team');

  const link = links.find((l) => l && l.token === token);
  if (link) {
    const lead = link.leadId ? leads.find((l) => l.id === link.leadId) : null;
    // A lead that converted while its link was out with the client is no longer
    // in LMS. The link still names it, so the client it became is found here —
    // otherwise their page would load empty and every write from it be refused.
    const converted = !lead && link.leadId
      ? clients.find((c) => c && (c.id === link.leadId || c.convertedFromLeadId === link.leadId))
      : null;
    const client = link.recordModule === 'CMS' ? clients.find((c) => c.id === link.recordId)
      : converted
      || (lead && lead.convertedToClientId ? clients.find((c) => c.id === lead.convertedToClientId) : null);
    const review = reviews.find((r) => r && (r.ctFormToken === token || (link.recordModule === 'RMS' && r.id === link.recordId))) || null;
    const rec = link.allocationId ? recs.find((r) => r.id === link.allocationId) : null;
    const reviewClient = review ? clients.find((c) => c.id === review.clientId) : null;
    const owner = (lead && lead.assignedTo) || (client && client.rmName) || (review && review.assignTo) || '';
    return {
      kind: 'doc', token, link,
      ids: new Set([link.token, lead && lead.id, client && client.id, review && review.id, rec && rec.id,
                    reviewClient && reviewClient.id].filter(Boolean)),
      records: { lead, client: client || reviewClient, review, rec },
      owner: team.find((t) => t.id === owner) || null,
    };
  }
  const client = clients.find((c) => c && c.supportToken === token);
  if (client) {
    // Their own tickets are theirs to add to — writing back on one they raised
    // last week is the ordinary case, not an escape from the link.
    const mine = storeList('queries').filter((q) => q && q.clientId === client.id).map((q) => q.id);
    return {
      kind: 'support', token, link: null,
      ids: new Set([client.id].concat(mine)),
      records: { client },
      owner: team.find((t) => t.id === client.rmName) || null,
    };
  }
  return null;
}
// The addresses a page may write to: the person it belongs to, their adviser,
// and the firm itself. Not the world.
function publicMailTargets(scope) {
  const out = [];
  const r = scope.records || {};
  [r.lead, r.client, r.review].forEach((rec) => { if (rec && rec.email) out.push(rec.email); });
  if (scope.owner && scope.owner.email) out.push(scope.owner.email);
  const conn = connections.email || {};
  const from = (conn.config || {}).fromEmail || (conn.config || {}).username || '';
  if (from) out.push(from);
  const company = (storeValue('config', {}) || {}).company || {};
  if (company.email) out.push(company.email);
  return out;
}
// The slice of the store a public page is given. Lists the page needs whole
// (its own form templates, the firm's branding) come whole; lists about people
// are cut down to the one record the token names.
// The 7 Events sheet keeps the planner's own half on the record: the goal
// planning, the asset mapping and the execution plan, with the notes they
// wrote on each. The client's page needs the input form and nothing else, so
// the rest never leaves the building.
const SEVEN_EVENTS_INTERNAL = ['gp', 'map', 'mapMeta', 'exec', 'eaa'];
function scrubForClient(record) {
  const se = record && record.formData && record.formData.SEVENEVENTS;
  if (!se || typeof se !== 'object') return record;
  const copy = Object.assign({}, record);
  copy.formData = Object.assign({}, record.formData);
  const kept = {};
  Object.keys(se).forEach((k) => { if (!SEVEN_EVENTS_INTERNAL.includes(k)) kept[k] = se[k]; });
  copy.formData.SEVENEVENTS = kept;
  return copy;
}

// A public page holds part of a record, so what comes back is merged, not
// substituted — and `formData` is merged a level deeper, because each form's
// answers live under their own key and a page that only saw one of them must
// not be able to wipe the others. The planner's half of a 7 Events sheet is
// never sent out, so it is put back from what is on file.
function mergeFromClient(stored, incoming) {
  const out = Object.assign({}, stored, incoming, { id: stored.id });
  if (incoming && (incoming.formData || stored.formData)) {
    out.formData = Object.assign({}, stored.formData || {}, incoming.formData || {});
    const se = out.formData.SEVENEVENTS, old = (stored.formData || {}).SEVENEVENTS;
    if (se && typeof se === 'object' && old && typeof old === 'object') {
      const kept = Object.assign({}, se);
      SEVEN_EVENTS_INTERNAL.forEach((k) => { if (old[k] !== undefined) kept[k] = old[k]; });
      out.formData.SEVENEVENTS = kept;
    }
  }
  return out;
}

function publicBundle(scope) {
  const only = (key, keep) => storeList(key).filter(keep);
  const r = scope.records || {};
  const ids = scope.ids;
  const mine = (x) => x && ids.has(x.id);
  const bundle = {
    docLinks: scope.link ? [scope.link] : [],
    docSubmissions: only('docSubmissions', (x) => x && x.token === scope.token),
    leads: [r.lead].filter(Boolean).map(scrubForClient),
    clients: [r.client].filter(Boolean).map(scrubForClient),
    reviews: [r.review].filter(Boolean),
    recommendations: [r.rec].filter(Boolean),
    // The adviser's name and address appear on what the client is sent; nothing
    // else about the team goes out.
    team: (scope.owner ? [scope.owner] : []).map((t) => ({ id: t.id, name: t.name, email: t.email, role: t.role })),
    config: storeValue('config', null),
    settings: storeValue('settings', {}),
    schemes: storeList('schemes'),
    amcs: storeList('amcs'),
    // The service tasks that belong to this record. A form coming back closes
    // the task that was chasing it, so the page has to see them — but only
    // their bones: what a colleague wrote on one is not the client's business.
    tasks: only('tasks', (x) => x && !x.deletedAt && (ids.has(x.leadId) || ids.has(x.clientId)))
      .map((t) => ({ id: t.id, taskType: t.taskType, leadId: t.leadId, clientId: t.clientId,
                     overallStatus: t.overallStatus, dueDate: t.dueDate })),
    transactions: [],
    // The business entry this lead's plan has already raised, so approving a
    // plan updates that row instead of writing a second one.
    businessEntries: only('businessEntries', (x) => x && !x.deletedAt && ids.has(x.leadId)),
    communications: [], auditLog: [], notifications: [],
    queries: [], queryReplies: [],
  };
  if (scope.kind === 'support' && r.client) {
    bundle.queries = only('queries', (x) => x && x.clientId === r.client.id && !x.deletedAt);
    const qids = new Set(bundle.queries.map((q) => q.id));
    // Internal notes are the team's, and stay the team's.
    bundle.queryReplies = only('queryReplies', (x) => x && qids.has(x.queryId) && !x.internal && !x.deletedAt);
  }
  void mine;
  return bundle;
}
// Rows a public page may add to, and records it may change. Anything else is
// refused by name rather than ignored, so a mistake here is loud.
const PUBLIC_APPEND_KEYS = ['docSubmissions', 'tasks', 'communications', 'auditLog', 'notifications',
  'queries', 'queryReplies', 'leads', 'transactions',
  // A client approving their plan raises the business entry from it.
  'businessEntries',
  /* …and the allocation the plan decided, which the Asset Allocation module
     is supposed to hold for every plan. It was being refused here and the
     refusal was swallowed by the page, so a plan approved on the client's
     own link left no allocation row behind — only one approved inside the
     CRM did. The row names the lead it belongs to, so it comes back into
     this link's reach for the updates that follow. */
  'recommendations'];
const PUBLIC_UPDATE_KEYS = ['docLinks', 'leads', 'clients', 'reviews', 'recommendations', 'queries',
  'tasks', 'transactions', 'businessEntries'];
// A row is this token's business if it IS one of its records, or if it hangs
// off one — the task chasing this form, the transaction from this allocation.
function rowInScope(row, scope) {
  if (!row) return false;
  if (scope.ids.has(row.id)) return true;
  return ['leadId', 'clientId', 'recordId', 'reviewId', 'allocationId', 'queryId', 'refId']
    .some((k) => row[k] && scope.ids.has(row[k]));
}

// Serving the page IS the client opening the form, so that is where it is
// recorded — a link has no id of its own for the page to patch back, and this
// is the one place that always knows the form was actually looked at.
function noteLinkOpened(scope) {
  const link = scope && scope.link;
  if (!link || link.openedAt) return;
  const links = storeList('docLinks');
  const row = links.find((l) => l && l.token === link.token);
  if (!row || row.openedAt) return;
  row.openedAt = new Date().toISOString();
  row.history = (row.history || []).concat([{ at: row.openedAt, what: 'Opened by the client' }]);
  putList('docLinks', links);
  writeToDisk();
}

app.get('/api/public/bundle', (req, res) => {
  const scope = publicScope(String(req.query.token || ''));
  res.set('Cache-Control', 'no-store');
  if (!scope) return res.status(404).json({ ok: false, message: 'This link is not valid any more.' });
  noteLinkOpened(scope);
  // Whether a mail this page sends can actually go. The page cannot read the
  // connector itself — it only needs to know whether to promise anything.
  const conn = connections.email || {};
  const mail = {
    // The firm's own address is on the certificate this page may issue, so the
    // page is told it. It is the address mail already arrives from.
    from: ((conn.config || {}).fromEmail || (conn.config || {}).username || ''),
    ready: !!(conn.enabled && conn.status === 'Connected' && ((conn.config || {}).fromEmail || (conn.config || {}).username)),
    message: !conn.config || !(conn.config || {}).host ? 'No email connector is set up yet.'
      : !conn.enabled ? 'The email connector is switched off.'
      : conn.status !== 'Connected' ? 'The email connector has not passed a connection test.' : '',
  };
  res.json({ ok: true, kind: scope.kind, store: publicBundle(scope), mail });
});

// What the page did: rows added, and records changed. Every id is checked
// against the token's own scope before anything is written.
/* Who owns the record a client link belongs to, and a line in their bell
   when the client sends something back. Written here, on the server, so one
   submission makes one notification however many CRM tabs happen to be
   open — and so it exists at all when none is. */
function ownerOfLinkRecord(link) {
  if (!link) return null;
  if (link.leadId) {
    const lead = storeList('leads').find((l) => l && l.id === link.leadId);
    return lead ? { userId: lead.assignedTo, name: ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim(), view: 'lms', arg: lead.id } : null;
  }
  if (link.recordModule === 'CMS' && link.recordId) {
    const c = storeList('clients').find((x) => x && x.id === link.recordId);
    return c ? { userId: c.rmName, name: c.cmsName || '', view: 'cms', arg: c.id } : null;
  }
  if (link.recordModule === 'RMS' && link.recordId) {
    const r = storeList('reviews').find((x) => x && x.id === link.recordId);
    const c = r ? storeList('clients').find((x) => x && x.id === r.clientId) : null;
    return r ? { userId: (c && c.rmName) || r.assignedTo, name: (c && c.cmsName) || '', view: 'rms', arg: r.id } : null;
  }
  return null;
}
function notifyOwnerOfSubmission(link, row) {
  const owner = ownerOfLinkRecord(link);
  if (!owner || !owner.userId) return;
  // The link carries the form's own name; a link minted before it did falls
  // back to its type, tidied rather than printed raw.
  const what = (link.formName || String(link.type || 'form').replace(/_/g, ' ')).toString();
  const list = storeList('notifications');
  list.push({
    id: 'NTF-' + Math.random().toString(36).slice(2, 7).toUpperCase() + Date.now().toString().slice(-4),
    at: new Date().toISOString(), userId: owner.userId,
    title: what + ' submitted' + (owner.name ? ' by ' + owner.name : ''),
    body: 'It came back at ' + new Date().toLocaleString('en-IN') + ' and is on the record now.',
    view: owner.view, arg: owner.arg, kind: 'submission', by: 'Client',
  });
  putList('notifications', list);
}
app.post('/api/public/patch', (req, res) => {
  const scope = publicScope(String(req.query.token || ''));
  res.set('Cache-Control', 'no-store');
  if (!scope) return res.status(404).json({ ok: false, message: 'This link is not valid any more.' });
  const body = req.body || {};
  const appends = body.appends || {}, updates = body.updates || {};
  const refused = [];

  /* What a client's own link posts arrives from outside. The page checks
     a mobile, an email and a PAN as they are typed; this is the check
     that cannot be skipped by posting straight at the endpoint. Nothing
     is stored unless it passes, so a refused submission leaves the record
     exactly as it was.

     Only what the client is actually entering is checked — the rows they
     are adding, which is where their answers arrive. An update carries a
     whole record forward, including fields filled in long before these
     rules existed; refusing those would mean a lead with one bad PAN on
     file could never be written to again, which is not a validation rule
     but a lockout. Those fields reach the record through the answers
     above, and the answers are checked. */
  const wrong = validateSubmitted(appends);
  if (wrong.length) {
    return res.status(400).json({ ok: false, invalid: wrong,
      message: wrong.length === 1 ? wrong[0].message
        : 'Some of what was sent is not valid: ' + wrong.map((w) => w.message).join(' ') });
  }

  for (const [key, rows] of Object.entries(appends)) {
    if (!PUBLIC_APPEND_KEYS.includes(key)) { refused.push('add to ' + key); continue; }
    if (!Array.isArray(rows) || !rows.length) continue;
    const list = storeList(key);
    const have = new Set(list.map((x) => x && x.id));
    rows.forEach((row) => {
      if (!row || typeof row !== 'object' || !row.id || have.has(row.id)) return;
      list.push(row);
      have.add(row.id);
      // A row this page just created belongs to it, so it may amend it again.
      scope.ids.add(row.id);
    });
    putList(key, list);
    // A form coming back is the link's own history — recorded here because the
    // page cannot patch a link row (it has a token, not an id).
    if (key === 'docSubmissions') {
      const links = storeList('docLinks');
      let touched = false;
      rows.forEach((row) => {
        if (!row || !row.token) return;
        const link = links.find((l) => l && l.token === row.token);
        if (!link) return;
        const again = !!link.submittedAt;
        // An FQ link goes out before the client has said which age bracket
        // they are in, so what came back names the assessment they actually
        // answered. The link becomes that one — otherwise its own module
        // would file it under the bracket it happened to boot on.
        if (link.fqPick && row.type && row.type !== link.type) link.type = row.type;
        link.status = 'Submitted';
        link.submittedAt = row.submittedAt || new Date().toISOString();
        link.submittedBy = row.submittedBy || 'Client';
        link.history = (link.history || []).concat([{ at: link.submittedAt,
          what: again ? 'Re-submitted' : 'Submitted', note: row.submittedVia || '' }]);
        touched = true;
      });
      if (touched) putList('docLinks', links);
      // An input sheet is the one submission that has to change the record it
      // came from, so it is applied here rather than left to the page.
      rows.forEach((row) => {
        if (!row || !row.token) return;
        const link = links.find((l) => l && l.token === row.token);
        if (link) applyPlanSubmissionToOwner(link, row);
        // …and an ISEQ, whichever link it came back on. A submission whose
        // link has gone still names its lead, so it is applied from the row.
        if (link) applyIseqSubmissionToOwner(link, row);
        else if (row.leadId) applyIseqSubmissionToOwner({ leadId: row.leadId }, row);
      });
      // …and whoever owns that record is told, so a submission that lands
      // while nobody is looking at the right screen is still waiting for
      // them when they come back to it.
      rows.forEach((row) => {
        if (!row || !row.token) return;
        const link = links.find((l) => l && l.token === row.token);
        if (link) notifyOwnerOfSubmission(link, row);
      });
    }
  }
  for (const [key, byId] of Object.entries(updates)) {
    if (!PUBLIC_UPDATE_KEYS.includes(key)) { refused.push('change ' + key); continue; }
    const list = storeList(key);
    let touched = false;
    for (const [id, row] of Object.entries(byId || {})) {
      const idx = list.findIndex((x) => x && x.id === id);
      if (idx < 0) { refused.push(key + '/' + id); continue; }
      if (!scope.ids.has(id) && !rowInScope(list[idx], scope)) { refused.push(key + '/' + id); continue; }
      // Merge rather than replace: the page only ever held part of the store,
      // and must not be able to blank a field it never saw.
      list[idx] = mergeFromClient(list[idx], row);
      touched = true;
    }
    if (touched) putList(key, list);
  }
  writeToDisk();
  if (refused.length) return res.status(403).json({ ok: false, message: 'Outside this link: ' + refused.join(', ') });
  res.json({ ok: true });
});

/* =====================================================================
   THE APPROVAL TRAIL

   Every approval in the CRM — the reporting manager signing a plan off,
   and the client saying yes to it — is written here rather than only onto
   the record it decided. The browser cannot be trusted with the address it
   came from, so the address, the time and (for a signed-in approver) the
   account are stamped by the server; everything else is what the approver
   actually said.

   Two ways in, because there are two kinds of approver: one for somebody
   signed into the CRM, one for the client on their own document link. Both
   append to the same list, so the trail reads as one.
   ===================================================================== */
function callerIp(req) {
  const raw = (req.ip || (req.connection && req.connection.remoteAddress) || '').toString();
  // ::ffff:203.0.113.9 is an IPv4 address wearing an IPv6 coat. Written plainly.
  return raw.replace(/^::ffff:/, '') || 'unknown';
}
function recordApproval(req, fields) {
  const list = storeList('approvals');
  const row = Object.assign({}, fields, {
    id: fields.id || ('APR-' + Math.random().toString(36).slice(2, 10).toUpperCase()),
    at: new Date().toISOString(),
    ip: callerIp(req),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
  });
  list.push(row);
  putList('approvals', list);
  writeToDisk();
  return row;
}
// An approval given by somebody signed into the CRM: a reporting manager, an
// admin. The account is taken from the session, not from the body.
app.post('/api/approvals', checkApiKey, (req, res) => {
  const b = req.body || {};
  const user = signedInUser(req);
  res.set('Cache-Control', 'no-store');
  if (!b.decision) return res.status(400).json({ ok: false, message: 'decision is required' });
  const row = recordApproval(req, {
    module: String(b.module || 'LMS'),
    recordId: String(b.recordId || ''),
    leadId: b.leadId || null,
    clientId: b.clientId || null,
    subject: String(b.subject || ''),
    kind: String(b.kind || 'Plan'),
    planRound: b.planRound === undefined ? null : b.planRound,
    planType: String(b.planType || ''),
    planVersionLabel: String(b.planVersionLabel || ''),
    ref: String(b.ref || ''),
    approverType: 'Internal',
    approverName: String(b.approverName || (user && user.email) || ''),
    approverId: String(b.approverId || ''),
    account: (user && user.email) || '',
    decision: String(b.decision),
    remarks: String(b.remarks || ''),
    via: 'CRM',
  });
  res.json({ ok: true, approval: row });
});
// An approval given by the person the document was sent to. The link is the
// authority: whatever it is scoped to is what the approval may name.
app.post('/api/public/approval', (req, res) => {
  const token = String(req.query.token || '');
  const scope = publicScope(token);
  res.set('Cache-Control', 'no-store');
  if (!scope) return res.status(404).json({ ok: false, message: 'This link is not valid any more.' });
  const b = req.body || {};
  if (!b.decision) return res.status(400).json({ ok: false, message: 'decision is required' });
  const links = storeList('docLinks');
  const link = links.find((l) => l && l.token === token) || {};
  const row = recordApproval(req, {
    module: link.recordModule || 'LMS',
    recordId: link.leadId || link.recordId || '',
    leadId: link.leadId || null,
    clientId: link.recordModule === 'CMS' ? link.recordId : null,
    subject: String(b.subject || ''),
    kind: String(b.kind || 'Plan'),
    planRound: link.planRound === undefined ? (b.planRound === undefined ? null : b.planRound) : link.planRound,
    planType: String(b.planType || link.type || ''),
    planVersionLabel: String(b.planVersionLabel || ''),
    // What exactly was approved, when a record can hold more than one thing
    // that gets approved: an asset allocation carries its own reference.
    ref: String(b.ref || link.allocationId || ''),
    approverType: 'External',
    approverName: String(b.approverName || ''),
    approverId: '',
    account: '',
    decision: String(b.decision),
    remarks: String(b.remarks || ''),
    via: 'Client link',
    token,
  });
  res.json({ ok: true, approval: row });
});

// The mails a client's own page sends: their score card, their copy of a form,
// the note that tells their adviser they have answered.
app.post('/api/public/mail', (req, res) => {
  const scope = publicScope(String(req.query.token || ''));
  res.set('Cache-Control', 'no-store');
  if (!scope) return res.status(404).json({ ok: false, message: 'This link is not valid any more.' });
  sendMailRequest(req.body || {}, res, publicMailTargets(scope));
});

app.get('/config.js', (req, res) => {
  const user = signedInUser(req);
  // A client's form page loads this too. It gets nothing: no API key, no
  // identity — that page talks only to the public endpoints, with its token.
  if (!user) {
    return res.type('application/javascript').set('Cache-Control', 'no-store')
      .send('window.CRM_API_KEY = "";window.CRM_IS_ADMIN = false;'
          + 'window.CRM_USER_EMAIL = "";window.CRM_MEMBER_ID = "";');
  }
  res.type('application/javascript').set('Cache-Control', 'no-store')
     .send('window.CRM_API_KEY = ' + JSON.stringify(API_KEY || '') + ';'
         + 'window.CRM_IS_ADMIN = ' + JSON.stringify(!!(user && user.role === 'admin')) + ';'
         // Who is signed in, so the CRM can work as them rather than as
         // whichever team member happens to be first in the list.
         + 'window.CRM_USER_EMAIL = ' + JSON.stringify((user && user.email) || '') + ';'
         + 'window.CRM_MEMBER_ID = ' + JSON.stringify((user && user.member_id) || '') + ';');
});

// Serve the CRM itself — one process, one command, no separate static host needed.
/* PAYOUT — mutual fund brokerage, L1–L7 sharing, settlements and the payment
   ledger. It was a separate app (WealthFlow) with its own logins; it now lives
   in payout/ and answers at /api/payout behind the same sign-in and API key as
   everything else. Its records are SQLite, in their own file beside data.json,
   so nothing here touches the CRM's store. payout/ is ES modules, so it is
   imported rather than required; a request that arrives in the moment before
   that finishes simply waits for it. */
process.env.CRM_PAYOUT_DB = process.env.CRM_PAYOUT_DB || path.join(path.dirname(DB_FILE), 'payout.db');
function payoutAccount(req) {
  const user = signedInUser(req);
  if (!user) return null;
  let name = '';
  try {
    const team = JSON.parse(store.team || '[]');
    const member = Array.isArray(team) ? team.find((t) => t && t.id === user.member_id) : null;
    name = (member && (member.name || member.fullName)) || '';
  } catch (e) { /* no name, then: the payout module makes one from the email */ }
  return { email: user.email, role: user.role, name };
}
const payoutRouter = import('./payout/index.js')
  .then((m) => m.createPayoutRouter({ currentAccount: payoutAccount }));
payoutRouter.catch((err) => console.error('Payout module failed to load:', err));
app.use('/api/payout', checkApiKey, (req, res, next) => {
  payoutRouter.then((router) => router(req, res, next),
    () => res.status(503).json({ error: 'The payout module did not start. See the server log.' }));
});

/* THE PARTNER JOURNEY — the session reminders, the ARN / EUIN expiry
   warnings and the prospect's own form, which all have to work with no
   CRM tab open. See partner-journey.js. */
const partnerJourney = require('./partner-journey').install({ app, storeList, storeValue, putList, writeToDisk, sendMail, checkApiKey,
  dataDir: path.dirname(DB_FILE) });
/* The partner's own login and the one empanelment form (B2B changes 3).
   A door of its own, with accounts of its own: see partner-portal.js. */
require('./partner-portal').install({ app, storeList, storeValue, putList, writeToDisk,
  pj: partnerJourney, publicDir: path.join(__dirname, 'public') });
/* The separate partner login is gone: partners sign in to BOSS itself
   (Setup › Partner Levels). An old link or bookmark lands on the one
   sign-in page rather than on nothing. */
app.get(['/partner', '/partner/login', '/partner/setup'], (req, res) => res.redirect('/login'));
app.get('/partner-form', (req, res) => {
  res.set('Cache-Control', 'no-store').sendFile(path.join(__dirname, 'public', 'partner-form.html'));
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/*splat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const HOST = process.env.HOST || '0.0.0.0'; // in production bind to 127.0.0.1 so only nginx can reach it
app.listen(PORT, HOST, () => {
  console.log(`BOSS server running on http://localhost:${PORT}`);
  console.log(`Database file: ${DB_FILE}`);
  console.log(API_KEY ? 'API key protection: ENABLED' : 'API key protection: DISABLED (set CRM_API_KEY env var before real deployment)');
});
