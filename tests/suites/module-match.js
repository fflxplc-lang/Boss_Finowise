/* THE SAME PERSON, THE SAME JOB, THREE DIFFERENT ANSWERS.

   A Senior Executive could open LMS and press New Lead, open RMS and
   press New Review, and open CMS to find no button at all. Nobody
   decided that: the three modules were ticked on three different days
   and never compared. The instruction is not a new permission
   structure — it is "whatever they already hold in LMS and RMS, give
   them in CMS", which BOSS can work out for itself.

   What this holds to: that the source modules are a ceiling and not a
   licence — an action held in neither LMS nor RMS is not granted in
   CMS — that nothing already held is taken away, that nothing outside
   those modules moves (not a capability, not the record scope, not
   Setup), and that the workflow comes with it both ways it can be held
   back: a deny on the target, and a stage list narrowed there and
   nowhere else. */
const {suite} = require('../lib/harness');

const AS = `(id, fn) => { const was = currentUser; currentUser = id; try { return fn(); } finally { currentUser = was; } }`;

suite(async t => {
  await t.home();
  let who = null, mate = null, other = null;

  await t.step('three accounts that can work a lead and a review but not a client', async () => {
    const r = await t.eval(async ()=>{
      const role = 'Senior Executive';
      if(roleList().indexOf(role) < 0){ DB.config.roles = roleList().concat([role]); }
      const mk = (name, r2, extra) => {
        const p = fullPerms(false);
        ['LMS','RMS'].forEach(m=>['view','create','edit','download','upload','assign','export']
          .forEach(a=>{ p[m][a] = 1; }));
        p.CMS.view = 1;                                   // they can see a client and do nothing else
        const m2 = Object.assign({id: uid('TM'), name, role: r2, email: name.split(' ')[1].toLowerCase()+'@zz.in',
          status:'Active', scope:'own', perms: p, adminFlags:{manageReports:1}, branch:'Varanasi',
          createdAt:new Date().toISOString()}, extra || {});
        DB.team.push(m2); return m2.id;
      };
      const out = {
        who: mk('ZZ Shubham Seth', role, {permsOff:{CMS:{changeStage:1}},
          stagePerms:{CMS: getBlueprint('CMS').states.slice(0, 2).map(x=>x.id)}}),
        mate: mk('ZZ Divya Shinde', role, {}),
        other: mk('ZZ Omar Ops', 'Operations', {}),
      };
      await save('team'); await save('config');
      return out;
    });
    who = r.who; mate = r.mate; other = r.other;
    const seen = await t.eval((a)=>eval('(' + a.AS + ')')(a.who, ()=>({
      lmsCreate: can('LMS','create'), rmsCreate: can('RMS','create'), cmsCreate: can('CMS','create'),
      cmsEdit: can('CMS','edit'), cmsStage: can('CMS','changeStage'), cmsView: can('CMS','view')})), {AS, who});
    if(!seen.lmsCreate || !seen.rmsCreate) throw new Error('the fixture cannot create in LMS or RMS');
    if(seen.cmsCreate || seen.cmsEdit) throw new Error('the fixture can already work in CMS');
    if(seen.cmsStage) throw new Error('the fixture is not actually denied the CMS workflow');
    return 'create and edit in LMS and RMS, view only in CMS, and the CMS workflow turned off';
  });

  t.section('bringing CMS into line');

  await t.step('the screen offers it, and says what each account would gain', async () => {
    const r = await t.eval(()=>{
      navigate('settings', 'usermanagement');
      const text = document.getElementById('content').textContent.replace(/\s+/g, ' ');
      modMatchSet('role', 'Senior Executive');
      const rows = modMatchAccounts().map(t2=>({name: t2.name, d: modMatchDiff(t2, ['LMS','RMS'], 'CMS')}));
      return {offers: /Bring one module into line with another/.test(text),
        defaults: JSON.stringify(modMatch()),
        rows: rows.map(x=>x.name + ': ' + (x.d.gains.join('/') || 'nothing')
          + (x.d.deny? ' +workflow' : '') + (x.d.stages? ' +stages' : ''))};
    });
    if(!r.offers) throw new Error('the control is not on the screen');
    if(!/LMS/.test(r.defaults) || !/CMS/.test(r.defaults))
      throw new Error('it does not open on the question that was asked: ' + r.defaults);
    if(!r.rows.some(x=>/Create/.test(x))) throw new Error('it does not see the missing Create: ' + r.rows.join(' | '));
    if(!r.rows.some(x=>/\+workflow/.test(x))) throw new Error('it does not see the workflow deny');
    return r.rows.join('  ·  ');
  });

  await t.step('applying it gives CMS exactly what LMS and RMS hold, and no more', async () => {
    const r = await t.eval(async (a)=>{
      modMatchSet('role', 'Senior Executive');
      const old = window.confirm; window.confirm = ()=>true;
      try { await applyModuleMatch(); } finally { window.confirm = old; }
      const look = id => { const was = currentUser; currentUser = id;
        const out = {};
        ACTIONS.forEach(x=>{ out[x] = [can('LMS',x), can('RMS',x), can('CMS',x)]; });
        const t2 = DB.team.find(y=>y.id === id);
        currentUser = was;
        return {acts: out, off: JSON.stringify(t2.permsOff || {}),
          stages: JSON.stringify(t2.stagePerms || {}), scope: t2.scope,
          caps: ADMIN_FLAGS.filter(f=>t2.adminFlags && t2.adminFlags[f]).join(',')};
      };
      return {him: look(a.who), her: look(a.mate), ops: look(a.other)};
    }, {who, mate, other});
    const him = r.him.acts;
    const mismatched = Object.keys(him).filter(x=>(him[x][0] || him[x][1]) !== him[x][2]);
    if(mismatched.length) throw new Error('CMS does not match LMS/RMS on: ' + mismatched.join(', '));
    const over = Object.keys(him).filter(x=>!him[x][0] && !him[x][1] && him[x][2]);
    if(over.length) throw new Error('CMS was granted more than the sources hold: ' + over.join(', '));
    if(/CMS/.test(r.him.off)) throw new Error('the CMS workflow deny survived');
    if(/CMS/.test(r.him.stages)) throw new Error('the narrowed CMS stage list survived');
    if(r.him.scope !== 'own') throw new Error('it changed what they see');
    if(r.him.caps !== 'manageReports') throw new Error('it touched their capabilities: ' + r.him.caps);
    /* and somebody on another role was not in this run */
    const opsCms = r.ops.acts.create;
    if(opsCms[2] && !opsCms[0] && !opsCms[1]) throw new Error('an account outside the role was changed');
    return 'every action they hold in LMS or RMS they now hold in CMS, nothing beyond it, the workflow back, '
      + 'and their scope, capabilities and other roles untouched';
  });

  await t.step('and the client screen gives them the button back', async () => {
    const r = await t.eval((a)=>eval('(' + a.AS + ')')(a.who, ()=>{
      navigate('cms');
      const page = document.getElementById('content').innerHTML;
      const c = {id: uid('CMS'), cmsName:'ZZ Match Client', cmsStage:'clientCreated', rmName: a.who};
      DB.clients.push(c);
      return {addButton: /openClientForm\(\)/.test(page),
        stagePanel: !/Read-only/.test(blueprintWidget('CMS', c, {})),
        create: can('CMS','create'), edit: can('CMS','edit')};
    }), {AS, who});
    if(!r.create || !r.edit) throw new Error('the permissions did not land');
    if(!r.addButton) throw new Error('the CMS page still offers no way to add a client');
    if(!r.stagePanel) throw new Error('the stage panel is still read-only');
    return 'New Client is back on the CMS page, and the stage panel offers its steps';
  });

  await t.step('a module the sources do not reach is not widened by it', async () => {
    const r = await t.eval(async (a)=>{
      modMatchSet('role', 'Senior Executive');
      modMatchSet('to', 'Transactions');
      const rows = modMatchAccounts().map(t2=>modMatchDiff(t2, ['LMS','RMS'], 'Transactions'));
      const old = window.confirm; window.confirm = ()=>true;
      try { await applyModuleMatch(); } finally { window.confirm = old; }
      const was = currentUser; currentUser = a.who;
      const out = {txnCreate: can('Transactions','create'), txnDelete: can('Transactions','delete'),
        lmsDelete: can('LMS','delete')};
      currentUser = was;
      modMatchSet('to', 'CMS');
      return Object.assign(out, {would: rows.reduce((n,d)=>n + d.n, 0)});
    }, {who});
    /* they hold no Delete anywhere in the sources, so Delete must not appear */
    if(r.lmsDelete) throw new Error('the fixture holds Delete in LMS after all');
    if(r.txnDelete) throw new Error('Delete was granted from nowhere');
    if(!r.txnCreate) throw new Error('Create did not follow into Transactions');
    return 'Create followed, Delete did not — because they hold Delete in neither source module';
  });

  await t.step('nothing was alerted that was not a result', async () => {
    const odd = t.dialogs.map(String).filter(x=>!/now hold in|Nothing to do/.test(x));
    if(odd.length) throw new Error(odd.join(' | ').slice(0, 200));
    return t.dialogs.length + ' confirmation(s)';
  });
});
