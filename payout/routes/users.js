import { Router } from 'express';
import { db, audit, tx, LEVEL_NAMES } from '../db.js';
import { requireAdmin, scopeIds, scopeUser, IN_SCOPE } from '../auth.js';
import { publicUser } from './auth.js';
import { recalculate, rebuildHierarchies } from '../services/payout.js';
import { parseJSON } from '../util.js';

const r = Router();

// Admins list the whole team; anyone else only the people in their own scope.
r.get('/', (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const scope = scopeUser(req);
  const rows = db.prepare(`
    SELECT u.*, p.name parent_name,
      (SELECT COUNT(DISTINCT c.id) FROM clients c, json_each(c.hierarchy) j WHERE j.value = u.id) clients
    FROM users u LEFT JOIN users p ON p.id = u.parent_id
    WHERE (u.name LIKE ? OR u.email LIKE ? OR COALESCE(u.code,'') LIKE ?) ${scope ? `AND u.id ${IN_SCOPE}` : ''}
    ORDER BY u.level, u.name`).all(q, q, q, ...(scope ? [scope] : []));
  res.json(rows.map((u) => ({ ...publicUser(u), parent_name: u.parent_name, clients: u.clients, level_name: LEVEL_NAMES[u.level] })));
});

r.get('/levels', (_req, res) => res.json(LEVEL_NAMES));

r.get('/:id', (req, res) => {
  const ids = scopeIds(req);
  if (ids && !ids.includes(Number(req.params.id))) throw Object.assign(new Error('Not in your team'), { status: 403 });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw new Error('User not found');
  res.json(publicUser(u));
});

function fieldsFrom(body) {
  const levels = (body.extra_levels || []).map(Number).filter((n) => n >= 1 && n <= 7);
  return {
    name: String(body.name || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    code: body.code?.trim() || null,
    gst: body.gst?.trim() || null,
    pan: body.pan?.trim()?.toUpperCase() || null,
    parent_id: body.parent_id ? Number(body.parent_id) : null,
    sharing_pct: Number(body.sharing_pct) || 0,
    role: ['admin', 'mentor', 'ops', 'partner'].includes(body.role) ? body.role : 'ops',
    level: Math.min(7, Math.max(1, Number(body.level) || 1)),
    extra_levels: JSON.stringify(levels),
    bank: JSON.stringify(body.bank || {}),
    address: JSON.stringify(body.address || {}),
    arn: body.arn || null, arn_valid: body.arn_valid || null,
    euin: body.euin || null, euin_valid: body.euin_valid || null,
  };
}

r.post('/', requireAdmin, (req, res) => {
  const f = fieldsFrom(req.body);
  if (!f.name || !f.email) throw new Error('Full name and access email are required');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(f.email)) throw new Error('A user with this email already exists');
  const cols = Object.keys(f);
  // No password: they sign in to the CRM with this email.
  const id = db.prepare(`INSERT INTO users(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`)
    .run(...Object.values(f)).lastInsertRowid;
  audit(req.user, 'USER_CREATE', `Created user ${f.name} (${f.email}) at level ${f.level}`);
  if (req.body.recalculate) recalculate();
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
});

r.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const isSelf = id === req.user.id;
  if (req.user.role !== 'admin' && !isSelf) throw Object.assign(new Error('Admin access required'), { status: 403 });
  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!cur) throw new Error('User not found');
  let f = fieldsFrom({ ...publicUser(cur), ...req.body });
  if (req.user.role !== 'admin') {
    // Non-admins may edit their own profile, bank and address only.
    f = { name: f.name, bank: f.bank, address: f.address, gst: f.gst, pan: f.pan, arn: f.arn, arn_valid: f.arn_valid, euin: f.euin, euin_valid: f.euin_valid };
  }
  if (f.parent_id === id) throw new Error('A user cannot report to themselves');
  if (req.body.signature !== undefined) f.signature = req.body.signature;
  db.prepare(`UPDATE users SET ${Object.keys(f).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(f), id);
  // A new level or manager flows through every client this person is on, then their payouts.
  const moved = f.level !== undefined && (Number(f.level) !== cur.level || Number(f.parent_id || 0) !== Number(cur.parent_id || 0));
  const clientIds = moved ? rebuildHierarchies([id]) : [];
  audit(req.user, 'USER_UPDATE', `Updated user ${f.name || cur.name}${moved ? ` (L${cur.level} → L${f.level}; ${clientIds.length} client mapping(s) updated)` : ''}`);
  const calc = req.body.recalculate ? recalculate() : moved ? recalculate() : null;
  res.json({ ...publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)), recalculated: calc?.recalculated, clientsUpdated: clientIds.length });
});

r.put('/:id/sharing', requireAdmin, (req, res) => {
  const split = req.body.custom_split;
  db.prepare('UPDATE users SET custom_split = ? WHERE id = ?').run(split && Object.keys(split).length ? JSON.stringify(split) : null, req.params.id);
  const u = db.prepare('SELECT name FROM users WHERE id = ?').get(req.params.id);
  audit(req.user, 'USER_SHARING', `Custom sharing ${split ? 'set' : 'cleared'} for ${u?.name}`);
  const calc = req.body.recalculate ? recalculate() : null;
  res.json({ ok: true, recalculated: calc?.recalculated });
});

r.delete('/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new Error('You cannot delete your own account');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw new Error('User not found');
  let reports = [];
  tx(() => {
    // Remove the user from every client hierarchy, then the account.
    for (const c of db.prepare('SELECT c.id, c.hierarchy FROM clients c, json_each(c.hierarchy) j WHERE j.value = ?').all(id)) {
      const h = parseJSON(c.hierarchy, {});
      for (const k of Object.keys(h)) if (Number(h[k]) === id) delete h[k];
      db.prepare('UPDATE clients SET hierarchy = ? WHERE id = ?').run(JSON.stringify(h), c.id);
    }
    reports = db.prepare('SELECT id FROM users WHERE parent_id = ?').all(id).map((x) => x.id);
    db.prepare('UPDATE users SET parent_id = ? WHERE parent_id = ?').run(u.parent_id, id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
  // Their reports now sit under the deleted person's manager: rebuild those clients' mappings.
  rebuildHierarchies(reports);
  recalculate();
  audit(req.user, 'USER_DELETE', `Deleted user ${u.name} (${u.email})`);
  res.json({ ok: true });
});

export default r;
