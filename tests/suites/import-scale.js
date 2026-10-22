/* A REAL FILE IS TWO AND A HALF THOUSAND ROWS, NOT FOUR.

   The firm uploaded an NJ SIP report of 2,592 rows, 1,660 of them
   clients BOSS had never seen. The confirm button said "Importing…"
   and stayed there long enough to look broken, through more than one
   attempt.

   The work was never the problem. The writing of it was: an audit line
   per created client, each one its own upload of the whole audit log,
   on a log that grew with every line; the automation engine woken on
   the save at the end and asked to treat sixteen hundred imported
   records as sixteen hundred things somebody had just created; and
   three lookups done as a scan of an array this same loop was adding
   to. All three grew with the file rather than with the work.

   So this suite does not time a stopwatch and hope. It counts what the
   import asks the server to do. The number of writes must not grow with
   the number of rows — that is the bug, stated as a test — and
   everything the slow version wrote has to still be written: every
   client, every registration, every audit line, the batch and the
   history. */
const {suite} = require('../lib/harness');
const {xlsx} = require('../lib/xlsx-write');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bossscale-'));
const ROWS = Number(process.env.SCALE_ROWS || 1200);

/* The NJ SIP report's own headings, taken from the format BOSS declares
   rather than typed here, so a change to the format changes the file. */
const build = (headers, n) => {
  const rows = [headers];
  for(let i = 0; i < n; i++){
    const pan = 'ZZSCL' + String(1000 + i).slice(-4) + 'S';
    rows.push(headers.map(h=>{
      if(/investor/i.test(h)) return 'ZZ Scale Client ' + i;
      if(/pan/i.test(h)) return pan;
      if(/folio/i.test(h)) return 'F-' + i;
      if(/scheme/i.test(h)) return 'ZZ Scale Fund';
      if(/start date/i.test(h)) return {d:'2024-01-10'};
      if(/end date/i.test(h)) return {d:'2029-01-10'};
      if(/amount|instal/i.test(h)) return '5,000';
      if(/frequency/i.test(h)) return 'Monthly';
      if(/sr\.? ?no/i.test(h)) return i + 1;
      if(/no\.? of|installments/i.test(h)) return 60;
      if(/type/i.test(h)) return 'Regular';
      if(/sip no/i.test(h)) return 'SIP-' + i;
      return '';
    }));
  }
  return rows;
};

suite(async t => {
  await t.home();
  let file = '', headers = null;

  await t.step(ROWS + ' rows of an NJ SIP report, every one of them a client BOSS has never seen', async () => {
    headers = await t.eval(()=>impFormat('nj_sip').cols.map(c=>c.src));
    const rows = build(headers, ROWS);
    file = path.join(DIR, 'Live_SIP_Report.xlsx');
    fs.writeFileSync(file, xlsx('Sheet0', rows));
    return path.basename(file) + ', ' + headers.length + ' columns, '
      + (fs.statSync(file).size / 1024).toFixed(0) + ' KB';
  });

  await t.step('it reads, and every row is a new client', async () => {
    await t.eval(()=>{ navigate('import'); openPlatformImport('nj', 'nj_sip'); });
    await t.wait(250);
    await t.page.setInputFiles('#impFile', file);
    await t.wait(4000);
    const r = await t.eval(()=>{
      impWiz.createClients = true;
      const a = impWiz.analysis = impAnalyse();
      return {err: impWiz.err, step: impWiz.step, rows: impWiz.rows.length,
        ok: a.ok, bad: a.bad, create: a.create,
        firstBad: (a.rows.find(x=>!x.ok) || {errs:[]}).errs.join('; ')};
    });
    if(r.err) throw new Error(r.err);
    if(r.rows !== ROWS) throw new Error('it read ' + r.rows + ' rows');
    if(r.bad) throw new Error(r.bad + ' row(s) would not import: ' + r.firstBad);
    if(r.create !== ROWS) throw new Error('only ' + r.create + ' would create a client');
    return r.ok + ' rows ready, all ' + r.create + ' of them new clients';
  });

  await t.step('the writing does not grow with the file', async () => {
    const r = await t.eval(async ()=>{
      /* Count what the import asks the server to do, by key. */
      const real = window.fetch;
      const puts = [];
      window.fetch = function(url, opts){
        const u = String(url || '');
        if((opts && opts.method === 'PUT') && /\/api\/storage\//.test(u))
          puts.push(decodeURIComponent(u.split('/api/storage/')[1] || ''));
        return real.apply(this, arguments);
      };
      const auditBefore = DB.auditLog.length;
      const clientsBefore = DB.clients.length;
      const sipsBefore = DB.platformSips.length;
      const t0 = performance.now();
      let res = null, err = '';
      try { res = await impCommit(); } catch(e){ err = String(e && e.message || e); }
      const ms = Math.round(performance.now() - t0);
      window.fetch = real;
      const by = {};
      puts.forEach(k=>{ by[k] = (by[k] || 0) + 1; });
      return {err, ms, puts: puts.length, by,
        audit: DB.auditLog.length - auditBefore,
        clients: DB.clients.length - clientsBefore,
        sips: DB.platformSips.length - sipsBefore,
        batch: res && res.batch, logged: res && res.log.length};
    });
    if(r.err) throw new Error(r.err);
    /* The point of the whole suite: a bounded number of writes, whatever
       the row count. The old path wrote one per created client. */
    if(r.puts > 12) throw new Error(r.puts + ' writes to the server for ' + ROWS + ' rows — '
      + JSON.stringify(r.by));
    if((r.by.auditLog || 0) > 2) throw new Error('the audit log was uploaded ' + r.by.auditLog + ' times');
    if(r.clients !== ROWS) throw new Error('it created ' + r.clients + ' clients');
    if(r.sips !== ROWS) throw new Error('it wrote ' + r.sips + ' SIP registrations');
    /* One line per client, plus exactly one for the run itself: the
       month's AUM total, written once however many rows the file had.
       A fixed overhead is the opposite of growing with the file. */
    if(r.audit !== ROWS + 1)
      throw new Error('it wrote ' + r.audit + ' audit lines for ' + ROWS + ' clients, expected '
        + (ROWS + 1) + ' (one each, plus one for the month)');
    if(r.batch.created !== ROWS || r.batch.written !== ROWS)
      throw new Error('the batch says created ' + r.batch.created + ', written ' + r.batch.written);
    return ROWS + ' rows in ' + r.ms + 'ms and ' + r.puts + ' write(s) — '
      + Object.keys(r.by).map(k=>k + '×' + r.by[k]).join(', ')
      + '; ' + r.audit + ' audit lines (one per client, plus one for the month), all of them kept';
  });

  await t.step('and everything it wrote is on the server, not only in the tab', async () => {
    const r = await t.eval(async ()=>{
      const get = async k => {
        const res = await fetch('/api/storage/' + encodeURIComponent(k), {headers: apiHeaders()});
        if(!res.ok) return null;
        return JSON.parse((await res.json()).value);
      };
      const [clients, sips, audit, batches, hist] =
        await Promise.all(['clients','platformSips','auditLog','importBatches','importHistory'].map(get));
      const mine = (clients || []).filter(c=>/^ZZ Scale Client /.test(c.cmsName || ''));
      /* This report identifies a client by name; it carries no PAN
         column, so what has to be on the record is the name it was
         created under and the stage every client starts at. */
      return {clients: mine.length, named: mine.every(c=>c.cmsName && c.cmsStage && c.createdVia),
        sips: (sips || []).filter(s=>s.platform === 'nj').length,
        audit: (audit || []).filter(a=>a.action === 'Created by platform import').length,
        batch: (batches || []).length, hist: (hist || []).length};
    });
    if(r.clients !== ROWS) throw new Error(r.clients + ' clients on the server');
    if(!r.named) throw new Error('a client reached the server without its name, its stage or its source');
    if(r.sips !== ROWS) throw new Error(r.sips + ' registrations on the server');
    if(r.audit !== ROWS) throw new Error(r.audit + ' audit lines on the server');
    if(!r.batch || !r.hist) throw new Error('the batch or the history did not reach the server');
    return r.clients + ' clients, ' + r.sips + ' registrations and ' + r.audit
      + ' audit lines read back off the server';
  });

  await t.step('the import did not fire the automations at every imported record', async () => {
    const r = await t.eval(()=>({
      runs: (DB.automationExecutionLog || []).length,
      rules: (DB.automationRules || []).filter(x=>x.active).length,
    }));
    if(r.runs > 5) throw new Error(r.runs + ' automation run(s) came out of one import');
    return r.rules + ' active rule(s), ' + r.runs + ' run(s) — an import is not a thousand people '
      + 'creating a thousand records';
  });

  await t.step('nothing was alerted', async () => {
    const said = t.dialogs.map(String);
    if(said.length) throw new Error(said.join(' | ').slice(0, 200));
    return 'none';
  });
});
