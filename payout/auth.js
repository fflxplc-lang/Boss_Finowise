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

// Admins see everything; everyone else is scoped to their own earnings.
export const scopeUser = (req) => (req.user.role === 'admin' ? null : req.user.id);
