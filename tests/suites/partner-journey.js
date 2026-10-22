/* THE PARTNER JOURNEY.

   A section of its own in the rail, with five modules. A prospect is
   registered against a webinar in PPS and walks the flowchart's stages
   until the ₹1,999 fee is paid; paying it creates the partner in PMS and
   the page follows them there. In PMS a partner who is not an ARN holder
   takes admission form 1, the courses, NISM and the exam — a fail goes
   back to the doubt solving session — and a pass goes to ARN / EUIN
   registration and onboarding. Queries, payouts and the performance
   board all read the partner. */
const {suite} = require('../lib/harness');

suite(async t => {
  const pause = ms => new Promise(r => setTimeout(r, ms));
  let webinar = null, prospect = null, partner = null;

  t.section('the section');

  await t.step('the rail carries Partner Journey with its five modules', async () => {
    const r = await t.eval(()=>{
      const g = railNavGroups().find(x=>x.id==='partnerjourney');
      return g ? {label: g.label, items: g.items.map(v=>navFullOf(v))} : null;
    });
    if(!r) throw new Error('no Partner Journey group in the rail');
    if(r.items.length !== 5) throw new Error('expected five modules, got ' + JSON.stringify(r.items));
    return r.items.join(' · ');
  });

  await t.step('each module draws', async () => {
    const out = [];
    for(const v of ['pps','pms','pqs','ppo','ppf']){
      const h = await t.eval(async v => { navigate(v); await new Promise(r=>setTimeout(r,80));
        return (document.querySelector('.mod-head h2')||{}).textContent || ''; }, v);
      if(!h) throw new Error(v + ' drew no heading');
      out.push(h.split(' ')[0]);
    }
    return out.join(', ');
  });

  t.section('PPS — prospect to fee');

  await t.step('a webinar is planned, and its checklist counts what is done', async () => {
    const r = await t.eval(async ()=>{
      navigate('pps'); pjOpenWebinarForm();
      document.getElementById('f_title').value = 'ZZ Become a Partner';
      document.getElementById('f_date').value = '2026-11-05';
      document.getElementById('f_targetAudience').value = 'Working professionals';
      await pjSaveWebinar('');
      const w = pjWebinars().find(x=>x.title==='ZZ Become a Partner');
      return {id: w && w.id, done: PJ_WEBINAR_STEPS.filter(([k])=>pjWebinarStepDone(w, k)).length};
    });
    if(!r.id) throw new Error('webinar not saved');
    if(r.done !== 3) throw new Error('expected 3 planning steps done, got ' + r.done);
    webinar = r.id;
    return r.done + ' of 9 planning steps';
  });

  await t.step('a prospect is registered through the form', async () => {
    const r = await t.eval(async wid=>{
      pjOpenProspectForm();
      const set = (k, v) => { const el = document.getElementById('f_'+k); el.value = v; el.dispatchEvent(new Event('change', {bubbles:true})); };
      set('firstName', 'Asha'); set('lastName', 'Rao'); set('mobile', '9876512345');
      set('source', 'Master Sherpa'); set('masterSherpa', 'Ravi Monk'); set('commChannel', 'Email'); set('webinarId', wid);
      await pjSaveProspect('');
      await new Promise(r=>setTimeout(r,80));
      const p = pjProspects().find(x=>x.firstName==='Asha');
      return p && {id: p.id, stage: stateOf('PPS', p), view: currentView, open: ppsDetailId,
        offered: availableTransitions('PPS', stateOf('PPS', p), 'forward', p).map(x=>x.id)};
    }, webinar);
    if(!r) throw new Error('prospect not saved');
    if(r.stage !== 'registered' || r.open !== r.id) throw new Error(JSON.stringify(r));
    if(r.offered.join() !== 'ackEmailT') throw new Error('an email registration should be offered only the email step: ' + r.offered);
    prospect = r.id;
    return r.id + ' at Registered, offered ' + r.offered;
  });

  await t.step('the stages walk to the session, and Payment Not Done goes to the RM', async () => {
    const r = await t.eval(async id=>{
      for(const tid of ['ackEmailT','remindersT','sessionDayT','attendedYesT','notPaidT']) await doTransition('PPS', id, tid);
      const p = pjProspects().find(x=>x.id===id);
      return {stage: stateOf('PPS', p), open: ppsDetailId, trail: p.blueprintHistory.length};
    }, prospect);
    if(r.stage !== 'rmFollowUp') throw new Error('stage ' + r.stage);
    if(r.open !== prospect) throw new Error('the page left the prospect');
    return 'at RM Follow-up, ' + r.trail + ' entries on the trail';
  });

  await t.step('Payment Done asks for the payment, then creates the partner in PMS', async () => {
    const r = await t.eval(async id=>{
      pjOpenPaymentModal('PPS', id, 'paidAfterCallT');
      const amount = document.getElementById('f_feeAmount').value;
      document.getElementById('f_feeMode').value = 'UPI';
      document.getElementById('f_feeRef').value = 'UTR123';
      await pjSavePayment(id, 'paidAfterCallT');
      await new Promise(r=>setTimeout(r,120));
      const p = pjProspects().find(x=>x.id===id);
      const m = pjPartners().find(x=>x.id===p.partnerId);
      return {amount, stage: stateOf('PPS', p), partner: m && m.id, pstage: m && stateOf('PMS', m),
        owner: m && m.leadOwner, fee: m && m.feeAmount, view: currentView, open: pmsDetailId};
    }, prospect);
    if(String(r.amount).replace(/,/g,'') !== '1999') throw new Error('fee should default to 1999, was ' + r.amount);
    if(r.stage !== 'converted' || !r.partner) throw new Error(JSON.stringify(r));
    if(r.view !== 'pms' || r.open !== r.partner) throw new Error('the page should follow to PMS: ' + JSON.stringify(r));
    if(r.owner !== 'Master Sherpa / Monk') throw new Error('a Master Sherpa prospect is theirs: ' + r.owner);
    partner = r.partner;
    return r.partner + ' in PMS at ' + r.pstage + ', fee ' + r.fee;
  });

  await t.step('a paid prospect leaves the PPS list, and Fee Paid brings them back', async () => {
    const r = await t.eval(async ()=>{
      window._ppsTab = 'prospects'; navigate('pps'); await new Promise(r=>setTimeout(r,60));
      const shown = () => document.getElementById('ppsTable').textContent.includes('Asha Rao');
      const before = shown();
      filterByStageGroup('PPS', ['converted']); await new Promise(r=>setTimeout(r,60));
      const after = shown();
      window[stageFilterKey('PPS')] = null;
      return {before, after};
    });
    if(r.before || !r.after) throw new Error(JSON.stringify(r));
    return 'hidden, then shown under Fee Paid';
  });

  t.section('PMS — fee to onboarding');

  await t.step('not an ARN holder: admission form 1, courses, NISM, and a failed exam goes back', async () => {
    const r = await t.eval(async id=>{
      for(const tid of ['gurukulAccessT','ownerSherpaT','arnNoT','inductionT','coursesT','nismT','doubtT']) await doTransition('PMS', id, tid);
      pjOpenExamDateModal('PMS', id, 'examDateT');
      document.getElementById('f_examDate').value = '2026-12-01';
      await pjSaveStageFields('PMS', id, 'examDateT', 'exam');
      await doTransition('PMS', id, 'examFailT');
      const p = pjPartners().find(x=>x.id===id);
      return {stage: stateOf('PMS', p), arn: p.arnHolder, attempts: (p.examAttempts||[]).map(a=>a.result)};
    }, partner);
    if(r.stage !== 'doubtSession' || r.arn !== 'No' || r.attempts.join() !== 'Fail') throw new Error(JSON.stringify(r));
    return 'back at Doubt Solving after a Fail';
  });

  await t.step('the second attempt passes, ARN / EUIN are asked for, and the partner is onboarded', async () => {
    const r = await t.eval(async id=>{
      await doTransition('PMS', id, 'examDateT');      // the modal opens rather than moving
      document.getElementById('f_examDate').value = '2027-01-10';
      await pjSaveStageFields('PMS', id, 'examDateT', 'exam');
      await doTransition('PMS', id, 'examPassT');
      pjOpenArnModal('PMS', id, 'onboardedT');
      document.getElementById('f_arn').value = 'ARN-123456';
      document.getElementById('f_euin').value = 'E123456';
      await pjSaveStageFields('PMS', id, 'onboardedT', 'arn');
      const p = pjPartners().find(x=>x.id===id);
      return {stage: stateOf('PMS', p), attempts: (p.examAttempts||[]).map(a=>a.result), arn: p.arn, path: pmsPathFor(p).length};
    }, partner);
    if(r.stage !== 'onboarded' || r.attempts.join() !== 'Fail,Pass' || r.arn !== 'ARN-123456') throw new Error(JSON.stringify(r));
    return 'onboarded with ' + r.arn + ', attempts ' + r.attempts;
  });

  await t.step('the partner page draws its stepper, tabs and the PPS trail', async () => {
    const r = await t.eval(async id=>{
      navigate('pms', id); await new Promise(r=>setTimeout(r,80));
      const txt = document.getElementById('content').textContent;
      return {stepper: document.querySelectorAll('.stepper .step').length, exams: txt.includes('Exams'),
        ppsTrail: txt.includes('PPS')};
    }, partner);
    if(r.stepper < 7 || !r.exams) throw new Error(JSON.stringify(r));
    return r.stepper + ' steps on the stepper';
  });

  t.section('PQS, payouts and performance');

  await t.step('a query needs its resolution before it is resolved', async () => {
    const r = await t.eval(async id=>{
      pjOpenQueryForm(null, id);
      document.getElementById('f_subject').value = 'NISM study material';
      document.getElementById('f_category').value = 'Exam / NISM';
      document.getElementById('f_status').value = 'Resolved';
      await pjSaveQuery('');
      const refused = !pjQueries().some(q=>q.subject==='NISM study material');
      document.getElementById('f_status').value = 'Open';
      await pjSaveQuery('');
      closeModal();
      return {refused, saved: pjQueries().filter(q=>q.partnerId===id).length};
    }, partner);
    if(!r.refused || r.saved !== 1) throw new Error(JSON.stringify(r));
    return 'refused without a resolution, saved as Open';
  });

  await t.step('a payout works out gross and net, and Paid needs a date', async () => {
    const r = await t.eval(async id=>{
      pjOpenPayoutForm(null, id);
      document.getElementById('f_businessAmount').value = '100000';
      document.getElementById('f_ratePct').value = '1.5';
      document.getElementById('f_tdsPct').value = '2';
      document.getElementById('f_status').value = 'Paid';
      await pjSavePayout('');
      const refused = !pjPayouts().length;
      document.getElementById('f_paidOn').value = '2026-10-20';
      await pjSavePayout('');
      const p = pjPayouts().find(x=>x.partnerId===id);
      return {refused, gross: p && pjPayoutGross(p), net: p && pjPayoutNet(p)};
    }, partner);
    if(!r.refused || r.gross !== 1500 || r.net !== 1470) throw new Error(JSON.stringify(r));
    return 'gross ' + r.gross + ', net ' + r.net;
  });

  await t.step('the performance board reads the funnel and the partner', async () => {
    const r = await t.eval(async ()=>{
      navigate('ppf'); await new Promise(r=>setTimeout(r,80));
      const row = Array.from(document.querySelectorAll('#ppfTable tbody tr')).find(tr=>tr.textContent.includes('Asha Rao'));
      return {row: row ? row.textContent.replace(/\s+/g,' ').trim() : '',
        tiles: Array.from(document.querySelectorAll('.mkpi')).map(k=>k.textContent.replace(/\s+/g,' ').trim())};
    });
    if(!r.row || !/1,00,000|100,000/.test(r.row)) throw new Error(JSON.stringify(r));
    if(!r.tiles.some(x=>/Fee Paid 1/.test(x))) throw new Error('tiles: ' + r.tiles.join(' | '));
    return r.tiles.slice(0,3).join(' | ');
  });

  await t.step('the new stages are offered in stage permissions like LMS and CMS', async () => {
    const r = await t.eval(()=>Object.keys(BLUEPRINTS));
    if(!r.includes('PPS') || !r.includes('PMS')) throw new Error(r.join());
    return r.join(', ');
  });
});
