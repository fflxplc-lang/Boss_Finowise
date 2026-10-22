/* TWO COLUMNS THAT ARE THE ADVISER'S, AND A SECTION THAT IS NOBODY'S.

   The firm asked for two things on Goal Based Planning.

   Inflation % and Expected Returns % are the adviser's to set. A
   client is asked what they want and when, not what rate to price it
   at, so those two columns come off the client's form and stay on the
   adviser's page. Off, not blanked: a hidden box carries whatever the
   adviser put there, because a column read back empty is a column the
   client wipes by answering.

   And Financial Freedom / Financial Independence leaves the blueprint
   altogether — the four questions, the fund they priced, its line in
   the plan table and its own card. Goal Based Planning plans for the
   goals it is given; freedom has a blueprint of its own.

   The raw browser, signed in by hand, because the two pages have to
   be told apart and the harness's shim opens everything. */
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

  /* The goals table as it stands on whichever page is open. */
  const goalsTable = () => page.evaluate(()=>{
    const t = document.querySelector('[data-formtable="mg_goals"]');
    if(!t) return {none:true};
    return {heads: Array.from(t.querySelectorAll('thead th')).map(h=>(h.textContent||'').trim()).filter(Boolean),
            hidden: Array.from(t.querySelectorAll('input[type=hidden]')).map(i=>i.id),
            /* The rendered form only. document.body carries the page's
               own script source, which names an unrelated setting
               "Financial Independence / Retirement" and matches
               anything looked for across the whole body. */
            text: ((document.getElementById('publicDocBody')
                 || document.getElementById('pfBody')
                 || {textContent:''}).textContent || '').replace(/\s+/g,' ')};
  });

  try {
    await signIn(page, BASE);
    await page.goto(BASE + '/', {waitUntil:'domcontentloaded'});
    await ready(page);

    const token = await page.evaluate(async ()=>{
      const l = {id:'LMS-MGCOL', firstName:'ZZ Goal', lastName:'Columns', mobile:'9800000099',
        email:'zz.mgcol@zz.in', assignedTo: currentUser, transformationForm:'MULTIGOAL',
        createdAt:new Date().toISOString(), dob:'1988-01-01'};
      initState('LMS', l); DB.leads.push(l);
      /* A goal the adviser has already priced. */
      l.formData = {MULTIGOAL:{mg_goals:[{goal:'ZZ Car', years:'5', inflation:'9',
        currentValue:'2500000', returns:'11'}]}};
      await save('leads');
      /* Minted the way Send it to the client mints it: the adviser's
         own answers ride along as the link's prefill. */
      /* With the questionnaire on it, which is what Send it to the
         client mints — and what decides the client sees the page with
         "Your details" on it rather than the bare template. */
      return await createDocLink(l.id, 'MULTIGOAL', {recordModule:'LMS', recordId: l.id,
        iseqType: Object.keys(ISEQ_BANK)[0], iseqToken:'',
        prefill: Object.assign(planFieldDefaults('MULTIGOAL'), leadFormData(l, 'MULTIGOAL'))});
    });

    await step('the adviser sets inflation and the expected return, on RM Working', async () => {
      await page.evaluate(async ()=>{
        openLeadFormFill('LMS-MGCOL','MULTIGOAL');
        /* RM Working opens once the Input Form is in, so put it in. */
        const l = DB.leads.find(x=>x.id === 'LMS-MGCOL');
        await markPlanInputSubmitted(l, 'Adviser');
        planFormStepGo('plan');
      });
      await page.waitForTimeout(500);
      const r = await goalsTable();
      if(r.none) throw new Error('the goals table is not on the adviser’s page');
      const want = ['Inflation %', 'Expected Returns %'];
      const miss = want.filter(w=>!r.heads.some(h=>h === w));
      if(miss.length) throw new Error('missing from the adviser’s table: ' + miss.join(', ')
        + ' — it reads ' + r.heads.join(' | '));
      return r.heads.filter(Boolean).join(' · ');
    });

    await step('and the client is not asked for either', async () => {
      await page.goto(BASE + '/?doc=' + token, {waitUntil:'domcontentloaded'});
      await page.waitForTimeout(1400);
      const r = await goalsTable();
      if(r.none) throw new Error('the goals table is not on the client’s form');
      const stray = r.heads.filter(h=>/inflation|expected returns/i.test(h));
      if(stray.length) throw new Error('still asked of the client: ' + stray.join(', '));
      if(!r.heads.some(h=>/goal \/ need/i.test(h))) throw new Error('the table lost its own columns too: '
        + r.heads.join(' | '));
      return r.heads.filter(Boolean).join(' · ');
    });

    await step('and answering does not wipe what the adviser set', async () => {
      const r = await page.evaluate(async ()=>{
        const row0 = document.getElementById('f_mg_goals_r0_goal');
        if(row0) row0.value = 'ZZ Car, as the client says it';
        const fields = (DB.config.formTemplates.MULTIGOAL || []);
        const read = readFormAnswers(fields);
        const first = (read.mg_goals || [])[0] || {};
        return {inflation: first.inflation, returns: first.returns, goal: first.goal};
      });
      if(r.inflation !== '9') throw new Error('inflation came back as ' + JSON.stringify(r.inflation));
      if(r.returns !== '11') throw new Error('the return came back as ' + JSON.stringify(r.returns));
      if(!/as the client says it/.test(String(r.goal))) throw new Error('the client’s own answer was lost');
      return 'the client renames the goal; 9% and 11% are still on the row';
    });

    t: {
      await step('Financial Freedom is gone from the form, both sides of it', async () => {
        const client = await goalsTable();
        if(/financial freedom|financial independence/i.test(client.text))
          throw new Error('the client’s form still carries it');
        await page.goto(BASE + '/', {waitUntil:'domcontentloaded'});
        await ready(page);
        await page.evaluate(()=>{ openLeadFormFill('LMS-MGCOL','MULTIGOAL'); });
        await page.waitForTimeout(500);
        const rm = await page.evaluate(()=>({
          text: ((document.getElementById('pfBody') || {textContent:''}).textContent || '').replace(/\s+/g,' '),
          heads: Array.from(document.querySelectorAll('.csec-title')).map(h=>(h.textContent||'').trim())}));
        if(/financial freedom|financial independence/i.test(rm.text))
          throw new Error('the adviser’s page still carries it');
        return 'headings left: ' + rm.heads.join(' · ');
      });
    }

    await step('and the plan no longer prices it', async () => {
      const r = await page.evaluate(()=>{
        const out = computeMultiGoalPlan({mg_goals:[{goal:'ZZ One', years:'5',
          inflation:'9', currentValue:'2500000', returns:'11'}],
          mg_inflWork:'7', mg_returnWork:'12',
          /* Answers a record written before this may still hold. */
          mg_ffInclude:'Yes', mg_ffMonthly:'100000', mg_ffYears:'20', mg_ffAge:'35', mg_lifeExp:'85'});
        const html = multiGoalPlanHtml(out);
        const d = document.createElement('div'); d.innerHTML = html;
        return {ff: out.ff, count: out.summary.goalCount, goals: out.goals.length,
                guide: out.allocationGuide.map(x=>x.label),
                lump: Math.round(out.summary.lumpsumTotal),
                text: (d.textContent || '').replace(/\s+/g,' ')};
      });
      if(r.ff) throw new Error('the engine still worked out a freedom fund');
      if(r.count !== r.goals) throw new Error('it counted ' + r.count + ' for ' + r.goals + ' goal(s)');
      if(r.guide.some(x=>/freedom/i.test(x))) throw new Error('the allocation still has a freedom line');
      if(/financial freedom/i.test(r.text)) throw new Error('the plan still prints it');
      if(!r.lump) throw new Error('the goals themselves came out at nothing');
      return 'one goal, ' + r.guide.join(', ') + ', and a lumpsum of ' + r.lump
        + ' — the old answers on the record change none of it';
    });

    await step('a firm already holding the old questions is brought across, once', async () => {
      const r = await page.evaluate(async ()=>{
        /* The template exactly as it shipped before, plus a question of
           the firm's own, which has to survive. */
        DB.config.formTemplates.MULTIGOAL = [
          {k:'mg_sec1', l:'Goals, needs and dreams', t:'section'},
          {k:'mg_goals', l:'Goals', t:'table', rows:3, maxRows:8, rowLabel:'Goal',
           cols:[{k:'goal', l:'Goal / Need / Dream'}, {k:'years', l:'No. of Years', t:'number'},
                 {k:'inflation', l:'Inflation %', t:'number'}, {k:'currentValue', l:'Current Value', t:'number'},
                 {k:'returns', l:'Expected Returns %', t:'number'}],
           note:'Leave inflation or returns blank and the assumptions below are used.'},
          {k:'mg_sec2', l:'Financial Freedom / Financial Independence', t:'section'},
          {k:'mg_ffInclude', l:'Plan for financial freedom as well?', t:'select', opts:['Yes','No']},
          {k:'mg_ffYears', l:'In how many years?', t:'number'},
          {k:'mg_ffAge', l:'Current Age', t:'number'},
          {k:'mg_ffMonthly', l:'Current monthly lifestyle', t:'number'},
          {k:'mg_sec3', l:'Assumptions', t:'section'},
          {k:'mg_inflWork', l:'Inflation during working years (%)', t:'number'},
          {k:'mg_returnWork', l:'Expected returns during working life (%)', t:'number'},
          {k:'mg_lifeExp', l:'Life expectancy (age)', t:'number'},
          {k:'zz_own', l:'ZZ a question the firm added', t:'text'},
        ];
        await save('config');
        const ran = await migrateMultiGoalBlueprint();
        const after = DB.config.formTemplates.MULTIGOAL;
        const again = await migrateMultiGoalBlueprint();
        const goals = after.find(f=>f.k === 'mg_goals') || {};
        return {ran, again,
                keys: after.map(f=>f.k),
                rm: (goals.cols || []).filter(c=>c.rmOnly).map(c=>c.k),
                cols: (goals.cols || []).map(c=>c.k),
                note: goals.note || '', noteRm: goals.noteRm || ''};
      });
      if(!r.ran) throw new Error('the migration did nothing to a template still holding the old questions');
      const left = r.keys.filter(k=>/^mg_ff|^mg_lifeExp$|^mg_sec2$/.test(k));
      if(left.length) throw new Error('still on the template: ' + left.join(', '));
      if(r.keys.indexOf('zz_own') < 0) throw new Error('it took the firm\u2019s own question with it');
      if(r.rm.join(',') !== 'inflation,returns')
        throw new Error('the adviser\u2019s columns read: ' + r.rm.join(', '));
      if(r.cols.length !== 5) throw new Error('a column was deleted rather than hidden: ' + r.cols.join(', '));
      if(r.note) throw new Error('the note is still shown to the client: ' + r.note);
      if(!r.noteRm) throw new Error('the note did not move to the adviser\u2019s side');
      if(r.again) throw new Error('it ran a second time');
      /* Every question of a section under that section's own heading.
         Filling the gaps one key at a time put Date and Country above
         the heading they belong to, loose at the top of the page. */
      const head = r.keys.indexOf('mg_sec0');
      if(head < 0) throw new Error('Section A is not on the template');
      const wantA = ['date','name','mobile','email','occupation','dob','city','country'];
      const gotA = r.keys.slice(head + 1, head + 1 + wantA.length);
      if(gotA.join(',') !== wantA.join(','))
        throw new Error('Section A reads ' + gotA.join(', ') + ' — and above the heading sits '
          + (r.keys.slice(0, head).join(', ') || 'nothing'));
      if(head !== 0) throw new Error(r.keys.slice(0, head).join(', ') + ' is above the first heading');
      const cash = r.keys.indexOf('mg_sec4');
      if(cash < 0) throw new Error('Section A2 is not on the template');
      if(r.keys.slice(cash + 1, cash + 4).join(',') !== 'mg_income,mg_expense,mg_liabilities')
        throw new Error('Section A2 reads ' + r.keys.slice(cash + 1, cash + 4).join(', '));
      return 'Financial Freedom and life expectancy off, both rate columns the adviser\u2019s, '
           + 'the firm\u2019s own question kept, every question under its own heading, '
           + 'and it does not run twice';
    });

    await step('the goals table opens on one row, and Add Goal makes the next', async () => {
      const r = await page.evaluate(async ()=>{
        /* A lead with nothing answered yet: what the client meets. */
        const l = {id:'LMS-MGROWS', firstName:'ZZ One', lastName:'Row', mobile:'9800000066',
          assignedTo: currentUser, transformationForm:'MULTIGOAL',
          createdAt:new Date().toISOString(), dob:'1990-01-01'};
        initState('LMS', l); DB.leads.push(l); await save('leads');
        openLeadFormFill(l.id, 'MULTIGOAL');
        await new Promise(r=>setTimeout(r, 300));
        const rows = () => document.querySelectorAll('[data-formtable="mg_goals"] tbody tr').length;
        const first = rows();
        addFormTableRow('mg_goals');
        await new Promise(r=>setTimeout(r, 300));
        const second = rows();
        /* And a record that already holds three keeps its three. */
        const l2 = {id:'LMS-MGROWS3', firstName:'ZZ Three', lastName:'Rows', mobile:'9800000067',
          assignedTo: currentUser, transformationForm:'MULTIGOAL',
          createdAt:new Date().toISOString(), dob:'1990-01-01',
          formData:{MULTIGOAL:{mg_goals:[{goal:'A'},{goal:'B'},{goal:'C'}]}}};
        initState('LMS', l2); DB.leads.push(l2); await save('leads');
        openLeadFormFill(l2.id, 'MULTIGOAL');
        await new Promise(r=>setTimeout(r, 300));
        return {first, second, answered: rows(),
                cap: (DB.config.formTemplates.MULTIGOAL.find(f=>f.k === 'mg_goals') || {}).maxRows};
      });
      if(r.first !== 1) throw new Error('it opens on ' + r.first + ' rows, not one');
      if(r.second !== 2) throw new Error('Add Goal took it to ' + r.second + ' rows');
      if(r.answered !== 3) throw new Error('a record holding three goals drew ' + r.answered + ' rows');
      if(r.cap !== 8) throw new Error('the cap moved: ' + r.cap);
      return 'one row to begin with, two after Add Goal, three where three are answered, eight at most';
    });

    await step('and a template already broken that way is put right', async () => {
      const r = await page.evaluate(async ()=>{
        /* Exactly what the gap-filling version left behind: Date and
           Country loose at the top, above the heading they belong to,
           and the heading counting six questions for eight boxes. */
        DB.config.formTemplates.MULTIGOAL = [
          {k:'date', l:'Date', t:'date', clientSkip:1, id:'FF-KEEPDATE'},
          {k:'country', l:'Country', t:'text', clientSkip:1},
          {k:'mg_sec0', l:'Your details', t:'section', clientSkip:1},
          {k:'name', l:'Name', t:'text', req:1, clientSkip:1},
          {k:'mobile', l:'Mobile', t:'text', req:1, clientSkip:1},
          {k:'email', l:'E-mail', t:'text', clientSkip:1},
          {k:'dob', l:'Date of birth', t:'date', clientSkip:1},
          {k:'city', l:'City', t:'text', clientSkip:1},
          {k:'occupation', l:'Occupation', t:'text', clientSkip:1},
          {k:'mg_sec1', l:'Goals, needs and dreams', t:'section', who:'both'},
          {k:'mg_goals', l:'Goals', t:'table', who:'both', rows:3,
           cols:[{k:'goal', l:'Goal / Need / Dream'}, {k:'years', l:'No. of Years', t:'number'},
                 {k:'inflation', l:'Inflation %', t:'number', rmOnly:1},
                 {k:'currentValue', l:'Current Value', t:'number'},
                 {k:'returns', l:'Expected Returns %', t:'number', rmOnly:1}]},
          {k:'zz_own', l:'ZZ the firm’s own question', t:'text'},
          {k:'mg_sec4', l:'Cashflow', t:'section'},
          {k:'mg_income', l:'Gross Family Income (₹ a month)', t:'number'},
          {k:'mg_expense', l:'Expense (₹ a month)', t:'number'},
          {k:'mg_liabilities', l:'Liabilities (₹ outstanding today)', t:'number'},
          {k:'mg_sec3', l:'Assumptions', t:'section', who:'rm'},
          {k:'mg_inflWork', l:'Inflation during working years (%)', t:'number', who:'rm'},
          {k:'mg_returnWork', l:'Expected returns during working life (%)', t:'number', who:'rm'},
        ];
        await save('config');
        const ran = await migrateMultiGoalBlueprint();
        const after = DB.config.formTemplates.MULTIGOAL;
        const again = await migrateMultiGoalBlueprint();
        const byK = k => after.find(f=>f.k === k) || {};
        return {ran, again, keys: after.map(f=>f.k),
                dateId: byK('date').id, occT: byK('occupation').t,
                incomeL: byK('mg_income').l, incomePh: byK('mg_income').ph};
      });
      if(!r.ran) throw new Error('the migration left a broken template as it found it');
      if(r.keys[0] !== 'mg_sec0')
        throw new Error('"' + r.keys[0] + '" is still above the first heading');
      const want = ['mg_sec0','date','name','mobile','email','occupation','dob','city','country'];
      if(r.keys.slice(0, want.length).join(',') !== want.join(','))
        throw new Error('Section A reads ' + r.keys.slice(0, want.length).join(', '));
      const cash = r.keys.indexOf('mg_sec4');
      if(r.keys.slice(cash + 1, cash + 4).join(',') !== 'mg_income,mg_expense,mg_liabilities')
        throw new Error('Section A2 reads ' + r.keys.slice(cash + 1, cash + 4).join(', '));
      if(r.keys.indexOf('zz_own') < 0) throw new Error('it lost the firm’s own question');
      if(r.dateId !== 'FF-KEEPDATE') throw new Error('an id already in use was replaced');
      if(r.occT !== 'select') throw new Error('Occupation is still a "' + r.occT + '"');
      if(r.incomePh !== 'a month' || /₹/.test(r.incomeL))
        throw new Error('Cashflow reads "' + r.incomeL + '" / "' + r.incomePh + '"');
      if(r.again) throw new Error('it ran a second time');
      return 'the loose fields come back under their heading in order, ids kept, '
           + 'the firm’s own question kept, and it settles after one pass';
    });

    await step('the client is asked the same facts the adviser is', async () => {
      await page.goto(BASE + '/?doc=' + token, {waitUntil:'domcontentloaded'});
      await page.waitForTimeout(1400);
      const r = await page.evaluate(()=>{
        const host = document.getElementById('publicDocBody');
        const val = k => (document.getElementById('f_' + k) || {}).value;
        const occ = document.getElementById('f_me_occupation');
        return {
          theirs: UNIFIED_BASICS.map(f=>f.k),
          labels: UNIFIED_BASICS.map(f=>f.l),
          /* Section A, read off the template rather than typed here. */
          sectionA: (DB.config.formTemplates.MULTIGOAL || [])
            .filter(f=>f.clientSkip && f.t !== 'section').map(f=>f.k),
          date: val('me_date'),
          name: val('me_name'),
          occIsSelect: !!(occ && occ.tagName === 'SELECT'),
          occOpts: (occ && occ.options) ? Array.from(occ.options).map(o=>o.value).filter(Boolean) : [],
          firmOcc: cfgLabels('se.list.OCC'),
          drawn: UNIFIED_BASICS.filter(f=>host && host.querySelector('#f_' + f.k)).length,
        };
      });
      /* Every fact Section A asks for, asked of the client too. */
      const gap = r.sectionA.filter(k=>r.theirs.indexOf('me_' + k) < 0);
      if(gap.length) throw new Error('the client is never asked: ' + gap.join(', '));
      /* And the three the onboarding needs are still asked. */
      const kept = ['me_pin','me_state','me_pan'].filter(k=>r.theirs.indexOf(k) < 0);
      if(kept.length) throw new Error('taken off the client’s page: ' + kept.join(', '));
      if(r.drawn !== r.theirs.length)
        throw new Error('only ' + r.drawn + ' of ' + r.theirs.length + ' are on the page');
      if(!r.occIsSelect) throw new Error('Occupation is not a dropdown on the client’s page');
      if(r.occOpts.slice(0, r.firmOcc.length).join('|') !== r.firmOcc.join('|'))
        throw new Error('Occupation offers ' + r.occOpts.join(', '));
      if(!/^\d{4}-\d{2}-\d{2}$/.test(String(r.date)))
        throw new Error('the date did not arrive answered: ' + JSON.stringify(r.date));
      if(!r.name) throw new Error('the name did not arrive filled in');
      return r.theirs.length + ' questions — ' + r.labels.join(', ');
    });

    await step('Cashflow is asked with their details, as Part B', async () => {
      /* Drawn again from the template as it stands now — the steps
         above rewrote it to test the migration. */
      await page.goto(BASE + '/?doc=' + token, {waitUntil:'domcontentloaded'});
      await page.waitForTimeout(1400);
      const r = await page.evaluate(()=>{
        const secs = Array.from(document.querySelectorAll('.csec'));
        const titles = secs.map(x=>((x.querySelector('.csec-title')||{}).textContent || '').trim());
        /* Which numbered step each heading falls under: the page is
           one column, so a heading belongs to the last step marker
           above it. */
        const marks = Array.from(document.querySelectorAll('#publicDocBody *'));
        const stepAt = el => {
          let n = 0;
          for(const node of marks){
            if(node === el || node.contains(el)) break;
            const t = (node.childElementCount ? '' : (node.textContent || '')).trim();
            if(t === '1') n = 1; else if(t === '2') n = 2;
          }
          return n;
        };
        const of = re => { const i = titles.findIndex(t=>re.test(t)); return i < 0 ? null : stepAt(secs[i]); };
        return {titles, basics: of(/your details/i), cash: of(/cashflow/i),
                goals: of(/goals, needs/i),
                income: !!document.getElementById('f_mg_income')};
      });
      if(!r.income) throw new Error('the cashflow questions are not on the client’s page at all');
      if(!r.titles.some(t=>/^Part A \u00b7 Your details$/.test(t)))
        throw new Error('the details card is not Part A: ' + r.titles.join(' | '));
      if(!r.titles.some(t=>/^Part B \u00b7 Cashflow$/.test(t)))
        throw new Error('Cashflow is not Part B: ' + r.titles.join(' | '));
      if(r.cash !== r.basics)
        throw new Error('Cashflow is under step ' + r.cash + ' and the details under ' + r.basics);
      if(r.goals === r.cash)
        throw new Error('the goals came up into the same step as the details');
      return r.titles.join('  |  ') + ' — Cashflow under the same step as the details, the goals under the next';
    });

    await step('and the thank-you page’s panels are the shape the others are', async () => {
      const r = await page.evaluate(()=>{
        const link = DB.docLinks.find(l=>l.recordId === 'LMS-MGCOL');
        renderUnifiedDone(link, {submittedAt:new Date().toISOString()},
          {score:26, max:100, category:'Moderately Conservative', type: Object.keys(ISEQ_BANK)[0]});
        /* Every panel the page is built from, and the corner it draws. */
        const panels = Array.from(document.querySelectorAll('.fx-main .fx-glass, .fx-main .card'));
        return panels.map(el=>{
          const st = getComputedStyle(el);
          return {cls: el.className.split(/\s+/).filter(c=>/^fx-|^card$/.test(c)).join(' '),
                  radius: Math.round(parseFloat(st.borderTopLeftRadius) || 0),
                  padLeft: Math.round(parseFloat(st.paddingLeft) || 0),
                  text: (el.textContent || '').replace(/\s+/g,' ').trim().slice(0, 28)};
        });
      });
      if(r.length < 3) throw new Error('only ' + r.length + ' panels on the page');
      const square = r.filter(x=>x.radius < 8);
      if(square.length)
        throw new Error(square.map(x=>'"' + x.text + '" (' + x.cls + ') is ' + x.radius + 'px').join('; '));
      const unpadded = r.filter(x=>x.padLeft < 8);
      if(unpadded.length)
        throw new Error('no padding on: ' + unpadded.map(x=>'"' + x.text + '"').join('; '));
      return r.length + ' panels, corners ' + r.map(x=>x.radius + 'px').join(' / ');
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
