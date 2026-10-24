// The payout engine as one Express router, mounted by the CRM at /api/payout.
// `currentAccount(req)` returns the CRM account signed in on this request
// ({ email, role, name }), or nothing.
import express from 'express';
import './db.js';
import { bindUser } from './auth.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import importRoutes from './routes/imports.js';
import userRoutes from './routes/users.js';
import clientRoutes from './routes/clients.js';
import reportRoutes from './routes/reports.js';
import performanceRoutes from './routes/performance.js';
import rateRoutes from './routes/rates.js';
import partnerRoutes from './routes/partner.js';
import payoutRoutes from './routes/payouts.js';
import auditRoutes from './routes/audit.js';
import settingsRoutes from './routes/settings.js';

export function createPayoutRouter({ currentAccount }) {
  const r = express.Router();
  r.use(bindUser(currentAccount));
  r.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  r.use('/auth', authRoutes);
  r.use('/dashboard', dashboardRoutes);
  r.use('/imports', importRoutes);
  r.use('/users', userRoutes);
  r.use('/clients', clientRoutes);
  r.use('/reports/performance', performanceRoutes);
  r.use('/reports', reportRoutes);
  r.use('/rates', rateRoutes);
  r.use('/partner', partnerRoutes);
  r.use('/payouts', payoutRoutes);
  r.use('/audit', auditRoutes);
  r.use('/settings', settingsRoutes);
  r.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  r.use((err, _req, res, _next) => {
    console.error('[payout]', err);
    res.status(err.status || 400).json({ error: err.message || 'Something went wrong' });
  });
  return r;
}
