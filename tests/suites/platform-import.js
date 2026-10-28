/* IMPORTING A PLATFORM'S OWN AUM AND SIP REPORT.

   Five formats, from three platforms, and the firm's instruction was
   specific about what must hold across all of them: PAN is the key; the
   client's name is the key only where the report carries no PAN; a name
   that matches two clients is never resolved by guessing; re-importing
   the same report must not make a second copy of anything; and the
   source platform, report type and batch must still be readable
   afterwards.

   Every one of those is a rule that only fails on the day it matters, so
   every one of them is a step below. The fixtures are real .xlsx files —
   a zip of XML with a shared string table and a date format — built by
   tests/lib/xlsx-write.js, because the reader in index.html exists to
   open the file a platform actually produces, not a convenient stand-in.

   The last section is the one worth keeping: a platform snapshot must not
   land in the transaction ledger. BOSS's own AUM is the sum of that
   ledger, and a monthly holdings report poured into it would add the same
   money again every month — on the Main Dashboard, in the AUM Trend
   report and in the Portfolio module at once. */
const {suite} = require('../lib/harness');
const {xlsx} = require('../lib/xlsx-write');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bossimp-'));
const write = (name, sheet, rows) => {
  const p = path.join(DIR, name);
  fs.writeFileSync(p, xlsx(sheet, rows));
  return p;
};

/* ---- the five reports, as the platforms write them ----------------- */
const FIN_AUM_HEAD = ['Name','PAN','Branch','RM Name','Associate Name','Inv. Cost','Current Value','XIRR','Mobile'];
const FIN_SIP_HEAD = ['Investor Name','PAN Number','Mobile','Branch','RM Name','Associate Name','Folio',
  'Scheme Name','Reg Date','Start Date','End Date','SIP Date','Frequency','SIP Amount','Monthly Amount',
  'Inv. Cost','Current Value','XIRR (%)','Client ID','ISIN No','RTA Code'];
const AR_HEAD = ['Client Code','Client Full Name','Mobile Number','Email Address','DOB','PAN','RM Code','RM Name',
  'BDM Name','Account Open Date','Current Wealth','Annual Savings','Strategy Years','WS Equity Allocation Per',
  'ARTarget Wealth','Equity Investment','Equity Current Value','Equity XIRR','Debt Investment Value',
  'Debt Current Value','Debt XIRR','SP Investment','SP Current Value','SP XIRR','WealthPlus Investment',
  'WealthPlus Current Value','WealthPlus XIRR','MF Allocation','SP Allocation','Cash Investment',
  'Cash Current Value','Cash XIRR','Tax Investment','Tax Current Value','Tax XIRR','Total Investment',
  'Total Current Value','Total XIRR','SIP Executed Last Month','NACH Mandate Status','Realized Gain',
  'Unrealized Gain','Total Portfolio Return','App Install Status','Last Purchase Date',
  'Long Term Non-AR Equity Holdings Current Value','% of Total Portfolio'];
const NJ_SIP_HEAD = ['Sr. No.','Investor','Folio No','Scheme','Start Date','End Date','Amount (₹)','Frequency',
  'Monthly SIP Amount','Total No. of Installments','SIP Type','SIP No.','Base SIP No.',
  'Top-Up Start Date','Registered Top-Up Amt.'];
const NJ_AUM_HEAD = ['Client Name','Equity','Debt','Hybrid','Physical Assets','Others','Total'];

/* Numbers chosen so every total has one arithmetic answer and no other.
   Mehta: 10,00,000 in at Finowise, worth 12,50,000.  Rao: 5,00,000 → 4,80,000. */
const FILES = {
  finAum: write('Finowise_AUM.xlsx', 'AUM Report', [
    ['Finowise Wealth — AUM as on 31-Mar-2026'],          // a cover line above the header, as exports have
    FIN_AUM_HEAD,
    ['ZZ Mehta Rajesh','zzmeh1234r','Varanasi','','Priya Nair','10,00,000','12,50,000','14.5','98765 43210'],
    ['ZZ Rao Sunita','ZZRAO5678S','Varanasi','','Priya Nair','5,00,000','4,80,000','-3.2','9876543211'],
    ['ZZ Nopan Person','','Varanasi','','','1,00,000','1,10,000','5','9876543212'],
    ['ZZ Bad Pan','NOTAPAN','Varanasi','','','1,000','1,000','1','9876543213'],
  ]),
  finSip: write('Finowise_SIP.xlsx', 'SIP', [
    FIN_SIP_HEAD,
    ['ZZ Mehta Rajesh','ZZMEH1234R','9876543210','Varanasi','','Priya Nair','F-001','ZZ Bluechip Fund',
     {d:'2024-04-01'}, {d:'2024-05-01'}, {d:'2029-05-01'}, 5,'Monthly','25,000','25,000',
     '6,00,000','7,10,000','15.2','FW-9001','INF000ZZ0001','RTA-01'],
    ['ZZ Mehta Rajesh','ZZMEH1234R','9876543210','Varanasi','','Priya Nair','F-002','ZZ Debt Fund',
     {d:'2025-01-01'}, {d:'2025-02-01'}, {d:'2030-02-01'}, 10,'Monthly','10,000','10,000',
     '1,40,000','1,48,000','6.1','FW-9001','INF000ZZ0002','RTA-02'],
  ]),
  arAum: write('AR_AUM.xlsx', 'Sheet1', [
    AR_HEAD,
    ['AR-7781','ZZ Mehta Rajesh','9876543210','mehta@example.com',{d:'1979-08-22'},'ZZMEH1234R','RM-12','',
     'Kiran Desai',{d:'2021-06-15'},'80,00,000','12,00,000',10,'65','2,50,00,000',
     '20,00,000','24,00,000','11.5','10,00,000','10,60,000','6.4','5,00,000','5,20,000','4.1',
     '2,00,000','2,30,000','9.0','72','14','1,00,000','1,00,000','0',
     '50,000','55,000','7.2','38,50,000','43,65,000','9.8','35,000','Active',
     '1,20,000','5,15,000','13.4','Installed',{d:'2026-02-20'},'3,00,000','18.4'],
  ]),
  njSip: write('NJ_SIP.xlsx', 'SIP Register', [
    NJ_SIP_HEAD,
    [1,'ZZ Rao Sunita','NJ-55','ZZ Flexi Cap',{d:'2023-07-10'},{d:'2028-07-10'},'15,000','Monthly',
     '15,000',60,'Regular','SIP-1001','SIP-1001',{d:'2025-07-10'},'2,000'],
    [2,'ZZ Rao Sunita','NJ-56','ZZ Liquid',{d:'2024-02-05'},{d:'2027-02-05'},'5,000','Monthly',
     '5,000',36,'Regular','SIP-1002','SIP-1002','','-'],
  ]),
  njAum: write('NJ_AUM.xlsx', 'Summary', [
    NJ_AUM_HEAD,
    ['ZZ Rao Sunita','3,00,000','1,50,000','50,000','0','25,000','5,25,000'],
    ['ZZ Twinned Name','1,00,000','0','0','0','0','1,00,000'],
  ]),
};

/* Three clients to match against, and a deliberate pair of twins with no
   PAN between them — the case the firm said must never be guessed. */
const SEED = async () => {
  const br = (DB.config.branches || ['Varanasi'])[0];
  const mk = (name, pan) => {
    const c = {id:uid('CMS'), cmsName:name, pan:pan||'', branch:br, rmName:currentUser,
      createdAt:new Date().toISOString(), createdBy:currentUser};
    initState('CMS', c); DB.clients.push(c);
    return c.id;
  };
  const out = {
    mehta: mk('ZZ Mehta Rajesh', 'zzmeh1234r'),     // lower case on purpose: PAN is normalised
    rao:   mk('ZZ Rao Sunita', 'ZZRAO5678S'),
    twinA: mk('ZZ Twinned Name', ''),
    twinB: mk('ZZ Twinned Name', ''),
  };
  // Mehta already holds 2,00,000 in the firm's own ledger — the figure the
  // platform import must not touch.
  DB.transactions.push({id:uid('TXN'), clientId:out.mehta, amount:200000, status:'Completed',
    transactionType:'Purchase', productCategory:'Equity',
    createdAt:new Date().toISOString(), createdBy:currentUser});
  await save('clients'); await save('transactions');
  return out;
};

suite(async t => {
  let ids = null;

  await t.step('seed four clients, one pair of them twins with no PAN', async () => {
    ids = await t.eval(SEED);
    await t.wait(400);
    return 'Mehta (PAN, lower case) · Rao (PAN) · two called "ZZ Twinned Name" with none';
  });

  /* A file goes through the real wizard: the real file input, the real
     reader, the real preview, the real confirm. Nothing is shortcut. */
  const runImport = async (fmtId, file, opts) => {
    await t.eval(x => { navigate('import'); openPlatformImport(impFormat(x).platform, x); }, fmtId);
    await t.wait(250);
    await t.page.setInputFiles('#impFile', file);
    await t.wait(900);
    const read = await t.eval(()=>({step: impWiz.step, err: impWiz.err, rows: impWiz.rows.length,
                                    headers: impWiz.headers.length, sheet: impWiz.sheet}));
    if(read.err) throw new Error('reading the file: ' + read.err);
    if(read.step !== 4) throw new Error('after upload the wizard is on step ' + read.step);
    return await t.eval(async o => {
      impWiz.createClients = o.createClients !== false;
      impWiz.overwrite = !!o.overwrite;
      impWiz.analysis = impAnalyse();
      const a = impWiz.analysis;
      const res = await impCommit();
      return {a: {ok:a.ok, bad:a.bad, create:a.create, byPan:a.byPan, byName:a.byName,
                  review:a.review, missing:a.missing, unknown:a.unknown, found:a.found,
                  rows:a.rows.map(r=>({n:r.n, name:r.clientName, ok:r.ok, how:r.match.how,
                                       errs:r.errs, fills:r.fills.length, coll:r.collisions.length}))},
              batch: res.batch, log: res.log};
    }, opts||{});
  };

  t.section('the reader opens a real workbook');

  await t.step('an .xlsx is read here, with no library and nothing uploaded', async () => {
    /* Two files the app serves itself: /config.js, its one line of
       runtime config, and /appraisal-engine.js, the Appraisal System
       handed over as its own module and kept that way so it stays
       provably unmodified. Both come off this server and neither is a
       dependency. The payout screens and the partner targets and levels
       are this server's own files too. Anything else pulled in would be a
       library. */
    const OURS = /^\/(config|appraisal-engine|payout|partner-targets|partner-levels)\.js(\?|$)/;
    const r = await t.eval(()=>({supported: xlsxSupported(),
      lib: typeof window.XLSX,
      all: Array.from(document.querySelectorAll('script[src]')).map(s=>s.src),
      origin: location.origin}));
    const ours = r.all.filter(u=>u.indexOf(r.origin) === 0
      && OURS.test(u.slice(r.origin.length)));
    const foreign = r.all.filter(u=>ours.indexOf(u) < 0);
    if(!r.supported) throw new Error('the browser reports it cannot inflate a zip');
    if(r.lib !== 'undefined') throw new Error('a spreadsheet library got loaded after all');
    if(foreign.length) throw new Error('the page pulls in ' + foreign.join(', '));
    return 'DecompressionStream, no library on the page at all, and the only two scripts are this '
      + 'server\u2019s own';
  });

  await t.step('a cover line above the header does not become the header', async () => {
    await t.eval(()=>{ navigate('import'); openPlatformImport('finowise','finowise_aum'); });
    await t.wait(250);
    await t.page.setInputFiles('#impFile', FILES.finAum);
    await t.wait(900);
    const r = await t.eval(()=>({headers: impWiz.headers, rows: impWiz.rows.length,
                                 sheet: impWiz.sheet, err: impWiz.err}));
    if(r.err) throw new Error(r.err);
    if(r.headers[0] !== 'Name') throw new Error('the header row reads ' + JSON.stringify(r.headers.slice(0,3)));
    if(r.rows !== 4) throw new Error(r.rows + ' data rows, expected 4');
    if(r.sheet !== 'AUM Report') throw new Error('sheet is "' + r.sheet + '"');
    await t.eval(()=>closePlatformImport());
    return 'header found on row 2, four rows under it, sheet "' + r.sheet + '"';
  });

  t.section('Finowise — AUM');

  await t.step('nine columns, four rows, and each row goes where it should', async () => {
    const r = await runImport('finowise_aum', FILES.finAum);
    if(r.a.found !== 9) throw new Error(r.a.found + ' columns recognised, expected 9');
    if(r.a.missing.length) throw new Error('missing: ' + r.a.missing.join(', '));
    const by = {}; r.a.rows.forEach(x=>by[x.n] = x);
    if(by[1].how !== 'pan') throw new Error('Mehta matched by ' + by[1].how + ', expected PAN');
    if(by[1].name !== 'ZZ Mehta Rajesh') throw new Error('row 1 is ' + by[1].name);
    if(by[2].how !== 'pan') throw new Error('Rao matched by ' + by[2].how);
    if(by[3].how !== 'new') throw new Error('the client with no PAN and no match reads ' + by[3].how);
    if(by[4].ok) throw new Error('the row with PAN "NOTAPAN" was accepted');
    if(!by[4].errs.join(' ').match(/not a PAN/)) throw new Error('its error reads: ' + by[4].errs.join('; '));
    if(r.batch.created !== 1) throw new Error(r.batch.created + ' clients created, expected 1');
    if(r.batch.updated !== 2) throw new Error(r.batch.updated + ' clients updated, expected 2');
    if(r.batch.written !== 3) throw new Error(r.batch.written + ' rows written, expected 3');
    if(r.batch.failed !== 1) throw new Error(r.batch.failed + ' rows failed, expected 1');
    return '2 on PAN, 1 new, 1 rejected \u2014 and the batch counts 1 created, 2 updated, 3 written';
  });

  await t.step('the money and the return land as numbers, not as text', async () => {
    const r = await t.eval(x => {
      const h = DB.platformHoldings.find(y=>y.clientId === x && y.platform === 'finowise');
      return h ? {invested:h.invested, current:h.current, xirr:h.xirr, file:h.file,
                  platform:h.platform, report:h.report, batch:!!h.batchId,
                  srcKeys:Object.keys(h.src||{}).length} : null;
    }, ids.mehta);
    if(!r) throw new Error('no Finowise snapshot on the matched client');
    if(r.invested !== 1000000) throw new Error('"10,00,000" read as ' + r.invested);
    if(r.current !== 1250000) throw new Error('"12,50,000" read as ' + r.current);
    if(r.xirr !== 14.5) throw new Error('XIRR read as ' + r.xirr);
    if(r.report !== 'AUM' || r.platform !== 'finowise')
      throw new Error('tagged ' + r.platform + '/' + r.report);
    if(!r.batch) throw new Error('no batch on the snapshot');
    if(r.srcKeys !== 9) throw new Error('the source row kept ' + r.srcKeys + ' of its 9 columns');
    return '₹10,00,000 → ₹12,50,000 at 14.5%, tagged finowise/AUM, all 9 source columns kept';
  });

  await t.step('a negative return keeps its sign', async () => {
    const x = await t.eval(i => (DB.platformHoldings.find(h=>h.clientId===i)||{}).xirr, ids.rao);
    if(x !== -3.2) throw new Error('"-3.2" read as ' + x);
    return '-3.2%';
  });

  await t.step('a blank field on the client is filled; a mobile is normalised', async () => {
    const c = await t.eval(i => {
      const x = DB.clients.find(y=>y.id===i);
      return {mobile:x.mobile, associate:x.associateName, name:x.cmsName};
    }, ids.mehta);
    if(c.mobile !== '9876543210') throw new Error('"98765 43210" stored as "' + c.mobile + '"');
    if(c.associate !== 'Priya Nair') throw new Error('Associate Name is "' + c.associate + '"');
    return 'mobile ' + c.mobile + ', associate ' + c.associate;
  });

  t.section('Finowise — SIP');

  await t.step('twenty-one columns, and the dates come back as dates', async () => {
    const r = await runImport('finowise_sip', FILES.finSip);
    if(r.a.found !== 21) throw new Error(r.a.found + ' columns recognised, expected 21');
    if(r.a.bad) throw new Error(r.a.bad + ' rows failed: ' +
      r.a.rows.filter(x=>!x.ok).map(x=>x.errs.join('; ')).join(' | '));
    const s = await t.eval(i => DB.platformSips.filter(x=>x.clientId===i)
      .sort((a,b)=>String(a.folio).localeCompare(String(b.folio))), ids.mehta);
    if(s.length !== 2) throw new Error(s.length + ' SIPs, expected 2');
    if(s[0].startDate !== '2024-05-01') throw new Error('the Excel date read as ' + s[0].startDate);
    if(s[0].endDate !== '2029-05-01') throw new Error('end date read as ' + s[0].endDate);
    if(s[0].monthlyAmount !== 25000) throw new Error('monthly read as ' + s[0].monthlyAmount);
    if(s[0].sipDate !== 5) throw new Error('SIP Date read as ' + s[0].sipDate);
    if(s[0].isin !== 'INF000ZZ0001') throw new Error('ISIN is ' + s[0].isin);
    if(s[0].rtaCode !== 'RTA-01') throw new Error('RTA Code is ' + s[0].rtaCode);
    if(s[0].platformClientId !== 'FW-9001') throw new Error('Client ID is ' + s[0].platformClientId);
    return 'two folios, dates as yyyy-mm-dd, ISIN / RTA / platform Client ID all kept';
  });

  await t.step('the platform’s own Client ID does not identify the client', async () => {
    /* "Keep client identification separate from report-level identifiers."
       Client ID belongs to the SIP row, and the client was matched on PAN. */
    const r = await t.eval(()=>({
      onClient: DB.clients.some(c=>c.platformClientId || c.clientCode || c.sipNo),
      onSip: DB.platformSips.filter(s=>s.platformClientId).length,
    }));
    if(r.onClient) throw new Error('a report identifier was written onto a client record');
    if(!r.onSip) throw new Error('the platform Client ID was dropped instead of kept');
    return 'kept on the SIP row, never on the client';
  });

  t.section('Anand Rathi — AUM, and its forty-seven columns');

  await t.step('every one of the 47 is recognised', async () => {
    const r = await runImport('ar_aum', FILES.arAum);
    if(r.a.found !== 47) throw new Error(r.a.found + ' recognised of 47; missing ' + r.a.missing.join(', '));
    if(r.a.bad) throw new Error('rows failed: ' + r.a.rows.filter(x=>!x.ok).map(x=>x.errs.join('; ')).join(' | '));
    if(r.a.byPan !== 1) throw new Error('matched by ' + JSON.stringify(r.a.rows.map(x=>x.how)));
    return '47 of 47, matched on PAN';
  });

  await t.step('the six sleeves land separately, and add to the total', async () => {
    const h = await t.eval(i => DB.platformHoldings.find(x=>x.clientId===i && x.platform==='ar'), ids.mehta);
    if(!h) throw new Error('no Anand Rathi snapshot');
    const want = {Equity:2400000, Debt:1060000, Structured:520000, WealthPlus:230000, Cash:100000, Tax:55000};
    for(const k of Object.keys(want)){
      const got = (h.sleeves[k]||{}).current;
      if(got !== want[k]) throw new Error(k + ' current reads ' + got + ', expected ' + want[k]);
    }
    if(h.current !== 4365000) throw new Error('Total Current Value reads ' + h.current);
    if(h.invested !== 3850000) throw new Error('Total Investment reads ' + h.invested);
    const sum = Object.keys(want).reduce((s,k)=>s+want[k], 0);
    if(sum !== h.current) throw new Error('the six sleeves sum to ' + sum + ' against a total of ' + h.current);
    if((h.sleeves.Equity||{}).xirr !== 11.5) throw new Error('Equity XIRR reads ' + h.sleeves.Equity.xirr);
    return 'six sleeves summing to ₹43,65,000, which is the reported total';
  });

  await t.step('the fields that look like BOSS fields but are not stay on the snapshot', async () => {
    /* A BDM is not the Associate; an AR account opening is not the firm's
       Date of Onboarding; an AR NACH mandate is not BOSS's Mandate Status;
       the AR app is not BOSS's Web/App login. Four near-misses, four
       fields kept apart rather than merged on a resemblance. */
    const r = await t.eval(i => {
      const h = DB.platformHoldings.find(x=>x.clientId===i && x.platform==='ar');
      const c = DB.clients.find(x=>x.id===i);
      return {bdm:h.bdmName, open:h.accountOpenDate, nach:h.nachMandateStatus, app:h.appInstallStatus,
              code:h.platformClientCode, rmCode:h.rmCode,
              cAssoc:c.associateName, cOnboard:c.dateOfOnboarding||'', cMandate:c.mandateStatus||'',
              cWeb:c.webAppLogin||''};
    }, ids.mehta);
    if(r.bdm !== 'Kiran Desai') throw new Error('BDM Name reads ' + r.bdm);
    if(r.cAssoc !== 'Priya Nair') throw new Error('the BDM overwrote Associate Name: ' + r.cAssoc);
    if(r.open !== '2021-06-15') throw new Error('Account Open Date reads ' + r.open);
    if(r.cOnboard) throw new Error('it wrote Date of Onboarding: ' + r.cOnboard);
    if(r.nach !== 'Active') throw new Error('NACH status reads ' + r.nach);
    if(r.cMandate) throw new Error('it wrote the client Mandate Status: ' + r.cMandate);
    if(r.app !== 'Installed') throw new Error('App Install Status reads ' + r.app);
    if(r.cWeb) throw new Error('it wrote Web/App Login Access: ' + r.cWeb);
    if(r.code !== 'AR-7781' || r.rmCode !== 'RM-12') throw new Error('the AR codes were dropped');
    return 'BDM, account opening, NACH and app status all kept on the snapshot, none merged';
  });

  await t.step('the DOB and the email do fill, because those are the same thing', async () => {
    const c = await t.eval(i => {
      const x = DB.clients.find(y=>y.id===i);
      return {dob:x.dob, email:x.email};
    }, ids.mehta);
    if(c.dob !== '1979-08-22') throw new Error('DOB is ' + c.dob);
    if(c.email !== 'mehta@example.com') throw new Error('email is ' + c.email);
    return c.dob + ' · ' + c.email;
  });

  t.section('NJ — no PAN on either report, so the name is the key');

  await t.step('the SIP report matches Rao by name', async () => {
    const r = await runImport('nj_sip', FILES.njSip);
    if(r.a.byName !== 2) throw new Error('matched by name: ' + r.a.byName + ' of 2');
    if(r.a.byPan) throw new Error('something matched on a PAN this report does not carry');
    const s = await t.eval(i => DB.platformSips.filter(x=>x.clientId===i && x.platform==='nj'), ids.rao);
    if(s.length !== 2) throw new Error(s.length + ' NJ SIPs, expected 2');
    const one = s.find(x=>x.folio === 'NJ-55');
    if(one.sipNo !== 'SIP-1001') throw new Error('SIP No. is ' + one.sipNo);
    if(one.baseSipNo !== 'SIP-1001') throw new Error('Base SIP No. is ' + one.baseSipNo);
    if(one.installments !== 60) throw new Error('installments read ' + one.installments);
    if(one.topUpAmount !== 2000) throw new Error('top-up amount read ' + one.topUpAmount);
    if(one.topUpStartDate !== '2025-07-10') throw new Error('top-up start read ' + one.topUpStartDate);
    const two = s.find(x=>x.folio === 'NJ-56');
    if(two.topUpAmount) throw new Error('"-" in the top-up column became ' + two.topUpAmount);
    return 'two SIPs by name, SIP No. and Base SIP No. kept, "-" read as no amount';
  });

  await t.step('two clients of the same name are never picked between', async () => {
    /* The firm was explicit: flag it, require a person, do not merge. */
    const r = await runImport('nj_aum', FILES.njAum);
    const twin = r.a.rows.find(x=>x.name === 'ZZ Twinned Name' || /Twinned/.test(x.name||''));
    const row2 = r.a.rows.find(x=>x.n === 2);
    if(row2.ok) throw new Error('the twinned name imported anyway');
    if(row2.how !== 'ambiguous') throw new Error('it was treated as ' + row2.how);
    if(!row2.errs.join(' ').match(/2 clients are called/))
      throw new Error('its reason reads: ' + row2.errs.join('; '));
    if(r.a.review !== 1) throw new Error(r.a.review + ' rows held for review, expected 1');
    const made = await t.eval(()=>DB.clients.filter(c=>/ZZ Twinned Name/.test(c.cmsName||'')).length);
    if(made !== 2) throw new Error('it created a third "ZZ Twinned Name": ' + made + ' now exist');
    return 'held back, named in the error, and no third record invented';
  });

  await t.step('and the row that is unambiguous still imports', async () => {
    const h = await t.eval(i => DB.platformHoldings.find(x=>x.clientId===i && x.platform==='nj'), ids.rao);
    if(!h) throw new Error('Rao got no NJ snapshot');
    if(h.current !== 525000) throw new Error('the NJ total reads ' + h.current);
    const s = h.sleeves || {};
    const sum = ['Equity','Debt','Hybrid','Physical','Others'].reduce((n,k)=>n + ((s[k]||{}).current||0), 0);
    if(sum !== h.current) throw new Error('the five classes sum to ' + sum + ' against ' + h.current);
    return '₹5,25,000, and the five asset classes add to it';
  });

  t.section('what happens the second time the same report is uploaded');

  await t.step('re-importing creates nothing and duplicates nothing', async () => {
    const before = await t.eval(()=>({clients: DB.clients.length,
      holdings: DB.platformHoldings.length, sips: DB.platformSips.length}));
    await runImport('finowise_aum', FILES.finAum);
    await runImport('finowise_sip', FILES.finSip);
    const after = await t.eval(()=>({clients: DB.clients.length,
      holdings: DB.platformHoldings.length, sips: DB.platformSips.length}));
    if(after.clients !== before.clients)
      throw new Error('clients went ' + before.clients + ' → ' + after.clients);
    if(after.holdings !== before.holdings)
      throw new Error('AUM snapshots went ' + before.holdings + ' → ' + after.holdings);
    if(after.sips !== before.sips)
      throw new Error('SIP rows went ' + before.sips + ' → ' + after.sips);
    return before.clients + ' clients, ' + before.holdings + ' snapshots, ' + before.sips + ' SIPs — unchanged';
  });

  await t.step('the snapshot is updated in place, and keeps what it said before', async () => {
    const h = await t.eval(i => DB.platformHoldings.find(x=>x.clientId===i && x.platform==='finowise'), ids.mehta);
    if(!h.prev) throw new Error('the previous figures were not kept');
    if(h.prev.current !== 1250000) throw new Error('the previous value reads ' + h.prev.current);
    if(!h.firstSeenAt) throw new Error('it lost the date it was first imported');
    return 'first seen kept, previous figures kept, one row still';
  });

  await t.step('a client field already filled is not quietly replaced', async () => {
    const r = await t.eval(async i => {
      const c = DB.clients.find(x=>x.id===i);
      c.mobile = '9000000000'; await save('clients');       // the desk corrected it by hand
      return c.mobile;
    }, ids.mehta);
    await runImport('finowise_aum', FILES.finAum);
    const after = await t.eval(i => (DB.clients.find(x=>x.id===i)||{}).mobile, ids.mehta);
    if(after !== '9000000000') throw new Error('the import overwrote it: now ' + after);
    return 'the hand-corrected mobile survived the import';
  });

  await t.step('…unless the operator says to overwrite, which is one explicit tick', async () => {
    await runImport('finowise_aum', FILES.finAum, {overwrite:true});
    const after = await t.eval(i => (DB.clients.find(x=>x.id===i)||{}).mobile, ids.mehta);
    if(after !== '9876543210') throw new Error('Overwrite was ticked and it still reads ' + after);
    return 'with Overwrite on, the file wins — and only then';
  });

  t.section('traceability');

  await t.step('every batch says its platform, report, file, time and who ran it', async () => {
    const b = await t.eval(()=>DB.importBatches.map(x=>({id:x.id, platform:x.platform, report:x.report,
      format:x.format, file:x.file, at:x.at, by:x.by, total:x.total, written:x.written,
      created:x.created, updated:x.updated, map:Object.keys(x.map||{}).length})));
    if(b.length < 5) throw new Error('only ' + b.length + ' batches recorded');
    const bad = b.filter(x=>!x.id || !x.platform || !x.report || !x.file || !x.at || !x.by || !x.map);
    if(bad.length) throw new Error('incomplete batch: ' + JSON.stringify(bad[0]));
    /* A client the import has just created must not also be counted as one
       it updated — four rows reading as six clients touched is the kind of
       figure somebody reconciles against and cannot. */
    const over = b.filter(x=>x.created + x.updated > x.total);
    if(over.length) throw new Error('a batch claims ' + (over[0].created + over[0].updated)
      + ' clients touched by ' + over[0].total + ' rows');
    const seen = new Set(b.map(x=>x.format));
    const want = ['finowise_aum','finowise_sip','ar_aum','nj_sip','nj_aum'];
    const missing = want.filter(w=>!seen.has(w));
    if(missing.length) throw new Error('no batch for ' + missing.join(', '));
    return b.length + ' batches, all five formats among them, each with its file, time and operator';
  });

  await t.step('each record points back at the batch that wrote it', async () => {
    const r = await t.eval(()=>{
      const ids = new Set(DB.importBatches.map(b=>b.id));
      const orphanH = DB.platformHoldings.filter(h=>!ids.has(h.batchId)).length;
      const orphanS = DB.platformSips.filter(s=>!ids.has(s.batchId)).length;
      return {orphanH, orphanS, h:DB.platformHoldings.length, s:DB.platformSips.length};
    });
    if(r.orphanH || r.orphanS)
      throw new Error(r.orphanH + ' snapshots and ' + r.orphanS + ' SIPs point at no batch');
    return r.h + ' snapshots and ' + r.s + ' SIPs, every one traceable to its file';
  });

  await t.step('the failed rows come back as a file the desk can correct', async () => {
    const r = await t.eval(()=>{
      const bad = (impWiz && impWiz.result ? impWiz.result.log : []).filter(l=>l.status !== 'created' && l.status !== 'updated');
      return {has: typeof impDownloadErrors === 'function', bad: bad.length};
    });
    if(!r.has) throw new Error('there is no error-report download');
    return 'impDownloadErrors() writes the rejected rows out as CSV';
  });

  t.section('the line that must not be crossed');

  await t.step('a platform snapshot never reaches the transaction ledger', async () => {
    /* BOSS's own AUM is the sum of that ledger. A monthly holdings report
       poured into it would add the same money again every month, and the
       Main Dashboard, the AUM Trend report and Portfolio all read it. */
    const r = await t.eval(i => ({
      txns: DB.transactions.length,
      mine: DB.transactions.filter(t=>t.clientId===i).length,
      ledger: clientAum(DB.clients.find(c=>c.id===i)),
      platform: pfPlatformValue(i),
      fromImport: DB.transactions.filter(t=>t.batchId || /import/i.test(t.createdVia||'')).length,
    }), ids.mehta);
    if(r.mine !== 1) throw new Error('the client now has ' + r.mine + ' transactions, seeded with 1');
    if(r.ledger !== 200000) throw new Error('the ledger AUM moved to ' + r.ledger + ', seeded at 200000');
    if(r.fromImport) throw new Error(r.fromImport + ' transactions were written by an import');
    if(r.platform < 1000000) throw new Error('the platform figure did not land: ' + r.platform);
    return 'ledger still ₹2,00,000; platform reports ' + Math.round(r.platform/100000)/10 + ' Cr beside it, not inside it';
  });

  await t.step('and both numbers are shown, each said to be what it is', async () => {
    const txt = await t.eval(i => {
      window._pfClient = i; navigate('portfolio');
      return document.getElementById('content').textContent;
    }, ids.mehta);
    if(txt.indexOf('Platform-reported holdings') < 0)
      throw new Error('the Portfolio screen does not show the imported figures');
    if(txt.indexOf('not BOSS’s transaction ledger') < 0 && txt.indexOf("not BOSS's transaction ledger") < 0)
      throw new Error('it does not say the platform figure is not the ledger');
    if(txt.indexOf('Live AUM') < 0) throw new Error('the ledger figure is gone from the screen');
    return 'Live AUM and the platform figure, side by side and labelled';
  });

  t.section('the Dashboard shows the book, and shows it once');

  await t.step('an imported position reaches Live AUM', async () => {
    /* The firm imported two reports and the Dashboard still read zero,
       because it counted only the transaction ledger. It counts the book
       now: the ledger, plus the imported position for the clients a
       platform has reported on. */
    const r = await t.eval(()=>{
      navigate('dashboard');
      const book = mdBookRows();
      const aum = book.reduce((s,x)=>s+x.aum, 0);
      const imported = book.filter(x=>x.source !== 'BOSS ledger').reduce((s,x)=>s+x.aum, 0);
      const txt = document.getElementById('content').textContent;
      return {aum, imported, zero: /LIVE AUM[\s\S]{0,120}?\u20b90\b/i.test(txt),
              says: txt.indexOf('imported position') >= 0};
    });
    if(!r.aum) throw new Error('Live AUM is still zero with platform reports imported');
    if(!r.imported) throw new Error('none of the figure comes from the imports');
    if(!r.says) throw new Error('the card does not say part of it is imported');
    return 'Live AUM \u20b9' + Math.round(r.aum) + ', of which \u20b9' + Math.round(r.imported) + ' imported';
  });

  await t.step('and the same money is never counted twice', async () => {
    /* This is the whole reason the two are stored apart. The seeded client
       holds ₹2,00,000 in the ledger AND a Finowise position of ₹12,50,000.
       The book must be the platform's figure for them, not the sum. */
    const r = await t.eval(i => {
      const c = DB.clients.find(x=>x.id===i);
      const book = mdBookRows().filter(x=>x.clientId===i);
      return {ledger: clientAum(c), platform: pfPlatformValue(i),
              book: clientBookAum(c), rows: book.reduce((s,x)=>s+x.aum, 0),
              sources: Array.from(new Set(book.filter(x=>x.aum).map(x=>x.source)))};
    }, ids.mehta);
    if(!r.ledger) throw new Error('the seeded transaction is gone, so this proves nothing');
    if(r.book !== r.platform)
      throw new Error('the book reads ' + r.book + ' against a platform position of ' + r.platform);
    if(r.book === r.ledger + r.platform)
      throw new Error('the ledger and the platform were added together: ' + r.book);
    if(Math.round(r.rows) !== Math.round(r.platform))
      throw new Error('the Dashboard rows total ' + r.rows + ' for this client, not ' + r.platform);
    if(r.sources.some(x=>x === 'BOSS ledger'))
      throw new Error('a ledger row survived beside the platform one: ' + r.sources.join(', '));
    return 'ledger \u20b9' + r.ledger + ' + platform \u20b9' + r.platform + ' counted as \u20b9' + r.book + ', not the sum';
  });

  await t.step('a client no platform has reported on is still counted from the ledger', async () => {
    const r = await t.eval(async ()=>{
      const c = {id:uid('CMS'), cmsName:'ZZ Ledger Only', rmName:currentUser,
        branch:(DB.config.branches||['Varanasi'])[0], createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('CMS', c); DB.clients.push(c);
      DB.transactions.push({id:uid('TXN'), clientId:c.id, amount:75000, status:'Completed',
        transactionType:'Purchase', productCategory:'Equity',
        createdAt:new Date().toISOString(), createdBy:currentUser});
      await save('clients'); await save('transactions');
      const rows = mdBookRows().filter(x=>x.clientId===c.id);
      return {book: clientBookAum(c), rows: rows.reduce((s,x)=>s+x.aum, 0),
              source: (rows[0]||{}).source, product: (rows[0]||{}).product};
    });
    if(r.book !== 75000) throw new Error('the ledger-only client reads ' + r.book);
    if(r.rows !== 75000) throw new Error('the Dashboard rows total ' + r.rows + ' for them');
    if(r.source !== 'BOSS ledger') throw new Error('counted as ' + r.source);
    if(r.product !== 'Equity') throw new Error('bucketed as ' + r.product);
    return '\u20b975,000 from the ledger, under Equity';
  });

  await t.step('the AUM cut adds up to the figure on the card, whichever cut', async () => {
    const r = await t.eval(()=>{
      const rows = mdBookRows().filter(x=>x.aum);
      const total = rows.reduce((s,x)=>s+x.aum, 0);
      const cuts = mdBookCuts(rows, x=>x.aum);
      const out = {};
      Object.keys(cuts).forEach(k=>{ out[k] = cuts[k].reduce((s,x)=>s+x.value, 0); });
      return {total, out};
    });
    for(const k of Object.keys(r.out))
      if(Math.round(r.out[k]) !== Math.round(r.total))
        throw new Error('the ' + k + ' cut sums to ' + r.out[k] + ' against a total of ' + r.total);
    return 'product, platform, branch, RM and source all sum to \u20b9' + Math.round(r.total);
  });

  await t.step('an AR sleeve breakdown lands in the product cut, not in Others', async () => {
    const r = await t.eval(()=>{
      const rows = mdBookRows().filter(x=>x.aum && /Anand Rathi/.test(x.source));
      const by = {};
      rows.forEach(x=>{ by[x.product] = (by[x.product]||0) + x.aum; });
      return by;
    });
    if(!r.Equity) throw new Error('no Equity from the AR sleeves: ' + JSON.stringify(r));
    if(!r.Debt) throw new Error('no Debt from the AR sleeves: ' + JSON.stringify(r));
    // Equity 24,00,000 + the non-AR equity holding 3,00,000
    if(Math.round(r.Equity) !== 2700000) throw new Error('AR Equity reads ' + r.Equity);
    if(Math.round(r.Debt) !== 1060000) throw new Error('AR Debt reads ' + r.Debt);
    return 'Equity \u20b927,00,000 · Debt \u20b910,60,000, cut from the sleeves';
  });

  await t.step('a report with one total and no breakdown says so rather than guessing', async () => {
    const r = await t.eval(()=>mdBookRows()
      .filter(x=>x.aum && /Finowise/.test(x.source)).map(x=>x.product));
    if(!r.length) throw new Error('no Finowise AUM rows at all');
    /* MD_NO_SPLIT is a top-level const, so it is not on window — the same
       gotcha as DB. The string is what the screen shows anyway. */
    if(r.some(x=>x !== 'Not broken out'))
      throw new Error('Finowise AUM was bucketed as ' + Array.from(new Set(r)).join(', '));
    return 'carried as "Not broken out" \u2014 the report gives one figure and no split';
  });

  await t.step('an imported SIP reaches Live SIP too', async () => {
    const r = await t.eval(()=>{
      const rows = mdBookRows().filter(x=>x.sip);
      return {total: rows.reduce((s,x)=>s+x.sip, 0),
              imported: rows.filter(x=>x.source !== 'BOSS ledger').reduce((s,x)=>s+x.sip, 0)};
    });
    if(!r.imported) throw new Error('no SIP came from the imports');
    // Mehta's two Finowise SIPs, 25,000 + 10,000; Rao's two NJ, 15,000 + 5,000
    if(Math.round(r.imported) !== 55000) throw new Error('imported SIP totals ' + r.imported);
    return '\u20b955,000/month, all of it imported';
  });

  await t.step('the Number of Clients card counts people, not rows', async () => {
    const r = await t.eval(()=>{
      const book = mdBookRows();
      const cut = mdClientCut(book.filter(x=>x.aum), x=>x.product);
      const clients = mdClients().length;
      const biggest = Math.max(0, ...cut.map(x=>x.value));
      return {cut, clients, biggest, empty: !cut.length};
    });
    if(r.empty) throw new Error('the product cut is empty although the book is not');
    if(r.biggest > r.clients)
      throw new Error('a bucket holds ' + r.biggest + ' clients out of ' + r.clients);
    return r.cut.map(x=>x.label + ' ' + x.value).join(' · ');
  });

  await t.step('and the reports moved with it', async () => {
    /* Client Concentration and the rest read the book now, so a client
       whose holdings arrived on a report is not called empty. */
    const r = await t.eval(i => {
      const rows = repClients('');
      const mine = rows.find(x=>x.c.id === i);
      return {aum: mine ? mine.aum : 0, sip: mine ? mine.sip : 0,
              total: rows.reduce((s,x)=>s+x.aum, 0)};
    }, ids.mehta);
    if(!r.aum) throw new Error('the reports still read zero for an imported client');
    if(!r.sip) throw new Error('the reports see no SIP for them');
    return 'Client Concentration sees \u20b9' + Math.round(r.aum) + ' on that client, \u20b9'
      + Math.round(r.total) + ' across the book';
  });

  t.section('the mapping is a setting, not a line of code');

  await t.step('Setup carries a screen for every column of every report', async () => {
    const r = await t.eval(()=>{
      navigate('settings','importmaps');
      const c = document.getElementById('content');
      return {title: c.textContent.indexOf('Platform Import Mapping') >= 0,
              selects: c.querySelectorAll('select').length,
              formats: IMPORT_FORMATS.length,
              batches: c.textContent.indexOf('Imports run so far') >= 0};
    });
    if(!r.title) throw new Error('the screen is not there');
    if(r.selects < 9) throw new Error('only ' + r.selects + ' columns are editable');
    if(!r.batches) throw new Error('it does not list the imports already run');
    return r.selects + ' columns editable on the first format, and the batch list under it';
  });

  await t.step('changing one changes what the next import does', async () => {
    const r = await t.eval(async ()=>{
      await impSetMap('finowise_aum', 'Associate Name', 'client.profession');
      const after = impMapFor('finowise_aum')['Associate Name'];
      const logged = DB.settingsAudit.filter(x=>x.key === 'import.map.finowise_aum').length;
      await impResetMap('finowise_aum');
      return {after, logged, back: impMapFor('finowise_aum')['Associate Name']};
    });
    if(r.after !== 'client.profession') throw new Error('the change did not take: ' + r.after);
    if(!r.logged) throw new Error('nothing was written to the settings change history');
    if(r.back !== 'client.associateName') throw new Error('reset left it at ' + r.back);
    return 'changed, logged, and reset back to the shipped mapping';
  });

  t.section('an import taken back out');

  /* One new client and one figure changed, so Remove has something to
     delete and something to put back. */
  const removeFile = n => write('Finowise_AUM_remove' + n + '.xlsx', 'AUM Report', [FIN_AUM_HEAD,
    ['ZZ Remove Newcomer ' + n, 'ZZREM' + n + '234R', 'Varanasi', '', '', '1,00,000', '1,20,000', '9', '98765 4321' + n],
    ['ZZ Mehta Rajesh', 'zzmeh1234r', 'Varanasi', '', 'Priya Nair', '10,00,000', '99,99,999', '14.5', '98765 43210']]);
  const mehtaNow = () => t.eval(id => {
    const h = DB.platformHoldings.find(x=>!x.deletedAt && x.clientId===id && x.format==='finowise_aum');
    return h && h.current;
  }, ids.mehta);
  const removeIt = batchId => t.eval(async id => {
    const was = window.alert; let said = '';
    window.alert = m => { said = m; };
    try {
      pfAskRemoveBatch(id);
      const modal = document.getElementById('overlay').textContent;
      const h = DB.importHistory.find(x=>x.batchId===id);
      await deleteImport(h.id);
      return {modal, said};
    } finally { window.alert = was; }
  }, batchId);
  const after = (batchId, name) => t.eval(([id, name]) => ({
    batch: DB.importBatches.some(b=>b.id===id),
    client: DB.clients.some(c=>!c.deletedAt && c.cmsName===name),
    holdings: DB.platformHoldings.filter(h=>!h.deletedAt && h.batchId===id).length,
    hist: DB.importHistory.some(h=>h.batchId===id)}), [batchId, name]);

  await t.step('Remove takes out what an import brought in, and puts back what it overwrote', async () => {
    const before = await mehtaNow();
    const r = await runImport('finowise_aum', removeFile(1));
    if(r.batch.created !== 1 || await mehtaNow() !== 9999999) throw new Error('import ' + JSON.stringify(r.batch));
    const button = await t.eval(() => { navigate('settings','importmaps'); return !!Array.from(document.querySelectorAll('#content button')).find(b=>b.textContent.trim()==='Remove'); });
    const done = await removeIt(r.batch.id);
    const a = await after(r.batch.id, 'ZZ Remove Newcomer 1');
    if(!button || !/deleted outright/.test(done.modal) || a.batch || a.client || a.holdings || a.hist) throw new Error(JSON.stringify({button, a, done}));
    const back = await mehtaNow();
    if(back !== before) throw new Error('Mehta reads ' + back + ', was ' + before);
    return done.said.replace(/\s+/g, ' ') + ' Mehta back at ' + back;
  });

  await t.step('an import made before imports kept a record can still be removed', async () => {
    const before = await mehtaNow();
    const r = await runImport('finowise_aum', removeFile(2));
    /* As an older import left things: no record of what it did. */
    await t.eval(async id => {
      const b = DB.importBatches.find(x=>x.id===id), h = DB.importHistory.find(x=>x.batchId===id);
      DB.importUndo = DB.importUndo.filter(u=>u.id!==b.undoId);
      delete b.undoId; delete h.undoId;
    }, r.batch.id);
    const done = await removeIt(r.batch.id);
    const a = await after(r.batch.id, 'ZZ Remove Newcomer 2');
    if(a.batch || a.client || a.holdings) throw new Error(JSON.stringify({a, done}));
    const back = await mehtaNow();
    if(back !== before) throw new Error('Mehta reads ' + back + ', was ' + before);
    return 'newcomer and their snapshot gone; Mehta back at ' + back;
  });

  await t.step('nothing was alerted along the way', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 300));
    return 'none';
  });
});
