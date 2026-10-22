/* THE ONE LINK A CLIENT GETS, AND WHAT COMES BACK ON IT.

   A lead on a blueprint is sent a single link carrying three things: their
   own details, the blueprint's input form, and the ISEQ. The rules that have
   accumulated over the modifications:

     * the ISEQ is not optional — the form will not submit without it (7 Oct);
     * what the client sends lands on the record, not in a drawer (Mod 14);
     * a form sent again and answered again updates the record it belongs to,
       rather than being filed as a second opinion (Mod 18);
     * a link may only write to the records it actually carries — a client's
       own page is not a way into the rest of the database.

   The last of those is the one with teeth, so it is checked rather than
   assumed. */
const {suite} = require('../lib/harness');

suite(async t => {

  t.section('the link a lead is sent');

  let leadId, token;
  await t.step('it carries the details, the input form and the ISEQ', async () => {
    const r = await t.eval(async ()=>{
      const l = {id:uid('LEAD'), leadName:'ZZ Public Lead', firstName:'Meera', lastName:'Iyer',
        mobile:'9800066666', email:'meera.iyer@example.com', rmName:currentUser,
        transformationForm:'SEVENEVENTS', createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('LMS', l); DB.leads.push(l); await save('leads');
      const tok = await createDocLink(l.id, 'SEVENEVENTS', {iseqType:'ISEQ_UNDER50'});
      const link = DB.docLinks.find(x=>x.token===tok);
      return {id:l.id, token:tok, type:link.type, iseq:link.iseqType};
    });
    if(r.type !== 'SEVENEVENTS') throw new Error('the link carries ' + r.type);
    if(!r.iseq) throw new Error('the link carries no ISEQ');
    leadId = r.id; token = r.token;
    return r.type + ' + ' + r.iseq;
  });

  await t.step('the client’s page draws all three parts', async () => {
    await t.doc(token, 1600);
    const r = await t.eval(()=>({
      basics: !!document.querySelector('#publicDocBody, .public-body, .fx-main'),
      text: (document.body.innerText || '').slice(0, 4000),
    }));
    if(!r.basics) throw new Error('the page drew no body at all');
    if(!/your details|detail/i.test(r.text)) throw new Error('no details section');
    return 'the page is there, and names its sections';
  });

  await t.step('it will not submit without the ISEQ', async () => {
    const r = await t.eval(()=>{
      const src = Array.from(document.querySelectorAll('script')).map(s=>s.textContent).join('\n');
      const i = src.indexOf('function submitUnifiedClientForm');
      const chunk = src.slice(i, i + 2600);
      return {gate: /uniAsksIseq\(link\)\s*&&\s*!parts\.iseq\.type/.test(chunk)};
    });
    if(!r.gate) throw new Error('there is no gate stopping a submission with no ISEQ');
    return 'the submission is refused until the questionnaire is answered';
  });

  t.section('what comes back reaches the record');

  await t.step('a CIF answered on the link updates the client it belongs to', async () => {
    await t.home();                       // back inside the app: this is the adviser's side
    const r = await t.eval(async ()=>{
      const c = {id:uid('CMS'), cmsName:'ZZ Writeback Client', rmName:currentUser,
        createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('CMS', c); DB.clients.push(c); await save('clients');
      const tok = await createDocLink(null, 'CIF', {recordModule:'CMS', recordId:c.id});
      const link = DB.docLinks.find(x=>x.token===tok);
      await applyFormAnswersToRecord(link, {cif_name:'Meera Iyer', cif_mobile:'9800066666'}, 'CIF');
      const back = DB.clients.find(x=>x.id===c.id);
      return {id:c.id, held: !!(back.formData && back.formData.CIF),
              stamped: !!back.cifFilledAt, type: back.cifFormType};
    });
    if(!r.held) throw new Error('the answers were not stored against the client');
    if(!r.stamped) throw new Error('the CIF was not stamped as filled');
    return 'answers held on the client, and the CIF stamped ' + (r.type || '');
  });

  await t.step('answering again replaces what was there, not adds to it', async () => {
    const r = await t.eval(async ()=>{
      const c = DB.clients.find(x=>x.cmsName==='ZZ Writeback Client');
      const tok = await createDocLink(null, 'CIF', {recordModule:'CMS', recordId:c.id});
      const link = DB.docLinks.find(x=>x.token===tok);
      await applyFormAnswersToRecord(link, {cif_name:'Meera Iyer-Rao', cif_mobile:'9800077777'}, 'CIF');
      const back = DB.clients.find(x=>x.id===c.id);
      return {name: back.formData.CIF.cif_name, mobile: back.formData.CIF.cif_mobile,
              keys: Object.keys(back.formData)};
    });
    if(r.name !== 'Meera Iyer-Rao') throw new Error('the record still reads ' + r.name);
    if(r.keys.length !== 1) throw new Error('it kept ' + r.keys.length + ' copies: ' + r.keys.join(','));
    return 'the latest answers stand, in one place';
  });

  t.section('a link is not a way into the rest of the database');

  await t.step('the server refuses a write to a record the link does not carry', async () => {
    // the refusal is the point, so the 403 it logs is not a defect
    t.expectConsole(/403 \(Forbidden\)/, /public save refused/);
    await t.doc(token, 900);
    const r = await t.eval(async (tok)=>{
      const res = await fetch('/api/public/patch?token=' + encodeURIComponent(tok), {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({appends:{clients:[{id:'CMS-not-mine', cmsName:'Taken over'}]}})});
      const out = await res.json().catch(()=>({}));
      return {status: res.status, ok: out.ok !== false,
              refused: out.refused || [], message: out.message || '',
              body: JSON.stringify(out).slice(0, 200)};
    }, token);
    const stopped = r.status >= 400 || !r.ok || r.refused.length;
    if(!stopped) throw new Error('a write outside the link was accepted: ' + r.body);
    if(!/outside this link/i.test(r.message) && !r.refused.length)
      throw new Error('it was stopped, but not for the right reason: ' + r.body);
    return r.status + ' — "' + (r.message || r.refused.join(', ')) + '"';
  });

  await t.step('and no stray client was created by the attempt', async () => {
    await t.home();
    const n = await t.eval(()=>DB.clients.filter(c=>c.cmsName==='Taken over').length);
    if(n) throw new Error(n + ' record(s) were written from outside the link');
    return 'none';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
