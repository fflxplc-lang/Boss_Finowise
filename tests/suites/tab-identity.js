/* THE TAB SAYS WHOSE SYSTEM THIS IS, AND WHICH PAGE.

   The browser drew its own globe, because nothing in the document
   named an icon, and every tab read "BOSS" whatever was on screen —
   so three tabs open on three modules were three tabs reading the
   same word. The firm asked for the logo and for "BOSS - Dashboard".

   The icon is the firm's own logo, read through the same two fields
   brandMarkHtml() reads, so a logo uploaded in Setup reaches the tab
   as well and nothing here holds a second copy of it. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();

  t.section('the icon');

  await t.step('the document names an icon at all, before anything runs', async () => {
    const r = await t.eval(()=>{
      const l = document.getElementById('favicon');
      return {there: !!l, rel: l ? l.getAttribute('rel') : ''};
    });
    if(!r.there) throw new Error('there is no icon link, so the browser draws its own globe');
    if(!/icon/.test(r.rel)) throw new Error('the link is rel="' + r.rel + '"');
    return 'an icon link is in the document itself, so nothing waits on the application to start';
  });

  await t.step('and by the time BOSS has started it is the firm’s logo', async () => {
    const r = await t.eval(()=>{
      const l = document.getElementById('favicon');
      const c = (DB.config && DB.config.company) || {};
      const logo = c.logoDataUrl || c.logoUrl || FREEDOM_LIFEX_LOGO;
      return {href: l.getAttribute('href') || '', isLogo: l.getAttribute('href') === logo,
              type: l.getAttribute('type') || ''};
    });
    if(!r.isLogo) throw new Error('the icon is not the logo: ' + r.href.slice(0, 60));
    if(!/^image\//.test(r.type)) throw new Error('the icon is served as "' + r.type + '"');
    return 'the logo the sidebar draws, in the tab, as ' + r.type;
  });

  await t.step('a logo uploaded in Setup reaches the tab, with no second copy anywhere', async () => {
    const r = await t.eval(async ()=>{
      const mine = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const was = DB.config.company.logoDataUrl;
      DB.config.company.logoDataUrl = mine;
      setFavicon();
      const took = document.getElementById('favicon').getAttribute('href') === mine;
      DB.config.company.logoDataUrl = was;
      setFavicon();
      const back = document.getElementById('favicon').getAttribute('href') === was;
      return {took, back};
    });
    if(!r.took) throw new Error('an uploaded logo did not reach the tab');
    if(!r.back) throw new Error('removing it did not put the shipped logo back');
    return 'upload it and the tab follows; remove it and the shipped logo is back — one source either way';
  });

  await t.step('the client’s own page gets it too, where a globe looks worst', async () => {
    const r = await t.eval(()=>{
      const s = Array.from(document.querySelectorAll('script')).map(x=>x.textContent).join('\n');
      return /function renderPublicDocForm\(token\)\{\s*(\/\*[\s\S]*?\*\/\s*)?setFavicon\(\);/.test(s);
    });
    if(!r) throw new Error('the public document page never sets the icon');
    return 'set on the page a client opens from their email, which never goes through render()';
  });

  t.section('the name');

  await t.step('it reads BOSS - and then the page you are on', async () => {
    const pages = [['dashboard','Dashboard'], ['transactions','Transaction Tracker'],
                   ['business','Daily Business Tracker'], ['settings','Setup']];
    const seen = [];
    for(const [view, want] of pages){
      await t.eval(v=>{ try { navigate(v); } catch(e){} }, view);
      await t.wait(180);
      const title = await t.eval(()=>document.title);
      seen.push(title);
      if(title !== 'BOSS - ' + want)
        throw new Error('on ' + view + ' the tab reads "' + title + '", not "BOSS - ' + want + '"');
    }
    if(new Set(seen).size !== pages.length)
      throw new Error('two pages gave the same tab title: ' + seen.join(' | '));
    await t.eval(()=>{ try { navigate('dashboard'); } catch(e){} });
    return pages.length + ' pages, ' + pages.length + ' different titles — ' + seen.join(', ');
  });

  await t.step('and falls back to the product alone rather than to a dash', async () => {
    const r = await t.eval(()=>{
      const out = [];
      setTabTitle(''); out.push(document.title);
      setTabTitle(); out.push(document.title);
      setTabTitle('BOSS'); out.push(document.title);
      setTabTitle('Dashboard'); out.push(document.title);
      return out;
    });
    if(r.slice(0, 3).join('|') !== 'BOSS|BOSS|BOSS')
      throw new Error('with nothing to say it reads: ' + r.slice(0, 3).join(', '));
    if(r[3] !== 'BOSS - Dashboard') throw new Error('it reads ' + r[3]);
    return 'no page name, no trailing dash — just BOSS';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
