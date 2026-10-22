/* Account management for the CRM. Run it on the server:
 *
 *   npm run user -- add    someone@company.com "a good password"
 *   npm run user -- list
 *   npm run user -- passwd someone@company.com "new password"
 *   npm run user -- remove someone@company.com
 *   npm run user -- 2fa    someone@company.com off   (or on) — two-step sign-in,
 *                          e.g. for somebody who has lost their mailbox
 *
 * There is no sign-up page and no password reset email on purpose — accounts
 * are created here, by someone with server access.
 */
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DB_FILE = process.env.CRM_DB_FILE || path.join(__dirname, '..', 'data.json');
const USERS_DB_FILE = process.env.CRM_USERS_DB || path.join(path.dirname(DB_FILE), 'users.db');
const db = new DatabaseSync(USERS_DB_FILE);
db.exec(`CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
)`);
if (!db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'role'").get()) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
}

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(plain, salt, 64).toString('hex');
}

const [cmd, email, password] = process.argv.slice(2);
const needEmail = () => { if (!email) { console.error('Which email?'); process.exit(1); } };
const needPassword = () => {
  if (!password || password.length < 8) {
    console.error('Give a password of at least 8 characters, in quotes.');
    process.exit(1);
  }
};

switch (cmd) {
  case 'add': {
    needEmail(); needPassword();
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      console.error(`${email} already has an account. Use "passwd" to change the password.`);
      process.exit(1);
    }
    db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hashPassword(password));
    console.log(`added ${email}`);
    break;
  }
  case 'passwd': {
    needEmail(); needPassword();
    const r = db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(hashPassword(password), email);
    console.log(r.changes ? `password changed for ${email}` : `no account for ${email}`);
    break;
  }
  case 'remove': {
    needEmail();
    const r = db.prepare('DELETE FROM users WHERE email = ?').run(email);
    // Their existing session stops working at the next request: the gate looks
    // the account up on every call, not just at sign-in.
    console.log(r.changes ? `removed ${email}` : `no account for ${email}`);
    break;
  }
  case 'role': {
    needEmail();
    const role = password; // third argument: admin | user
    if (role !== "admin" && role !== "user") { console.error('Role must be "admin" or "user".'); process.exit(1); }
    const r = db.prepare("UPDATE users SET role = ? WHERE email = ?").run(role, email);
    console.log(r.changes ? `${email} is now ${role}` : `no account for ${email}`);
    break;
  }
  case '2fa': {
    needEmail();
    const want = password; // third argument: on | off
    if (want !== 'on' && want !== 'off') { console.error('Say "on" or "off".'); process.exit(1); }
    if (!db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'two_factor'").get()) {
      db.exec('ALTER TABLE users ADD COLUMN two_factor INTEGER NOT NULL DEFAULT 0');
    }
    const r = db.prepare('UPDATE users SET two_factor = ? WHERE email = ?').run(want === 'on' ? 1 : 0, email);
    console.log(r.changes ? `two-step sign-in is ${want} for ${email}` : `no account for ${email}`);
    break;
  }
  case 'list': {
    const rows = db.prepare('SELECT id, email, role, created_at FROM users ORDER BY id').all();
    if (!rows.length) console.log('no accounts yet');
    rows.forEach((u) => console.log(`${String(u.id).padStart(3)}  ${u.email.padEnd(32)} ${u.role.padEnd(6)} added ${u.created_at}`));
    break;
  }
  default:
    console.log('usage: npm run user -- add|passwd|remove|role|2fa|list [email] ["password"|admin|user|on|off]');
}
