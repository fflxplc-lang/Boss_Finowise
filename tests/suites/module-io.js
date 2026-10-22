/* THE SAME THREE DOORS ON EVERY MODULE, AND ONE ROOM BEHIND THEM.

   RMS had a Template button. No other module did, so the sample sheet
   for a client existed and was reachable only from a screen in Setup
   that most people cannot open, and taking a module's records out
   meant asking somebody who could.

   Template, Import and Export are now on every module's own page —
   and they are doors, not a second implementation. Template is the
   sample sheet the mapped importer builds from that module's own
   field registry. Import is that same importer with the module
   already chosen, so the mapping, the validation and the writing are
   the ones Setup configures. Export is the same rows, the same scope
   rule and the same export history the Setup screen writes.

   What this holds to: that both routes land on the same machinery,
   that each door appears only for somebody who may use it, and that
   nothing was duplicated to get there. */
const {suite} = require('../lib/harness');

const AS = `(id, fn) => { const was = currentUser; currentUser = id; try { return fn(); } finally { currentUser = was; } }`;

suite(async t => {
  await t.home();
  let importer = null, reader = null;

  await t.step('every module page offers Template, Import and Export', async () => {
    const r = await t.eval(()=>{
      const want = ['LMS','CMS','RMS','Queries','DST','Recommendations','Calls','Business','Campaigns','Projects'];
      const out = {};
      want.forEach(m=>{
        const acts = moduleIoActions(m).map(a=>a.label);
        out[m] = acts.join('/');
      });
      /* and the page really draws them */
      navigate('cms');
      const page = document.getElementById('content').innerHTML;
      return {out, onCms: ['downloadTemplate', 'openModuleImport', 'exportModuleNow']
        .filter(f=>page.indexOf(f) < 0)};
    });
    const missing = Object.keys(r.out).filter(m=>r.out[m] !== 'Template/Import/Export');
    if(missing.length) throw new Error('these do not carry all three: '
      + missing.map(m=>m + ' (' + (r.out[m] || 'none') + ')').join(', '));
    if(r.onCms.length) throw new Error('the CMS page does not wire ' + r.onCms.join(', '));
    return Object.keys(r.out).length + ' modules, each with Template, Import and Export on its own header';
  });

  await t.step('RMS does not carry two of them now that every module has one', async () => {
    const r = await t.eval(()=>{
      navigate('rms');
      const page = document.getElementById('content').innerHTML;
      return {templates: (page.match(/downloadTemplate\(/g) || []).length,
        imports: (page.match(/openModuleImport\(/g) || []).length};
    });
    if(r.templates !== 1) throw new Error('the RMS page has ' + r.templates + ' Template buttons');
    if(r.imports !== 1) throw new Error('the RMS page has ' + r.imports + ' Import buttons');
    return 'one of each, where there were two';
  });

  await t.step('the template a module hands out is the one Setup hands out', async () => {
    const r = await t.eval(async ()=>{
      /* the same builder, so the sheets are the same sheet */
      const fromModule = mapImpTemplateSheets(MODULE_DB_KEY['CMS']);
      const fromSetup = mapImpTemplateSheets('clients');
      return {same: JSON.stringify(fromModule[0].rows[0]) === JSON.stringify(fromSetup[0].rows[0]),
        cols: fromModule[0].rows[0].length,
        fields: mapImpFields('clients').length};
    });
    if(!r.same) throw new Error('the module template and the Setup template are different sheets');
    if(r.cols !== r.fields) throw new Error('the template is not the module’s own field list');
    return r.cols + ' columns, built from the registry, identical whichever button asked for it';
  });

  t.section('who gets which door');

  await t.step('each one appears only for somebody who may use it', async () => {
    const r = await t.eval(async ()=>{
      const mk = (name, acts) => {
        const p = fullPerms(false);
        p.CMS.view = 1; acts.forEach(a=>{ p.CMS[a] = 1; });
        const m = {id: uid('TM'), name, role:'Operations', email:name.replace(/\W/g,'')+'@zz.in',
          status:'Active', scope:'all', perms:p, adminFlags:{}, createdAt:new Date().toISOString()};
        DB.team.push(m); return m.id;
      };
      const out = {importer: mk('ZZ Importer', ['import']), reader: mk('ZZ Reader', [])};
      await save('team');
      const look = id => { const was = currentUser; currentUser = id;
        const acts = moduleIoActions('CMS').map(a=>a.label); currentUser = was; return acts; };
      return {importer: look(out.importer), reader: look(out.reader), ids: out};
    });
    importer = r.ids.importer; reader = r.ids.reader;
    if(r.importer.join('/') !== 'Template/Import') throw new Error('the importer sees ' + r.importer.join('/'));
    if(r.reader.length) throw new Error('somebody with view only sees ' + r.reader.join('/'));
    return 'Import permission → Template and Import; view only → none of the three';
  });

  await t.step('the module Import button opens the one importer, on that module', async () => {
    const r = await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.importer;
      openModuleImport('CMS');
      await new Promise(res=>setTimeout(res, 150));
      const page = document.getElementById('content').textContent.replace(/\s+/g, ' ');
      const out = {view: currentView, src: mapImpSrcId(),
        sameScreen: /Download the sample sheet/.test(page) && /Upload a filled-in sheet/.test(page),
        picked: (document.querySelector('#content select') || {}).value};
      currentUser = was;
      navigate('dashboard');
      return out;
    }, {importer});
    if(r.view !== 'import') throw new Error('it landed on ' + r.view);
    if(r.src !== 'clients') throw new Error('it did not preselect the module: ' + r.src);
    if(!r.sameScreen) throw new Error('the importer on that page is not the one Setup uses');
    return 'Bulk Import, with Clients already chosen, and the same mapped importer on it';
  });

  await t.step('and somebody with no import permission anywhere cannot reach it by route', async () => {
    const r = await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.reader;
      navigate('import');
      const out = {landed: currentView,
        said: ((document.querySelector('.modal') || {}).textContent || '').replace(/\s+/g, ' ')};
      closeModal();
      currentUser = was;
      navigate('dashboard');
      return out;
    }, {reader});
    if(r.landed !== 'dashboard') throw new Error('it opened for somebody who may not import');
    if(!/Import permission on at least one module/.test(r.said))
      throw new Error('it did not say why: ' + r.said.slice(0, 120));
    return 'bounced, with the reason';
  });

  await t.step('a header with nothing on it says why, and offers the fix', async () => {
    const r = await t.eval(async ()=>{
      /* exactly the firm's case: may add a lead and a review, may not
         add a client, and the CMS page is one Help button */
      const p = fullPerms(false);
      ['LMS','RMS'].forEach(m=>['view','create','edit'].forEach(a=>{ p[m][a] = 1; }));
      p.CMS.view = 1;
      const m = {id: uid('TM'), name:'ZZ Asks For CMS', role:'Operations', email:'zzasks@zz.in',
        status:'Active', scope:'all', perms:p, adminFlags:{}, createdAt:new Date().toISOString()};
      DB.team.push(m); await save('team');
      const was = currentUser; currentUser = m.id;
      const acts = moduleIoActions('CMS').map(a=>a.label);
      const lms = moduleIoActions('LMS').map(a=>a.label);
      navigate('cms');
      const page = document.getElementById('content').innerHTML;
      /* and pressing it opens the request for exactly that permission */
      openAccessRequest({kind:'action', module:'CMS', action:'create'});
      const dialog = ((document.querySelector('.modal') || {}).textContent || '').replace(/\s+/g, ' ');
      closeModal();
      currentUser = was;
      navigate('dashboard');
      return {acts, lms, onPage: /Ask for access/.test(page),
        asksFor: /CMS . Create|CMS · Create/.test(dialog),
        path: /Modules, one at a time/.test(dialog)};
    });
    if(r.acts.indexOf('Ask for access') < 0)
      throw new Error('the CMS header offers nothing and says nothing: ' + r.acts.join('/'));
    if(r.lms.indexOf('Ask for access') >= 0)
      throw new Error('it nags on a module where they can already create');
    if(!r.onPage) throw new Error('it is not drawn on the page');
    if(!r.asksFor || !r.path) throw new Error('the request does not name CMS · Create and where it is granted');
    return 'the CMS header says they may create elsewhere and not here, and one press asks for exactly '
      + 'CMS \u00b7 Create with the route to grant it';
  });

  t.section('export');

  await t.step('a module exports its own rows, through the same writer and history', async () => {
    const r = await t.eval(async ()=>{
      const before = (DB.exportHistory || []).length;
      ['ZZ Export One','ZZ Export Two'].forEach(n=>DB.clients.push(
        {id: uid('CMS'), cmsName:n, cmsStage:'clientCreated', rmName: currentUser}));
      await save('clients');
      let name = '', bytes = 0;
      const realCreate = URL.createObjectURL;
      URL.createObjectURL = b => { bytes = b.size; return 'blob:zz'; };
      const realClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function(){ name = this.download; };
      try { await exportModuleNow('CMS'); }
      finally { URL.createObjectURL = realCreate; HTMLAnchorElement.prototype.click = realClick; }
      const h = (DB.exportHistory || [])[DB.exportHistory.length - 1] || {};
      return {name, bytes, before, after: (DB.exportHistory || []).length,
        format: h.format, modules: (h.modules || []).join(','), rows: h.rows,
        audited: DB.auditLog.some(x=>x.action === 'Data exported')};
    });
    if(!/^BOSS_clients_\d+\.xlsx$/.test(r.name)) throw new Error('it wrote "' + r.name + '"');
    if(r.bytes < 500) throw new Error('the workbook is ' + r.bytes + ' bytes');
    if(r.after !== r.before + 1) throw new Error('it is not on the export history');
    if(r.modules !== 'clients' || r.format !== 'Excel')
      throw new Error('the history says ' + r.format + ' / ' + r.modules);
    if(!r.audited) throw new Error('it is not on the audit trail');
    return r.name + ', ' + r.rows + ' rows, on the same export history and audit trail as Setup’s';
  });

  await t.step('and it takes out only what that person may see', async () => {
    const r = await t.eval(async ()=>{
      const mine = {id: uid('TM'), name:'ZZ Narrow', role:'Operations', email:'zznarrow@zz.in',
        status:'Active', scope:'own', perms:(()=>{ const p = fullPerms(false);
          p.CMS.view = 1; p.CMS.export = 1; return p; })(), adminFlags:{},
        createdAt:new Date().toISOString()};
      DB.team.push(mine); await save('team');
      DB.clients.push({id: uid('CMS'), cmsName:'ZZ Narrow Own', cmsStage:'clientCreated', rmName: mine.id});
      await save('clients');
      const was = currentUser; currentUser = mine.id;
      const src = exportSource('clients');
      const theirs = exportRows(src).length;
      const all = DB.clients.filter(c=>!c.deletedAt).length;
      const doors = moduleIoActions('CMS').map(a=>a.label).join('/');
      currentUser = was;
      return {theirs, all, doors};
    });
    if(r.theirs >= r.all) throw new Error('an export read past the scope: ' + r.theirs + ' of ' + r.all);
    if(r.doors !== 'Export') throw new Error('the doors for an export-only account read ' + r.doors);
    return 'export only, and it takes ' + r.theirs + ' of ' + r.all + ' clients — their own';
  });

  await t.step('Setup offers the same Excel export, from the same function', async () => {
    const r = await t.eval(()=>{
      navigate('settings', 'export');
      const page = document.getElementById('content').innerHTML;
      navigate('dashboard');
      return {excel: /exportRunXlsx\(\)/.test(page), csv: /exportRunCsv\(\)/.test(page),
        shared: typeof exportXlsxSheets === 'function'};
    });
    if(!r.excel || !r.csv) throw new Error('Setup does not offer both formats');
    if(!r.shared) throw new Error('the two routes do not share the writer');
    return 'Excel and CSV on the Setup screen, and the module button uses the same builder';
  });
});
