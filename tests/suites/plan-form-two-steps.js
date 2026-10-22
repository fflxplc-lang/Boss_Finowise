/* GOAL BASED PLANNING WORKS THE WAY THE LADDER DOES.

   Input Form, then RM Working. The client says who they are, what
   they want and what the month looks like; the adviser prices it.
   One template, split by whose question each one is — `who` left off
   means the client's, 'rm' the adviser's, 'both' drawn on each,
   which the goals table needs.

   Three things this guards.

   That RM Working waits for the Input Form, because there is nothing
   to price until the client has said what they want.

   That saving one page does not blank the other. Every box that is
   not drawn reads as '', so a form split across two pages will wipe
   the page it is not on unless the saver only reads what is there —
   which is the whole reason formFieldsOnScreen exists.

   And that the client is not asked their name twice: their page has
   a "Your details" of its own for every blueprint, so the blueprint's
   copy of it is the adviser's view of the same answers. */
const {suite} = require('../lib/harness');

const SEED = `async function(){
  let l = DB.leads.find(x=>x.id === 'LMS-TWOSTEP');
  if(!l){ l = {id:'LMS-TWOSTEP'}; DB.leads.push(l); }
  Object.assign(l, {firstName:'ZZ Two', lastName:'Step', mobile:'9800222333',
    email:'two@example.com', assignedTo: currentUser, transformationForm:'MULTIGOAL',
    createdAt:new Date().toISOString(), dob:'1987-03-03'});
  if(!stateOf('LMS', l)) initState('LMS', l);
  delete l.planInputSubmittedAt;
  l.planRounds = [];
  l.formData = {MULTIGOAL:{}};
  await save('leads');
  return l.id;
}`;

suite(async t => {
  await t.home();

  t.section('two pages, in the ladder’s order');

  await t.step('the Input Form asks the client’s questions, RM Working the adviser’s', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const id = await (${SEED})();
      openLeadFormFill(id, 'MULTIGOAL');
      const heads = () => Array.from(document.querySelectorAll('#pfBody .csec-title'))
        .map(x=>(x.textContent||'').trim());
      const tabs = Array.from(document.querySelectorAll('.tab')).map(x=>(x.textContent||'').trim());
      const input = heads();
      const shutWhy = planFormStepOpen('plan', planRecordOf(id), 'MULTIGOAL');
      /* Put the Input Form in, the way Submit does. */
      await markPlanInputSubmitted(planRecordOf(id), 'Adviser');
      planFormStepGo('plan');
      return {tabs, input, plan: heads(), id,
              openedBefore: shutWhy,
              execOpen: planFormStepOpen('exec', planRecordOf(id), 'MULTIGOAL'),
              openedAfter: planFormStepOpen('plan', planRecordOf(id), 'MULTIGOAL')};
    })()`));
    /* A third step joined these two: the Required Execution Plan, which
       is not part of filling the form in — it opens after the senior has
       signed the advice off, and is shut here. What this suite is about
       is the two that are, and that they come in the ladder's order. */
    if(r.tabs.slice(0, 2).join(' | ') !== 'Input Form | RM Working')
      throw new Error('the tabs read: ' + r.tabs.join(' | '));
    if(r.execOpen) throw new Error('the Required Execution Plan was open before approval');
    if(r.openedBefore) throw new Error('RM Working was open before the Input Form was in');
    if(!r.openedAfter) throw new Error('RM Working did not open once the Input Form was in');
    const wantInput = ['Personal Information', 'Goals, needs and dreams', 'Cashflow'];
    const missing = wantInput.filter(w=>!r.input.some(h=>h.indexOf(w) >= 0));
    if(missing.length) throw new Error('the Input Form is missing: ' + missing.join(', ')
      + ' — it has ' + r.input.join(', '));
    if(r.plan.some(h=>/cashflow|personal information/i.test(h)))
      throw new Error('RM Working repeats the client’s sections: ' + r.plan.join(', '));
    if(!r.plan.some(h=>/assumptions/i.test(h)))
      throw new Error('RM Working has no Assumptions: ' + r.plan.join(', '));
    return 'Input Form — ' + r.input.join(', ') + '  /  RM Working — ' + r.plan.join(', ');
  });

  await t.step('what the firm already holds is already filled in', async () => {
    const r = await t.eval(async ()=>{
      /* A lead the firm knows plenty about, opened for the first time. */
      let l = DB.leads.find(x=>x.id === 'LMS-SEED');
      if(!l){ l = {id:'LMS-SEED'}; DB.leads.push(l); }
      Object.assign(l, {firstName:'ZZ Known', lastName:'Lead', mobile:'9800555444',
        email:'known@example.com', dob:'1984-06-06', city:'Varanasi',
        profession:'Engineer', assignedTo: currentUser, transformationForm:'MULTIGOAL',
        createdAt:new Date().toISOString()});
      if(!stateOf('LMS', l)) initState('LMS', l);
      delete l.formData;
      await save('leads');
      openLeadFormFill(l.id, 'MULTIGOAL');
      const box = k => (document.getElementById('f_' + k) || {}).value;
      const held = (planRecordOf('LMS-SEED').formData || {}).MULTIGOAL || {};
      return {missing: planInputMissing(planRecordOf('LMS-SEED'), 'MULTIGOAL').map(f=>f.l),
              shown: {name: box('name'), mobile: box('mobile'), email: box('email'),
                      dob: box('dob'), city: box('city')},
              held: {name: held.name, mobile: held.mobile}};
    });
    const blank = Object.keys(r.shown).filter(k=>!r.shown[k]);
    if(blank.length) throw new Error('still empty on the page: ' + blank.join(', '));
    if(!/ZZ Known/.test(String(r.shown.name))) throw new Error('the name reads "' + r.shown.name + '"');
    if(r.missing.length)
      throw new Error('it still asks for: ' + r.missing.join(', ') + ' — which the firm already holds');
    if(!r.held.name || !r.held.mobile)
      throw new Error('shown but not stored, so the first keystroke would blank it');
    return 'name, mobile, e-mail, date of birth and city all filled from the record, and stored';
  });

  await t.step('and saving one page does not blank the other', async () => {
    const r = await t.eval(async ()=>{
      const id = 'LMS-TWOSTEP';
      /* Back on this lead's own page, at RM Working — the step above
         left the browser on a different record. */
      openLeadFormFill(id, 'MULTIGOAL');
      planFormStepGo('plan');
      /* The adviser prices it on RM Working. */
      const infl = document.getElementById('f_mg_inflWork');
      const ret  = document.getElementById('f_mg_returnWork');
      if(!infl || !ret) return {none:'the assumptions are not on RM Working'};
      infl.value = '8'; ret.value = '13';
      savePlanFormPage();
      /* Back to the Input Form, where none of those boxes exist. */
      planFormStepGo('input');
      const name = document.getElementById('f_name');
      if(!name) return {none:'the client’s questions are not on the Input Form'};
      name.value = 'ZZ Typed On Input';
      savePlanFormPage();
      const held = (planRecordOf(id).formData || {}).MULTIGOAL || {};
      return {infl: held.mg_inflWork, ret: held.mg_returnWork, name: held.name};
    });
    if(r.none) throw new Error(r.none);
    if(r.infl !== '8' || r.ret !== '13')
      throw new Error('the adviser’s rates came back as ' + JSON.stringify([r.infl, r.ret])
        + ' after saving the Input Form');
    if(r.name !== 'ZZ Typed On Input') throw new Error('the client’s answer was not kept');
    return 'the rates survive a save from the other page, and the Input Form’s own answer lands';
  });

  await t.step('and the client is not asked their name twice', async () => {
    const r = await t.eval(()=>{
      const all = DB.config.formTemplates.MULTIGOAL || [];
      const theirs = clientFormFields('MULTIGOAL');
      const skipped = all.filter(f=>f.clientSkip).map(f=>f.k);
      return {all: all.length, theirs: theirs.length, skipped,
              heads: theirs.filter(f=>f.t === 'section').map(f=>f.l),
              basics: UNIFIED_BASICS.map(f=>f.l)};
    });
    if(!r.skipped.length) throw new Error('nothing is held back from the client');
    if(r.heads.some(h=>/personal information/i.test(h)))
      throw new Error('the client is asked for their details twice — their page already has a section for it');
    if(!r.heads.some(h=>/goals/i.test(h)) || !r.heads.some(h=>/cashflow/i.test(h)))
      throw new Error('the client lost a section they should be asked: ' + r.heads.join(', '));
    /* And the adviser's own page is not shown to them either: the
       rates are the whole point of the split. */
    if(r.heads.some(h=>/assumptions/i.test(h)))
      throw new Error('the client is shown the adviser’s Assumptions: ' + r.heads.join(', '));
    return 'the client is asked ' + r.heads.join(', ') + '; their details come from the page’s own first '
         + 'section, and the rates are the adviser’s';
  });

  t.section('it asks what the ladder asks');

  await t.step('Section A and A2 match the FSL Input Form field for field', async () => {
    const r = await t.eval(()=>{
      openLeadFormFill('LMS-SEED', 'MULTIGOAL');
      const all = DB.config.formTemplates.MULTIGOAL || [];
      const by = k => all.find(f=>f.k === k) || {};
      const el = k => document.getElementById('f_' + k);
      const occ = el('occupation');
      return {
        heads: all.filter(f=>f.t === 'section').map(f=>f.l),
        /* The ladder's own Section A, read off FSL_FORM rather than
           typed out here, so the two cannot drift apart unnoticed. */
        fslA: (FSL_FORM.find(s=>s.key === 'personal') || {fields:[]}).fields.map(f=>f.label),
        fslCash: (FSL_FORM.find(s=>s.key === 'cashflow') || {fields:[]}).fields
          .map(f=>({l:f.label, ph:f.ph})),
        mine: ['date','name','mobile','email','occupation','dob','city','country'].map(k=>({
          k, l: by(k).l, t: by(k).t, req: !!by(k).req, ph: by(k).ph || '',
          drawn: !!el(k)})),
        cash: ['mg_income','mg_expense','mg_liabilities'].map(k=>({
          k, l: by(k).l, ph: by(k).ph || '',
          shownPh: el(k) ? el(k).getAttribute('placeholder') : null})),
        occIsSelect: !!(occ && occ.tagName === 'SELECT'),
        occOpts: (occ && occ.options) ? Array.from(occ.options).map(o=>o.value).filter(Boolean) : [],
        firmOcc: cfgLabels('se.list.OCC'),
      };
    });
    const notDrawn = r.mine.filter(f=>!f.drawn).map(f=>f.k);
    if(notDrawn.length) throw new Error('not on the page: ' + notDrawn.join(', '));
    /* Every label the ladder asks for, asked here too. */
    const missing = r.fslA.filter(l=>!r.mine.some(f=>f.l === l));
    if(missing.length) throw new Error('Section A is missing: ' + missing.join(', ')
      + ' — it asks ' + r.mine.map(f=>f.l).join(', '));
    const want = {name:1, mobile:1, email:1, dob:1};
    const slack = Object.keys(want).filter(k=>!r.mine.find(f=>f.k === k).req);
    if(slack.length) throw new Error('not required, and the ladder requires them: ' + slack.join(', '));
    if(!r.occIsSelect) throw new Error('Occupation is not a dropdown');
    /* The firm's own list, in its own order. A value already on the
       record that is not on the list is kept on the end rather than
       dropped, which is the renderer being careful, not a mismatch. */
    const offered = r.occOpts.slice(0, r.firmOcc.length);
    if(!r.firmOcc.length || offered.join('|') !== r.firmOcc.join('|'))
      throw new Error('Occupation offers ' + r.occOpts.join(', ') + ', not the firm\u2019s own list of '
        + r.firmOcc.join(', '));
    const cashMiss = r.fslCash.filter(c=>!r.cash.some(x=>x.l === c.l && x.ph === c.ph));
    if(cashMiss.length) throw new Error('Cashflow does not match: looked for '
      + cashMiss.map(c=>c.l + ' / "' + c.ph + '"').join('; ')
      + ' — it has ' + r.cash.map(x=>x.l + ' / "' + x.ph + '"').join('; '));
    if(r.cash.some(x=>x.shownPh !== x.ph))
      throw new Error('the placeholders are defined but not drawn: '
        + r.cash.map(x=>x.k + '=' + x.shownPh).join(', '));
    if(!r.heads.some(h=>/Section A \u00b7 Personal Information/.test(h))
       || !r.heads.some(h=>/Section A2 \u00b7 Cashflow/.test(h)))
      throw new Error('the headings read: ' + r.heads.join(' | '));
    return r.mine.length + ' fields under ' + r.heads[0] + ', ' + r.cash.length + ' under Section A2, '
      + 'Occupation on the firm\u2019s own list of ' + r.firmOcc.length;
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
