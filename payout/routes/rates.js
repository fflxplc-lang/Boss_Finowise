import { Router } from 'express';
import multer from 'multer';
import { createRequire } from 'node:module';
import { db, audit, tx } from '../db.js';
import { requireAdmin } from '../auth.js';
import { parseTable, cell } from '../parsers/registrar.js';
import { clean, upper, num } from '../util.js';
import { standardName } from '../services/mapping.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Pull "<scheme name> ... <rate>%" lines out of an AMC brokerage-structure PDF.
export function extractRatesFromText(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = clean(raw);
    if (line.length < 8 || !/fund|plan|scheme|etf|fof|index|portfolio/i.test(line)) continue;
    const m = line.match(/^(.*?[A-Za-z)].*?)\s+(\d{1,2}(?:\.\d{1,3})?)\s*%/) || line.match(/^(.*?[A-Za-z)])\s+(\d?\.\d{1,3})(?:\s|$)/);
    if (!m) continue;
    const rate = Number(m[2]);
    if (!(rate > 0 && rate < 5)) continue;
    const scheme = m[1].replace(/^\d+[.)]\s*/, '').replace(/[-–:|]+$/, '').trim();
    if (scheme.length > 4) out.push({ scheme, rate });
  }
  return out;
}

function guessAmc(fileName, text) {
  const base = fileName.replace(/\.[a-z]+$/i, '').replace(/[_-]+/g, ' ');
  const known = db.prepare("SELECT DISTINCT standard FROM name_map WHERE kind = 'amc'").all().map((x) => x.standard);
  const hay = upper(`${base} ${text.slice(0, 600)}`);
  const hit = known.filter((k) => k.length > 2 && hay.includes(k)).sort((a, b) => b.length - a.length)[0];
  return hit || upper(base.split(' ')[0]);
}

r.post('/upload', requireAdmin, upload.array('files', 20), async (req, res, next) => {
  try {
    const period = req.body.period || new Date().toISOString().slice(0, 7);
    let total = 0;
    const perFile = [];
    for (const f of req.files || []) {
      let rows = [];
      let amc = req.body.amc || '';
      if (/\.pdf$/i.test(f.originalname)) {
        const { text } = await pdfParse(f.buffer);
        amc = amc || guessAmc(f.originalname, text);
        rows = extractRatesFromText(text).map((x) => ({ ...x, amc }));
      } else {
        const t = parseTable(f.buffer, f.originalname);
        rows = t.data.map((row) => ({
          amc: clean(cell(row, t.cols, 'amc')) || amc || guessAmc(f.originalname, ''),
          scheme: clean(cell(row, t.cols, 'scheme')),
          rate: num(cell(row, t.cols, 'rate')),
        })).filter((x) => x.scheme && x.rate > 0);
      }
      tx(() => {
        const ins = db.prepare('INSERT INTO rates(amc, scheme, period, rate, source) VALUES(?, ?, ?, ?, ?)');
        for (const x of rows) ins.run(standardName('amc', x.amc), x.scheme, period, x.rate, f.originalname);
      });
      total += rows.length;
      perFile.push({ file: f.originalname, schemes: rows.length });
    }
    audit(req.user, 'RATES_UPLOAD', `${total} scheme rate(s) extracted from ${perFile.length} file(s) for ${period}`);
    res.json({ total, files: perFile });
  } catch (e) { next(e); }
});

r.get('/', (req, res) => {
  const { q = '', amc = '', month = '', year = '', current = '1' } = req.query;
  let sql = `SELECT r.* FROM rates r WHERE (r.scheme LIKE ? OR r.amc LIKE ?)`;
  const args = [`%${q}%`, `%${q}%`];
  if (amc) { sql += ' AND r.amc = ?'; args.push(amc); }
  if (year) { sql += ' AND r.period LIKE ?'; args.push(`${year}-%`); }
  if (month) { sql += ' AND r.period LIKE ?'; args.push(`%-${String(month).padStart(2, '0')}`); }
  if (current === '1') sql += ` AND r.id = (SELECT r2.id FROM rates r2 WHERE r2.scheme = r.scheme AND r2.amc = r.amc ORDER BY r2.period DESC, r2.id DESC LIMIT 1)`;
  sql += ' ORDER BY r.period DESC, r.amc, r.scheme LIMIT 2000';
  const rows = db.prepare(sql).all(...args);
  const stats = db.prepare('SELECT COUNT(DISTINCT amc || scheme) schemes, COUNT(*) versions, COUNT(DISTINCT amc) amcs FROM rates').get();
  const amcs = db.prepare('SELECT DISTINCT amc FROM rates ORDER BY amc').all().map((x) => x.amc);
  res.json({ rows, stats, amcs });
});

r.get('/history', (req, res) => {
  res.json(db.prepare('SELECT * FROM rates WHERE amc = ? AND scheme = ? ORDER BY period DESC, id DESC').all(req.query.amc, req.query.scheme));
});

r.put('/:id', requireAdmin, (req, res) => {
  const { rate, scheme, period } = req.body;
  db.prepare('UPDATE rates SET rate = COALESCE(?, rate), scheme = COALESCE(?, scheme), period = COALESCE(?, period) WHERE id = ?')
    .run(rate != null ? Number(rate) : null, scheme || null, period || null, req.params.id);
  audit(req.user, 'RATE_UPDATE', `Rate #${req.params.id} updated to ${rate}%`);
  res.json({ ok: true });
});

r.post('/delete', requireAdmin, (req, res) => {
  const ids = (req.body.ids || []).map(Number);
  if (ids.length) db.prepare(`DELETE FROM rates WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  audit(req.user, 'RATE_DELETE', `${ids.length} rate row(s) deleted`);
  res.json({ ok: true });
});

r.post('/reset', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM rates').run();
  audit(req.user, 'RATE_RESET', 'Brokerage rate master reset');
  res.json({ ok: true });
});

export default r;
