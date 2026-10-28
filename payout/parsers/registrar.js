// Parsers for CAMS and KFintech (Karvy) registrar exports.
// Column names vary between report versions, so each field is matched against a list
// of known header aliases (compared after stripping case, spaces and punctuation).
import XLSX from 'xlsx';
import zlib from 'node:zlib';
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
  // Text and .xlsx are read here, not by SheetJS: SheetJS reads 12/08/2026 as 8 December
  // (US order) where Indian registrar files are day-first (toISODate parses the text
  // day-first), and it builds an object for every cell, which for a 60 MB CAMS
  // brokerage file of 110 columns is more memory than a small server has.
  if (isText) return readText(buffer);
  const xlsx = readXlsx(buffer);
  if (xlsx) return xlsx;
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, dense: true });
  // Pick the sheet with the most rows (registrar exports sometimes ship a cover sheet).
  let best = null;
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true });
    if (!best || rows.length > best.length) best = rows;
  }
  return best || [];
}

// Collects rows the same way for text and .xlsx: rows are kept whole until the header
// row turns up (within the top 25), then only the columns a parser can use are kept.
function collector() {
  const rows = [];
  let keep = null, width = 0;
  return {
    rows,
    // Below the header only cells at these indexes are wanted (null = all).
    wanted: () => keep,
    push(cells) {
      if (!keep) {
        rows.push(cells);
        const cols = rows.length <= 25 ? resolveColumns(cells.map(String)) : null;
        if (cols && Object.keys(cols).length >= 2 && ['folio', 'code', 'clientId', 'pan'].some((f) => f in cols)) { keep = [...new Set(Object.values(cols))]; width = cells.length; }
        return;
      }
      const row = new Array(Math.max(width, cells.length)).fill('');
      for (const i of keep) if (i < cells.length) row[i] = cells[i];
      rows.push(row);
    },
  };
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

// Tab- or comma-separated text, line by line.
function readText(buffer) {
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstEnd = text.indexOf('\n');
  const first = firstEnd < 0 ? text : text.slice(0, firstEnd);
  const sep = (first.split('\t').length >= first.split(',').length) ? '\t' : ',';
  const out = collector();
  let at = 0;
  while (at < text.length) {
    let end = text.indexOf('\n', at);
    if (end < 0) end = text.length;
    let line = text.slice(at, end);
    at = end + 1;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    out.push(splitLine(line, sep));
  }
  return out.rows;
}

// The entries of a zip file, from its central directory: name -> { method, size, data }.
function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    out.set(name, { method, size, data: buf.subarray(start, start + csize) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// Inflated into a Buffer, which lives outside the JavaScript heap: a 60 MB .xlsx
// holds several hundred MB of sheet XML, more than one string can.
function unzip(entry) {
  if (!entry) return null;
  return entry.method === 0 ? entry.data : zlib.inflateRawSync(entry.data);
}

const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (XML_ENT[e] ?? m))));
// All <t> texts of one string item (rich text is split into runs; phonetic hints are not text).
const textOf = (xml) => {
  let s = '';
  const re = /<t(?:\s[^>]*)?>([^<]*)<\/t>|<t\s*\/>|<rPh\b[\s\S]*?<\/rPh>/g;
  for (let m; (m = re.exec(xml));) if (m[1] !== undefined) s += m[1];
  return unxml(s);
};

// Each piece of buf between <open ...> and </close>, as a string, without making
// one string of the whole buffer.
function eachElement(buf, open, close, fn) {
  const o = Buffer.from(open), c = Buffer.from(close);
  let at = 0;
  for (;;) {
    let s = buf.indexOf(o, at);
    // "<si" must not match "<sir…"; the next character ends the tag name.
    while (s >= 0 && !/[\s>/]/.test(String.fromCharCode(buf[s + o.length]))) s = buf.indexOf(o, s + 1);
    if (s < 0) return;
    const selfClose = buf.indexOf('>', s);
    if (selfClose > 0 && buf[selfClose - 1] === 0x2f) { fn(buf.toString('utf8', s, selfClose + 1)); at = selfClose + 1; continue; }
    const e = buf.indexOf(c, s);
    if (e < 0) return;
    fn(buf.toString('utf8', s, e + c.length));
    at = e + c.length;
  }
}

const colIndex = (ref) => {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const ch = ref.charCodeAt(i);
    if (ch < 65 || ch > 90) break;
    n = n * 26 + ch - 64;
  }
  return n - 1;
};

// .xlsx read straight from its XML: the sheet with the most data, one row at a time,
// keeping only the cells collector() asks for. Returns null for anything else.
function readXlsx(buffer) {
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return null;
  const zip = zipEntries(buffer);
  if (!zip) return null;
  const sheets = [...zip.keys()].filter((k) => /^xl\/worksheets\/[^/]+\.xml$/i.test(k));
  if (!sheets.length) return null;
  sheets.sort((a, b) => zip.get(b).size - zip.get(a).size);
  const strings = [];
  const sst = unzip(zip.get('xl/sharedStrings.xml'));
  if (sst) eachElement(sst, '<si', '</si>', (x) => strings.push(textOf(x)));
  const sheet = unzip(zip.get(sheets[0]));
  const out = collector();
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let lastRow = 0;
  eachElement(sheet, '<row', '</row>', (xml) => {
    const rn = Number((/^<row\b[^>]*?\sr="(\d+)"/.exec(xml) || [])[1]) || lastRow + 1;
    // Rows the file leaves out are blank rows; keep their place before the header.
    for (; lastRow + 1 < rn && !out.wanted(); lastRow++) out.push([]);
    lastRow = rn;
    const want = out.wanted();
    const cells = [];
    let next = 0;
    cellRe.lastIndex = 0;
    for (let m; (m = cellRe.exec(xml));) {
      const attrs = m[1];
      const ref = /\sr="([A-Z]+)/.exec(attrs);
      const i = ref ? colIndex(ref[1]) : next;
      next = i + 1;
      if (want && !want.includes(i)) continue;
      const body = m[2] || '';
      const t = (/\st="(\w+)"/.exec(attrs) || [])[1] || 'n';
      const v = /<v>([^<]*)<\/v>/.exec(body);
      let val = '';
      if (t === 's') val = v ? (strings[Number(v[1])] ?? '') : '';
      else if (t === 'inlineStr') val = textOf(body);
      else if (t === 'str' || t === 'e') val = v ? unxml(v[1]) : '';
      else if (t === 'b') val = v ? v[1] === '1' : '';
      else val = v && v[1] !== '' ? Number(v[1]) : '';
      while (cells.length < i) cells.push('');
      cells[i] = val;
    }
    out.push(cells);
  });
  return out.rows;
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
