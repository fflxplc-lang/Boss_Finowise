/* THE INPUT-FORM PANEL, AND THE TWO BUTTONS THAT WERE NOT ITS JOB.

   The stage panel for a blueprint's input form carried three buttons:
   open the sheet, send it to the client, and submit it on the client's
   behalf. The middle one was the stage's own step by another route —
   the bar below it says "Send the Form & the ISEQ", which sends the
   sheet and the questionnaire together and records both — and the
   third was an outside shortcut into an act that belongs inside the
   sheet, where whoever is doing it has the answers in front of them.

   So the panel has one button now. What this holds to: that it is the
   one that opens the sheet, on every blueprint, including the locked
   case where the sheet is with the client; that neither removed act
   was removed from the system, only from this panel; and that the
   panel still says what is outstanding, which is why anybody looks at
   it. */
const {suite} = require('../lib/harness');

const TYPES = ['SEVENEVENTS', 'GAB', 'FSL'];

suite(async t => {
  await t.home();
  let lead = null;

  await t.step('a lead sitting on the input form', async () => {
    lead = await t.eval(async ()=>{
      const l = {id:uid('LEAD'), leadName:'ZZ Panel Lead', firstName:'Priya', lastName:'Lal',
        mobile:'9800099999', email:'priya.lal@example.com', rmName:currentUser, assignedTo:currentUser,
        createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('LMS', l); DB.leads.push(l); await save('leads');
      return l.id;
    });
    return 'one lead, no answers on it yet';
  });

  await t.step('every blueprint draws one button, and it opens the sheet', async () => {
    const r = await t.eval((a)=>{
      const rec = DB.leads.find(x=>x.id === a.lead);
      const out = {};
      a.types.forEach(ty=>{
        const html = sheetInputPanelHtml(rec, true, null, '', ty);
        const buttons = (html.match(/<button/g) || []).length;
        out[ty] = {buttons,
          opens: /sheetOpenFrom\(/.test(html),
          send: /openSendPlanFormModal\(/.test(html),
          behalf: /sheetSubmitForClient\(|Submit it on the client/.test(html),
          /* and the panel still does the thing it is for */
          outstanding: /still to come|nothing outstanding/.test(html),
          comment: /\/\*/.test(html)};
      });
      return out;
    }, {lead, types: TYPES});
    TYPES.forEach(ty=>{
      const p = r[ty];
      if(!p) throw new Error(ty + ' drew nothing at all');
      if(p.send) throw new Error(ty + ' still offers Send it to the client');
      if(p.behalf) throw new Error(ty + ' still offers Submit it on the client’s behalf');
      if(p.buttons !== 1) throw new Error(ty + ' drew ' + p.buttons + ' buttons, not 1');
      if(!p.opens) throw new Error(ty + '’s one button does not open the sheet');
      if(!p.outstanding) throw new Error(ty + ' no longer says what is outstanding');
      if(p.comment) throw new Error(ty + ' printed a source comment onto the page');
    });
    return TYPES.join(', ') + ' — one button each, the one that opens the sheet, and each still '
      + 'says what is still to come';
  });

  await t.step('and it is disabled, not missing, while the sheet is with the client', async () => {
    const r = await t.eval((a)=>{
      const rec = DB.leads.find(x=>x.id === a.lead);
      /* what dgSheetLocked() reads: the sheet has gone out and has not
         come back, so opening it here would fight the client's copy */
      const kept = rec.dgSent;
      rec.dgSent = {sheet: new Date().toISOString()};
      const html = sheetInputPanelHtml(rec, true, null, '', 'SEVENEVENTS');
      const locked = dgSheetLocked(rec);
      rec.dgSent = kept;
      return {locked, buttons: (html.match(/<button/g) || []).length,
        disabled: /<button[^>]*disabled/.test(html),
        send: /openSendPlanFormModal\(/.test(html),
        behalf: /sheetSubmitForClient\(|Submit it on the client/.test(html)};
    }, {lead});
    if(!r.locked) throw new Error('the fixture did not lock the sheet');
    if(r.buttons !== 1) throw new Error('the locked panel drew ' + r.buttons + ' buttons');
    if(!r.disabled) throw new Error('the locked panel still offers to open the sheet');
    if(r.send || r.behalf) throw new Error('the locked panel brought the two buttons back');
    return 'one button, disabled, with the reason on its title — and neither of the other two';
  });

  await t.step('no record screen prints the client’s own link', async () => {
    /* The link opens somebody's form with their answers in it. On a
       staff screen it is something to copy, and a link passed on by
       hand has no sent-at, no template and no trail. It travels in
       the letter; the screens say the letter went. */
    const r = await t.eval((a)=>{
      const rec = DB.leads.find(x=>x.id === a.lead);
      const kept = JSON.parse(JSON.stringify({dgSent: rec.dgSent || null}));
      rec.iseqDocToken = 'DOC-ZZISEQ'; rec.fqDocToken = 'DOC-ZZFQ';
      rec.cifDocToken = 'DOC-ZZCIF'; rec.planFormToken = 'DOC-ZZFORM';
      rec.fqSentAt = new Date().toISOString();
      rec.dgSent = {sheet: rec.fqSentAt};
      const urls = ['DOC-ZZISEQ','DOC-ZZFQ','DOC-ZZCIF','DOC-ZZFORM'].map(docUrl);
      const screens = {
        panel: sheetInputPanelHtml(rec, true, null, 'DOC-ZZFORM', 'SEVENEVENTS'),
        iseq: awaitingIseqPanelHtml(rec, true),
        fq: qualifyFqPanelHtml(rec, true),
      };
      navigate('lms', rec.id);
      screens.page = document.getElementById('content').innerHTML;
      navigate('lms');
      rec.dgSent = kept.dgSent;
      delete rec.iseqDocToken; delete rec.fqDocToken; delete rec.cifDocToken;
      delete rec.planFormToken; delete rec.fqSentAt;
      const leaked = {};
      Object.keys(screens).forEach(k=>{
        const hit = urls.filter(u=>screens[k].indexOf(u) >= 0);
        if(hit.length) leaked[k] = hit.length;
      });
      return {leaked, openTheLink: /open the link/.test(screens.page),
        panelSays: /the link went in that mail/.test(screens.panel),
        fqSays: /in the mail that\s+went to/.test(screens.fq),
        panelHead: screens.panel.replace(/\s+/g,' ').slice(0, 300),
        fqHead: screens.fq.replace(/\s+/g,' ').slice(0, 400),
        note: typeof clientLinkNote};
    }, {lead});
    if(r.note !== 'function') throw new Error('there is no one place that writes the line');
    const bad = Object.keys(r.leaked);
    if(bad.length) throw new Error('a client link is printed on: ' + bad.join(', '));
    if(r.openTheLink) throw new Error('the lead page still offers "open the link"');
    if(!r.fqSays) throw new Error('the FQ panel no longer says where the link went: ' + r.fqHead);
    if(!r.panelSays) throw new Error('the input panel no longer says the mail went: ' + r.panelHead);
    return 'the stage bar, the panels and the whole lead page print no document URL — they say the '
      + 'mail went and offer to send it again';
  });

  await t.step('neither act was removed from the system, only from this panel', async () => {
    const r = await t.eval(()=>({
      sendModal: typeof openSendPlanFormModal === 'function',
      /* submitting on the client's behalf still lives on each sheet */
      se: typeof seSubmitForClient === 'function',
      fsl: typeof fslSubmitForClient === 'function',
      gab: typeof gabSubmitForClient === 'function',
      adapters: blueprintModuleTypes().filter(ty=>{
        const A = sheetAdapter(ty); return A && typeof A.submitForClient === 'function'; }),
      /* and the router the removed button called is gone with it */
      router: typeof sheetSubmitForClient,
    }));
    if(!r.sendModal) throw new Error('the send dialog itself was deleted');
    if(!r.se || !r.fsl || !r.gab) throw new Error('a sheet lost its submit-for-client');
    if(r.adapters.length < 3) throw new Error('only ' + r.adapters.length + ' adapters still offer it');
    if(r.router !== 'undefined') throw new Error('the dead router is still defined');
    return 'the send dialog and all ' + r.adapters.length + ' submit-for-client paths are intact; '
      + 'only the panel’s two shortcuts and the router behind one of them are gone';
  });
});
