/* "YOUR DETAILS" IS OPEN WHEN THE CLIENT ARRIVES.

   The firm asked for it on the FSL Input Form, and it is the same page
   for all four blueprints, so it is open on all of them: the first
   thing the client is asked for, mostly filled in from what the firm
   already holds, and the whole of step 1. Shut, the page looked as
   though it wanted nothing, and the checking could not start until
   somebody had clicked.

   Open by default is not the same as open always. The heading still
   works both ways — a client who shuts it finds it shut on the next
   redraw — and every other section of every other form is still shut
   until it is asked for, which collapse.js guards.

   This suite takes the raw browser and signs itself in, because the
   harness's shim opens every section and shut is half of what is
   being measured. */
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

  const linkFor = async (type) => page.evaluate(async (t)=>{
    const l = {id: uid('LMS'), firstName:'ZZ Open', lastName: t, mobile:'9800000031',
      email:'zz.open@zz.in', assignedTo: currentUser, branch: DB.config.branches[0],
      createdAt: new Date().toISOString(), transformationForm: t, dob:'1985-04-12'};
    initState('LMS', l); DB.leads.push(l); await save('leads');
    return await createDocLink(l.id, t, {recordModule:'LMS', recordId: l.id});
  }, type);

  /* What the client's eye lands on: the section headed "Your details",
     and whether its body is on the screen. */
  const basics = () => page.evaluate(()=>{
    const head = Array.from(document.querySelectorAll('.csec-head'))
      .find(h => /your details/i.test(h.textContent || ''));
    if(!head) return {none:true};
    const body = head.parentElement.querySelector('.csec-body');
    return {open: !body.hidden && body.offsetParent !== null,
            expanded: head.getAttribute('aria-expanded'),
            fields: body.querySelectorAll('input,select,textarea').length};
  });

  try {
    await signIn(page, BASE);
    await page.goto(BASE + '/', {waitUntil:'domcontentloaded'});
    await ready(page);

    const fsl = await linkFor('FSL');

    await step('the FSL client form arrives with Your details already open', async () => {
      await page.goto(BASE + '/?doc=' + fsl, {waitUntil:'domcontentloaded'});
      await page.waitForTimeout(1400);
      const r = await basics();
      if(r.none) throw new Error('there is no "Your details" section on the page');
      if(!r.open) throw new Error('it was shut on arrival');
      if(r.expanded !== 'true') throw new Error('it reads aria-expanded="' + r.expanded + '" to a screen reader');
      if(!r.fields) throw new Error('it is open on nothing');
      return 'open on arrival, ' + r.fields + ' fields on screen';
    });

    await step('and it still shuts, and re-opens, when the heading is pressed', async () => {
      const shut = await page.evaluate(async ()=>{
        Array.from(document.querySelectorAll('.csec-head'))
          .find(h => /your details/i.test(h.textContent || '')).click();
        await new Promise(r=>setTimeout(r, 200));
      }).then(basics);
      if(shut.open) throw new Error('pressing the heading did not shut it');
      const again = await page.evaluate(async ()=>{
        Array.from(document.querySelectorAll('.csec-head'))
          .find(h => /your details/i.test(h.textContent || '')).click();
        await new Promise(r=>setTimeout(r, 200));
      }).then(basics);
      if(!again.open) throw new Error('pressing it again did not re-open it');
      return 'shuts on the first press, opens on the second — a default, not a lock';
    });

    await step('a client who shut it finds it shut after a redraw', async () => {
      await page.evaluate(async ()=>{
        Array.from(document.querySelectorAll('.csec-head'))
          .find(h => /your details/i.test(h.textContent || '')).click();
        await new Promise(r=>setTimeout(r, 150));
        if(typeof refreshRenderedForm === 'function') refreshRenderedForm();
        await new Promise(r=>setTimeout(r, 300));
      });
      const r = await basics();
      if(r.open) throw new Error('the redraw re-opened a section the client had shut');
      return 'still shut after the page redrew itself';
    });

    /* Goal Based Planning is not on this list on purpose: its client link
       draws the plain form page, which has no "Your details" card to open.
       The three that share the unified page are the three checked. */
    await step('the other blueprints on this page open too', async () => {
      const out = [];
      for(const type of ['SEVENEVENTS','GAB']){
        /* Back to the app first: a doc link is made from the signed-in
           page, and the one we are on booted into public mode. */
        await page.goto(BASE + '/', {waitUntil:'domcontentloaded'});
        await ready(page);
        const tok = await page.evaluate(async (t)=>{
          const l = {id: uid('LMS'), firstName:'ZZ Open', lastName: t, mobile:'9800000032',
            email:'zz.open2@zz.in', assignedTo: currentUser, branch: DB.config.branches[0],
            createdAt: new Date().toISOString(), transformationForm: t, dob:'1985-04-12'};
          initState('LMS', l); DB.leads.push(l); await save('leads');
          return await createDocLink(l.id, t, {recordModule:'LMS', recordId: l.id});
        }, type);
        await page.goto(BASE + '/?doc=' + tok, {waitUntil:'domcontentloaded'});
        await page.waitForTimeout(1400);
        const r = await basics();
        if(r.none || !r.open) out.push(type);
      }
      if(out.length) throw new Error('shut on: ' + out.join(', '));
      return '7 Events and GAB arrive with it open as well';
    });

    await step('and nothing else on the page was opened with it', async () => {
      const r = await page.evaluate(()=>{
        const b = Array.from(document.querySelectorAll('.csec'));
        return b.map(s=>({
          title: (s.querySelector('.csec-title')||{}).textContent || '',
          open: !s.querySelector(':scope > .csec-body').hidden}));
      });
      const stray = r.filter(s=>s.open && !/your details/i.test(s.title));
      if(stray.length) throw new Error('also open: ' + stray.map(s=>s.title).join(', '));
      return r.length + ' sections on the page, only Your details open';
    });

    if(errors.length){ console.log('\n' + errors.length + ' PROBLEM(S):'); errors.forEach(e=>console.log(e)); }
    else console.log('\nALL CLEAN');
  } catch (e) {
    console.log('FAIL  the suite itself fell over — ' + e.message);
    console.log('\n1 PROBLEM(S):');
  } finally {
    await b.close().catch(()=>{});
  }
  process.exit(errors.length ? 1 : 0);
})();
