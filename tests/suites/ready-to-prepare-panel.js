/* THE "READY TO PREPARE" STAGE OFFERS NOTHING TO PRESS.

   When the input form is back, that stage used to carry a button into
   the step before the calculation — "RM Working — settle the returns and
   the level" on the ladder and on GAB, "Map the assets, then plan the
   goals" on the seven events — with a line underneath saying why that
   step comes first. The firm asked for both off the stage.

   The worry with taking a button away is a dead end, so this checks the
   other way in is still there: the Plan tab opens the blueprint's own
   workbench, and the workbench walks its own steps, RM Working among
   them. The blueprints still name that step — the seven events reads
   prepStep to know the mapping comes first — so what went is the offer
   on this one stage and nothing else. */
const {suite} = require('../lib/harness');

const SEED = `async function(type){
  const id = 'LMS-RTP-' + type;
  let l = DB.leads.find(x=>x.id === id);
  if(!l){ l = {id}; DB.leads.push(l); }
  Object.assign(l, {firstName:'ZZ Ready', lastName:type, mobile:'9800444111',
    email:'ready@example.com', assignedTo: currentUser, transformationForm:type,
    createdAt:new Date().toISOString(), dob:'1986-04-04'});
  if(!stateOf('LMS', l)) initState('LMS', l);
  l.planRounds = [{n:1, type, inputSubmittedAt:new Date().toISOString()}];
  await save('leads');
  return id;
}`;

suite(async t => {
  await t.home();

  t.section('the stage when the input form is back');

  for(const type of ['FSL','GAB','SEVENEVENTS']){
    await t.step(type + ' — the panel says where things stand and asks for nothing', async () => {
      const r = await t.eval(new Function(`return (async ()=>{
        const id = await (${SEED})('${type}');
        const rec = planRecordOf(id);
        const html = stagePanelHtml('LMS', rec, 'planInputSubmitted', true);
        const d = document.createElement('div'); d.innerHTML = html;
        return {
          head: (d.querySelector('.stage-panel-head b')||{}).textContent || '',
          buttons: Array.from(d.querySelectorAll('button')).map(b=>(b.textContent||'').trim()),
          text: (d.textContent||'').replace(/\\s+/g,' ').trim(),
          /* the step itself is still named by the blueprint */
          prepStep: (sheetAdapterFor(rec)||{}).prepStep || null,
        };
      })()`));
      if(r.head.indexOf('Ready to prepare') < 0)
        throw new Error('this is not the Ready to prepare panel — it reads "' + r.head + '"');
      if(r.buttons.length)
        throw new Error('the panel still offers: ' + r.buttons.join(', '));
      if(/settle the returns|Map the assets|settle the assumptions/i.test(r.text))
        throw new Error('the line under the button is still there — ' + r.text);
      if(!r.prepStep)
        throw new Error('the blueprint no longer names the step before the calculation');
      return 'nothing to press; ' + type + ' still names its "' + r.prepStep + '" step';
    });
  }

  await t.step('and RM Working is still one click away, from the Plan tab', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const id = await (${SEED})('FSL');
      openLeadFormFill(id, 'FSL');              // what the Plan tab's button calls
      const where = currentView;
      const steps = Array.from(document.querySelectorAll('.tab')).map(x=>(x.textContent||'').trim());
      await sheetStepGo(id, 'plan');   // the workbench saves before it moves, so this is a promise
      return {where, steps, step: window._fslStep,
              onStep: Array.from(document.querySelectorAll('.tab.active')).map(x=>(x.textContent||'').trim())};
    })()`));
    if(r.where !== 'fsl') throw new Error('the Plan tab did not land in the workbench — it went to ' + r.where);
    if(r.steps.indexOf('RM Working') < 0)
      throw new Error('the workbench does not walk to RM Working — its steps are ' + r.steps.join(', '));
    if(r.step !== 'plan' || r.onStep.join('') !== 'RM Working')
      throw new Error('asking for RM Working left us on ' + (r.onStep.join(', ') || r.step));
    return 'Plan tab → the workbench → ' + r.steps.join(' · ');
  });

  /* Walking into the workbench saves the sheet on the way, so the suite
     would otherwise close the browser on a write still in flight and the
     page would log a "storage set failed" that is the teardown, not the
     app. Let it land. */
  await t.wait(800);
});
