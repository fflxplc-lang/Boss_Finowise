/* TWO RESETS, EACH WITH A BOUNDARY IT DOES NOT CROSS.

   This is the one destructive screen in BOSS, so what is tested is not
   that it deletes — anything deletes — but that it deletes exactly what
   it says and nothing else. A Working Data Reset that quietly took the
   roles with it, or a New System Reset that left yesterday's permissions
   in place, would both pass a test that only counted records.

   The reset ends in location.reload(), so the wipe itself is driven
   through confirmSystemReset() with the reload stubbed out; what is then
   read back is the server's own copy, not the page's, because the page
   is the thing under suspicion. */
const {suite} = require('../lib/harness');

/* Fill the system with something to lose: records in the modules, and a
   setup around them worth keeping. */
const SEED = async () => {
  DB.config.company = DB.config.company || {};
  DB.config.company.name = 'ZZ Reset Firm';
  DB.config.roles = ['Admin','Manager','Relationship Manager','Operations','ZZ Custom Role'];
  DB.config.moduleRoles = {LMS: ['Manager']};
  DB.config.customMailTemplates = [{id:'TPL1', key:'tpl_zz', name:'ZZ Template', stage:'lead', active:true}];
  DB.config.mailTemplatesOff = {fqSend: 1};
  DB.settings = Object.assign({}, DB.settings, {'zz.setting':'kept'});
  DB.amcs = [{id:'AMC1', name:'ZZ AMC'}];
  DB.slaRules = [{id:'SLA9', name:'ZZ Rule', module:'LMS'}];

  const mate = {id:'ZZMATE', name:'ZZ Colleague', email:'zzmate@example.in', role:'Manager',
    designation:'Operations Manager', department:'Operations', status:'Active',
    parentUserId: currentUser, scope:'branch',
    perms: fullPerms(false, {view:1, edit:1}), adminFlags: fullAdminFlags(false)};
  DB.team = DB.team.filter(t=>t.id !== 'ZZMATE').concat([mate]);

  DB.leads = [{id:'ZZL1', leadName:'ZZ Lead', firstName:'ZZ', lastName:'Lead',
    email:'zzlead@example.in', assignedTo:currentUser, createdAt:new Date().toISOString()}];
  initState('LMS', DB.leads[0]);
  DB.tasks = [{id:'ZZT1', taskType:'ZZ Task', assignTo:currentUser, overallStatus:'Not Started'}];
  DB.auditLog = DB.auditLog.concat([{id:'ZZA1', at:new Date().toISOString(), by:currentUser,
    module:'LMS', recordId:'ZZL1', action:'ZZ Something Happened', details:[]}]);
  for(const k of ['config','settings','amcs','slaRules','team','leads','tasks','auditLog']) await save(k);
};

/* What the server holds, read back through the API rather than from the
   page, so a wipe that only emptied the browser's copy is caught. */
const onServer = async (t, key) => t.eval(async (k)=>{
  const res = await fetch('/api/storage/' + encodeURIComponent(k), {headers: apiHeaders()});
  if(res.status === 404) return null;
  if(!res.ok) throw new Error('storage get failed: ' + res.status);
  return JSON.parse((await res.json()).value);
}, key);

/* The reset the way a person does it: pick the mode, say the backup is in
   hand, type the phrase, press the button, then confirm in the dialog it
   opens. Only location.reload() is stood down, so the wipe can be read
   afterwards. */
const RUN = `async (scope, keepTeam) => {
  navigate('settings','resetsystem');
  await new Promise(r=>setTimeout(r, 250));
  rsSetScope(scope);
  document.getElementById('rs_haveBackup').checked = true;
  document.getElementById('rs_phrase').value = 'RESET THIS SYSTEM';
  resetFormChanged();
  if(scope === 'everything') document.getElementById('rs_keepTeam').checked = keepTeam !== false;
  if(document.getElementById('rs_go').disabled) throw new Error('the button is still disabled');
  window.__reloaded = false;
  window.resetReloadNow = () => { window.__reloaded = true; };
  runSystemReset();
  const btn = Array.from(document.querySelectorAll('#modalBody .modal-foot button'))
    .find(b=>/Delete \\d+ record|Reset to a new system/.test(b.textContent));
  if(!btn) throw new Error('the dialog has no confirm button');
  await confirmSystemReset();
  return {reloaded: window.__reloaded};
}`;

suite(async t => {

  await t.step('a system worth resetting', async () => {
    const r = await t.eval(async (seedSrc)=>{
      await (new Function('return (' + seedSrc + ')')())();
      return {leads: DB.leads.length, tasks: DB.tasks.length, roles: roleList().length,
              team: DB.team.length, amcs: DB.amcs.length};
    }, SEED.toString());
    if(!r.leads || !r.tasks) throw new Error('nothing was recorded to lose');
    if(r.roles < 5) throw new Error('the custom role did not stick');
    if(r.team < 2) throw new Error('there is only one account, so nothing proves the team survives');
    return r.leads + ' lead, ' + r.tasks + ' task, ' + r.roles + ' roles, ' + r.team + ' accounts';
  });

  t.section('the screen offers two resets, and says what each one leaves');

  await t.step('both are on the page, named, with their boundaries written down', async () => {
    await t.eval(()=>{ navigate('settings','resetsystem'); });
    await t.wait(400);
    const r = await t.eval(()=>{
      const c = document.getElementById('content');
      const radios = Array.from(c.querySelectorAll('input[name="rs_scope"]')).map(x=>x.value);
      return {radios, text: c.textContent,
              extras: !!document.getElementById('rs_extras'),
              keepTeam: !!document.getElementById('rs_keepTeam'),
              label: (document.getElementById('rs_go')||{}).textContent};
    });
    if(r.radios.join(',') !== 'records,everything') throw new Error('the two resets are ' + r.radios.join(', '));
    if(r.text.indexOf('Working Data Reset') < 0) throw new Error('the first one is not named');
    if(r.text.indexOf('New System Reset') < 0) throw new Error('the second one is not named');
    if(!/Preserved by this reset/.test(r.text)) throw new Error('a Working Data Reset does not say what it keeps');
    if(r.keepTeam) throw new Error('a Working Data Reset is offering to remove accounts, which is outside it');
    if(!/Clear the Working Data/.test(r.label||'')) throw new Error('the button reads "' + r.label + '"');
    return 'both named; the working-data reset offers nothing outside itself';
  });

  await t.step('choosing the new system brings out the choices that belong to it', async () => {
    const r = await t.eval(()=>{
      rsSetScope('everything');
      return {keepTeam: !!document.getElementById('rs_keepTeam'),
              conn: !!document.getElementById('rs_wipeConnections'),
              label: (document.getElementById('rs_go')||{}).textContent};
    });
    if(!r.keepTeam || !r.conn) throw new Error('the new-system choices did not appear');
    if(!/Reset to a New System/.test(r.label||'')) throw new Error('the button reads "' + r.label + '"');
    const back = await t.eval(()=>{
      rsSetScope('records');
      return {keepTeam: !!document.getElementById('rs_keepTeam'), conn: !!document.getElementById('rs_wipeConnections')};
    });
    if(back.keepTeam || back.conn) throw new Error('they stayed behind when the mode went back');
    return 'they appear for the new system and go away again';
  });

  await t.step('the confirmation names what goes and what stays, before anything goes', async () => {
    const r = await t.eval(()=>{
      rsSetScope('records');
      window._rsPhrase = 'RESET THIS SYSTEM';
      const el = document.getElementById('rs_phrase'); if(el) el.value = 'RESET THIS SYSTEM';
      const box = document.getElementById('rs_haveBackup'); if(box) box.checked = true;
      resetFormChanged();
      runSystemReset();
      const m = document.getElementById('modalBody');
      const open = document.getElementById('overlay').classList.contains('show');
      const txt = m.textContent;
      const buttons = Array.from(m.querySelectorAll('button')).map(b=>b.textContent.trim());
      closeModal();
      return {open, txt, buttons, leads: DB.leads.length};
    });
    if(!r.open) throw new Error('no confirmation was shown');
    if(r.txt.indexOf('WILL BE DELETED') < 0) throw new Error('it does not say what is deleted');
    if(r.txt.indexOf('WILL BE PRESERVED') < 0) throw new Error('it does not say what is preserved');
    if(!/reporting hierarchy/i.test(r.txt)) throw new Error('it is silent about the hierarchy');
    if(!r.buttons.some(b=>/^Cancel$/.test(b))) throw new Error('there is no way out of it');
    if(!r.buttons.some(b=>/Delete \d+ record/.test(b))) throw new Error('the confirm button is ' + r.buttons.join(', '));
    if(!r.leads) throw new Error('it deleted before it was confirmed');
    return 'two lists, a cancel, and nothing removed by opening it';
  });

  t.section('Working Data Reset — the modules, and nothing else');

  await t.step('it empties the modules', async () => {
    const ran = await t.eval(async (src)=>(new Function('return (' + src + ')')())('records'), RUN);
    await t.wait(600);
    const leads = await onServer(t, 'leads');
    const tasks = await onServer(t, 'tasks');
    if((leads||[]).length) throw new Error((leads||[]).length + ' lead(s) are still on the server');
    if((tasks||[]).length) throw new Error((tasks||[]).length + ' task(s) are still on the server');
    if(!ran.reloaded) throw new Error('it did not refresh the system afterwards');
    return 'leads and tasks gone, from the server as well as the page, and the screens redrawn';
  });

  await t.step('it preserved the roles, the permissions and the hierarchy', async () => {
    const team = await onServer(t, 'team');
    const mate = (team||[]).find(x=>x.id === 'ZZMATE');
    if(!mate) throw new Error('the colleague account was removed by a working-data reset');
    if(mate.role !== 'Manager') throw new Error('their role came back as ' + mate.role);
    if(mate.scope !== 'branch') throw new Error('their visibility scope came back as ' + mate.scope);
    if(!(mate.perms && mate.perms.LMS && mate.perms.LMS.edit)) throw new Error('their permissions were reset');
    if(mate.parentUserId == null) throw new Error('their reporting line was cut');
    const cfg = await onServer(t, 'config');
    if(((cfg||{}).roles||[]).indexOf('ZZ Custom Role') < 0) throw new Error('the roles list was reset');
    if(!(((cfg||{}).moduleRoles||{}).LMS||[]).length) throw new Error('module access by role was reset');
    return 'account, role, scope, permissions, reporting line, roles list and module access all intact';
  });

  await t.step('it preserved the settings, masters and templates', async () => {
    const cfg = await onServer(t, 'config');
    const settings = await onServer(t, 'settings');
    const amcs = await onServer(t, 'amcs');
    const sla = await onServer(t, 'slaRules');
    if(((cfg||{}).company||{}).name !== 'ZZ Reset Firm') throw new Error('the company details were reset');
    if(!(((cfg||{}).customMailTemplates)||[]).length) throw new Error('the email template was removed');
    if(!(((cfg||{}).mailTemplatesOff)||{}).fqSend) throw new Error('a template’s own switch was reset');
    if((settings||{})['zz.setting'] !== 'kept') throw new Error('a changed setting was reset');
    if(!(amcs||[]).length) throw new Error('the masters were cleared');
    if(!(sla||[]).length) throw new Error('the SLA rules were cleared');
    return 'company, templates and their switches, settings, masters and rules all intact';
  });

  await t.step('the audit trail opens with what happened to it', async () => {
    const log = await onServer(t, 'auditLog');
    if((log||[]).length !== 1) throw new Error('the trail has ' + (log||[]).length + ' entries');
    if(log[0].action !== 'Working Data Reset') throw new Error('it is recorded as ' + log[0].action);
    const scope = (log[0].details||[]).find(d=>d.field === 'Scope') || {};
    if(!/configuration, roles, permissions and hierarchy preserved/.test(scope.newValue||''))
      throw new Error('the record of it reads "' + scope.newValue + '"');
    return 'one entry, naming the reset and its boundary';
  });

  t.section('New System Reset — the setup as well');

  await t.step('it resets the configuration, the roles, the permissions and the hierarchy', async () => {
    await t.eval(async (seedSrc)=>{
      systemResetting = false;
      await (new Function('return (' + seedSrc + ')')())();
    }, SEED.toString());
    await t.eval(async (src)=>(new Function('return (' + src + ')')())('everything', true), RUN);
    await t.wait(600);
    const cfg = await onServer(t, 'config');
    const team = await onServer(t, 'team');
    const settings = await onServer(t, 'settings');
    const amcs = await onServer(t, 'amcs');
    if(((cfg||{}).roles||[]).indexOf('ZZ Custom Role') >= 0) throw new Error('the roles list survived');
    if((((cfg||{}).moduleRoles)||{}).LMS) throw new Error('module access by role survived');
    if(((cfg||{}).company||{}).name === 'ZZ Reset Firm') throw new Error('the company details survived');
    if(Object.keys(settings||{}).length) throw new Error('changed settings survived');
    if((amcs||[]).length) throw new Error('the masters survived');
    const mate = (team||[]).find(x=>x.id === 'ZZMATE');
    if(!mate) throw new Error('an account was removed although the team was kept');
    if(mate.role === 'Manager') throw new Error('their role was not reset');
    if(mate.scope !== 'own') throw new Error('their visibility scope is ' + mate.scope);
    if(mate.perms && mate.perms.LMS && mate.perms.LMS.edit) throw new Error('their permissions were not reset');
    if(!(mate.perms && mate.perms.LMS && mate.perms.LMS.view)) throw new Error('they were left with nothing at all');
    if(mate.name !== 'ZZ Colleague' || mate.email !== 'zzmate@example.in')
      throw new Error('the person’s own record was altered');
    return 'configuration, roles, permissions and hierarchy all back to a new system; the people kept';
  });

  await t.step('the acting admin keeps the keys, and the hierarchy is flat under them', async () => {
    const team = await onServer(t, 'team');
    const admin = (team||[]).find(x=>x.role === 'Admin');
    if(!admin) throw new Error('nobody is left who can set the system up again');
    if(admin.parentUserId) throw new Error('the admin reports to somebody');
    const mate = (team||[]).find(x=>x.id === 'ZZMATE');
    if(mate.parentUserId !== admin.id) throw new Error('the hierarchy was not reset under the admin');
    const log = await onServer(t, 'auditLog');
    if((log[0]||{}).action !== 'New System Reset') throw new Error('it is recorded as ' + (log[0]||{}).action);
    return 'one admin at the top, everybody reporting to them';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error(t.dialogs.join(' | '));
    return 'none';
  });
});
