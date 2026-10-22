/* SECTIONS SHUT, AS A PERSON MEETS THEM.

   Modification 19: every section of every form starts collapsed, for the
   user and for the client; clicking the heading opens it; clicking again
   shuts it; and nothing typed is lost either way.

   This is the one suite that must NOT use the harness's open-everything
   shim, because shut is the thing being checked — so it takes the raw
   browser and signs itself in. */
const {raw} = require('../lib/pw');
const signIn = require('../lib/signin');
const ready = require('../lib/ready');

const PORT = Number(process.env.BOSS_PORT || 3000);
const BASE = 'http://localhost:' + PORT;

(async () => {
  const errors = [];
  const b = await raw.launch({executablePath: process.env.BOSS_CHROME
    || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const page = await b.newPage({viewport:{width:1500, height:950}});
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', async d => await d.accept().catch(()=>{}));

  const step = async (name, fn) => {
    try { const note = await fn(); console.log('ok    ' + name + (note ? '  — ' + note : '')); }
    catch(e){ errors.push('FAIL  ' + name + ' — ' + e.message); console.log('FAIL  ' + name + ' — ' + e.message); }
  };

  try {
    await signIn(page, BASE);
    await page.goto(BASE + '/', {waitUntil:'domcontentloaded'});
    await ready(page);

    await step('the collapse layer is there, and starts empty', async () => {
      const r = await page.evaluate(()=>({
        store: typeof window._secOpen === 'object' && window._secOpen !== null,
        fns: ['sectionIsOpen','toggleSection','collapsibleSectionHtml','sectionKeyOf']
          .filter(f => typeof window[f] !== 'function'),
        open: Object.keys(window._secOpen || {}).filter(k => window._secOpen[k]).length,
      }));
      if(!r.store) throw new Error('there is no _secOpen store');
      if(r.fns.length) throw new Error('missing: ' + r.fns.join(', '));
      if(r.open) throw new Error(r.open + ' sections are open before anybody clicked one');
      return 'store present, nothing open';
    });

    const token = await page.evaluate(async ()=>{
      const c = {id:uid('CMS'), cmsName:'ZZ Collapse Client', rmName:currentUser,
        createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('CMS', c); DB.clients.push(c); await save('clients');
      return await createDocLink(null, 'CIF', {recordModule:'CMS', recordId:c.id});
    });

    await step('a client meets the form with every section shut', async () => {
      await page.goto(BASE + '/?doc=' + token, {waitUntil:'domcontentloaded'});
      await page.waitForTimeout(1400);
      const r = await page.evaluate(()=>{
        const heads = Array.from(document.querySelectorAll('.csec-head'));
        const bodies = Array.from(document.querySelectorAll('.csec-body'));
        return {heads: heads.length, bodies: bodies.length,
                open: bodies.filter(b => !b.hidden && b.offsetParent !== null).length};
      });
      if(!r.heads) throw new Error('the form drew no collapsible sections at all');
      if(r.open) throw new Error(r.open + ' of ' + r.bodies + ' sections were open on arrival');
      return r.heads + ' sections, all shut';
    });

    await step('clicking a heading opens it, and clicking again shuts it', async () => {
      const opened = await page.evaluate(async ()=>{
        const head = document.querySelector('.csec-head');
        head.click();
        await new Promise(r=>setTimeout(r, 200));
        const body = head.parentElement.querySelector('.csec-body');
        return {open: !body.hidden, fields: body.querySelectorAll('input,select,textarea').length};
      });
      if(!opened.open) throw new Error('the section did not open');
      if(!opened.fields) throw new Error('it opened on nothing');
      const shut = await page.evaluate(async ()=>{
        const head = document.querySelector('.csec-head');
        head.click();
        await new Promise(r=>setTimeout(r, 200));
        return head.parentElement.querySelector('.csec-body').hidden;
      });
      if(!shut) throw new Error('clicking again did not shut it');
      return 'opened on ' + opened.fields + ' fields, then shut again';
    });

    await step('shutting a section does not lose what was typed in it', async () => {
      const r = await page.evaluate(async ()=>{
        // whichever section is the first to hold a text box — the CIF's
        // opening section is two dropdowns, and a dropdown proves nothing
        // about keeping what was typed
        const heads = Array.from(document.querySelectorAll('.csec-head'));
        let head = null, input = null;
        for(const h of heads){
          h.click(); await new Promise(r=>setTimeout(r, 180));
          const i = h.parentElement.querySelector('.csec-body input[type=text]');
          if(i){ head = h; input = i; break; }
          h.click(); await new Promise(r=>setTimeout(r, 120));
        }
        if(!input) return {err:'no section on this form holds a text field'};
        const id = input.id;
        input.value = 'Kept through a fold';
        input.dispatchEvent(new Event('change', {bubbles:true}));
        head.click(); await new Promise(r=>setTimeout(r, 200));   // shut
        head.click(); await new Promise(r=>setTimeout(r, 250));   // and open again
        const again = document.getElementById(id);
        return {err:null, value: again ? again.value : null};
      });
      if(r.err) throw new Error(r.err);
      if(r.value !== 'Kept through a fold') throw new Error('it came back as "' + r.value + '"');
      return 'the answer survived the fold';
    });
  } catch(e){
    errors.push('SUITE CRASHED: ' + (e && e.message));
  } finally {
    await b.close().catch(()=>{});
  }

  if(errors.length){ console.log('\n' + errors.length + ' PROBLEM(S):\n' + errors.join('\n')); process.exitCode = 1; }
  else console.log('\nALL CLEAN');
})();
