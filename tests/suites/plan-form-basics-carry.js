/* THE FACTS THE FIRM ALREADY HOLDS REACH THE FORM THE PLAN IS WORKED FROM.

   Goal Based Planning has no workbook. Its Section A — the date, the
   name, the mobile, the e-mail, the date of birth, the city — is
   marked clientSkip, because the client's own page asks those same
   facts once at the top, under "Your details". A blueprint that has a
   workbook takes that first section back through
   applyClientSubmission; this one had nothing doing the same job, so
   a client could fill in every box on their page and the form the
   plan is read from still came back with the name, the mobile, the
   e-mail and the date of birth empty.

   What the firm saw: a lead showing "Date of Birth 01 Jan 2001" at
   the top of the page, and Prepare Plan refusing with "The Input Form
   is not complete — Date of birth".

   Two things close it. The client's submission writes those details
   into the form, off the record their own answers have just updated.
   And Prepare Plan fills what the firm holds before it refuses, so a
   record that came back before any of this works on the next click
   rather than needing somebody to open the form and save it.

   The third step is the one that keeps this honest: a fact nobody
   holds is still missing, and still stops the plan. */
const {suite} = require('../lib/harness');

const LEAD = 'LMS-CARRY';

/* A lead the firm knows, and a Goal Based link with the questionnaire
   on it — which is what a client is actually sent. */
const SEED = `async function(){
  let l = DB.leads.find(x=>x.id === '${LEAD}');
  if(!l){ l = {id:'${LEAD}'}; DB.leads.push(l); }
  Object.assign(l, {firstName:'ZZ Carry', lastName:'Over', mobile:'9800333111',
    email:'carry@example.com', dob:'2001-01-01', city:'Varanasi', assignedTo: currentUser,
    transformationForm:'MULTIGOAL', createdAt:new Date().toISOString()});
  if(!stateOf('LMS', l)) initState('LMS', l);
  l.formData = {}; l.planRounds = [];
  await save('leads');
  return await createDocLink(l.id, 'MULTIGOAL',
    {recordModule:'LMS', recordId:l.id, iseqType:'ISEQ_UNDER50'});
}`;

/* Everything on the client's page, answered the way a client would:
   every box filled, and one option taken on every ISEQ question. */
const FILL = `function(token){
  const host = document.getElementById('publicDocBody') || document.body;
  let boxes = 0;
  host.querySelectorAll('input, select, textarea').forEach(el=>{
    if(el.type === 'hidden' || el.disabled || el.value) return;
    if(el.tagName === 'SELECT'){
      const opt = Array.from(el.options).find(o=>o.value);
      if(opt){ el.value = opt.value; el.dispatchEvent(new Event('change', {bubbles:true})); boxes++; }
      return;
    }
    const lab = ((el.closest('.f, .field, label, div') || {}).textContent) || '';
    el.value = el.type === 'date' ? '2030-01-01'
             : el.type === 'number' ? '100000'
             : /pan/i.test(lab) ? 'ABCDE1234F'
             : /mobile|phone/i.test(lab) ? '9800333111'
             : /e-?mail/i.test(lab) ? 'carry@example.com'
             : /pin/i.test(lab) ? '221001' : 'ZZ';
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
    boxes++;
  });
  const link = DB.docLinks.find(l=>l.token === token);
  let asked = 0;
  iseqFieldsFor(uniIseqTypeFor(link, token)).forEach(f=>{
    if((f.opts||[]).length){ uniIseqPick(token, f.k, 0); asked++; }
  });
  return {boxes, asked};
}`;

suite(async t => {
  await t.home();
  let token = '';

  t.section('a client fills their page');

  await t.step('and their details reach the form the plan is read from', async () => {
    token = await t.eval(new Function(`return (${SEED})()`));
    await t.doc(token, 1800);
    const f = await t.eval(new Function('token', `return (${FILL})(token)`), token);
    if(!f.boxes) throw new Error('the page offered nothing to fill in');
    if(!f.asked) throw new Error('the questionnaire asked nothing');
    await t.wait(400);
    await t.eval(tok=>submitUnifiedClientForm(tok), token);
    await t.wait(2200);

    await t.home();
    const r = await t.eval(id=>{
      const rec = DB.leads.find(l=>l.id === id);
      const data = (rec.formData || {}).MULTIGOAL || {};
      return {dob: data.dob, name: data.name, mobile: data.mobile, email: data.email,
              onRecord: rec.dob,
              missing: planInputMissing(rec, 'MULTIGOAL').map(x=>x.l),
              in: !!(rec.planRounds || []).length};
    }, LEAD);
    if(!r.in) throw new Error('the submission did not land at all');
    if(r.dob !== r.onRecord)
      throw new Error('the form holds "' + r.dob + '" for the date of birth; the record holds "' + r.onRecord + '"');
    ['name','mobile','email'].forEach(k=>{
      if(!r[k]) throw new Error('the form came back with no ' + k);
    });
    if(r.missing.length)
      throw new Error('it is still short of: ' + r.missing.join(', '));
    return 'nothing missing — the form carries ' + r.name + ', ' + r.mobile + ', ' + r.dob;
  });

  t.section('a record that came back before any of this');

  await t.step('Prepare Plan fills what the firm holds rather than refusing', async () => {
    const r = await t.eval(async id=>{
      const rec = DB.leads.find(l=>l.id === id);
      /* exactly the state the firm's own lead was in: the client's
         answers in, Section A empty, the facts on the record */
      ['date','name','mobile','email','dob','city','country','occupation']
        .forEach(k=>{ delete rec.formData.MULTIGOAL[k]; });
      rec.planRounds = (rec.planRounds || []).filter(x=>x.output);
      await save('leads');
      const before = planInputMissing(rec, 'MULTIGOAL').map(x=>x.l);
      const ok = await preparePlanFromStage('LMS', id, '', {open:false});
      const after = planInputMissing(planRecordOf(id), 'MULTIGOAL').map(x=>x.l);
      return {before, ok, after, dob: (planRecordOf(id).formData.MULTIGOAL || {}).dob};
    }, LEAD);
    if(!r.before.length) throw new Error('the fixture did not reproduce the empty Section A');
    if(r.before.indexOf('Date of birth') < 0)
      throw new Error('the state to fix was ' + r.before.join(', ') + ' — not the one reported');
    if(!r.ok) throw new Error('it still refused, over: ' + r.after.join(', '));
    if(r.dob !== '2001-01-01') throw new Error('the date of birth came back as "' + r.dob + '"');
    return 'was short of ' + r.before.join(', ') + '; the plan was prepared';
  });

  t.section('and it is not a way round a real gap');

  await t.step('a fact nobody holds still stops the plan', async () => {
    const r = await t.eval(async id=>{
      const rec = DB.leads.find(l=>l.id === id);
      delete rec.dob;                                   // the firm does not hold it either
      delete rec.formData.MULTIGOAL.dob;
      rec.planRounds = [];
      await save('leads');
      const said = [];
      const realAlert = window.alert;
      window.alert = m => said.push(String(m));
      const ok = await preparePlanFromStage('LMS', id, '', {open:false});
      window.alert = realAlert;
      return {ok, said, rounds: (planRecordOf(id).planRounds || []).length};
    }, LEAD);
    if(r.ok) throw new Error('it went ahead without a date of birth');
    if(r.rounds) throw new Error('it wrote a plan anyway');
    if(!r.said.some(m=>/Date of birth/.test(m)))
      throw new Error('it refused without saying why: ' + r.said.join(' / '));
    return 'refused, and said Date of birth';
  });
});
