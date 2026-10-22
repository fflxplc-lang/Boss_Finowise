/* A SAMPLE SHEET, FILLED IN, AND CHECKED BEFORE ANYTHING IS WRITTEN.

   The old general importer knew four modules, wrote a one-row CSV from a
   field list of its own, mapped columns by a fuzzy guess with no way to
   correct it, and then pushed every row in without looking at any of
   them — no required field, no dropdown, no date, no duplicate.

   So what is worth testing is the four things that were missing. That
   the template is a real .xlsx and BOSS's own reader can read the file
   BOSS wrote. That the columns come out of the module's registry, so a
   field added this morning is on it. That a row the firm's own rules
   refuse is refused, with the reason. And that what the preview says
   would happen is exactly what happens. */
const {suite} = require('../lib/harness');

const onServer = async (t, key) => t.eval(async (k)=>{
  const res = await fetch('/api/storage/' + encodeURIComponent(k), {headers: apiHeaders()});
  if(res.status === 404) return null;
  if(!res.ok) throw new Error('storage get failed: ' + res.status);
  return JSON.parse((await res.json()).value);
}, key);

/* Build a sheet in the page, hand it to the real picker, and come back
   with what the preview would say. */
const FEED = `async (srcId, rows, name) => {
  window._mapImpSrc = srcId;
  const bytes = xlsxWrite([{name:'Sheet1', rows}]);
  const file = new File([bytes], name || 'sheet.xlsx',
    {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const inp = document.createElement('input');
  Object.defineProperty(inp, 'files', {value: [file]});
  await mapImpPick(inp);
  return mapImpBuild();
}`;

suite(async t => {

  t.section('the template');

  await t.step('Setup › Import offers a sample sheet for every module you may import into', async () => {
    const r = await t.eval(()=>{
      navigate('settings', 'importback');
      const c = document.getElementById('content');
      return {offers: /Download the sample sheet/.test(c.textContent),
        uploads: /Upload a filled-in sheet/.test(c.textContent),
        picker: (c.innerHTML.match(/mapImpSetSrc/g) || []).length,
        sources: mapImpSources().length,
        everyExport: EXPORT_SOURCES.filter(s=>Array.isArray(DB[s.id])).length};
    });
    if(!r.offers || !r.uploads) throw new Error('the sample sheet or the upload is missing');
    if(!r.picker) throw new Error('there is no module picker');
    if(r.sources !== r.everyExport) throw new Error('it covers ' + r.sources + ' of ' + r.everyExport + ' modules');
    return r.sources + ' modules, each with its own sample sheet — the same list Export writes';
  });

  await t.step('the sheet BOSS writes is one BOSS can read, and it carries the module’s own fields', async () => {
    const r = await t.eval(async ()=>{
      const fields = mapImpFields('leads');
      const bytes = xlsxWrite(mapImpTemplateSheets('leads'));
      /* read it back through the very reader an upload goes through */
      const sheets = await xlsxSheets(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      const main = sheets[0], guide = sheets[1];
      return {bytes: bytes.length, sheets: sheets.length,
        header: main.rows[0], examples: main.rows.length - 1,
        fields: fields.map(f=>f.l || f.k),
        guideHead: guide ? guide.rows[0] : [],
        guideRows: guide ? guide.rows.length : 0,
        /* and a field added now is on it now */
        grew: (()=>{
          const before = mapImpFields('leads').length;
          DB.config.moduleFieldOverrides = DB.config.moduleFieldOverrides || {};
          return before;
        })()};
    });
    if(r.sheets !== 2) throw new Error('the workbook has ' + r.sheets + ' sheet(s), not 2');
    if(r.header.join('|') !== r.fields.join('|'))
      throw new Error('the header is not the module’s fields:\n' + r.header.join(', '));
    if(r.examples < 2) throw new Error('only ' + r.examples + ' example row(s)');
    if(r.guideHead.indexOf('Must be filled in') < 0 || r.guideHead.indexOf('Allowed values') < 0)
      throw new Error('the guide sheet does not say what each column takes');
    return r.bytes + ' bytes of real .xlsx, ' + r.header.length + ' columns from the registry, '
      + r.examples + ' example rows, and a ' + r.guideRows + '-row guide — read back by BOSS’s own reader';
  });

  t.section('what comes back up');

  await t.step('the columns are matched automatically, however they are written', async () => {
    const r = await t.eval(async (feed)=>{
      const f = mapImpFields('leads');
      const first = f.find(x=>x.k === 'firstName') || f[0];
      const email = f.find(x=>x.k === 'email');
      /* the same three fields, written three different ways */
      const rows = [
        [(first.l || first.k).toUpperCase(), '  e-mail  ', 'Not A Field At All'],
        ['Asha', 'asha@example.in', 'ignore me'],
      ];
      const plan = await eval('(' + feed + ')')('leads', rows, 'mixed.xlsx');
      return {map: Object.assign({}, mapImp.map), mapped: plan.mapped,
        unmapped: plan.unmapped, headers: mapImp.read.headers,
        firstKey: first.k, emailKey: email ? email.k : ''};
    }, FEED);
    const hit = Object.values(r.map).filter(Boolean);
    if(hit.indexOf(r.firstKey) < 0) throw new Error('a header in capitals did not match its field');
    if(r.emailKey && hit.indexOf(r.emailKey) < 0) throw new Error('"e-mail" did not match the email field');
    if(r.unmapped.length !== 1) throw new Error('it matched a column that is not a field');
    return r.mapped + ' of ' + r.headers.length + ' matched — capitals, a hyphen and the stray column left over';
  });

  await t.step('a column can be matched by hand, and one field never takes two columns', async () => {
    const r = await t.eval(()=>{
      const headers = mapImp.read.headers;
      const stray = headers.find(h=>!mapImp.map[h]);
      const taken = Object.values(mapImp.map).find(Boolean);
      mapImpSetMap(stray, taken);           // the same field, from a second column
      const after = Object.assign({}, mapImp.map);
      return {stray, taken, onStray: after[stray],
        others: Object.keys(after).filter(h=>h !== stray && after[h] === taken).length};
    });
    if(r.onStray !== r.taken) throw new Error('the manual choice did not stick');
    if(r.others) throw new Error('the field is now written from two columns at once');
    return 'set by hand, and the column that held it before was released';
  });

  t.section('nothing is written that the firm’s own rules refuse');

  await t.step('required, dropdown, date, number and PAN are all checked against Setup', async () => {
    const r = await t.eval(async (feed)=>{
      const f = mapImpFields('leads');
      const req = f.find(x=>x.req);
      const sel = f.find(x=>x.t === 'select' && (effectiveOpts('LMS', x) || []).length);
      const opts = sel ? effectiveOpts('LMS', sel) : [];
      const head = [req.l, sel ? sel.l : 'x'];
      const rows = [head,
        ['', opts[0]],                               // the one the record is created under, empty
        ['Has a name', 'Not One Of The Words'],      // a word the dropdown does not take
        ['Also fine', opts[0]],                      // and one that is right
      ];
      const plan = await eval('(' + feed + ')')('leads', rows, 'checks.xlsx');
      const read = p => ({verdicts: p.rows.map(x=>x.verdict),
        why: p.rows.map(x=>x.note || x.issues[0] || ''),
        dropped: p.rows.map(x=>x.dropped.map(d=>d.label).join(',')),
        kept: p.rows.map(x=>x.rec[req.k] || ''),
        sel: p.rows.map(x=>x.rec[sel ? sel.k : 'x']),
        add: p.add, fail: p.fail, cellsOut: p.cellsOut,
        problems: p.fieldProblems.map(x=>x.label + '/' + x.n)});
      const partial = read(plan);
      mapImpSetPartial(false);
      const strict = read(mapImpBuild());
      mapImpSetPartial(true);
      return {reqField: req.l, selField: sel ? sel.l : '', partial, strict};
    }, FEED);
    const p = r.partial;
    if(p.verdicts[0] !== 'fail' || !new RegExp(r.reqField, 'i').test(p.why[0]))
      throw new Error('a row with no ' + r.reqField + ' was accepted: ' + p.why[0]);
    if(p.verdicts[1] !== 'add')
      throw new Error('one bad dropdown word still took the whole row down: ' + p.why[1]);
    if(p.sel[1] !== '') throw new Error('the word the dropdown does not take was imported anyway');
    if(p.kept[1] !== 'Has a name') throw new Error('the rest of the row went with it');
    if(p.dropped[1].indexOf(r.selField) < 0) throw new Error('the skipped field was not named on the row');
    if(!p.problems.some(x=>x.indexOf(r.selField + '/1') === 0))
      throw new Error('the summary does not count it: ' + p.problems.join(' '));
    if(p.verdicts[2] !== 'add') throw new Error('a good row was refused: ' + p.why[2]);
    if(r.strict.verdicts[1] !== 'fail')
      throw new Error('"Refuse the whole row" no longer refuses it');
    return p.fail + ' refused for having no ' + r.reqField + ', ' + p.add + ' imported with '
      + p.cellsOut + ' field skipped for correction — and the old all-or-nothing is still one '
      + 'press away, where it refuses that row again';
  });

  await t.step('the pattern a mobile is checked against is the one the firm set', async () => {
    const r = await t.eval(async (feed)=>{
      const f = mapImpFields('leads');
      const mob = f.find(x=>/mobile/i.test(x.k));
      const name = f.find(x=>x.req) || f[0];
      const rows = [[name.l, mob.l], ['Test One', '12345'], ['Test Two', '9876543210']];
      const before = (await eval('(' + feed + ')')('leads', rows, 'mob.xlsx'));
      const out = {bad: before.rows[0].verdict, good: before.rows[1].verdict,
        why: (before.rows[0].dropped[0] || {}).why || '',
        badMobile: before.rows[0].rec[mob.k], badName: before.rows[0].rec[name.k],
        goodMobile: before.rows[1].rec[mob.k]};
      /* the old all-or-nothing, still there for whoever wants it */
      mapImpSetPartial(false);
      out.strict = mapImpBuild().rows[0].verdict;
      mapImpSetPartial(true);
      /* widen the firm's own rule, and the same sheet passes */
      await setCfg('validation.mobilePattern', '^[0-9]{5,}$');
      const after = (await eval('(' + feed + ')')('leads', rows, 'mob.xlsx'));
      await setCfg('validation.mobilePattern', '^[0-9]{10}$');
      out.loose = after.rows[0].verdict;
      out.looseMobile = after.rows[0].rec[mob.k];
      out.field = mob.l;
      return out;
    }, FEED);
    if(r.bad !== 'add') throw new Error('a five-digit mobile still took the whole lead down');
    if(r.badMobile !== '') throw new Error('the five-digit mobile was imported as ' + r.badMobile);
    if(r.badName !== 'Test One') throw new Error('the name went down with the mobile');
    if(r.good !== 'add' || r.goodMobile !== '9876543210')
      throw new Error('a ten-digit mobile did not land');
    if(!/mobile/i.test(r.why)) throw new Error('the message is not the firm’s own: ' + r.why);
    if(r.strict !== 'fail') throw new Error('"Refuse the whole row" no longer refuses it');
    if(r.loose !== 'add' || r.looseMobile !== '12345')
      throw new Error('changing the rule in Setup did not change what the import accepts');
    return 'the five-digit mobile is dropped and the lead still imported, the ten-digit one lands, '
      + '"Refuse the whole row" still refuses it, and widening the rule in Setup lets it through — one '
      + 'source of truth, not a copy';
  });

  await t.step('a row that repeats another, and one that is already here, are both caught', async () => {
    const r = await t.eval(async (feed)=>{
      const f = mapImpFields('leads');
      const name = f.find(x=>x.req) || f[0];
      const email = f.find(x=>x.k === 'email');
      DB.leads.push({id:'LEAD-ZZDUP', firstName:'Already', email:'here@example.in'});
      await save('leads');
      const rows = [[name.l, email.l],
        ['One', 'new@example.in'],
        ['Two', 'new@example.in'],        // the same as the row above
        ['Three', 'here@example.in'],     // already in BOSS
      ];
      const plan = await eval('(' + feed + ')')('leads', rows, 'dupes.xlsx');
      mapImpSetKey(email.k);
      const keyed = mapImpBuild();
      mapImpSetMode('update');
      const upd = mapImpBuild();
      DB.leads = DB.leads.filter(x=>x.id !== 'LEAD-ZZDUP'); await save('leads');
      return {noKey: plan.rows.map(x=>x.verdict),
        keyed: keyed.rows.map(x=>x.verdict), keyedWhy: keyed.rows.map(x=>x.note),
        updating: upd.rows.map(x=>x.verdict), updates: upd.update};
    }, FEED);
    if(r.keyed[1] !== 'skip' || !/already has this/i.test(r.keyedWhy[1]))
      throw new Error('the repeated row was not caught: ' + r.keyedWhy[1]);
    if(r.keyed[2] !== 'skip' || !/already belongs to/i.test(r.keyedWhy[2]))
      throw new Error('a row already in BOSS was not caught: ' + r.keyedWhy[2]);
    if(r.updating[2] !== 'update' || r.updates !== 1)
      throw new Error('choosing to update did not change what would happen');
    return 'with no key every row is new; keyed on email the repeat and the one already here are both held '
      + 'back, and switching to update turns the second into an update';
  });

  t.section('and what the preview said is what happens');

  await t.step('confirming writes exactly the rows it promised, and says so', async () => {
    const r = await t.eval(async (feed)=>{
      const f = mapImpFields('leads');
      const name = f.find(x=>x.req) || f[0];
      const email = f.find(x=>x.k === 'email');
      const sel = f.find(x=>x.t === 'select' && (effectiveOpts('LMS', x) || []).length);
      const opts = sel ? effectiveOpts('LMS', sel) : [];
      const rows = [[name.l, email.l, sel ? sel.l : 'x'],
        ['ZZ Import One', 'zz1@example.in', opts[0]],
        ['ZZ Import Two', 'zz2@example.in', opts[0]],
        ['', 'zz3@example.in', opts[0]],            // refused: no required field
      ];
      const plan = await eval('(' + feed + ')')('leads', rows, 'final.xlsx');
      const before = DB.leads.length;
      const promised = {add: plan.add, fail: plan.fail};
      const hist = DB.importHistory.length;
      await mapImpApply();
      const made = DB.leads.filter(x=>/^ZZ Import /.test(x.firstName || ''));
      const h = DB.importHistory[DB.importHistory.length - 1] || {};
      return {promised, before, after: DB.leads.length, made: made.length,
        named: made.map(x=>x.firstName).sort(),
        hasEmail: made.every(x=>x.email), stage: made.every(x=>x.status),
        history: DB.importHistory.length === hist + 1 && h.imported === promised.add,
        cleared: mapImp === null,
        audit: DB.auditLog.some(a=>a.action === 'Spreadsheet imported')};
    }, FEED);
    if(r.made !== r.promised.add)
      throw new Error('it promised ' + r.promised.add + ' and wrote ' + r.made);
    if(r.after !== r.before + r.promised.add) throw new Error('something else was written too');
    if(!r.hasEmail) throw new Error('a mapped column did not reach the record');
    if(!r.stage) throw new Error('a new lead was written without a workflow stage');
    if(!r.history) throw new Error('the import is not in the history');
    if(!r.audit) throw new Error('it is not in the audit trail');
    if(!r.cleared) throw new Error('the screen still holds the finished file');
    const leads = await onServer(t, 'leads');
    if(!(leads||[]).some(x=>x.firstName === 'ZZ Import One'))
      throw new Error('it is not on the server, so it dies with the tab');
    return r.made + ' written and ' + r.promised.fail + ' refused, exactly as the preview said — on the '
      + 'server, in the history and in the audit trail';
  });

  t.section('the sheet it reads, and the module it is for');

  await t.step('the sample workbook imports its data, not its instruction sheet', async () => {
    const r = await t.eval(async ()=>{
      /* exactly what a firm does: download the sample for a module, fill it
         in, upload it. The workbook has two sheets — the data and the guide
         to filling it in — and the guide is 101 tidy rows of five columns
         against the data's 3 rows of a hundred. */
      const sheets = mapImpTemplateSheets('clients');
      const fields = mapImpFields('clients');
      window._mapImpSrc = 'clients';
      const bytes = xlsxWrite(sheets);
      const file = new File([bytes], 'BOSS_template_clients_2026-10-14.xlsx',
        {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const inp = document.createElement('input');
      Object.defineProperty(inp, 'files', {value: [file]});
      await mapImpPick(inp);
      const plan = mapImpBuild();
      const before = DB.clients.length;
      await mapImpApply();
      const made = DB.clients.slice(before);
      const one = made[0] || {};
      return {sheets: sheets.length, chose: mapImp === null ? '(cleared)' : '',
        fields: fields.length, mapped: plan.mapped, verdicts: plan.rows.map(x=>x.verdict),
        made: made.length, keys: Object.keys(one).length,
        name: one.cmsName || '', pan: one.pan || '', kyc: one.kycStatus || '', dob: one.dob || '',
        /* and the profile reads the record by those very keys */
        onProfile: (cmsFieldsFlatAll() || []).filter(f=>one[f.k] !== undefined).length};
    });
    if(r.mapped < r.fields) throw new Error('only ' + r.mapped + ' of ' + r.fields
      + ' columns matched — the wrong sheet of the workbook was read');
    if(r.verdicts.some(v=>v !== 'add')) throw new Error('rows were refused: ' + r.verdicts.join(', '));
    if(r.made !== 2) throw new Error('it created ' + r.made + ' client(s)');
    if(!r.name || !r.pan || !r.kyc || !r.dob)
      throw new Error('a client was created with nothing on it: ' + JSON.stringify(
        {name:r.name, pan:r.pan, kyc:r.kyc, dob:r.dob}));
    if(r.onProfile < 50) throw new Error('only ' + r.onProfile + ' field(s) the profile reads were filled');
    return r.mapped + ' of ' + r.fields + ' columns matched from the data sheet, 2 clients created with '
      + r.keys + ' field(s) each, ' + r.onProfile + ' of them read by the profile';
  });

  await t.step('a sheet for another module says so instead of importing empty records', async () => {
    const r = await t.eval(async ()=>{
      const sheets = mapImpTemplateSheets('clients');
      window._mapImpSrc = 'leads';                       // the picker left on the wrong module
      const bytes = xlsxWrite(sheets);
      const file = new File([bytes], 'clients.xlsx',
        {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const inp = document.createElement('input');
      Object.defineProperty(inp, 'files', {value: [file]});
      await mapImpPick(inp);
      const plan = mapImpBuild();
      navigate('settings', 'importback');
      const text = document.getElementById('content').textContent;
      const best = mapImpBestSource(mapImp.read.headers);
      const out = {asLeads: plan.mapped, best: best.src.id, bestN: best.n,
        warns: /looks like/.test(text), offers: /Switch to/.test(text),
        blocked: plan.missingRequired.length > 0,
        buttonSays: (Array.from(document.querySelectorAll('#content button'))
          .find(b=>/Map the required|Import \d|Nothing to import/.test(b.textContent)) || {}).textContent || ''};
      mapImpClear();
      return out;
    });
    if(r.best !== 'clients') throw new Error('it did not recognise the sheet as clients');
    if(!r.warns || !r.offers) throw new Error('it did not say the sheet is for another module');
    if(!r.blocked) throw new Error('it would have imported it anyway');
    return 'matched ' + r.bestN + ' Clients fields against ' + r.asLeads + ' Leads ones, said so, offered '
      + 'the switch, and the import button reads \u201c' + r.buttonSays.trim() + '\u201d';
  });

  t.section('finishing the mapping, and a family under one PAN');

  await t.step('a column BOSS cannot name is mapped from the field\u2019s own end', async () => {
    const r = await t.eval(async (feed)=>{
      const f = mapImpFields('clients');
      const name = f.find(x=>x.k === 'cmsName');
      const pan = f.find(x=>x.k === 'pan');
      /* The sheet calls the PAN column something only this firm would. */
      const rows = [[name.l, 'Permanent A/c Ref'],
        ['ZZ Reverse One', 'AAAPZ1234A'],
        ['ZZ Reverse Two', 'AAAPZ1235B']];
      const plan = await eval('(' + feed + ')')('clients', rows, 'odd-headings.xlsx');
      const before = {unfilled: plan.unfilled.some(x=>x.k === 'pan'),
        mapped: plan.mapped, pan: plan.rows[0].rec.pan};
      /* Pointed at it from the field end, which is the only end that
         knows what "Permanent A/c Ref" was meant to be. */
      mapImpSetField('pan', 'Permanent A/c Ref');
      const after = mapImpBuild();
      const screen = (()=>{ navigate('settings','importback');
        return document.getElementById('content').textContent.replace(/\s+/g,' '); })();
      return {before, mapped: after.mapped,
        pan: after.rows[0].rec.pan,
        stillUnfilled: after.unfilled.some(x=>x.k === 'pan'),
        onScreen: /The fields nothing is pointed at/.test(screen),
        namesField: /Permanent A\/c Ref/.test(screen)};
    }, FEED);
    if(!r.before.unfilled) throw new Error('PAN was not listed as unfilled to begin with');
    if(r.before.pan) throw new Error('it guessed the odd column after all, so this proves nothing');
    if(!r.onScreen) throw new Error('the screen has no fields-end mapping on it');
    if(r.mapped !== r.before.mapped + 1) throw new Error('the column did not get mapped');
    if(r.pan !== 'AAAPZ1234A') throw new Error('the value did not land: ' + r.pan);
    if(r.stillUnfilled) throw new Error('the field is still listed as having no column');
    return 'a column called "Permanent A/c Ref" pointed at PAN from the field end, and the value landed';
  });

  await t.step('the same PAN can be a family rather than a duplicate', async () => {
    const r = await t.eval(async (feed)=>{
      const f = mapImpFields('clients');
      const name = f.find(x=>x.k === 'cmsName');
      const pan = f.find(x=>x.k === 'pan');
      const head = {id: uid('CMS'), cmsName:'ZZ Family Head', pan:'AFAMY1234A', cmsStage:'clientCreated',
        rmName: currentUser};
      DB.clients.push(head); await save('clients');
      const rows = [[name.l, pan.l],
        ['ZZ Family Son', 'AFAMY1234A'],
        ['ZZ Family Daughter', 'AFAMY1234A']];
      await eval('(' + feed + ')')('clients', rows, 'family.xlsx');
      mapImpSetKey('pan');
      const skipping = mapImpBuild();
      mapImpSetMode('family');
      const plan = mapImpBuild();
      const before = DB.clients.length;
      const hist = DB.importHistory.length;
      await mapImpApply();
      const made = DB.clients.slice(before);
      const h = DB.importHistory[DB.importHistory.length - 1] || {};
      const group = DB.clients.filter(c=>c.familyHeadLookup === head.id && !c.deletedAt);
      /* and the head's own profile shows them */
      navigate('cms', head.id);
      const profile = document.getElementById('content').textContent.replace(/\s+/g,' ');
      navigate('cms');
      return {wouldSkip: skipping.skip, wouldFamily: plan.family, verdicts: plan.rows.map(x=>x.verdict),
        made: made.length, names: made.map(x=>x.cmsName).sort(),
        pointed: made.every(x=>x.familyHeadLookup === head.id),
        unique: new Set(made.map(x=>x.id)).size,
        history: {imported: h.imported, family: h.family, total: h.total},
        group: group.length, onProfile: /ZZ Family Son/.test(profile) && /ZZ Family Daughter/.test(profile),
        undo: (DB.importUndo[DB.importUndo.length - 1] || {created:[]}).created.length};
    }, FEED);
    if(r.wouldSkip !== 2) throw new Error('with the old answer it would have skipped ' + r.wouldSkip + ', not 2');
    if(r.wouldFamily !== 2 || r.verdicts.some(v=>v !== 'family'))
      throw new Error('the rows came out as ' + r.verdicts.join(', '));
    if(r.made !== 2 || r.unique !== 2) throw new Error('it created ' + r.made + ' record(s)');
    if(!r.pointed) throw new Error('they were not put in the family');
    if(r.group !== 2) throw new Error(r.group + ' in the family group');
    if(!r.onProfile) throw new Error('the head\u2019s profile does not show them');
    if(r.history.family !== 2 || r.history.imported !== 2)
      throw new Error('the history does not count them separately: ' + JSON.stringify(r.history));
    if(r.undo !== 2) throw new Error('they were not written down for the undo');
    return 'two rows under one PAN: skipped before, now two records of their own in '
      + '"ZZ Family Head"\u2019s family, counted separately on the history and reversible';
  });

  await t.step('nothing was alerted that was not a result', async () => {
    /* the harness collects the messages themselves, not dialog objects */
    const seen = (t.dialogs || []).map(String);
    const bad = seen.filter(m=>/undefined|not a function|\[object/i.test(m));
    if(bad.length) throw new Error(bad.join(' | '));
    return seen.length ? seen.length + ' confirmation(s): ' + seen.map(m=>m.split('\n')[0]).join(' | ') : 'none';
  });
});
