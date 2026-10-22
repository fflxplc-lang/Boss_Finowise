/* THE INPUT FORM IS OPEN DOWN THE PAGE, NOT SHUT INTO HEADINGS.

   Goal Based Planning's form moved out of a dialog onto a page of its
   own, and arrived there still folded into three headings with a
   question count beside each. A page an adviser works top to bottom
   is read, not navigated: shut, it is the dialog again with more
   whitespace. So its headings start open.

   Open by default is not open always. The heading still works both
   ways, and the client's own pages are untouched — they keep the
   headings shut, which is what the firm asked for there, and this
   guards that too.

   The raw browser, signed in by hand, because the harness's shim
   answers yes to every section: under it this page looked open before
   a line of it was, which is exactly how the first attempt shipped
   folded. Shut is half of what is being measured, so the shim cannot
   be in the room. */
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

  /* Every heading on the page, and whether its body is on the screen. */
  const sections = () => page.evaluate(()=>
    Array.from(document.querySelectorAll('.csec')).map(s=>{
      const body = s.querySelector(':scope > .csec-body');
      const head = s.querySelector(':scope > .csec-head');
      return {title: ((s.querySelector('.csec-title')||{}).textContent || '').trim(),
              open: !!body && !body.hidden && body.offsetParent !== null,
              expanded: head ? head.getAttribute('aria-expanded') : '',
              fields: body ? body.querySelectorAll('input,select,textarea').length : 0};
    }));

  try {
    await signIn(page, BASE);
    await page.goto(BASE + '/', {waitUntil:'domcontentloaded'});
    await ready(page);

    await page.evaluate(async ()=>{
      const l = {id:'LMS-PFOPEN', firstName:'ZZ Open', lastName:'Goal', mobile:'9800000077',
        email:'zz.open.goal@zz.in', assignedTo: currentUser,
        transformationForm:'MULTIGOAL', createdAt:new Date().toISOString()};
      initState('LMS', l); DB.leads.push(l); await save('leads');
    });

    await step('the adviser’s page arrives with every heading open', async () => {
      await page.evaluate(()=>{ openLeadFormFill('LMS-PFOPEN','MULTIGOAL'); });
      await page.waitForTimeout(500);
      const r = await sections();
      if(!r.length) throw new Error('the page drew no headings at all');
      const shut = r.filter(s=>!s.open);
      if(shut.length) throw new Error(shut.length + ' of ' + r.length + ' still shut: '
        + shut.map(s=>s.title).join(', '));
      const mute = r.filter(s=>s.expanded !== 'true');
      if(mute.length) throw new Error('reads shut to a screen reader: ' + mute.map(s=>s.title).join(', '));
      const empty = r.filter(s=>!s.fields);
      if(empty.length) throw new Error('open on nothing: ' + empty.map(s=>s.title).join(', '));
      return r.length + ' heading(s) open on arrival — '
        + r.map(s=>s.title + ' (' + s.fields + ')').join(', ');
    });

    await step('and a heading still shuts and re-opens when it is pressed', async () => {
      const press = async () => {
        await page.evaluate(async ()=>{
          const h = document.querySelector('.csec-head');
          if(h) h.click();
          await new Promise(r=>setTimeout(r, 200));
        });
        return (await sections())[0];
      };
      const shut = await press();
      if(shut.open) throw new Error('pressing the heading did not shut it');
      const again = await press();
      if(!again.open) throw new Error('pressing it again did not re-open it');
      return 'shuts on the first press, opens on the second — a default, not a lock';
    });

    await step('the client’s own form is left folded, as the firm wants it', async () => {
      const token = await page.evaluate(async ()=>{
        const l = {id: uid('LMS'), firstName:'ZZ Client', lastName:'Goal', mobile:'9800000078',
          email:'zz.client.goal@zz.in', assignedTo: currentUser,
          transformationForm:'MULTIGOAL', createdAt:new Date().toISOString(), dob:'1986-02-02'};
        initState('LMS', l); DB.leads.push(l); await save('leads');
        return await createDocLink(l.id, 'MULTIGOAL', {recordModule:'LMS', recordId: l.id});
      });
      await page.goto(BASE + '/?doc=' + token, {waitUntil:'domcontentloaded'});
      await page.waitForTimeout(1400);
      const r = await sections();
      if(!r.length) throw new Error('the client’s page drew no headings');
      const open = r.filter(s=>s.open && !/your details/i.test(s.title));
      if(open.length) throw new Error('open on the client’s page: ' + open.map(s=>s.title).join(', '));
      return r.length + ' heading(s), and only Your details open — the client’s page is unchanged';
    });

    if(errors.length){ console.log('\n' + errors.length + ' PROBLEM(S):'); errors.forEach(e=>console.log(e)); }
    else console.log('\nALL CLEAN');
  } catch (e) {
    console.log('FAIL  the suite itself fell over — ' + e.message);
    errors.push('FAIL  the suite itself fell over — ' + e.message);
    console.log('\n1 PROBLEM(S):');
  } finally {
    await b.close().catch(()=>{});
  }
  process.exit(errors.length ? 1 : 0);
})();
