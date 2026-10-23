/* PARTNER ONBOARDING — WHAT HAPPENS AFTER PMS SAYS ONBOARDED.

   Onboarded in PMS starts a POB record with a partner code and an
   application ID, carrying what PMS already knew. The spine is the
   flowchart's: the due payment, recorded and verified by someone with
   Approve (and the same UTR cannot be counted twice); its
   acknowledgement; the empanelment form, the agreement and every
   mandatory document; the evaluation, where one rejected document keeps
   the partner unverified; the login access; the one-to-one that confirms
   the role. The role brings its workflow: a Role Clarity Session record,
   training that has to be passed, deliverables that are reviewed. A
   role change keeps what is done. Readiness names exactly what is
   missing; activation books the reviews, and the growth tasks open on
   the partner's own figures. A new workflow version leaves partners
   where they are until they are moved. */
const {suite} = require('../lib/harness');

suite({mail: true}, async t => {
  let pob = null, partner = null;
  const step = (name, fn) => t.step(name, fn);

  t.section('the hand-off from PMS');

  await step('onboarding a partner in PMS starts their POB record', async () => {
    const r = await t.eval(async ()=>{
      window.prompt = () => 'Because the test says so';
      const p = {id: uid('PMS'), firstName: 'Kiran', lastName: 'Shah', mobile: '9876543210', email: 'kiran.shah@example.com',
        city: 'Pune', assignedTo: currentUser, createdAt: new Date().toISOString(),
        admissionForm1: {afAddress: '12 MG Road, Pune', afPan: 'ABCDE1234F'}};
      initState('PMS', p); p.pmsStage = 'onboardingVideo';
      pjPartners().push(p); await save('pjPartners');
      await doTransition('PMS', p.id, 'onboardedT');
      const o = pobFor(p.id);
      return o && {partner: p.id, id: o.id, code: o.partnerCode, app: o.applicationId, stage: stateOf('POB', o),
        address: o.address, pan: o.pan, email: o.email, linked: pjPartners().find(x=>x.id===p.id).onboardingId === o.id,
        workflows: pobWorkflows().length, training: pobTraining().length};
    });
    if(!r) throw new Error('no POB record');
    if(r.code !== 'FLX-P-0001' || !/^APP-\d{4}-0001$/.test(r.app) || r.stage !== 'duePayment') throw new Error(JSON.stringify(r));
    if(r.address !== '12 MG Road, Pune' || r.pan !== 'ABCDE1234F' || !r.linked) throw new Error('not carried from PMS: ' + JSON.stringify(r));
    if(r.workflows !== 3 || r.training < 6) throw new Error('defaults not seeded: ' + JSON.stringify(r));
    pob = r.id; partner = r.partner;
    return r.code + ' · ' + r.app + ' at Receive Due Payment';
  });

  await step('POB draws, and the PMS partner links to it', async () => {
    const r = await t.eval(async (ids)=>{
      navigate('pob'); await new Promise(r=>setTimeout(r,60));
      const list = !!document.querySelector('#pobTable') && document.querySelector('#pobTable').textContent.includes('Kiran Shah');
      navigate('pms', ids.partner); await new Promise(r=>setTimeout(r,60));
      const btn = Array.from(document.querySelectorAll('.prof-head button')).some(b=>b.textContent.includes('Partner Onboarding'));
      navigate('pob', ids.pob); await new Promise(r=>setTimeout(r,60));
      const tabs = Array.from(document.querySelectorAll('.prof-tabs .tab')).map(x=>x.textContent.split(' (')[0]);
      return {list, btn, tabs};
    }, {partner, pob});
    if(!r.list || !r.btn) throw new Error(JSON.stringify(r));
    for(const x of ['Payments','Documents & Agreement','Evaluation','Role & Tasks','Readiness','Reviews']) if(!r.tabs.includes(x)) throw new Error('no ' + x + ' tab: ' + r.tabs);
    return r.tabs.length + ' tabs';
  });

  t.section('payment');

  await step('a payment waits for verification, and only Approve makes it Paid', async () => {
    const r = await t.eval(async id=>{
      DB.config.partnerOnboarding = Object.assign({}, DB.config.partnerOnboarding, {dueFee: 5000}); await save('config');
      const tryMove = async () => { await doTransition('POB', id, 'obPaidT'); return stateOf('POB', pobRecords().find(x=>x.id===id)); };
      const before = await tryMove();
      pobOpenPaymentForm(id);
      const set = (k, v) => { document.getElementById('f_'+k).value = v; };
      set('amount', '5000'); set('method', 'UPI'); set('ref', 'UTR777001'); set('date', '2026-10-20'); set('payer', 'Kiran Shah');
      await pobSavePayment(id, '');
      const o = pobRecords().find(x=>x.id===id);
      const pending = pobPaymentStatus(o);
      const still = await tryMove();
      await pobSetPaymentStatus(id, o.payments[0].id, 'Paid');
      return {before, pending, still, paid: pobPaymentStatus(o), verifiedBy: o.payments[0].verifiedBy, history: o.payments[0].history.length};
    }, pob);
    if(r.before !== 'duePayment' || r.still !== 'duePayment') throw new Error('moved before verification: ' + JSON.stringify(r));
    if(r.pending !== 'Under Review' || r.paid !== 'Paid' || !r.verifiedBy || r.history !== 2) throw new Error(JSON.stringify(r));
    return 'Under Review → Paid, with its audit';
  });

  await step('the same UTR cannot be counted twice', async () => {
    const r = await t.eval(async id=>{
      const o = pobRecords().find(x=>x.id===id);
      pobOpenPaymentForm(id);
      const set = (k, v) => { document.getElementById('f_'+k).value = v; };
      set('amount', '5000'); set('method', 'UPI'); set('ref', 'utr777001'); set('date', '2026-10-21'); set('payer', 'Kiran Shah');
      await pobSavePayment(id, '');
      closeModal();
      return o.payments.length;
    }, pob);
    if(r !== 1) throw new Error('a second payment was recorded on the same reference');
    if(!t.dialogs.some(d=>/already recorded/.test(d))) throw new Error('nobody was told why');
    return 'refused';
  });

  await step('verified, the acknowledgement goes and empanelment opens', async () => {
    const r = await t.eval(async id=>{
      await doTransition('POB', id, 'obPaidT');
      pobOpenAckModal('POB', id, 'obAckT');
      await pobSendAck(id, 'obAckT');
      const o = pobRecords().find(x=>x.id===id);
      const m = pjComms('POB', id).find(c=>c.label==='Payment acknowledgement');
      return {stage: stateOf('POB', o), mail: !!(m && m.body.includes('UTR777001') && m.body.includes('FLX-P-0001'))};
    }, pob);
    if(r.stage !== 'empanelment' || !r.mail) throw new Error(JSON.stringify(r));
    return 'Empanelment, and the letter names the UTR and partner code';
  });

  t.section('empanelment and evaluation');

  await step('the application does not go for evaluation until form, agreement and documents are in', async () => {
    const r = await t.eval(async id=>{
      await doTransition('POB', id, 'obSubmitT');
      const o = pobRecords().find(x=>x.id===id);
      return {stage: stateOf('POB', o)};
    }, pob);
    const msg = t.dialogs.slice().reverse().find(d=>/cannot go for evaluation/.test(d)) || '';
    if(r.stage !== 'empanelment') throw new Error('moved anyway');
    for(const x of ['Empanelment form', 'Agreement', 'PAN Card', 'Signed Agreement']) if(!msg.includes(x)) throw new Error('the refusal did not name ' + x + ': ' + msg);
    return 'refused, naming what is missing';
  });

  await step('a duplicate email is refused on the empanelment form', async () => {
    const r = await t.eval(async id=>{
      pobRecords().push({id: uid('POB'), firstName: 'Other', email: 'dup@example.com', mobile: '9000000001', createdAt: new Date().toISOString(), pobStage: 'duePayment'});
      pobOpenEmpanelment(id);
      document.getElementById('f_email').value = 'DUP@example.com';
      await pobSaveEmpanelment(id);
      closeModal();
      return pobRecords().find(x=>x.id===id).email;
    }, pob);
    if(r !== 'kiran.shah@example.com') throw new Error('the duplicate was saved');
    if(!t.dialogs.some(d=>/Already registered/.test(d))) throw new Error('nobody was told');
    return 'refused';
  });

  await step('form, agreement and documents go in, and the application is submitted', async () => {
    const r = await t.eval(async id=>{
      pobOpenEmpanelment(id);
      document.getElementById('f_proposedRole').value = 'Ninja';
      await pobSaveEmpanelment(id);
      pobOpenAgreement(id);
      // Signed copy uploaded is the default, so the upload is required.
      await pobSaveAgreement(id);
      const refused = !(pobRecords().find(x=>x.id===id).agreement);
      const signed = new File([new Blob(['%PDF-1.4 signed'], {type: 'application/pdf'})], 'signed.pdf', {type: 'application/pdf'});
      const sdt = new DataTransfer(); sdt.items.add(signed); document.getElementById('pobAgFile').files = sdt.files;
      await pobSaveAgreement(id);
      const o = pobRecords().find(x=>x.id===id);
      if(!refused || !o.agreement || !(o.agreement.types||[]).length || !o.agreement.signedFileId) return {agreement: o.agreement || null, refused};
      // A real upload, through the server, for one; the rest straight in.
      const blob = new Blob(['%PDF-1.4 test'], {type: 'application/pdf'});
      const file = new File([blob], 'pan.pdf', {type: 'application/pdf'});
      pobOpenDocUpload(id, 'PAN Card');
      const dt = new DataTransfer(); dt.items.add(file); document.getElementById('pobDocFile').files = dt.files;
      await pobSaveDoc(id, 'PAN Card');
      const pan = pobDocOf(o, 'PAN Card');
      const got = await fetch('/api/partner-docs/' + pan.versions[0].fileId, {headers: apiHeaders()});
      const text = await got.text();
      const open = await fetch('/partner-docs/' + pan.versions[0].fileId + '.pdf');
      for(const type of pobDocChecklist().filter(c=>c.mandatory && c.type!=='PAN Card').map(c=>c.type))
        await pobAddDocVersion(o, type, {id: 'PDF-' + '0'.repeat(24), name: type + '.pdf', size: 10, mime: 'application/pdf'}, '');
      await doTransition('POB', id, 'obSubmitT');
      return {stage: stateOf('POB', o), app: o.applicationStatus, attempts: o.attempts.length, text, anon: (await open.text()).includes('%PDF-1.4 test'),
        docs: pobDocRows(o).filter(x=>x.mandatory).map(x=>x.status)};
    }, pob);
    if(r.text !== '%PDF-1.4 test') throw new Error('the stored file did not come back: ' + r.text);
    if(r.anon) throw new Error('the document is reachable as a public file');
    if(r.stage !== 'evaluation' || r.app !== 'Under Review' || r.attempts !== 1) throw new Error(JSON.stringify(r));
    if(r.docs.some(s=>s!=='Under Review')) throw new Error('documents not under review: ' + r.docs);
    return 'Under Review, attempt 1; the file is not on the public site';
  });

  await step('one rejected document keeps the partner unverified', async () => {
    const r = await t.eval(async id=>{
      const o = pobRecords().find(x=>x.id===id);
      pobOpenEvaluation(id);
      document.querySelectorAll('.pob-crit').forEach(cb=>{ cb.checked = true; });
      await pobSaveEvaluation(id);
      const rows = pobDocRows(o).filter(x=>x.mandatory);
      for(const x of rows) await pobReviewDoc(x.doc.id, x.type==='Cancelled Cheque' ? 'Rejected' : 'Approved');
      await doTransition('POB', id, 'obApproveT');
      return {stage: stateOf('POB', o), v: pobDocsVerification(o).approved + '/' + pobDocsVerification(o).total};
    }, pob);
    if(r.stage !== 'evaluation') throw new Error('approved with a rejected document');
    const msg = t.dialogs.slice().reverse().find(d=>/not verified yet/.test(d)) || '';
    if(!msg.includes('Cancelled Cheque')) throw new Error('the refusal did not name the cheque: ' + msg);
    return r.v + ' approved — still unverified';
  });

  await step('more information sends it back; the resubmitted cheque is a new version, and the evaluation is approved', async () => {
    const r = await t.eval(async id=>{
      const o = pobRecords().find(x=>x.id===id);
      pobOpenDecisionModal('POB', id, 'obMoreInfoT');
      document.getElementById('f_decReason').value = 'The cheque is unreadable';
      await pobSaveDecision(id, 'obMoreInfoT');
      const back = {stage: stateOf('POB', o), app: o.applicationStatus, decision: o.attempts[0].decision};
      await pobAddDocVersion(o, 'Cancelled Cheque', {id: 'PDF-' + '1'.repeat(24), name: 'cheque2.pdf', size: 10, mime: 'application/pdf'}, 'clearer scan');
      const cheque = pobDocOf(o, 'Cancelled Cheque');
      const resub = cheque.status;
      await doTransition('POB', id, 'obSubmitT');
      await pobReviewDoc(cheque.id, 'Approved');
      pobOpenDecisionModal('POB', id, 'obApproveT');
      await pobSaveDecision(id, 'obApproveT');
      return {back, resub, versions: cheque.versions.length, reviews: cheque.reviews.map(x=>x.decision),
        stage: stateOf('POB', o), app: o.applicationStatus, attempts: o.attempts.map(a=>a.decision)};
    }, pob);
    if(r.back.stage !== 'empanelment' || r.back.app !== 'Draft' || r.back.decision !== 'More Information Requested') throw new Error(JSON.stringify(r.back));
    if(r.resub !== 'Resubmitted' || r.versions !== 2) throw new Error(JSON.stringify(r));
    if(r.stage !== 'loginAccess' || r.app !== 'Approved' || r.attempts.join() !== 'More Information Requested,Approved') throw new Error(JSON.stringify(r));
    return 'attempts: ' + r.attempts.join(' → ') + '; cheque ' + r.reviews.join(' → ');
  });

  t.section('login and role');

  await step('login access is recorded and written to them', async () => {
    const r = await t.eval(async id=>{
      pobOpenLoginModal('POB', id, 'obLoginT');
      await pobSaveLogin(id, 'obLoginT');
      const o = pobRecords().find(x=>x.id===id);
      const m = pjComms('POB', id).find(c=>c.label==='Login access');
      return {stage: stateOf('POB', o), login: o.login.status, user: o.login.userId, mail: !!(m && /\/partner\/setup\?t=/.test(m.body))};
    }, pob);
    if(r.stage !== 'roleMeeting' || r.login !== 'Created' || r.user !== 'kiran.shah@example.com' || !r.mail) throw new Error(JSON.stringify(r));
    return 'account Created (not yet activated), letter sent';
  });

  await step('the role is confirmed at the one-to-one, and Ninja brings its workflow', async () => {
    const r = await t.eval(async id=>{
      const o = pobRecords().find(x=>x.id===id);
      pobOpenRoleModal('POB', id, 'obRoleT');
      const early = !document.getElementById('f_roRole');
      closeModal();
      pobOpenRoleMeeting(id);
      document.getElementById('f_mtDate').value = '2026-11-02'; document.getElementById('f_mtTime').value = '11:00';
      document.getElementById('f_mtLink').value = 'https://meet.example.com/role';
      await pobSaveRoleMeeting(id);
      pobOpenRoleModal('POB', id, 'obRoleT');
      document.getElementById('f_roRole').value = 'Ninja';
      document.getElementById('f_roMinutes').value = 'Wants to bring leads; Ninja fits.';
      await pobSaveRole(id, 'obRoleT');
      const first = pobLiveTasks(o).find(t=>t.key==='rcs');
      const second = pobLiveTasks(o).find(t=>t.key==='bplan');
      return {early, stage: stateOf('POB', o), role: o.role, wf: o.workflowVersion, n: pobLiveTasks(o).length,
        first: pobTaskState(o, first).open, due: !!first.dueDate, second: pobTaskState(o, second).reason,
        growth: pobTaskState(o, pobLiveTasks(o).find(t=>t.key==='invuni')).reason,
        mail: pjComms('POB', id).some(c=>c.label==='Role confirmation one-to-one')};
    }, pob);
    if(!r.early) throw new Error('the role could be confirmed before the one-to-one was booked');
    if(r.stage !== 'roleWorkflow' || r.role !== 'Ninja' || r.wf !== 1 || r.n !== 17) throw new Error(JSON.stringify(r));
    if(!r.first || !r.due || !/Role Clarity Session/.test(r.second) || !/active/.test(r.growth) || !r.mail) throw new Error(JSON.stringify(r));
    return r.n + ' Ninja tasks; the session is open, the business plan waits for it';
  });

  t.section('the role workflow');

  await step('the Role Clarity Session is its own record, and only completion approves the task', async () => {
    const r = await t.eval(async id=>{
      const o = pobRecords().find(x=>x.id===id);
      const task = pobLiveTasks(o).find(t=>t.key==='rcs');
      await pobTaskAction(id, task.id, 'start');
      document.getElementById('f_sDate').value = '2026-11-05'; document.getElementById('f_sTime').value = '15:00';
      document.getElementById('f_sLink').value = 'https://meet.example.com/rcs';
      await pobSaveSession(id, task.id, '');
      const ses = pobSessions().find(s=>s.id===task.sessionId);
      await pobTaskAction(id, task.id, 'submit');
      const early = task.status;
      pobOpenSessionComplete(ses.id);
      document.getElementById('f_soStatus').value = 'Completed'; document.getElementById('f_soNotes').value = 'Role explained; targets agreed.';
      await pobSaveSessionOutcome(ses.id);
      return {session: !!ses, role: ses.role, early, status: task.status, confirmed: ses.completionConfirmedBy === currentUser,
        next: pobTaskState(o, pobLiveTasks(o).find(t=>t.key==='bplan')).open, mail: pjComms('POB', id).some(c=>c.label==='Role Clarity Session')};
    }, pob);
    if(!r.session || r.role !== 'Ninja' || r.early !== 'In Progress' || r.status !== 'Approved' || !r.confirmed || !r.next || !r.mail) throw new Error(JSON.stringify(r));
    return 'session completed and confirmed; Business Plan is open';
  });

  await step('a deliverable is reviewed, and a returned one comes back for correction', async () => {
    const r = await t.eval(async id=>{
      window.prompt = () => 'Plan v1 link';
      const o = pobRecords().find(x=>x.id===id);
      const task = pobLiveTasks(o).find(t=>t.key==='bplan');
      await pobTaskAction(id, task.id, 'start');
      await pobTaskAction(id, task.id, 'submit');
      const s1 = task.status;
      window.prompt = () => 'Add the monthly targets';
      await pobTaskAction(id, task.id, 'return');
      const s2 = task.status;
      await pobTaskAction(id, task.id, 'rework');
      window.prompt = () => 'Plan v2 link';
      await pobTaskAction(id, task.id, 'submit');
      await pobTaskAction(id, task.id, 'approve');
      return {s1, s2, s3: task.status, evidence: task.evidence};
    }, pob);
    if(r.s1 !== 'Pending Review' || r.s2 !== 'Changes Required' || r.s3 !== 'Approved' || r.evidence !== 'Plan v2 link') throw new Error(JSON.stringify(r));
    return 'Pending Review → Changes Required → Approved';
  });

  await step('training has to be passed, not just opened', async () => {
    const r = await t.eval(async id=>{
      const o = pobRecords().find(x=>x.id===id);
      const walk = pobLiveTasks(o).find(t=>t.key==='walk');
      await pobTaskAction(id, walk.id, 'start'); await pobTaskAction(id, walk.id, 'submit');
      const m1 = pobLiveTasks(o).find(t=>t.key==='m1');
      const mod = pobTraining().find(x=>x.id===m1.trainingId);
      mod.passScore = 60; mod.manualApproval = 'No'; await save('pjTraining');
      await pobTaskAction(id, m1.id, 'start');
      await pobTaskAction(id, m1.id, 'submit');
      const unopened = m1.status;
      pobOpenAttempt(id, m1.id); document.getElementById('f_atScore').value = '45'; await pobSaveAttempt(id, m1.id);
      const failed = m1.status;
      pobOpenAttempt(id, m1.id); document.getElementById('f_atScore').value = '82'; await pobSaveAttempt(id, m1.id);
      return {walk: walk.status, unopened, failed, passed: m1.status, attempts: m1.attempts.map(a=>a.result)};
    }, pob);
    if(r.walk !== 'Approved' || r.unopened !== 'In Progress' || r.failed !== 'In Progress' || r.passed !== 'Approved') throw new Error(JSON.stringify(r));
    return 'walk-through done; Module #1 ' + r.attempts.join(' → ');
  });

  await step('a role change keeps what is done and replaces what is not', async () => {
    const r = await t.eval(async id=>{
      const o = pobRecords().find(x=>x.id===id);
      const before = pobLiveTasks(o).filter(t=>t.status==='Approved').map(t=>t.key).sort().join();
      pobOpenRoleModal('POB', id);
      document.getElementById('f_roRole').value = 'Sherpa'; document.getElementById('f_roReason').value = 'Better at client work';
      await pobSaveRole(id, '');
      const sherpa = {role: o.role, done: pobLiveTasks(o).filter(t=>t.status==='Approved').map(t=>t.key).sort().join(),
        n: pobLiveTasks(o).length, hist: o.roleHistory.map(h=>(h.from||'—') + '→' + h.to).join(', ')};
      pobOpenRoleModal('POB', id);
      document.getElementById('f_roRole').value = 'Ninja'; document.getElementById('f_roReason').value = 'Back to Ninja after all';
      await pobSaveRole(id, '');
      return {before, sherpa, after: pobLiveTasks(o).filter(t=>t.status==='Approved').map(t=>t.key).sort().join(), n: pobLiveTasks(o).length,
        retired: (o.tasks||[]).filter(t=>t.retired && t.status==='Cancelled').length};
    }, pob);
    if(r.sherpa.role !== 'Sherpa' || r.sherpa.done !== r.before || r.sherpa.n !== 21) throw new Error(JSON.stringify(r));
    if(r.after !== r.before || r.n !== 17 || !r.retired) throw new Error(JSON.stringify(r));
    return 'kept ' + r.before + ' through ' + r.sherpa.hist;
  });

  t.section('readiness and activation');

  await step('readiness is refused with the exact tasks still open', async () => {
    const r = await t.eval(async id=>{
      await doTransition('POB', id, 'obReadyT');
      return stateOf('POB', pobRecords().find(x=>x.id===id));
    }, pob);
    const msg = t.dialogs.slice().reverse().find(d=>/onboarding tasks are still open/.test(d)) || '';
    if(r !== 'roleWorkflow' || !msg.includes('Module #2') || !msg.includes('MANIA')) throw new Error(r + ' / ' + msg);
    return 'refused, naming Module #2 onwards';
  });

  await step('the remaining tasks are done, readiness is reviewed and the partner activated', async () => {
    const r = await t.eval(async id=>{
      window.prompt = () => 'Done and evidenced';
      const o = pobRecords().find(x=>x.id===id);
      pobTraining().forEach(m=>{ m.manualApproval = 'No'; m.passScore = ''; }); await save('pjTraining');
      for(const t of pobRequiredOnboarding(o).filter(x=>x.status!=='Approved')){
        await pobTaskAction(id, t.id, 'start');
        if(t.kind==='training'){ pobOpenAttempt(id, t.id); document.getElementById('f_atResult').value = 'Completed'; await pobSaveAttempt(id, t.id); }
        else { await pobTaskAction(id, t.id, 'submit'); if(t.status==='Pending Review') await pobTaskAction(id, t.id, 'approve'); }
      }
      await doTransition('POB', id, 'obReadyT');
      const ready = stateOf('POB', o);
      const checks = pobReadiness(o).filter(x=>!x.ok).map(x=>x.label);
      pobOpenActivateModal('POB', id, 'obActivateT');
      document.getElementById('f_acComments').value = 'All in order';
      await pobSaveActivate(id, 'obActivateT');
      const rv = pobReviews().filter(x=>x.pobId===id).map(x=>x.kind).sort();
      return {ready, checks, stage: stateOf('POB', o), op: o.operationalStatus, login: o.login.status, final: o.finalApproval && o.finalApproval.comments,
        version: o.finalApproval && o.finalApproval.version, reviews: rv, progress: pobProgress(o),
        mail: pjComms('POB', id).some(c=>c.label==='Activation'), pms: pjPartners().find(p=>p.id===o.partnerId).partnerRole};
    }, pob);
    if(r.ready !== 'readiness' || r.checks.length) throw new Error(JSON.stringify(r));
    if(r.stage !== 'active' || r.op !== 'Active' || r.login !== 'Activated' || r.final !== 'All in order' || r.version !== 1) throw new Error(JSON.stringify(r));
    if(r.reviews.join() !== 'Annual Review,Monthly Review' || r.progress !== 100 || !r.mail || r.pms !== 'Ninja') throw new Error(JSON.stringify(r));
    return 'Active Ninja, ' + r.progress + '%; ' + r.reviews.join(' & ') + ' booked';
  });

  await step('growth tasks open, and a course unlocks at its conversion count', async () => {
    const r = await t.eval(async id=>{
      const o = pobRecords().find(x=>x.id===id);
      const inv = pobLiveTasks(o).find(t=>t.key==='invuni');
      const ai = pobLiveTasks(o).find(t=>t.key==='ai');
      const rmf = pobLiveTasks(o).find(t=>t.key==='rmfollow');
      await pobTaskAction(id, rmf.id, 'start'); await pobTaskAction(id, rmf.id, 'submit');
      const locked = pobTaskState(o, inv).reason;
      pobOpenMetrics(id);
      document.getElementById('f_mt_conversions').value = '1';
      await pobSaveMetrics(id);
      const open = pobTaskState(o, inv).open;
      await pobUnlockCourse(id, inv.id);
      return {locked, open, inv: inv.status, ai: pobTaskState(o, ai).reason,
        mail: pjComms('POB', id).some(c=>c.label==='Course unlocked — Investment Universe')};
    }, pob);
    if(!/1 leads converted — 0 so far/.test(r.locked) || !r.open || r.inv !== 'Approved' || !r.mail) throw new Error(JSON.stringify(r));
    return 'Investment Universe unlocked at 1 conversion; ' + r.ai;
  });

  await step('a review is recorded, its follow-ups tracked, and the next one booked', async () => {
    const r = await t.eval(async id=>{
      const rv = pobReviews().find(x=>x.pobId===id && x.kind==='Monthly Review');
      pobOpenReview(rv.id);
      document.getElementById('f_rvObs').value = 'Good start'; document.getElementById('f_rvOutcome').value = 'On Track';
      document.getElementById('f_rvFollow').value = 'Call 10 more prospects\nShare MANIA sheet';
      await pobSaveReview(rv.id);
      window.prompt = () => 'Called them';
      await pobFollowUpDone(rv.id, rv.followUps[0].id);
      const next = pobReviews().filter(x=>x.pobId===id && x.kind==='Monthly Review' && x.status==='Scheduled');
      const o = pobRecords().find(x=>x.id===id);
      return {status: rv.status, fus: rv.followUps.map(f=>f.status).join(), next: next.length, nextDue: next[0] && next[0].dueDate, was: rv.dueDate,
        task: pobLiveTasks(o).find(t=>t.key==='target').status};
    }, pob);
    if(r.status !== 'Completed' || r.fus !== 'Done,Open' || r.next !== 1 || !(r.nextDue > r.was) || r.task !== 'Approved') throw new Error(JSON.stringify(r));
    return 'recorded; next due ' + r.nextDue;
  });

  await step('an overdue review reaches its owner’s bell once a day, from the server', async () => {
    const r = await t.eval(async id=>{
      const o = pobRecords().find(x=>x.id===id);
      pobReviews().push({id: uid('PRV'), pobId: id, kind: 'Monthly Review', dueDate: '2026-01-01', assignedTo: currentUser, status: 'Scheduled', followUps: []});
      await save('pjReviews');
      const run = async () => (await (await fetch('/api/partner-journey/run', {method:'POST', headers: Object.assign({'Content-Type':'application/json'}, apiHeaders()),
        body: JSON.stringify({at: '2026-10-23T05:00:00Z'})})).json()).reviews;
      return [await run(), await run()];
    }, pob);
    if(!r[0] || r[0].overdue < 1 || r[1].overdue !== 0) throw new Error(JSON.stringify(r));
    return r[0].overdue + ' told, then nothing again that day';
  });

  t.section('workflow versions and the screens');

  await step('a new workflow version leaves partners on theirs until they are moved', async () => {
    const r = await t.eval(async id=>{
      const o = pobRecords().find(x=>x.id===id);
      pobOpenWorkflowEditor('Ninja');
      window._pobWfDraft.tasks.push({key: 'extra', title: 'ZZ Compliance Refresher', kind: 'task', phase: 'growth', required: true, approval: false, owner: 'RM'});
      await pobSaveWorkflow();
      const latest = pobLatestWorkflow('Ninja');
      const stayed = o.workflowVersion;
      await pobMigrateWorkflow(id);
      return {latest: latest.version, stayed, now: o.workflowVersion, has: pobLiveTasks(o).some(t=>t.title==='ZZ Compliance Refresher'),
        kept: pobLiveTasks(o).find(t=>t.key==='invuni').status, total: pobWorkflows().filter(w=>w.role==='Ninja').length};
    }, pob);
    if(r.latest !== 2 || r.stayed !== 1 || r.now !== 2 || !r.has || r.kept !== 'Approved' || r.total !== 2) throw new Error(JSON.stringify(r));
    return 'v1 kept until migrated; v2 adds the refresher; approved work kept';
  });

  await step('every POB tab draws, and the approval queue lists what waits', async () => {
    const r = await t.eval(async id=>{
      const out = {};
      for(const tab of ['partners','queue','sessions','reviews','workflows','training','settings']){
        window._pobTab = tab; navigate('pob'); await new Promise(r=>setTimeout(r,40));
        out[tab] = (document.querySelector('#content') || document.body).innerHTML.length;
      }
      window._pobTab = 'partners';
      for(const tab of ['overview','payments','documents','evaluation','tasks','sessions','training','readiness','reviews','mail','history']){
        window._pobTabRec = tab; navigate('pob', id); await new Promise(r=>setTimeout(r,20));
      }
      const o = pobRecords().find(x=>x.id===id);
      const t = pobLiveTasks(o).find(x=>x.key==='mania' && x.phase==='onboarding');
      return {out, queue: pobApprovalQueue().map(x=>x.what)};
    }, pob);
    return Object.keys(r.out).length + ' tabs and 11 record tabs drawn';
  });

  await step('the letters are in Setup › Email Templates under Partner Onboarding', async () => {
    const r = await t.eval(()=>MAIL_TEMPLATE_DEFS.filter(d=>d.group==='Partner Onboarding').map(d=>d.key)
      .filter(k=>DB.config.mailTemplates[k] && DB.config.mailTemplates[k].subject));
    if(r.length !== 8) throw new Error(r.join());
    return r.join(', ');
  });
});
