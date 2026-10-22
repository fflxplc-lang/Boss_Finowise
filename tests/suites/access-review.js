/* IS WHAT THIS PERSON HAS RIGHT FOR THE JOB THEY DO?

   Access was set one account at a time by whoever made the account, and
   the question the firm actually asks cannot be answered one account at
   a time: it is a comparison across all of them, against what each job
   needs.

   So every role has a profile, matched by what the role is called —
   because the roles are the firm's own and a list written into the code
   would be out of date the first time they add one. What this holds to:
   that no two profiles come out the same, that the careful profile is
   the fallback rather than the generous one, that applying one writes
   what it said it would write and nothing else, and above all the
   firm's one universal rule — the workflow belongs to everybody, and a
   run that tightens an account still leaves it able to move a record. */
const {suite} = require('../lib/harness');

const AS = `(id, fn) => { const was = currentUser; currentUser = id; try { return fn(); } finally { currentUser = was; } }`;

suite(async t => {
  await t.home();
  let made = null;

  await t.step('the firm’s own roles, each matched to a profile', async () => {
    const r = await t.eval(()=>{
      DB.config.roles = ['Admin','Manager','Relationship Manager','Operations','Senior Executive','Compliance Officer'];
      const out = {};
      roleList().forEach(role=>{
        const p = accessProfileFor(role);
        const perms = accessProfilePerms(p);
        out[role] = {profile: p.label, scope: p.scope,
          mods: MODULES.filter(m=>ACTIONS.some(a=>perms[m][a])).length,
          flags: p.flags === 'all' ? ADMIN_FLAGS.length : (p.flags || []).length,
          /* no profile grants or withholds the workflow: it is not theirs to set */
          stage: MODULES.some(m=>perms[m].changeStage)};
      });
      return out;
    });
    const roles = Object.keys(r);
    if(r['Admin'].profile !== 'Administrator') throw new Error('Admin matched ' + r['Admin'].profile);
    if(r['Operations'].profile !== 'Operations') throw new Error('Operations matched ' + r['Operations'].profile);
    if(r['Relationship Manager'].profile !== 'Relationship Manager')
      throw new Error('RM matched ' + r['Relationship Manager'].profile);
    if(r['Compliance Officer'].profile !== 'Compliance / Audit')
      throw new Error('Compliance matched ' + r['Compliance Officer'].profile);
    if(roles.some(x=>r[x].stage)) throw new Error('a profile tried to grant Change stage itself');
    /* and they are not all the same profile, which is the whole point */
    const shapes = new Set(roles.map(x=>r[x].profile + '|' + r[x].scope + '|' + r[x].mods + '|' + r[x].flags));
    if(shapes.size < 4) throw new Error('only ' + shapes.size + ' distinct profiles across ' + roles.length + ' roles');
    return roles.map(x=>x + ' → ' + r[x].profile + ' (' + r[x].mods + ' modules, '
      + r[x].scope + ', ' + r[x].flags + ' capabilities)').join('; ');
  });

  await t.step('an unknown role gets the careful profile, not the generous one', async () => {
    const r = await t.eval(()=>{
      const p = accessProfileFor('Intern (Summer)');
      const perms = accessProfilePerms(p);
      const admin = accessProfilePerms(accessProfileFor('Admin'));
      return {label: p.label, scope: p.scope, flags: (p.flags || []).length,
        mods: MODULES.filter(m=>ACTIONS.some(a=>perms[m][a])).length,
        adminMods: MODULES.filter(m=>ACTIONS.some(a=>admin[m][a])).length,
        deletes: MODULES.some(m=>perms[m].delete), exports: MODULES.some(m=>perms[m].export)};
    });
    if(r.scope !== 'own') throw new Error('it sees ' + r.scope);
    if(r.flags) throw new Error('it opens ' + r.flags + ' part(s) of Setup');
    if(r.deletes || r.exports) throw new Error('it can delete or export');
    if(r.mods >= r.adminMods) throw new Error('it reaches as much as an administrator');
    return '"' + r.label + '" — ' + r.mods + ' modules against an administrator’s ' + r.adminMods
      + ', own records only, nothing deleted or exported';
  });

  await t.step('accounts on those roles, set up the way a firm actually leaves them', async () => {
    made = await t.eval(async ()=>{
      const mk = (name, role, perms, extra) => {
        const m = Object.assign({id: uid('TM'), name, role, email: name.replace(/\W/g,'').toLowerCase()+'@zz.in',
          status:'Active', scope:'own', perms: perms || {}, adminFlags:{}, branch:'Varanasi',
          createdAt:new Date().toISOString()}, extra || {});
        DB.team.push(m); return m.id;
      };
      const out = {
        /* nobody ever ticked anything for her, and somebody took the workflow away */
        rm: mk('ZZ Rhea RM', 'Relationship Manager', {CMS:{edit:1}}, {permsOff:{CMS:{changeStage:1}, LMS:{changeStage:1}}}),
        /* over-granted: holds the whole firm and every capability */
        ops: mk('ZZ Omar Ops', 'Operations', fullPerms(true), {scope:'all', adminFlags: fullAdminFlags(true)}),
        /* about right already */
        mgr: mk('ZZ Mira Manager', 'Manager', null, {scope:'team'}),
        odd: mk('ZZ Ivan Intern', 'Senior Executive', null, {}),
      };
      await save('team');
      return out;
    });
    const r = await t.eval((a)=>eval('(' + a.AS + ')')(a.made.rm, ()=>({
      stage: can('CMS','changeStage'), view: can('CMS','view')})), {AS, made});
    if(r.stage) throw new Error('the fixture RM is not actually denied the workflow');
    return 'an RM with a workflow deny, an Operations account holding everything, a Manager and an '
      + 'unrecognised role';
  });

  t.section('the review');

  await t.step('it says, per account, exactly what would change', async () => {
    const r = await t.eval((a)=>{
      navigate('settings', 'accessreview');
      const text = document.getElementById('content').textContent.replace(/\s+/g, ' ');
      const rows = accessReviewRows();
      const by = {};
      rows.forEach(x=>{ by[x.t.name] = {n: x.diff.n, gains: x.diff.gains.length, loses: x.diff.loses.length,
        scope: x.diff.scope, denies: x.diff.denies, profile: x.diff.profile.label}; });
      return {text: text.slice(0, 200), rows: rows.length, by,
        lists: /ZZ Omar Ops/.test(text) && /ZZ Rhea RM/.test(text),
        saysWorkflow: /The workflow is everybody/.test(text),
        button: (Array.from(document.querySelectorAll('#content button'))
          .find(b=>/Apply to \d+ account/.test(b.textContent)) || {}).textContent || ''};
    }, {made});
    if(!r.lists) throw new Error('the screen does not list the accounts');
    if(!r.saysWorkflow) throw new Error('it does not state the universal rule');
    if(!/Apply to \d+ account/.test(r.button)) throw new Error('there is no apply button: "' + r.button + '"');
    const omar = r.by['ZZ Omar Ops'];
    if(!omar.loses) throw new Error('an account holding everything would lose nothing');
    if(!omar.scope || omar.scope.to !== 'branch') throw new Error('Operations was not narrowed to its branch');
    const rhea = r.by['ZZ Rhea RM'];
    if(!rhea.denies.length) throw new Error('the workflow deny is not named as something that would go');
    return Object.keys(r.by).map(k=>k + ': +' + r.by[k].gains + ' / -' + r.by[k].loses).join('; ')
      + ' — and the button reads "' + r.button.trim() + '"';
  });

  await t.step('applying it gives each account the profile for its role, and no two the same', async () => {
    const r = await t.eval(async (a)=>{
      const old = window.confirm; window.confirm = ()=>true;
      try { await applyAccessReview({dashboard:false}); } finally { window.confirm = old; }
      const look = id => {
        const t2 = DB.team.find(x=>x.id === id);
        const was = currentUser; currentUser = id;
        const out = {scope: t2.scope,
          mods: MODULES.filter(m=>permGivenActions(t2, m).length).length,
          caps: ADMIN_FLAGS.filter(f=>t2.adminFlags && t2.adminFlags[f]).length,
          del: MODULES.some(m=>can(m,'delete')), exp: MODULES.some(m=>can(m,'export')),
          cms: can('CMS','view'), lms: can('LMS','view'),
          stage: MODULES.filter(m=>can(m,'changeStage')).length,
          off: JSON.stringify(t2.permsOff || {})};
        currentUser = was; return out;
      };
      return {rm: look(a.made.rm), ops: look(a.made.ops), mgr: look(a.made.mgr), odd: look(a.made.odd),
        still: accessReviewRows().filter(x=>x.diff.n && !x.diff.fixed).length};
    }, {made});
    if(r.still) throw new Error(r.still + ' account(s) still differ after applying');
    if(r.ops.caps) throw new Error('Operations kept ' + r.ops.caps + ' administrator capabilit(ies)');
    if(r.ops.scope !== 'branch' || r.rm.scope !== 'own' || r.mgr.scope !== 'team')
      throw new Error('the scopes did not land: ' + JSON.stringify({ops:r.ops.scope, rm:r.rm.scope, mgr:r.mgr.scope}));
    if(r.rm.del || r.rm.exp) throw new Error('the RM can still delete or export');
    if(!r.mgr.exp) throw new Error('the Manager cannot export');
    if(r.rm.mods === r.mgr.mods && r.mgr.mods === r.ops.mods)
      throw new Error('everybody came out with the same access');
    return 'RM ' + r.rm.mods + ' modules/own, Operations ' + r.ops.mods + '/branch, Manager '
      + r.mgr.mods + '/team, unrecognised role ' + r.odd.mods + '/own — four different answers';
  });

  await t.step('and every one of them can still move a record along its workflow', async () => {
    const r = await t.eval((a)=>{
      const out = {};
      Object.keys(a.made).forEach(k=>{
        const id = a.made[k];
        const was = currentUser; currentUser = id;
        out[k] = {stage: MODULES.filter(m=>can(m,'changeStage')).length,
          off: JSON.stringify((DB.team.find(x=>x.id === id) || {}).permsOff || {}),
          panel: (()=>{ const c = DB.clients.find(x=>!x.deletedAt);
            return c ? !/Read-only/.test(blueprintWidget('CMS', c, {})) : true; })()};
        currentUser = was;
      });
      return out;
    }, {made});
    const bad = Object.keys(r).filter(k=>r[k].stage < 1 || !r[k].panel || r[k].off !== '{}');
    if(bad.length) throw new Error('these cannot move a record: '
      + bad.map(k=>k + ' ' + JSON.stringify(r[k])).join(' | '));
    return 'all four, the tightened ones included — and the deny that was on the RM is gone';
  });

  await t.step('what a move requires is exactly as it was', async () => {
    const r = await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.made.rm;
      try {
        const c = {id: uid('CMS'), cmsName:'ZZ Review Client', cmsStage:'familyMapping', rmName: a.made.rm};
        DB.clients.push(c);
        const before = stateOf('CMS', c);
        await doTransition('CMS', c.id, 'familyMember');     // requires familyHeadLookup
        const after = stateOf('CMS', DB.clients.find(x=>x.id === c.id));
        const asks = !!document.querySelector('.modal');
        if(asks) closeModal();
        return {before, after, asks};
      } finally { currentUser = was; }
    }, {made});
    if(r.after !== r.before) throw new Error('a step with a missing field went through after the review');
    if(!r.asks) throw new Error('nothing asked for the field');
    return 'the mandatory field still stops the step for an account the review has just set up';
  });

  await t.step('the dashboard follows the same profiles', async () => {
    const r = await t.eval(async ()=>{
      const plan = accessReviewDashboard();
      await dashSave(d=>{ Object.keys(plan).forEach(id=>{
        if(plan[id].length) d.roles[id] = plan[id]; else delete d.roles[id]; }); });
      const rev = dashRoles(dashWidget('revenue'));
      const mine = dashRoles(dashWidget('myLeads'));
      const lms = dashRoles(dashWidget('effLms'));
      return {rev, mine, lms, roles: roleList().length};
    });
    if(r.rev.indexOf('Operations') >= 0) throw new Error('Operations was given the revenue card');
    if(r.rev.indexOf('Admin') < 0 || r.rev.indexOf('Manager') < 0)
      throw new Error('the revenue card is not open to those who run reports: ' + r.rev.join(', '));
    /* An empty list is the system's way of saying every role, so the
       lead card either names the RM or names nobody at all. */
    if(r.lms.length && r.lms.indexOf('Relationship Manager') < 0)
      throw new Error('an RM cannot see the lead card: ' + r.lms.join(', '));
    return 'revenue → ' + r.rev.join(', ') + '; the LMS card → '
      + (r.lms.length ? r.lms.length + ' of ' + r.roles + ' roles' : 'every role, because every profile opens LMS');
  });

  await t.step('an account left out of the run is left exactly as it was', async () => {
    const r = await t.eval(async ()=>{
      const role = 'Operations';
      const m = {id: uid('TM'), name:'ZZ Left Out', role, email:'zzleftout@zz.in', status:'Active',
        scope:'all', perms: fullPerms(true), adminFlags: fullAdminFlags(true),
        createdAt:new Date().toISOString()};
      DB.team.push(m); await save('team');
      accessReviewToggle(m.id);                       // untick it
      const before = JSON.stringify({p:m.perms, s:m.scope, f:m.adminFlags});
      const old = window.confirm; window.confirm = ()=>true;
      try { await applyAccessReview({dashboard:false}); } finally { window.confirm = old; }
      const after = JSON.stringify({p:m.perms, s:m.scope, f:m.adminFlags});
      return {same: before === after, scope: m.scope};
    });
    if(!r.same) throw new Error('an account that was ticked out still changed');
    return 'untouched, down to the last checkbox';
  });

  await t.step('nothing was alerted that was not a result', async () => {
    const odd = t.dialogs.map(String).filter(x=>!/account\(s\) set to the profile|Nothing to apply/.test(x));
    if(odd.length) throw new Error(odd.join(' | ').slice(0, 240));
    return t.dialogs.length + ' confirmation(s)';
  });
});
