// Business performance for Partner Journey › Performance: AUM, investors,
// SIPs and the break-ups the back-office dashboard shows, for one person
// ("self") or for them and everyone under them ("team").
import { Router } from 'express';
import { db } from '../db.js';
import { IN_SCOPE } from '../auth.js';
import { shiftPeriod, isRedemption } from '../util.js';
import { LIVE, latestPeriod } from './dashboard.js';

const r = Router();

// Everyone below a person in the reporting tree, however deep.
const children = db.prepare('SELECT id FROM users WHERE parent_id = ? AND active = 1');
function downline(id) {
  const out = [id], seen = new Set(out);
  for (let i = 0; i < out.length; i++) {
    for (const c of children.all(out[i])) if (!seen.has(c.id)) { seen.add(c.id); out.push(c.id); }
  }
  return out;
}

// Whose clients the view covers: null means every client (an admin's team).
export function performanceScope(req) {
  if (req.query.scope === 'self') return [req.user.id];
  if (req.user.role === 'admin') return null;
  return downline(req.user.id);
}

// SEBI's broad buckets. Arbitrage funds are hybrids; liquid funds are debt.
export function broadOf(category = '', scheme = '') {
  if (/retire|child|solution/i.test(scheme)) return 'Solution Oriented';
  if (category === 'Equity') return 'Equity';
  if (category === 'Hybrid' || category === 'Arbitrage') return 'Hybrid';
  if (category === 'Debt' || category === 'Liquid') return 'Debt';
  return 'Other';
}

// The finer category ("Equity: Flexi Cap"), read off the scheme's name.
const SUB = [
  ['Solution Oriented', 'Retirement', /retire/], ['Solution Oriented', 'Children', /child/],
  ['Equity', 'ELSS', /elss|tax ?saver/], ['Equity', 'Flexi Cap', /flexi/], ['Equity', 'Multi Cap', /multi ?cap/],
  ['Equity', 'Large & Mid Cap', /large (&|and) mid/], ['Equity', 'Large Cap', /large ?cap|bluechip|top 100/],
  ['Equity', 'Mid Cap', /mid ?cap/], ['Equity', 'Small Cap', /small ?cap/], ['Equity', 'Focused', /focus/],
  ['Equity', 'Value / Contra', /value|contra/], ['Equity', 'Dividend Yield', /dividend yield/],
  ['Equity', 'Index / ETF', /index|nifty|sensex|etf/],
  ['Equity', 'Sectoral / Thematic', /thematic|sector|infra|pharma|bank|technolog|consumption|manufactur|psu|energy|healthcare|business cycle|innovation/],
  ['Hybrid', 'Arbitrage', /arbitrage/], ['Hybrid', 'Balanced Advantage', /balanced advantage|dynamic asset/],
  ['Hybrid', 'Multi Asset', /multi.?asset/], ['Hybrid', 'Equity Savings', /equity savings/],
  ['Hybrid', 'Conservative', /conservative|regular savings|monthly income/], ['Hybrid', 'Aggressive', /aggressive|hybrid equity|equity (&|and) debt|balanced/],
  ['Debt', 'Liquid', /liquid/], ['Debt', 'Overnight', /overnight/], ['Debt', 'Money Market', /money market/],
  ['Debt', 'Gilt', /gilt/], ['Debt', 'Corporate Bond', /corporate/], ['Debt', 'Banking & PSU', /banking (&|and) psu/],
  ['Debt', 'Credit Risk', /credit/], ['Debt', 'Ultra Short', /ultra short/], ['Debt', 'Short Duration', /short/],
  ['Debt', 'Dynamic Bond', /dynamic bond/],
];
export function subCategoryOf(category = '', scheme = '') {
  const broad = broadOf(category, scheme), s = scheme.toLowerCase();
  const hit = SUB.find(([b, , re]) => b === broad && re.test(s));
  return `${broad}: ${hit ? hit[1] : 'Others'}`;
}

const SIP = /sip|systematic/i;
const ELSS = /elss|tax ?saver/i;

r.get('/', (req, res) => {
  const ids = performanceScope(req), uid = ids && JSON.stringify(ids);
  // A client is in view when anyone in scope sits anywhere on its hierarchy.
  const own = (col) => (uid ? `AND ${col} IN (SELECT c.id FROM clients c, json_each(c.hierarchy) j WHERE j.value ${IN_SCOPE})` : '');
  const p = (...a) => (uid ? [...a, uid] : a);

  const latest = latestPeriod();
  const first = shiftPeriod(latest, -47);
  // One AUM figure per folio and scheme per month: a brokerage file can carry
  // several rows for the same holding, each repeating its AUM.
  const holdings = (where) => `SELECT b.period, b.folio, b.scheme, MAX(b.aum) aum, MAX(b.client_id) client_id,
      MAX(b.investor) investor, MAX(b.pan) pan, MAX(b.amc) amc, MAX(b.category) category
    FROM brokerage b ${LIVE} WHERE ${where} ${own('b.client_id')} GROUP BY b.period, b.folio, b.scheme`;

  const monthly = db.prepare(`SELECT period, SUM(aum) aum FROM (${holdings('b.period BETWEEN ? AND ?')}) GROUP BY period ORDER BY period`)
    .all(...p(first, latest));
  const aumAt = (m) => monthly.find((x) => x.period === m)?.aum || 0;
  const now = db.prepare(holdings('b.period = ?')).all(...p(latest)).filter((h) => h.aum > 0);

  const key = (h) => (h.client_id ? `c${h.client_id}` : h.pan ? `p${h.pan.toUpperCase()}` : `n${(h.investor || '').toUpperCase()}`);
  const clientRow = db.prepare('SELECT name, pan FROM clients WHERE id = ?');
  const investors = new Map(), schemes = new Map(), cats = new Map(), broad = new Map(), amcs = new Map();
  let total = 0, elss = new Set();
  for (const h of now) {
    total += h.aum;
    const k = key(h);
    if (!investors.has(k)) {
      const c = h.client_id ? clientRow.get(h.client_id) : null;
      investors.set(k, { key: k, clientId: h.client_id || null, name: c?.name || h.investor || '—', pan: (c?.pan || h.pan || '').toUpperCase(), aum: 0, invested: 0 });
    }
    investors.get(k).aum += h.aum;
    if (ELSS.test(h.scheme || '')) elss.add(k);
    const s = schemes.get(h.scheme) || { scheme: h.scheme, amc: h.amc, aum: 0 };
    s.aum += h.aum; schemes.set(h.scheme, s);
    const sub = subCategoryOf(h.category, h.scheme), b = broadOf(h.category, h.scheme);
    cats.set(sub, (cats.get(sub) || 0) + h.aum);
    broad.set(b, (broad.get(b) || 0) + h.aum);
    amcs.set(h.amc || 'Other', (amcs.get(h.amc || 'Other') || 0) + h.aum);
  }

  // Money put in: purchases less redemptions, over every transaction on file.
  const tx = db.prepare(`SELECT x.client_id, x.pan, x.investor, x.amc, x.trxn_type, x.trxn_date, x.amount FROM transactions x
    JOIN batches t ON t.id = x.batch_id AND t.status = 'live' WHERE 1 ${own('x.client_id')}`).all(...p());
  let invested = 0;
  for (const x of tx) {
    const amt = Math.abs(Number(x.amount) || 0) * (isRedemption(x.trxn_type) ? -1 : 1);
    invested += amt;
    const inv = investors.get(key(x));
    if (inv) inv.invested += amt;
  }

  // SIPs: the instalments in the last month of transaction data.
  const lastTx = tx.reduce((m, x) => (x.trxn_date > m ? x.trxn_date : m), '');
  const since = lastTx ? new Date(new Date(lastTx).getTime() - 30 * 864e5).toISOString().slice(0, 10) : '';
  const sips = tx.filter((x) => lastTx && x.trxn_date > since && SIP.test(x.trxn_type || '') && !isRedemption(x.trxn_type));
  const sipAmount = sips.reduce((s, x) => s + Math.abs(Number(x.amount) || 0), 0);
  const sipByAmc = new Map();
  for (const x of sips) sipByAmc.set(x.amc || 'Other', (sipByAmc.get(x.amc || 'Other') || 0) + Math.abs(Number(x.amount) || 0));

  const prev = aumAt(shiftPeriod(latest, -1));
  const sorted = (m) => [...m].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  res.json({
    scope: req.query.scope === 'self' ? 'self' : 'team',
    people: ids ? ids.length : null,
    latest,
    hasData: monthly.length > 0,
    kpis: {
      aum: total, prevAum: prev, change: prev ? total - prev : 0, changePct: prev ? ((total - prev) / prev) * 100 : 0,
      invested, investors: investors.size, elssInvestors: elss.size,
      sipCount: sips.length, sipAmount, sipAverage: sips.length ? sipAmount / sips.length : 0, sipSince: since, sipTo: lastTx,
    },
    monthly,
    investors: [...investors.values()].sort((a, b) => b.aum - a.aum),
    schemes: [...schemes.values()].sort((a, b) => b.aum - a.aum),
    broad: sorted(broad), categories: sorted(cats), amcs: sorted(amcs), sipByAmc: sorted(sipByAmc),
  });
});

export default r;
