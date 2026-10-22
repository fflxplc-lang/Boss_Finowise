/* THE FIRM CALLS IT A CONSENT, SO BOSS DOES.

   The document the client is sent, the page they answer on, the mail
   that carries the link and the report over all of it were headed
   "Recommendation", while everything else here — the statuses, the
   buttons, the workflow the firm wrote down — said consent. The firm
   asked for the one word.

   Two things this guards. That the word is gone from everywhere a
   person reads it. And that the word is NOT gone from the places it
   is ordinary English rather than the name of the document: a
   planner's recommendation inside a Blueprint, and the compliance
   disclosure, where "Consents rely on the information you supplied"
   would be nonsense. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();

  t.section('the page the client answers on');

  await t.step('every heading, button and line on it says consent', async () => {
    const r = await t.eval(async ()=>{
      let c = DB.clients.find(x=>x.id === 'CMS-WORD');
      if(!c){ c = {id:'CMS-WORD'}; DB.clients.push(c); }
      Object.assign(c, {cmsName:'ZZ Word Client', email:'word@example.com',
        rmName: currentUser, createdAt:new Date().toISOString()});
      DB.recommendations = (DB.recommendations || []).filter(x=>x.clientId !== 'CMS-WORD');
      const rec = {id: uid('REC'), clientId: c.id, status:'Sent to Client', productCategory:'Mutual Fund',
        investmentMode:'Lumpsum', schemes:[Object.assign(newAllocSchemeLine({productCategory:'Mutual Fund'}),
          {schemeName:'ZZ Word Scheme', amount:'500000', transactionType:'Purchase'})],
        attachments:[], createdAt:new Date().toISOString()};
      DB.recommendations.push(rec);
      await save('clients'); await save('recommendations');
      const token = uid('DOC');
      DB.docLinks.push({token, type:'ALLOC', recordModule:'CMS', recordId:c.id,
        allocationId:rec.id, allocationIds:[rec.id], status:'Active',
        createdAt:new Date().toISOString(),
        expiresAt:new Date(Date.now() + 72*3600*1000).toISOString()});
      await save('docLinks');
      renderPublicDocForm(token);
      const open = document.getElementById('root').textContent || '';
      /* And the page once it has been answered. */
      document.getElementById('f_discAck').checked = true; planAckChanged();
      await submitAllocationDecision(token, true, rec.id);
      const done = document.getElementById('root').textContent || '';
      return {open, done, rec: rec.id, token};
    });
    const bad = [];
    if(/recommendation/i.test(r.open)) bad.push('the page as the client opens it');
    if(/recommendation/i.test(r.done)) bad.push('the page after they approve');
    if(bad.length) throw new Error('still says recommendation on: ' + bad.join(' and '));
    if(!/Consent Approval/.test(r.open)) throw new Error('the page is not headed Consent Approval');
    if(!/Investment Consent/.test(r.open)) throw new Error('the document is not headed Investment Consent');
    if(!/Approve Consent/.test(r.open)) throw new Error('the button does not say Approve Consent');
    if(!/Consent Approved/.test(r.done)) throw new Error('the answered page does not say Consent Approved');
    return 'Consent Approval, Investment Consent, Approve Consent, Consent Approved — and not one recommendation left on it';
  });

  t.section('the mail, the shipped words and the ones a firm is holding');

  await t.step('the templates BOSS ships say consent', async () => {
    const r = await t.eval(()=>{
      const d = defaultConfig().mailTemplates;
      const said = [];
      Object.keys(d).forEach(k=>{
        const t = d[k]; if(!t) return;
        if(/recommendation/i.test(String(t.subject || '') + String(t.body || ''))) said.push(k);
      });
      return {said, approval: d.allocApproval.subject, ack: d.allocAcknowledgement.subject};
    });
    if(r.said.length) throw new Error('these shipped templates still say it: ' + r.said.join(', '));
    if(!/Consent/.test(r.approval)) throw new Error('the approval mail reads "' + r.approval + '"');
    if(!/Consent/.test(r.ack)) throw new Error('the acknowledgement reads "' + r.ack + '"');
    return 'none of the shipped templates says it; the two that matter read "'
      + r.approval + '" and "' + r.ack + '"';
  });

  await t.step('and a firm already holding the old words has the word moved, not their words', async () => {
    const r = await t.eval(async ()=>{
      DB.config.mailTemplates = DB.config.mailTemplates || {};
      DB.config.mailTemplates.allocApproval = {
        subject:'Investment Recommendation for your approval — {Ref}',
        body:'Dear {ClientName},\n\nOur own wording. Please review the recommendation.\n\nRegards'};
      delete DB.config.consentWordingAt;
      await save('config');
      const ran = await migrateRecommendationWording();
      /* Read it NOW: the object is mutated again below, and a live
         reference would come back holding the later value. */
      const t0 = Object.assign({}, DB.config.mailTemplates.allocApproval);
      /* Twice is once. */
      delete DB.config.consentWordingAt;
      DB.config.mailTemplates.allocApproval.subject = 'ZZ Recommendation again';
      await save('config');
      await migrateRecommendationWording();
      const after = DB.config.mailTemplates.allocApproval.subject;
      /* And once it has run, a firm that types the word back keeps it. */
      DB.config.mailTemplates.allocApproval.subject = 'ZZ Recommendation on purpose';
      await save('config');
      const again = await migrateRecommendationWording();
      return {ran, subject: t0.subject, body: t0.body, after, again,
              kept: DB.config.mailTemplates.allocApproval.subject};
    });
    if(!r.ran) throw new Error('the migration did nothing to a template holding the old word');
    if(/recommendation/i.test(r.subject)) throw new Error('the subject still reads "' + r.subject + '"');
    if(/recommendation/i.test(r.body)) throw new Error('the body still reads it');
    if(!/Our own wording/.test(r.body)) throw new Error('it overwrote what the firm had written');
    if(!/Please review the consent/.test(r.body)) throw new Error('the body reads "' + r.body + '"');
    if(r.again) throw new Error('it ran a second time');
    if(r.kept !== 'ZZ Recommendation on purpose')
      throw new Error('a firm that typed the word back was corrected: "' + r.kept + '"');
    return 'the word moved and the firm’s own sentence stayed; it runs once, '
      + 'and a firm that types it back keeps it';
  });

  t.section('the report');

  await t.step('the report is Consent Analytics', async () => {
    const r = await t.eval(()=>{
      const all = (typeof REPORTS !== 'undefined' ? REPORTS : []).map(x=>x.title + ' — ' + (x.desc || ''));
      return {said: all.filter(x=>/recommendation/i.test(x)),
              has: all.some(x=>/Consent Analytics/.test(x))};
    });
    if(r.said.length) throw new Error('a report still says it: ' + r.said.join(' | '));
    if(!r.has) throw new Error('there is no Consent Analytics report');
    return 'Consent Analytics, and no report title or description says recommendation';
  });

  t.section('and where it is ordinary English it is left alone');

  await t.step('the planner’s own recommendation and the disclosure keep the word', async () => {
    const r = await t.eval(()=>{
      const s = Array.from(document.querySelectorAll('script')).map(x=>x.textContent).join('\n');
      return {blueprint: /Recommendation, printed in the Blueprint/.test(s),
              disclosure: /Recommendations are subject to review when you act on them/.test(s),
              nonsense: /Consents rely on the information you supplied/.test(s)};
    });
    if(!r.blueprint)
      throw new Error('a planner writing a recommendation in a Blueprint is now writing a "consent"');
    if(!r.disclosure) throw new Error('the compliance disclosure was reworded');
    if(r.nonsense) throw new Error('the disclosure now says consents rely on information, which is nonsense');
    return 'a Blueprint recommendation is still a recommendation, and the disclosure is untouched';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
