/* MOVING A RECORD ALONG ITS OWN WORKFLOW IS THE WORK, NOT A PRIVILEGE.

   Change stage was granted module by module like any other action, and
   so it was simply forgotten: a Senior Executive could open a client
   that was theirs, see the whole onboarding spine drawn across the top
   of it, and read "Read-only — no Change Stage access on CMS". Nothing
   on the screen said who could give it to them, and the account had to
   be edited one module at a time to fix it.

   It is now on for every module somebody can see — every module there
   is today and any added later, with no list to keep — and an
   administrator takes it away by unticking it, which is written down as
   a deny rather than as an absence, because on an account nobody has
   edited a blank box has to be able to mean "nobody has said".

   What a move REQUIRES is untouched, and that is the half worth proving
   hardest: the stages they are allowed, the mandatory fields on a step,
   and every other guard are still checked when the button is pressed. */
const {suite} = require('../lib/harness');

/* Run something as somebody else, the way the app sees them. */
const AS = `(id, fn) => { const was = currentUser; currentUser = id; try { return fn(); } finally { currentUser = was; } }`;

suite(async t => {
  await t.home();
  let who = null;

  await t.step('an account nobody has edited: three modules, no Change stage anywhere', async () => {
    who = await t.eval(async ()=>{
      const m = {id: uid('TM'), name:'ZZ Stage Tester', role:(roleList().find(r=>r !== 'Admin') || 'Manager'),
        email:'zzstage@example.com', scope:'all', adminFlags:{},
        perms:{LMS:{view:1, edit:1}, CMS:{view:1, edit:1}, RMS:{view:1, edit:1}},
        createdAt:new Date().toISOString()};
      DB.team.push(m); await save('team');
      return m.id;
    });
    const r = await t.eval(x=>({stored: JSON.stringify((DB.team.find(m=>m.id===x)||{}).perms),
      off: (DB.team.find(m=>m.id===x)||{}).permsOff || null}), who);
    if(/changeStage/.test(r.stored)) throw new Error('the fixture already grants it');
    if(r.off) throw new Error('the fixture already denies it');
    return 'LMS, CMS and RMS with view and edit, and not one word about stages';
  });

  t.section('what they can do with it');

  await t.step('they may move a record in LMS, CMS and RMS without anything being granted', async () => {
    const r = await t.eval((a)=>eval('(' + a.AS + ')')(a.who, ()=>({
      lms: can('LMS','changeStage'), cms: can('CMS','changeStage'), rms: can('RMS','changeStage'),
      ticked: JSON.stringify((me().perms || {}).CMS || {}),
    })), {AS, who});
    if(!r.lms || !r.cms || !r.rms)
      throw new Error('still refused: ' + JSON.stringify(r));
    if(/changeStage/.test(r.ticked)) throw new Error('something granted it after all: ' + r.ticked);
    return 'LMS, CMS and RMS all move, and nothing on the account says a word about stages';
  });

  await t.step('it is every module, so one added later needs no setting up either', async () => {
    const r = await t.eval((a)=>eval('(' + a.AS + ')')(a.who, ()=>({
      moves: MODULES.filter(m=>can(m,'changeStage')),
      all: MODULES.length,
      /* and the module switch still shuts one, for everything in it */
      shut: (()=>{ DB.config.moduleRoles = {Projects:['Admin']};
        const out = can('Projects','changeStage'); DB.config.moduleRoles = {}; return out; })(),
    })), {AS, who});
    if(r.moves.length !== r.all)
      throw new Error('only ' + r.moves.length + ' of ' + r.all + ' modules: ' + r.moves.join(','));
    if(r.shut) throw new Error('a module closed to their role still moved');
    return 'all ' + r.all + ' modules, with no permission written anywhere — and a module closed to the '
      + 'role is still closed';
  });

  await t.step('the record itself offers the step instead of saying read-only', async () => {
    const r = await t.eval((a)=>eval('(' + a.AS + ')')(a.who, ()=>{
      const c = {id: uid('CMS'), cmsName:'ZZ Stage Client', cmsStage:'clientCreated',
        rmName: a.who, branch:'Varanasi'};
      DB.clients.push(c);
      const html = blueprintWidget('CMS', c, {});
      return {readOnly: /Read-only/.test(html), steps: (html.match(/doTransition\(/g) || []).length, id: c.id};
    }), {AS, who});
    if(r.readOnly) throw new Error('the panel is still read-only');
    if(!r.steps) throw new Error('no step is offered on the panel');
    return r.steps + ' step(s) on the client that was read-only before';
  });

  t.section('and what it still will not let them do');

  await t.step('a step that needs a field still stops for the field', async () => {
    const r = await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.who;
      try {
        const c = {id: uid('CMS'), cmsName:'ZZ Stage Needs Field', cmsStage:'familyMapping', rmName: a.who};
        DB.clients.push(c);
        const before = stateOf('CMS', c);
        await doTransition('CMS', c.id, 'familyMember');   // requires familyHeadLookup
        const after = stateOf('CMS', DB.clients.find(x=>x.id===c.id));
        const modal = document.querySelector('.modal');
        const asks = modal ? /Family Head|before this step|needs/i.test(modal.textContent) : false;
        if(modal) closeModal();
        return {before, after, asks};
      } finally { currentUser = was; }
    }, {who});
    if(r.after !== r.before)
      throw new Error('the record moved to ' + r.after + ' without the field it requires');
    if(!r.asks) throw new Error('nothing asked for the missing field');
    return 'held at ' + r.before + ' and asked for what the step requires';
  });

  await t.step('a stage their account is not allowed is still refused', async () => {
    const r = await t.eval(async (a)=>{
      const m = DB.team.find(x=>x.id === a.who);
      const bp = getBlueprint('CMS');
      const cur = 'clientCreated';
      const step = bp.transitions.find(x=>x.from === cur && x.kind === 'forward');
      /* allowed every stage except the one this step leads to */
      m.stagePerms = {CMS: bp.states.map(s=>s.id).filter(id=>id !== step.to)};
      await save('team');
      const was = currentUser; currentUser = a.who;
      try {
        const c = {id: uid('CMS'), cmsName:'ZZ Stage Not Allowed', cmsStage: cur, rmName: a.who};
        DB.clients.push(c);
        const mayMove = can('CMS','changeStage');
        await doTransition('CMS', c.id, step.id);
        const after = stateOf('CMS', DB.clients.find(x=>x.id === c.id));
        /* The refusal is a card, because it carries the way to ask. */
        const said = ((document.querySelector('.modal') || {}).textContent || '').replace(/\s+/g, ' ');
        closeModal();
        return {mayMove, cur, to: step.to, after, said};
      } finally {
        currentUser = was;
        m.stagePerms = {}; await save('team');
      }
    }, {who});
    if(!r.mayMove) throw new Error('the account lost Change stage altogether');
    if(r.after !== r.cur) throw new Error('it moved to ' + r.after + ' — the stage list was not consulted');
    if(!/not among the ones your account is allowed/.test(r.said))
      throw new Error('nothing said why: ' + r.said.slice(0, 160));
    return 'may move a CMS record, but not into "' + r.to + '" — and it says so';
  });

  await t.step('and it does not wait on a View tick nobody ever had to make', async () => {
    /* A client's page has no View gate on it, so an account that opens
       records every day may never have had that one box ticked. Hanging
       the default off it showed those accounts a read-only workflow
       under a message saying somebody had turned it off. Nobody had. */
    const r = await t.eval(async (a)=>{
      const m = {id: uid('TM'), name:'ZZ No View Tick', role: roleOf(DB.team.find(x=>x.id === a.who)),
        email:'zznoview@example.in', status:'Active', scope:'all', adminFlags:{},
        perms:{CMS:{edit:1}}, createdAt:new Date().toISOString()};
      DB.team.push(m); await save('team');
      const c = {id: uid('CMS'), cmsName:'ZZ No View Client', cmsStage:'clientCreated', rmName: m.id};
      DB.clients.push(c);
      const was = currentUser; currentUser = m.id;
      const out = {view: can('CMS','view'), may: can('CMS','changeStage'),
        opens: !/Read-only/.test(blueprintWidget('CMS', c, {})),
        why: (stageChangeBlock('CMS') || {}).why || ''};
      currentUser = was;
      return out;
    }, {who});
    if(r.view) throw new Error('the fixture has the View tick after all');
    if(!r.may) throw new Error('an account with no View tick is still refused: ' + r.why);
    if(!r.opens) throw new Error('the panel is still read-only for them');
    return 'no View tick, and the workflow still moves — only a deny or a closed module stops it';
  });

  await t.step('and when it is refused, it says which rule refused', async () => {
    const r = await t.eval(async (a)=>{
      const m = DB.team.find(x=>x.id === a.who);
      const c = DB.clients.find(x=>/^ZZ Stage Client$/.test(x.cmsName || ''));
      const kept = m.permsOff;
      m.permsOff = {CMS:{changeStage:1}};
      const was = currentUser; currentUser = a.who;
      const denied = (stageChangeBlock('CMS') || {}).why || '';
      m.permsOff = kept;
      /* and the other reason: the module shut to the role */
      DB.config.moduleRoles = {CMS:['Admin']};
      const closed = (stageChangeBlock('CMS') || {}).why || '';
      const panel = blueprintWidget('CMS', c, {});
      DB.config.moduleRoles = {};
      currentUser = was;
      return {denied, closed, onPanel: /closed to the/.test(panel)};
    }, {who});
    if(!/turned off for your account/.test(r.denied))
      throw new Error('a deny does not say it is a deny: ' + r.denied);
    if(!/closed to the/.test(r.closed) || !/Module access/.test(r.closed))
      throw new Error('a closed module does not say so, or does not say where: ' + r.closed);
    if(!r.onPanel) throw new Error('the record itself still gives the one generic sentence');
    return 'two different refusals, two different sentences, each naming where it is undone';
  });

  await t.step('a deny the panel wrote by itself is cleared, a deliberate one is kept', async () => {
    const r = await t.eval(async ()=>{
      const role = roleList().find(x=>x !== 'Admin') || 'Manager';
      const a = {id: uid('TM'), name:'ZZ Accidental', role, email:'zzacc@example.in', status:'Active',
        scope:'own', adminFlags:{}, perms:{CMS:{edit:1}},       // no View tick on CMS
        permsOff:{CMS:{changeStage:1}}, createdAt:new Date().toISOString()};
      const b = {id: uid('TM'), name:'ZZ Deliberate', role, email:'zzdel@example.in', status:'Active',
        scope:'own', adminFlags:{}, perms:{CMS:{view:1, edit:1}},   // works in CMS, and was denied
        permsOff:{CMS:{changeStage:1}}, createdAt:new Date().toISOString()};
      DB.team.push(a, b); await save('team');
      delete DB.config.stageDenySweep;
      const n = await clearAccidentalStageDenies();
      const ran = await clearAccidentalStageDenies();     // and only once
      const look = id => { const was = currentUser; currentUser = id;
        const out = can('CMS','changeStage'); currentUser = was; return out; };
      return {n, ran, accidental: look(a.id), deliberate: look(b.id),
        audited: (DB.settingsAudit || []).some(x=>x.key === 'perm.stageDenySweep')};
    });
    if(r.n !== 1) throw new Error('it cleared ' + r.n + ' deny(s), expected 1');
    if(r.ran !== 0) throw new Error('it ran a second time');
    if(!r.accidental) throw new Error('the accidental deny is still in force');
    if(r.deliberate) throw new Error('a deliberate deny was cleared too');
    if(!r.audited) throw new Error('the sweep is not in the settings audit');
    return 'one cleared, one kept, written down, and it does not run again';
  });

  t.section('an administrator can still take it away');

  await t.step('unticking it on one module is written down as a deny', async () => {
    const r = await t.eval(async (x)=>{
      openPermissions(x);
      permDefaultToggle('CMS', 'changeStage', false);
      const boxAfter = document.getElementById('perm_CMS_changeStage').checked;
      await savePermissions(x, {quiet:true});
      closeModal();
      const m = DB.team.find(t2=>t2.id === x);
      return {boxAfter, off: JSON.parse(JSON.stringify(m.permsOff || {})),
        stillSeesCms: !!(m.perms.CMS && m.perms.CMS.view)};
    }, who);
    if(r.boxAfter) throw new Error('the box did not come off');
    if(!(r.off.CMS && r.off.CMS.changeStage)) throw new Error('nothing was written down: ' + JSON.stringify(r.off));
    if(r.off.LMS) throw new Error('it was taken off LMS too: ' + JSON.stringify(r.off));
    if(!r.stillSeesCms) throw new Error('unticking the stage box closed the module');
    return 'CMS only — they still see the module, they just cannot move its records';
  });

  await t.step('and that is what the record, and the profile card, now say', async () => {
    const r = await t.eval((a)=>eval('(' + a.AS + ')')(a.who, ()=>{
      const c = DB.clients.find(x=>/^ZZ Stage Client$/.test(x.cmsName || ''));
      const html = blueprintWidget('CMS', c, {});
      const lead = {id: uid('LEAD'), firstName:'ZZ Stage', lastName:'Lead', assignedTo: a.who};
      initState('LMS', lead);
      DB.leads.push(lead);
      const lhtml = blueprintWidget('LMS', lead, {});
      const card = userProfileHtml(DB.team.find(x=>x.id === a.who));
      return {cms: can('CMS','changeStage'), lms: can('LMS','changeStage'),
        cmsPanel: /turned off for your account/.test(html),
        /* the first LMS step opens the scheduling card rather than moving
           the stage on the spot, so what is asserted is that the step is
           offered at all */
        lmsSteps: /Read-only/.test(lhtml) ? 0 : (lhtml.match(/<button/g) || []).length,
        cardSays: /taken away on[^<]*CMS/.test(card)};
    }), {AS, who});
    if(r.cms) throw new Error('can() still allows CMS');
    if(!r.lms) throw new Error('LMS lost it as well');
    if(!r.cmsPanel) throw new Error('the CMS panel does not say it was turned off');
    if(!r.lmsSteps) throw new Error('the LMS panel offers no step');
    if(!r.cardSays) throw new Error('the profile card does not name the module it was taken away on');
    return 'CMS read-only and says why, LMS untouched, and the profile card names CMS';
  });

  await t.step('giving them a new module gives them its workflow with it', async () => {
    const r = await t.eval(async (x)=>{
      openPermissions(x);
      document.getElementById('perm_Meetings_view').checked = true;
      permRefresh();
      const boxLit = document.getElementById('perm_Meetings_changeStage').checked;
      await savePermissions(x, {quiet:true});
      closeModal();
      const m = DB.team.find(t2=>t2.id === x);
      const was = currentUser; currentUser = x;
      const out = {boxLit, may: can('Meetings','changeStage'), cms: can('CMS','changeStage'),
        off: JSON.parse(JSON.stringify(m.permsOff || {}))};
      currentUser = was;
      return out;
    }, who);
    if(!r.boxLit) throw new Error('ticking View did not light up Change stage');
    if(!r.may) throw new Error('the new module came without it');
    if(r.cms) throw new Error('the earlier deny on CMS was lost');
    if(r.off.Meetings) throw new Error('a deny was written for the module just granted');
    return 'Meetings came with its workflow; the deny on CMS survived the same save';
  });

  await t.step('a role template carries the restriction to everybody put on that role', async () => {
    const r = await t.eval(async ()=>{
      const role = roleList().find(x=>x !== 'Admin') || 'Manager';
      DB.config.roleTemplates = Object.assign({}, roleTemplates());
      DB.config.roleTemplates[role] = {perms: fullPerms(true), adminFlags: fullAdminFlags(false),
        scope:'own', pagePerms:[], stagePerms:{}, permsOff:{RMS:{changeStage:1}}};
      await save('config');
      const m = {id: uid('TM'), name:'ZZ Role Stage', role, email:'zzrolestage@example.com',
        scope:'own', adminFlags:{}, createdAt:new Date().toISOString()};
      const a = roleTemplateAccess(role);
      m.perms = JSON.parse(JSON.stringify(a.perms));
      m.permsOff = JSON.parse(JSON.stringify(a.permsOff || {}));
      DB.team.push(m); await save('team');
      const was = currentUser; currentUser = m.id;
      const out = {rms: can('RMS','changeStage'), cms: can('CMS','changeStage'),
        deviation: (roleDeviation(m) || {}).n};
      currentUser = was;
      return out;
    });
    if(r.rms) throw new Error('the template denied RMS and the account still holds it');
    if(!r.cms) throw new Error('the template took it off everything');
    if(r.deviation) throw new Error('the account reads as ' + r.deviation
      + ' difference(s) from its own template');
    return 'RMS off, CMS on, and the account matches its template exactly';
  });

  await t.step('an admin is never restricted by any of it', async () => {
    const r = await t.eval(()=>{
      const admin = DB.team.find(x=>isAdmin(x));
      if(!admin) return {skip:true};
      admin.permsOff = {CMS:{changeStage:1}};
      const was = currentUser; currentUser = admin.id;
      const out = {cms: can('CMS','changeStage')};
      currentUser = was;
      delete admin.permsOff;
      return out;
    });
    if(r.skip) return 'no admin in this store to check';
    if(!r.cms) throw new Error('an admin was locked out of moving a record');
    return 'a deny written against an admin changes nothing, as with every other permission';
  });
});
