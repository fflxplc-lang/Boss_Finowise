/* THREE PEOPLE DOING THE SAME JOB, SET UP ON THREE DIFFERENT DAYS.

   Nobody meant them to differ. One was made in a hurry and is short a
   capability; another had its pages narrowed for a reason nobody
   remembers; the third was copied from a fourth person who has since
   changed roles. Reading two access panels side by side and typing one
   into the other is how they got out of step, so doing that again is
   not the fix.

   One account answers for the others instead. What this holds to:
   that everything the access panel writes is copied — modules action
   by action, capabilities, the record scope, the pages, the stages and
   whether the workflow has been taken away — that nothing else is
   touched, down to the role and the sign-in and the records they own,
   and that a grantor still cannot hand on what they do not hold. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();
  let ids = null;

  await t.step('four accounts on one role, no two of them the same', async () => {
    ids = await t.eval(async ()=>{
      const role = 'Senior Executive';
      DB.config.roles = roleList().concat(roleList().indexOf(role) < 0 ? [role] : []);
      const mk = (name, extra) => {
        const m = Object.assign({id: uid('TM'), name, role, email: name.split(' ')[1].toLowerCase()+'@finowise.in',
          status:'Active', scope:'own', perms:{}, adminFlags:{}, branch:'Varanasi',
          createdAt:new Date().toISOString()}, extra || {});
        DB.team.push(m); return m;
      };
      /* the reference: the one somebody set up properly */
      const souvik = mk('ZZ Souvik', {scope:'team',
        perms:(()=>{ const p = fullPerms(false);
          ['LMS','CMS','RMS','DST','Meetings','Calls'].forEach(m=>['view','create','edit','export','assign']
            .forEach(a=>{ p[m][a] = 1; })); return p; })(),
        adminFlags:{manageReports:1, approveAllocations:1},
        pagePerms:['lms','cms','rms','dst'],
        stagePerms:{CMS: getBlueprint('CMS').states.slice(0, 4).map(s=>s.id)}});
      const divya = mk('ZZ Divya', {scope:'team',
        perms:(()=>{ const p = fullPerms(false); ['LMS','CMS'].forEach(m=>{ p[m].view = 1; }); return p; })(),
        adminFlags:{manageReports:1}});
      /* and this one has had the workflow taken away as well */
      const shubham = mk('ZZ Shubham', {scope:'own',
        perms:(()=>{ const p = fullPerms(false); p.CMS.view = 1; p.CMS.edit = 1; return p; })(),
        permsOff:{CMS:{changeStage:1}}});
      const priya = mk('ZZ Priya', {scope:'all', perms: fullPerms(true),
        adminFlags: fullAdminFlags(true)});
      await save('team');
      return {souvik: souvik.id, divya: divya.id, shubham: shubham.id, priya: priya.id};
    });
    const r = await t.eval((x)=>{
      const g = id => DB.team.find(t2=>t2.id === id);
      const shape = t2 => MODULES.filter(m=>permGivenActions(t2, m).length).length + '/' +
        ADMIN_FLAGS.filter(f=>t2.adminFlags && t2.adminFlags[f]).length + '/' + (t2.scope||'own');
      return Object.keys(x).map(k=>k + ' ' + shape(g(x[k])));
    }, ids);
    if(new Set(r).size !== 4) throw new Error('the fixtures are not actually different: ' + r.join(', '));
    return r.join(' · ');
  });

  t.section('copying it');

  await t.step('the dialog says what is copied and what is not, and what each one would gain', async () => {
    const r = await t.eval((x)=>{
      openAccessCopy(x.souvik);
      const el = document.querySelector('.modal');
      const text = (el ? el.textContent : '').replace(/\s+/g, ' ');
      return {open: !!el, text,
        says: /What is copied/.test(text),
        notCopied: /Not copied: their name, their sign-in, the role/.test(text),
        lists: /ZZ Divya/.test(text) && /ZZ Shubham/.test(text),
        notItself: !/ZZ Souvik<\/b>/.test(el ? el.innerHTML : ''),
        button: (Array.from(document.querySelectorAll('.modal button'))
          .find(b=>/Choose who|Copy it to/.test(b.textContent)) || {}).textContent.trim()};
    }, ids);
    if(!r.open || !r.says) throw new Error('the dialog does not say what it would copy');
    if(!r.notCopied) throw new Error('it does not say what it leaves alone');
    if(!r.lists) throw new Error('the other accounts are not listed');
    if(!/Choose who/.test(r.button)) throw new Error('it offers to copy before anybody is chosen');
    return 'what is copied, what is not, every other account with its differences, and the button waits';
  });

  await t.step('copying it to the three leaves them identical to the reference', async () => {
    const r = await t.eval(async (x)=>{
      ['divya','shubham','priya'].forEach(k=>accessCopyToggle(x[k]));
      await applyAccessCopy(x.souvik);
      const g = id => DB.team.find(t2=>t2.id === id);
      const src = g(x.souvik);
      const same = id => accessCopyDiff(src, g(id)).n;
      const one = g(x.shubham);
      return {diffs: {divya: same(x.divya), shubham: same(x.shubham), priya: same(x.priya)},
        scope: one.scope, pages: (one.pagePerms || []).join(','),
        stages: JSON.stringify(one.stagePerms || {}),
        caps: ADMIN_FLAGS.filter(f=>one.adminFlags && one.adminFlags[f]).join(','),
        mods: MODULES.filter(m=>permGivenActions(one, m).length).join(','),
        off: JSON.stringify(one.permsOff || {}),
        /* and the things that are theirs alone */
        name: one.name, email: one.email, role: roleOf(one), branch: one.branch};
    }, ids);
    const left = Object.keys(r.diffs).filter(k=>r.diffs[k]);
    if(left.length) throw new Error('still different: ' + left.map(k=>k + ' (' + r.diffs[k] + ')').join(', '));
    if(r.scope !== 'team') throw new Error('the scope did not come across: ' + r.scope);
    if(r.pages !== 'lms,cms,rms,dst') throw new Error('the pages did not: ' + r.pages);
    if(!/cmsStage|clientCreated/.test(r.stages) && r.stages === '{}')
      throw new Error('the stages did not: ' + r.stages);
    if(r.caps !== 'manageReports,approveAllocations') throw new Error('the capabilities did not: ' + r.caps);
    if(r.name !== 'ZZ Shubham' || !/shubham@/.test(r.email) || r.branch !== 'Varanasi')
      throw new Error('something that was theirs alone was overwritten: ' + JSON.stringify(r));
    return 'all three identical to ZZ Souvik — ' + r.mods.split(',').length + ' modules, '
      + r.caps.split(',').length + ' capabilities, same scope, pages and stages — and each keeps their own '
      + 'name, sign-in, role and branch';
  });

  await t.step('the workflow deny came across with everything else, and clears with it', async () => {
    const r = await t.eval(async (x)=>{
      const g = id => DB.team.find(t2=>t2.id === id);
      const before = JSON.stringify(g(x.shubham).permsOff || {});
      /* the reference holds no deny, so copying it is what gives the
         workflow back — which is what the firm wanted of it */
      const was = currentUser; currentUser = x.shubham;
      const may = can('CMS','changeStage');
      currentUser = was;
      return {before, may, src: JSON.stringify(g(x.souvik).permsOff || {})};
    }, ids);
    if(r.before !== '{}') throw new Error('the deny survived the copy: ' + r.before);
    if(!r.may) throw new Error('the account still cannot move a record');
    return 'the deny that was on ZZ Shubham is gone, because the account it was copied from had none';
  });

  await t.step('a grantor cannot hand on what they do not hold', async () => {
    const r = await t.eval(async (x)=>{
      /* somebody who may manage users but holds no capabilities at all */
      const weak = {id: uid('TM'), name:'ZZ Weak Grantor', role:'Manager', email:'weak@finowise.in',
        status:'Active', scope:'own', perms: fullPerms(false), adminFlags:{manageUsers:1},
        createdAt:new Date().toISOString()};
      MODULES.forEach(m=>{ weak.perms[m].view = 1; });
      const target = {id: uid('TM'), name:'ZZ Weak Target', role:'Manager', email:'wt@finowise.in',
        status:'Active', scope:'own', perms:{}, adminFlags:{}, createdAt:new Date().toISOString()};
      DB.team.push(weak, target); await save('team');
      const was = currentUser; currentUser = weak.id;
      window._accessCopy = {}; accessCopyToggle(target.id);
      await applyAccessCopy(x.souvik);
      currentUser = was;
      const t2 = DB.team.find(y=>y.id === target.id);
      return {view: !!(t2.perms.CMS && t2.perms.CMS.view), edit: !!(t2.perms.CMS && t2.perms.CMS.edit),
        caps: ADMIN_FLAGS.filter(f=>t2.adminFlags[f]).length};
    }, ids);
    if(!r.view) throw new Error('nothing was copied at all');
    if(r.edit) throw new Error('a grantor passed on an Edit they do not hold');
    if(r.caps) throw new Error('a grantor passed on ' + r.caps + ' capabilit(ies) they do not hold');
    const said = t.dialogs.map(String).join(' ');
    if(!/were not passed on because you do not hold them yourself/.test(said))
      throw new Error('it did not say what it had to leave out');
    return 'View came across, Edit and the capabilities did not, and it said so';
  });

  await t.step('and the copy is on the audit trail, one line per account', async () => {
    const r = await t.eval(()=>({
      lines: DB.auditLog.filter(a=>/^Access copied from/.test(a.action || '')).length,
      names: DB.auditLog.filter(a=>/^Access copied from/.test(a.action || ''))
        .map(a=>(a.details || []).find(d=>d.field === 'Copied from')).filter(Boolean).length,
    }));
    if(r.lines < 4) throw new Error('only ' + r.lines + ' line(s) on the trail');
    if(r.names !== r.lines) throw new Error('a line does not say who it was copied from');
    return r.lines + ' lines, each naming the account it was copied from and what changed';
  });
});
