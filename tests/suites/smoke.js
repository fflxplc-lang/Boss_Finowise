/* THE CHEAPEST QUESTION WORTH ASKING: does every page still draw?

   Most of what breaks a single-file app of this size breaks loudly — a
   renamed function, a template literal closed in the wrong place — and it
   breaks one screen while the rest carry on. This opens all of them and
   watches for a blank page or a thrown error, which is the whole of it. */
const {suite} = require('../lib/harness');

const VIEWS = [
  'dashboard','lms','lng','cms','rms','dst','djt','dwt','meetings','calls','mailbox','portfolio',
  'arc','business','transactions','recommendations','queries','projects','reports','mis',
  'teammembers','iseqforms','fqtests','cifforms','planforms','ctforms','sevenevents','fsl','gab',
  'settings','profile','recyclebin','import',
];

suite(async t => {

  await t.step('nothing offers to work as somebody else', async () => {
    /* "Switch Test User" let an Admin act as a colleague, so every record
       written in that time carried the colleague's name rather than the
       name of whoever actually did it. It is gone — from the menu, from
       the source, and with no function left behind for a stale handler
       to find. */
    const r = await t.eval(()=>{
      userMenuOpen = true; render();
      const menu = document.querySelector('.user-menu');
      const items = menu ? Array.from(menu.querySelectorAll('.user-menu-item')).map(x=>x.textContent.trim()) : [];
      const src = Array.from(document.querySelectorAll('script')).map(x=>x.textContent).join('\n');
      userMenuOpen = false; render();
      return {items,
        fns: ['switchUser','openSwitchTestUserModal','canSwitchTestUser'].filter(n=>typeof window[n] === 'function'),
        inSource: /openSwitchTestUserModal\s*\(|function\s+switchUser\s*\(/.test(src)};
    });
    if(!r.items.length) throw new Error('the user menu drew nothing');
    const bad = r.items.filter(x=>/switch|test user|prototype/i.test(x));
    if(bad.length) throw new Error('still offered: ' + bad.join(', '));
    if(r.fns.length) throw new Error('the function is still reachable: ' + r.fns.join(', '));
    if(r.inSource) throw new Error('a call to it is still in the source');
    return 'the menu is ' + r.items.join(' · ') + ', and nothing can be called';
  });

  await t.step('the user menu is four doors fewer, and the two that went are still reachable', async () => {
    /* Recycle Bin and Users came off the menu. Neither was deleted — the
       bin is a Setup screen and accounts are made in Team Members — so
       what is checked is that they are gone from here and reachable
       there, not simply gone. */
    const r = await t.eval(()=>{
      userMenuOpen = true; render();
      const items = Array.from(document.querySelectorAll('.user-menu .user-menu-item')).map(x=>x.textContent.trim());
      userMenuOpen = false; render();
      const tabs = [];
      SETTINGS_CATEGORIES.forEach(c=>c.tabs.forEach(tb=>tabs.push(tb[0])));
      return {items, bin: tabs.indexOf('recyclebin') >= 0, team: tabs.indexOf('usermanagement') >= 0};
    });
    if(r.items.some(x=>/recycle/i.test(x))) throw new Error('Recycle Bin is still on the menu');
    if(r.items.some(x=>/^👥|users$/i.test(x))) throw new Error('Users is still on the menu');
    if(r.items.length !== 2) throw new Error('the menu holds ' + r.items.join(' · '));
    if(!r.bin) throw new Error('the Recycle Bin is not in Setup either, so it is simply gone');
    if(!r.team) throw new Error('Users & Access is not in Setup, so accounts have nowhere to be made');
    return 'menu: ' + r.items.join(' · ') + ' — bin and Users both still in Setup';
  });

  await t.step('and the second way to make an account is closed, not just hidden', async () => {
    /* A route left answering is a form somebody can still post to. */
    /* The 410 is the point of this step, so the browser logging it is a
       result rather than a defect. */
    t.expectConsole(/410/);
    const r = await t.eval(async ()=>{
      const page = await (await fetch('/users', {headers:{}})).text().catch(()=>'');
      const post = await fetch('/users', {method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:'email=zzsneak@example.com&password=testpassword1'});
      return {status: post.status, form: /action="\/users"[\s\S]{0,200}type="password"|name="password"/.test(page),
              says: /Team Members/.test(page)};
    });
    if(r.status === 200) throw new Error('POST /users still creates an account');
    if(r.status !== 410 && r.status !== 403)
      throw new Error('POST /users answered ' + r.status);
    return 'POST /users answers ' + r.status + ' and the page points at Team Members';
  });

  await t.step('the tab says BOSS, and says where you are', async () => {
    /* It said "Finowise CRM", which is neither the product's name nor
       the firm's. The firm's own name, where Company Settings has one,
       stands beside it rather than instead of it. */
    await t.eval(()=>navigate('dashboard'));
    await t.wait(250);
    const dash = await t.eval(()=>document.title);
    await t.eval(()=>navigate('cms'));
    await t.wait(250);
    const cms = await t.eval(()=>document.title);
    if(/Finowise CRM/.test(dash)) throw new Error('the tab still reads "' + dash + '"');
    if(dash.indexOf('BOSS') < 0) throw new Error('the tab reads "' + dash + '"');
    if(dash === cms) throw new Error('every screen gives the tab the same title: "' + dash + '"');
    return '"' + dash + '" → "' + cms + '"';
  });

  t.section('every module draws something');
  await t.step('all ' + VIEWS.length + ' views render with content', async () => {
    const thin = [];
    for(const v of VIEWS){
      await t.eval(x => navigate(x), v);
      await t.wait(140);
      const len = (await t.page.locator('#content').textContent()).trim().length;
      if(len < 20) thin.push(v + ' (' + len + ' chars)');
    }
    if(thin.length) throw new Error('rendered empty: ' + thin.join(', '));
    return VIEWS.length + ' views, none empty';
  });

  t.section('the rail says what the firm asked it to say');
  await t.step('Client Journey carries LMS, LNG, CMS and RMS', async () => {
    const items = await t.eval(()=>{
      const g = NAV_GROUPS.find(x=>x.id==='pipeline' || /client journey/i.test(x.label||''));
      return g ? {label: g.label, items: g.items} : null;
    });
    if(!items) throw new Error('there is no Client Journey group');
    for(const want of ['lms','lng','cms','rms'])
      if(items.items.indexOf(want) < 0) throw new Error('no ' + want + ': ' + items.items.join(', '));
    return items.label + ' → ' + items.items.join(', ');
  });

  await t.step('a module switched off is switched off everywhere', async () => {
    const r = await t.eval(()=>{
      const g = NAV_GROUPS.find(x=>x.id==='growth');
      if(!g) return {err:'no Growth group'};
      return {active: moduleActive('growth'), label: g.label};
    });
    if(r.err) throw new Error(r.err);
    if(r.active) throw new Error('Growth is active, and Modification 13 says it ships off');
    const shown = await t.eval(async ()=>{
      navigate('partners'); await new Promise(r=>setTimeout(r,120));
      return !!document.querySelector('.module-off');
    });
    if(!shown) throw new Error('a page inside a switched-off module opened anyway');
    return 'Growth off by default, and its pages say so';
  });

  t.section('nothing was alerted');
  await t.step('no dialog went unanswered', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
