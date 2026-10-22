/* TWO RISK METERS, AND A CONSENT WHEN THEY DISAGREE.

   The firm asked for the Risk Profile section to be two sub-sections
   rather than one: the Client Risk Meter, read off the client's latest
   ISEQ, and the Portfolio Risk Meter, read off the risk of the schemes
   actually being recommended. Both analog, both with a needle that
   moves with the reading.

   Then the comparison, in their three scenarios: the two match and
   nothing more is asked; the client is more conservative than the
   portfolio; the client is more aggressive than it. Either mismatch
   raises a Client Consent for Risk Profile Mismatch on the same page,
   and the client cannot approve until it is given.

   The two lists are not the same length — the questionnaire produces
   five profiles, SEBI's riskometer has six bands — and neither is
   written down here: both are read from Setup. What is compared is
   each reading's position along its own list. This pins that rule,
   because it is the one judgement in the whole feature. */
const {suite} = require('../lib/harness');

const CLIENT = 'CMS-RM';
const SEED = `async function(category, score, risk){
  let c = DB.clients.find(x=>x.id === '${CLIENT}');
  if(!c){ c = {id:'${CLIENT}'}; DB.clients.push(c); }
  Object.assign(c, {cmsName:'ZZ Meter Client', name:'ZZ Meter Client', mobile:'9800111444',
    email:'meter@example.com', iseqScore:score, iseqMaxScore:100, iseqCategory:category,
    iseqFormType:'ISEQ_UNDER50', createdAt:new Date().toISOString()});
  if(!stateOf('CMS', c)) initState('CMS', c);
  let a = DB.recommendations.find(x=>x.id === 'ALLOC-RM');
  if(!a){ a = {id:'ALLOC-RM'}; DB.recommendations.push(a); }
  Object.assign(a, {clientId:c.id, status:'Draft', productCategory:'Mutual Fund',
    investmentMode:'Lumpsum', createdAt:new Date().toISOString(), createdBy:currentUser,
    schemes:[{schemeName:'ZZ Scheme', fundCategory:'Other', riskLevel:risk,
              amount:'500000', mode:'Lumpsum', plan:'Direct Plan'}]});
  delete a.riskConsent;
  await save('clients'); await save('recommendations');
  return {c:c.id, a:a.id};
}`;

suite(async t => {
  await t.home();

  t.section('where each reading comes from');

  await t.step('the client’s is the ISEQ, the portfolio’s is what is recommended', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      await (${SEED})('Moderate', 50, 'Moderate');
      const c = DB.clients.find(x=>x.id === '${CLIENT}');
      const a = DB.recommendations.find(x=>x.id === 'ALLOC-RM');
      const cm = clientRiskMeter(c), pm = portfolioRiskMeter(a);
      /* change the scheme's own riskometer and the portfolio meter follows;
         the client's does not move, because it is not read from there */
      a.schemes[0].riskLevel = 'Very High';
      const pm2 = portfolioRiskMeter(a), cm2 = clientRiskMeter(c);
      a.schemes[0].riskLevel = 'Moderate';
      return {cm:{cat:cm.category, score:cm.score, bands:cm.bands.length},
              pm:{cat:pm.category, bands:pm.bands.length},
              moved: pm2.category, clientStill: cm2.category,
              /* and with no questionnaire there is no client reading at all */
              none: (()=>{ const was = c.iseqCategory; delete c.iseqCategory;
                           const x = clientRiskMeter(c); c.iseqCategory = was; return x; })()};
    })()`));
    if(r.cm.cat !== 'Moderate' || Number(r.cm.score) !== 50)
      throw new Error('the client meter reads ' + JSON.stringify(r.cm));
    if(r.pm.cat !== 'Moderate') throw new Error('the portfolio meter reads ' + r.pm.cat);
    if(r.moved !== 'Very High')
      throw new Error('changing the scheme’s riskometer left the portfolio at ' + r.moved);
    if(r.clientStill !== 'Moderate')
      throw new Error('it moved the client’s reading too, to ' + r.clientStill);
    if(r.none) throw new Error('a client with no questionnaire still got a reading');
    if(r.cm.bands !== 5 || r.pm.bands !== 6)
      throw new Error('the scales are ' + r.cm.bands + ' and ' + r.pm.bands + ' long');
    return 'client ' + r.cm.cat + ' (' + r.cm.bands + ' profiles) · portfolio '
         + r.pm.cat + ' (' + r.pm.bands + ' bands)';
  });

  await t.step('and the needle is drawn where the reading lands', async () => {
    const r = await t.eval(()=>{
      const c = DB.clients.find(x=>x.id === 'CMS-RM');
      const pull = cat => {
        c.iseqCategory = cat;
        const h = riskMeterHtml(clientRiskMeter(c), {label:'CLIENT RISK METER'});
        const m = h.match(/<line x1="[\d.]+" y1="[\d.]+" x2="([\d.]+)" y2="([\d.]+)"/);
        return m ? {x:Number(m[1]), y:Number(m[2])} : null;
      };
      const low = pull('Conservative'), mid = pull('Moderate'), high = pull('Aggressive');
      c.iseqCategory = 'Moderate';
      const html = riskMeterHtml(clientRiskMeter(c), {label:'CLIENT RISK METER'});
      return {low, mid, high, svg: /<svg/.test(html), segs: (html.match(/<path /g)||[]).length,
              shows: /Moderate/.test(html) && /50/.test(html)};
    });
    if(!r.svg) throw new Error('the meter is not drawn');
    if(r.segs !== 5) throw new Error('the dial has ' + r.segs + ' segments, not one per profile');
    if(!r.shows) throw new Error('it does not print the category and the score');
    if(!(r.low.x < r.mid.x && r.mid.x < r.high.x))
      throw new Error('the needle does not travel with the reading: '
        + [r.low.x, r.mid.x, r.high.x].join(' → '));
    return 'five segments, and the needle at x ' + [r.low.x, r.mid.x, r.high.x].join(' → ');
  });

  t.section('the firm’s three scenarios');

  const scen = [
    ['Moderate',     'Moderate',  true,  '',             'both read the middle of their own scale'],
    ['Conservative', 'Very High', false, 'clientLower',  'the client is the more conservative'],
    ['Aggressive',   'Low',       false, 'clientHigher', 'the client is the more aggressive'],
  ];
  for(const [cat, risk, same, how, note] of scen){
    await t.step(cat + ' client, ' + risk + ' portfolio — ' + (same? 'same profile' : 'a mismatch'), async () => {
      const r = await t.eval(new Function(`return (async ()=>{
        await (${SEED})('${cat}', ${cat === 'Conservative' ? 22 : cat === 'Aggressive' ? 90 : 50}, '${risk}');
        const c = DB.clients.find(x=>x.id === '${CLIENT}');
        const a = DB.recommendations.find(x=>x.id === 'ALLOC-RM');
        const cmp = riskMeterCompare(clientRiskMeter(c), portfolioRiskMeter(a));
        const html = riskProfileSectionHtml(c, a, {ask:true, clientName:'ZZ Meter Client'});
        return {cmp, same: /Same Risk Profile/.test(html),
                mismatch: /Risk profile mismatch/.test(html),
                consent: /CLIENT CONSENT FOR RISK PROFILE MISMATCH/.test(html),
                tick: /id="f_riskAck"/.test(html),
                pending: /Pending/.test(html),
                /* everything the firm listed has to be on the consent */
                has: {who:/ZZ Meter Client/.test(html), ref:/ALLOC-RM/.test(html),
                      both: html.indexOf('Client Risk Meter:') >= 0 && html.indexOf('Portfolio Risk Meter:') >= 0,
                      declare:/I understand that my assessed risk profile differs/.test(html)}};
      })()`));
      if(!r.cmp) throw new Error('the two could not be compared at all');
      if(r.cmp.same !== same) throw new Error('it read them as ' + JSON.stringify(r.cmp));
      if(!same && r.cmp.how !== how) throw new Error('it read the mismatch as ' + r.cmp.how);
      if(same && (!r.same || r.consent)) throw new Error('a match still asked for consent');
      if(!same && (!r.mismatch || !r.consent || !r.tick || !r.pending))
        throw new Error('a mismatch did not raise the consent section');
      return note;
    });
  }

  t.section('and the consent itself');

  await t.step('a mismatch asks for it, with everything on it', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      await (${SEED})('Conservative', 22, 'Very High');
      const c = DB.clients.find(x=>x.id === '${CLIENT}');
      const a = DB.recommendations.find(x=>x.id === 'ALLOC-RM');
      const ask = riskProfileSectionHtml(c, a, {ask:true, clientName:'ZZ Meter Client'});
      const crm = riskProfileSectionHtml(c, a, {ask:false, clientName:'ZZ Meter Client'});
      return {
        who:/ZZ Meter Client/.test(ask), ref:/ALLOC-RM/.test(ask),
        both: /Client Risk Meter: <b>Conservative/.test(ask) && /Portfolio Risk Meter: <b>Very High/.test(ask),
        why: /more conservative than the risk of the portfolio/.test(ask),
        declare: /I understand that my assessed risk profile differs/.test(ask),
        tick: /id="f_riskAck"/.test(ask), pending: /Pending/.test(ask),
        /* the adviser's own view shows the state and offers no tick */
        crmTick: /id="f_riskAck"/.test(crm),
        crmSays: /cannot be given here on their behalf/.test(crm),
      };
    })()`));
    ['who','ref','both','why','declare','tick','pending'].forEach(k=>{
      if(!r[k]) throw new Error('the consent is missing: ' + k);
    });
    if(r.crmTick) throw new Error('the CRM offers a tick to give the client’s consent for them');
    if(!r.crmSays) throw new Error('the CRM does not say why it cannot be given there');
    return 'name, reference, both readings, the reason, the declaration and a Pending status';
  });

  await t.step('once given it is recorded, and it is not asked again', async () => {
    const r = await t.eval(()=>{
      const c = DB.clients.find(x=>x.id === 'CMS-RM');
      const a = DB.recommendations.find(x=>x.id === 'ALLOC-RM');
      const before = riskConsentGiven(a);
      a.riskConsent = {at:new Date().toISOString(), by:'ZZ Meter Client', how:'clientLower',
        clientCategory:'Conservative', portfolioCategory:'Very High', status:'Consented'};
      const html = riskProfileSectionHtml(c, a, {ask:true, clientName:'ZZ Meter Client'});
      /* a profile re-taken afterwards must not rewrite what was consented to */
      c.iseqCategory = 'Aggressive';
      const later = riskProfileSectionHtml(c, a, {ask:true, clientName:'ZZ Meter Client'});
      c.iseqCategory = 'Conservative';
      delete a.riskConsent;
      return {before, given: riskConsentGiven(a), done: /Consented/.test(html),
              tick: /id="f_riskAck"/.test(html),
              keeps: /Conservative/.test(later) && /Very High/.test(later)};
    });
    if(r.before) throw new Error('it read as consented before anything was given');
    if(!r.done) throw new Error('it does not show as Consented once given');
    if(r.tick) throw new Error('it still asks for the tick after it has been given');
    if(!r.keeps) throw new Error('a later change of profile rewrote what was consented to');
    return 'Consented, with the two readings as they stood when it was given';
  });

  await t.step('and the client cannot approve a mismatch without it', async () => {
    const r = await t.eval(()=>{
      const src = String(submitAllocationDecision);
      return {gate: /f_riskAck/.test(src) && /riskConsentGiven/.test(src),
              onlyApprove: /approved && !riskConsentGiven/.test(src),
              records: /riskConsent = \{/.test(src),
              audits: /Risk Profile Mismatch/.test(src),
              /* the tick joins the disclosure tick in opening the buttons */
              button: /f_riskAck/.test(String(planAckChanged))};
    });
    if(!r.gate) throw new Error('approving is not gated on the consent');
    if(!r.onlyApprove) throw new Error('asking a question is gated on it too, and should not be');
    if(!r.records) throw new Error('the consent is not written onto the allocation');
    if(!r.audits) throw new Error('it is not audited');
    if(!r.button) throw new Error('the tick does not open the Approve button');
    return 'Approve is gated, the question is not, and the consent is written and audited';
  });

  t.section('and it is the same section wherever it appears');

  await t.step('the client card and the sheet being built both carry it', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      await (${SEED})('Conservative', 22, 'Very High');
      const c = DB.clients.find(x=>x.id === '${CLIENT}');
      const a = DB.recommendations.find(x=>x.id === 'ALLOC-RM');
      const card = cpRiskReco(c);
      /* the sheet editor, drawn off a draft rather than a saved record */
      /* the draft the editor works on carries a few fields a saved sheet
         does not, so it is built the way the form itself builds one */
      window._allocDraft = Object.assign({}, a, {clientId:c.id, attachments:[], lines:[]});
      /* The editor draws itself into the dialog rather than returning
         markup, so the dialog is what this reads. */
      renderAllocationForm(true);
      const sheet = (document.querySelector('#modalBody .modal-body') || {}).innerHTML || '';
      closeModal();
      return {
        card: {meters: /CLIENT RISK METER/.test(card) && /PORTFOLIO RISK METER/.test(card),
               verdict: /Risk profile mismatch/.test(card),
               noTick: !/id="f_riskAck"/.test(card)},
        sheet:{meters: /CLIENT RISK METER/.test(sheet) && /PORTFOLIO RISK METER/.test(sheet),
               verdict: /Risk profile mismatch/.test(sheet),
               noTick: !/id="f_riskAck"/.test(sheet)},
      };
    })()`));
    ['card','sheet'].forEach(k=>{
      if(!r[k].meters) throw new Error('the ' + k + ' does not draw both meters');
      if(!r[k].verdict) throw new Error('the ' + k + ' does not say the two differ');
      if(!r[k].noTick) throw new Error('the ' + k + ' offers to give the client\u2019s consent for them');
    });
    return 'both meters and the verdict on the client card and on the sheet being built, neither asking for the tick';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
