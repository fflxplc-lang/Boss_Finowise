/* B2B CHANGES 3 — WHO CHECKS WHAT, THE ONE FORM, AND THE PARTNER'S OWN LOGIN.

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
   The partner's login sees their own record and nothing of BOSS; they
   submit tasks, their mentor approves or asks for changes, and the next
   task opens; once the onboarding tasks are approved they add leads,
   which fill their figures. */
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

  t.section('the partner’s own login');

  let cookie = '';
  await step('login access creates the partner’s own account, and the password link signs them in', async () => {
    t.mail.clear();
    await t.eval(async ids => {
      pobOpenLoginModal('POB', ids.pob, 'obLoginT');
      await pobSaveLogin(ids.pob, 'obLoginT');
    }, ids);
    await t.wait(300);
    const m = mailTo('kavya@example.com', /Freedom LifeX login/i)[0];
    const link = m && ((m.text||m.body).match(/https?:\/\/\S+\/partner\/setup\?t=[\w%-]+/) || [])[0];
    if(!link) throw new Error('no password link in the letter');
    const token = decodeURIComponent(link.split('t=')[1]);
    const form = await fetch(t.base + '/partner/setup?t=' + encodeURIComponent(token), {redirect: 'manual'});
    const short = await fetch(t.base + '/partner/setup', {method:'POST', redirect:'manual', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body: new URLSearchParams({t: token, password: 'short', confirm: 'short'})});
    const set = await fetch(t.base + '/partner/setup', {method:'POST', redirect:'manual', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body: new URLSearchParams({t: token, password: 'kavyapass123', confirm: 'kavyapass123'})});
    cookie = ((set.headers.get('set-cookie')||'').match(/flx_partner=[^;]+/)||[])[0] || '';
    const reuse = await fetch(t.base + '/partner/setup?t=' + encodeURIComponent(token), {redirect: 'manual'});
    if(form.status !== 200 || short.status !== 400 || set.status !== 302 || !cookie || reuse.status !== 404) throw new Error([form.status, short.status, set.status, !!cookie, reuse.status].join());
    const login = await fetch(t.base + '/partner/login', {method:'POST', redirect:'manual', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body: new URLSearchParams({email: 'kavya@example.com', password: 'wrong-one'})});
    if(login.status !== 401) throw new Error('a wrong password signed in');
    return 'password set from the link (once), a wrong password refused';
  });

  await step('signed in, the partner gets their own record and nothing of BOSS', async () => {
    const h = {Cookie: cookie};
    const me = await (await fetch(t.base + '/api/partner-portal/me', {headers: h})).json();
    const boss = await fetch(t.base + '/api/storage/team', {headers: h});
    const bossPage = await fetch(t.base + '/', {headers: h, redirect: 'manual'});
    const anon = await fetch(t.base + '/api/partner-portal/me');
    const portal = await fetch(t.base + '/partner', {headers: h, redirect: 'manual'});
    const other = await t.eval(async pob => {
      const r = await (await fetch('/api/partner-docs', {method:'POST', headers: Object.assign({'Content-Type':'application/json'}, apiHeaders()),
        body: JSON.stringify({name: 'other.pdf', mime: 'application/pdf', data: 'data:application/pdf;base64,' + btoa('%PDF-1.4 other')})})).json();
      return r.id;
    }, ids.pob);
    const steal = await fetch(t.base + '/api/partner-portal/files/' + other, {headers: h});
    const own = await fetch(t.base + '/api/partner-portal/files/' + me.agreement.signedFileId, {headers: h});
    const text = JSON.stringify(me);
    if(!me.ok || me.partner.name !== 'Kavya Emp' || me.partner.rm !== 'Ravi RM' || me.stage.id !== 'roleMeeting') throw new Error(JSON.stringify(me).slice(0, 300));
    if(text.includes('Pooja') || text.includes('evaluation') && text.includes('criteria')) throw new Error('another partner’s data or the firm’s notes leaked');
    if(boss.status !== 401 || bossPage.status !== 302 || anon.status !== 401 || portal.status !== 200) throw new Error([boss.status, bossPage.status, anon.status, portal.status].join());
    if(steal.status !== 404 || own.status !== 200) throw new Error('files: ' + steal.status + ' / ' + own.status);
    return 'own dashboard; BOSS 401, another file 404, their own signed agreement 200';
  });

  await step('the partner submits a task; the mentor asks for changes, then approves, and the next task opens', async () => {
    t.mail.clear();
    await t.eval(async ids => {
      const o = pobRecords().find(x=>x.id===ids.pob);
      o.roleMeeting = {date: '2026-11-01', time: '10:00', link: 'https://meet.example.com/role'};
      await pobAssignRole(o, 'Ninja', 'Test');
      o.mentorId = ids.meena; o.pobStage = 'roleWorkflow';
      const rcs = pobLiveTasks(o).find(x=>x.key==='rcs'); rcs.status = 'Approved';
      await pobRefreshTasks(o); await save('pjOnboarding');
    }, ids);
    const h = {Cookie: cookie, 'Content-Type': 'application/json'};
    const me = await (await fetch(t.base + '/api/partner-portal/me', {headers: h})).json();
    const plan = me.tasks.find(x=>x.title==='Business Plan');
    const walk = me.tasks.find(x=>x.title==='Platform Walk Through');
    const submit = ev => fetch(t.base + '/api/partner-portal/tasks/' + plan.id + '/submit', {method:'POST', headers: h, body: JSON.stringify({evidence: ev})}).then(r=>r.json());
    const empty = await submit('');
    const first = await submit('My plan: https://docs.example.com/plan');
    await t.wait(300);
    const toMentor = mailTo('meena@example.com', /task for review/i).length;
    await fresh();
    const r = await t.eval(async (a) => {
      const o = pobRecords().find(x=>x.id===a.pob);
      const task = pobLiveTasks(o).find(x=>x.id===a.task);
      currentUser = a.ravi;
      await pobTaskAction(a.pob, a.task, 'approve');
      const ravi = task.status;
      currentUser = a.meena;
      window.prompt = () => 'Add your monthly targets';
      await pobTaskAction(a.pob, a.task, 'return');
      const back = task.status;
      currentUser = a.admin;
      return {ravi, back};
    }, Object.assign({task: plan.id}, ids));
    await t.wait(300);
    const toPartner = mailTo('kavya@example.com', /Changes Required/).length;
    const seen = (await (await fetch(t.base + '/api/partner-portal/me', {headers: h})).json()).tasks.find(x=>x.id===plan.id);
    const second = await submit('Plan v2 with targets');
    await fresh();
    const done = await t.eval(async (a) => {
      currentUser = a.meena; window.prompt = () => 'Good plan';
      await pobTaskAction(a.pob, a.task, 'approve');
      currentUser = a.admin;
      return pobLiveTasks(pobRecords().find(x=>x.id===a.pob)).find(x=>x.id===a.task).status;
    }, Object.assign({task: plan.id}, ids));
    const after = (await (await fetch(t.base + '/api/partner-portal/me', {headers: h})).json()).tasks;
    if(plan.maySubmit !== true || walk.open) throw new Error('before: ' + JSON.stringify({plan, walk}));
    if(empty.ok || !first.ok || first.status !== 'Pending Review' || !toMentor) throw new Error(JSON.stringify({empty, first, toMentor}));
    if(r.ravi !== 'Pending Review' || r.back !== 'Changes Required' || !toPartner || seen.lastNote !== 'Add your monthly targets' || !seen.maySubmit) throw new Error(JSON.stringify({r, toPartner, seen}));
    if(!second.ok || done !== 'Approved' || !after.find(x=>x.title==='Platform Walk Through').open) throw new Error(JSON.stringify({second, done}));
    return 'Pending Review → Changes Required (the partner read why) → Approved by the mentor; Platform Walk Through opened';
  });

  await step('the Client Journey opens once the onboarding tasks are approved, and the leads fill the figures', async () => {
    const h = {Cookie: cookie, 'Content-Type': 'application/json'};
    const shut = await fetch(t.base + '/api/partner-portal/leads', {headers: h});
    await t.eval(async ids => {
      const o = pobRecords().find(x=>x.id===ids.pob);
      pobRequiredOnboarding(o).forEach(x=>{ x.status = 'Approved'; });
      await save('pjOnboarding');
    }, ids);
    const add = await (await fetch(t.base + '/api/partner-portal/leads', {method:'POST', headers: h,
      body: JSON.stringify({firstName: 'Lead', lastName: 'One', mobile: '9876544444', city: 'Pune'})})).json();
    const dupe = await (await fetch(t.base + '/api/partner-portal/leads', {method:'POST', headers: h,
      body: JSON.stringify({firstName: 'Lead', lastName: 'Again', mobile: '9876544444'})})).json();
    const edit = await (await fetch(t.base + '/api/partner-portal/leads/' + add.id, {method:'PUT', headers: h, body: JSON.stringify({city: 'Mumbai'})})).json();
    const list = await (await fetch(t.base + '/api/partner-portal/leads', {headers: h})).json();
    await fresh();
    const boss = await t.eval(ids => {
      const o = pobRecords().find(x=>x.id===ids.pob);
      const l = DB.leads.find(x=>x.partnerPobId===ids.pob);
      return {fig: pobMetrics(o), owner: l && l.assignedTo, src: l && l.source, city: l && l.city, open: pobClientJourneyOpen(o)};
    }, ids);
    if(shut.status !== 403) throw new Error('open before the tasks were done: ' + shut.status);
    if(!add.ok || add.figures.leads !== 1 || dupe.ok || !edit.ok || list.leads.length !== 1) throw new Error(JSON.stringify({add, dupe, edit, n: list.leads && list.leads.length}));
    if(boss.fig.leads !== 1 || boss.owner !== ids.ravi || boss.src !== 'Partner' || boss.city !== 'Mumbai' || !boss.open) throw new Error(JSON.stringify(boss));
    return 'shut, then open; 1 lead → Leads collected 1, owned by the RM in LMS';
  });

  await step('a payment the partner records goes to their mapped RM', async () => {
    const r = await t.eval(async ids => {
      DB.config.partnerOnboarding = Object.assign({}, DB.config.partnerOnboarding, {dueFee: 5000}); await save('config');
      const p = {id: uid('PMS'), firstName: 'Dev', lastName: 'Due', mobile: '9876555555', email: 'dev.due@example.com', assignedTo: ids.ravi, createdAt: new Date().toISOString()};
      initState('PMS', p); p.pmsStage = 'onboarded'; pjPartners().push(p); await save('pjPartners');
      const o = await pobStart(p.id, {quiet: true});
      const res = await pobPortalCall('accounts', {pobId: o.id, email: 'dev.due@example.com'});
      return {pob: o.id, setup: res.setupUrl};
    }, ids);
    const token = decodeURIComponent(r.setup.split('t=')[1]);
    const set = await fetch(t.base + '/partner/setup', {method:'POST', redirect:'manual', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body: new URLSearchParams({t: token, password: 'devpass1234', confirm: 'devpass1234'})});
    const c2 = ((set.headers.get('set-cookie')||'').match(/flx_partner=[^;]+/)||[])[0];
    t.mail.clear();
    const paid = await (await fetch(t.base + '/api/partner-portal/payments', {method:'POST', headers: {Cookie: c2, 'Content-Type': 'application/json'},
      body: JSON.stringify({amount: 5000, method: 'UPI', ref: 'UTR-DEV-1', date: '2026-10-20'})})).json();
    await t.wait(300);
    const o = (await stored('pjOnboarding')).find(x=>x.id===r.pob);
    const p = (o.payments||[])[0] || {};
    if(!paid.ok || p.status !== 'Under Review' || p.recordedBy !== 'Partner' || (p.verifierIds||[]).join() !== ids.ravi) throw new Error(JSON.stringify({paid, p}));
    if(!mailTo('ravi@example.com', /due payment/i).length) throw new Error('the RM was not emailed');
    // And the first partner still cannot see this one.
    const mine = await (await fetch(t.base + '/api/partner-portal/me', {headers: {Cookie: cookie}})).json();
    if(JSON.stringify(mine).includes('UTR-DEV-1')) throw new Error('one partner saw another’s payment');
    return 'Under Review with Ravi (the mapped RM), who was emailed';
  });

  await step('the partner’s pages draw', async () => {
    const [name, value] = cookie.split('=');
    await t.page.context().addCookies([{name, value, url: t.base}]);
    await t.page.goto(t.base + '/partner', {waitUntil: 'domcontentloaded'});
    await t.page.waitForSelector('nav button');
    const tabs = await t.page.$$eval('nav button', bs => bs.map(b => b.textContent));
    const seen = {};
    for(let i = 0; i < tabs.length; i++){
      await t.page.click('nav button:nth-child(' + (i + 1) + ')');
      await t.page.waitForTimeout(250);
      seen[tabs[i]] = (await t.page.textContent('main')).length;
    }
    const home = await t.page.evaluate(() => { flxGo('home'); return document.querySelector('main').textContent; });
    if(!/Welcome, Kavya/.test(home) || Object.values(seen).some(n => n < 30)) throw new Error(JSON.stringify(seen));
    await t.page.goto(t.base + '/empanelment?t=' + encodeURIComponent(ids.token), {waitUntil: 'domcontentloaded'});
    await t.page.waitForTimeout(500);
    const form = await t.page.textContent('#wrap');
    if(!/Empanelment Form/.test(form)) throw new Error('the form page did not draw');
    return tabs.join(' · ');
  });
});
