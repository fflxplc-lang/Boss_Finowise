/* GOAL BASED PLANNING'S INPUT FORM, ON A PAGE.

   Its questions came up in a dialog — three headings to open one at a
   time, a box the size of the questions rather than the page, Cancel
   and Save at the foot. Every other blueprint opens its Input Form as
   a page, and the firm asked for this one to do the same, with the
   bar at the foot offering the lead and sending the form on.

   Same template, same answers, same stored shape. What is guarded:
   that it is a page and not a dialog, that the bar says what the firm
   asked it to say, that typing is saved without a Save button, and
   that a blueprint WITH a workbook still opens its own.

   And one thing that was already wrong and is on the same road.
   readFormAnswers() takes '' for an answer when there is no box,
   which is right for an empty box and catastrophic for an absent one:
   "Submit the Input Form" on the lead's profile read the form with
   the form nowhere on screen and wrote every answer back blank. */
const {suite} = require('../lib/harness');

const SEED = `async function(){
  let l = DB.leads.find(x=>x.id === 'LMS-PFORM');
  if(!l){ l = {id:'LMS-PFORM'}; DB.leads.push(l); }
  Object.assign(l, {firstName:'ZZ Goal', lastName:'Based', mobile:'9800444333',
    email:'goal@example.com', assignedTo: currentUser, transformationForm:'MULTIGOAL',
    createdAt:new Date().toISOString()});
  if(!stateOf('LMS', l)) initState('LMS', l);
  await save('leads');
  return l.id;
}`;

suite(async t => {
  await t.home();

  t.section('it is a page now');

  await t.step('the Input Form opens as a page, not a dialog', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const id = await (${SEED})();
      openLeadFormFill(id, 'MULTIGOAL');
      const overlay = document.getElementById('overlay');
      const root = document.getElementById('root');
      const fields = DB.config.formTemplates.MULTIGOAL || [];
      return {view: currentView,
              modal: !!(overlay && overlay.classList.contains('show')),
              onScreen: formIsOnScreen(fields),
              boxes: root.querySelectorAll('#pfBody input, #pfBody select, #pfBody textarea').length,
              title: (root.querySelector('.mod-head h2') || {}).textContent || '',
              bar: Array.from(root.querySelectorAll('.se-stepbar button'))
                .map(b=>(b.textContent || '').replace(/\\s+/g,' ').trim())};
    })()`));
    if(r.modal) throw new Error('it still came up in a dialog');
    if(r.view !== 'planform') throw new Error('it navigated to "' + r.view + '"');
    if(!/Goal Based Planning/.test(r.title)) throw new Error('the page is headed "' + r.title + '"');
    if(!r.boxes) throw new Error('the page drew no questions');
    if(!r.onScreen) throw new Error('the form is drawn but does not read as on screen');
    return r.boxes + ' question boxes down a page headed "' + r.title + '"';
  });

  await t.step('and the bar offers the lead, sending it on, and submitting', async () => {
    const r = await t.eval(()=>Array.from(document.querySelectorAll('.se-stepbar button'))
      .map(b=>(b.textContent || '').replace(/\s+/g,' ').trim()));
    if(r[0] !== 'LMS') throw new Error('the first reads "' + r[0] + '"');
    if(!r.some(x=>/Send Input form to Client/.test(x)))
      throw new Error('nothing on the bar sends it to the client: ' + r.join(' | '));
    /* The ladder's flow, which this one now follows: fill it, or send
       it, and then submit — which is what opens RM Working. */
    if(!r.some(x=>/Submit the Input Form|RM Working/.test(x)))
      throw new Error('nothing on the bar submits it: ' + r.join(' | '));
    return r.join('  |  ');
  });

  await t.step('typing is kept without a Save button', async () => {
    const r = await t.eval(async ()=>{
      /* A question whose box takes typing, so what is typed lands on
         an answer key — not a dropdown, where setting a value nothing
         on the list matches leaves it empty, and not a table cell,
         whose answer has a shape of its own. */
      const typable = (DB.config.formTemplates.MULTIGOAL || []).map(f=>{
        if(FORM_LAYOUT_TYPES.includes(f.t)) return null;
        const el = document.getElementById('f_' + f.k);
        if(!el) return null;
        const tag = el.tagName, kind = String(el.type || '').toLowerCase();
        if(tag !== 'INPUT' && tag !== 'TEXTAREA') return null;
        /* A date box will not take a word, and a word is what this
           step types. */
        if(['checkbox','radio','file','range','date','time','color'].indexOf(kind) >= 0) return null;
        return {f, el, numeric: kind === 'number' || (el.classList && el.classList.contains('num-in'))};
      }).filter(Boolean);
      const hit = typable[0];
      if(!hit) return {none:true};
      const key = hit.f.k, box = hit.el;
      const typed = hit.numeric ? '123456' : 'ZZ typed on the page';
      box.value = typed;
      /* What the bar's own buttons do before they leave. */
      savePlanFormPage();
      const held = ((DB.leads.find(x=>x.id === 'LMS-PFORM') || {}).formData || {}).MULTIGOAL || {};
      const saves = Array.from(document.querySelectorAll('.se-stepbar button, .mod-head button'))
        .map(b=>(b.textContent || '').trim()).filter(x=>/^save$/i.test(x));
      return {key, typed, kept: held[key], saves: saves.length};
    });
    if(r.none) throw new Error('the page drew no plain box to type in');
    if(String(r.kept) !== r.typed)
      throw new Error('typed ' + JSON.stringify(r.typed) + ' into ' + r.key
        + ', it came back as ' + JSON.stringify(r.kept));
    if(r.saves) throw new Error('there is still a Save button on it');
    return 'typed into ' + r.key + ', held on the record, and no Save button anywhere';
  });

  t.section('what it must not break');

  await t.step('a blueprint with a workbook still opens its own', async () => {
    const r = await t.eval(async ()=>{
      let l = DB.leads.find(x=>x.id === 'LMS-PFSL');
      if(!l){ l = {id:'LMS-PFSL'}; DB.leads.push(l); }
      Object.assign(l, {firstName:'ZZ Ladder', lastName:'Lead', mobile:'9800444111',
        assignedTo: currentUser, transformationForm:'FSL', createdAt:new Date().toISOString()});
      if(!stateOf('LMS', l)) initState('LMS', l);
      await save('leads');
      openLeadFormFill(l.id, 'FSL');
      return {view: currentView, step: window._fslStep};
    });
    if(r.view !== 'fsl') throw new Error('FSL went to "' + r.view + '"');
    if(r.step !== 'input') throw new Error('FSL opened on step "' + r.step + '"');
    return 'FSL still opens its own workbook on its Input Form';
  });

  await t.step('and Submit with the form nowhere on screen keeps the answers', async () => {
    const r = await t.eval(async ()=>{
      const l = DB.leads.find(x=>x.id === 'LMS-PFORM');
      const fields = DB.config.formTemplates.MULTIGOAL || [];
      const key = (fields.find(f=>!FORM_LAYOUT_TYPES.includes(f.t)) || {}).k;
      l.formData = l.formData || {};
      l.formData.MULTIGOAL = Object.assign({}, l.formData.MULTIGOAL, {[key]:'ZZ answered earlier'});
      await save('leads');
      /* Away from the form entirely, the way the lead's profile is. */
      /* Away from the form for real. Closing a dialog only hides it —
         its boxes stay in the document with what was typed still in
         them — and the case that matters is the one where the form
         was never opened in this page at all. */
      closeModal();
      const ov = document.getElementById('overlay');
      if(ov) ov.innerHTML = '';
      navigate('lms', l.id);
      /* Asked without naming the guard, so the old behaviour fails
         this on what it did rather than on a missing function. */
      const boxes = fields.filter(f=>!FORM_LAYOUT_TYPES.includes(f.t)
        && document.getElementById('f_' + f.k)).length;
      await saveLeadFormFill(l.id, 'MULTIGOAL', '');
      const after = (DB.leads.find(x=>x.id === 'LMS-PFORM').formData || {}).MULTIGOAL || {};
      return {key, boxes, kept: after[key]};
    });
    if(r.boxes) throw new Error(r.boxes + ' of the form’s boxes are on the lead’s profile — '
      + 'the fixture is not away from the form');
    if(r.kept !== 'ZZ answered earlier')
      throw new Error('the answer came back as ' + JSON.stringify(r.kept) + ' — saving with the form closed wiped it');
    return 'saving with the form closed reads nothing and writes nothing';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
