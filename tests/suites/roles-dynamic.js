/* THE ROLES ARE THE FIRM'S, AND THEY ARE THEIRS TO CHANGE.

   BOSS shipped four generic labels — Manager, Relationship Manager,
   Operations — and the firm is not organised that way. Their ladder
   runs President / CEO down to Executive, and more to the point they
   asked for it to be theirs: "want be Dynamic, if Admin want to add
   or delete any role, it will impact entire boss connected system".

   So two things are tested here. That the ladder is what a system
   starts with. And that adding one reaches every screen that asks
   about roles, while removing one takes it out of every place that
   named it — because a deleted role left behind in a module access
   rule goes on quietly shutting people out of that module. */
const {suite} = require('../lib/harness');

const LADDER = ['Admin','President / CEO','Senior Vice President','Vice President',
                'Senior General manager','General Manager','Senior Manager','Manager',
                'Senior Executive','Executive'];

suite(async t => {
  await t.home();

  t.section('the ladder the firm actually has');

  await t.step('every role the firm named is there, in their order', async () => {
    const r = await t.eval(()=>({list: roleList(), shipped: defaultRoles()}));
    const want = LADDER;
    if(r.shipped.join(' | ') !== want.join(' | '))
      throw new Error('the shipped set reads: ' + r.shipped.join(', '));
    /* The live list opens on the ladder; anything an old system is
       still using sits underneath it, which is the migration's job. */
    if(r.list.slice(0, want.length).join(' | ') !== want.join(' | '))
      throw new Error('the list opens: ' + r.list.slice(0, want.length).join(', '));
    return want.length + ' roles, President / CEO down to Executive';
  });

  await t.step('and none of them falls through to the careful default', async () => {
    const r = await t.eval(()=>{
      const out = {};
      roleList().forEach(role=>{ out[role] = accessProfileFor(role).id; });
      return out;
    });
    const lost = Object.entries(r).filter(([, id])=>id === 'other').map(([k])=>k);
    if(lost.length) throw new Error('BOSS suggests nothing for: ' + lost.join(', '));
    if(r['Admin'] !== 'admin') throw new Error('Admin reads as ' + r['Admin']);
    if(r['President / CEO'] !== 'admin')
      throw new Error('President / CEO reads as ' + r['President / CEO']);
    if(r['Vice President'] !== 'manager')
      throw new Error('a Vice President reads as ' + r['Vice President']);
    if(r['Senior Vice President'] !== 'manager')
      throw new Error('a Senior Vice President reads as ' + r['Senior Vice President']);
    return 'every rung is matched by its words: the top reads as the firm, the middle as a team, the bottom as an adviser';
  });

  t.section('adding one reaches the whole system');

  await t.step('a role added in Setup is offered everywhere a role is asked for', async () => {
    const r = await t.eval(async ()=>{
      DB.config.roles = roleList().filter(x=>x !== 'ZZ Auditor');
      document.getElementById('modalBody').innerHTML =
        '<input type="text" id="f_newRole" value="ZZ Auditor">';
      await addRole();
      const seen = {};
      seen.list = roleList().indexOf('ZZ Auditor') >= 0;
      /* Module access — the chips the firm was looking at. */
      seen.moduleAccess = /ZZ Auditor/.test(renderSettingsFields());
      /* The template screen, the roles screen, and field security,
         which is drawn by the same function as module access. */
      seen.templates = /ZZ Auditor/.test(renderSettingsRoleTemplates());
      seen.rolesScreen = /ZZ Auditor/.test(renderSettingsRoles());
      /* SLA escalation, which used to carry a list written in 2024. */
      const sla = SLA_RULE_FIELDS.find(f=>f.k === 'escalateToRole');
      seen.sla = (effectiveOpts('CMS', sla) || []).indexOf('ZZ Auditor') >= 0;
      /* The control is a box you type into, so what it offers lives in
         the picker's rows rather than in its markup. */
      fieldInput(sla, '');
      seen.slaField = (window._pickRows['f_escalateToRole'] || []).some(o=>o.value === 'ZZ Auditor');
      /* And the form that puts somebody on a role. */
      const who = (DB.team.find(x=>!x.deletedAt) || {}).id;
      openMemberForm(who);
      seen.memberForm = (window._pickRows['f_role'] || []).some(o=>o.value === 'ZZ Auditor');
      closeModal();
      return seen;
    });
    const missed = Object.entries(r).filter(([, ok])=>!ok).map(([k])=>k);
    if(missed.length) throw new Error('a role added in Setup never reached: ' + missed.join(', '));
    return 'the list, module access, role templates, the roles screen, SLA escalation and the member form — ' +
      Object.keys(r).length + ' places, none of them told separately';
  });

  t.section('and removing one takes it out of all of them');

  await t.step('a role somebody is on cannot be removed at all', async () => {
    const r = await t.eval(async ()=>{
      const who = DB.team.find(x=>!x.deletedAt);
      const was = who.role;
      who.role = 'ZZ Auditor';
      await save('team');
      await removeRole('ZZ Auditor');
      const still = roleList().indexOf('ZZ Auditor') >= 0;
      who.role = was;
      await save('team');
      return still;
    });
    if(!r) throw new Error('a role was removed out from under the person on it');
    return 'refused, and said how many people would have to be moved first';
  });

  await t.step('removing it empties every place that named it', async () => {
    const r = await t.eval(async ()=>{
      const cfg = DB.config;
      cfg.moduleRoles = Object.assign({}, cfg.moduleRoles, {CMS:['Admin','ZZ Auditor']});
      cfg.fieldSecurity = Object.assign({}, cfg.fieldSecurity, {'CMS.pan':['ZZ Auditor']});
      cfg.roleTemplates = Object.assign({}, cfg.roleTemplates,
        {'ZZ Auditor': {perms:{}, adminFlags:{}, scope:'own', pagePerms:[], stagePerms:{}}});
      cfg.dashboard = Object.assign({off:{},roles:{},titles:{},order:[],custom:[]}, cfg.dashboard);
      cfg.dashboard.roles = Object.assign({}, cfg.dashboard.roles, {aum:['ZZ Auditor']});
      cfg.incentive = Object.assign({}, cfg.incentive);
      cfg.incentive.tasks = [{id:'ZZT', name:'ZZ Task', roles:['ZZ Auditor','Manager']}];
      cfg.appraisal = Object.assign({}, cfg.appraisal);
      cfg.appraisal.roleMap = Object.assign({}, cfg.appraisal.roleMap,
        {['role:' + incKey('ZZ Auditor')]: 'Growth'});
      DB.slaRules.push({id:'ZZSLA', name:'ZZ Rule', module:'CMS', escalateToRole:'ZZ Auditor'});
      await save('config'); await save('slaRules');
      const before = (roleReferences()[('zz auditor')] || []).length;
      await removeRole('ZZ Auditor');
      const c = DB.config;
      const left = {
        list: roleList().indexOf('ZZ Auditor') >= 0,
        moduleAccess: (c.moduleRoles.CMS || []).indexOf('ZZ Auditor') >= 0,
        fieldSecurity: (c.fieldSecurity['CMS.pan'] || []).indexOf('ZZ Auditor') >= 0,
        template: !!(c.roleTemplates || {})['ZZ Auditor'],
        dashboard: ((c.dashboard.roles || {}).aum || []).indexOf('ZZ Auditor') >= 0,
        incentive: ((c.incentive.tasks[0] || {}).roles || []).indexOf('ZZ Auditor') >= 0,
        appraisal: !!(c.appraisal.roleMap || {})['role:' + incKey('ZZ Auditor')],
        sla: (DB.slaRules.find(x=>x.id === 'ZZSLA') || {}).escalateToRole === 'ZZ Auditor'};
      /* What was there beside it is untouched. */
      const kept = {moduleAccess: (c.moduleRoles.CMS || []).indexOf('Admin') >= 0,
                    incentive: ((c.incentive.tasks[0] || {}).roles || []).indexOf('Manager') >= 0};
      DB.slaRules = DB.slaRules.filter(x=>x.id !== 'ZZSLA');
      await save('slaRules');
      return {before, left, kept};
    });
    if(r.before < 7) throw new Error('only ' + r.before + ' places were counted as naming it');
    const over = Object.entries(r.left).filter(([, there])=>there).map(([k])=>k);
    if(over.length) throw new Error('its name is still in: ' + over.join(', '));
    if(!r.kept.moduleAccess || !r.kept.incentive)
      throw new Error('it took something else with it');
    return 'gone from the list, module access, field security, its template, a dashboard card, '
      + 'an incentive task, the appraisal mapping and an SLA rule — and nothing else disturbed';
  });

  t.section('and an old system is brought to the ladder without losing anything');

  await t.step('an old role still spoken for is kept; one nobody uses goes', async () => {
    const r = await t.eval(async ()=>{
      /* A system as it was before the ladder: the four generic labels,
         one of them still naming who may open a module. */
      DB.config.roles = ['Admin','Manager','Relationship Manager','Operations'];
      DB.config.moduleRoles = Object.assign({}, DB.config.moduleRoles,
        {RMS:['Admin','Relationship Manager']});
      delete DB.config.rolesAligned;
      await save('config');
      await alignRolesOnce();
      return {list: roleList(), ran: !!DB.config.rolesAligned};
    });
    if(!r.ran) throw new Error('the alignment did not run');
    const want = LADDER;
    if(r.list.slice(0, want.length).join(' | ') !== want.join(' | '))
      throw new Error('it opens: ' + r.list.slice(0, want.length).join(', '));
    if(r.list.indexOf('Relationship Manager') < 0)
      throw new Error('a role a module access rule still names was taken away');
    if(r.list.indexOf('Operations') >= 0)
      throw new Error('a role nothing named was kept: ' + r.list.join(', '));
    return 'the ladder on top, Relationship Manager kept because RMS still names it, Operations dropped because nothing did';
  });

  await t.step('and it only ever runs once', async () => {
    const r = await t.eval(async ()=>{
      DB.config.roles = roleList().concat(['ZZ Later']);
      await save('config');
      const ran = await alignRolesOnce();
      return {ran, still: roleList().indexOf('ZZ Later') >= 0};
    });
    if(r.ran) throw new Error('it ran a second time');
    if(!r.still) throw new Error('it undid a role added after it ran');
    return 'a role added afterwards is left exactly where the firm put it';
  });

  await t.step('nothing was alerted but the two this suite provoked', async () => {
    const odd = t.dialogs.filter(x=>!/still have the|is gone/.test(String(x)));
    if(odd.length) throw new Error('alerts: ' + odd.join(' | ').slice(0, 220));
    return t.dialogs.length + ' pop-up(s): the refusal, and the receipt for the delete';
  });
});
