// Parsers for CAMS and KFintech (Karvy) registrar exports.
// Column names vary between report versions, so each field is matched against a list
// of known header aliases (compared after stripping case, spaces and punctuation).
import XLSX from 'xlsx';
import { norm, clean, upper, num, toISODate } from '../util.js';

const ALIASES = {
  folio: ['foliono', 'folio', 'folionumber', 'foliochk', 'acno', 'accountno', 'accountnumber', 'foliono.', 'foliodetails'],
  investor: ['invname', 'investorname', 'investor', 'name', 'invstname', 'clientname', 'firstholdername', 'applicantname', 'shname', 'holdername'],
  pan: ['pan', 'panno', 'pan1', 'panno1', 'pannumber', 'itpanno', 'itpan', 'firstholderpan', 'invpan', 'panofinvestor'],
  amc: ['amccode', 'amc', 'amcname', 'fund', 'fundname', 'mfname', 'amcdesc'],
  scheme: ['schemename', 'funddescription', 'schemedescription', 'schemedesc', 'scheme', 'schname', 'prodname', 'schemecode', 'product', 'fundscheme'],
  date: ['traddate', 'trxndate', 'transactiondate', 'tradedate', 'postdate', 'navdate', 'date', 'trdate', 'processdate', 'brokdate', 'fromdate'],
  type: ['trxntype', 'trxntypename', 'transactiondescription', 'transactiontype', 'trtype', 'trxnnature', 'trantype', 'description', 'trdesc', 'trxndesc'],
  amount: ['amount', 'amt', 'trxnamount', 'transactionamount', 'grossamount', 'value', 'amountrs'],
  schemeCode: ['prodcode', 'productcode', 'schemecode', 'txnschcode', 'product'],
  units: ['units', 'unit', 'trxnunits', 'noofunits'],
  nav: ['nav', 'purprice', 'price', 'navrs'],
  brokerage: ['brokamt', 'brkageamt', 'brokerage', 'brokerageamount', 'brokerageamt', 'brokerageinrs', 'brokeragers', 'brokrage', 'commission', 'commamt', 'trailamount', 'trail', 'netbrokerage', 'grossbrokerage', 'totalbrokerage', 'brokamount', 'payableamount'],
  aum: ['avgassets', 'averageassets', 'avgaum', 'aum', 'assets', 'plotassets', 'currentvalue', 'marketvalue', 'avgasset', 'averageaum', 'closingassets'],
  email: ['email', 'emailid', 'emailaddress', 'invemail', 'mail'],
  mobile: ['mobile', 'mobileno', 'mobilenumber', 'phone', 'phoneno', 'contactno', 'mobno', 'telephone'],
  // Partner (MOFSL) statements
  code: ['clientcode', 'code', 'clientid', 'ucc', 'accountcode'],
  segment: ['segment', 'exchange', 'exchangesegment', 'product'],
  mentor: ['mentorbrokerage', 'yourshare', 'apshare', 'subbrokershare', 'mentorshare', 'ourshare', 'franchiseshare'],
  partnerShare: ['partnerbrokerage', 'partnershare', 'mofslshare', 'companyshare', 'brokerretained'],
  total: ['totalbrokerage', 'grossbrokerage', 'brokerage', 'total', 'netbrokerage'],
  leadBy: ['leadby', 'leadbroughtby', 'leadsource', 'leadowner', 'leadgeneratedby'],
  rm: ['rmname', 'rm', 'relationshipmanager', 'subbroker', 'rmcode', 'rmarn'],
  bm: ['bmname', 'bm', 'branchmanager', 'bmcode', 'bmarn'],
  rate: ['rate', 'grossrate', 'brokeragerate', 'trailrate', 'trail', 'totaltrail', 'year1', 'firstyear', 'trailyr1', 'rateperannum', '1styeartrail'],
  clientId: ['clientid', 'id', 'wfclientid'],
};

// Aliases are listed in order of preference: the earliest alias that matches a header wins,
// so "Transaction Date" beats "From Date" in a KFintech file that has both.
function resolveColumns(headers) {
  const keys = headers.map(norm);
  const map = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    // exact match first, then "header starts with alias" for things like "Amount (in Rs.)"
    let idx = -1;
    for (const a of aliases) { idx = keys.indexOf(a); if (idx >= 0) break; }
    if (idx < 0) {
      for (const a of aliases) {
        if (a.length <= 3) continue;
        idx = keys.findIndex((k) => k.startsWith(a));
        if (idx >= 0) break;
      }
    }
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

// CAMS often sends a tab-separated text file named .xls. Real .xls, .xlsx and
// .dbf files carry NUL bytes near the top (or start "PK"); text never does.
function looksLikeText(buffer) {
  const head = buffer.subarray(0, 4096);
  if (head[0] === 0x50 && head[1] === 0x4b) return false;
  return head.length > 0 && !head.includes(0);
}

export function readSheet(buffer, fileName = '') {
  const isText = /\.(csv|txt|tsv)$/i.test(fileName) || looksLikeText(buffer);
  // Text is read here, not by SheetJS: SheetJS reads 12/08/2026 as 8 December (US
  // order) where Indian registrar files are day-first (toISODate parses the text
  // day-first), and it builds an object for every cell, which for a 60 MB CAMS
  // brokerage file of 110 columns is more memory than a small server has.
  if (isText) return readText(buffer);
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  // Pick the sheet with the most rows (registrar exports sometimes ship a cover sheet).
  let best = null;
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true });
    if (!best || rows.length > best.length) best = rows;
  }
  return best || [];
}

// One line of delimited text into its cells; quotes as in CSV ("a, b" and "").
function splitLine(line, sep) {
  if (line.indexOf('"') < 0) return line.split(sep);
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Tab- or comma-separated text, line by line. Below the header row only the
// columns a parser can use are kept (the rest are left empty), so a wide file
// costs a fraction of its full size in memory.
function readText(buffer) {
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstEnd = text.indexOf('\n');
  const first = firstEnd < 0 ? text : text.slice(0, firstEnd);
  const sep = (first.split('\t').length >= first.split(',').length) ? '\t' : ',';
  const rows = [];
  let keep = null, width = 0, at = 0;
  while (at < text.length) {
    let end = text.indexOf('\n', at);
    if (end < 0) end = text.length;
    let line = text.slice(at, end);
    at = end + 1;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    const cells = splitLine(line, sep);
    if (!keep) {
      rows.push(cells);
      const cols = rows.length <= 25 ? resolveColumns(cells.map(String)) : null;
      if (cols && Object.keys(cols).length >= 2 && ['folio', 'code', 'clientId', 'pan'].some((f) => f in cols)) { keep = [...new Set(Object.values(cols))]; width = cells.length; }
      continue;
    }
    const row = new Array(Math.max(width, cells.length)).fill('');
    for (const i of keep) if (i < cells.length) row[i] = cells[i];
    rows.push(row);
  }
  return rows;
}

// Finds the header row (first row in the top 25 that matches at least 2 known fields).
export function tabulate(rows, required = []) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cols = resolveColumns(rows[i].map(String));
    const hits = Object.keys(cols).length;
    if (hits >= 2 && required.every((r) => r in cols)) {
      const data = rows.slice(i + 1).filter((r) => r.some((c) => String(c).trim() !== ''));
      return { cols, headers: rows[i].map(String), data };
    }
  }
  return null;
}

const get = (row, cols, f) => (f in cols ? row[cols[f]] : '');

// KFintech's "Fund" column is a code (e.g. 127), so when the scheme name starts with a known
// fund house, use that name; names match what AMC codes standardize to.
const FUND_HOUSES = [
  ['ADITYA BIRLA', 'ADITYA BIRLA SUN LIFE'], ['ABSL', 'ADITYA BIRLA SUN LIFE'], ['AXIS', 'AXIS'], ['BANDHAN', 'BANDHAN'],
  ['BANK OF INDIA', 'BANK OF INDIA'], ['BARODA BNP', 'BARODA BNP PARIBAS'], ['BAJAJ FINSERV', 'BAJAJ FINSERV'],
  ['CANARA ROBECO', 'CANARA ROBECO'], ['DSP', 'DSP'], ['EDELWEISS', 'EDELWEISS'], ['FRANKLIN', 'FRANKLIN TEMPLETON'],
  ['HDFC', 'HDFC'], ['HSBC', 'HSBC'], ['HELIOS', 'HELIOS'], ['ICICI', 'ICICI PRUDENTIAL'], ['INVESCO', 'INVESCO'],
  ['ITI', 'ITI'], ['JM ', 'JM FINANCIAL'], ['KOTAK', 'KOTAK'], ['LIC', 'LIC'], ['MAHINDRA', 'MAHINDRA MANULIFE'],
  ['MIRAE', 'MIRAE'], ['MOTILAL', 'MOTILAL OSWAL'], ['NAVI', 'NAVI'], ['NIPPON', 'NIPPON INDIA'], ['NJ ', 'NJ'],
  ['OLD BRIDGE', 'OLD BRIDGE'], ['PARAG PARIKH', 'PPFAS'], ['PPFAS', 'PPFAS'], ['PGIM', 'PGIM INDIA'], ['QUANTUM', 'QUANTUM'],
  ['QUANT ', 'QUANT'], ['SAMCO', 'SAMCO'], ['SBI', 'SBI'], ['SHRIRAM', 'SHRIRAM'], ['SUNDARAM', 'SUNDARAM'], ['TATA', 'TATA'],
  ['TAURUS', 'TAURUS'], ['TRUST', 'TRUST'], ['UNION', 'UNION'], ['UTI', 'UTI'], ['WHITEOAK', 'WHITEOAK CAPITAL'],
  ['360 ONE', '360 ONE'], ['GROWW', 'GROWW'], ['ZERODHA', 'ZERODHA'],
];
function amcOf(row, cols) {
  const scheme = upper(get(row, cols, 'scheme'));
  const hit = scheme && FUND_HOUSES.find(([p]) => scheme.startsWith(p));
  return hit ? hit[1] : clean(get(row, cols, 'amc'));
}

export function parseTransactions(buffer, fileName) {
  const t = tabulate(readSheet(buffer, fileName), ['folio']);
  if (!t) throw new Error('Could not find a transaction header row (need at least a Folio column).');
  return t.data.map((r) => ({
    folio: clean(get(r, t.cols, 'folio')),
    investor: clean(get(r, t.cols, 'investor')),
    pan: upper(get(r, t.cols, 'pan')),
    amc: amcOf(r, t.cols),
    scheme: clean(get(r, t.cols, 'scheme')),
    scheme_code: upper(get(r, t.cols, 'schemeCode')),
    trxn_date: toISODate(get(r, t.cols, 'date')),
    trxn_type: clean(get(r, t.cols, 'type')),
    amount: num(get(r, t.cols, 'amount')),
    units: num(get(r, t.cols, 'units')),
    nav: num(get(r, t.cols, 'nav')),
  })).filter((r) => r.folio);
}

export function parseFolioMaster(buffer, fileName) {
  const t = tabulate(readSheet(buffer, fileName), ['folio']);
  if (!t) throw new Error('Could not find a folio master header row (need a Folio column).');
  return t.data.map((r) => ({
    folio: clean(get(r, t.cols, 'folio')),
    investor: clean(get(r, t.cols, 'investor')),
    pan: upper(get(r, t.cols, 'pan')),
    email: clean(get(r, t.cols, 'email')).toLowerCase(),
    mobile: clean(get(r, t.cols, 'mobile')),
    amc: amcOf(r, t.cols),
    scheme: clean(get(r, t.cols, 'scheme')),
    scheme_code: upper(get(r, t.cols, 'schemeCode')),
  })).filter((r) => r.folio);
}

export function parseBrokerage(buffer, fileName) {
  const t = tabulate(readSheet(buffer, fileName), ['folio', 'brokerage']);
  if (!t) throw new Error('Could not find a brokerage header row (need Folio and Brokerage columns).');
  return t.data.map((r) => ({
    folio: clean(get(r, t.cols, 'folio')),
    investor: clean(get(r, t.cols, 'investor')),
    pan: upper(get(r, t.cols, 'pan')),
    amc: amcOf(r, t.cols),
    scheme: clean(get(r, t.cols, 'scheme')),
    scheme_code: upper(get(r, t.cols, 'schemeCode')),
    trxn_date: toISODate(get(r, t.cols, 'date')),
    trxn_type: clean(get(r, t.cols, 'type')),
    amount: num(get(r, t.cols, 'brokerage')),
    aum: num(get(r, t.cols, 'aum')),
  })).filter((r) => r.folio);
}

export function parsePartner(buffer, fileName) {
  const t = tabulate(readSheet(buffer, fileName), ['code']);
  if (!t) throw new Error('Could not find a partner statement header row (need a Client Code column).');
  return t.data.map((r) => {
    const total = num(get(r, t.cols, 'total'));
    const mentor = num(get(r, t.cols, 'mentor'));
    const partnerShare = 'partnerShare' in t.cols ? num(get(r, t.cols, 'partnerShare')) : total - mentor;
    return {
      code: upper(get(r, t.cols, 'code')),
      client_name: clean(get(r, t.cols, 'investor')),
      segment: upper(get(r, t.cols, 'segment')) || 'GENERAL',
      total, mentor, partner_share: partnerShare,
    };
  }).filter((r) => r.code);
}

// Generic table (for bulk mapping, RM registrar files, payment imports, rate sheets).
export function parseTable(buffer, fileName) {
  const rows = readSheet(buffer, fileName);
  const t = tabulate(rows, []);
  if (!t) return { cols: {}, headers: [], data: [] };
  return t;
}
export { get as cell };
