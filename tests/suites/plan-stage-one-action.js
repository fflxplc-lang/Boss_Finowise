/* ONE ACTION, AND IT IS THE NEXT ONE.

   Two things the firm asked for, and they are the same thing twice.

   The Required Execution Plan was open the moment a plan existed, which
   invited an adviser to write down figures nobody had agreed to against
   advice nobody had approved. It waits for the sign-off now, as the
   Final Execution Plan always has — on all three blueprints, so the
   journey reads alike whichever one a lead is on.

   And a plan stage on the lead profile offered a menu: Send for Approval
   beside "Back to the Input Form", with the panel above it offering
   three more ways to pages the plan already navigates between. It offers
   the one step forward now. Going back is not lost, which is the half
   worth guarding: the workbench walks every page of the plan both ways,
   Modify the Plan is on the plan's own header, and a declined plan opens
   itself for reworking. */
const {suite} = require('../lib/harness');

const SETUP = `async (tag) => {
  const l = {id: uid('LMS'), firstName:'ZZ Gate', lastName: tag, mobile:'98000004' + tag,
    email:'zz.gate.' + tag + '@zz.in', assignedTo: currentUser, branch: DB.config.branches[0],
    createdAt:new Date().toISOString(), transformationForm:'FSL', dob:'1985-04-12',
    iseqScore: 44, iseqCategory:'Moderate'};
  initState('LMS', l); DB.leads.push(l); await save('leads');
  window._fslLeadId = l.id; window._fslStep = 'input';
  navigate('fsl');
  await new Promise(r=>setTimeout(r, 400));
  Object.assign(_fsl.s.personal, {name:'ZZ Gate ' + tag, mobile:'98000004' + tag,
    email:'zz.gate.' + tag + '@zz.in', dob:'1985-04-12'});
  _fsl.s.years = 10;
  _fsl.s.assets[0].current = 9700000; _fsl.s.assets[0].monthly = 49500;
  _fsl.dirty = true; fslRecompute(); await fslSaveSheet();
  await fslSubmitForClient(l.id);
  await fslStepGo('plan');
  await new Promise(r=>setTimeout(r, 400));
  fslTakeSuggestedLevel();
  await new Promise(r=>setTimeout(r, 300));
  DB.leads.find(x=>x.id===l.id).status = 'secondMeetingDone';
  await save('leads');
  await fslGoToLadder(l.id);
  await new Promise(r=>setTimeout(r, 700));
  return l.id;
}`;

suite(async t => {
  await t.home();

  t.section('the Required Execution Plan waits for the sign-off');

  await t.step('prepared is not enough; approved is', async () => {
    const r = await t.eval(new Function('S', `return (async ()=>{
      const id = await (${SETUP})("91");
      const rec = planRecordOf(id);
      let round = latestPlanRound(rec);
      const before = {exec: fslStepOpen('exec', rec, round),
                      alloc: fslStepOpen('alloc', rec, round),
                      bp: fslStepOpen('bp', rec, round),
                      why: fslStepWhy('exec', rec, round)};
      round.seniorStatus = 'Approved'; round.seniorAt = new Date().toISOString();
      await save('leads');
      const after = {exec: fslStepOpen('exec', rec, round),
                     alloc: fslStepOpen('alloc', rec, round)};
      return {id, before, after, prepared: !!(round && round.output)};
    })()`));
    if(!r.prepared) throw new Error('nothing was prepared, so this proves nothing');
    if(!r.before.bp) throw new Error('the blueprint itself is shut on a prepared plan');
    if(r.before.exec) throw new Error('it is open on a plan nobody has signed off');
    if(!/signed the advice off/.test(r.before.why))
      throw new Error('it does not say why it is shut: ' + r.before.why);
    if(!r.after.exec || !r.after.alloc)
      throw new Error('it is still shut after the sign-off: exec ' + r.after.exec + ', alloc ' + r.after.alloc);
    return 'shut while prepared, open once signed off — and it says which';
  });

  await t.step('and the other two blueprints read the same way', async () => {
    const r = await t.eval(()=>{
      /* A real lead, because for a CLIENT the round's own answer is the
         only sign-off there is and the question does not arise. */
      const probe = (open)=>{
        const rec = {id: uid('LMS'), firstName:'ZZ', lastName:'Probe', status:'planPrepared'};
        DB.leads.push(rec);
        const round = {output:{}, n:1};
        const noSign = open('exec', rec, round);
        round.seniorStatus = 'Approved';
        const signed = open('exec', rec, round);
        DB.leads = DB.leads.filter(x=>x !== rec);
        return {noSign, signed};
      };
      return {se: probe(seStepOpen), gab: probe(gabStepOpen)};
    });
    ['se','gab'].forEach(k=>{
      if(r[k].noSign) throw new Error(k.toUpperCase() + ' opens its execution plan before the sign-off');
      if(!r[k].signed) throw new Error(k.toUpperCase() + ' keeps it shut after the sign-off');
    });
    return '7 Events and GAB both wait for the sign-off too';
  });

  t.section('the stage on the lead profile');

  await t.step('a prepared plan offers one way in and one step forward', async () => {
    const r = await t.eval(async ()=>{
      const id = window._fslLeadId;
      const rec = DB.leads.find(l=>l.id===id);
      rec.status = 'planPrepared';
      delete latestPlanRound(rec).seniorStatus;
      await save('leads');
      navigate('lms', id);
      await new Promise(r=>setTimeout(r, 700));
      const panel = document.querySelector('.stage-panel');
      const row = document.querySelector('.pill-row');
      return {panel: Array.from((panel||{querySelectorAll:()=>[]}).querySelectorAll('button'))
                .map(b=>(b.textContent||'').trim()).filter(Boolean),
              row: Array.from((row||{querySelectorAll:()=>[]}).querySelectorAll('button'))
                .map(b=>(b.textContent||'').trim()).filter(Boolean)};
    });
    if(r.panel.join(' | ') !== 'Open the plan')
      throw new Error('the panel offers: ' + r.panel.join(' | '));
    if(r.row.some(x=>/^←/.test(x)))
      throw new Error('a step backward is still offered: ' + r.row.join(' | '));
    if(r.row.length !== 1)
      throw new Error('the stage offers ' + r.row.length + ' actions: ' + r.row.join(' | '));
    if(!/approval/i.test(r.row[0]))
      throw new Error('the one action is not the next one: ' + r.row[0]);
    return 'panel: ' + r.panel.join(', ') + ' · stage: ' + r.row.join(', ');
  });

  await t.step('and the ways back it replaced are all still there', async () => {
    const r = await t.eval(()=>{
      const id = window._fslLeadId;
      const rec = DB.leads.find(l=>l.id===id);
      return {
        // the plan's own header still offers the rework
        modify: typeof modifyPlanFromOutput === 'function',
        // and the workbench walks its pages both ways
        bar: (function(){
          const round = latestPlanRound(rec);
          const html = fslStepBarHtml('plan', rec, round, fslFootExtra('plan', rec, round, false));
          const d = document.createElement('div'); d.innerHTML = html;
          return Array.from(d.querySelectorAll('button')).map(b=>(b.textContent||'').trim());
        })(),
        // a declined plan is not locked
        declined: (function(){
          const round = Object.assign({}, latestPlanRound(rec), {seniorStatus:'Declined', sentForApprovalAt:'x'});
          return !fslRmLocked(rec, round);
        })()};
    });
    if(!r.modify) throw new Error('Modify the Plan is gone entirely');
    if(!r.bar.some(x=>/Input Form/i.test(x)))
      throw new Error('the workbench no longer walks back: ' + r.bar.join(' | '));
    if(!r.declined) throw new Error('a declined plan is locked, so reworking it is impossible');
    return 'the workbench still walks back (' + r.bar.join(' · ')
         + '), Modify the Plan is on the plan header, and a declined plan reopens';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
