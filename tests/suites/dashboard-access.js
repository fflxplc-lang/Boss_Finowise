/* THE DASHBOARD IS THE FIRM'S, NOT OURS.

   It was one function and seventeen cards, the same seventeen for
   everybody who signed in. A firm that wanted its operations team to
   see onboarding without revenue, or its relationship managers to open
   on their own day, had nowhere to say so.

   So every card is an entry in a register, and Setup edits the
   register: on or off, the roles it is for, what it is called, the
   order, and cards the firm adds itself out of any module's records.
   What is worth testing is that the page really is drawn from that
   register — switch one off and it is gone, name it for a role and
   only that role sees it — and the two things a configurable dashboard
   must not become: a way to see somebody else's records, or a way to
   see a module you have no permission for. */
const {suite} = require('../lib/harness');

const AS = `(id, fn) => { const was = currentUser; currentUser = id; try { return fn(); } finally { currentUser = was; } }`;
const DRAW = `() => { navigate('dashboard'); return document.getElementById('content').textContent.replace(/\\s+/g,' '); }`;

suite(async t => {
  await t.home();
  let mgr = null, rm = null;

  await t.step('every card on the dashboard comes from the register', async () => {
    const r = await t.eval((a)=>{
      const page = eval('(' + a.DRAW + ')')();
      const shipped = DASHBOARD_WIDGETS.length;
      const drawn = DASHBOARD_WIDGETS.filter(w=>dashMaySee(w)).length;
      const titles = DASHBOARD_WIDGETS.filter(w=>dashMaySee(w) && w.id !== 'approvals')
        .map(w=>dashTitle(w)).filter(x=>page.indexOf(x) < 0);
      return {shipped, drawn, missing: titles, sections: DASH_SECTIONS.length};
    }, {DRAW});
    if(r.shipped < 15) throw new Error('only ' + r.shipped + ' cards in the register');
    if(r.missing.length) throw new Error('the register says these are drawn and they are not: ' + r.missing.join(', '));
    return r.drawn + ' of ' + r.shipped + ' cards drawn for an admin, across ' + r.sections + ' sections';
  });

  await t.step('two people to show it to', async () => {
    const r = await t.eval(async ()=>{
      const roles = roleList().filter(x=>x !== 'Admin');
      const m = {id: uid('TM'), name:'ZZ Dash Manager', role: roles[0] || 'Manager', email:'zzdm@example.in',
        status:'Active', scope:'all', adminFlags:{}, perms: fullPerms(true), createdAt:new Date().toISOString()};
      const r2 = {id: uid('TM'), name:'ZZ Dash RM', role: roles[1] || roles[0] || 'Manager', email:'zzdr@example.in',
        status:'Active', scope:'own', adminFlags:{}, perms: fullPerms(true), createdAt:new Date().toISOString()};
      DB.team.push(m, r2); await save('team');
      return {mgr: m.id, rm: r2.id, mgrRole: m.role, rmRole: r2.role, same: m.role === r2.role};
    });
    mgr = r.mgr; rm = r.rm;
    if(r.same) throw new Error('this store has only one non-admin role, so role-wise cannot be tested');
    return r.mgrRole + ' and ' + r.rmRole + ', both holding every module permission';
  });

  t.section('what Setup can do to it');

  await t.step('switching a card off takes it off the page, and nothing else with it', async () => {
    const r = await t.eval(async (a)=>{
      const before = eval('(' + a.DRAW + ')')();
      await dashToggleOn('compliance', false);
      const after = eval('(' + a.DRAW + ')')();
      await dashToggleOn('compliance', true);
      const back = eval('(' + a.DRAW + ')')();
      return {had: /Compliance/.test(before), gone: !/Compliance/.test(after),
        kept: /Live AUM/.test(after), back: /Compliance/.test(back),
        stored: JSON.stringify(((DB.config.dashboard || {}).off) || {})};
    }, {DRAW});
    if(!r.had) throw new Error('Compliance was not on the page to begin with');
    if(!r.gone) throw new Error('switching it off left it on the page');
    if(!r.kept) throw new Error('switching one card off took another with it');
    if(!r.back) throw new Error('switching it back on did not bring it back');
    return 'off, gone, on, back — and the rest of the page untouched';
  });

  await t.step('naming a card for one role hides it from the other', async () => {
    const r = await t.eval(async (a)=>{
      const mgrRole = roleOf(DB.team.find(x=>x.id === a.mgr));
      await dashToggleRole('growth', mgrRole);
      const seen = eval('(' + a.AS + ')')(a.mgr, ()=>eval('(' + a.DRAW + ')')());
      const notSeen = eval('(' + a.AS + ')')(a.rm, ()=>eval('(' + a.DRAW + ')')());
      const roles = dashRoles(dashWidget('growth'));
      await dashOpenToAll('growth');
      const open = eval('(' + a.AS + ')')(a.rm, ()=>eval('(' + a.DRAW + ')')());
      return {mgrRole, forMgr: /Growth %/.test(seen), forRm: /Growth %/.test(notSeen),
        afterAll: /Growth %/.test(open), roles,
        otherKept: /Live AUM/.test(notSeen)};
    }, {AS, DRAW, mgr, rm});
    if(!r.forMgr) throw new Error('the role it was named for cannot see it');
    if(r.forRm) throw new Error('a role it was not named for still sees it');
    if(!r.otherKept) throw new Error('naming one card hid the others from that role');
    if(!r.afterAll) throw new Error('opening it to everyone did not bring it back');
    return 'named for ' + r.mgrRole + ' only, then open to everyone again';
  });

  await t.step('renaming a card renames it on the page', async () => {
    const r = await t.eval(async (a)=>{
      const old = window.prompt;
      window.prompt = ()=>'Money under advice';
      try { await dashRename('aum'); } finally { window.prompt = old; }
      const page = eval('(' + a.DRAW + ')')();
      const stored = (DB.config.dashboard.titles || {}).aum;
      return {page: /Money under advice/.test(page), gone: !/Live AUM/.test(page), stored};
    }, {DRAW});
    if(!r.page) throw new Error('the new name is not on the page');
    if(!r.gone) throw new Error('the old name is still there too');
    if(r.stored !== 'Money under advice') throw new Error('it was not stored: ' + r.stored);
    return '"Live AUM" is "Money under advice" everywhere it is drawn';
  });

  await t.step('the order is the firm’s', async () => {
    const r = await t.eval(async ()=>{
      const was = dashWidgetsIn('book').map(w=>w.id);
      await dashMove(was[2], -1);
      const now = dashWidgetsIn('book').map(w=>w.id);
      return {was, now, moved: now[1] === was[2] && now[2] === was[1]};
    });
    if(!r.moved) throw new Error('it did not move: ' + r.was.join(',') + ' → ' + r.now.join(','));
    return r.was.slice(0,4).join(' → ') + '  becomes  ' + r.now.slice(0,4).join(' → ');
  });

  t.section('a card the firm writes itself');

  await t.step('a count out of a module’s own records, split by one of its fields', async () => {
    const r = await t.eval(async (a)=>{
      ['Alpha','Beta','Alpha'].forEach((cat, i)=>{
        DB.clients.push({id: uid('CMS'), cmsName:'ZZ Dash Client ' + i, clientCategory: cat,
          rmName: i === 0 ? a.mgr : a.rm, cmsStage:'clientCreated'});
      });
      await save('clients');
      window._dashNew = {title:'Clients by category', section:'book', module:'CMS', metric:'count',
        field:'', split:'clientCategory', money:false, note:''};
      await dashAddCustom();
      const def = (DB.config.dashboard.custom || [])[0];
      const w = dashWidget(def.id);
      const page = eval('(' + a.DRAW + ')')();
      return {def, isCustom: !!(w && w.custom), onPage: /Clients by category/.test(page),
        about: w.about, value: dashCustomValue(def)};
    }, {DRAW, mgr, rm});
    if(!r.def) throw new Error('nothing was stored');
    if(!r.isCustom || !r.onPage) throw new Error('the card is not on the dashboard');
    if(r.value.total < 3) throw new Error('it counted ' + r.value.total + ' clients');
    if(!r.value.rows.length) throw new Error('the split produced no rows');
    return r.about + ' — ' + r.value.total + ' counted, split into '
      + r.value.rows.map(x=>x.label + ' ' + x.value).join(', ');
  });

  await t.step('and it counts only the records that person may see', async () => {
    const r = await t.eval((a)=>{
      const def = (DB.config.dashboard.custom || [])[0];
      const all = eval('(' + a.AS + ')')(a.mgr, ()=>dashCustomValue(def).total);
      const own = eval('(' + a.AS + ')')(a.rm, ()=>dashCustomValue(def).total);
      const rmRows = DB.clients.filter(c=>c.rmName === a.rm && !c.deletedAt).length;
      return {all, own, rmRows, scope: (DB.team.find(x=>x.id === a.rm) || {}).scope};
    }, {AS, mgr, rm});
    if(r.scope !== 'own') throw new Error('the fixture is not scoped to own');
    if(r.own >= r.all) throw new Error('a card read past the scope: ' + r.own + ' of ' + r.all);
    if(r.own !== r.rmRows) throw new Error('it counted ' + r.own + ', they own ' + r.rmRows);
    return 'the same card reads ' + r.all + ' for the one who sees everything and ' + r.own + ' for the one who sees their own';
  });

  await t.step('a card for a module somebody cannot open is not drawn for them', async () => {
    const r = await t.eval(async (a)=>{
      const m = DB.team.find(x=>x.id === a.mgr);
      const kept = JSON.parse(JSON.stringify(m.perms.LMS));
      m.perms.LMS = {};
      await save('team');
      const page = eval('(' + a.AS + ')')(a.mgr, ()=>eval('(' + a.DRAW + ')')());
      const widget = eval('(' + a.AS + ')')(a.mgr, ()=>dashMaySee(dashWidget('effLms')));
      m.perms.LMS = kept; await save('team');
      const back = eval('(' + a.AS + ')')(a.mgr, ()=>eval('(' + a.DRAW + ')')());
      return {hidden: !/Lead Management/.test(page), widget, back: /Lead Management/.test(back),
        othersKept: /Client Management/.test(page)};
    }, {AS, DRAW, mgr});
    if(!r.hidden || r.widget) throw new Error('the LMS card was drawn for somebody with no LMS permission');
    if(!r.othersKept) throw new Error('losing LMS took the CMS card too');
    if(!r.back) throw new Error('giving the permission back did not bring the card back');
    return 'no LMS permission, no LMS card — and the permission back brings it back';
  });

  t.section('the screen that does all this');

  await t.step('Setup carries it, and it is shut to everybody else', async () => {
    const r = await t.eval((a)=>{
      navigate('settings', 'dashboardaccess');
      const mine = document.getElementById('content').textContent.replace(/\s+/g, ' ');
      const theirs = eval('(' + a.AS + ')')(a.rm, ()=>renderSettingsDashboardAccess());
      navigate('dashboard');
      return {lists: /Dashboard Access/.test(mine),
        cards: DASHBOARD_WIDGETS.filter(w=>mine.indexOf(dashTitle(w)) >= 0).length,
        adds: /Add a card of your own/.test(mine),
        warns: /through the API/.test(mine),
        shut: /Module Settings or Manage Reports/.test(theirs)};
    }, {AS, rm});
    if(!r.lists) throw new Error('the screen is not there');
    if(r.cards < 10) throw new Error('only ' + r.cards + ' cards listed');
    if(!r.adds) throw new Error('there is no way to add a card');
    if(!r.warns) throw new Error('it does not say what the browser cannot enforce');
    if(!r.shut) throw new Error('somebody without the capability can open it');
    return r.cards + ' cards listed with their roles, the builder under them, and shut to everybody else';
  });

  await t.step('putting it back restores every card, name and order', async () => {
    const r = await t.eval(async (a)=>{
      const old = window.confirm; window.confirm = ()=>true;
      try { await dashResetAll(); } finally { window.confirm = old; }
      const page = eval('(' + a.DRAW + ')')();
      return {cfg: JSON.stringify(DB.config.dashboard),
        aum: /Live AUM/.test(page), renamed: /Money under advice/.test(page),
        custom: /Clients by category/.test(page),
        drawn: DASHBOARD_WIDGETS.filter(w=>dashMaySee(w)).length};
    }, {DRAW});
    if(!r.aum || r.renamed) throw new Error('the name did not go back');
    if(r.custom) throw new Error('the added card survived the reset');
    if(JSON.parse(r.cfg).custom.length) throw new Error('the custom cards are still stored');
    return 'back to the shipped dashboard — ' + r.drawn + ' cards, original names, nothing added';
  });

  await t.step('nothing was alerted that was not a result', async () => {
    const odd = t.dialogs.map(String).filter(x=>!/is on the dashboard/.test(x));
    if(odd.length) throw new Error('alerts: ' + odd.join(' | ').slice(0, 200));
    return t.dialogs.length + ' confirmation(s), no errors';
  });
});
