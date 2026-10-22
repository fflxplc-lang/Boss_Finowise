/* ONE SCREEN FOR AN ACCOUNT AND EVERYTHING IT MAY DO.

   A sub-user used to be made in Team Members, then opened, then given
   access from Manage Access. Three screens, and the account existed in
   between with whatever the defaults were. This is the one screen.

   What is worth proving is not that the form draws. It is that the
   account comes out of it with exactly what was on the screen, that
   the two new grains — a page, a stage — are enforced where it counts
   rather than on the buttons that offer them, and that an account with
   nothing named is unrestricted, because that is every account that
   already exists. */
const {suite} = require('../lib/harness');
const SCOPES_JOINED = 'own,team,branch,all';

const onServer = async (t, key) => t.eval(async (k)=>{
  const res = await fetch('/api/storage/' + encodeURIComponent(k), {headers: apiHeaders()});
  if(res.status === 404) return null;
  if(!res.ok) throw new Error('storage get failed: ' + res.status);
  return JSON.parse((await res.json()).value);
}, key);

suite(async t => {
  let made = null;

  await t.step('Setup carries one screen for users, with the add button on it', async () => {
    await t.eval(()=>{ navigate('settings','usermanagement'); });
    await t.wait(400);
    const r = await t.eval(()=>{
      const c = document.getElementById('content');
      return {here: /Everyone who signs in/.test(c.textContent),
              create: /openSubUser\(\)/.test(c.innerHTML),
              lists: c.querySelector('table tbody').querySelectorAll('tr').length,
              team: DB.team.filter(x=>!x.deletedAt).length,
              /* The roles section, found by its control rather than by a
                 sentence: the words are the firm's to change. */
              roles: /addRole\(\)/.test(c.innerHTML),
              says: /Nothing is created until/.test(c.textContent)};
    });
    if(!r.here || !r.create) throw new Error('the screen or the add button is missing');
    if(r.lists !== r.team) throw new Error('it lists ' + r.lists + ' of ' + r.team + ' accounts');
    if(!r.says) throw new Error('it does not say the account waits for the one button');
    if(!r.roles) throw new Error('roles are not on the same screen, so there are still two');
    return 'Setup \u203a User & Access Management, listing ' + r.team + ' account(s), roles below them';
  });

  await t.step('and the three old doors onto the same people all land on it', async () => {
    const r = await t.eval(()=>{
      const tabs = [];
      SETTINGS_CATEGORIES.forEach(c=>c.tabs.forEach(tb=>tabs.push(tb[0])));
      const land = id => { settingsTab = id; navigate('settings'); return settingsTab; };
      return {gone: ['team','roles'].filter(x=>tabs.indexOf(x) >= 0),
              once: tabs.filter(x=>x === 'usermanagement').length,
              team: land('team'), roles: land('roles'),
              viaRoute: (navigate('team'), settingsTab),
              noViewTeam: typeof window.viewTeam === 'undefined',
              permGoesThere: /openSubUser/.test(String(openPermissions))};
    });
    if(r.gone.length) throw new Error('still its own Setup entry: ' + r.gone.join(', '));
    if(r.once !== 1) throw new Error('Users & Access appears ' + r.once + ' times in Setup');
    if(r.team !== 'usermanagement' || r.roles !== 'usermanagement') throw new Error('an old name lands on ' + r.team + ' / ' + r.roles);
    if(r.viaRoute !== 'usermanagement') throw new Error("navigate('team') lands on " + r.viaRoute);
    if(!r.noViewTeam) throw new Error('the second member list is still in the file');
    if(!r.permGoesThere) throw new Error('the old permission dialog is still a dialog of its own');
    return 'team, roles and the old permission dialog all open the one screen';
  });

  await t.step('the dialog reads the system, not a list somebody typed', async () => {
    const r = await t.eval(()=>{
      openSubUser();
      const b = document.getElementById('subBody');
      const cats = Array.from(b.querySelectorAll('details > summary')).map(x=>x.textContent.trim().slice(0,30));
      const perMod = MODULES.filter(m=>ACTIONS.every(a=>document.getElementById('perm_' + m + '_' + a))).length;
      const pages = [].concat.apply([], NAV_GROUPS.map(g=>g.items||[]));
      const pageChips = Array.from(b.querySelectorAll('button[onclick^="subTogglePage"]')).length;
      const stageChips = Array.from(b.querySelectorAll('button[onclick^="subToggleStage"]')).length;
      const stages = Object.keys(BLUEPRINTS).reduce((n,m)=>n + getBlueprint(m).states.length, 0);
      const caps = ADMIN_FLAGS.concat(USER_FLAGS).filter(f=>document.getElementById('adm_' + f)).length;
      const scopes = Array.from(b.querySelectorAll('button[onclick^="subSetScope"]')).length;
      const name = !!document.getElementById('f_name');
      closeModal();
      return {cats, perMod, modules: MODULES.length, pageChips, pages: pages.length,
              stageChips, stages, caps, allCaps: ADMIN_FLAGS.length + USER_FLAGS.length,
              scopes, allScopes: SCOPES.length, name};
    });
    if(!r.name) throw new Error('the details form is not on the screen');
    /* seven now: HR carries its own, because HR access is its own */
    if(r.cats.length !== 7) throw new Error('categories: ' + r.cats.join(' | '));
    if(!r.cats.some(c=>/^HR/.test(c))) throw new Error('no HR category: ' + r.cats.join(' | '));
    if(r.perMod !== r.modules) throw new Error(r.perMod + ' of ' + r.modules + ' modules have a full action row');
    if(r.pageChips !== r.pages) throw new Error(r.pageChips + ' page chips for ' + r.pages + ' rail pages');
    if(r.stageChips !== r.stages) throw new Error(r.stageChips + ' stage chips for ' + r.stages + ' stages');
    if(r.caps !== r.allCaps) throw new Error(r.caps + ' of ' + r.allCaps + ' capabilities');
    if(r.scopes !== r.allScopes) throw new Error(r.scopes + ' of ' + r.allScopes + ' scopes');
    return r.modules + ' modules, ' + r.pages + ' pages, ' + r.stages + ' stages, '
      + r.caps + ' capabilities and ' + r.scopes + ' scopes — every one read from the system';
  });

  await t.step('nothing on the screen reads like a database column', async () => {
    const r = await t.eval(()=>{
      openSubUser();
      const b = document.getElementById('subBody');
      /* the developer-written template cards are gone from here entirely */
      const cards = b.querySelectorAll('.tpl-card, .tpl-pick').length;
      /* every action says what it is, and the four nothing reads say so */
      const actionsNoted = ACTIONS.filter(a=>PERM_NOTES[a] && PERM_NOTES[a].length > 20);
      const warned = Object.keys(PERM_NOT_WIRED).filter(a=>b.textContent.indexOf(PERM_NOT_WIRED[a]) >= 0);
      /* every capability has a name and a line */
      const capNamed = ADMIN_FLAGS.concat(USER_FLAGS).filter(f=>{
        const lbl = ADMIN_FLAG_LABELS[f] || USER_FLAG_LABELS[f];
        const note = ADMIN_FLAG_NOTES[f] || USER_FLAG_NOTES[f];
        return lbl && !/^manage[A-Z]/.test(lbl) && note && note.length > 20
          && b.textContent.indexOf(lbl) >= 0 && b.textContent.indexOf(note) >= 0;
      });
      /* the raw own/team/branch/all dropdown is not duplicated here */
      const rawScope = !!document.getElementById('f_scope');
      const scopeChips = b.querySelectorAll('button[onclick^="subSetScope"]').length;
      const chipWords = Array.from(b.querySelectorAll('button[onclick^="subSetScope"]'))
        .map(x=>x.textContent.replace('\u2713','').trim());
      closeModal();
      return {cards, actionsNoted: actionsNoted.length, actions: ACTIONS.length,
              warned: warned.length, notWired: Object.keys(PERM_NOT_WIRED).length,
              capNamed: capNamed.length, caps: ADMIN_FLAGS.length + USER_FLAGS.length,
              rawScope, scopeChips, chipWords, scopes: SCOPES.slice()};
    });
    if(r.cards) throw new Error('the template cards are still on the account panel');
    if(r.actionsNoted !== r.actions) throw new Error(r.actionsNoted + ' of ' + r.actions + ' actions carry a line');
    if(r.warned !== r.notWired) throw new Error(r.warned + ' of ' + r.notWired + ' unwired actions say so');
    if(r.capNamed !== r.caps) throw new Error(r.capNamed + ' of ' + r.caps + ' capabilities are named and explained');
    if(r.rawScope) throw new Error('the raw scope dropdown is still duplicated in the details form');
    if(r.scopeChips !== 4) throw new Error(r.scopeChips + ' scope chips');
    if(r.chipWords.some(w=>r.scopes.indexOf(w) >= 0))
      throw new Error('a scope still reads as its stored key: ' + r.chipWords.join(', '));
    return 'no template cards, ' + r.actions + ' actions explained ('
      + r.notWired + ' marked as not yet read), ' + r.caps + ' capabilities named, scope in words';
  });

  await t.step('and the scope dropdown elsewhere reads in words too', async () => {
    const r = await t.eval(()=>{
      /* the detail form, which only edits somebody who already exists —
         creating one is Setup's job now */
      openMemberForm((DB.team.find(x=>!x.deletedAt) || {}).id);
      /* The field is a box you type into now, so what it offers is the
         picker's rows rather than a select's options. */
      const el = document.getElementById('f_scope');
      const rows = el ? (window._pickRows['f_scope'] || []) : [];
      const words = rows.map(o=>o.value + '=' + o.label);
      const values = rows.map(o=>o.value).filter(Boolean);
      closeModal();
      return {words, values};
    });
    if(r.values.join(',') !== SCOPES_JOINED) throw new Error('the stored values changed: ' + r.values.join(','));
    if(r.words.some(w=>/^(own|team|branch|all)=\1$/.test(w)))
      throw new Error('an option still shows its key: ' + r.words.join(' | '));
    return 'Team Members shows the same words, and still stores own / team / branch / all';
  });

  await t.step('one press makes the account and applies the access', async () => {
    made = await t.eval(async ()=>{
      /* The firm's own default for the role, set once in Setup. Which
         role is not the point and the roles are the firm's to change,
         so it takes whichever one is there rather than naming one. */
      const role = roleList().find(r=>r !== ADMIN_ROLE);
      DB.config.roleTemplates = Object.assign({}, DB.config.roleTemplates || {});
      const p = fullPerms(false, {view:1});
      ['LMS','CMS','RMS','DST'].forEach(m=>['view','create','edit','changeStage'].forEach(a=>{ p[m][a] = 1; }));
      DB.config.roleTemplates[role] =
        {perms:p, adminFlags: fullAdminFlags(false), scope:'own', pagePerms:[], stagePerms:{}};
      await save('config');
      openSubUser();
      document.getElementById('f_name').value = 'ZZ One Screen';
      document.getElementById('f_email').value = 'zzonescreen@example.in';
      const roleBox = document.getElementById('f_role');
      roleBox.value = role;
      roleBox.dispatchEvent(new Event('change'));
      /* narrow it further than the template, on the same screen */
      subSetScope('team');
      ['lms','cms'].forEach(v=>subTogglePage(v));
      ['created','warmUpCallScheduled'].forEach(s=>subToggleStage('LMS', s));
      document.getElementById('perm_CMS_delete').checked = true;
      permRefresh();
      const before = DB.team.length;
      await saveSubUser();
      const t2 = DB.team.find(x=>x.name === 'ZZ One Screen');
      return {id: t2 && t2.id, before, after: DB.team.length,
              scope: (t2||{}).scope, pages: (t2||{}).pagePerms, stages: (t2||{}).stagePerms,
              lmsView: !!((t2||{}).perms||{}).LMS && !!t2.perms.LMS.view,
              cmsDelete: !!(((t2||{}).perms||{}).CMS||{}).delete,
              mastersView: !!(((t2||{}).perms||{}).Masters||{}).view,
              open: document.getElementById('overlay').classList.contains('show')};
    });
    if(!made.id) throw new Error('no account came out of it');
    if(made.after !== made.before + 1) throw new Error('it made ' + (made.after - made.before) + ' accounts');
    if(made.scope !== 'team') throw new Error('the scope is ' + made.scope);
    if((made.pages||[]).sort().join(',') !== 'cms,lms') throw new Error('pages: ' + (made.pages||[]).join(', '));
    if(((made.stages||{}).LMS||[]).length !== 2) throw new Error('stages: ' + JSON.stringify(made.stages));
    if(!made.lmsView) throw new Error('the role template did not reach the record');
    if(!made.cmsDelete) throw new Error('the hand-made change on top of the template was lost');
    if(made.mastersView === false) throw new Error('an untouched module lost its default view');
    if(made.open) throw new Error('the dialog is still open afterwards');
    await t.wait(400);
    const team = await onServer(t, 'team');
    const saved = (team||[]).find(x=>x.id === made.id);
    if(!saved) throw new Error('it never reached the server');
    if(saved.scope !== 'team' || !saved.pagePerms.length) throw new Error('the server copy is missing the access');
    return 'one account, its details, its permissions, its pages, its stages and its scope — one press';
  });

  t.section('and the two finer grains are enforced, not decorative');

  await t.step('a page that was not named is not reachable, even by route', async () => {
    const r = await t.eval(async (id)=>{
      const was = currentUser;
      currentUser = id;
      navigate('rms');                      // not among the two they were given
      const blocked = currentView;
      /* The refusal is a card rather than an alert now: it carries the
         way to ask for the page as well as the news that it is shut. */
      const said = (document.querySelector('.modal') || {}).textContent || '';
      closeModal();
      navigate('lms');                      // one they were given
      const allowed = currentView;
      currentUser = was;
      navigate('settings','usermanagement');
      return {blocked, allowed, said};
    }, made.id);
    if(r.blocked !== 'dashboard') throw new Error('an unnamed page opened: ' + r.blocked);
    if(!/not one of the ones your account is allowed/.test(r.said))
      throw new Error('it said "' + r.said.replace(/\s+/g, ' ').slice(0, 160) + '"');
    if(!/Request access/.test(r.said)) throw new Error('the refusal does not offer to ask for it');
    if(r.allowed !== 'lms') throw new Error('a named page did not open: ' + r.allowed);
    return 'the route itself bounces, and the named one opens';
  });

  await t.step('a stage that was not named cannot be moved into', async () => {
    const r = await t.eval(async (id)=>{
      const lead = {id:'ZZSTG', leadName:'ZZ Stage Lead', firstName:'ZZ', lastName:'Stage',
        email:'zzstage@example.in', assignedTo:id, createdAt:new Date().toISOString()};
      initState('LMS', lead);
      DB.leads.push(lead);
      await save('leads');
      const was = currentUser; currentUser = id;
      const bp = getBlueprint('LMS');
      const allowed = bp.transitions.find(x=>x.from === lead[RECORD_STATE_FIELD.LMS]
        && x.to === 'warmUpCallScheduled');
      await doTransition('LMS', 'ZZSTG', allowed.id);
      const afterAllowed = DB.leads.find(l=>l.id==='ZZSTG')[RECORD_STATE_FIELD.LMS];
      const next = bp.transitions.find(x=>x.from === afterAllowed && x.kind === 'forward');
      await doTransition('LMS', 'ZZSTG', next.id);
      const afterBlocked = DB.leads.find(l=>l.id==='ZZSTG')[RECORD_STATE_FIELD.LMS];
      const said = (document.querySelector('.modal') || {}).textContent || '';
      closeModal();
      currentUser = was;
      return {afterAllowed, afterBlocked, said, wanted: next.to};
    }, made.id);
    if(r.afterAllowed !== 'warmUpCallScheduled') throw new Error('a named stage was refused: ' + r.afterAllowed);
    if(r.afterBlocked !== 'warmUpCallScheduled')
      throw new Error('it moved into "' + r.afterBlocked + '", which was never named');
    if(!/not among the ones your account is allowed/.test(r.said))
      throw new Error('it said "' + r.said.replace(/\s+/g, ' ').slice(0, 160) + '"');
    return 'into a named stage yes, into the next one no, and the record did not move';
  });

  await t.step('an account with nothing named is restricted by nothing', async () => {
    const r = await t.eval(async ()=>{
      const m = {id:'ZZPLAIN', name:'ZZ Plain', email:'zzplain@example.in', role:'Manager',
        status:'Active', scope:'all', perms: fullPerms(true), adminFlags: fullAdminFlags(false),
        createdAt:new Date().toISOString()};
      DB.team.push(m); await save('team');
      const was = currentUser; currentUser = 'ZZPLAIN';
      const out = {pages: pageOpenToMe('rms') && pageOpenToMe('projects') && pageOpenToMe('mis'),
                   stages: stageOpenToMe('LMS','qualified') && stageOpenToMe('CMS','cifStage'),
                   noLists: !(m.pagePerms||[]).length && !Object.keys(m.stagePerms||{}).length};
      currentUser = was;
      return out;
    });
    if(!r.noLists) throw new Error('the fixture already carried a restriction');
    if(!r.pages) throw new Error('an account with no page list was shut out of a page');
    if(!r.stages) throw new Error('an account with no stage list was shut out of a stage');
    return 'empty means everything — so no account that already exists changed';
  });

  t.section('the role carries the default, and editing later');

  await t.step('picking a role fills the panel from the firm\u2019s own template', async () => {
    const r = await t.eval(async ()=>{
      /* Not the role the account above was made on, so the two steps
         cannot pass by sharing one template. */
      const used = roleList().find(x=>x !== ADMIN_ROLE);
      const role = roleList().find(x=>x !== ADMIN_ROLE && x !== used);
      const p = fullPerms(false);
      ['DST','Queries'].forEach(m=>['view','edit'].forEach(a=>{ p[m][a] = 1; }));
      DB.config.roleTemplates = Object.assign({}, DB.config.roleTemplates || {});
      DB.config.roleTemplates[role] = {perms:p, adminFlags: fullAdminFlags(false),
        scope:'branch', pagePerms:['dst'], stagePerms:{}};
      await save('config');
      const read = () => ({
        /* Change stage is held by everybody unless it is taken away, so
           it is ticked on every module and says nothing about where this
           person works. The count is of what the template gave. */
        mods: MODULES.filter(m=>ACTIONS.some(a=>!PERM_DEFAULT_ON[a]
          && (document.getElementById('perm_'+m+'_'+a)||{}).checked)).length,
        scope: subDraft().scope, pages: subDraft().pagePerms.slice()});
      openSubUser();
      const blank = read();
      const box = document.getElementById('f_role');
      box.value = role; box.dispatchEvent(new Event('change'));
      const filled = read();
      /* a role nobody has defined changes nothing and says so */
      const undef = roleList().find(x=>x !== ADMIN_ROLE && !((DB.config.roleTemplates||{})[x]));
      let saidNothing = true, unchanged = true;
      if(undef){
        box.value = undef; box.dispatchEvent(new Event('change'));
        saidNothing = /no default access saved/.test((document.getElementById('roleNote')||{}).textContent || '');
        unchanged = read().mods === filled.mods;
      }
      /* Admin is the fixed role and fills everything */
      box.value = ADMIN_ROLE; box.dispatchEvent(new Event('change'));
      const asAdmin = read();
      closeModal();
      return {role, blank, filled, asAdmin, undef, saidNothing, unchanged,
        allModules: MODULES.length, adminRole: ADMIN_ROLE,
        /* and the template itself was never written to by any of that */
        template: JSON.parse(JSON.stringify(DB.config.roleTemplates[role]))};
    });
    if(r.filled.mods !== 2) throw new Error('the role filled ' + r.filled.mods + ' modules, not 2');
    if(r.filled.scope !== 'branch') throw new Error('the scope did not come from the template');
    if(r.filled.pages.join(',') !== 'dst') throw new Error('the pages did not come from the template');
    if(r.undef && !r.saidNothing) throw new Error('an undefined role did not say it had no default');
    if(r.undef && !r.unchanged) throw new Error('an undefined role silently changed the panel');
    if(r.asAdmin.mods !== r.allModules)
      throw new Error(r.adminRole + ' filled ' + r.asAdmin.mods + ' of ' + r.allModules);
    if(r.template.scope !== 'branch' || r.template.pagePerms.join(',') !== 'dst')
      throw new Error('opening an account changed the company template');
    return r.blank.mods + ' modules on a blank panel \u2192 ' + r.filled.mods + ' once "' + r.role
      + '" is picked, with its scope and its pages \u2014 and the template itself untouched';
  });

  await t.step('changing one person never changes the template, and changing the template never changes them', async () => {
    const r = await t.eval(async ()=>{
      const used = roleList().find(x=>x !== ADMIN_ROLE);
      const role = roleList().find(x=>x !== ADMIN_ROLE && (DB.config.roleTemplates||{})[x]
        && x !== used);
      /* a person on that role, customised beyond the default */
      const who = {id: uid('USR'), name:'ZZ Role Holder', email:'zzrole@example.in', role,
        status:'Active', scope:'own', perms: fullPerms(false), adminFlags: fullAdminFlags(false),
        pagePerms:[], stagePerms:{}, createdAt:new Date().toISOString()};
      who.perms.DST.view = 1; who.perms.Queries.view = 1;   // what the template gave them
      who.perms.Projects.delete = 1;                        // the deliberate customisation
      DB.team.push(who); await save('team');
      const before = JSON.parse(JSON.stringify(DB.config.roleTemplates[role]));

      /* now the firm widens the template from the Setup screen */
      openRoleTemplate(role);
      document.getElementById('perm_Business_view').checked = true;
      document.getElementById('perm_Business_edit').checked = true;
      subSetScope('all');
      await saveRoleTemplate();
      const after = JSON.parse(JSON.stringify(DB.config.roleTemplates[role]));
      const held = DB.team.find(x=>x.id === who.id);

      /* and a brand new account on the same role picks the wider one up */
      openSubUser();
      const box = document.getElementById('f_role');
      box.value = role; box.dispatchEvent(new Event('change'));
      const fresh = {business: !!(document.getElementById('perm_Business_view')||{}).checked,
                     scope: subDraft().scope};
      closeModal();
      return {role, widened: !!after.perms.Business.view, wasWide: !!before.perms.Business.view,
        heldScope: held.scope, heldBusiness: !!held.perms.Business.view,
        keptCustom: !!held.perms.Projects.delete, fresh};
    });
    if(r.wasWide) throw new Error('the template already had it, so nothing was proved');
    if(!r.widened) throw new Error('the template did not save');
    if(r.heldBusiness) throw new Error('widening the template reached back into somebody already on the role');
    if(r.heldScope !== 'own') throw new Error('it overwrote their scope too');
    if(!r.keptCustom) throw new Error('their own customisation was lost');
    if(!r.fresh.business || r.fresh.scope !== 'all') throw new Error('a new account did not pick up the new default');
    return 'template widened \u2014 the person on it kept their own access and their customisation, '
      + 'and the next account on that role starts from the new default';
  });

  await t.step('the Setup screen lists every role the firm has, and says which are undefined', async () => {
    const r = await t.eval(()=>{
      navigate('settings', 'roletemplates');
      const c = document.getElementById('content');
      const rows = c.querySelectorAll('table tbody tr').length;
      const roles = roleList().length;
      const notSet = roleList().filter(x=>x !== ADMIN_ROLE && !((DB.config.roleTemplates||{})[x])).length;
      /* and a role added now is there to define now */
      DB.config.roles = roleList().concat(['ZZ Fresh Role']);
      navigate('settings', 'roletemplates');
      const after = document.getElementById('content').querySelectorAll('table tbody tr').length;
      const named = document.getElementById('content').textContent.indexOf('ZZ Fresh Role') >= 0;
      DB.config.roles = roleList().filter(x=>x !== 'ZZ Fresh Role');
      return {rows, roles, notSet, after, named,
        warnsAbout: notSet? /have no default access yet/.test(c.textContent) : true,
        adminFixed: /always everything/.test(c.textContent)};
    });
    if(r.rows !== r.roles) throw new Error('it lists ' + r.rows + ' of ' + r.roles + ' roles');
    if(r.after !== r.rows + 1 || !r.named) throw new Error('a role added now is not in the list');
    if(!r.warnsAbout) throw new Error('it does not say which roles have no default yet');
    if(!r.adminFixed) throw new Error('the fixed role is not marked as always holding everything');
    return r.roles + ' roles listed, ' + r.notSet + ' of them still undefined and said so, '
      + 'and a role created a second ago is already there';
  });

  await t.step('opening an existing account edits details and access together', async () => {
    const r = await t.eval(async (id)=>{
      openSubUser(id);
      const nameBox = document.getElementById('f_name');
      const loaded = nameBox.value;
      const scopeAtOpen = subDraft().scope;
      const pagesAtOpen = subDraft().pagePerms.slice();
      nameBox.value = 'ZZ One Screen Renamed';
      subSetScope('branch');
      subTogglePage('rms');
      document.getElementById('perm_LMS_delete').checked = true;
      permRefresh();
      await saveSubUser();
      const t2 = DB.team.find(x=>x.id === id);
      return {loaded, scopeAtOpen, pagesAtOpen, name: t2.name, scope: t2.scope,
              pages: t2.pagePerms.slice().sort(), del: !!t2.perms.LMS.delete,
              stagesKept: ((t2.stagePerms||{}).LMS||[]).length, n: DB.team.length};
    }, made.id);
    if(r.loaded !== 'ZZ One Screen') throw new Error('it opened with "' + r.loaded + '"');
    if(r.scopeAtOpen !== 'team') throw new Error('it opened with scope ' + r.scopeAtOpen);
    if(r.pagesAtOpen.length !== 2) throw new Error('it opened with ' + r.pagesAtOpen.length + ' pages');
    if(r.name !== 'ZZ One Screen Renamed') throw new Error('the detail change was lost');
    if(r.scope !== 'branch') throw new Error('the scope change was lost');
    if(r.pages.join(',') !== 'cms,lms,rms') throw new Error('pages: ' + r.pages.join(', '));
    if(!r.del) throw new Error('the permission change was lost');
    if(r.stagesKept !== 2) throw new Error('the stages it was not asked about were lost');
    return 'name, scope, a page and a permission changed in one save, the rest untouched';
  });

  t.section('the profile card');

  await t.step('clicking a name opens one card with everything on it', async () => {
    const r = await t.eval(async ()=>{
      /* somebody who is not the person reading the screen, so the actions
         that are deliberately withheld from your own account are not what
         is being counted */
      const who = {id: uid('USR'), name:'ZZ Card Subject', email:'zzcard@example.in',
        role: roleList().find(x=>x !== ADMIN_ROLE) || 'Manager', status:'Active', scope:'own',
        department:'Operations', designation:'Executive',
        perms: fullPerms(false, {view:1}), adminFlags: fullAdminFlags(false),
        pagePerms:[], stagePerms:{}, createdAt:new Date().toISOString()};
      DB.team.push(who); await save('team');
      navigate('settings', 'usermanagement');
      const link = Array.from(document.querySelectorAll('#content table tbody a[onclick^="openUserProfile"]'))
        .find(a=>a.getAttribute('onclick').indexOf(who.id) >= 0);
      const opensIt = !!link;
      if(link) link.click();
      const card = document.getElementById('userProfileCard');
      const text = card ? card.textContent : '';
      const want = ['What they may do', 'Sign-in Account', 'Reporting', 'Everything on record',
        'Account actions'];
      const actions = ['openSubUser', 'resendMemberCredentials', 'toggleMemberStatus',
        "navigate('teammembers'"];
      const out = {opensIt, drew: !!card, who: who.id,
        headings: want.filter(w=>text.indexOf(w) >= 0),
        wantHeadings: want.length,
        actions: actions.filter(a=>(card ? card.innerHTML : '').indexOf(a) >= 0).length,
        wantActions: actions.length,
        /* the person's own details, and the chips off their real work */
        named: text.indexOf(who.name) >= 0,
        role: text.indexOf(roleOf(who)) >= 0,
        chips: card ? card.querySelectorAll('.pending-chip').length : 0,
        /* and a value whose dropdown reads in words reads in words here too */
        scopeInWords: text.indexOf(SCOPE_LABEL[who.scope]) >= 0,
        scopeRaw: /Record Visibility Scope: *own\b/.test(text),
        groups: card ? card.querySelectorAll('.section-title').length : 0};
      closeUserProfile();
      out.closed = !document.getElementById('overlay').classList.contains('show') && !window._profileId;
      /* and the account you are signed in with withholds the two that would
         lock you out mid-sentence */
      openUserProfile(currentUser);
      const mine = document.getElementById('userProfileCard');
      out.selfSays = /this is you/.test(mine.textContent);
      out.selfNoDeactivate = mine.innerHTML.indexOf('toggleMemberStatus') < 0;
      closeUserProfile();
      DB.team = DB.team.filter(x=>x.id !== who.id); await save('team');
      return out;
    });
    if(!r.opensIt) throw new Error('the name is not a link');
    if(!r.drew) throw new Error('the card did not draw');
    if(r.headings.length !== r.wantHeadings)
      throw new Error('missing: ' + r.headings.join(', ') + ' of ' + r.wantHeadings);
    if(r.actions !== r.wantActions) throw new Error(r.actions + ' of ' + r.wantActions + ' actions offered');
    if(!r.named || !r.role) throw new Error('it does not say who it is about');
    if(r.chips < 5) throw new Error('only ' + r.chips + ' workload chips');
    if(!r.scopeInWords || r.scopeRaw) throw new Error('the scope still reads as its stored key');
    if(!r.closed) throw new Error('it would not close');
    if(!r.selfSays) throw new Error('your own card does not say it is you');
    if(!r.selfNoDeactivate) throw new Error('your own card offers to deactivate you');
    return r.wantHeadings + ' sections, ' + r.chips + ' workload figures and '
      + r.wantActions + ' account actions, without leaving the page \u2014 and your own card withholds '
      + 'the two that would lock you out';
  });

  await t.step('the password is never on the screen until somebody asks for it', async () => {
    const r = await t.eval(async ()=>{
      const who = DB.team.find(x=>!x.deletedAt);
      /* an account with a generated password nobody has used */
      accountCache.byMember[who.id] = {memberId: who.id, email: who.email, role:'admin', active:1,
        issuedPassword:'ZZSecret123', createdAt:'2026-01-01', lastLoginAt:null};
      window.CRM_IS_ADMIN = true;
      openUserProfile(who.id);
      const hidden = document.getElementById('userProfileCard').textContent;
      const auditBefore = DB.auditLog.length;
      await revealIssuedPassword(who.id);
      const shown = document.getElementById('userProfileCard').textContent;
      const entry = DB.auditLog[DB.auditLog.length-1] || {};
      await revealIssuedPassword(who.id);          // and back behind the dots
      const again = document.getElementById('userProfileCard').textContent;
      /* a password that has been used cannot be shown at all */
      accountCache.byMember[who.id].issuedPassword = null;
      accountCache.byMember[who.id].lastLoginAt = '2026-02-01';
      profileRedraw();
      const used = document.getElementById('userProfileCard').textContent;
      closeUserProfile();
      delete accountCache.byMember[who.id];
      return {hidden: hidden.indexOf('ZZSecret123') < 0,
        dots: /\u2022\u2022\u2022/.test(hidden),
        offersReveal: /Reveal it/.test(hidden),
        shown: shown.indexOf('ZZSecret123') >= 0,
        again: again.indexOf('ZZSecret123') < 0,
        audited: DB.auditLog.length > auditBefore && /Password Revealed/.test(entry.action || ''),
        usedSaysHash: /only a hash of it is kept/.test(used),
        canReset: /Issue a new password/.test(document.body.innerHTML) || true};
    });
    if(!r.hidden) throw new Error('the password was on the screen the moment the card opened');
    if(!r.dots || !r.offersReveal) throw new Error('it is not masked with a way to reveal it');
    if(!r.shown) throw new Error('revealing it did not show it');
    if(!r.again) throw new Error('it would not go back behind the dots');
    if(!r.audited) throw new Error('reading somebody\u2019s credentials was not recorded');
    if(!r.usedSaysHash) throw new Error('a password already in use does not say why it cannot be shown');
    return 'masked by default, revealed only on a press that goes in the audit trail, and once used there '
      + 'is only a hash to show';
  });

  await t.step('the card says how the account differs from its role\u2019s default', async () => {
    const r = await t.eval(async ()=>{
      const role = roleList().find(x=>x !== ADMIN_ROLE);
      const p = fullPerms(false);
      ['LMS','CMS'].forEach(m=>['view','edit'].forEach(a=>{ p[m][a] = 1; }));
      DB.config.roleTemplates = Object.assign({}, DB.config.roleTemplates || {});
      DB.config.roleTemplates[role] = {perms:p, adminFlags: fullAdminFlags(false), scope:'own',
        pagePerms:[], stagePerms:{}};
      await save('config');
      const twin = {id: uid('USR'), name:'ZZ Exact Match', email:'zzexact@example.in', role,
        status:'Active', scope:'own', perms: JSON.parse(JSON.stringify(p)),
        adminFlags: fullAdminFlags(false), pagePerms:[], stagePerms:{},
        createdAt:new Date().toISOString()};
      const odd = JSON.parse(JSON.stringify(twin));
      odd.id = uid('USR'); odd.name = 'ZZ Customised'; odd.email = 'zzodd@example.in';
      odd.perms.CMS.delete = 1;        // one more than the role says
      odd.perms.LMS.edit = 0;          // one fewer
      odd.scope = 'branch';            // and a wider view
      DB.team.push(twin, odd); await save('team');

      openUserProfile(twin.id);
      const same = document.getElementById('userProfileCard').textContent;
      closeUserProfile();
      openUserProfile(odd.id);
      const diff = document.getElementById('userProfileCard').textContent;
      const n = roleDeviation(odd).n;
      closeUserProfile();
      DB.team = DB.team.filter(x=>x.id !== twin.id && x.id !== odd.id); await save('team');
      return {sameSays: /Exactly the default/.test(same),
        diffSays: /difference\(s\)/.test(diff), n,
        namesExtra: /Delete/.test(diff), namesMissing: /Edit/.test(diff),
        namesScope: /where the role says/.test(diff)};
    });
    if(!r.sameSays) throw new Error('an account matching its role exactly was not said to match');
    if(!r.diffSays) throw new Error('a customised account was not flagged as different');
    if(r.n !== 3) throw new Error('it counted ' + r.n + ' differences, not 3');
    if(!r.namesExtra || !r.namesMissing || !r.namesScope)
      throw new Error('it does not name what is extra, what is missing and what the scope should be');
    return 'one account exactly on its default, another with 3 named differences \u2014 extra, missing and scope';
  });

  await t.step('the card follows the record while it is open', async () => {
    const r = await t.eval(()=>{
      const who = DB.team.find(x=>!x.deletedAt);
      openUserProfile(who.id);
      const before = document.getElementById('userProfileCard').textContent;
      /* Somebody else saves a change to the same person. A department is
         a mapping now, not a line of text, so the probe moves them into
         one the way the user dialog would — which is also what makes
         this worth testing: the card has to follow the mapping, not a
         copy of its name. */
      const wasDepts = (who.departments || []).slice(), wasName = who.department;
      const probe = {id:'DEP-ZZMOVED', name:'ZZ Moved Department', active:true,
        createdAt:new Date().toISOString()};
      DB.config.departments = deptAll().concat([probe]);
      setUserDepartments(who, [probe.id]);
      /* the live stream's own draw, which skips every other modal */
      liveDraw();
      const after = document.getElementById('userProfileCard').textContent;
      const stillOpen = !!document.getElementById('userProfileCard');
      setUserDepartments(who, wasDepts);
      who.department = wasName;
      DB.config.departments = deptAll().filter(d=>d.id !== probe.id);
      closeUserProfile();
      return {wasThere: before.indexOf('ZZ Moved Department') < 0,
        isThere: after.indexOf('ZZ Moved Department') >= 0, stillOpen};
    });
    if(!r.wasThere) throw new Error('the probe value was already on the card');
    if(!r.isThere) throw new Error('a change to the record did not reach the open card');
    if(!r.stillOpen) throw new Error('the redraw closed the card');
    return 'a change saved elsewhere appears on the open card, and the card stays open';
  });

  await t.step('every door marked \u201cadd\u201d leads to the one screen', async () => {
    const r = await t.eval(()=>{
      navigate('teammembers');
      const html = document.getElementById('content').innerHTML;
      const btn = Array.from(document.querySelectorAll('#content button'))
        .find(b=>/Add Team Member/.test(b.textContent));
      const out = {offered: !!btn, from: currentView};
      if(btn) btn.click();
      out.landedView = currentView;
      out.landedTab = settingsTab;
      out.noForm = !document.getElementById('overlay').classList.contains('show');
      /* the form itself, called the old way, goes to the same place */
      navigate('teammembers');
      openMemberForm();
      out.formView = currentView;
      out.formTab = settingsTab;
      /* and editing somebody who exists still opens the form, because that
         is the job it still owns */
      const who = DB.team.find(x=>!x.deletedAt);
      openMemberForm(who.id);
      out.editOpens = document.getElementById('overlay').classList.contains('show')
        && !!document.getElementById('f_name');
      closeModal();
      /* the Roles & Permissions button beside it lands somewhere real too */
      navigate('teammembers');
      const roles = Array.from(document.querySelectorAll('#content button'))
        .find(b=>/Roles & Permissions/.test(b.textContent));
      if(roles) roles.click();
      out.rolesTab = settingsTab;
      return out;
    });
    if(!r.offered) throw new Error('there is no Add Team Member button to press');
    if(r.landedView !== 'settings' || r.landedTab !== 'usermanagement')
      throw new Error('it landed on ' + r.landedView + ' / ' + r.landedTab);
    if(!r.noForm) throw new Error('it opened the old form as well');
    if(r.formView !== 'settings' || r.formTab !== 'usermanagement')
      throw new Error('openMemberForm() with no id still makes an account its own way');
    if(!r.editOpens) throw new Error('editing somebody who exists no longer opens the form');
    if(r.rolesTab !== 'usermanagement')
      throw new Error('Roles & Permissions lands on ' + r.rolesTab + ', not the screen that holds them');
    return 'the button and openMemberForm() both land on Setup \u203a Users & Access; editing an existing '
      + 'person still opens the detail form';
  });

  await t.step('nothing was alerted that was not a result', async () => {
    const odd = t.dialogs.filter(d=>!/now has exactly the access|Saved\.|Created\./.test(d));
    if(odd.length) throw new Error(odd.join(' | '));
    return t.dialogs.length + ' confirmation(s), no errors';
  });
});
