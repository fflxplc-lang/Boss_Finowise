/* PREPARE PLAN BELONGS ON THE PAGE THE PLAN IS PREPARED FROM.

   The Data Gathering Meeting panel offered "Open the form" and the stage
   underneath it offered "Prepare Plan" — which fired the engine from a
   page showing none of the figures it was about to run and none of what
   was still unsettled. The firm asked for the duplicate to go and for the
   RM's own working page to be reachable from the panel instead.

   The two things this has to get right. The button is gone only where
   there is somewhere else to press it: a blueprint with a workbench of
   its own loses it, Goal Based Planning, which has none, keeps it. And
   the STEP is untouched — preparing the plan from the workbench still
   moves the lead to Plan Prepared, which is the whole point of taking
   the button away rather than the route. */
const {suite} = require('../lib/harness');

const LEAD = `async (type) => {
  const l = {id: uid('LMS'), firstName:'ZZ Working', lastName: type, mobile:'98000000' + (type.length),
    email:'zz.work.' + type + '@zz.in', assignedTo: currentUser, branch: DB.config.branches[0],
    createdAt: new Date().toISOString(), transformationForm: type, dob:'1985-04-12',
    iseqScore: 44, iseqCategory:'Moderate'};
  initState('LMS', l); DB.leads.push(l); await save('leads');
  return l.id;
}`;

suite(async t => {
  await t.home();

  t.section('the panel the RM works the meeting from');

  await t.step('it offers the form and, beside it, the RM working page', async () => {
    const r = await t.eval(new Function('S', `return (async ()=>{
      const id = await (${LEAD})('FSL');
      const rec = DB.leads.find(l=>l.id===id);
      const before = fslMeetingPanelHtml(rec, true);
      /* The working page opens once the form is in, so it is offered then. */
      window._fslLeadId = id; window._fslStep = 'input';
      navigate('fsl');
      await new Promise(r=>setTimeout(r, 400));
      Object.assign(_fsl.s.personal, {name:'ZZ Working FSL', mobile:'9800000003',
        email:'zz.work.FSL@zz.in', dob:'1985-04-12'});
      _fsl.s.years = 10;
      _fsl.s.assets[0].current = 500000; _fsl.s.assets[0].monthly = 10000;
      _fsl.dirty = true; fslRecompute(); await fslSaveSheet();
      await fslSubmitForClient(id);
      const after = fslMeetingPanelHtml(DB.leads.find(l=>l.id===id), true);
      const labels = h => { const d = document.createElement('div'); d.innerHTML = h;
        return Array.from(d.querySelectorAll('button')).map(b=>b.textContent.trim()); };
      return {id, before: labels(before), after: labels(after)};
    })()`));
    if(r.after.indexOf('Open the form') !== 0)
      throw new Error('the first button is no longer Open the form: ' + r.after.join(', '));
    if(r.after.indexOf('RM Working') !== 1)
      throw new Error('RM Working does not sit beside it: ' + r.after.join(', '));
    if(r.before.indexOf('RM Working') >= 0)
      throw new Error('it is offered before the form is back, where that page is still shut');
    return 'before the form is in: ' + r.before.join(', ')
         + ' — after it: ' + r.after.join(', ');
  });

  t.section('and the stage stops offering a second Prepare Plan');

  await t.step('a blueprint with a workbench no longer shows the stage button', async () => {
    const r = await t.eval(()=>{
      const read = (type)=>{
        const rec = {id:'ZZSTAGE-'+type, transformationForm:type};
        initState('LMS', rec);
        rec.status = 'secondMeetingDone';
        return (availableTransitions('LMS', 'secondMeetingDone', 'forward', rec)||[]).map(t=>t.label);
      };
      return {fsl: read('FSL'), se: read('SEVENEVENTS'), gab: read('GAB'), mg: read('MULTIGOAL')};
    });
    ['fsl','se','gab'].forEach(k=>{
      if(r[k].indexOf('Prepare Plan') >= 0)
        throw new Error(k.toUpperCase() + ' still offers it on the stage: ' + r[k].join(', '));
    });
    if(r.mg.indexOf('Prepare Plan') < 0)
      throw new Error('Goal Based Planning has no workbench and now has no way to prepare at all: '
        + (r.mg.join(', ') || 'nothing offered'));
    return 'gone for FSL, 7 Events and GAB — kept for Goal Based Planning, which has nowhere else to press it';
  });

  await t.step('and the step itself is still there, wherever the lead stands', async () => {
    const r = await t.eval(()=>{
      const at = (state)=>{
        const rec = {id:'ZZSTEP', transformationForm:'FSL'};
        initState('LMS', rec); rec.status = state;
        DB.leads.push(rec);
        const id = planPrepareTransitionId(rec);
        DB.leads = DB.leads.filter(x=>x!==rec);
        return id;
      };
      return {done: at('secondMeetingDone'), skipped: at('secondMeetingSkipped'),
              client: planPrepareTransitionId({id:'CMS-NOPE'})};
    });
    if(r.done !== 'fwd_planPrepared') throw new Error('from the meeting it reads ' + r.done);
    if(r.skipped !== 'planPreparedFromSkipT') throw new Error('from the skipped meeting it reads ' + r.skipped);
    if(r.client !== null) throw new Error('a client was given a stage step to move: ' + r.client);
    return 'the step is found from the meeting and from the skipped meeting, and a client gets none';
  });

  await t.step('preparing it from the workbench still moves the lead', async () => {
    const r = await t.eval(async ()=>{
      const id = window._fslLeadId;
      const rec = DB.leads.find(l=>l.id===id);
      /* Stand it where the meeting leaves it; the point under test is the
         move out of that stage, not the walk up to it. */
      rec.status = 'secondMeetingDone'; await save('leads');
      const before = stateOf('LMS', rec);
      _fsl.s.chosenLevel = '3'; _fsl.dirty = true; fslRecompute(); await fslSaveSheet();
      await fslPreparePlan(id);
      await new Promise(r=>setTimeout(r, 600));
      return {before, after: stateOf('LMS', DB.leads.find(l=>l.id===id))};
    });
    if(r.after !== 'planPrepared')
      throw new Error('the lead went from ' + r.before + ' to ' + r.after + ', not to planPrepared');
    return 'the lead moved ' + r.before + ' → ' + r.after + ' with no stage button pressed';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
