/* THE SAMPLE SHEET, FILLED IN, DROPPED ON THE WRONG DOOR.

   Setup › Import has two upload buttons, and the first one is for
   putting a BOSS export back: a file whose headings are the stored keys
   a record is written under — name, mobile, pan — matched on the id the
   export carries. The second, further down, is for a sheet somebody
   typed, and it is the one the sample sheet belongs to: it matches each
   heading to the field whose label it is, checks every value, and shows
   what it would do before it does it.

   A firm downloaded the sample sheet for CMS, filled in five hundred
   clients, and dropped it on the first button, which is what a first
   button is for. Every heading on it was a label — "CMS Name (Client
   Name)" — so every record arrived with a field of that name on it, and
   not one of them had a cmsName. Five hundred and sixty-three clients,
   created, counted, reported as imported, and empty in every column the
   CRM draws. The import said "563 added" and it was true.

   What this holds to, then, in the shape the real file had: two sheets,
   a shared string table, deflated entries, and rows with the blank
   cells left out of the XML rather than written as blanks.

     · that door recognises the sample sheet and hands it to the
       importer that can read it, writing nothing on the way past;
     · what it writes, it writes under the keys the profile reads, and
       the profile shows them;
     · a record is never written under a column heading again;
     · a sheet that reaches no field of the module is refused rather
       than turned into empty records;
     · and a real export still goes back exactly as it came, keys that
       no field registry declares included.                           */
const {suite} = require('../lib/harness');
const {xlsxBook} = require('../lib/xlsx-write');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bosssample-'));
const write = (name, sheets) => {
  const p = path.join(DIR, name);
  fs.writeFileSync(p, xlsxBook(sheets));
  return p;
};
const onServer = async (t, key) => t.eval(async (k)=>{
  const res = await fetch('/api/storage/' + encodeURIComponent(k), {headers: apiHeaders()});
  if(res.status === 404) return null;
  if(!res.ok) throw new Error('storage get failed: ' + res.status);
  return JSON.parse((await res.json()).value);
}, key);

/* The columns the firm filled in, as BOSS itself labels them. Asked of
   the running app rather than written down here, so a renamed field
   renames the fixture with it. */
const PICK = ['cmsName','mobile','email','pan','mailingCity','mailingState','uccNo','branch'];

suite(async t => {
  await t.home();

  let fields = null, sample = '', guide = null;

  await t.step('the sample sheet BOSS writes is headed with field names, not stored keys', async () => {
    fields = await t.eval((pick)=>{
      const all = mapImpFields('clients');
      const sheets = mapImpTemplateSheets('clients');
      return {headers: sheets[0].rows[0], guideName: sheets[1].name,
        guideRows: sheets[1].rows.length,
        all: all.length,
        picked: pick.map(k=>{
          const f = all.find(x=>x.k === k);
          return f ? {k: f.k, l: f.l || f.k, at: all.indexOf(f)} : null;
        })};
    }, PICK);
    if(fields.picked.some(x=>!x)) throw new Error('a field this suite relies on is gone from CMS');
    if(fields.headers[fields.picked[0].at] !== fields.picked[0].l)
      throw new Error('the sample sheet is not headed with labels any more');
    if(fields.headers.indexOf('cmsName') >= 0)
      throw new Error('the sample sheet is headed with stored keys — this suite is testing the wrong thing');
    return fields.all + ' columns, headed "' + fields.headers[0] + '", and a '
      + fields.guideRows + '-row "' + fields.guideName + '" sheet beside it';
  });

  await t.step('a firm fills it in: two sheets, shared strings, blanks left out', async () => {
    const VALUES = {cmsName:'ZZ Sample Madhur', mobile:'9820270693', email:'zzsample@example.in',
      pan:'BUHPM2274G', mailingCity:'Mumbai', mailingState:'MAHARASHTRA', uccNo:'ZZUCC1',
      branch:'Varanasi'};
    const row = n => {
      const r = new Array(fields.headers.length).fill('');
      fields.picked.forEach(f=>{
        r[f.at] = f.k === 'cmsName' ? VALUES.cmsName + ' ' + n
                : f.k === 'mobile' ? String(Number(VALUES.mobile) + n)
                : f.k === 'email' ? 'zzsample' + n + '@example.in'
                : f.k === 'uccNo' ? VALUES.uccNo + n
                : f.k === 'pan' ? 'BUHPM' + (2270 + n) + 'G'
                : VALUES[f.k];
      });
      return r;
    };
    guide = [['Column','Must be filled in','What it takes','Allowed values','Example']]
      .concat(fields.headers.map(h=>[h, 'No', 'Text', '', 'Example ' + h]));
    sample = write('CMS - Copy.xlsx', [
      {name:'Clients (CMS)', rows: [fields.headers, row(1), row(2)]},
      {name:'How to fill this in', rows: guide},
    ]);
    const size = fs.statSync(sample).size;
    return path.basename(sample) + ', ' + size + ' bytes, '
      + fields.headers.length + ' columns of which ' + PICK.length + ' are filled in, on the first of two sheets';
  });

  t.section('the door it gets dropped on');

  await t.step('the exported-file button recognises the sample sheet and writes nothing', async () => {
    await t.eval(()=>{ navigate('settings', 'importback'); window._impBackForce = ''; });
    await t.wait(200);
    const before = await t.eval(()=>DB.clients.length);
    await t.page.setInputFiles('#impBackFile', sample);
    await t.wait(1600);
    const r = await t.eval(()=>({
      wroteNothing: DB.clients.length,
      noExportPlan: impBackState === null,
      handed: !!mapImp,
      srcId: mapImp ? mapImp.srcId : '',
      sheet: mapImp ? mapImp.sheet : '',
      mapped: mapImp ? mapImpBuild().mapped : 0,
      rows: mapImp ? mapImpBuild().rows.length : 0,
      verdicts: mapImp ? mapImpBuild().rows.map(x=>x.verdict) : [],
      onScreen: /matches .*fields|Field it lands in/.test(document.getElementById('content').textContent),
    }));
    if(r.wroteNothing !== before) throw new Error('it wrote ' + (r.wroteNothing - before) + ' record(s) on sight');
    if(!r.noExportPlan) throw new Error('it was taken for an export and a restore was offered');
    if(!r.handed) throw new Error('it was not handed to the importer that maps columns');
    if(r.srcId !== 'clients') throw new Error('it was handed over as ' + r.srcId);
    if(r.sheet !== 'Clients (CMS)') throw new Error('the instruction sheet was read as the data: ' + r.sheet);
    if(r.mapped !== PICK.length + (fields.headers.length - PICK.length))
      throw new Error('only ' + r.mapped + ' of ' + fields.headers.length + ' columns matched');
    if(r.rows !== 2 || r.verdicts.some(v=>v !== 'add'))
      throw new Error('the rows came out as ' + r.verdicts.join(', '));
    const said = t.dialogs.map(String).join(' ');
    if(!/sample sheet/i.test(said)) throw new Error('nothing told the person what had happened: ' + said);
    return r.mapped + ' of ' + fields.headers.length + ' columns matched, 2 rows to add, nothing written yet '
      + '— and it says so: "' + t.dialogs[t.dialogs.length - 1].split('\n')[0].slice(0, 70) + '…"';
  });

  await t.step('importing it puts every value under the key the profile reads', async () => {
    const r = await t.eval(async ()=>{
      const before = DB.clients.length;
      await mapImpApply();
      const made = DB.clients.slice(before);
      const one = made[0] || {};
      return {made: made.length, one,
        keys: Object.keys(one),
        labelKeys: Object.keys(one).filter(k=>/[ ()./]/.test(k)),
        onProfile: cmsFieldsFlatAll().filter(f=>one[f.k] !== undefined && one[f.k] !== '').length,
        said: null};
    });
    if(r.made !== 2) throw new Error('it created ' + r.made + ' client(s)');
    if(r.labelKeys.length)
      throw new Error('a record was written under a column heading: ' + r.labelKeys.join(', '));
    const want = {cmsName:'ZZ Sample Madhur 1', mobile:'9820270694', pan:'BUHPM2271G',
      mailingCity:'Mumbai', uccNo:'ZZUCC11'};
    const miss = Object.keys(want).filter(k=>String(r.one[k] || '') !== want[k]);
    if(miss.length) throw new Error('these did not land: '
      + miss.map(k=>k + ' = ' + JSON.stringify(r.one[k])).join(', '));
    const held = await onServer(t, 'clients');
    const there = (held || []).find(c=>c.id === r.one.id);
    if(!there) throw new Error('it is not on the server, so it dies with the tab');
    if(there.cmsName !== want.cmsName || there.mobile !== want.mobile)
      throw new Error('the server holds something else: ' + JSON.stringify(there).slice(0, 160));
    const said = t.dialogs.map(String).join(' ');
    if(!/every value of every mapped column/i.test(said))
      throw new Error('the import did not say it had read what it wrote back: ' + said.slice(-200));
    return r.made + ' clients, ' + r.onProfile + ' filled field(s) on the first of them, every one of them '
      + 'read back off the server afterwards';
  });

  await t.step('and the CMS profile shows them', async () => {
    const r = await t.eval(()=>{
      const c = DB.clients.find(x=>/^ZZ Sample Madhur 1$/.test(x.cmsName || ''));
      if(!c) return {found:false};
      navigate('cms');
      const list = document.getElementById('content').textContent;
      navigate('cms', c.id);
      const detail = document.getElementById('content').textContent;
      navigate('cms');
      return {found:true, id: c.id,
        inList: list.indexOf('ZZ Sample Madhur 1') >= 0,
        name: detail.indexOf('ZZ Sample Madhur 1') >= 0,
        mobile: detail.indexOf('9820270694') >= 0,
        pan: detail.indexOf('BUHPM2271G') >= 0,
        city: detail.indexOf('Mumbai') >= 0};
    });
    if(!r.found) throw new Error('the imported client is not in CMS at all');
    if(!r.inList) throw new Error('it is not in the CMS list');
    const blank = ['name','mobile','pan','city'].filter(k=>!r[k]);
    if(blank.length) throw new Error('the profile shows nothing for: ' + blank.join(', '));
    return 'name, mobile, PAN and city all on the profile at ' + r.id + ', and the name in the CMS list';
  });

  t.section('and the two things that must not happen again');

  await t.step('a sheet that reaches no field of the module is refused, not turned into empty records', async () => {
    const junk = write('ledger.xlsx', [{name:'Sheet1', rows:[
      ['Voucher','Narration','Debit','Credit'],
      ['V-1','opening balance', 100, 0],
      ['V-2','closing balance', 0, 100]]}]);
    await t.eval(()=>{ navigate('settings', 'importback'); impBackSetSource('clients'); });
    await t.wait(150);
    const before = await t.eval(()=>DB.clients.length);
    await t.page.setInputFiles('#impBackFile', junk);
    await t.wait(1400);
    const r = await t.eval(()=>{
      const st = impBackState;
      const el = document.querySelector('.modal');
      const body = el ? el.textContent.replace(/\s+/g, ' ') : '';
      const btn = Array.from(document.querySelectorAll('.modal button'))
        .find(b=>/Import|Nothing to import/.test(b.textContent));
      return {plans: st ? st.plans.map(p=>({fields: p.fields, add: p.add.length, skip: p.skip.length,
        ignored: (p.ignored || []).length})) : null,
        warns: /Nothing in this file lands anywhere/.test(body),
        says: /does not recognise/.test(body),
        button: btn ? btn.textContent.trim() : '', disabled: btn ? btn.disabled : null,
        clients: DB.clients.length};
    });
    await t.eval(()=>{ closeModal(); impBackState = null; window._impBackForce = ''; });
    if(r.clients !== before) throw new Error('it wrote ' + (r.clients - before) + ' empty record(s)');
    if(!r.plans || r.plans[0].add) throw new Error('it would have added ' + r.plans[0].add + ' record(s)');
    if(r.plans[0].skip !== 2) throw new Error('the rows were not held back: ' + JSON.stringify(r.plans[0]));
    if(!r.warns || !r.says) throw new Error('the dialog does not say the columns reach nothing');
    if(r.disabled !== true) throw new Error('the import button is still live: "' + r.button + '"');
    return '4 columns, none of them a CMS field: both rows held back, "' + r.button + '", and the dialog '
      + 'names the ' + r.plans[0].ignored + ' columns it does not recognise';
  });

  await t.step('a module already full of bad keys does not get more of them', async () => {
    /* What the firm's own CMS looked like when this was found: records
       whose fields are named after the columns of the sheet that made
       them. Those names are on records here now, so anything that asks
       the records what a key looks like would call them keys. */
    await t.eval((h)=>{
      const junk = {id:'CMS-ZZJUNK'};
      h.forEach((x, i)=>{ if(i < 6) junk[x] = 'whatever'; });
      DB.clients.push(junk);
    }, fields.headers);
    await t.eval(()=>{ navigate('settings', 'importback'); window._impBackForce = ''; });
    await t.wait(150);
    const before = await t.eval(()=>DB.clients.length);
    await t.page.setInputFiles('#impBackFile', sample);
    await t.wait(1600);
    const r = await t.eval(()=>({wrote: DB.clients.length, handed: !!mapImp,
      srcId: mapImp ? mapImp.srcId : '', mapped: mapImp ? mapImpBuild().mapped : 0}));
    await t.eval(()=>{ mapImpClear(); DB.clients = DB.clients.filter(c=>c.id !== 'CMS-ZZJUNK'); });
    if(r.wrote !== before) throw new Error('it wrote ' + (r.wrote - before) + ' record(s) on sight');
    if(!r.handed || r.srcId !== 'clients')
      throw new Error('with bad keys on the records it was taken for an export again');
    if(r.mapped !== fields.headers.length)
      throw new Error('only ' + r.mapped + ' columns matched this time');
    return 'six label-named keys on a record here, and the sample sheet is still read as a sample sheet';
  });

  await t.step('a real export still goes back exactly as it came', async () => {
    const r = await t.eval(()=>{
      const c = DB.clients.find(x=>/^ZZ Sample Madhur 1$/.test(x.cmsName || ''));
      return {id: c.id, keys: Object.keys(c)};
    });
    const exported = write('BOSS_clients_20261014.xlsx', [{name:'clients', rows:[
      ['id','cmsName','mobile','blueprintHistoryNote'],
      ['ZZ-BACK-1','ZZ Put Back','9811111111','a key no field registry declares'],
    ]}]);
    await t.eval(()=>{ navigate('settings', 'importback'); window._impBackForce = ''; });
    await t.wait(150);
    await t.page.setInputFiles('#impBackFile', exported);
    await t.wait(1400);
    const seen = await t.eval(()=>({
      asExport: !!impBackState, handed: !!mapImp,
      srcId: impBackState ? impBackState.plans[0].srcId : '',
      add: impBackState ? impBackState.plans[0].add.length : 0,
      fields: impBackState ? impBackState.plans[0].fields : 0,
    }));
    if(seen.handed) throw new Error('an export was mistaken for a sample sheet');
    if(!seen.asExport || seen.srcId !== 'clients' || seen.add !== 1)
      throw new Error('the export was not read as one: ' + JSON.stringify(seen));
    await t.eval(async ()=>{ await impBackApply(); });
    await t.wait(400);
    const back = await t.eval(()=>{
      const c = (DB.clients || []).find(x=>x.id === 'ZZ-BACK-1') || {};
      return {id: c.id, cmsName: c.cmsName, mobile: c.mobile, extra: c.blueprintHistoryNote};
    });
    if(back.id !== 'ZZ-BACK-1' || back.cmsName !== 'ZZ Put Back')
      throw new Error('the export did not come back: ' + JSON.stringify(back));
    if(back.extra !== 'a key no field registry declares')
      throw new Error('a key the registry does not declare was dropped — a restore would be lossy');
    return 'id kept, every key kept, including one no field declares — ' + r.keys.length
      + ' keys on the record beside it';
  });
});
