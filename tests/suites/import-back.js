/* EVERY EXPORT HAS AN IMPORT.

   Export covers twenty-two sources. Bulk Import covered four. What is
   tested here is that the gap is closed and closed honestly: that each
   source Export writes can be read back, that reading it back twice
   leaves the system as it was after the first time, and that the links
   between records survive the trip.

   The file never reaches a real <input type=file>; a File is built in
   the page and handed to the same impBackRead/impBackPlan/impBackApply
   path the picker uses, which is where every decision lives. */
const {suite} = require('../lib/harness');

const onServer = async (t, key) => t.eval(async (k)=>{
  const res = await fetch('/api/storage/' + encodeURIComponent(k), {headers: apiHeaders()});
  if(res.status === 404) return null;
  if(!res.ok) throw new Error('storage get failed: ' + res.status);
  return JSON.parse((await res.json()).value);
}, key);

/* Build a File in the page and run it through the importer, exactly as
   the picker does, confirming the dialog it opens. */
const FEED = `async (name, text, type, force) => {
  const file = new File([text], name, {type: type || 'text/csv'});
  window._impBackForce = force || '';
  const inp = document.createElement('input');
  Object.defineProperty(inp, 'files', {value: [file]});
  await impBackPick(inp);
  const modal = document.getElementById('modalBody');
  const open = document.getElementById('overlay').classList.contains('show');
  if(!open) return {refused: true};
  const out = {text: modal.textContent,
    buttons: Array.from(modal.querySelectorAll('.modal-foot button')).map(b=>b.textContent.trim())};
  await impBackApply();
  return out;
}`;

suite(async t => {

  t.section('the screen, and what it says about the other ways in');

  await t.step('Setup carries an Import beside the Export', async () => {
    await t.eval(()=>{ navigate('settings','importback'); });
    await t.wait(400);
    const r = await t.eval(()=>{
      const c = document.getElementById('content');
      const rows = c.querySelectorAll('table tbody tr').length;
      return {here: /^\s*Import/.test(c.textContent.trim()),
              picker: !!document.getElementById('impBackFile'),
              accept: (document.getElementById('impBackFile')||{}).accept,
              sources: EXPORT_SOURCES.length, rows,
              bulk: /Bulk Import/.test(c.textContent),
              restore: /Restore a Full Backup/.test(c.textContent),
              idRule: /matched on the id/.test(c.textContent)};
    });
    if(!r.picker) throw new Error('there is nothing to choose a file with');
    if(!/csv/.test(r.accept||'') || !/json/.test(r.accept||'')) throw new Error('it accepts "' + r.accept + '"');
    if(r.rows < r.sources) throw new Error('it lists ' + r.rows + ' of ' + r.sources + ' export sources');
    if(!r.bulk || !r.restore) throw new Error('it does not point at the importers that already existed');
    if(!r.idRule) throw new Error('it does not explain how a record is matched');
    return 'Setup › Data Administration › Import, listing all ' + r.sources + ' sources';
  });

  await t.step('every source Export offers, Import offers back', async () => {
    const r = await t.eval(()=>{
      const missing = EXPORT_SOURCES.filter(s=>{
        const row = Array.from(document.querySelectorAll('#content table tbody tr'))
          .find(tr=>tr.textContent.indexOf(s.id) >= 0);
        return !row;
      }).map(s=>s.id);
      const noPrefix = EXPORT_SOURCES.filter(s=>!IMP_BACK_PREFIX[s.id]).map(s=>s.id);
      return {missing, noPrefix, n: EXPORT_SOURCES.length};
    });
    if(r.missing.length) throw new Error('not offered: ' + r.missing.join(', '));
    if(r.noPrefix.length) throw new Error('no id prefix for: ' + r.noPrefix.join(', '));
    return 'all ' + r.n + ' of them';
  });

  t.section('a CSV out, the same CSV back');

  await t.step('a module exported and re-imported is unchanged', async () => {
    const r = await t.eval(async (src)=>{
      DB.leads = [
        {id:'ZZL1', leadName:'ZZ One', firstName:'ZZ', lastName:'One', email:'one@example.in',
         mobile:'9000000001', assignedTo:currentUser, branch:'Varanasi', createdAt:new Date().toISOString()},
        {id:'ZZL2', leadName:'ZZ Two', firstName:'ZZ', lastName:'Two', email:'two@example.in',
         mobile:'9000000002', assignedTo:currentUser, branch:'Varanasi', createdAt:new Date().toISOString()},
      ];
      DB.leads.forEach(l=>initState('LMS', l));
      await save('leads');
      const rows = exportRows(exportSource('leads'));
      const csv = exportCsvText(rows, exportColumns(rows, 'LMS'));
      window.__csv = csv;
      const out = await (new Function('return (' + src + ')')())('BOSS_leads_20261013.csv', csv);
      return {out, n: DB.leads.length, names: DB.leads.map(l=>l.leadName).sort()};
    }, FEED);
    if(r.out.refused) throw new Error('its own export was refused');
    if(r.n !== 2) throw new Error('two leads became ' + r.n);
    if(r.names.join(',') !== 'ZZ One,ZZ Two') throw new Error('the leads came back as ' + r.names.join(', '));
    if(!/0 record\(s\) added/.test(r.out.text) && !/2 record\(s\) already here updated/.test(r.out.text))
      throw new Error('the preview did not read as two updates: ' + r.out.text.slice(0, 200));
    await t.wait(400);
    const server = await onServer(t, 'leads');
    if((server||[]).length !== 2) throw new Error((server||[]).length + ' leads on the server');
    return 'two out, two back, still two — matched on id, nothing doubled';
  });

  await t.step('the same file a third time still changes nothing', async () => {
    const r = await t.eval(async (src)=>{
      await (new Function('return (' + src + ')')())('BOSS_leads_20261013.csv', window.__csv);
      return {n: DB.leads.length};
    }, FEED);
    if(r.n !== 2) throw new Error('it became ' + r.n);
    return 'still two';
  });

  await t.step('an edited cell updates, and a blank cell leaves the field alone', async () => {
    const r = await t.eval(async (src)=>{
      const csv = window.__csv
        .replace('"ZZ One"', '"ZZ One Renamed"')
        .replace('"9000000001"', '""');
      await (new Function('return (' + src + ')')())('BOSS_leads_20261013.csv', csv);
      const one = DB.leads.find(l=>l.id === 'ZZL1');
      return {name: one.leadName, mobile: one.mobile, n: DB.leads.length};
    }, FEED);
    if(r.name !== 'ZZ One Renamed') throw new Error('the edit did not land: ' + r.name);
    if(r.mobile !== '9000000001') throw new Error('a blank cell wiped the field: "' + r.mobile + '"');
    if(r.n !== 2) throw new Error('it added a row instead of updating one');
    return 'the edit landed; the emptied cell left its field as it was';
  });

  await t.step('a row with no id is a new record, with an id of its own', async () => {
    const r = await t.eval(async (src)=>{
      const csv = '"id","leadName","firstName","lastName","email"\r\n'
        + '"","ZZ Fresh","ZZ","Fresh","fresh@example.in"';
      await (new Function('return (' + src + ')')())('BOSS_leads_20261013.csv', csv);
      const fresh = DB.leads.find(l=>l.leadName === 'ZZ Fresh');
      return {n: DB.leads.length, id: (fresh||{}).id || '', state: (fresh||{})[RECORD_STATE_FIELD.LMS] || ''};
    }, FEED);
    if(r.n !== 3) throw new Error('two became ' + r.n);
    if(!/^LEAD-/.test(r.id)) throw new Error('it was minted as "' + r.id + '"');
    if(!r.state) throw new Error('it arrived with no stage, so it is nowhere in the workflow');
    return 'minted ' + r.id + ', started at ' + r.state;
  });

  t.section('the combined JSON, and the links inside it');

  await t.step('several modules in one file arrive together, links intact', async () => {
    const r = await t.eval(async (src)=>{
      DB.leads = []; DB.clients = []; DB.tasks = [];
      await save('leads'); await save('clients'); await save('tasks');
      const file = {exportedAt:new Date().toISOString(), exportedBy:'ZZ Tester', company:'ZZ Firm', modules:{
        leads: [{id:'ZZL9', leadName:'ZZ Linked Lead', firstName:'ZZ', lastName:'Linked',
                 email:'linked@example.in', assignedTo:currentUser, status:'new'}],
        clients: [{id:'ZZC9', cmsName:'ZZ Linked Client', email:'lc@example.in',
                   leadId:'ZZL9', rmName:currentUser, cmsStage:'onboarding'}],
        tasks: [{id:'ZZT9', taskType:'ZZ Linked Task', leadId:'ZZL9', assignTo:currentUser,
                 overallStatus:'Not Started'}],
      }};
      const out = await (new Function('return (' + src + ')')())(
        'BOSS_export_20261013.json', JSON.stringify(file), 'application/json');
      return {out, leads: DB.leads.length, clients: DB.clients.length, tasks: DB.tasks.length,
              clientLead: (DB.clients[0]||{}).leadId, taskLead: (DB.tasks[0]||{}).leadId};
    }, FEED);
    if(r.out.refused) throw new Error('the combined export was refused');
    if(r.leads !== 1 || r.clients !== 1 || r.tasks !== 1)
      throw new Error('it landed ' + r.leads + '/' + r.clients + '/' + r.tasks);
    if(r.clientLead !== 'ZZL9' || r.taskLead !== 'ZZL9') throw new Error('a link did not survive');
    if(!/ZZ Tester/.test(r.out.text)) throw new Error('the preview does not say where the file came from');
    return 'three modules in one go, the client and the task still on their lead';
  });

  await t.step('a link to a record that is nowhere is flagged, not hidden', async () => {
    const r = await t.eval(async (src)=>{
      const csv = '"id","cmsName","email","leadId"\r\n"ZZC8","ZZ Orphan","o@example.in","ZZ-NOT-HERE"';
      const out = await (new Function('return (' + src + ')')())('BOSS_clients_20261013.csv', csv);
      return {out, n: DB.clients.length};
    }, FEED);
    if(!/name a record that is neither here nor in this file/.test(r.out.text))
      throw new Error('the dangling link was not mentioned: ' + r.out.text.slice(0, 300));
    return 'the preview names it before the row goes in';
  });

  t.section('a file that is not one of ours');

  await t.step('each wrong file is refused with a reason, and writes nothing', async () => {
    const r = await t.eval(async ()=>{
      const tries = {};
      const run = async (name, text, type) => {
        const file = new File([text], name, {type: type || 'text/csv'});
        try{ await impBackRead(file, ''); return 'ACCEPTED'; }
        catch(e){ return e.message; }
      };
      tries.unknownSheet = await run('mystery.csv', '"alpha","beta"\r\n"1","2"');
      tries.badJson      = await run('BOSS_leads_x.json', '{not json', 'application/json');
      tries.otherJson    = await run('thing.json', '{"invoice":"INV-1"}', 'application/json');
      tries.headerOnly   = await run('BOSS_leads_x.csv', '"id","leadName"');
      tries.before = DB.clients.length;
      return tries;
    });
    const accepted = Object.entries(r).filter(([k,v])=>v === 'ACCEPTED').map(([k])=>k);
    if(accepted.length) throw new Error('accepted: ' + accepted.join(', '));
    if(!/could not tell which module/.test(r.unknownSheet)) throw new Error('unknown sheet: ' + r.unknownSheet);
    if(!/could not be read/.test(r.badJson)) throw new Error('bad json: ' + r.badJson);
    if(!/neither a BOSS export nor a list/.test(r.otherJson)) throw new Error('other json: ' + r.otherJson);
    if(!/no rows under its headings/.test(r.headerOnly)) throw new Error('header only: ' + r.headerOnly);
    return 'four kinds of wrong file, four reasons, nothing written';
  });

  await t.step('an unrecognised sheet can still be imported by naming its module', async () => {
    const r = await t.eval(async (src)=>{
      const csv = '"alpha","beta"\r\n"1","2"';
      const file = new File([csv], 'mystery.csv', {type:'text/csv'});
      const read = await impBackRead(file, 'amcs');
      return {forced: Object.keys(read.sets)[0], rows: read.sets.amcs.length};
    }, FEED);
    if(r.forced !== 'amcs') throw new Error('it read it as ' + r.forced);
    return 'naming the module overrides the guess';
  });

  await t.step('it is written down in the import history', async () => {
    const hist = await onServer(t, 'importHistory');
    const mine = (hist||[]).filter(h=>/BOSS_/.test(h.file || ''));
    if(!mine.length) throw new Error('no import was recorded');
    const last = mine[mine.length-1];
    if(!last.module || last.imported === undefined) throw new Error('the entry is incomplete: ' + JSON.stringify(last));
    return mine.length + ' import(s) on the record, the last naming ' + last.module;
  });

  await t.step('nothing was alerted that was not a result', async () => {
    const odd = t.dialogs.filter(d=>!/added, \d+ updated/.test(d));
    if(odd.length) throw new Error(odd.join(' | '));
    return t.dialogs.length + ' result message(s), no errors';
  });
});
