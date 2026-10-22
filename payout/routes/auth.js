import { Router } from 'express';
import { db } from '../db.js';

const r = Router();

r.get('/me', (req, res) => {
  res.json({ ...publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)), role: req.user.role });
});

export function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  for (const k of ['bank', 'address', 'extra_levels', 'custom_split']) {
    try { rest[k] = rest[k] ? JSON.parse(rest[k]) : null; } catch { rest[k] = null; }
  }
  return rest;
}

export default r;
