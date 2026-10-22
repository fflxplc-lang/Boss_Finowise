/* WHATEVER THE PLATFORM CALLS A SPREADSHEET, BOSS OPENS IT.

   NJ's export is named .xls and Windows calls it "Microsoft Excel
   97-2003". So does an HTML table saved with that name, and so does
   Excel's 2003 XML — Windows goes by the extension, which means the
   name and the icon tell you nothing about what is inside.

   So nothing in the reader trusts the name. The first bytes of the file
   decide, and this suite feeds it one of each, by that route, through
   the real file input:

     • a genuine BIFF8 .xls, converted by LibreOffice rather than
       written here — a parser tested only against its own author's
       output proves the two agree, not that either is right;
     • one big enough that its shared string table is split across
       CONTINUE records, which is the join that turns every name in a
       file to mojibake when it is got wrong;
     • an HTML table named .xls, which is what most Indian back offices
       actually emit;
     • Excel's 2003 XML, also named .xls;
     • a .csv renamed .xls, because somebody always does;
     • a semicolon-separated file, and one with commas inside quoted
       fields, and one with a blank cell in the middle of a row — the
       last of which the old CSV reader silently shifted.

   Every one of them has to come out as the same thing: a header row and
   the rows under it, dates as dates, and nothing lost in the middle. */
const {suite} = require('../lib/harness');
const {haveLibreOffice, makeXls, makeSpreadsheetMl} = require('../lib/make-xls');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bossfmt-'));
const HAVE_LO = haveLibreOffice();

const HEAD = ['Sr. No.','Investor','Folio No','Scheme','Start Date','End Date','Amount (₹)',
  'Frequency','Monthly SIP Amount','Total No. of Installments','SIP Type','SIP No.','Base SIP No.',
  'Top-Up Start Date','Registered Top-Up Amt.'];
const ROWS = [
  [1,'ZZ Fmt Alpha','NJ-A1','ZZ Flexi Cap',{d:'2023-07-10'},{d:'2028-07-10'},'15,000','Monthly',
   '15,000',60,'Regular','SIP-A1','SIP-A1',{d:'2025-07-10'},'2,000'],
  [2,'ZZ Fmt Beta','NJ-B2','ZZ Liquid',{d:'2024-02-05'},{d:'2027-02-05'},'5,000','Monthly',
   '5,000',36,'Regular','SIP-B2','SIP-B2','','-'],
];
/* Read a file through the real input and report what came back. */
const readThrough = async (t, file) => {
  await t.eval(()=>{ navigate('import'); openPlatformImport('nj','nj_sip'); });
  await t.wait(250);
  await t.page.setInputFiles('#impFile', file);
  await t.wait(1400);
  const r = await t.eval(()=>({err: impWiz.err, step: impWiz.step, kind: impWiz.kind,
    kindLabel: impWiz.kindLabel, sheet: impWiz.sheet, headers: impWiz.headers,
    rows: impWiz.rows, found: (impWiz.analysis = impAnalyse()).found,
    bad: impWiz.analysis.bad, missing: impWiz.analysis.missing}));
  await t.eval(()=>closePlatformImport());
  await t.wait(150);
  if(r.err) throw new Error(r.err);
  return r;
};
/* The same four assertions for every format, so a pass means the same
   thing each time. */
const expectTheSame = (r, where) => {
  if(r.headers[0] !== 'Sr. No.' || r.headers[1] !== 'Investor')
    throw new Error(where + ': the header reads ' + JSON.stringify(r.headers.slice(0,3)));
  if(r.headers.length !== 15) throw new Error(where + ': ' + r.headers.length + ' columns, expected 15');
  if(r.rows.length !== 2) throw new Error(where + ': ' + r.rows.length + ' rows, expected 2');
  if(r.found !== 15) throw new Error(where + ': ' + r.found + ' columns recognised of 15');
  if(r.bad) throw new Error(where + ': ' + r.bad + ' rows would not import');
  const names = r.rows.map(x=>x[1]);
  if(names[0] !== 'ZZ Fmt Alpha' || names[1] !== 'ZZ Fmt Beta')
    throw new Error(where + ': the names read ' + JSON.stringify(names));
};

suite(async t => {

  t.section('a real .xls, the one the platform actually sends');

  await t.step('BIFF8 — the binary Excel 97 format', async () => {
    if(!HAVE_LO) return 'skipped: no LibreOffice here to produce a genuine .xls';
    const f = makeXls(DIR, 'nj_sip', 'SIP Register', [HEAD].concat(ROWS));
    const r = await readThrough(t, f);
    if(r.kind !== 'xls') throw new Error('read as ' + r.kind + ', expected xls');
    expectTheSame(r, 'xls');
    return 'opened as ' + r.kindLabel + ', sheet "' + r.sheet + '"';
  });

  await t.step('…and its dates come out as dates, not as day counts', async () => {
    if(!HAVE_LO) return 'skipped';
    const f = makeXls(DIR, 'nj_dates', 'SIP', [HEAD].concat(ROWS));
    const r = await readThrough(t, f);
    const started = r.rows[0][4];
    if(started !== '2023-07-10') throw new Error('Start Date came back as "' + started + '"');
    if(r.rows[0][13] !== '2025-07-10') throw new Error('Top-Up Start read "' + r.rows[0][13] + '"');
    return 'the serial behind the cell became ' + started;
  });

  await t.step('a big one, whose string table is split across records', async () => {
    /* Past about 8KB of text the shared string table is cut into
       CONTINUE records, and a string landing on the join starts again
       with a fresh flag saying whether its remaining characters are one
       byte or two. Every name after the first join comes out as
       mojibake if that is missed — so the check is every name, not a
       sample, and some of them are deliberately not ASCII. */
    if(!HAVE_LO) return 'skipped';
    const big = [HEAD];
    for(let i = 1; i <= 700; i++){
      big.push([i, 'ZZ Investor Number ' + i + ' of the register' + (i % 7 === 0 ? ' — ₹ Śrī' : ''),
        'NJ-' + String(i).padStart(6,'0'),
        'Scheme With A Deliberately Long Name For Record Splitting ' + i,
        {d:'2024-01-15'}, {d:'2029-01-15'}, 1000 + i, 'Monthly', 1000 + i, 60,
        'Regular', 'SIP-' + i, 'SIP-' + i, '', '']);
    }
    const f = makeXls(DIR, 'nj_big', 'SIP Register', big);
    const sizeKb = Math.round(fs.statSync(f).size / 1024);
    const r = await readThrough(t, f);
    if(r.rows.length !== 700) throw new Error(r.rows.length + ' rows, expected 700');
    const wrong = [];
    for(let i = 1; i <= 700; i++){
      const want = 'ZZ Investor Number ' + i + ' of the register' + (i % 7 === 0 ? ' — ₹ Śrī' : '');
      if(r.rows[i-1][1] !== want) wrong.push(i);
    }
    if(wrong.length) throw new Error(wrong.length + ' names came back wrong, first at row ' + wrong[0]
      + ': ' + JSON.stringify(r.rows[wrong[0]-1][1]));
    return sizeKb + 'KB, 700 rows, every name intact across the joins';
  });

  t.section('the other two things a platform calls a .xls');

  await t.step('an HTML table named .xls', async () => {
    if(!HAVE_LO) return 'skipped';
    const html = makeXls(DIR, 'nj_html', 'SIP', [HEAD].concat(ROWS), 'html');
    const renamed = path.join(DIR, 'NJ_LIVE_SIP.xls');
    fs.copyFileSync(html, renamed);                     // the name a back office gives it
    const r = await readThrough(t, renamed);
    if(r.kind !== 'html') throw new Error('read as ' + r.kind + ', expected html');
    expectTheSame(r, 'html');
    return 'named .xls, read as ' + r.kindLabel;
  });

  await t.step('Excel 2003 XML, also named .xls', async () => {
    const f = makeSpreadsheetMl(DIR, 'nj_ml', 'SIP Register', [HEAD].concat(ROWS));
    const r = await readThrough(t, f);
    if(r.kind !== 'xml2003') throw new Error('read as ' + r.kind + ', expected xml2003');
    expectTheSame(r, 'xml2003');
    if(r.rows[0][4] !== '2023-07-10') throw new Error('its date read "' + r.rows[0][4] + '"');
    return 'named .xls, read as ' + r.kindLabel;
  });

  t.section('text, in the shapes it actually arrives in');

  const csvOf = (rows, d) => rows.map(r=>r.map(v=>{
    const s = (v && v.d) ? v.d : String(v == null ? '' : v);
    return /["\n]/.test(s) || s.indexOf(d) >= 0 ? '"' + s.replace(/"/g,'""') + '"' : s;
  }).join(d)).join('\n');

  await t.step('a .csv renamed .xls', async () => {
    const f = path.join(DIR, 'renamed.xls');
    fs.writeFileSync(f, csvOf([HEAD].concat(ROWS), ','), 'utf8');
    const r = await readThrough(t, f);
    if(r.kind !== 'text') throw new Error('read as ' + r.kind);
    expectTheSame(r, 'csv-as-xls');
    return 'the extension lied and it did not matter';
  });

  await t.step('semicolons instead of commas', async () => {
    const f = path.join(DIR, 'semi.csv');
    fs.writeFileSync(f, csvOf([HEAD].concat(ROWS), ';'), 'utf8');
    const r = await readThrough(t, f);
    expectTheSame(r, 'semicolon');
    return 'delimiter worked out from the file';
  });

  await t.step('a comma inside a quoted field does not split it', async () => {
    const rows = JSON.parse(JSON.stringify(ROWS));
    rows[0][3] = 'ZZ Flexi Cap, Direct Growth';
    const f = path.join(DIR, 'quoted.csv');
    fs.writeFileSync(f, csvOf([HEAD].concat(rows), ','), 'utf8');
    const r = await readThrough(t, f);
    if(r.headers.length !== 15) throw new Error(r.headers.length + ' columns');
    if(r.rows[0][3] !== 'ZZ Flexi Cap, Direct Growth')
      throw new Error('the scheme came back as "' + r.rows[0][3] + '"');
    if(r.rows[0][4] !== '2023-07-10')
      throw new Error('the column after it shifted: ' + JSON.stringify(r.rows[0].slice(3,6)));
    return 'the field held together and nothing after it moved';
  });

  await t.step('a blank cell mid-row shifts nothing after it', async () => {
    /* The old reader dropped empty fields, so one blank cell moved every
       column to its right by one — silently, on that row only. */
    const f = path.join(DIR, 'blank.csv');
    const line = ['3','ZZ Fmt Gamma','','ZZ Gap Fund','2024-03-01','2029-03-01','7,500','Monthly',
      '7,500','60','Regular','SIP-G3','SIP-G3','',''];
    fs.writeFileSync(f, csvOf([HEAD, line], ',') + '\n', 'utf8');
    const r = await readThrough(t, f);
    const row = r.rows[0];
    if(row[1] !== 'ZZ Fmt Gamma') throw new Error('name is "' + row[1] + '"');
    if(row[2] !== '') throw new Error('the blank folio became "' + row[2] + '"');
    if(row[3] !== 'ZZ Gap Fund') throw new Error('the scheme moved to "' + row[3] + '"');
    if(row[6] !== '7,500') throw new Error('the amount moved to "' + row[6] + '"');
    return 'the blank stayed blank and the row kept its shape';
  });

  t.section('a workbook with more than one sheet in it');

  await t.step('the sheet with the data is taken, not the cover sheet', async () => {
    if(!HAVE_LO) return 'skipped';
    /* An export often opens with a title block. The reader steps over it
       and over any lead-in rows above the real header. */
    const withCover = [
      ['NJ India — SIP Register'],
      ['Generated 13-Oct-2026 07:22'],
      [],
      HEAD,
    ].concat(ROWS);
    const f = makeXls(DIR, 'nj_cover', 'Register', withCover);
    const r = await readThrough(t, f);
    expectTheSame(r, 'cover rows');
    if(!/header on row 4/.test(r.kindLabel || ''))
      throw new Error('it did not report where the header was: ' + r.kindLabel);
    return 'two title lines and a blank stepped over; ' + r.kindLabel;
  });

  t.section('the real NJ export, kept as the file it actually is');

  /* tests/fixtures/NJ_AUM_Report.xls is the file the firm sent after the
     import refused it — not a reconstruction. Two things about it broke
     the reader, and neither would have been imagined:

       · it is a genuine BIFF8 workbook, which is why "BOSS reads .xlsx
         and .csv" turned it away;
       · its header row labels the money columns and leaves the serial
         number and the client's name with no heading at all, so the
         header has six filled cells against the data row's eight. The
         rule "the header is the fullest row" then picked the first
         client as the headings, found nothing under them, and said the
         file had no rows in it.

     Both are fixed, and this is here so neither comes back. */
  const REAL = path.join(__dirname, '..', 'fixtures', 'NJ_AUM_Report.xls');

  await t.step('it opens, and the headings it does have are read', async () => {
    if(!fs.existsSync(REAL)) throw new Error('the fixture is missing: ' + REAL);
    await t.eval(()=>{ navigate('import'); openPlatformImport('nj','nj_aum'); });
    await t.wait(250);
    await t.page.setInputFiles('#impFile', REAL);
    await t.wait(1500);
    const r = await t.eval(()=>({err: impWiz.err, kind: impWiz.kind, headers: impWiz.headers,
      rows: impWiz.rows.length, unnamed: impWiz.unnamed}));
    if(r.err) throw new Error(r.err);
    if(r.kind !== 'xls') throw new Error('read as ' + r.kind);
    if(r.headers.length !== 8) throw new Error(r.headers.length + ' columns: ' + JSON.stringify(r.headers));
    ['EQUITY','DEBT','HYBRID','PHYSICAL ASSETS','OTHERS','TOTAL'].forEach(h=>{
      if(r.headers.indexOf(h) < 0) throw new Error('no "' + h + '" column: ' + JSON.stringify(r.headers));
    });
    if(r.unnamed !== 2) throw new Error(r.unnamed + ' unheaded columns, expected 2');
    return '8 columns, 2 of them unheaded and named for their place, ' + r.rows + ' row';
  });

  await t.step('the unheaded client column is found by what is in it', async () => {
    const r = await t.eval(()=>({guessed: impWiz.guessed || [],
      a: (()=>{ const a = impWiz.analysis = impAnalyse();
        return {ok:a.ok, bad:a.bad, missing:a.missing, found:a.found,
                rows:a.rows.map(x=>({name:x.clientName, ok:x.ok, how:x.match.how, errs:x.errs}))}; })()}));
    if(!r.guessed.length) throw new Error('nothing was worked out from the values');
    const g = r.guessed[0];
    /* NJ calls that column "Investor" on the report it writes today and
       left it unheaded on the one this fixture came from; what is being
       tested is that the column feeding the client's name is found from
       its values, whatever the heading above it is called. */
    if(g.to !== 'client.cmsName') throw new Error('it guessed at ' + g.forCol + ' → ' + g.to);
    if(!/Aalok/.test(g.sample)) throw new Error('its sample reads ' + g.sample);
    /* This export predates the Partner/Employee and Group columns NJ
       writes today, so the preview names them as not in the file. That
       is information, not a refusal: neither is required, and the rows
       still import. What must not be missing is anything required. */
    const shouldHave = ['Partner/Employee', 'Group'];
    const odd = r.a.missing.filter(m=>shouldHave.indexOf(m) < 0);
    if(odd.length) throw new Error('it thinks a column is missing: ' + odd.join(', '));
    if(r.a.bad) throw new Error('rows failed: ' + JSON.stringify(r.a.rows));
    if(r.a.rows[0].name !== 'Aalok Ambika Singh')
      throw new Error('the client reads "' + r.a.rows[0].name + '"');
    if(r.a.rows[0].how !== 'new' && r.a.rows[0].how !== 'name')
      throw new Error('matched by ' + r.a.rows[0].how + ' on a report with no PAN');
    return '"' + g.header + '" read as the client\u2019s name from "' + g.sample + '" — and the two '
      + 'columns this older export does not carry are named rather than refused';
  });

  await t.step('and the money lands in the right sleeves', async () => {
    const r = await t.eval(async ()=>{
      const res = await impCommit();
      const c = DB.clients.find(x=>/Aalok Ambika Singh/.test(x.cmsName||''));
      const h = c ? DB.platformHoldings.find(x=>x.clientId===c.id && x.platform==='nj') : null;
      return {written: res.batch.written, failed: res.batch.failed,
              total: h ? h.current : null, sleeves: h ? h.sleeves : null,
              src: h ? Object.keys(h.src||{}).length : 0,
              book: c ? clientBookAum(c) : null};
    });
    await t.eval(()=>closePlatformImport());
    if(r.failed) throw new Error(r.failed + ' rows failed');
    if(r.written !== 1) throw new Error(r.written + ' rows written');
    const want = {Equity:288275, Debt:99088, Hybrid:26795, Physical:0, Others:0};
    for(const k of Object.keys(want)){
      const got = (r.sleeves[k] || {}).current;
      if(got !== want[k]) throw new Error(k + ' reads ' + got + ', expected ' + want[k]);
    }
    if(r.total !== 414158) throw new Error('the total reads ' + r.total);
    if(288275 + 99088 + 26795 !== r.total)
      throw new Error('the sleeves do not add to the reported total');
    if(r.book !== 414158) throw new Error('the client\u2019s book reads ' + r.book);
    if(r.src !== 8) throw new Error('the source row kept ' + r.src + ' of its 8 columns');
    return '\u20b94,14,158 \u2014 Equity 2,88,275 · Debt 99,088 · Hybrid 26,795, and they add to the total';
  });

  t.section('and when it genuinely cannot');

  await t.step('a file that is not a spreadsheet says what it found', async () => {
    const f = path.join(DIR, 'notasheet.xls');
    fs.writeFileSync(f, Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,1,2,3,4,5,6,7,8]));
    await t.eval(()=>{ navigate('import'); openPlatformImport('nj','nj_sip'); });
    await t.wait(250);
    await t.page.setInputFiles('#impFile', f);
    await t.wait(900);
    const r = await t.eval(()=>({err: impWiz.err, step: impWiz.step}));
    await t.eval(()=>closePlatformImport());
    if(!r.err) throw new Error('a PNG was accepted as a spreadsheet');
    if(/BOSS reads \.xlsx and \.csv/.test(r.err))
      throw new Error('it is still refusing on the extension: ' + r.err);
    if(!/not a spreadsheet BOSS can read/.test(r.err))
      throw new Error('it did not say what it found: ' + r.err);
    if(r.step !== 3) throw new Error('it moved on to step ' + r.step);
    return 'refused, and said: ' + r.err.slice(0, 110);
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
