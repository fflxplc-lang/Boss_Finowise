/* NJ CHANGED THE SHAPE OF ITS AUM REPORT.

   tests/fixtures/NJ_AUM_InvestorWise.xls is the file the firm sent —
   not a reconstruction. It is NJ's "Investor Wise AUM Report", and
   three things about it meant nothing in it reached a field:

     · a title line above the heading, carrying the date the figures
       are true of — "( As On 14-10-2026 )";
     · a heading that takes TWO rows. Sr. No., Partner/Employee, Group
       and Investor are named on the first; EQUITY, DEBT, HYBRID,
       PHYSICAL ASSETS, OTHERS and TOTAL on the second, under one
       merged "AUM(₹)" spanning all six. Read a row at a time, the
       sleeve names became the first record and five of the ten columns
       arrived called "Column F" through "Column J";
     · columns BOSS's NJ mapping had never heard of — the investor is
       called "Investor", not "Client Name", and Partner/Employee and
       Group are new.

   What this holds to: the two rows are read as one heading; every
   column of the file reaches a field or is deliberately kept in the
   source row; the money lands in the sleeve it was reported under; the
   two NJ columns that are NOT the firm's own data stay on the snapshot
   instead of rewriting the client; and the date the report is true of
   is the date the snapshot is filed under. */
const fs = require('fs');
const path = require('path');
const {suite} = require('../lib/harness');

const REAL = path.join(__dirname, '..', 'fixtures', 'NJ_AUM_InvestorWise.xls');

/* The same sheet with investors on it, built in the page: the file the
   firm sent is an empty export, and what matters next is what happens
   when it is not. */
const FEED = `async (rows) => {
  const bytes = xlsxWrite([{name:'AUM Report', rows}]);
  const file = new File([bytes], 'NJ AUM filled.xlsx',
    {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const inp = document.createElement('input');
  Object.defineProperty(inp, 'files', {value: [file]});
  await impTakeFile({target: inp});
  return impWiz.err || '';
}`;

const SHEET = [
  ['Investor Wise AUM Report ( As On 14-10-2026 )'],
  ['Sr. No.', 'Partner/Employee', 'Group', 'Investor', 'AUM(₹)'],
  ['', '', '', '', 'EQUITY', 'DEBT', 'HYBRID', 'PHYSICAL ASSETS', 'OTHERS', 'TOTAL'],
  [1, 'NJ-EMP-114', 'ZZ Kulkarni Family', 'ZZ Nilesh Kulkarni',
   '2,88,275', '99,088', '26,795', '0', '0', '4,14,158'],
  [2, 'NJ-EMP-114', 'ZZ Kulkarni Family', 'ZZ Sheetal Kulkarni',
   '1,00,000', '0', '0', '50,000', '0', '1,50,000'],
  [3, 'NJ-PTR-007', '', 'ZZ Ramesh Deshpande', '0', '7,50,000', '0', '0', '12,000', '7,62,000'],
];

suite(async t => {
  await t.home();

  t.section('the file the firm sent');

  await t.step('the heading that takes two rows is read as one heading', async () => {
    if(!fs.existsSync(REAL)) throw new Error('the fixture is missing: ' + REAL);
    await t.eval(()=>{ navigate('import'); openPlatformImport('nj','nj_aum'); });
    await t.wait(250);
    await t.page.setInputFiles('#impFile', REAL);
    await t.wait(1500);
    const r = await t.eval(()=>({err: impWiz.err, kind: impWiz.kind, headers: impWiz.headers,
      rows: impWiz.rows.length, asOn: impWiz.asOn, label: impWiz.kindLabel}));
    if(r.err) throw new Error(r.err);
    if(r.kind !== 'xls') throw new Error('read as ' + r.kind);
    const want = ['Sr. No.','Partner/Employee','Group','Investor',
                  'EQUITY','DEBT','HYBRID','PHYSICAL ASSETS','OTHERS','TOTAL'];
    if(JSON.stringify(r.headers) !== JSON.stringify(want))
      throw new Error('the columns read ' + JSON.stringify(r.headers));
    if(r.rows !== 0) throw new Error('it found ' + r.rows + ' row(s) in an export with none, so the '
      + 'sleeve names are still being read as a record');
    if(r.asOn !== '2026-10-14') throw new Error('the as-on date reads "' + r.asOn + '"');
    if(!/read as one heading/.test(r.label)) throw new Error('it did not say so: ' + r.label);
    return '10 columns off two heading rows, as on 14-10-2026, and no record invented out of the '
      + 'sleeve names — ' + r.label;
  });

  await t.step('every column of it reaches a field, or is kept on purpose', async () => {
    const r = await t.eval(()=>{
      const a = impWiz.analysis = impAnalyse();
      const map = impMapFor('nj_aum');
      return {unknown: a.unknown, missing: a.missing,
        map: impWiz.headers.map(h=>{
          const src = Object.keys(map).find(k=>k.toLowerCase().replace(/[^a-z0-9]/g,'')
                                             === h.toLowerCase().replace(/[^a-z0-9]/g,''));
          return h + ' → ' + (src === undefined ? 'NOTHING' : (map[src] || '(source row only)'));
        })};
    });
    if(r.unknown.length) throw new Error('columns nothing is pointed at: ' + r.unknown.join(', '));
    if(r.missing.length) throw new Error('columns the mapping wants and the file lacks: ' + r.missing.join(', '));
    const bad = r.map.filter(x=>/NOTHING/.test(x));
    if(bad.length) throw new Error(bad.join(' | '));
    return r.map.join('; ');
  });

  t.section('and with investors on it');

  await t.step('three investors, and the money lands in the sleeve it was reported under', async () => {
    const r = await t.eval(async (a)=>{
      const err = await eval('(' + a.FEED + ')')(a.sheet);
      if(err) return {err};
      impWiz.analysis = impAnalyse();
      const an = impWiz.analysis;
      const res = await impCommit();
      const find = n => DB.clients.find(c=>c.cmsName === n) || null;
      const hold = c => c ? DB.platformHoldings.find(h=>h.clientId === c.id && h.platform === 'nj') : null;
      const one = find('ZZ Nilesh Kulkarni'), two = find('ZZ Sheetal Kulkarni'),
            three = find('ZZ Ramesh Deshpande');
      return {written: res.batch.written, failed: res.batch.failed, bad: an.bad,
        rows: an.rows.map(x=>({name: x.clientName, ok: x.ok, errs: x.errs})),
        one: one && {h: hold(one), client: one},
        two: two && {h: hold(two)}, three: three && {h: hold(three)}};
    }, {FEED, sheet: SHEET});
    if(r.err) throw new Error(r.err);
    if(r.failed || r.bad) throw new Error('rows failed: ' + JSON.stringify(r.rows));
    if(r.written !== 3) throw new Error(r.written + ' row(s) written, expected 3');
    if(!r.one || !r.two || !r.three) throw new Error('not every investor became a client');
    const h = r.one.h;
    const want = {Equity:288275, Debt:99088, Hybrid:26795, Physical:0, Others:0};
    Object.keys(want).forEach(k=>{
      const got = ((h.sleeves || {})[k] || {}).current;
      if(got !== want[k]) throw new Error(k + ' reads ' + got + ', expected ' + want[k]);
    });
    if(h.current !== 414158) throw new Error('the total reads ' + h.current);
    if(r.three.h.current !== 762000) throw new Error('the third total reads ' + r.three.h.current);
    if(((r.three.h.sleeves || {}).Debt || {}).current !== 750000)
      throw new Error('the third row’s debt did not land');
    return '3 investors in; Equity 2,88,275 · Debt 99,088 · Hybrid 26,795 against a reported total of '
      + '4,14,158, and the lakhs-with-commas read as numbers';
  });

  await t.step('Partner/Employee and Group stay on the snapshot, off the client', async () => {
    const r = await t.eval(()=>{
      const c = DB.clients.find(x=>x.cmsName === 'ZZ Nilesh Kulkarni');
      const h = DB.platformHoldings.find(x=>x.clientId === c.id && x.platform === 'nj');
      return {partner: h.partnerEmployee, group: h.groupName,
        rmName: c.rmName || '', familyHeadId: c.familyHeadId || '',
        srcKeys: Object.keys(h.src || {}).length, srcSr: (h.src || {})['Sr. No.']};
    });
    if(r.partner !== 'NJ-EMP-114') throw new Error('the NJ partner reads "' + r.partner + '"');
    if(r.group !== 'ZZ Kulkarni Family') throw new Error('the NJ group reads "' + r.group + '"');
    if(r.rmName) throw new Error('an NJ employee code was written onto the client’s RM: ' + r.rmName);
    if(r.familyHeadId) throw new Error('an NJ group name was turned into a BOSS family head');
    if(r.srcKeys !== 10) throw new Error('the source row kept ' + r.srcKeys + ' of its 10 columns');
    if(r.srcSr !== '1') throw new Error('Sr. No. is not in the source row: ' + r.srcSr);
    return 'NJ-EMP-114 and "ZZ Kulkarni Family" are on the snapshot; the client’s own RM and family '
      + 'head are untouched; all 10 columns kept verbatim in the source row';
  });

  await t.step('the snapshot is filed under the date the report is true of', async () => {
    const r = await t.eval(()=>{
      const c = DB.clients.find(x=>x.cmsName === 'ZZ Nilesh Kulkarni');
      const h = DB.platformHoldings.find(x=>x.clientId === c.id && x.platform === 'nj');
      navigate('cms', c.id);
      window._clientTab = 'portfolio';
      render();
      const html = document.getElementById('content').innerHTML;
      return {reportAsOn: h.reportAsOn, asOf: String(h.asOf || '').slice(0, 10),
        shown: html.indexOf(fmtDate('2026-10-14')) >= 0};
    });
    if(r.reportAsOn !== '2026-10-14') throw new Error('the snapshot says "' + r.reportAsOn + '"');
    if(r.asOf === r.reportAsOn) throw new Error('the import time and the report date are the same '
      + 'value, so one of them is not being kept');
    return 'filed as on 2026-10-14, the date in the report’s own title, with the import time kept '
      + 'beside it as ' + r.asOf;
  });

  t.section('what the change must not have broken');

  await t.step('an ordinary one-row heading is not read as two', async () => {
    const r = await t.eval(async (a)=>{
      const err = await eval('(' + a.FEED + ')')([
        ['Sr. No.', 'Partner/Employee', 'Group', 'Investor', 'EQUITY', 'DEBT', 'HYBRID',
         'PHYSICAL ASSETS', 'OTHERS', 'TOTAL'],
        [1, 'NJ-EMP-114', 'ZZ Flat Family', 'ZZ Flat Investor', '1000', '0', '0', '0', '0', '1000'],
        [2, 'NJ-EMP-114', '', 'ZZ Flat Two', '2000', '0', '0', '0', '0', '2000'],
      ]);
      const out = {err, headers: impWiz.headers, rows: impWiz.rows.length, asOn: impWiz.asOn,
        first: impWiz.rows[0]};
      closePlatformImport();
      return out;
    }, {FEED});
    if(r.err) throw new Error(r.err);
    if(r.rows !== 2) throw new Error('it found ' + r.rows + ' row(s), so it ate one as a heading');
    if(r.headers[3] !== 'Investor') throw new Error('the heading reads ' + JSON.stringify(r.headers));
    if(String(r.first[3]) !== 'ZZ Flat Investor') throw new Error('the first record is ' + r.first[3]);
    if(r.asOn) throw new Error('it invented an as-on date of ' + r.asOn);
    return 'a flat heading over two records stays a flat heading over two records, and no date is '
      + 'invented where the file carries none';
  });
});
