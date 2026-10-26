/* B2B CHANGES 3 — WHO CHECKS WHAT, THE ONE FORM, AND THE PARTNER IN BOSS.

   The session reminders and the joining link go to everybody registered
   for the webinar by themselves, and the stage follows; a prospect
   acknowledged late still gets what they missed, and the session
   starting moves whoever was waiting. An RM never verifies what they put
   in: a fee payment and the ARN / EUIN details go to their reporting
   manager, who is emailed; the ARN and the EUIN are each optional, but
   one is needed, with its registered mobile. The empanelment form,
   documents and agreement go to the partner as one page on a token;
   choosing to upload the signed agreement makes the upload mandatory;
   submitting sends it for evaluation to the owner's reporting manager.
   Login access makes the partner a BOSS user at a level (L1–L6) that
   reports to their RM or senior partner: they open their own Partner
   Journey, submit tasks there, and their mentor approves or asks for
   changes; once the onboarding tasks are approved their level's modules
   open, and they see their own records, or their mapped partners'. */
const {suite} = require('../lib/harness');

suite({mail: true}, async t => {
  const step = (name, fn) => t.step(name, fn);
  const run = at => t.eval(async at => (await (await fetch('/api/partner-journey/run', {method:'POST',
    headers: Object.assign({'Content-Type':'application/json'}, apiHeaders()), body: JSON.stringify({at})})).json()), at);
  const stored = key => t.eval(async key => JSON.parse((await (await fetch('/api/storage/' + key, {headers: apiHeaders()})).json()).value || '[]'), key);
  // What the server wrote, into the page's copy, so a screen reads it at once.
  const fresh = () => t.eval(async () => {
    for(const k of ['pjOnboarding','pjDocuments','partnerProspects','pjPartners','leads','communications']){
      const v = (await (await fetch('/api/storage/' + k, {headers: apiHeaders()})).json()).value;
      DB[k] = JSON.parse(v || '[]');
    }
  });
  const as = who => t.eval(id => { currentUser = id; }, who);
  const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 b2b3').toString('base64');
  const mailTo = (addr, re) => t.mail.received.filter(m => (m.to||[]).some(x => x.toLowerCase() === addr) && (re.test(m.subject||'') || re.test(m.text||'') || re.test(m.body||'')));
  let ids = {};

  t.section('the reminders go by themselves');

  await step('the reminder and joining link are not buttons any more', async () => {
    const r = await t.eval(async () => {
      const p = {id: uid('PPS'), firstName: 'Btn', mobile: '9876500001', commChannel: 'Email', createdAt: new Date().toISOString()};
      initState('PPS', p); p.ppsStage = 'acknowledged';
      const a = availableTransitions('PPS', 'acknowledged', 'forward', p).map(x=>x.id);
      p.ppsStage = 'remindersSent';
      const b = availableTransitions('PPS', 'remindersSent', 'forward', p).map(x=>x.id);
      DB.config.partnerJourney = Object.assign({}, DB.config.partnerJourney, {manualSessionSends: 'Yes'});
      const c = availableTransitions('PPS', 'acknowledged', 'forward', p).map(x=>x.id);
      DB.config.partnerJourney.manualSessionSends = 'No';
      return {a, b, c};
    });
    if(r.a.includes('remindersT') || r.b.includes('sessionDayT')) throw new Error(JSON.stringify(r));
    if(!r.c.includes('remindersT')) throw new Error('the setting does not bring the button back');
    return 'no Send Reminder / Joining Link button unless PPS › Settings asks for one';
  });

  await step('somebody acknowledged late gets the reminder they missed, then the link, and the stage follows', async () => {
    t.mail.clear();
    ids.web = await t.eval(async () => {
      const w = {id: uid('WEB'), title: 'ZZ Late Webinar', date: '2026-11-20', time: '7:00 PM', joiningLink: 'https://meet.example.com/late', createdAt: new Date().toISOString()};
      DB.partnerWebinars.push(w);
      const mk = (first, stage) => { const p = {id: uid('PPS'), firstName: first, lastName: 'Late', email: first.toLowerCase() + '@example.com', mobile: '98765' + String(Math.floor(Math.random()*90000)+10000),
        commChannel: 'Email', webinarId: w.id, assignedTo: currentUser, createdAt: new Date().toISOString()}; initState('PPS', p); p.ppsStage = stage; DB.partnerProspects.push(p); return p.id; };
      window._late = {one: mk('Lata', 'acknowledged')};
      await save('partnerWebinars'); await save('partnerProspects');
      return w.id;
    });
    const one = await t.eval(() => window._late.one);
    await run('2026-11-19T11:00:00Z');                       // 4:30 PM in India, no slot of its own due
    const rem = t.mail.matching(/Reminder: ZZ Late Webinar/);
    let list = await stored('partnerProspects');
    const st1 = (list.find(p=>p.id===one)||{}).ppsStage;
    const two = await t.eval(async () => { const p = {id: uid('PPS'), firstName: 'Mohan', lastName: 'Late', email: 'mohan@example.com', mobile: '9876512345',
      commChannel: 'Email', webinarId: DB.partnerWebinars.slice(-1)[0].id, assignedTo: currentUser, createdAt: new Date().toISOString()};
      DB.partnerProspects = JSON.parse((await (await fetch('/api/storage/partnerProspects', {headers: apiHeaders()})).json()).value);
      initState('PPS', p); p.ppsStage = 'acknowledged'; DB.partnerProspects.push(p); await save('partnerProspects'); return p.id; });
    t.mail.clear();
    await run('2026-11-20T10:00:00Z');                       // after the link time, before the session
    const links = t.mail.matching(/joining link for ZZ Late Webinar/i);
    list = await stored('partnerProspects');
    const st2 = [one, two].map(id => (list.find(p=>p.id===id)||{}).ppsStage);
    if(rem.length !== 1 || st1 !== 'remindersSent') throw new Error('late reminder: ' + rem.length + ' / ' + st1);
    if(links.length !== 2 || st2.some(s => s !== 'sessionDay')) throw new Error('late link: ' + links.length + ' / ' + st2);
    return '1 late reminder, then 2 joining links; both at Session Day';
  });

  await step('once the session starts, whoever was still waiting moves on, with no letter', async () => {
    const id = await t.eval(async () => { const p = {id: uid('PPS'), firstName: 'Nisha', email: 'nisha@example.com', mobile: '9876512399', commChannel: 'Email',
      webinarId: DB.partnerWebinars.slice(-1)[0].id, createdAt: new Date().toISOString()};
      DB.partnerProspects = JSON.parse((await (await fetch('/api/storage/partnerProspects', {headers: apiHeaders()})).json()).value);
      initState('PPS', p); p.ppsStage = 'acknowledged'; DB.partnerProspects.push(p); await save('partnerProspects'); return p.id; });
    t.mail.clear();
    await run('2026-11-20T15:00:00Z');
    const p = (await stored('partnerProspects')).find(x=>x.id===id);
    if(p.ppsStage !== 'sessionDay' || t.mail.received.length) throw new Error(p.ppsStage + ' / ' + t.mail.received.length + ' letters');
    return 'Session Day — the RM marks who attended';
  });

  t.section('who verifies');

  await step('an RM records a fee payment: it goes to their reporting manager, who is emailed', async () => {
    t.mail.clear();
    const r = await t.eval(async () => {
      const mk = (name, email, extra) => Object.assign({id: uid('TM'), name, email, role: 'Relationship Manager', status: 'Active', scope: 'all',
        perms: fullPerms(true), adminFlags: {}, createdAt: new Date().toISOString()}, extra || {});
      const meena = mk('Meena Manager', 'meena@example.com');
      const ravi = mk('Ravi RM', 'ravi@example.com', {managerIds: [meena.id], parentUserId: meena.id});
      DB.team.push(meena, ravi); await save('team');
      const admin = currentUser;
      const p = {id: uid('PPS'), firstName: 'Pooja', lastName: 'Pay', email: 'pooja@example.com', mobile: '9876522222', commChannel: 'Email',
        assignedTo: ravi.id, createdAt: new Date().toISOString()};
      initState('PPS', p); p.ppsStage = 'paymentLinkSent'; DB.partnerProspects.push(p); await save('partnerProspects');
      currentUser = ravi.id;
      pjOpenPaymentModal('PPS', p.id, 'paidT');
      document.getElementById('f_feeMode').value = 'UPI';
      document.getElementById('f_feeRef').value = 'UTR-B2B3-001';
      await pjSavePayment(p.id, 'paidT');
      const verifiers = p.feeVerifierIds;
      const ravisOwn = pjMayVerifyPayment(p);
      await doTransition('PPS', p.id, 'payVerifiedT');
      const after = stateOf('PPS', p);
      currentUser = meena.id;
      const queue = pjVerifyQueue().map(x=>x.r.id);
      const meenaMay = pjMayVerifyPayment(p);
      pjOpenVerifyPaymentModal('PPS', p.id, 'payVerifiedT');
      await pjVerifyPayment(p.id, 'payVerifiedT');
      currentUser = admin;
      return {meena: meena.id, ravi: ravi.id, admin, prospect: p.id, verifiers, ravisOwn, after, queue, meenaMay, final: stateOf('PPS', p), by: p.feeVerifiedBy, partner: p.partnerId};
    });
    ids = Object.assign(ids, r);
    const msg = t.dialogs.slice().reverse().find(d=>/cannot verify it/.test(d)) || '';
    if(r.verifiers.join() !== r.meena || r.ravisOwn || r.after !== 'paymentVerification' || !msg.includes('Meena')) throw new Error(JSON.stringify(r) + ' / ' + msg);
    if(!r.queue.includes(r.prospect) || !r.meenaMay || r.final !== 'converted' || r.by !== r.meena) throw new Error(JSON.stringify(r));
    await t.wait(300);
    if(!mailTo('meena@example.com', /To verify: Partner fee payment/).length) throw new Error('the manager was not emailed');
    return 'Ravi could not verify his own; Meena was emailed, saw it in To Verify and verified it';
  });

  await step('ARN / EUIN: one of the two is needed, with its registered mobile, and the manager verifies', async () => {
    t.mail.clear();
    const r = await t.eval(async ids => {
      const p = pjPartners().find(x=>x.id===ids.partner);
      p.pmsStage = 'arnRegistration'; await save('pjPartners');
      currentUser = ids.ravi;
      const set = (k, v) => { document.getElementById('f_'+k).value = v; };
      pjOpenArnModal('PMS', p.id, 'arnSubmitT');
      await pjSaveStageFields('PMS', p.id, 'arnSubmitT', 'arn');
      const none = stateOf('PMS', p);
      set('euin', 'E765432'); set('euinName', 'Pooja Pay'); set('euinValidFrom', '2026-01-01'); set('euinValidTo', '2029-01-01');
      await pjSaveStageFields('PMS', p.id, 'arnSubmitT', 'arn');
      const noMobile = stateOf('PMS', p);
      set('euinMobile', '9876522222');
      await pjSaveStageFields('PMS', p.id, 'arnSubmitT', 'arn');
      const sent = stateOf('PMS', p);
      const ravisOwn = pjMayVerifyArn(p);
      currentUser = ids.meena;
      const meenaMay = pjMayVerifyArn(p);
      currentUser = ids.admin;
      return {none, noMobile, sent, verifiers: p.arnVerifierIds, ravisOwn, meenaMay, arn: p.arn || '', mobile: p.euinMobile};
    }, ids);
    const said = t.dialogs.slice(-3).join(' | ');
    if(r.none !== 'arnRegistration' || !/at least one/.test(said)) throw new Error('neither was accepted: ' + said);
    if(r.noMobile !== 'arnRegistration' || !/registered mobile/i.test(said)) throw new Error('no mobile was accepted: ' + said);
    if(r.sent !== 'arnVerification' || r.arn || r.mobile !== '9876522222' || r.verifiers.join() !== ids.meena || r.ravisOwn || !r.meenaMay) throw new Error(JSON.stringify(r));
    await t.wait(300);
    if(!mailTo('meena@example.com', /ARN \/ EUIN details/).length) throw new Error('the manager was not emailed');
    return 'refused with neither, refused without the mobile; EUIN alone accepted and sent to Meena';
  });

  t.section('the one empanelment form');

  await step('the form goes to the partner by email, on a token of its own', async () => {
    t.mail.clear();
    const r = await t.eval(async ids => {
      const p = {id: uid('PMS'), firstName: 'Kavya', lastName: 'Emp', mobile: '9876533333', email: 'kavya@example.com', city: 'Pune',
        assignedTo: ids.ravi, createdAt: new Date().toISOString(), euin: 'E111222', euinMobile: '9876533333',
        admissionForm1: {afAddress: '5 FC Road, Pune', afPan: 'ABCDE1234K', afDob: '1990-05-01'}};
      initState('PMS', p); p.pmsStage = 'onboarded'; pjPartners().push(p); await save('pjPartners');
      const o = await pobStart(p.id, {quiet: true});
      o.pobStage = 'empanelment'; await save('pjOnboarding');
      await pobSendEmpForm(o.id, 'email');
      return {pob: o.id, token: o.empFormToken, sent: o.empFormSentAt};
    }, ids);
    ids.pob = r.pob; ids.token = r.token;
    await t.wait(300);
    const m = mailTo('kavya@example.com', /empanelment form/i)[0];
    if(!r.token || !r.sent || !m || !(m.text||m.body).includes('/empanelment?t=')) throw new Error(JSON.stringify(r));
    const pageRes = await fetch(t.base + '/empanelment?t=' + encodeURIComponent(r.token), {redirect: 'manual'});
    if(pageRes.status !== 200) throw new Error('the form page wants a sign-in: ' + pageRes.status);
    return 'emailed; the page opens with no sign-in';
  });

  await step('it opens filled in with what the firm has, and the signed-agreement upload is enforced', async () => {
    const q = '?token=' + encodeURIComponent(ids.token);
    const d = await (await fetch(t.base + '/api/public/pob-form' + q)).json();
    if(!d.ok || d.values.firstName !== 'Kavya' || d.values.pan !== 'ABCDE1234K' || d.values.address !== '5 FC Road, Pune' || d.values.euin !== 'E111222' || d.values.dob !== '1990-05-01')
      throw new Error('not filled in: ' + JSON.stringify(d.values));
    if(d.docs.some(x=>x.type==='Signed Agreement') || d.agreement.types.join() !== 'Mutual Fund Agreement,Wealth Agreement,Broker Agreement') throw new Error(JSON.stringify(d.docs) + JSON.stringify(d.agreement));
    const up = async type => (await (await fetch(t.base + '/api/public/pob-form/upload' + q, {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({name: type + '.pdf', mime: 'application/pdf', data: pdf})})).json()).id;
    const docs = {};
    for(const x of d.docs.filter(x=>x.mandatory)) docs[x.type] = await up(x.type);
    const values = Object.assign({}, d.values, {city: 'Pune', bankHolder: 'Kavya Emp', bankName: 'HDFC', bankAccount: '123456789012', bankIfsc: 'HDFC0001234'});
    const post = body => fetch(t.base + '/api/public/pob-form' + q, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)}).then(r=>r.json());
    const noUpload = await post({values, docs, declaration: true, agreement: {types: ['Mutual Fund Agreement'], method: 'upload', signedName: 'Kavya Emp'}});
    const noType = await post({values, docs, declaration: true, agreement: {types: [], method: 'online', consent: true, signedName: 'Kavya Emp'}});
    const signedId = await up('signed');
    const ok = await post({values, docs, declaration: true, agreement: {types: ['Mutual Fund Agreement', 'Wealth Agreement'], method: 'upload', fileId: signedId, signedName: 'Kavya Emp'}});
    if(noUpload.ok || !/signed agreement/i.test(noUpload.message)) throw new Error('took it without the signed copy: ' + JSON.stringify(noUpload));
    if(noType.ok) throw new Error('took it with no agreement ticked');
    if(!ok.ok) throw new Error(JSON.stringify(ok));
    return 'refused without the signed copy (“' + noUpload.message.split(' —')[0] + '”), refused with no agreement ticked, then accepted';
  });

  await step('submitting sends it for evaluation to the owner’s reporting manager, who is emailed', async () => {
    await t.wait(300);
    const o = (await stored('pjOnboarding')).find(x=>x.id===ids.pob);
    const docs = (await stored('pjDocuments')).filter(x=>x.pobId===ids.pob);
    if(o.pobStage !== 'evaluation' || o.applicationStatus !== 'Under Review' || o.submittedBy !== 'Partner' || (o.evaluatorIds||[]).join() !== ids.meena)
      throw new Error(JSON.stringify({stage: o.pobStage, app: o.applicationStatus, by: o.submittedBy, ev: o.evaluatorIds}));
    if(o.bankIfsc !== 'HDFC0001234' || (o.agreement.types||[]).length !== 2 || !o.agreement.signedFileId) throw new Error('not written: ' + JSON.stringify(o.agreement));
    if(!docs.some(x=>x.type==='Signed Agreement') || docs.some(x=>x.status!=='Under Review')) throw new Error(docs.map(x=>x.type + ':' + x.status).join());
    if(!mailTo('meena@example.com', /empanelment for evaluation/i).length) throw new Error('the evaluator was not emailed');
    const again = await (await fetch(t.base + '/api/public/pob-form?token=' + encodeURIComponent(ids.token))).json();
    if(again.open || again.state !== 'underReview') throw new Error('the form is still open: ' + again.state);
    return 'Evaluation, with Meena; ' + docs.length + ' documents under review; the form now says it is under review';
  });

  await step('the owner cannot evaluate their own partner; the manager can, and approves', async () => {
    await fresh();
    const r = await t.eval(async ids => {
      const o = pobRecords().find(x=>x.id===ids.pob);
      currentUser = ids.ravi;
      const ravi = pobMayEvaluate(o);
      pobOpenEvaluation(ids.pob);
      const ravisBox = !!document.querySelector('.pob-crit');
      closeModal();
      currentUser = ids.meena;
      pobOpenEvaluation(ids.pob);
      document.querySelectorAll('.pob-crit').forEach(cb=>{ cb.checked = true; });
      await pobSaveEvaluation(ids.pob);
      for(const x of pobDocRows(o).filter(x=>x.doc)) await pobReviewDoc(x.doc.id, 'Approved');
      pobOpenDecisionModal('POB', ids.pob, 'obApproveT');
      await pobSaveDecision(ids.pob, 'obApproveT');
      currentUser = ids.admin;
      return {ravi, ravisBox, stage: stateOf('POB', o), app: o.applicationStatus};
    }, ids);
    if(r.ravi || r.ravisBox) throw new Error('the owner could evaluate');
    if(r.stage !== 'loginAccess' || r.app !== 'Approved') throw new Error(JSON.stringify(r));
    return 'Ravi refused; Meena approved — Login Access';
  });

  t.section('the partner works in BOSS');

  await step('login access makes the partner a BOSS user at L1, reporting to their RM', async () => {
    t.mail.clear();
    const r = await t.eval(async ids => {
      pobOpenLoginModal('POB', ids.pob, 'obLoginT');
      const level = document.getElementById('lgLevel').value, up = document.getElementById('lgUp').value;
      await pobSaveLogin(ids.pob, 'obLoginT');
      const o = pobRecords().find(x=>x.id===ids.pob), m = pobMemberOf(o);
      return {level, up, m: m && {id: m.id, email: m.email, lv: m.partnerLevel, role: m.role, scope: m.scope, parent: m.parentUserId, status: m.status, flags: Object.values(m.adminFlags||{}).some(Boolean)},
        login: o.login, stage: stateOf('POB', o), roles: roleList().includes('Ninja (L1)')};
    }, ids);
    if(r.level !== 'L1' || r.up !== ids.ravi || !r.m) throw new Error(JSON.stringify(r));
    if(r.m.email !== 'kavya@example.com' || r.m.lv !== 'L1' || r.m.role !== 'Ninja (L1)' || r.m.scope !== 'own' || r.m.parent !== ids.ravi || r.m.status !== 'Active' || r.m.flags) throw new Error(JSON.stringify(r.m));
    if(!r.login.boss || r.login.memberId !== r.m.id || r.stage !== 'roleMeeting' || !r.roles) throw new Error(JSON.stringify(r));
    ids.kavya = r.m.id;
    await t.wait(300);
    const admin = await t.eval(() => !!window.CRM_IS_ADMIN);
    const letter = t.mail.received.filter(m => (m.to||[]).some(x => x.toLowerCase() === 'kavya@example.com'));
    if(admin && !letter.length) throw new Error('no password letter to the partner');
    const portal = await fetch(t.base + '/partner', {redirect: 'manual'});
    const api = await fetch(t.base + '/api/partner-portal/me');
    if(portal.status !== 302 || !/\/login/.test(portal.headers.get('location') || '') || api.status === 200) throw new Error('the old portal is still there: ' + portal.status + ' ' + portal.headers.get('location') + ' / ' + api.status);
    return 'Ninja (L1), own business, reports to Ravi; ' + (letter.length ? 'password emailed' : 'no admin, no letter') + '; /partner now goes to the BOSS sign-in';
  });

  await step('signed in, the partner opens only their own Partner Journey until onboarding is done', async () => {
    const r = await t.eval(ids => {
      currentUser = ids.kavya;
      const open = ['mypj','ppf','lms','dst','business','pps','pob','teammembers','hrdashboard'].filter(v=>pageOpenToMe(v));
      const rail = railNavGroups().filter(g=>railItems(g).length).map(g=>g.id);
      const page = viewMyPartnerJourney();
      currentUser = ids.admin;
      return {open, rail, page: /My Tasks/.test(page) && /My Payouts/.test(page) && /Opens once your onboarding/.test(page)};
    }, ids);
    if(r.open.join() !== 'mypj,ppf' || !r.page) throw new Error(JSON.stringify(r));
    if(r.rail.some(g => !['partnerjourney','personal'].includes(g)) && r.rail.includes('pipeline')) throw new Error('rail: ' + r.rail.join());
    return 'mypj and ppf only; rail ' + r.rail.join(', ');
  });

  await step('the partner submits a task; the mentor asks for changes, then approves', async () => {
    t.mail.clear();
    const r = await t.eval(async ids => {
      const o = pobRecords().find(x=>x.id===ids.pob);
      o.roleMeeting = {date: '2026-11-01', time: '10:00', link: 'https://meet.example.com/role'};
      await pobAssignRole(o, 'Ninja', 'Test');
      o.mentorId = ids.meena; o.pobStage = 'roleWorkflow';
      const rcs = pobLiveTasks(o).find(x=>x.key==='rcs'); rcs.status = 'Approved';
      await pobRefreshTasks(o); await save('pjOnboarding');
      const plan = pobLiveTasks(o).find(x=>x.title==='Business Plan');
      const walk = pobLiveTasks(o).find(x=>x.title==='Platform Walk Through');
      currentUser = ids.kavya;
      const button = viewMyPartnerJourney().includes("'" + plan.id + "','submit'");
      window.prompt = () => '';
      await pobTaskAction(ids.pob, plan.id, 'submit');
      const empty = plan.status;
      window.prompt = () => 'My plan: https://docs.example.com/plan';
      await pobTaskAction(ids.pob, plan.id, 'submit');
      const first = plan.status;
      await pobTaskAction(ids.pob, plan.id, 'approve');      // a partner cannot approve their own
      const self = plan.status;
      currentUser = ids.ravi;
      await pobTaskAction(ids.pob, plan.id, 'approve');
      const ravi = plan.status;
      currentUser = ids.meena;
      window.prompt = () => 'Add your monthly targets';
      await pobTaskAction(ids.pob, plan.id, 'return');
      const back = plan.status;
      currentUser = ids.kavya;
      const why = viewMyPartnerJourney().includes('Add your monthly targets');
      await pobTaskAction(ids.pob, plan.id, 'submit');
      const second = plan.status;
      currentUser = ids.meena; window.prompt = () => 'Good plan';
      await pobTaskAction(ids.pob, plan.id, 'approve');
      currentUser = ids.admin;
      return {button, walkBefore: pobTaskState(o, walk).open, empty, first, self, ravi, back, why, second, done: plan.status, walkAfter: pobTaskState(o, walk).open};
    }, ids);
    await t.wait(300);
    if(!r.button) throw new Error('before: ' + JSON.stringify(r));
    if(r.empty === 'Pending Review' || r.first !== 'Pending Review' || r.self !== 'Pending Review') throw new Error(JSON.stringify(r));
    if(r.ravi !== 'Pending Review' || r.back !== 'Changes Required' || !r.why || r.second !== 'Pending Review') throw new Error(JSON.stringify(r));
    if(r.done !== 'Approved') throw new Error(JSON.stringify(r));
    return 'Pending Review → Changes Required (the partner read why) → Approved by the mentor';
  });

  await step('the Client Journey opens once the onboarding tasks are approved, and the partner sees only their own', async () => {
    const r = await t.eval(async ids => {
      const o = pobRecords().find(x=>x.id===ids.pob);
      currentUser = ids.kavya;
      const shut = pageOpenToMe('lms');
      currentUser = ids.admin;
      pobRequiredOnboarding(o).forEach(x=>{ x.status = 'Approved'; });
      await save('pjOnboarding');
      const other = {id: uid('LEAD'), firstName: 'Firm', lastName: 'Lead', mobile: '9876543333', assignedTo: ids.ravi, createdAt: new Date().toISOString()};
      DB.leads.push(other);
      currentUser = ids.kavya;
      const lead = {id: uid('LEAD'), firstName: 'Lead', lastName: 'One', mobile: '9876544444', city: 'Pune', assignedTo: ids.ravi, createdAt: new Date().toISOString()};
      partnerStamp(lead);
      DB.leads.push(lead); await save('leads');
      const open = ['lms','cms','rms','dst','business','hrdashboard'].filter(v=>pageOpenToMe(v));
      const seen = visibleRecords(DB.leads, l=>l.assignedTo).map(l=>l.id);
      currentUser = ids.admin;
      return {shut, open, seen, lead: lead.id, other: other.id, pob: lead.partnerPobId, src: lead.source, fig: pobMetrics(o).leads, cj: pobClientJourneyOpen(o)};
    }, ids);
    if(r.shut || !r.cj) throw new Error('open before the tasks were done');
    if(r.open.join() !== 'lms,cms,rms') throw new Error('L1 opens ' + r.open.join());
    if(r.seen.join() !== r.lead || r.pob !== ids.pob || r.src !== 'Partner' || r.fig < 1) throw new Error(JSON.stringify(r));
    return 'shut, then LMS · CMS · RMS; they see their own lead and not the RM’s';
  });

  await step('a Sherpa (L3) adds Operations and Sales, and sees the partners mapped to them', async () => {
    const r = await t.eval(async ids => {
      const mk = async (first, role, up) => {
        const p = {id: uid('PMS'), firstName: first, lastName: 'Lvl', mobile: '98765' + String(Math.floor(Math.random()*90000)+10000), email: first.toLowerCase() + '.lvl@example.com', assignedTo: ids.ravi, createdAt: new Date().toISOString()};
        initState('PMS', p); p.pmsStage = 'onboarded'; pjPartners().push(p); await save('pjPartners');
        const o = await pobStart(p.id, {quiet: true});
        o.role = role; o.pobStage = 'active';
        pobOpenLoginModal('POB', o.id, '');
        if(up) document.getElementById('lgUp').value = up;
        await pobSaveLogin(o.id, '');
        return {o, m: pobMemberOf(o)};
      };
      const sherpa = await mk('Sanjay', 'Sherpa');
      const ninja = await mk('Nina', 'Ninja', sherpa.m.id);
      const lead = {id: uid('LEAD'), firstName: 'Nina', lastName: 'Client', mobile: '9876546666', assignedTo: ids.ravi, partnerPobId: ninja.o.id, createdAt: new Date().toISOString()};
      DB.leads.push(lead); await save('leads');
      currentUser = sherpa.m.id;
      const open = ['lms','dst','queries','business','transactions','hrdashboard','teammembers'].filter(v=>pageOpenToMe(v));
      const seen = visibleRecords(DB.leads, l=>l.assignedTo).map(l=>l.id);
      currentUser = ninja.m.id;
      const ninjaSees = visibleRecords(DB.leads, l=>l.assignedTo).map(l=>l.id);
      currentUser = ids.admin;
      return {lv: sherpa.m.partnerLevel, scope: sherpa.m.scope, open, seesNina: seen.includes(lead.id), seesKavya: DB.leads.some(l=>l.partnerPobId===ids.pob && seen.includes(l.id)),
        ninjaSees: ninjaSees.includes(lead.id), sherpa: sherpa.m.id, ninja: ninja.m.id, ninjaPob: ninja.o.id};
    }, ids);
    if(r.lv !== 'L3' || r.scope !== 'team') throw new Error(JSON.stringify(r));
    if(r.open.join() !== 'lms,dst,queries,business,transactions') throw new Error('L3 opens ' + r.open.join());
    if(!r.seesNina || r.seesKavya || !r.ninjaSees) throw new Error(JSON.stringify(r));
    Object.assign(ids, {sherpa: r.sherpa, ninja: r.ninja, ninjaPob: r.ninjaPob});
    return 'Sherpa (L3): Client Journey, Operations, Sales; sees Nina’s client, not Kavya’s';
  });

  await step('Setup › Partner Levels changes what a level opens; Monks get HR; suspending shuts the login', async () => {
    const r = await t.eval(async ids => {
      window.alert = () => {};
      document.body.insertAdjacentHTML('beforeend', '<div id="plvTest">' + renderSettingsPartnerLevels() + '</div>');
      document.getElementById('plv_L1_operations').checked = true;
      await plvSaveSettings();
      document.getElementById('plvTest').remove();
      const k = DB.team.find(t=>t.id===ids.kavya);
      currentUser = ids.kavya;
      const l1 = pageOpenToMe('dst');
      currentUser = ids.admin;
      const o = pobRecords().find(x=>x.id===ids.ninjaPob);
      pobOpenLoginModal('POB', o.id, '');
      document.getElementById('lgLevel').value = 'L5';
      await pobSaveLogin(o.id, '');
      currentUser = ids.ninja;
      const l5 = ['hrdashboard','business','lms'].filter(v=>pageOpenToMe(v));
      currentUser = ids.admin;
      window.prompt = () => 'Test suspend';
      await pobSetLoginStatus(o.id, 'Suspended');
      const m = pobMemberOf(o);
      // put L1 back as the sheet has it
      DB.config.partnerLevels = null; await save('config');
      return {l1, dst: k.perms.DST && k.perms.DST.view, l5, status: m.status, login: o.login.status};
    }, ids);
    if(!r.l1 || !r.dst) throw new Error('the setting did not reach L1: ' + JSON.stringify(r));
    if(r.l5.join() !== 'hrdashboard,business,lms') throw new Error('L5 opens ' + r.l5.join());
    if(r.status !== 'Inactive' || r.login !== 'Suspended') throw new Error(JSON.stringify(r));
    return 'L1 given Operations from Setup; L5 opens ' + r.l5.join(', ') + '; suspended → Inactive';
  });

  await step('the empanelment form still draws', async () => {
    await t.page.goto(t.base + '/empanelment?t=' + encodeURIComponent(ids.token), {waitUntil: 'domcontentloaded'});
    await t.page.waitForTimeout(500);
    const form = await t.page.textContent('#wrap');
    if(!/Empanelment Form/.test(form)) throw new Error('the form page did not draw');
    return 'Empanelment Form';
  });
});
