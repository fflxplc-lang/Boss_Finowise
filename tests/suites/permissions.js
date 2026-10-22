/* ACCESS IS SET ONCE, NOT FIFTEEN TIMES.

   It used to be fifteen modules behind a dropdown, fourteen actions
   each — two hundred and ten checkboxes reached one screen at a time.
   The firm's instruction was to make it one setting that applies
   everywhere: "any access granted or restricted by the admin is applied
   across all modules simultaneously".

   So what is worth testing is not that the screen draws. It is that one
   click really does reach every module, that what is stored is still
   the shape can() reads — because every permission check in BOSS goes
   through it — and that the exceptions panel, which exists for the case
   that genuinely needs it, cannot quietly contradict the list above it. */
const {suite} = require('../lib/harness');

const OPEN = async (t, who) => {
  await t.eval(x => {
    navigate('team'); openPermissions(x);
    /* a page-side shorthand the steps below read the central boxes with */
    window.CENTRAL_ = a => document.getElementById('permAll_' + a);
  }, who);
  await t.wait(350);
};

suite(async t => {
  let who = null;

  await t.step('a team member to set permissions on', async () => {
    who = await t.eval(async ()=>{
      const m = {id:uid('TM'), name:'ZZ Perm Tester', role:(roleList().find(r=>r!=='Admin')||'Manager'),
        email:'zzperm@example.com', scope:'own', perms:{}, adminFlags:{},
        createdAt:new Date().toISOString()};
      DB.team.push(m); await save('team');
      return m.id;
    });
    const n = await t.eval(()=>({modules: MODULES.length, actions: ACTIONS.length}));
    return n.modules + ' modules × ' + n.actions + ' actions = ' + (n.modules*n.actions) + ' to set the old way';
  });

  t.section('one list, every module');

  await t.step('the screen leads with the actions, not with a module picker', async () => {
    await OPEN(t, who);
    const r = await t.eval(()=>({
      central: ACTIONS.filter(a=>document.getElementById('permAll_'+a)).length,
      picker: !!document.getElementById('permModuleSelect'),
      grid: !!document.querySelector('.perm-grid'),
      excOpen: (document.getElementById('permExcBox')||{}).open,
    }));
    if(r.central !== 14) throw new Error(r.central + ' actions on the central list, expected 14');
    if(r.picker) throw new Error('the per-module dropdown is still the way in');
    if(!r.grid) throw new Error('the exceptions grid is gone entirely');
    if(r.excOpen) throw new Error('exceptions are open by default');
    return '14 actions up front, the per-module grid closed underneath';
  });

  await t.step('ticking one action ticks it on every module', async () => {
    const r = await t.eval(()=>{
      permSetAll('delete', true);
      const on = MODULES.filter(m=>document.getElementById('perm_'+m+'_delete').checked).length;
      return {on, total: MODULES.length,
              note: document.getElementById('permAllNote_delete').textContent};
    });
    if(r.on !== r.total) throw new Error('Delete reached ' + r.on + ' of ' + r.total + ' modules');
    if(r.note !== 'every module') throw new Error('it says "' + r.note + '"');
    return 'one click, all ' + r.total + ' modules';
  });

  await t.step('and unticking it takes it off every module', async () => {
    const r = await t.eval(()=>{
      permSetAll('delete', false);
      return {on: MODULES.filter(m=>document.getElementById('perm_'+m+'_delete').checked).length,
              note: document.getElementById('permAllNote_delete').textContent};
    });
    if(r.on) throw new Error('Delete is still on for ' + r.on + ' module(s)');
    if(r.note !== 'no module') throw new Error('it says "' + r.note + '"');
    return 'off everywhere';
  });

  await t.step('Allow everything and Allow nothing do what they say', async () => {
    const r = await t.eval(()=>{
      permSetEverything(true);
      let all = 0;
      MODULES.forEach(m=>ACTIONS.forEach(a=>{ if(document.getElementById('perm_'+m+'_'+a).checked) all++; }));
      permSetEverything(false);
      let none = 0;
      MODULES.forEach(m=>ACTIONS.forEach(a=>{ if(document.getElementById('perm_'+m+'_'+a).checked) none++; }));
      return {all, none, want: MODULES.length * ACTIONS.length};
    });
    if(r.all !== r.want) throw new Error('Allow everything set ' + r.all + ' of ' + r.want);
    if(r.none) throw new Error('Allow nothing left ' + r.none + ' set');
    return r.want + ' on, then ' + r.want + ' off';
  });

  t.section('what is saved is what can() reads');

  await t.step('a central grant reaches every module in the stored record', async () => {
    /* The storage shape is perms[module][action] and every permission
       check in BOSS goes through can(), so this is the assertion that
       the new screen is wired to the old guarantee. */
    await OPEN(t, who);
    const r = await t.eval(async x => {
      permSetEverything(false);
      permSetAll('view', true);
      permSetAll('create', true);
      await savePermissions(x);
      const m = DB.team.find(y=>y.id===x);
      const views = MODULES.filter(mm=>m.perms[mm] && m.perms[mm].view).length;
      const creates = MODULES.filter(mm=>m.perms[mm] && m.perms[mm].create).length;
      const deletes = MODULES.filter(mm=>m.perms[mm] && m.perms[mm].delete).length;
      return {views, creates, deletes, total: MODULES.length};
    }, who);
    if(r.views !== r.total) throw new Error('View stored on ' + r.views + ' of ' + r.total);
    if(r.creates !== r.total) throw new Error('Create stored on ' + r.creates + ' of ' + r.total);
    if(r.deletes) throw new Error('Delete was stored on ' + r.deletes + ' modules and was never granted');
    return 'View and Create on all ' + r.total + ', Delete on none';
  });

  await t.step('can() agrees, module by module', async () => {
    const r = await t.eval(x => {
      const was = currentUser;
      currentUser = x;
      const out = {view: MODULES.filter(m=>can(m,'view')).length,
                   del: MODULES.filter(m=>can(m,'delete')).length,
                   total: MODULES.length};
      currentUser = was;
      return out;
    }, who);
    if(r.view !== r.total) throw new Error('can(view) is true for ' + r.view + ' of ' + r.total);
    if(r.del) throw new Error('can(delete) is true for ' + r.del + ' modules');
    return 'can() says view everywhere, delete nowhere';
  });

  await t.step('reopening shows it as set everywhere, not as mixed', async () => {
    await OPEN(t, who);
    const r = await t.eval(()=>({
      view: {checked: CENTRAL_('view').checked, mixed: CENTRAL_('view').indeterminate},
      del: {checked: CENTRAL_('delete').checked, mixed: CENTRAL_('delete').indeterminate},
      note: document.getElementById('permAllNote_view').textContent,
      exc: document.getElementById('permExcCount').textContent,
    }));
    if(!r.view.checked || r.view.mixed) throw new Error('View reads ' + JSON.stringify(r.view));
    if(r.del.checked || r.del.mixed) throw new Error('Delete reads ' + JSON.stringify(r.del));
    if(!/none set/.test(r.exc)) throw new Error('it claims exceptions exist: ' + r.exc);
    return 'View "' + r.note + '", Delete off, ' + r.exc;
  });

  t.section('the exceptions panel cannot contradict the list above it');

  await t.step('one module set apart shows as mixed, and is counted', async () => {
    const r = await t.eval(()=>{
      const m = MODULES[1];
      document.getElementById('perm_'+m+'_view').checked = false;
      permRefresh();
      const box = CENTRAL_('view');
      return {module: m, checked: box.checked, mixed: box.indeterminate,
              note: document.getElementById('permAllNote_view').textContent,
              exc: document.getElementById('permExcCount').textContent};
    });
    if(r.checked) throw new Error('the central box still reads as fully on');
    if(!r.mixed) throw new Error('it does not show as mixed');
    if(!/of \d+ modules/.test(r.note)) throw new Error('it says "' + r.note + '"');
    if(/none set/.test(r.exc)) throw new Error('the exception was not counted: ' + r.exc);
    return r.module + ' set apart — "' + r.note + '", ' + r.exc;
  });

  await t.step('and the central list overwrites it the moment it is touched', async () => {
    /* "Changes made in one place automatically apply to all modules."
       An exception that survived a central change would make that false. */
    const r = await t.eval(()=>{
      permSetAll('view', true);
      return {on: MODULES.filter(m=>document.getElementById('perm_'+m+'_view').checked).length,
              total: MODULES.length,
              exc: document.getElementById('permExcCount').textContent};
    });
    if(r.on !== r.total) throw new Error('the exception survived: ' + r.on + ' of ' + r.total);
    if(!/none set/.test(r.exc)) throw new Error('it still counts exceptions: ' + r.exc);
    return 'the exception was overwritten, as it has to be';
  });

  t.section('nothing else about permissions moved');

  await t.step('the admin capabilities are still there and still save', async () => {
    const r = await t.eval(async x => {
      const flags = ADMIN_FLAGS.concat(USER_FLAGS);
      const drawn = flags.filter(f=>document.getElementById('adm_'+f)).length;
      document.getElementById('adm_manageReports').checked = true;
      await savePermissions(x);
      const m = DB.team.find(y=>y.id===x);
      return {drawn, want: flags.length, saved: !!(m.adminFlags||{}).manageReports};
    }, who);
    if(r.drawn !== r.want) throw new Error(r.drawn + ' capability boxes drawn, expected ' + r.want);
    if(!r.saved) throw new Error('manageReports did not save');
    return r.want + ' capabilities, and one of them written through';
  });

  await t.step('an admin still holds everything whatever is ticked', async () => {
    const r = await t.eval(()=>{
      const admin = DB.team.find(x=>isAdmin(x));
      if(!admin) return {skip:true};
      const was = currentUser; currentUser = admin.id;
      const n = MODULES.filter(m=>can(m,'delete')).length;
      currentUser = was;
      return {n, total: MODULES.length};
    });
    if(r.skip) return 'no admin in this store to check';
    if(r.n !== r.total) throw new Error('an admin can delete in only ' + r.n + ' of ' + r.total);
    return 'admin keeps all ' + r.total;
  });

  t.section('a permission that is granted actually works');

  /* Both of these came out of an audit of where each toggle is read,
     not out of somebody meeting them: a permission that is offered and
     then ignored is worse than one that is not offered, because the
     firm believes it. */

  await t.step('Masters \u00b7 Delete is honoured by the handler behind the button', async () => {
    const r = await t.eval(async x => {
      const m = DB.team.find(y=>y.id===x);
      m.role = 'Manager';
      MODULES.forEach(mm=>{ m.perms[mm] = {}; ACTIONS.forEach(a=>m.perms[mm][a] = 0); });
      m.perms.Masters = {view:1, create:1, edit:1, delete:1};
      m.adminFlags = fullAdminFlags(false);
      await save('team');
      const was = currentUser; currentUser = x;
      /* The three keys the masters lists hand the record helpers. The
         button is drawn by can('Masters','delete'); these are what the
         handler asks. They have to agree. */
      const out = {
        shown: can('Masters','delete'),
        amc: can('AMC','delete'), schemes: can('Schemes','delete'), commission: can('Commission','delete'),
        bulk: bulkMayUpdate('AMC') === (can('Masters','bulkUpdate') && can('Masters','edit')),
        notLeaked: can('LMS','delete'),
      };
      currentUser = was;
      return out;
    }, who);
    if(!r.shown) throw new Error('the grant itself did not take');
    if(!r.amc || !r.schemes || !r.commission)
      throw new Error('the handler still refuses: AMC ' + r.amc + ', Schemes ' + r.schemes
        + ', Commission ' + r.commission);
    if(!r.bulk) throw new Error('the bulk editor and the grid disagree about Masters');
    if(r.notLeaked) throw new Error('aliasing Masters leaked the grant to another module');
    return 'AMC, Schemes and Commission all answer to the Masters row, and nothing else does';
  });

  await t.step('and withholding it is honoured too', async () => {
    const r = await t.eval(async x => {
      const m = DB.team.find(y=>y.id===x);
      m.perms.Masters = {view:1, create:0, edit:0, delete:0};
      await save('team');
      const was = currentUser; currentUser = x;
      const out = {amc: can('AMC','delete'), masters: can('Masters','delete'),
                   view: can('Schemes','view')};
      currentUser = was;
      return out;
    }, who);
    if(r.amc || r.masters) throw new Error('delete survived being withheld');
    if(!r.view) throw new Error('withholding delete also took view away');
    return 'off means off on all three, and it took nothing else with it';
  });

  await t.step('the five pages that never checked View now check it', async () => {
    const r = await t.eval(async x => {
      const m = DB.team.find(y=>y.id===x);
      MODULES.forEach(mm=>{ m.perms[mm] = {}; ACTIONS.forEach(a=>m.perms[mm][a] = 1); });
      ['Recommendations','Business','Transactions','Masters','Partners']
        .forEach(mm=>{ m.perms[mm].view = 0; });
      await save('team');
      const was = currentUser; currentUser = x;
      const shut = {
        recommendations: viewRecommendations(),
        business: viewBusinessTracker(),
        transactions: viewTransactions(),
        partners: viewPartners(),
        amcs: viewAMCTracker(),
        schemes: viewSchemeMaster(),
        commission: viewCommissionRates(),
      };
      /* and the same pages with View back on */
      ['Recommendations','Business','Transactions','Masters','Partners']
        .forEach(mm=>{ m.perms[mm].view = 1; });
      const open = {
        recommendations: viewRecommendations(),
        business: viewBusinessTracker(),
        transactions: viewTransactions(),
        partners: viewPartners(),
        amcs: viewAMCTracker(),
      };
      currentUser = was;
      /* A refused page draws the wall now — the permission it wants,
         where it is granted, and a button to ask — rather than one
         grey line. The page still refuses; it just says more. */
      const refused = k => /closed to you|does not have View/.test(shut[k])
        && /Request access/.test(shut[k]);
      return {shutOut: Object.keys(shut).filter(refused),
              stillShut: Object.keys(open).filter(k=>/closed to you|does not have View/.test(open[k])),
              total: Object.keys(shut).length};
    }, who);
    if(r.shutOut.length !== r.total)
      throw new Error('these still render without View: '
        + Object.keys({recommendations:1,business:1,transactions:1,partners:1,amcs:1,schemes:1,commission:1})
            .filter(k=>r.shutOut.indexOf(k) < 0).join(', '));
    if(r.stillShut.length) throw new Error('granting View back did not open: ' + r.stillShut.join(', '));
    return r.total + ' pages refuse without View and draw with it';
  });

  t.section('a whole module, closed in one place');

  await t.step('Setup \u203a Modules and Fields leads with module access', async () => {
    /* The screen set who may see each field and could not say who may
       open the module at all — which is the question actually asked. */
    const r = await t.eval(()=>{
      navigate('settings','fields');
      const c = document.getElementById('content');
      const everyone = Array.from(c.querySelectorAll('button[onclick^="openModuleToEveryone"]'));
      const chips = Array.from(c.querySelectorAll('button[onclick^="toggleModuleRole"]'));
      return {heading: c.textContent.indexOf('Module access') >= 0,
              rows: everyone.length, modules: MODULES.length,
              chips: chips.length, roles: roleList().length,
              listbox: !!c.querySelector('select[multiple][onchange^="setModuleRoles"]'),
              fieldsToo: c.textContent.indexOf('the finer grain') >= 0
                && !!c.querySelector('select[onchange^="setFieldSecurity"]')};
    });
    if(!r.heading) throw new Error('there is no module access block');
    if(r.rows !== r.modules) throw new Error(r.rows + ' modules listed, expected ' + r.modules);
    if(r.listbox) throw new Error('the ctrl-click listbox is still there');
    if(r.chips !== r.modules * r.roles)
      throw new Error(r.chips + ' role chips, expected ' + (r.modules * r.roles));
    if(!r.fieldsToo) throw new Error('the field-level settings were lost');
    return r.rows + ' modules \u00d7 ' + r.roles + ' roles as chips, above the fields';
  });

  await t.step('a chip turns one role on and off, and nothing else moves', async () => {
    const r = await t.eval(async ()=>{
      DB.config.moduleRoles = {};
      await save('config');
      navigate('settings','fields');
      /* Whichever two roles the firm has: the roles are theirs to
         change, so naming one here would make this a test of the
         list rather than of the chip. */
      const pair = roleList().filter(x=>x !== ADMIN_ROLE).slice(0, 2);
      const chip = (m, role) => Array.from(document.querySelectorAll('button.role-chip'))
        .find(b=>(b.getAttribute('onclick')||'').indexOf("toggleModuleRole('" + m + "','" + role + "'") === 0);
      chip('CMS', pair[0]).click();
      await new Promise(x=>setTimeout(x, 200));
      const afterOne = moduleRoles('CMS').slice();
      const others = MODULES.filter(m=>m !== 'CMS' && moduleRoles(m).length);
      chip('CMS', pair[1]).click();
      await new Promise(x=>setTimeout(x, 200));
      const afterTwo = moduleRoles('CMS').slice().sort();
      chip('CMS', pair[0]).click();
      await new Promise(x=>setTimeout(x, 200));
      const afterOff = moduleRoles('CMS').slice();
      const marked = (Array.from(document.querySelectorAll('button.role-chip'))
        .find(b=>(b.getAttribute('onclick')||'').indexOf("toggleModuleRole('CMS','" + pair[1] + "'") === 0) || {}).className || '';
      return {afterOne, afterTwo, afterOff, others, marked, pair};
    });
    if(r.afterOne.join(',') !== r.pair[0]) throw new Error('one click gave ' + r.afterOne.join(', '));
    if(r.afterTwo.join(',') !== r.pair.slice().sort().join(','))
      throw new Error('two clicks gave ' + r.afterTwo.join(', '));
    if(r.afterOff.join(',') !== r.pair[1]) throw new Error('turning one off gave ' + r.afterOff.join(', '));
    if(r.others.length) throw new Error('it also changed ' + r.others.join(', '));
    if(!/\bon\b/.test(r.marked)) throw new Error('a chosen role does not read as on: "' + r.marked + '"');
    return 'on, on again, off \u2014 one role at a time, no other module touched';
  });

  await t.step('Everyone is a chip of its own, and the way back is one press', async () => {
    const r = await t.eval(async ()=>{
      DB.config.moduleRoles = {CMS:['Manager'], LMS:['Admin'], DST:['Operations']};
      await save('config');
      navigate('settings','fields');
      const ev = Array.from(document.querySelectorAll('button.role-chip'))
        .find(b=>(b.getAttribute('onclick')||'').indexOf("openModuleToEveryone('CMS')") === 0);
      ev.click();
      await new Promise(x=>setTimeout(x, 200));
      const cms = moduleRoles('CMS').length;
      window.confirm = ()=>true;
      await openEveryModuleToEveryone();
      const shut = MODULES.filter(m=>moduleRoles(m).length);
      const audits = DB.settingsAudit.filter(a=>/^module\.roles\./.test(a.key||'')).length;
      return {cms, shut, audits};
    });
    if(r.cms) throw new Error('the Everyone chip left ' + r.cms + ' role(s) on');
    if(r.shut.length) throw new Error('these are still restricted: ' + r.shut.join(', '));
    if(r.audits < 4) throw new Error('only ' + r.audits + ' change(s) reached the settings history');
    return 'one module opened by its chip, the rest by the header button, all of it written down';
  });

  await t.step('naming a role closes the module to everyone else', async () => {
    const r = await t.eval(async x => {
      const m = DB.team.find(y=>y.id===x);
      /* give them everything, so only the module rule can stop them */
      MODULES.forEach(mm=>{ m.perms[mm] = {}; ACTIONS.forEach(a=>m.perms[mm][a] = 1); });
      await save('team');
      DB.config.moduleRoles = {CMS: ['Admin']};
      await save('config');
      const was = currentUser; currentUser = x;
      const out = {role: roleOf(m), cms: can('CMS','view'), lms: can('LMS','view'),
                   cmsEdit: can('CMS','edit'), open: moduleOpenToMe('CMS')};
      currentUser = was;
      return out;
    }, who);
    if(r.role === 'Admin') throw new Error('the tester is an Admin, so this proves nothing');
    if(r.cms) throw new Error('CMS is closed to their role and can() still says yes');
    if(r.cmsEdit) throw new Error('view was closed but edit was not — it must close the module');
    if(!r.lms) throw new Error('closing CMS also closed LMS');
    if(r.open) throw new Error('moduleOpenToMe disagrees with can()');
    return 'CMS closed to ' + r.role + ' in one setting, LMS untouched';
  });

  await t.step('an admin is never shut out by it', async () => {
    /* Otherwise Setup could lock the firm out of its own system. */
    const r = await t.eval(()=>{
      const admin = DB.team.find(x=>isAdmin(x));
      if(!admin) return {skip:true};
      const was = currentUser; currentUser = admin.id;
      const out = {view: can('CMS','view'), open: moduleOpenToMe('CMS')};
      currentUser = was;
      return out;
    });
    if(r.skip) return 'no admin in this store to check';
    if(!r.view || !r.open) throw new Error('an admin was locked out of CMS');
    return 'admin still opens a module closed to every other role';
  });

  await t.step('and clearing it opens the module again', async () => {
    const r = await t.eval(async x => {
      DB.config.moduleRoles = {};
      await save('config');
      const was = currentUser; currentUser = x;
      const out = {cms: can('CMS','view'), roles: moduleRoles('CMS').length};
      currentUser = was;
      return out;
    }, who);
    if(!r.cms) throw new Error('CMS is still closed after clearing the list');
    if(r.roles) throw new Error('the list did not clear');
    return 'back to everyone';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 300));
    return 'none';
  });
});
