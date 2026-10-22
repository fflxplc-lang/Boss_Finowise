/* NOBODY LOOKS UP THE CHART.

   The reporting line decided whose records the `team` scope reaches, and
   it reaches downwards. It said nothing about who may be looked at, so
   an executive could open the chart and read the whole board.

   The rule tested here: a person sees their own level of the chart and
   every level below it, and nothing above — level being depth in the
   reporting tree, whichever branch somebody is in. The one exemption is
   the capability that exists to administer people.

   What is worth testing is that one gate really is one gate: the lists,
   the chart, the PDF, the card and the reports all obey it, a link
   carrying an id does not get round it, and a broken reporting line
   loses nobody. */
const {suite} = require('../lib/harness');

/* A four-level firm, two branches wide, plus a viewer to be. */
const SETUP = `async (asRole) => {
  DB.team = [
    {id:'T0', name:'ZZ Chief',   role:'Admin',   status:'Active', email:'t0@example.in',
     branch:'Varanasi', perms:fullPerms(true),  adminFlags:fullAdminFlags(true),  scope:'all'},
    {id:'T1', name:'ZZ VP East', role:asRole,    status:'Active', email:'t1@example.in',
     parentUserId:'T0', branch:'Varanasi', perms:fullPerms(true), adminFlags:fullAdminFlags(false), scope:'all'},
    {id:'T1b',name:'ZZ VP West', role:asRole,    status:'Active', email:'t1b@example.in',
     parentUserId:'T0', branch:'Katni', perms:fullPerms(true), adminFlags:fullAdminFlags(false), scope:'all'},
    {id:'T2', name:'ZZ Manager', role:asRole,    status:'Active', email:'t2@example.in',
     parentUserId:'T1', branch:'Varanasi', perms:fullPerms(true), adminFlags:fullAdminFlags(false), scope:'all'},
    {id:'T2b',name:'ZZ Manager West', role:asRole, status:'Active', email:'t2b@example.in',
     parentUserId:'T1b', branch:'Katni', perms:fullPerms(true), adminFlags:fullAdminFlags(false), scope:'all'},
    {id:'T3', name:'ZZ Executive', role:asRole,  status:'Active', email:'t3@example.in',
     parentUserId:'T2', branch:'Varanasi', perms:fullPerms(true), adminFlags:fullAdminFlags(false), scope:'all'},
  ];
  await save('team');
  return memberDepths();
}`;
const BE = `(id) => { currentUser = id; render(); }`;

suite(async t => {

  await t.step('depth is read from the reporting line, not from the role', async () => {
    const r = await t.eval(async (setup)=>{
      const d = await eval('(' + setup + ')')('Manager');
      return {d, roles: [...new Set(DB.team.map(x=>roleOf(x)))]};
    }, SETUP);
    if(r.d.T0 !== 0 || r.d.T1 !== 1 || r.d.T2 !== 2 || r.d.T3 !== 3)
      throw new Error('depths came out ' + JSON.stringify(r.d));
    if(r.d.T1b !== 1 || r.d.T2b !== 2) throw new Error('the other branch is at the wrong depth');
    return 'four levels, two branches, and every one of them the same role — the line decides, not the label';
  });

  t.section('what somebody three deep can see');

  await t.step('their own level and below, in any branch — and nothing above', async () => {
    const r = await t.eval((be)=>{
      eval('(' + be + ')')('T2');                 // a manager, two deep
      const seen = peopleOpenToMe(DB.team).map(x=>x.id).sort();
      eval('(' + be + ')')('T3');                 // an executive, three deep
      const deep = peopleOpenToMe(DB.team).map(x=>x.id).sort();
      eval('(' + be + ')')('T0');                 // the chief, who is also an Admin
      const chief = peopleOpenToMe(DB.team).map(x=>x.id).sort();
      eval('(' + be + ')')('T2');
      return {seen, deep, chief, all: DB.team.length};
    }, BE);
    if(r.seen.join() !== 'T2,T2b,T3')
      throw new Error('two deep sees ' + r.seen.join(', ') + ' — expected their level and below');
    if(r.deep.join() !== 'T3') throw new Error('three deep sees ' + r.deep.join(', '));
    if(r.chief.length !== r.all) throw new Error('the Admin at the top cannot see everybody');
    return 'two deep sees their own level in both branches and the one below; three deep sees only '
      + 'themselves; the Admin sees all ' + r.all;
  });

  await t.step('the lists, the chart and the PDF all obey the same gate', async () => {
    const r = await t.eval((be)=>{
      eval('(' + be + ')')('T2');
      navigate('teammembers');
      const list = document.getElementById('content').textContent;
      const tree = renderReportingSection();
      const roots = orgTreeRoots();
      const names = [];
      (function walk(ns){ ns.forEach(n=>{ names.push(n.u.name); walk(n.children || []); }); })(roots);
      const pdf = hierarchyPdfRaw();
      const said = (pdf.match(/\(((?:\\.|[^()\\])*)\) Tj/g) || []).map(x=>x.slice(1, -4));
      /* Users & Access needs Manage Users to open at all, which is the very
         capability that exempts you — so it is checked for the opposite:
         whoever can open it sees the whole firm. */
      const m = DB.team.find(x=>x.id === 'T2');
      m.adminFlags = Object.assign({}, m.adminFlags, {manageUsers:1});
      navigate('settings', 'usermanagement');
      const users = document.getElementById('content').textContent;
      m.adminFlags.manageUsers = 0;
      return {listHasChief: /ZZ Chief/.test(list), listHasPeer: /ZZ Manager West/.test(list),
        treeHasChief: /ZZ Chief/.test(tree), chart: names.sort(),
        pdfHasChief: said.some(x=>/ZZ Chief/.test(x)),
        usersHasChief: /ZZ Chief/.test(users), usersHasSelf: /ZZ Manager/.test(users),
        saysWhy: /above your level/.test(list)};
    }, BE);
    if(r.listHasChief) throw new Error('the Team Members list still shows somebody two levels up');
    if(!r.listHasPeer) throw new Error('it hid a peer in the other branch');
    if(r.treeHasChief) throw new Error('the reporting tree still draws the level above');
    if(r.chart.join() !== 'ZZ Executive,ZZ Manager,ZZ Manager West')
      throw new Error('the chart drew ' + r.chart.join(', '));
    if(r.pdfHasChief) throw new Error('the hierarchy PDF still prints the level above');
    if(!r.usersHasChief || !r.usersHasSelf)
      throw new Error('Users & Access, which needs the exempting capability to open, hid somebody');
    if(!r.saysWhy) throw new Error('nothing says why somebody is missing');
    return 'list, reporting tree, org chart, hierarchy PDF and Users & Access — all the same answer, '
      + 'and the screens say why somebody is missing';
  });

  await t.step('a link carrying their id does not get round it', async () => {
    const r = await t.eval((be)=>{
      eval('(' + be + ')')('T2');
      openUserProfile('T0');
      const blocked = !document.getElementById('userProfileCard');
      openUserProfile('T3');
      const below = !!document.getElementById('userProfileCard');
      closeUserProfile();
      openUserProfile('T2');
      const self = !!document.getElementById('userProfileCard');
      closeUserProfile();
      return {blocked, below, self};
    }, BE);
    if(!r.blocked) throw new Error('the card for somebody above opened anyway');
    if(!r.below || !r.self) throw new Error('it also blocked somebody below, or themselves');
    return 'the card refuses the level above, opens for the level below and for themselves';
  });

  await t.step('the reports that list people count the same people', async () => {
    const r = await t.eval((be)=>{
      eval('(' + be + ')')('T2');
      const emp = repEmployeeReport();
      const rm = repRmLeads();
      eval('(' + be + ')')('T0');
      const empAll = repEmployeeReport();
      return {hidChief: !/ZZ Chief/.test(emp), rmHidChief: !/ZZ Chief/.test(rm),
        adminSees: /ZZ Chief/.test(empAll)};
    }, BE);
    if(!r.hidChief) throw new Error('the employee report still lists the level above');
    if(!r.rmHidChief) throw new Error('the RM leaderboard still lists the level above');
    if(!r.adminSees) throw new Error('and the Admin lost sight of the chart');
    return 'the employee report and the leaderboard both stop at your own level, and the Admin still sees all';
  });

  t.section('the exemption, and a broken line');

  await t.step('Manage Users sees the whole chart, and losing it takes it away again', async () => {
    const r = await t.eval((be)=>{
      eval('(' + be + ')')('T2');
      const without = peopleOpenToMe(DB.team).length;
      const m = DB.team.find(x=>x.id === 'T2');
      m.adminFlags = Object.assign({}, m.adminFlags, {manageUsers:1});
      render();
      const withIt = peopleOpenToMe(DB.team).length;
      m.adminFlags.manageUsers = 0;
      m.adminFlags.managePermissions = 1;
      render();
      const withPerms = peopleOpenToMe(DB.team).length;
      m.adminFlags.managePermissions = 0;
      render();
      return {without, withIt, withPerms, back: peopleOpenToMe(DB.team).length, all: DB.team.length};
    }, BE);
    if(r.withIt !== r.all || r.withPerms !== r.all)
      throw new Error('the capability did not open the chart: ' + r.withIt + ' / ' + r.withPerms);
    if(r.back !== r.without) throw new Error('taking it away did not close it again');
    return r.without + ' of ' + r.all + ' without it, all ' + r.all + ' with Manage Users or Manage '
      + 'Permissions, and back to ' + r.back + ' when it goes';
  });

  await t.step('a reporting line that loops hides nobody', async () => {
    const r = await t.eval(async (be)=>{
      DB.team = [
        {id:'R1', name:'ZZ Ring One', role:'Manager', parentUserId:'R3', status:'Active', email:'r1@example.in',
         perms:fullPerms(true), adminFlags:fullAdminFlags(false)},
        {id:'R2', name:'ZZ Ring Two', role:'Manager', parentUserId:'R1', status:'Active', email:'r2@example.in',
         perms:fullPerms(true), adminFlags:fullAdminFlags(false)},
        {id:'R3', name:'ZZ Ring Three', role:'Manager', parentUserId:'R2', status:'Active', email:'r3@example.in',
         perms:fullPerms(true), adminFlags:fullAdminFlags(false)},
      ];
      await save('team');
      eval('(' + be + ')')('R2');
      return {depths: memberDepths(), seen: peopleOpenToMe(DB.team).length};
    }, BE);
    if(r.seen !== 3) throw new Error('a loop in the data hid ' + (3 - r.seen) + ' colleague(s)');
    if(Object.values(r.depths).some(d=>d !== 0)) throw new Error('a ring produced an order it does not have');
    return 'three people in a ring are all level 0, and none of them loses the others';
  });

  t.section('Team Members lives in Setup now');

  await t.step('it is a Setup entry, off the rail, and still a module in every other sense', async () => {
    const r = await t.eval(async ()=>{
      const g = NAV_GROUPS.find(x=>x.id === 'organisation');
      const tabs = [];
      SETTINGS_CATEGORIES.forEach(c=>c.tabs.forEach(tb=>tabs.push([c.id, tb[0]])));
      const entry = tabs.find(x=>x[1] === 'teammembers');
      const onRail = railNavGroups().some(x=>x.id === 'organisation');
      /* switching it off must still switch it off, and a sub-user's page
         list must still be able to name it */
      const live = viewIsLive('teammembers');
      const pages = modulePages('Team');
      const chips = NAV_GROUPS.some(x=>(x.items||[]).indexOf('teammembers') >= 0);
      openSetupScreen('teammembers');
      const went = currentView;
      return {group: !!g, onRail, entry, live, pages, chips, went,
        inSettingsList: !!settingsTabMeta('teammembers')};
    });
    if(!r.entry) throw new Error('Team Members is not a Setup entry');
    if(r.entry[0] !== 'users') throw new Error('it landed in the ' + r.entry[0] + ' section');
    if(r.onRail) throw new Error('the Organization group is still on the rail');
    if(!r.group || !r.chips) throw new Error('it stopped being a module, so permissions lost it');
    if(!r.live) throw new Error('the route is no longer live');
    if(r.pages.join() !== 'teammembers') throw new Error('modulePages gives ' + r.pages.join());
    if(r.went !== 'teammembers') throw new Error('opening it from Setup went to ' + r.went);
    return 'Setup › User & Access Management › Team Members, gone from the rail, still a module that '
      + 'can be switched off and still a page access can be narrowed to';
  });

  await t.step('nothing was alerted that was not a result', async () => {
    const seen = (t.dialogs || []).map(String);
    const bad = seen.filter(m=>/undefined|not a function|\[object/i.test(m));
    if(bad.length) throw new Error(bad.join(' | '));
    return seen.length ? seen.length + ' message(s): ' + seen.map(m=>m.split('\n')[0]).join(' | ') : 'none';
  });
});
