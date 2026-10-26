// Who is asking. There is no separate sign-in here: the CRM has already checked
// the session, and hands over its account. That account is matched to a payout
// user by email. A CRM admin is a payout admin, and gets a payout user created
// the first time they open the module; anyone else has to be added to the team
// (Clients & Map → Hierarchy) before they see anything.
import { db, audit } from './db.js';

const findByEmail = db.prepare('SELECT id, name, email, code, role, level, active FROM users WHERE lower(email) = lower(?)');

function nameFromEmail(email) {
  return String(email).split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || email;
}

export function bindUser(currentAccount) {
  return (req, res, next) => {
    const account = currentAccount(req);
    if (!account || !account.email) return res.status(401).json({ error: 'Not signed in' });
    const crmAdmin = account.role === 'admin';
    let user = findByEmail.get(account.email);
    if (!user && crmAdmin) {
      db.prepare(`INSERT INTO users(name, email, role, level) VALUES(?, ?, 'admin', 7)`)
        .run(account.name || nameFromEmail(account.email), String(account.email).toLowerCase());
      user = findByEmail.get(account.email);
      audit(user, 'USER_CREATE', `${user.name} added as a payout admin on first visit`);
    }
    if (!user) {
      return res.status(403).json({ error: 'You are not in the payout team yet. Ask an admin to add your email under Payout → Clients & Map → Hierarchy.', code: 'NOT_IN_TEAM' });
    }
    if (!user.active) return res.status(403).json({ error: 'Your payout account is disabled' });
    req.user = crmAdmin ? { ...user, role: 'admin' } : user;
    next();
  };
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// Whose data a request may see: null for an admin (everything), otherwise a
// list of payout user ids. Ops and partners see their own; a mentor sees their
// own and that of everyone who reports to them directly. From L3 (Sherpa) up,
// as in Partner Journey, a person sees everyone mapped below them, however
// deep: L1 and L2 see only their own business.
const directReports = db.prepare('SELECT id FROM users WHERE parent_id = ? AND active = 1');
export function scopeIds(req) {
  if (req.user.role === 'admin') return null;
  const ids = [req.user.id];
  if (Number(req.user.level) >= 3) {
    for (let i = 0; i < ids.length; i++) for (const u of directReports.all(ids[i])) if (!ids.includes(u.id)) ids.push(u.id);
  } else if (req.user.role === 'mentor') for (const u of directReports.all(req.user.id)) ids.push(u.id);
  return ids;
}
// The same scope as one SQL parameter: `col IN (SELECT value FROM json_each(?))`
// takes it, so a query keeps one placeholder however many people are in scope.
export const scopeUser = (req) => { const ids = scopeIds(req); return ids && JSON.stringify(ids); };
export const IN_SCOPE = 'IN (SELECT value FROM json_each(?))';
// Whose personal numbers (monthly, invoice, logs): an admin may pick anyone,
// a mentor anyone in their scope, everyone else only themselves.
export function targetUser(req) {
  const asked = req.query.userId ? Number(req.query.userId) : null;
  if (!asked) return req.user.id;
  const ids = scopeIds(req);
  if (!ids || ids.includes(asked)) return asked;
  throw Object.assign(new Error('You can only see your own payouts and those of the people mapped to you'), { status: 403 });
}
