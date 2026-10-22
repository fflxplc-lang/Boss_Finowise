/* SETUP IS AN ADMINISTRATOR'S PAGE, AND WAS GATED AS ONE — NEARLY.

   Hold any one capability and the page appeared, which is right. What
   appeared on it was not: four screens carried no capability of their
   own, so Manage Users — a capability about people — also handed
   somebody Export, Import, Bulk Import and the Recycle Bin. A Senior
   Executive with one capability could take the whole database out of
   the building, and the firm found that out by looking at his screen.

   What this holds to: that every Setup screen now needs the capability
   it always claimed to need; that the menu is gone for an account that
   holds none; that typing the address does not get them in either, on
   the Setup page or on the Setup screens that are routes of their own;
   that an Admin can never be shut out; and that taking Setup away from
   a role leaves every other thing those accounts hold exactly as it
   was — their modules, their records and the workflow. */
const {suite} = require('../lib/harness');

const AS = `(id, fn) => { const was = currentUser; currentUser = id; try { return fn(); } finally { currentUser = was; } }`;

suite(async t => {
  await t.home();
  let who = null, mate = null;

  await t.step('an account with one capability, the way the firm had it', async () => {
    const r = await t.eval(async ()=>{
      const role = 'Senior Executive';
      if(roleList().indexOf(role) < 0){ DB.config.roles = roleList().concat([role]); await save('config'); }
      const mk = name => {
        const m = {id: uid('TM'), name, role, email: name.split(' ')[1].toLowerCase() + '@zz.in',
          status:'Active', scope:'own', adminFlags:{manageUsers:1}, branch:'Varanasi',
          perms:(()=>{ const p = fullPerms(false);
            ['LMS','CMS','RMS'].forEach(x=>['view','create','edit'].forEach(a=>{ p[x][a] = 1; }));
            return p; })(),
          createdAt:new Date().toISOString()};
        DB.team.push(m); return m.id;
      };
      const out = {who: mk('ZZ Shubham Seth'), mate: mk('ZZ Divya Shinde')};
      await save('team');
      return out;
    });
    who = r.who; mate = r.mate;
    const seen = await t.eval((a)=>eval('(' + a.AS + ')')(a.who, ()=>({
      setup: isSettingsVisible(),
      cats: settingsVisibleCategories().map(c=>c.label),
      tabs: [].concat.apply([], settingsVisibleCategories().map(c=>c.tabs.map(x=>x[0]))),
    })), {AS, who});
    if(!seen.setup) throw new Error('the fixture cannot see Setup at all');
    return 'Manage Users only — Setup shows ' + seen.cats.join(' and ') + ', '
      + seen.tabs.length + ' screen(s)';
  });

  t.section('the four doors that were open to anybody');

  await t.step('Export, Import, Bulk Import and the Recycle Bin need the capability that claims them', async () => {
    const r = await t.eval((a)=>eval('(' + a.AS + ')')(a.who, ()=>{
      const tabs = [].concat.apply([], settingsVisibleCategories().map(c=>c.tabs.map(x=>x[0])));
      return {tabs,
        leaked: ['export','importback','import','recyclebin'].filter(x=>tabs.indexOf(x) >= 0),
        kept: tabs.indexOf('usermanagement') >= 0,
        /* the two that are links to things they can reach anyway */
        directory: tabs.indexOf('teammembers') >= 0,
        flags: ['export','importback','import','recyclebin'].map(x=>(settingsTabMeta(x) || {}).flag)};
    }), {AS, who});
    if(r.leaked.length) throw new Error('still open to one capability: ' + r.leaked.join(', '));
    if(!r.kept) throw new Error('Manage Users lost the screen it is actually for');
    if(r.flags.some(f=>f !== 'manageModuleSettings'))
      throw new Error('they are gated on ' + r.flags.join(', '));
    return 'all four now need Manage Module Settings — which is what that capability always said it covered '
      + '— and Users & Access is untouched';
  });

  await t.step('and typing the address does not get in either', async () => {
    const r = await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.who;
      const out = {};
      ['import','recyclebin'].forEach(v=>{
        navigate(v);
        out[v] = {landed: currentView, said: ((document.querySelector('.modal') || {}).textContent || '')
          .replace(/\s+/g, ' ').slice(0, 90)};
        closeModal();
      });
      /* and the Setup page by its own route, with a tab named */
      navigate('settings', 'export');
      out.settingsTab = {landed: currentView, tab: settingsTab};
      currentUser = was;
      navigate('dashboard');
      return out;
    }, {who});
    if(r.import.landed !== 'dashboard') throw new Error('Bulk Import opened by route');
    if(r.recyclebin.landed !== 'dashboard') throw new Error('the Recycle Bin opened by route');
    /* Bulk Import and the Recycle Bin are also where a module's own
       buttons lead, so what they ask for is the permission the work
       needs rather than a Setup capability — and this account has
       neither. Either sentence is an answer; silence is not. */
    if(!/Setup|permission on at least one module/.test(r.import.said))
      throw new Error('it did not say why: ' + r.import.said);
    if(!/Setup|permission on at least one module/.test(r.recyclebin.said))
      throw new Error('the Recycle Bin did not say why: ' + r.recyclebin.said);
    if(r.settingsTab.tab === 'export') throw new Error('naming the tab in the route opened it');
    return 'Bulk Import and the Recycle Bin bounce to the Dashboard and say which capability they need; '
      + 'naming a Setup tab in the route does not open it';
  });

  t.section('a panel with everything ticked, and a page with nothing on it');

  await t.step('a module closed to the role overrides every tick on the account', async () => {
    const r = await t.eval(async (a)=>{
      const m = DB.team.find(x=>x.id === a.who);
      const kept = JSON.parse(JSON.stringify(m.perms));
      m.perms = fullPerms(true);                       // everything ticked, as an administrator would leave it
      await save('team');
      const look = () => {
        navigate('cms');
        const html = document.getElementById('content').innerHTML;
        const note = document.querySelector('.card[style*="danger"]');
        return {create: can('CMS','create'), add: /openClientForm\(\)/.test(html),
          says: note ? note.textContent.replace(/\s+/g, ' ') : ''};
      };
      const was = currentUser; currentUser = a.who;
      const open = look();
      DB.config.moduleRoles = {CMS:['Admin']};          // the module shut to every other role
      const closed = look();
      DB.config.moduleRoles = {};
      currentUser = was;
      navigate('dashboard');
      m.perms = kept; await save('team');
      return {open, closed};
    }, {who});
    if(!r.open.create || !r.open.add)
      throw new Error('with the module open, a full panel still gave nothing');
    if(r.closed.create) throw new Error('a module closed to the role still allowed Create');
    if(r.closed.add) throw new Error('the Add button is still drawn on a module closed to the role');
    if(!/closed to the/.test(r.closed.says) || !/Module access/.test(r.closed.says))
      throw new Error('the page does not say why it is empty: ' + r.closed.says.slice(0, 140));
    return 'every box ticked and the module closed to the role: no Create, no button \u2014 and the page '
      + 'now says which rule it is and where it is undone';
  });

  t.section('closing Setup for a whole role');

  await t.step('one press takes it from every account on the role, and from the role’s own default', async () => {
    const r = await t.eval(async (a)=>{
      DB.config.roleTemplates = Object.assign({}, roleTemplates(), {'Senior Executive':
        {perms: fullPerms(false), adminFlags:{manageUsers:1}, scope:'own', pagePerms:[], stagePerms:{}}});
      await save('config');
      const old = window.confirm; window.confirm = ()=>true;
      try { await closeSetupForRole('Senior Executive'); } finally { window.confirm = old; }
      const look = id => { const was = currentUser; currentUser = id;
        const out = {setup: isSettingsVisible(), cats: settingsVisibleCategories().length,
          cms: can('CMS','view'), edit: can('CMS','edit'), stage: can('CMS','changeStage'),
          scope: (me() || {}).scope};
        currentUser = was; return out; };
      const tpl = (roleTemplateOf('Senior Executive') || {}).adminFlags || {};
      return {him: look(a.who), her: look(a.mate),
        tplHolds: ADMIN_FLAGS.filter(f=>tpl[f]),
        audited: DB.auditLog.filter(x=>x.action === 'Setup closed to this account').length};
    }, {who, mate});
    if(r.him.setup || r.her.setup) throw new Error('Setup is still visible to the role');
    if(r.him.cats || r.her.cats) throw new Error('a Setup category survived');
    if(!r.him.cms || !r.him.edit) throw new Error('it took their module access too');
    if(!r.him.stage) throw new Error('it took their workflow access');
    if(r.him.scope !== 'own') throw new Error('it changed what they see');
    if(r.tplHolds.length) throw new Error('the role template still hands Setup to the next hire: '
      + r.tplHolds.join(', '));
    if(r.audited < 2) throw new Error('only ' + r.audited + ' account(s) on the audit trail');
    return 'both accounts: no Setup menu, no Setup screen, and every module, record scope and workflow '
      + 'exactly as before — template included, so the next person on the role matches';
  });

  await t.step('Setup itself refuses them, however they ask for it', async () => {
    const r = await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.who;
      navigate('settings');
      const landed = currentView;
      const said = ((document.querySelector('.modal') || {}).textContent || '').replace(/\s+/g, ' ');
      closeModal();
      const rail = (document.querySelector('.sidebar') || {textContent:''}).textContent;
      const launcher = (typeof appLauncherItems === 'function' ? appLauncherItems() : [])
        .filter(x=>x.id === 'settings').length;
      currentUser = was;
      navigate('dashboard');
      return {landed, said, inRail: /Setup/.test(rail), launcher};
    }, {who});
    if(r.landed !== 'dashboard') throw new Error('Setup opened by its own route');
    if(!/capabilities that open it/.test(r.said))
      throw new Error('it did not say why: ' + r.said.slice(0, 160));
    if(r.inRail) throw new Error('the Setup entry is still in the rail');
    if(r.launcher) throw new Error('Setup is still in the command palette');
    return 'no rail entry, nothing in the palette, and the route lands on the Dashboard with the reason';
  });

  await t.step('an administrator is never shut out of Setup', async () => {
    const r = await t.eval(async ()=>{
      const admin = DB.team.find(x=>isAdmin(x));
      const was = currentUser; currentUser = admin.id;
      navigate('settings');
      const out = {landed: currentView, cats: settingsVisibleCategories().length,
        tabs: [].concat.apply([], settingsVisibleCategories().map(c=>c.tabs)).length};
      currentUser = was;
      navigate('dashboard');
      /* and the role cannot be closed */
      let refused = false;
      const oldAlert = window.alert; window.alert = ()=>{ refused = true; };
      try { await closeSetupForRole('Admin'); } finally { window.alert = oldAlert; }
      return Object.assign(out, {refused});
    });
    if(r.landed !== 'settings') throw new Error('an admin was bounced off Setup');
    if(r.tabs < 20) throw new Error('an admin sees only ' + r.tabs + ' Setup screen(s)');
    if(!r.refused) throw new Error('Setup could be closed to the Admin role');
    return 'every one of the ' + r.tabs + ' screens, and the Admin role cannot be closed';
  });

  await t.step('giving one capability back opens exactly one part of Setup', async () => {
    const r = await t.eval(async (a)=>{
      const old = window.confirm; window.confirm = ()=>true;
      try { await setRoleCapability('Senior Executive', 'manageReports', true); } finally { window.confirm = old; }
      const was = currentUser; currentUser = a.who;
      const out = {setup: isSettingsVisible(),
        tabs: [].concat.apply([], settingsVisibleCategories().map(c=>c.tabs.map(x=>x[0]))),
      };
      currentUser = was;
      return out;
    }, {who});
    if(!r.setup) throw new Error('Setup did not come back');
    if(r.tabs.indexOf('export') >= 0 || r.tabs.indexOf('recyclebin') >= 0)
      throw new Error('Manage Reports brought the data doors with it: ' + r.tabs.join(', '));
    return 'Manage Reports opens ' + r.tabs.length + ' screen(s) — and none of them is Export, Import or '
      + 'the Recycle Bin';
  });
});
