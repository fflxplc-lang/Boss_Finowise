/* THE SCORE CAME BACK, THE STAGE SAID IT HADN'T.

   The firm's report: a client answered the Input Form and the ISEQ, the
   result mail went out with their score on it, the submission was on
   file — and the lead went on saying "Awaiting the ISEQ score" and
   "Awaiting the Form — Investor Suitability Questionnaire (ISEQ)".

   Both submission paths do write the score; this suite proves that
   first, so the fix is not built on a guess. What they write is a COPY
   of the submission onto the lead, and a copy can be lost in a way the
   original cannot: a lead row is PUT whole, by whichever tab saves it,
   so a tab holding that lead from before the client answered puts it
   back without a score and nothing says a word. The submission is
   appended and cannot be rewritten.

   So there are three defences now, and each is checked here:
     · the server writes the score onto the record itself when the
       submission arrives, the way the input sheet has been written
       since Mod 14 — nothing stale can undo what the server wrote;
     · the screen asks iseqIsIn(), which reads the field first and the
       submission when the field is gone, so the stage can never
       contradict a score that is on file;
     · iseqHealRecords() puts the field back at load from the
       submission, so a record that already lost one repairs itself. */
const {suite} = require('../lib/harness');

const FILL_ISEQ = `(fields) => {
  fields.forEach(f=>{
    const r = document.getElementById('f_' + f.k + '_o1') || document.getElementById('f_' + f.k + '_o0');
    if(r){ r.checked = true; r.dispatchEvent(new Event('change', {bubbles:true})); return; }
    const sel = document.getElementById('f_' + f.k);
    if(sel && sel.tagName === 'SELECT'){
      const o = Array.from(sel.options).find(x=>x.value); if(o) sel.value = o.value;
      sel.dispatchEvent(new Event('change', {bubbles:true}));
    }
  });
}`;

const onServer = async (t, key) => t.eval(async (k)=>{
  const res = await fetch('/api/storage/' + encodeURIComponent(k), {headers: apiHeaders()});
  if(res.status === 404) return null;
  return JSON.parse((await res.json()).value);
}, key);

suite(async t => {
  await t.home();
  let soloId, soloToken, uniId, uniToken;

  t.section('both ways a client can answer it');

  await t.step('the questionnaire on its own link lands on the lead', async () => {
    const r = await t.eval(async ()=>{
      const l = {id:uid('LEAD'), leadName:'ZZ Solo ISEQ', firstName:'Vik', lastName:'Kale',
        mobile:'9800012345', email:'vik.kale@example.com', rmName:currentUser, assignedTo:currentUser,
        dob:'1990-04-02', transformationForm:'SEVENEVENTS',
        createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('LMS', l); DB.leads.push(l); await save('leads');
      await sendIseqTo(l, 'LMS', {resend:true});
      return {id:l.id, token:l.iseqDocToken};
    });
    soloId = r.id; soloToken = r.token;
    await t.doc(soloToken, 1600);
    await t.eval(async (a)=>{
      const link = DB.docLinks.find(l=>l.token === a.tok);
      eval('(' + a.FILL + ')')(iseqFieldsFor(link.type));
      await submitDocForm(a.tok);
    }, {tok: soloToken, FILL: FILL_ISEQ});
    await t.home();
    const leads = await onServer(t, 'leads');
    const lead = (leads || []).find(x=>x.id === soloId) || {};
    if(lead.iseqScore === undefined || lead.iseqScore === null)
      throw new Error('the lead has no score after the client answered');
    if(!lead.iseqCategory) throw new Error('it has a score but no category');
    return 'ISEQ ' + lead.iseqScore + ' · ' + lead.iseqCategory + ' on the lead, from its own link';
  });

  await t.step('and so does the one that rides on the input sheet', async () => {
    const r = await t.eval(async ()=>{
      const l = {id:uid('LEAD'), leadName:'ZZ Unified ISEQ', firstName:'Asha', lastName:'Rao',
        mobile:'9800054321', email:'asha.rao@example.com', rmName:currentUser, assignedTo:currentUser,
        dob:'1990-04-02', pan:'ABCDE1234F', city:'Varanasi', transformationForm:'SEVENEVENTS',
        createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('LMS', l); DB.leads.push(l); await save('leads');
      const prep = await prepareIseqForMinutes(l, {resend:true});
      const tok = await createDocLink(l.id, 'SEVENEVENTS',
        {iseqToken: l.iseqDocToken, iseqType: prep.iseqType});
      l.planFormToken = tok; dgMarkSent(l, ['sheet','iseq']); await save('leads');
      return {id:l.id, token:tok};
    });
    uniId = r.id; uniToken = r.token;
    await t.doc(uniToken, 1800);
    const got = await t.eval(async (tok)=>{
      const link = DB.docLinks.find(l=>l.token === tok);
      document.querySelectorAll('#publicDocBody input, #publicDocBody select, #publicDocBody textarea')
        .forEach(el=>{
          if(el.type === 'file' || el.type === 'checkbox' || el.type === 'radio' || el.disabled) return;
          if(el.type === 'date'){ if(!el.value) el.value = '1990-04-02'; }
          else if(el.tagName === 'SELECT'){
            const o = Array.from(el.options).find(x=>x.value); if(o && !el.value) el.value = o.value; }
          else if(el.type === 'number'){ if(!el.value) el.value = '100000'; }
          else if(!el.value) el.value = (el.id||'').indexOf('email') >= 0 ? 'asha.rao@example.com'
            : (el.id||'').indexOf('mobile') >= 0 ? '9800054321' : 'ZZ';
          el.dispatchEvent(new Event('input', {bubbles:true}));
          el.dispatchEvent(new Event('change', {bubbles:true}));
        });
      uniGoToIseq(tok);
      if(uniStepOf(tok) !== 2) return {step: uniStepOf(tok)};
      iseqFieldsFor(uniIseqTypeFor(link, tok)).forEach(f=>{
        uniDraftFor(tok).iseq[f.k] = (f.opts || [])[1] || (f.opts || [])[0]; });
      await submitUnifiedClientForm(tok);
      return {step: 2};
    }, uniToken);
    if(got.step !== 2) throw new Error('the page would not move on to the questionnaire');
    await t.home();
    const leads = await onServer(t, 'leads');
    const lead = (leads || []).find(x=>x.id === uniId) || {};
    if(lead.iseqScore === undefined || lead.iseqScore === null)
      throw new Error('the lead has no score after a unified submission');
    if(!lead.planFormReturnedAt) throw new Error('the input sheet did not land either');
    return 'the sheet and ISEQ ' + lead.iseqScore + ' · ' + lead.iseqCategory
      + ' both on the lead, from one link';
  });

  await t.step('the server writes it even when the page never patches the lead', async () => {
    /* The page's own write is the one that went missing in the field.
       The input sheet has not depended on it since Mod 14 — the server
       applies what arrives — and the ISEQ does not now either. This
       posts the submission the way a client page does, and nothing
       else, so only the server can have written the score. */
    const r = await t.eval(async ()=>{
      const l = {id:uid('LEAD'), leadName:'ZZ Server ISEQ', mobile:'9800077777',
        email:'server.iseq@example.com', rmName:currentUser, assignedTo:currentUser,
        dob:'1990-04-02', createdAt:new Date().toISOString()};
      initState('LMS', l); DB.leads.push(l); await save('leads');
      await sendIseqTo(l, 'LMS', {resend:true});
      const token = l.iseqDocToken, type = l.iseqFormType;
      /* nothing is set on the lead here, deliberately */
      const res = await fetch('/api/public/patch?token=' + encodeURIComponent(token), {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({appends:{docSubmissions:[{id:uid('DOCSUB'), token, leadId:l.id,
          type, answers:{}, submittedAt:new Date().toISOString(), submittedBy:'Client',
          score:61, maxScore:100, category:'Growth'}]}})});
      const out = await res.json().catch(()=>({ok:false}));
      const stored = await (await fetch('/api/storage/leads', {headers: apiHeaders()})).json();
      const onFile = JSON.parse(stored.value).find(x=>x.id === l.id) || {};
      return {accepted: out.ok !== false, refused: out.refused || [],
        score: onFile.iseqScore, cat: onFile.iseqCategory, when: onFile.iseqAnsweredAt,
        inMemory: (DB.leads.find(x=>x.id === l.id) || {}).iseqScore};
    });
    if(!r.accepted) throw new Error('the server refused the submission: ' + r.refused.join(', '));
    if(r.inMemory !== undefined) throw new Error('the page wrote it after all, so nothing was proved');
    if(r.score !== 61 || r.cat !== 'Growth')
      throw new Error('the server did not apply the score: ' + r.score + ' / ' + r.cat);
    if(!r.when) throw new Error('it wrote a score with no answered-at against it');
    return 'the submission alone put ISEQ 61 \u00b7 Growth on the lead, written by the server';
  });

  t.section('and when the copy is lost anyway');

  await t.step('a stale tab putting the lead back without a score', async () => {
    /* Exactly what the firm hit: the submission is on file, the score
       card went out, and the field on the lead is gone. */
    const r = await t.eval(async (id)=>{
      const lead = DB.leads.find(x=>x.id === id);
      const sub = iseqSubmissionFor(lead);
      delete lead.iseqScore; delete lead.iseqMaxScore; delete lead.iseqCategory;
      delete lead.iseqAnsweredAt; delete lead.iseqProfileDate;
      await save('leads');
      return {hadSub: !!sub, subScore: sub && sub.score,
        /* the screen must not believe the missing field */
        isIn: iseqIsIn(lead), result: iseqResultOf(lead),
        waiting: dgStatus(lead).waitingFor,
        panel: awaitingIseqPanelHtml(lead, true)};
    }, soloId);
    if(!r.hadSub) throw new Error('the fixture has no submission to read back');
    if(!r.isIn) throw new Error('the screen still thinks the ISEQ never came back');
    if(r.result.from !== 'submission')
      throw new Error('it read the field, not the submission: ' + r.result.from);
    if(r.result.score !== r.subScore)
      throw new Error('it read ' + r.result.score + ', the submission says ' + r.subScore);
    if(r.waiting.some(w=>/ISEQ|Suitability/i.test(w)))
      throw new Error('the stage still says it is waiting: ' + r.waiting.join(', '));
    if(r.panel) throw new Error('the waiting-for-the-ISEQ panel is still drawn');
    return 'field gone, submission on file — the stage reads ' + r.result.score + ' · '
      + r.result.category + ' and says it is waiting for nothing';
  });

  await t.step('and the record repairs itself at the next load', async () => {
    const r = await t.eval(async (id)=>{
      const before = DB.leads.find(x=>x.id === id).iseqScore;
      const fixed = await iseqHealRecords();
      const lead = DB.leads.find(x=>x.id === id);
      const again = await iseqHealRecords();       // and does not write a second time
      const stored = (await sget('leads') || []).find(x=>x.id === id) || {};
      return {before, fixed, again, score: lead.iseqScore, cat: lead.iseqCategory,
        storedScore: stored.iseqScore, from: iseqResultOf(lead).from};
    }, soloId);
    if(r.before !== undefined) throw new Error('the fixture was not actually broken');
    if(!r.fixed.leads) throw new Error('the heal found nothing to put back');
    if(r.again.leads) throw new Error('it healed the same record twice');
    if(r.storedScore === undefined || r.storedScore === null)
      throw new Error('the repair never reached the server');
    if(r.from !== 'record') throw new Error('the field was not actually put back');
    return r.fixed.leads + ' lead repaired from its submission (' + r.score + ' · ' + r.cat
      + '), on the server, and the second run wrote nothing';
  });

  await t.step('a record that never had one is left alone', async () => {
    const r = await t.eval(async ()=>{
      const l = {id:uid('LEAD'), leadName:'ZZ No ISEQ', mobile:'9800099999',
        rmName:currentUser, createdAt:new Date().toISOString()};
      initState('LMS', l); DB.leads.push(l); await save('leads');
      const fixed = await iseqHealRecords();
      const lead = DB.leads.find(x=>x.id === l.id);
      return {fixed: fixed.leads, score: lead.iseqScore, isIn: iseqIsIn(lead)};
    });
    if(r.fixed) throw new Error('it invented a score for a lead with no submission');
    if(r.isIn) throw new Error('it says the ISEQ is in for a lead that never had one');
    return 'no submission, no score, and the stage still asks for it';
  });
});
