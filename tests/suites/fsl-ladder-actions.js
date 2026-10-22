/* THE SUCCESS LADDER'S ACTIONS, AND THE EXECUTION PLAN'S.

   The Success Ladder carried a card headed "Send the plan for approval"
   whose whole content was a sentence and a button, with the bar below it
   offering a step forward the plan was not ready for. The firm asked for
   the card gone, the button on the bar, and the presentation to become
   downloadable once the plan is approved.

   So the bar is LMS, RM Working and Send for Approval while the plan is
   still to be signed off, with Generate PPT beside them — there, but
   disabled, saying what it is waiting for. Approved, the deck comes
   alive, Send for Approval is spent, and the way on to the Required
   Execution Plan takes its place.

   The Required Execution Plan drops the same card and the Send for
   Approval that stood with it: three actions, LMS, the ladder, and on to
   the Final Execution Plan with the agreed figures. Agreeing those
   figures is not new work — the page already asks for them and already
   writes them through — so this measures that it still does. */
const {suite} = require('../lib/harness');

const SETUP = `async (tag) => {
  const l = {id: uid('LMS'), firstName:'ZZ Rung', lastName: tag, mobile:'98000003' + tag,
    email:'zz.rung.' + tag + '@zz.in', assignedTo: currentUser, branch: DB.config.branches[0],
    createdAt:new Date().toISOString(), transformationForm:'FSL', dob:'1985-04-12',
    iseqScore: 44, iseqCategory:'Moderate'};
  initState('LMS', l); DB.leads.push(l); await save('leads');
  window._fslLeadId = l.id; window._fslStep = 'input';
  navigate('fsl');
  await new Promise(r=>setTimeout(r, 400));
  Object.assign(_fsl.s.personal, {name:'ZZ Rung ' + tag, mobile:'98000003' + tag,
    email:'zz.rung.' + tag + '@zz.in', dob:'1985-04-12'});
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

const BAR = `() => {
  const bar = document.querySelector('.se-stepbar');
  if(!bar) return {none:true};
  return {btns: Array.from(bar.querySelectorAll('button,a'))
    .map(b=>({t:(b.textContent||'').replace(/\\s+/g,' ').trim(), off: !!b.disabled, why: b.title||''}))
    .filter(x=>x.t)};
}`;

suite(async t => {
  await t.home();

  t.section('the Success Ladder, before it is signed off');

  await t.step('the card is gone and the bar carries the three the firm asked for', async () => {
    await t.eval(new Function('return (' + SETUP + ')("81")'));
    const r = await t.eval(new Function('return (' + BAR + ')()'));
    const cards = await t.eval(()=>Array.from(document.querySelectorAll('.se-card .section-title'))
      .map(x=>x.textContent.trim()));
    if(cards.some(x=>/send the plan for approval/i.test(x)))
      throw new Error('the card is still there: ' + cards.join(', '));
    if(r.none) throw new Error('there is no bar on the page');
    const labels = r.btns.map(b=>b.t);
    if(!labels.some(x=>/^LMS$/.test(x))) throw new Error('LMS is not on it: ' + labels.join(', '));
    if(!labels.some(x=>/RM Working/i.test(x))) throw new Error('RM Working is not on it: ' + labels.join(', '));
    if(!labels.some(x=>/Send for Approval/i.test(x)))
      throw new Error('Send for Approval is not on it: ' + labels.join(', '));
    if(labels.some(x=>/Required Execution Plan/i.test(x)))
      throw new Error('it still offers a step forward the plan is not ready for: ' + labels.join(', '));
    return labels.join(' · ');
  });

  await t.step('and the deck is in the page’s own actions, disabled, saying what it waits for', async () => {
    const r = await t.eval(()=>{
      const head = document.querySelector('.mod-head');
      return {btns: Array.from((head||{querySelectorAll:()=>[]}).querySelectorAll('button'))
        .map(b=>({t:(b.textContent||'').replace(/\s+/g,' ').trim(), off: !!b.disabled, why: b.title||''}))};
    });
    const labels = r.btns.map(b=>b.t);
    const ppt = r.btns.find(b=>/PPT/i.test(b.t));
    if(!ppt) throw new Error('there is no Generate PPT in the page actions: ' + labels.join(', '));
    if(labels.some(x=>/Generate PDF/i.test(x)))
      throw new Error('the PDF report is still beside it: ' + labels.join(', '));
    if(!ppt.off) throw new Error('it is pressable before the plan is approved');
    if(!/approval/i.test(ppt.why)) throw new Error('it does not say why: "' + ppt.why + '"');
    const bar = await t.eval(new Function('return (' + BAR + ')()'));
    if(bar.btns.some(b=>/PPT/i.test(b.t)))
      throw new Error('there is a second deck button on the bar as well');
    return labels.join(' · ') + ' — the deck off, because: ' + ppt.why;
  });

  await t.step('the one line that card carried is still said', async () => {
    const r = await t.eval(()=>({
      text: (document.getElementById('root')||{}).textContent || '',
      who: (planApprover(planRecordOf(window._fslLeadId))||{}).name || '',
    }));
    if(r.text.indexOf('goes to') < 0 || (r.who && r.text.indexOf(r.who) < 0))
      throw new Error('the page no longer says who it goes to');
    if(r.text.indexOf('nothing reaches the client until the answer comes back') < 0)
      throw new Error('it no longer says what being sent means');
    return 'it still says it goes to ' + (r.who || 'the reporting manager') + ', and what that means';
  });

  t.section('and once it is signed off');

  await t.step('the deck comes alive and the way on takes the button’s place', async () => {
    const r = await t.eval(async ()=>{
      const id = window._fslLeadId;
      const rec = planRecordOf(id), round = latestPlanRound(rec);
      round.seniorStatus = 'Approved'; round.seniorAt = new Date().toISOString();
      round.seniorBy = currentUser;
      await save('leads');
      render();
      await new Promise(r=>setTimeout(r, 500));
      const head = document.querySelector('.mod-head');
      return {btns: Array.from(head.querySelectorAll('button'))
                .map(b=>({t:(b.textContent||'').replace(/\s+/g,' ').trim(), off: !!b.disabled})),
              bar: Array.from(document.querySelectorAll('.se-stepbar button,.se-stepbar a'))
                .map(b=>(b.textContent||'').replace(/\s+/g,' ').trim()).filter(Boolean),
              ready: planDeckReady(round), slides: planDeckSlides(rec, round).length};
    });
    const ppt = r.btns.find(b=>/PPT/i.test(b.t));
    if(!ppt) throw new Error('the deck button vanished: ' + r.btns.map(b=>b.t).join(', '));
    if(ppt.off) throw new Error('the deck is still disabled after approval');
    if(!r.ready) throw new Error('the deck does not read as ready');
    if(r.bar.some(x=>/Send for Approval/i.test(x)))
      throw new Error('Send for Approval is still offered on an approved plan');
    if(!r.bar.some(x=>/Required Execution Plan/i.test(x)))
      throw new Error('there is no step forward: ' + r.bar.join(', '));
    return r.bar.join(' · ') + ' — deck live in the page actions, building ' + r.slides + ' slides';
  });

  await t.step('and the three working pages carry no page actions at all', async () => {
    const r = await t.eval(async ()=>{
      const out = [];
      for(const step of ['input','plan','exec','bp']){
        await fslStepGo(step);
        await new Promise(r=>setTimeout(r, 400));
        const head = document.querySelector('.mod-head');
        out.push({step, btns: Array.from((head||{querySelectorAll:()=>[]}).querySelectorAll('button'))
          .map(b=>(b.textContent||'').replace(/\s+/g,' ').trim()).filter(Boolean)});
      }
      return out;
    });
    const loud = r.filter(x=>x.step !== 'bp' && x.btns.length);
    if(loud.length)
      throw new Error('still carrying actions: '
        + loud.map(x=>x.step + ' [' + x.btns.join(', ') + ']').join('; '));
    const ladder = r.find(x=>x.step === 'bp');
    if(!ladder.btns.length) throw new Error('the ladder lost its actions too');
    return 'Input Form, RM Working and the Required Execution Plan carry none; the ladder keeps '
      + ladder.btns.join(' · ');
  });

  t.section('the Required Execution Plan');

  await t.step('three actions, and no approval on a page that does not approve', async () => {
    const r = await t.eval(async ()=>{
      await fslStepGo('exec');
      await new Promise(r=>setTimeout(r, 500));
      const bar = document.querySelector('.se-stepbar');
      return {btns: Array.from(bar.querySelectorAll('button,a'))
                .map(b=>(b.textContent||'').replace(/\s+/g,' ').trim()).filter(Boolean),
              cards: Array.from(document.querySelectorAll('.se-card .section-title'))
                .map(x=>x.textContent.trim())};
    });
    if(r.cards.some(x=>/approval/i.test(x)))
      throw new Error('an approval card is still on it: ' + r.cards.join(', '));
    if(r.btns.some(x=>/Send for Approval/i.test(x)))
      throw new Error('Send for Approval is still on its bar: ' + r.btns.join(', '));
    const want = ['LMS','← The Success Ladder','Update DBT →'];
    if(r.btns.join(' | ') !== want.join(' | '))
      throw new Error('its bar reads: ' + r.btns.join(' | '));
    return r.btns.join(' · ');
  });

  await t.step('the agreed amount is typed here and written down as business', async () => {
    const r = await t.eval(async ()=>{
      const id = window._fslLeadId;
      const before = fslExecRows(planRecordOf(id)).map(x=>({lump:x.lump, sip:x.sip}));
      _fsl.s.exec = _fsl.s.exec || {};
      _fsl.s.exec.agreedLump = 2500000;
      _fsl.s.exec.agreedSip = 40000;
      _fsl.dirty = true; await fslSaveSheet();
      await fslUpdateDbt(id);
      await new Promise(r=>setTimeout(r, 700));
      const round = latestPlanRound(planRecordOf(id));
      const lines = (round.allocation||{}).lines || [];
      const after = fslExecRows(planRecordOf(id)).map(x=>({lump:x.lump, sip:x.sip}));
      const round0 = latestPlanRound(planRecordOf(id));
      return {step: window._fslStep, dbts: planDbtsFor(id, round0.n).length, before, after,
              lump: lines.filter(l=>!allocLineIsSip(l)).reduce((a,l)=>a+(Number(l.amount)||0),0),
              sip:  lines.filter(l=>allocLineIsSip(l)).reduce((a,l)=>a+(Number(l.amount)||0),0),
              rounds: planRoundsOf(planRecordOf(id)).length};
    });
    if(!r.dbts) throw new Error('no DBT was written from the agreed figures');
    if(r.lump !== 2500000) throw new Error('the agreed lumpsum came through as ' + r.lump);
    if(r.sip !== 40000) throw new Error('the agreed SIP came through as ' + r.sip);
    if(JSON.stringify(r.before) !== JSON.stringify(r.after))
      throw new Error('the required figures moved when the agreed ones were typed');
    if(r.rounds !== 1) throw new Error('navigating made a second plan: ' + r.rounds + ' rounds');
    return 'agreed ₹25,00,000 and ₹40,000/month placed, the required figures untouched, one plan';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
