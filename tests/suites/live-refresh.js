/* THE SCREEN KEEPS UP WITH THE DATA, WITHOUT A RELOAD.

   The firm's note: "After importing any data, I have to manually refresh
   the system to see the updated information."

   There are two halves to that, and they fail for different reasons.

   Another tab's write comes back on the live stream and redraws by
   itself; that half has worked since the stream was built, and the first
   section here keeps it honest.

   This tab's own write does not come back that way — the stream echoes
   it and liveOnChange() skips it, correctly, because the record is
   already in DB. The redraw was left to whichever handler did the
   saving, and that is a hole that reopens every time somebody adds a
   screen: close a modal with its × instead of its own button, or save
   from a handler that returns without drawing, and the figure is on
   disk, in memory, and not on the screen. drawAfterWrite() closes it
   once, for every write there will ever be.

   So the test that matters is the second section: write, draw nothing on
   purpose, and the screen is still right a moment later. */
const {suite} = require('../lib/harness');
const signIn = require('../lib/signin');

const SCREEN_AUM = () => {
  const t = document.getElementById('content').textContent;
  const m = t.match(/LIVE AUM[\s\S]{0,400}?₹([\d,]+)/i);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};
/* A client worth a known amount, written straight to the store with no
   redraw of any kind — the point of every step here is what happens
   without one, so this calls nothing that draws. */
const INSTALL_PUT = () => {
  window.PUT_ = async (amount, name) => {
    const c = {id:uid('CMS'), cmsName:name, rmName:currentUser,
      branch:(DB.config.branches||['Varanasi'])[0],
      createdAt:new Date().toISOString(), createdBy:currentUser};
    initState('CMS', c);
    DB.clients.push(c);
    DB.transactions.push({id:uid('TXN'), clientId:c.id, amount, status:'Completed',
      transactionType:'Purchase', productCategory:'Equity',
      createdAt:new Date().toISOString(), createdBy:currentUser});
    await save('clients');
    await save('transactions');
    return c.id;
  };
  return true;
};

suite(async t => {

  await t.step('install the write helper, which draws nothing', async () => {
    await t.eval(INSTALL_PUT);
    return 'PUT_(amount, name) saves a client and a transaction, and returns';
  });

  t.section('this tab: a write redraws the screen it is looking at');

  await t.step('a save with no render() still reaches the Dashboard', async () => {
    /* No navigate, no render, no closeModal — nothing that would redraw.
       If the figure moves, it moved because the write itself asked for it. */
    await t.eval(()=>navigate('dashboard'));
    await t.wait(400);
    const before = await t.eval(SCREEN_AUM);
    await t.eval(x => PUT_(x, 'ZZ Silent One'), 111111);
    await t.wait(1200);
    const after = await t.eval(SCREEN_AUM);
    if(after === before)
      throw new Error('the Dashboard still reads ' + before + ' — the write did not redraw it');
    if(after !== before + 111111)
      throw new Error('it reads ' + after + ', expected ' + (before + 111111));
    return before + ' → ' + after + ', with nothing asking for a redraw';
  });

  await t.step('and a second one, on a different module', async () => {
    await t.eval(()=>navigate('portfolio'));
    await t.wait(400);
    const before = await t.eval(()=>document.querySelectorAll('#pfTable tbody tr').length);
    await t.eval(x => PUT_(x, 'ZZ Silent Two'), 222222);
    await t.wait(1200);
    const after = await t.eval(()=>document.querySelectorAll('#pfTable tbody tr').length);
    if(after !== before + 1)
      throw new Error('Portfolio shows ' + after + ' rows, expected ' + (before + 1));
    return before + ' → ' + after + ' rows';
  });

  await t.step('a burst of writes redraws once, not once each', async () => {
    /* One action often saves four collections. Four redraws would be
       four rebuilds of the whole page for one thing happening. */
    const n = await t.eval(async ()=>{
      let draws = 0;
      const real = window.render;
      window.render = function(){ draws++; return real.apply(this, arguments); };
      for(let i = 0; i < 5; i++) await save('clients');
      await new Promise(r=>setTimeout(r, 1400));
      window.render = real;
      return draws;
    });
    if(n === 0) throw new Error('five writes drew nothing at all');
    if(n > 2) throw new Error('five writes caused ' + n + ' redraws');
    return 'five writes, ' + n + ' redraw' + (n===1?'':'s');
  });

  await t.step('typing is never interrupted by one', async () => {
    /* The one thing a redraw must not do. The write still lands and the
       screen catches up once the field is left. */
    await t.eval(()=>navigate('cms'));
    await t.wait(400);
    const r = await t.eval(async ()=>{
      const box = document.querySelector('.list-search');
      if(!box) return {skip:true};
      box.focus();
      box.value = 'ZZ typing here';
      await save('clients');
      await new Promise(x=>setTimeout(x, 900));
      const a = document.activeElement;
      return {held: a === box || (a && a.className === box.className),
              value: (document.querySelector('.list-search')||{}).value};
    });
    if(r.skip) return 'no search box on this screen to test with';
    if(!r.held) throw new Error('the redraw took the focus out of the box');
    if(r.value !== 'ZZ typing here') throw new Error('what was typed became "' + r.value + '"');
    return 'the caret and the text both survived the write';
  });

  await t.step('a modal left open does not stop the page behind it catching up', async () => {
    /* Closing a wizard with its × rather than its own button was the way
       a screen went stale: nothing in that path called render(). */
    await t.eval(()=>navigate('dashboard'));
    await t.wait(400);
    const before = await t.eval(SCREEN_AUM);
    const r = await t.eval(async x => {
      openModal('Test', '<div>something</div>', '');
      await PUT_(x, 'ZZ Behind A Modal');
      await new Promise(y=>setTimeout(y, 1100));
      const behind = (function(){
        const t = document.getElementById('content').textContent;
        const m = t.match(/LIVE AUM[\s\S]{0,400}?₹([\d,]+)/i);
        return m ? Number(m[1].replace(/,/g, '')) : null;
      })();
      closeModal();                                   // the × path: no render()
      return {behind, open: document.getElementById('overlay').classList.contains('show')};
    }, 333333);
    await t.wait(300);
    const after = await t.eval(SCREEN_AUM);
    if(r.behind !== before + 333333)
      throw new Error('behind the modal it read ' + r.behind + ', expected ' + (before + 333333));
    if(after !== r.behind) throw new Error('after the × it reads ' + after);
    return 'the page behind the modal was already right before the × was clicked';
  });

  t.section('another tab: the live stream');

  await t.step('a second tab on the Dashboard follows this one', async () => {
    const port = process.env.BOSS_PORT || 3000;
    const ctx = await t.page.context().browser().newContext();
    const p2 = await ctx.newPage();
    try {
      await signIn(p2, 'http://localhost:' + port);
      await p2.evaluate(()=>navigate('dashboard'));
      await p2.waitForTimeout(900);
      const before = await p2.evaluate(SCREEN_AUM);
      const liveOn = await p2.evaluate(()=>!!document.querySelector('.live-dot.on'));
      if(!liveOn) throw new Error('the second tab never connected to the live stream');
      await t.eval(x => PUT_(x, 'ZZ Cross Tab'), 444444);
      let at = 0, after = before;
      for(let i = 0; i < 15; i++){
        await p2.waitForTimeout(1000);
        after = await p2.evaluate(SCREEN_AUM);
        if(after !== before){ at = i + 1; break; }
      }
      if(!at) throw new Error('after 15s the second tab still reads ' + before);
      if(after !== before + 444444)
        throw new Error('it reads ' + after + ', expected ' + (before + 444444));
      return 'updated within ' + at + 's, no reload: ' + before + ' → ' + after;
    } finally { await ctx.close(); }
  });

  t.section('when the live stream cannot deliver');

  await t.step('the server can be asked what this browser missed', async () => {
    const r = await t.eval(async ()=>{
      const res = await fetch('/api/changes?since=0', {headers: apiHeaders(), cache:'no-store'});
      const d = await res.json();
      return {ok: res.ok, version: d.version, n: (d.changes||[]).length,
              shaped: (d.changes||[]).every(c=>c.v && Array.isArray(c.keys))};
    });
    if(!r.ok) throw new Error('/api/changes did not answer');
    if(typeof r.version !== 'number') throw new Error('it returned no version');
    if(!r.n) throw new Error('it remembers no changes although this suite has written plenty');
    if(!r.shaped) throw new Error('its entries are not {v, keys}');
    return 'version ' + r.version + ', ' + r.n + ' changes remembered';
  });

  await t.step('a tab whose stream is dead still catches up', async () => {
    /* This is the case that kept coming back and that no test covered: a
       proxy buffering the stream, a phone suspending it, a frozen
       background tab. The page is correct, the connection looks fine,
       and nothing arrives. So: kill the stream in the second tab
       outright, write from the first, and the second must still get
       there by asking. */
    const port = process.env.BOSS_PORT || 3000;
    const ctx = await t.page.context().browser().newContext();
    const p2 = await ctx.newPage();
    try {
      await signIn(p2, 'http://localhost:' + port);
      await p2.evaluate(()=>{
        if(live.src){ live.src.close(); live.src = null; }   // the stream is gone
        live.connected = false;
        window.EventSource = function(){ throw new Error('no stream here'); };
        navigate('dashboard');
      });
      await p2.waitForTimeout(600);
      const before = await p2.evaluate(SCREEN_AUM);
      const dead = await p2.evaluate(()=>!!live.src);
      if(dead) throw new Error('the stream did not actually die');
      await t.eval(x => PUT_(x, 'ZZ Stream Is Dead'), 555555);
      let at = 0, after = before;
      for(let i = 0; i < 30; i++){
        await p2.waitForTimeout(1000);
        after = await p2.evaluate(SCREEN_AUM);
        if(after !== before){ at = i + 1; break; }
      }
      if(!at) throw new Error('with the stream dead it never caught up: still ' + before);
      if(after !== before + 555555) throw new Error('it reads ' + after);
      return 'no stream at all, and it still caught up within ' + at + 's';
    } finally { await ctx.close(); }
  });

  await t.step('and a tab coming back to the front catches up at once', async () => {
    /* A browser freezes a background tab's timers, which is every tab
       while somebody is in Explorer finding the file to import. Coming
       back must not mean reloading. */
    const port = process.env.BOSS_PORT || 3000;
    const ctx = await t.page.context().browser().newContext();
    const p2 = await ctx.newPage();
    try {
      await signIn(p2, 'http://localhost:' + port);
      await p2.evaluate(()=>{
        if(live.src){ live.src.close(); live.src = null; }
        live.connected = false;
        window.EventSource = function(){ throw new Error('no stream here'); };
        clearTimeout(liveCatchTimer);                      // and no timer either
        navigate('dashboard');
      });
      await p2.waitForTimeout(500);
      const before = await p2.evaluate(SCREEN_AUM);
      await t.eval(x => PUT_(x, 'ZZ Came Back'), 666666);
      await p2.waitForTimeout(700);
      const stillStale = await p2.evaluate(SCREEN_AUM);
      if(stillStale !== before) throw new Error('something else updated it; this proves nothing');
      /* the tab is looked at again */
      await p2.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
      let at = 0, after = before;
      for(let i = 0; i < 10; i++){
        await p2.waitForTimeout(500);
        after = await p2.evaluate(SCREEN_AUM);
        if(after !== before){ at = i + 1; break; }
      }
      if(!at) throw new Error('coming back to the tab changed nothing: still ' + before);
      if(after !== before + 666666) throw new Error('it reads ' + after);
      return 'caught up within ' + (at*500) + 'ms of the tab being looked at';
    } finally { await ctx.close(); }
  });

  await t.step('catching up on its own writes alone costs nothing', async () => {
    /* A tab that has only written its own changes has nothing to read
       back. It should move its counter and stop, not re-read the
       database every few seconds for the rest of the day. */
    const r = await t.eval(async ()=>{
      let loads = 0;
      const real = window.loadAll;
      window.loadAll = function(){ loads++; return real.apply(this, arguments); };
      await save('clients');
      await new Promise(x=>setTimeout(x, 400));
      const moved = await liveCatchUp('a test');
      const applied = live.applied, version = live.version;
      window.loadAll = real;
      return {loads, moved, applied, version};
    });
    if(r.loads) throw new Error('it re-read the whole database ' + r.loads + ' time(s)');
    if(r.moved) throw new Error('it thought it had something to apply');
    if(r.applied !== r.version)
      throw new Error('its counter stayed behind: ' + r.applied + ' of ' + r.version);
    return 'counter moved to ' + r.applied + ', nothing re-read';
  });

  await t.step('the badge says which build and how far behind it is', async () => {
    const r = await t.eval(async ()=>{
      await liveReportBuild();
      const el = document.getElementById('liveDot');
      return {build: window.CRM_BUILD, title: el ? el.title : ''};
    });
    if(!r.build) throw new Error('the browser cannot say which build it is on');
    if(r.title.indexOf('Build ') < 0) throw new Error('the badge does not carry it: ' + r.title);
    if(!/Change \d+ of \d+ applied/.test(r.title))
      throw new Error('the badge does not say how far behind it is: ' + r.title);
    return 'build ' + r.build + ' · "' + r.title.split('\n').slice(1).join(' · ') + '"';
  });

  await t.step('a newer BOSS on the server is the one reload it does ask for', async () => {
    /* Everything else here exists so a reload is never needed for data.
       This is the case where it genuinely is — the application itself
       has moved on — and it should be said rather than guessed at. */
    const r = await t.eval(async ()=>{
      window.CRM_BUILD = 'an-older-build';
      await liveReportBuild();
      const bar = document.getElementById('crmNewBuild');
      const out = {shown: !!bar, text: bar ? bar.textContent.replace(/\s+/g,' ').trim() : '',
                   build: window.CRM_BUILD};
      if(bar) bar.remove();
      return out;
    });
    if(!r.shown) throw new Error('it said nothing about the build having moved');
    if(r.build === 'an-older-build') throw new Error('it did not pick up the real build');
    if(!/upgrade/i.test(r.text)) throw new Error('the notice does not offer the upgrade: ' + r.text);
    if(!/data is up to date/i.test(r.text))
      throw new Error('it does not say the data is fine either way: ' + r.text);
    return '"' + r.text.slice(0, 90) + '…"';
  });

  await t.step('and it says nothing when the build has not moved', async () => {
    const r = await t.eval(async ()=>{
      await liveReportBuild();
      await liveReportBuild();
      return !!document.getElementById('crmNewBuild');
    });
    if(r) throw new Error('it nagged about a reload with nothing to reload for');
    return 'quiet, as it should be';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
