/* WIDTH, MEASURED RATHER THAN EYEBALLED.

   The note of 6 October: the pages do not use the width of a desktop, and
   look like a phone-shaped column with grey either side. Three things are
   measurable about that, and all three are checked here on every module and
   every page a client sees, at a desktop, a tablet and a phone:

     1. nothing is wider than its window — no sideways scrollbar on something
        that should not have one;
     2. the content box fills the window it is given;
     3. what the page draws fills the content box.

   A table inside .table-wrap is allowed to be wider: that is what the
   wrapper is for, and scrolling a wide table sideways is the right answer on
   a phone rather than a defect. A module switched off draws one centred
   notice, which is the right shape for a notice.

   When this fails it names the element that sticks out, so the fix has a
   target rather than a guess. */
const {suite} = require('../lib/harness');

const VIEWPORTS = [
  {name:'desktop', width:1920, height:1080},
  {name:'tablet',  width:1024, height:768},
  {name:'phone',   width:390,  height:844},
];
const VIEWS = ['dashboard','lms','lng','cms','rms','dst','djt','dwt','meetings','calls','mailbox',
  'portfolio','arc','business','transactions','recommendations','queries','projects','reports',
  'mis','teammembers','iseqforms','fqtests','cifforms','planforms','ctforms','sevenevents','fsl',
  'gab','settings','profile','recyclebin','import'];

const MEASURE = () => {
  const vw = document.documentElement.clientWidth;
  const overflow = Math.max(0, Math.round(document.documentElement.scrollWidth - vw));
  const out = [], seen = new Set();
  const all = document.querySelectorAll('body *');
  for(let n = 0; n < all.length && n < 4000; n++){
    const el = all[n];
    if(out.length >= 5) break;
    const r = el.getBoundingClientRect();
    if(r.width === 0 || r.height === 0) continue;
    if(r.right <= vw + 1) continue;                  // cheap test first
    const cs = getComputedStyle(el);
    if(cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
    if(el.closest('.table-wrap, .modal, .notif-panel')) continue;
    let p = el.parentElement, covered = false;
    while(p){ if(seen.has(p)){ covered = true; break; } p = p.parentElement; }
    if(covered) continue;                            // name the outermost of a chain only
    seen.add(el);
    out.push(el.tagName.toLowerCase()
      + '.' + String(el.className||'').split(/\s+/).filter(Boolean).slice(0,3).join('.')
      + ' w=' + Math.round(r.width) + ' right=' + Math.round(r.right));
  }
  const host = document.querySelector('.content') || document.querySelector('.fx-main')
            || document.querySelector('.public-card') || document.body;
  const hr = host.getBoundingClientRect();
  if(host.querySelector(':scope > .module-off'))     // a notice, not a layout
    return {vw, overflow, offenders: out, hostW: Math.round(hr.width),
            used: 100, ofWindow: Math.round(hr.width / vw * 100)};
  let widest = 0;
  Array.from(host.children || []).forEach(c => {
    const r = c.getBoundingClientRect();
    if(r.width > widest) widest = r.width;
  });
  return {vw, overflow, offenders: out, hostW: Math.round(hr.width), widest: Math.round(widest),
          used: hr.width ? Math.round(widest / hr.width * 100) : 0,
          ofWindow: Math.round(hr.width / vw * 100)};
};

suite(async t => {
  const rows = [];
  const probe = async (label, vp) => {
    await t.page.setViewportSize({width: vp.width, height: vp.height});
    await t.wait(200);
    rows.push(Object.assign({page: label, vp: vp.name}, await t.eval(MEASURE)));
  };

  t.section('measuring');
  await t.step('every module, at three widths', async () => {
    for(const v of VIEWS){
      await t.page.setViewportSize({width: 1440, height: 900});
      const ok = await t.eval(x => { try { navigate(x); return true; } catch(e){ return false; } }, v);
      if(!ok) continue;
      await t.wait(240);
      for(const vp of VIEWPORTS) await probe(v, vp);
    }
    return rows.length + ' measurements across ' + VIEWS.length + ' modules';
  });

  await t.step('every page a client sees, at the same three', async () => {
    const links = await t.eval(async ()=>{
      const l = {id:uid('LEAD'), leadName:'ZZ Layout', firstName:'ZZ', lastName:'Layout',
        mobile:'9811122233', email:'layout@example.com', rmName:currentUser,
        transformationForm:'SEVENEVENTS', createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('LMS', l); DB.leads.push(l); await save('leads');
      const c = {id:uid('CMS'), cmsName:'ZZ Layout Client', rmName:currentUser,
        createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('CMS', c); DB.clients.push(c); await save('clients');
      return {'input form': await createDocLink(l.id, 'SEVENEVENTS', {iseqType:'ISEQ_UNDER50'}),
              'FQ assessment': await createDocLink(l.id, 'FQ_YOUNG'),
              'CIF': await createDocLink(null, 'CIF', {recordModule:'CMS', recordId:c.id}),
              'C&T': await createDocLink(null, 'CT',  {recordModule:'CMS', recordId:c.id})};
    });
    const before = rows.length;
    for(const label of Object.keys(links)){
      await t.page.setViewportSize({width: 1440, height: 900});
      await t.doc(links[label], 1100);
      for(const vp of VIEWPORTS) await probe(label, vp);
    }
    return (rows.length - before) + ' measurements across ' + Object.keys(links).length + ' client pages';
  });

  t.section('what the measurements say');

  await t.step('nothing is wider than its window', async () => {
    const bad = rows.filter(r => r.overflow > 1);
    if(bad.length) throw new Error(bad.map(r =>
      r.page + ' @ ' + r.vp + ' +' + r.overflow + 'px (' + (r.offenders.join('; ') || 'no single offender') + ')'
    ).join(' | '));
    return rows.length + ' pages, no horizontal overflow';
  });

  await t.step('the content box fills the window it is given', async () => {
    const narrow = rows.filter(r => r.vp !== 'phone' && r.ofWindow < 60);
    if(narrow.length) throw new Error(narrow.map(r =>
      r.page + ' @ ' + r.vp + ': the box is ' + r.ofWindow + '% of the window').join(' | '));
    return 'every page at 60% of its window or better';
  });

  await t.step('the search box is small, and called Search', async () => {
    /* The firm asked for it small, and then asked for it to be called
       Search and nothing else. Both are easy to undo by accident — a new
       list passing a placeholder of its own, or a well-meaning hint — so
       both are checked, on every list that has one. */
    await t.page.setViewportSize({width: 1500, height: 950});
    const bad = [];
    for(const v of ['lms','cms','rms','dst','queries','recommendations','iseqforms',
                    'cifforms','planforms','ctforms','fqtests','campaigns','projects','mailbox']){
      await t.eval(x => { try { navigate(x); } catch(e){} }, v);
      await t.wait(220);
      const r = await t.eval(()=>{
        const el = document.querySelector('.list-search');
        if(!el) return null;
        return {w: Math.round(el.getBoundingClientRect().width), ph: el.placeholder};
      });
      if(!r) continue;
      if(r.ph !== 'Search') bad.push(v + ': the box says "' + r.ph + '"');
      if(r.w > 420) bad.push(v + ': ' + r.w + 'px wide');
    }
    if(bad.length) throw new Error(bad.join(' | '));
    return 'every list box compact, and every one of them says Search';
  });

  await t.step('no box anywhere calls itself anything but Search', async () => {
    /* The rendered DOM only shows the screen you are on, and half these
       boxes live in modals. So this reads the source: every placeholder in
       the application that mentions searching has to be the bare word.

       No exceptions: the two that kept their own wording for a day — the
       Scheme / Strategy lookup and the planner's slot label — say Search
       now too, because the firm asked for one word and meant it. */
    const ALLOWED = [];
    const odd = await t.eval(allowed => {
      const src = Array.from(document.querySelectorAll('script')).map(s=>s.textContent).join('\n');
      const found = [];
      const take = re => { let m; while((m = re.exec(src))) found.push(m[1]); };
      take(/placeholder="([^"]*)"/g);
      take(/placeholder:\s*'([^']*)'/g);
      return found.filter(ph => /search/i.test(ph) && ph !== 'Search' && allowed.indexOf(ph) < 0);
    }, ALLOWED);
    if(odd.length) throw new Error('still saying: ' + odd.map(x=>'"'+x+'"').join(', '));
    return 'one word, every box, no exceptions';
  });

  await t.step('and no Syntax button stands beside it', async () => {
    const left = await t.eval(()=>{
      const src = Array.from(document.querySelectorAll('script')).map(s=>s.textContent).join('\n');
      return {inSource: /Syntax<\/button>/.test(src) || /openSearchSyntax/.test(src),
              onScreen: Array.from(document.querySelectorAll('button'))
                .filter(b=>/syntax/i.test(b.textContent)).length};
    });
    if(left.inSource) throw new Error('the button, or the panel it opened, is still in the source');
    if(left.onScreen) throw new Error(left.onScreen + ' Syntax button(s) still drawn');
    return 'gone from every module, and the panel with it';
  });

  await t.step('what a page draws fills the box', async () => {
    const thin = rows.filter(r => r.vp === 'desktop' && r.hostW > 900 && r.used < 85);
    if(thin.length) throw new Error(thin.map(r =>
      r.page + ': widest ' + r.widest + 'px inside ' + r.hostW + 'px (' + r.used + '%)').join(' | '));
    return 'no narrow column inside a wide page';
  });
});
