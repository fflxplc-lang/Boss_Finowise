/* THE DISCLOSURE IS SHUT UNTIL IT IS WANTED.

   Forty paragraphs of statutory text under every plan pushed the page it
   belongs to off the screen. The firm asked for it packed away behind its
   own heading, opening on a click.

   The three things this has to get right. Nothing is dropped — every
   point Setup holds is in there, word for word, and the heading says how
   many. The printed report still sets them all out, because paper has
   nothing to click. And the client's own consent page is untouched: it
   keeps its three opening lines, its Show More and its acknowledgement
   tick, because a disclosure somebody is about to agree to is not the
   same as one printed under a working page.

   Raw browser and its own sign-in, because shut is the thing being
   measured and the harness shim opens every section. */
const {raw} = require('../lib/pw');
const signIn = require('../lib/signin');
const ready = require('../lib/ready');

const BASE = 'http://localhost:' + (process.env.BOSS_PORT || 3000);

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

    await step('it draws shut, under a heading that says what is in it', async () => {
      const r = await page.evaluate(()=>{
        const host = document.createElement('div');
        host.innerHTML = planDisclaimerHtml();
        document.body.appendChild(host);
        const sec = host.querySelector('.csec');
        const body = host.querySelector('.csec-body');
        const out = {
          sec: !!sec,
          open: sec ? sec.classList.contains('open') : null,
          hidden: body ? body.hidden : null,
          title: (host.querySelector('.csec-title')||{}).textContent || '',
          note: (host.querySelector('.csec-note')||{}).textContent || '',
          expanded: (host.querySelector('.csec-head')||{getAttribute:()=>null}).getAttribute('aria-expanded'),
          lines: planDisclosureLines().length,
          paras: host.querySelectorAll('.plan-disc p').length,
          text: host.textContent,
        };
        host.remove();
        return out;
      });
      if(!r.sec) throw new Error('it is not a section that can be shut at all');
      if(r.open || r.hidden !== true) throw new Error('it draws open');
      if(r.expanded !== 'false') throw new Error('it reads aria-expanded="' + r.expanded + '"');
      if(!/disclaimer|disclosure/i.test(r.title)) throw new Error('the heading reads "' + r.title + '"');
      if(r.note.indexOf(String(r.lines)) < 0)
        throw new Error('the heading does not say how many points: "' + r.note + '"');
      if(r.paras !== r.lines)
        throw new Error('it holds ' + r.paras + ' of the ' + r.lines + ' points Setup carries');
      return r.lines + ' points, shut, under "' + r.title.trim() + ' · ' + r.note.trim() + '"';
    });

    await step('every word Setup holds is inside it, not summarised', async () => {
      const r = await page.evaluate(()=>{
        const host = document.createElement('div');
        host.innerHTML = planDisclaimerHtml();
        const got = Array.from(host.querySelectorAll('.plan-disc p')).map(p=>p.textContent);
        const want = planDisclosureLines();
        return {missing: want.filter(l=>got.indexOf(l) < 0).slice(0, 3),
                note: host.textContent.indexOf(PLAN_PROJECTION_NOTE) >= 0, n: want.length};
      });
      if(r.missing.length) throw new Error('not carried through: ' + r.missing.join(' | '));
      if(!r.note) throw new Error('the projection note is not in there');
      return 'all ' + r.n + ' points word for word, plus the projection note';
    });

    await step('the heading opens it, and shuts it again', async () => {
      const r = await page.evaluate(async ()=>{
        const host = document.createElement('div');
        host.innerHTML = planDisclaimerHtml();
        document.body.appendChild(host);
        const head = host.querySelector('.csec-head');
        head.click(); await new Promise(r=>setTimeout(r, 150));
        const opened = !host.querySelector('.csec-body').hidden;
        head.click(); await new Promise(r=>setTimeout(r, 150));
        const shut = host.querySelector('.csec-body').hidden;
        host.remove();
        return {opened, shut};
      });
      if(!r.opened) throw new Error('clicking the heading did not open it');
      if(!r.shut) throw new Error('clicking it again did not shut it');
      return 'opens on the first press, shuts on the second';
    });

    await step('the client’s consent page is left as it was', async () => {
      const r = await page.evaluate(()=>{
        const host = document.createElement('div');
        host.innerHTML = planDisclosureHtml({preview:true});
        return {head: host.querySelectorAll('#discHead p').length,
                more: !!host.querySelector('#discMore'),
                csec: !!host.querySelector('.csec'),
                rest: host.querySelector('#discRest') ? host.querySelector('#discRest').style.display : null};
      });
      if(r.head !== 3) throw new Error('it opens on ' + r.head + ' lines, not three');
      if(!r.more) throw new Error('Show More is gone from it');
      if(r.rest !== 'none') throw new Error('the rest of it is not folded away');
      if(r.csec) throw new Error('the consent page was given the shut-by-default panel too');
      return 'three lines, Show More under them, the rest folded — unchanged';
    });

    await step('the printed report still sets every line out', async () => {
      const r = await page.evaluate(()=>{
        const src = String(window.planReportBlocks || '') + String(window.buildPlanPdfBlocks || '');
        return {lines: planDisclosureLines().length,
                src: /planDisclosureLines\(\)\.forEach/.test(
                  Array.from(document.querySelectorAll('script')).map(s=>s.textContent).join(''))};
      });
      if(!r.src) throw new Error('the report no longer walks the disclosure lines');
      return 'the PDF path still lays out all ' + r.lines + ' of them';
    });

    if(errors.length){ console.log('\n' + errors.length + ' PROBLEM(S):'); errors.forEach(e=>console.log(e)); }
    else console.log('\nALL CLEAN');
  } catch (e) {
    console.log('FAIL  the suite itself fell over — ' + e.message);
    console.log('\n1 PROBLEM(S):');
    errors.push(e.message);
  } finally {
    await b.close().catch(()=>{});
  }
  process.exit(errors.length ? 1 : 0);
})();
