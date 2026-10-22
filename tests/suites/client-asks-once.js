/* THE CLIENT IS ASKED EACH THING ONCE.

   Their page opens with "Your details" — one section for every
   blueprint — and then the blueprint's own questions. Both can ask
   for the same fact, and the way a blueprint says "already answered
   up there" is fromBasics on the field: it takes the field off the
   client's copy of the section and carries their answer into the
   sheet. Name and Mobile have carried one since there were two places
   to ask them.

   Occupation, Country and the Date did not, because until the firm
   asked for them "Your details" never offered them — so the moment it
   did, the ladder asked for all three twice and the seven events for
   Occupation twice.

   This counts the labels on each blueprint's client page rather than
   checking the three by name: the next field added to the shared
   section is caught by the same test, which is the point of counting
   rather than listing. */
const {raw} = require('../lib/pw');
const signIn = require('../lib/signin');
const ready = require('../lib/ready');

const PORT = Number(process.env.BOSS_PORT || 3000);
const BASE = 'http://localhost:' + PORT;

(async () => {
  const errors = [];
  const b = await raw.launch({executablePath: process.env.BOSS_CHROME
    || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const page = await b.newPage({viewport:{width:1500, height:1000}});
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', async d => await d.accept().catch(()=>{}));

  const step = async (name, fn) => {
    try { const note = await fn(); console.log('ok    ' + name + (note ? '  — ' + note : '')); }
    catch(e){ errors.push('FAIL  ' + name + ' — ' + e.message); console.log('FAIL  ' + name + ' — ' + e.message); }
  };

  const askedOn = async (type) => {
    await page.goto(BASE + '/', {waitUntil:'domcontentloaded'});
    await ready(page);
    const token = await page.evaluate(async t=>{
      const l = {id:'LMS-ONCE-' + t, firstName:'ZZ Once', lastName:t, mobile:'9800000056',
        email:'once@zz.in', assignedTo: currentUser, transformationForm:t,
        createdAt:new Date().toISOString(), dob:'1990-05-05'};
      initState('LMS', l); DB.leads.push(l); await save('leads');
      return await createDocLink(l.id, t, {recordModule:'LMS', recordId: l.id});
    }, type);
    await page.goto(BASE + '/?doc=' + token, {waitUntil:'domcontentloaded'});
    await page.waitForTimeout(1500);
    return page.evaluate(()=>{
      const labels = Array.from(document.querySelectorAll('#publicDocBody label'))
        .map(l=>(l.textContent || '').replace(/\s*\*/, '').replace(/\s+/g,' ').trim())
        .filter(Boolean);
      const seen = {};
      labels.forEach(l=>{ seen[l] = (seen[l] || 0) + 1; });
      return {labels, twice: Object.keys(seen).filter(k=>seen[k] > 1)};
    });
  };

  try {
    await signIn(page, BASE);

    for(const type of ['FSL','GAB','SEVENEVENTS','MULTIGOAL']){
      await step(type + ' asks nothing twice', async () => {
        const r = await askedOn(type);
        if(!r.labels.length) throw new Error('the page asked nothing at all');
        if(r.twice.length)
          throw new Error('asked twice: ' + r.twice.join(', ') + ' — of ' + r.labels.length + ' questions');
        return r.labels.length + ' questions, each asked once';
      });
    }

    await step('and the shared section is still where they are asked', async () => {
      const r = await page.evaluate(()=>({
        basics: UNIFIED_BASICS.map(f=>f.l),
        /* Every blueprint that asks one of these answers it from the
           section rather than asking again. */
        mapped: [['FSL', fslBasicsMap], ['SEVENEVENTS', seBasicsMap], ['GAB', gabBasicsMap]]
          .map(([t, fn])=>({t, keys: Object.keys(fn() || {})})),
      }));
      const want = ['me_occupation','me_country','me_date'];
      const fsl = (r.mapped.find(x=>x.t === 'FSL') || {}).keys || [];
      const miss = want.filter(k=>fsl.indexOf(k) < 0);
      if(miss.length) throw new Error('the ladder does not take these from the section: ' + miss.join(', '));
      const se = (r.mapped.find(x=>x.t === 'SEVENEVENTS') || {}).keys || [];
      if(se.indexOf('me_occupation') < 0)
        throw new Error('the seven events does not take me_occupation from the section');
      return 'the section asks ' + r.basics.length + '; the ladder takes '
           + fsl.length + ' of them rather than asking again';
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
