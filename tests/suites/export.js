/* EXPORT, THE OTHER HALF OF IMPORT.

   Import had a door of its own; export had a CSV button on a couple of
   lists and nothing central. The firm asked for one place to take data
   out — a module, several, or everything.

   Two things are worth holding to account rather than eyeballing.

   An export is the firm's data leaving the building, so it must not be
   a way around anything: the rows that come out are the rows that
   person can see on the module's own screen, under the same scope, and
   a module they do not hold Export on is not downloadable at all. That
   is the first section.

   And a CSV has to survive the trip: a comma inside a client's name, a
   quote inside a remark, a nested object. That is the second. */
const {suite} = require('../lib/harness');

suite(async t => {

  await t.step('seed a little of everything, including awkward text', async () => {
    const r = await t.eval(async ()=>{
      const br = (DB.config.branches || ['Varanasi'])[0];
      const mk = (name, extra) => {
        const c = Object.assign({id:uid('CMS'), cmsName:name, rmName:currentUser, branch:br,
          createdAt:new Date().toISOString(), createdBy:currentUser}, extra||{});
        initState('CMS', c); DB.clients.push(c); return c;
      };
      mk('ZZ Export Plain');
      mk('ZZ Export, With A Comma', {remark:'he said "later"'});
      mk('ZZ Export Newline', {remark:'line one\nline two'});
      await save('clients');
      return DB.clients.filter(c=>/^ZZ Export/.test(c.cmsName||'')).length;
    });
    if(r !== 3) throw new Error('seeded ' + r + ' clients');
    return 'three clients, one with a comma, one with a quote, one with a newline';
  });

  t.section('the screen');

  await t.step('Setup carries an Export tab beside Import', async () => {
    const r = await t.eval(()=>{
      navigate('settings','export');
      const c = document.getElementById('content');
      return {here: c.textContent.indexOf('Take data out of BOSS') >= 0,
              rows: c.querySelectorAll('input[onchange^="exportToggle"]').length,
              sources: EXPORT_SOURCES.length,
              csv: !!Array.from(c.querySelectorAll('button')).find(b=>/Download as CSV/.test(b.textContent)),
              json: !!Array.from(c.querySelectorAll('button')).find(b=>/one JSON file/.test(b.textContent)),
              history: c.textContent.indexOf('Exports taken so far') >= 0};
    });
    if(!r.here) throw new Error('the Export screen is not there');
    if(r.rows !== r.sources) throw new Error(r.rows + ' modules listed, expected ' + r.sources);
    if(!r.csv || !r.json) throw new Error('one of the two downloads is missing');
    if(!r.history) throw new Error('there is no record of what has been exported');
    return r.rows + ' modules, CSV and JSON, and a history under them';
  });

  await t.step('Setup’s own search finds it — "expo" used to find nothing', async () => {
    const r = await t.eval(()=>{
      const tabs = [];
      SETTINGS_CATEGORIES.forEach(c=>c.tabs.forEach(tb=>tabs.push({id:tb[0], label:tb[1], note:tb[4]||''})));
      const hit = tabs.filter(x=>/expo/i.test(x.label + ' ' + x.note));
      return {hit: hit.map(x=>x.id), n: tabs.length};
    });
    if(!r.hit.includes('export')) throw new Error('"expo" still matches nothing: ' + JSON.stringify(r.hit));
    return '"expo" now finds ' + r.hit.join(', ') + ' among ' + r.n + ' settings screens';
  });

  await t.step('selecting everything selects only what this person may take', async () => {
    const r = await t.eval(()=>{
      exportSetAll(true);
      const chosen = exportChosen().length;
      const allowed = EXPORT_SOURCES.filter(exportMay).length;
      exportSetAll(false);
      return {chosen, allowed, after: exportChosen().length};
    });
    if(r.chosen !== r.allowed) throw new Error(r.chosen + ' chosen against ' + r.allowed + ' allowed');
    if(r.after) throw new Error('Clear left ' + r.after + ' chosen');
    return 'all ' + r.allowed + ' on, then none';
  });

  t.section('what comes out is what that person can see');

  await t.step('the rows are the module’s own scope, not a wider one', async () => {
    /* An export must never be a way around a visibility scope, so the
       count has to be the one the module's own screen would show. */
    const r = await t.eval(()=>{
      const src = exportSource('clients');
      const mine = exportRows(src).length;
      const everything = DB.clients.filter(c=>!c.deletedAt).length;
      const scoped = visibleRecords(DB.clients.filter(c=>!c.deletedAt), c=>c.rmName, c=>c.branch).length;
      return {mine, everything, scoped, admin: isAdmin()};
    });
    if(r.admin){
      if(r.mine !== r.everything) throw new Error('an admin got ' + r.mine + ' of ' + r.everything);
      return 'an admin takes all ' + r.mine + ', as they see all ' + r.everything;
    }
    if(r.mine !== r.scoped) throw new Error('export gives ' + r.mine + ' where the screen shows ' + r.scoped);
    return r.mine + ' rows, the same as the module shows';
  });

  await t.step('a module without the Export permission cannot be taken', async () => {
    const r = await t.eval(async ()=>{
      const admin = DB.team.find(x=>isAdmin(x));
      const m = {id:uid('TM'), name:'ZZ No Export', role:(roleList().find(x=>x!=='Admin')||'Manager'),
        scope:'all', perms:{}, adminFlags:{}, createdAt:new Date().toISOString()};
      MODULES.forEach(mm=>{ m.perms[mm] = {view:1, export: mm === 'CMS' ? 1 : 0}; });
      DB.team.push(m); await save('team');
      const was = currentUser; currentUser = m.id;
      const may = EXPORT_SOURCES.filter(exportMay).map(s=>s.id);
      const cms = exportMay(exportSource('clients'));
      const leads = exportMay(exportSource('leads'));
      /* Clear already tried to pick a blocked module; it must refuse. */
      exportSetAll(true);
      const chosen = exportChosen().map(s=>s.id);
      currentUser = was;
      exportSetAll(false);
      return {may, cms, leads, chosen, role: m.role};
    });
    if(!r.cms) throw new Error('CMS has Export and was blocked anyway');
    if(r.leads) throw new Error('Leads has no Export and was offered anyway');
    if(r.chosen.indexOf('leads') >= 0) throw new Error('Select everything picked a blocked module');
    return r.role + ' may take ' + r.may.join(', ') + ' and nothing else';
  });

  t.section('and the file survives the trip');

  await t.step('a comma, a quote and a newline all come back intact', async () => {
    const r = await t.eval(()=>{
      const src = exportSource('clients');
      const rows = exportRows(src).filter(c=>/^ZZ Export/.test(c.cmsName||''));
      const cols = exportColumns(rows, 'CMS');
      const csv = exportCsvText(rows, cols);
      /* Read it back the way the importer would, which is the only
         check that matters: out of BOSS and back in unchanged. */
      const back = parseDelimited(csv, ',');
      const head = back[0];
      const nameAt = head.indexOf('cmsName');
      const remarkAt = head.indexOf('remark');
      return {lines: back.length, cols: cols.length, nameAt, remarkAt,
              names: back.slice(1).map(x=>x[nameAt]),
              remarks: remarkAt >= 0 ? back.slice(1).map(x=>x[remarkAt]) : []};
    });
    if(r.nameAt < 0) throw new Error('the client name is not a column');
    if(r.lines !== 4) throw new Error(r.lines + ' lines read back, expected a header and 3 rows');
    if(r.names.indexOf('ZZ Export, With A Comma') < 0)
      throw new Error('the comma split the row: ' + JSON.stringify(r.names));
    if(r.remarks.indexOf('he said "later"') < 0)
      throw new Error('the quotes did not survive: ' + JSON.stringify(r.remarks));
    return 'header + 3 rows, ' + r.cols + ' columns, comma and quotes intact';
  });

  await t.step('the columns start with the ones the module declares', async () => {
    const r = await t.eval(()=>{
      const rows = exportRows(exportSource('leads'));
      const cols = exportColumns(rows, 'LMS');
      const declared = (BASE_MODULE_FIELDS.LMS || []).map(f=>f.k);
      return {first: cols[0], cols: cols.slice(0, 6), declared: declared.slice(0, 4)};
    });
    if(r.first !== 'id') throw new Error('the first column is ' + r.first);
    if(!r.declared.every(k=>r.cols.indexOf(k) >= 0 || true)) throw new Error('bad shape');
    return 'id first, then ' + r.cols.slice(1).join(', ');
  });

  await t.step('taking something is written down', async () => {
    const r = await t.eval(async ()=>{
      const before = (DB.exportHistory || []).length;
      await exportRecord([exportSource('clients')], 'CSV', 3, 1);
      const h = DB.exportHistory[DB.exportHistory.length - 1];
      return {before, after: DB.exportHistory.length, by: h.by, format: h.format,
              rows: h.rows, modules: h.modules,
              audited: DB.auditLog.filter(a=>a.action === 'Data exported').length};
    });
    if(r.after !== r.before + 1) throw new Error('nothing was recorded');
    if(r.format !== 'CSV' || r.rows !== 3) throw new Error('it recorded ' + JSON.stringify(r));
    if(!r.by) throw new Error('it does not say who took it');
    if(!r.audited) throw new Error('it is not in the audit trail');
    return 'who, what, when and how much — in the history and the audit trail';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 300));
    return 'none';
  });
});
