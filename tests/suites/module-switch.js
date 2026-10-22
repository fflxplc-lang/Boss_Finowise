/* ONE MODULE AT A TIME, OFF FOR EVERYBODY.

   The switch BOSS had answered "is this firm using Client Journey at
   all". It could not answer "we use Business, but not the Transaction
   Tracker", which is the question somebody actually had. So a single
   module switches on its own now, and the two stack: a module is live
   when its group is on AND it has not itself been switched off.

   Off means off for everybody, administrators included. It is not a
   permission — a permission is about a person, this is about whether
   the firm uses the thing at all — so there is no "except for admins"
   in it. The sidebar drops it, the command palette drops it, and the
   route itself says what happened rather than opening the page.

   And nothing is deleted. Switch it back on and every record is
   exactly where it was, which is the whole reason this is a switch
   and not a delete. */
const {suite} = require('../lib/harness');

suite(async t => {

  t.section('a module switches off on its own');

  await t.step('the sidebar, the palette and the route all drop it', async () => {
    const r = await t.eval(async ()=>{
      DB.config.modulesOffViews = [];
      await save('config');
      const railHas = v => renderNavGroups().indexOf("navigate('" + v + "'") >= 0;
      const before = {rail: railHas('transactions'), live: viewIsLive('transactions'),
                      group: moduleActive('business')};
      DB.config.modulesOffViews = ['transactions'];
      await save('config');
      const after = {rail: railHas('transactions'), live: viewIsLive('transactions'),
                     group: moduleActive('business'),
                     sibling: viewIsLive('business')};
      return {before, after};
    });
    if(!r.before.rail || !r.before.live) throw new Error('it was not there to begin with');
    if(r.after.rail) throw new Error('the sidebar still offers it');
    if(r.after.live) throw new Error('it still reads as live');
    if(!r.after.group) throw new Error('switching one module off took its whole group with it');
    if(!r.after.sibling) throw new Error('and it took a sibling module with it too');
    return 'gone from the rail; the Business group and the DBT beside it untouched';
  });

  await t.step('typing the route says what happened, and names the right switch', async () => {
    const r = await t.eval(async ()=>{
      DB.config.modulesOffViews = ['transactions'];
      await save('config');
      navigate('transactions');
      const html = document.getElementById('content').innerHTML;
      navigate('dashboard');
      return {off: /is switched off/.test(html),
              names: /Transaction Tracker is switched off/.test(html),
              blamesGroup: /Business is switched off/.test(html),
              saysAll: /administrators included/.test(html),
              offersSetup: /modulesetup/.test(html)};
    });
    if(!r.off) throw new Error('the route opened the module anyway');
    if(!r.names) throw new Error('the page does not name the module that is off');
    if(r.blamesGroup) throw new Error('it blames the group, which is on');
    if(!r.saysAll) throw new Error('it does not say the switch covers administrators too');
    if(!r.offersSetup) throw new Error('and it offers no way back');
    return '“Transaction Tracker is switched off”, with the way back, and not blaming Business';
  });

  await t.step('an administrator is not excepted', async () => {
    const r = await t.eval(async ()=>({
      admin: isAdmin(), live: viewIsLive('transactions'),
      inPalette: (()=>{ const apps = [];
        activeNavGroups().forEach(g=> g.items.filter(viewIsLive)
          .forEach(id=> apps.push(id)));
        return apps.indexOf('transactions') >= 0; })()}));
    if(!r.admin) throw new Error('this test is not running as an administrator');
    if(r.live) throw new Error('it is live for an administrator');
    if(r.inPalette) throw new Error('and the command palette still offers it');
    return 'off for the administrator who switched it off, which is the point';
  });

  t.section('and back on, with everything where it was');

  await t.step('switching it on restores it and nothing was deleted', async () => {
    const r = await t.eval(async ()=>{
      const rows = (DB.transactions || []).length;
      await setViewActive('transactions', true);
      return {live: viewIsLive('transactions'), off: (DB.config.modulesOffViews || []).length,
              rows, after: (DB.transactions || []).length};
    });
    if(!r.live) throw new Error('it did not come back');
    if(r.off) throw new Error('the off list still holds ' + r.off);
    if(r.rows !== r.after) throw new Error('records changed: ' + r.rows + ' → ' + r.after);
    return 'back on the rail, and the ' + r.after + ' transaction(s) never moved';
  });

  await t.step('the group switch still works, and the two stack', async () => {
    const r = await t.eval(async ()=>{
      DB.config.modules = Object.assign({}, DB.config.modules, {business: 0});
      DB.config.modulesOffViews = [];
      await save('config');
      const groupOff = {txn: viewIsLive('transactions'), dbt: viewIsLive('business')};
      DB.config.modules = Object.assign({}, DB.config.modules, {business: 1});
      DB.config.modulesOffViews = ['transactions'];
      await save('config');
      const oneOff = {txn: viewIsLive('transactions'), dbt: viewIsLive('business')};
      DB.config.modulesOffViews = [];
      await save('config');
      return {groupOff, oneOff};
    });
    if(r.groupOff.txn || r.groupOff.dbt)
      throw new Error('the group switch no longer takes its modules with it');
    if(r.oneOff.txn) throw new Error('the module switch stopped working');
    if(!r.oneOff.dbt) throw new Error('one module off took its sibling with it');
    return 'group off takes everything; one module off takes only itself';
  });

  await t.step('Setup offers a press per module, and says which are off', async () => {
    const r = await t.eval(async ()=>{
      DB.config.modulesOffViews = ['transactions'];
      await save('config');
      const html = renderSettingsModules();
      DB.config.modulesOffViews = [];
      await save('config');
      return {press: html.indexOf("setViewActive('transactions'") >= 0,
              marks: /Transaction Tracker · off/.test(html),
              names: /switched off on its own/.test(html),
              saysAll: /administrators included/.test(html)};
    });
    if(!r.press) throw new Error('Setup offers no way to switch one module');
    if(!r.marks) throw new Error('and it does not mark the one that is off');
    if(!r.names) throw new Error('nor say so under the group');
    if(!r.saysAll) throw new Error('nor that the switch covers administrators');
    return 'a chip per module, the off one marked, and the group saying which';
  });

  await t.step('Setup itself cannot be switched off', async () => {
    const r = await t.eval(()=>({
      inGroups: NAV_GROUPS.some(g=>(g.items || []).indexOf('settings') >= 0),
      live: viewIsLive('settings')}));
    if(r.inGroups) throw new Error('Setup is listed as a module, so it could be switched off');
    if(!r.live) throw new Error('and it does not read as live');
    return 'Setup is not a module, so the way back can never be closed';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
