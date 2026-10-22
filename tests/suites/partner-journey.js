/* THE PARTNER JOURNEY.

   A section of its own in the rail, with five modules. A prospect is
   registered against a webinar in PPS — on a referral code, whose name
   fills itself in — and walks the flowchart's stages until the ₹1,999
   fee is paid with its UTR and somebody verifies it; verifying creates
   the partner in PMS and the page follows them there. In PMS a partner
   who is not an ARN holder fills admission form 1, has the induction
   (booked, then minuted), the courses, NISM and the exam — a fail goes
   back to the doubt solving session — and a pass goes to ARN / EUIN
   registration, which pauses for verification before the onboarding
   video and the onboarding itself. Queries, payouts and the performance
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

  await t.step('a referral code is set up, and the prospect form has no Source', async () => {
    const r = await t.eval(async ()=>{
      window._ppsTab = 'referrals'; navigate('pps');
      pjOpenReferralForm();
      document.getElementById('f_code').value = 'ms-ravi01';
      document.getElementById('f_name').value = 'Ravi Monk';
      await pjSaveReferral('');
      window._ppsTab = 'prospects';
      pjOpenProspectForm();
      const ids = Array.from(document.querySelectorAll('#modalBody [id^="f_"]')).map(e=>e.id);
      closeModal();
      return {code: (pjReferralByCode('MS-RAVI01')||{}).name, source: ids.includes('f_source'), referral: ids.includes('f_referralCode') && ids.includes('f_referralName')};
    });
    if(r.code !== 'Ravi Monk' || r.source || !r.referral) throw new Error(JSON.stringify(r));
    return 'MS-RAVI01 is Ravi Monk; the form asks for the code, not the source';
  });

  await t.step('a prospect is registered on the code, and the name fills itself in', async () => {
    const r = await t.eval(async wid=>{
      pjOpenProspectForm();
      const set = (k, v) => { const el = document.getElementById('f_'+k); el.value = v; el.dispatchEvent(new Event('change', {bubbles:true})); };
      set('firstName', 'Asha'); set('lastName', 'Rao'); set('mobile', '9876512345'); set('email', 'asha.rao@example.com');
      const code = document.getElementById('f_referralCode'); code.value = 'ms-ravi01'; code.dispatchEvent(new Event('input', {bubbles:true}));
      const filled = document.getElementById('f_referralName').value;
      set('commChannel', 'Email'); set('webinarId', wid);
      await pjSaveProspect('');
      await new Promise(r=>setTimeout(r,80));
      const p = pjProspects().find(x=>x.firstName==='Asha');
      return p && {filled, id: p.id, stage: stateOf('PPS', p), view: currentView, open: ppsDetailId,
        code: p.referralCode, name: p.referralName, source: p.source,
        offered: availableTransitions('PPS', stateOf('PPS', p), 'forward', p).map(x=>x.id)};
    }, webinar);
    if(!r) throw new Error('prospect not saved');
    if(r.filled !== 'Ravi Monk' || r.code !== 'MS-RAVI01' || r.name !== 'Ravi Monk' || r.source !== 'Master Sherpa') throw new Error(JSON.stringify(r));
    if(r.stage !== 'registered' || r.open !== r.id) throw new Error(JSON.stringify(r));
    if(r.offered.join() !== 'ackEmailT') throw new Error('an email registration should be offered only the email step: ' + r.offered);
    prospect = r.id;
    return r.id + ' at Registered on ' + r.code + ' (' + r.name + '), offered ' + r.offered;
  });

  await t.step('a code nobody holds is refused', async () => {
    const r = await t.eval(async ()=>{
      const before = pjProspects().length;
      pjOpenProspectForm();
      const set = (k, v) => { const el = document.getElementById('f_'+k); el.value = v; el.dispatchEvent(new Event('change', {bubbles:true})); };
      set('firstName', 'Nobody'); set('mobile', '9876500000'); set('referralCode', 'NOPE'); set('commChannel', 'Email');
      await pjSaveProspect('');
      closeModal();
      return pjProspects().length - before;
    });
    if(r !== 0) throw new Error('saved anyway');
    return 'not saved';
  });

  await t.step('the acknowledgement carries their own registration form', async () => {
    const r = await t.eval(async id=>{
      pjOpenAckModal('PPS', id, 'ackEmailT');
      await pjSendAck(id, 'ackEmailT');
      const p = pjProspects().find(x=>x.id===id);
      const mail = pjComms('PPS', id).find(c=>c.label==='Acknowledgement & registration form');
      return {stage: stateOf('PPS', p), token: p.ackFormToken, link: !!(mail && mail.body.includes('/partner-form?pf=' + encodeURIComponent(p.ackFormToken)))};
    }, prospect);
    if(r.stage !== 'acknowledged' || !r.token || r.token.length < 16 || !r.link) throw new Error(JSON.stringify(r));
    return 'Acknowledged, and the letter links /partner-form';
  });

  await t.step('the stages walk to the session, and Payment Not Done goes to the RM', async () => {
    const r = await t.eval(async id=>{
      for(const tid of ['remindersT','sessionDayT']) await doTransition('PPS', id, tid);
      pjOpenPaymentLinkModal('PPS', id, 'attendedYesT');
      document.getElementById('f_paymentLink').value = 'https://pay.example.com/fee';
      await pjSendPaymentLink(id, 'attendedYesT');
      await doTransition('PPS', id, 'notPaidT');
      const p = pjProspects().find(x=>x.id===id);
      return {stage: stateOf('PPS', p), open: ppsDetailId, trail: p.blueprintHistory.length, link: p.paymentLink,
        mailed: pjComms('PPS', id).some(c=>c.label==='Payment link' && c.body.includes('https://pay.example.com/fee'))};
    }, prospect);
    if(r.stage !== 'rmFollowUp') throw new Error('stage ' + r.stage);
    if(r.open !== prospect) throw new Error('the page left the prospect');
    if(!r.mailed) throw new Error('the payment link letter was not written');
    return 'at RM Follow-up, ' + r.trail + ' entries on the trail, payment link written';
  });

  await t.step('Payment Done needs its UTR, and waits for verification', async () => {
    const r = await t.eval(async id=>{
      pjOpenPaymentModal('PPS', id, 'paidAfterCallT');
      const amount = document.getElementById('f_feeAmount').value;
      document.getElementById('f_feeMode').value = 'UPI';
      document.getElementById('f_feeRef').value = '';
      await pjSavePayment(id, 'paidAfterCallT');
      const refused = stateOf('PPS', pjProspects().find(x=>x.id===id));
      document.getElementById('f_feeRef').value = 'UTR123';
      await pjSavePayment(id, 'paidAfterCallT');
      const p = pjProspects().find(x=>x.id===id);
      return {amount, refused, stage: stateOf('PPS', p), partner: p.partnerId || null};
    }, prospect);
    if(String(r.amount).replace(/,/g,'') !== '1999') throw new Error('fee should default to 1999, was ' + r.amount);
    if(r.refused !== 'rmFollowUp') throw new Error('saved without a UTR: ' + r.refused);
    if(r.stage !== 'paymentVerification' || r.partner) throw new Error(JSON.stringify(r));
    return 'refused without a UTR, then at Verification Pending — no partner yet';
  });

  await t.step('verifying the payment creates the partner in PMS and sends the welcome', async () => {
    const r = await t.eval(async id=>{
      pjOpenVerifyPaymentModal('PPS', id, 'payVerifiedT');
      await pjVerifyPayment(id, 'payVerifiedT');
      await new Promise(r=>setTimeout(r,120));
      const p = pjProspects().find(x=>x.id===id);
      const m = pjPartners().find(x=>x.id===p.partnerId);
      return {stage: stateOf('PPS', p), partner: m && m.id, pstage: m && stateOf('PMS', m), verified: !!p.feeVerifiedAt,
        owner: m && m.leadOwner, fee: m && m.feeAmount, view: currentView, open: pmsDetailId, code: m && m.referralCode,
        welcome: m && pjComms('PMS', m.id).some(c=>c.label==='Payment acknowledgement & welcome')};
    }, prospect);
    if(r.stage !== 'converted' || !r.partner || !r.verified) throw new Error(JSON.stringify(r));
    if(r.view !== 'pms' || r.open !== r.partner) throw new Error('the page should follow to PMS: ' + JSON.stringify(r));
    if(r.owner !== 'Master Sherpa / Monk' || r.code !== 'MS-RAVI01') throw new Error('a referred prospect is their referrer’s: ' + JSON.stringify(r));
    if(!r.welcome) throw new Error('no welcome letter on the partner');
    partner = r.partner;
    return r.partner + ' in PMS at ' + r.pstage + ', fee ' + r.fee + ', welcome written';
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

  await t.step('the ARN question reads ARN Holder / Not an ARN Holder', async () => {
    const r = await t.eval(()=>getBlueprint('PMS').transitions.filter(x=>x.from==='oneToOne' && x.kind==='forward').map(x=>x.label));
    if(r.join('|') !== 'Not an ARN Holder|ARN Holder') throw new Error(r.join('|'));
    return r.join(' / ');
  });

  await t.step('the one-to-one, admission form 1 and the induction are booked, written to and minuted', async () => {
    const r = await t.eval(async id=>{
      const set = (k, v) => { document.getElementById('f_'+k).value = v; };
      await doTransition('PMS', id, 'gurukulAccessT');
      pjOpenMeetingModal('PMS', id, 'ownerSherpaT');
      set('mtDate', '2026-11-10'); set('mtTime', '11:00'); set('mtLink', 'https://meet.example.com/one');
      await pjSaveMeeting(id, 'ownerSherpaT');
      pjOpenAdmissionModal('PMS', id, 'arnNoT');
      set('afDob', '1990-05-01'); set('afPan', 'ABCDE1234F'); set('afQualification', 'B.Com');
      set('mtDate', '2026-11-12'); set('mtTime', '16:00'); set('mtLink', 'https://meet.example.com/ind');
      await pjSaveAdmission(id, 'arnNoT');
      pjOpenMomModal('PMS', id, 'inductionT');
      set('momMinutes', 'Walked through the partnership.');
      await pjSaveMom(id, 'inductionT');
      const p = pjPartners().find(x=>x.id===id);
      const labels = pjComms('PMS', id).map(c=>c.label);
      return {stage: stateOf('PMS', p), owner: p.leadOwner, arn: p.arnHolder, form: !!(p.admissionForm1 && p.admissionForm1.afPan),
        mom: (p.pjMeetings||[]).length, one: p.oneToOneMeeting && p.oneToOneMeeting.link,
        mails: ['One-to-one invitation','Partner induction invitation'].every(l=>labels.includes(l))};
    }, partner);
    if(r.stage !== 'induction' || r.arn !== 'No' || !r.form || r.mom !== 1 || !r.one || !r.mails) throw new Error(JSON.stringify(r));
    return 'at Partner Induction, form 1 kept, one-to-one and induction letters written, minutes saved';
  });

  await t.step('the courses are unlocked and NISM is registered with the doubt session', async () => {
    const r = await t.eval(async id=>{
      const set = (k, v) => { document.getElementById('f_'+k).value = v; };
      pjOpenCoursesModal('PMS', id, 'coursesT');
      document.querySelectorAll('.pj-course').forEach((c, i)=>{ c.checked = i < 2; });
      await pjSaveCourses(id, 'coursesT');
      pjOpenNismModal('PMS', id, 'nismT');
      set('nismRegNo', 'NISM-778899'); set('mtDate', '2026-11-20'); set('mtTime', '18:30'); set('mtLink', 'https://meet.example.com/doubt');
      await pjSaveNism(id, 'nismT');
      pjOpenMomModal('PMS', id, 'doubtT');
      set('momMinutes', 'Cleared doubts on chapter 4.');
      await pjSaveMom(id, 'doubtT');
      const p = pjPartners().find(x=>x.id===id);
      const nismMail = pjComms('PMS', id).find(c=>c.label==='NISM registration & doubt session');
      return {stage: stateOf('PMS', p), courses: p.coursesUnlocked, nism: p.nism && p.nism.nismRegNo,
        mailOk: !!(nismMail && nismMail.body.includes('NISM-778899') && nismMail.body.includes('https://meet.example.com/doubt'))};
    }, partner);
    if(r.stage !== 'doubtSession' || (r.courses||[]).length !== 2 || r.nism !== 'NISM-778899' || !r.mailOk) throw new Error(JSON.stringify(r));
    return 'at Doubt Solving, ' + r.courses.join(' + ') + ' unlocked, NISM letter carries the number and the link';
  });

  await t.step('not an ARN holder: a failed exam goes back', async () => {
    const r = await t.eval(async id=>{
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

  await t.step('the second attempt passes, and ARN / EUIN details pause for verification', async () => {
    const r = await t.eval(async id=>{
      const set = (k, v) => { document.getElementById('f_'+k).value = v; };
      pjOpenExamDateModal('PMS', id, 'examDateT');
      set('examDate', '2027-01-10');
      await pjSaveStageFields('PMS', id, 'examDateT', 'exam');
      await doTransition('PMS', id, 'examPassT');
      pjOpenArnModal('PMS', id, 'arnSubmitT');
      set('arn', 'ARN-123456'); set('arnName', 'Asha Rao'); set('arnValidFrom', '2027-02-01'); set('arnValidTo', '2027-01-01');
      set('euin', 'E123456'); set('euinName', 'Asha Rao'); set('euinValidFrom', '2027-02-01'); set('euinValidTo', '2030-01-31');
      await pjSaveStageFields('PMS', id, 'arnSubmitT', 'arn');
      const backwards = stateOf('PMS', pjPartners().find(x=>x.id===id));
      set('arnValidTo', '2030-01-31');
      await pjSaveStageFields('PMS', id, 'arnSubmitT', 'arn');
      const p = pjPartners().find(x=>x.id===id);
      return {backwards, stage: stateOf('PMS', p), attempts: (p.examAttempts||[]).map(a=>a.result), arn: p.arn, name: p.arnName, until: p.arnValidTo};
    }, partner);
    if(r.backwards !== 'arnRegistration') throw new Error('took a validity that ends before it starts');
    if(r.stage !== 'arnVerification' || r.attempts.join() !== 'Fail,Pass' || r.arn !== 'ARN-123456' || r.name !== 'Asha Rao') throw new Error(JSON.stringify(r));
    return 'Verification Pending with ' + r.arn + ' (' + r.name + ') valid to ' + r.until + ', attempts ' + r.attempts;
  });

  await t.step('verified, the onboarding video goes, a one-to-one is booked, and the partner is onboarded', async () => {
    const r = await t.eval(async id=>{
      const set = (k, v) => { document.getElementById('f_'+k).value = v; };
      pjOpenMeetingModal('PMS', id, 'arnVerifiedT');
      set('videoLink', 'https://video.example.com/onboard'); set('mtDate', '2027-02-05'); set('mtTime', '10:30'); set('mtLink', 'https://meet.example.com/onb');
      await pjSaveMeeting(id, 'arnVerifiedT');
      const mid = stateOf('PMS', pjPartners().find(x=>x.id===id));
      pjOpenMeetingModal('PMS', id, 'oneToOneOnbT');
      set('mtDate', '2027-02-07'); set('mtTime', '12:00'); set('mtLink', 'https://meet.example.com/onb121');
      await pjSaveMeeting(id, 'oneToOneOnbT');
      await doTransition('PMS', id, 'onboardedAfterMeetT');
      const p = pjPartners().find(x=>x.id===id);
      const video = pjComms('PMS', id).find(c=>c.label==='Onboarding video & meeting');
      return {mid, stage: stateOf('PMS', p), verified: !!p.arnVerifiedAt, onboarded: !!p.onboardedAt,
        video: !!(video && video.body.includes('https://video.example.com/onboard')), path: pmsPathFor(p)};
    }, partner);
    if(r.mid !== 'onboardingVideo' || r.stage !== 'onboarded' || !r.verified || !r.onboarded || !r.video) throw new Error(JSON.stringify(r));
    if(!r.path.includes('onboardingOneToOne')) throw new Error('the stepper should show the one-to-one that happened');
    return 'onboarded after the video and a one-to-one; ' + r.path.length + ' steps on the road';
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
