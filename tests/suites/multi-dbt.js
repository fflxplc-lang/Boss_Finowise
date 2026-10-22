/* SEVERAL DBTs IN ONE SITTING, AND A PLAN FOR EACH OF THEM.

   An adviser leaves a meeting with four agreed investments. The sheet
   took one at a time, in a single column of ten boxes, so that meant
   opening the dialog, saving, navigating back and opening it again,
   four times, re-choosing the same client and the same platform each
   time.

   The sheet is a grid now, and Add Another DBT puts a second section
   under the first. The whole point of the arrangement is that nothing
   downstream knows about it: each section is written by the same
   dbtRaiseEntry() a single DBT has always used, so each gets its own
   entry, its own execution plan holding its own agreed amount, its own
   consent and its own transactions.

   What this suite is really guarding is that the sections cannot mix:
   four amounts typed into four sections must end up on four plans, not
   pooled onto one, and not copied from the last one typed. */
const {suite} = require('../lib/harness');

const SEED = async ()=>{
  let c = DB.clients.find(x=>x.id === 'CMS-MULTI');
  if(!c){ c = {id:'CMS-MULTI'}; DB.clients.push(c); }
  Object.assign(c, {cmsName:'ZZ Multi Client', mobile:'9800123457', email:'multi@example.com',
    rmName: currentUser, branch:'Varanasi', clientCategory:'A',
    createdAt:new Date().toISOString()});
  DB.businessEntries = (DB.businessEntries || []).filter(e=>e.clientId !== 'CMS-MULTI');
  DB.recommendations = (DB.recommendations || []).filter(r=>r.clientId !== 'CMS-MULTI');
  DB.transactions = (DB.transactions || []).filter(t=>t.clientId !== 'CMS-MULTI');
  await save('clients'); await save('businessEntries');
  await save('recommendations'); await save('transactions');
  return c.id;
};

suite(async t => {
  await t.home();
  await t.eval(src => { window.SEED_FN = eval('(' + src + ')'); }, String(SEED));

  t.section('the sheet is wide, and it holds more than one');

  await t.step('ten boxes side by side, not ten rows down the page', async () => {
    const r = await t.eval(async ()=>{
      await SEED_FN();
      openBusinessForm();
      const body = document.querySelector('.modal-body');
      const grid = body.querySelector('.dbt-entry .field-grid');
      /* What a person actually meets. A box that only a monthly
         investment asks for is on the sheet but hidden until the
         transaction type says so, and counting it here would say the
         sheet asks more than it does. */
      const shown = grid ? Array.from(grid.querySelectorAll(':scope > .field'))
        .filter(el=>el.style.display !== 'none') : [];
      const boxes = shown.length;
      /* Side by side is a measurable thing: the fields do not all
         share a left edge. */
      const lefts = shown.map(el=>Math.round(el.getBoundingClientRect().left));
      const columns = Array.from(new Set(lefts)).length;
      const wide = document.getElementById('modalBody').classList.contains('wide');
      const out = {boxes, columns, wide, sections: document.querySelectorAll('.dbt-entry').length,
                   another: /dbtAddAnother/.test(body.innerHTML)};
      closeModal();
      return out;
    });
    if(r.boxes !== 13) throw new Error('the sheet asks ' + r.boxes + ' questions');
    if(r.columns < 3) throw new Error('the fields are in ' + r.columns + ' column(s), so it is still a list');
    if(!r.wide) throw new Error('the dialog did not open wide enough for a grid');
    if(r.sections !== 1) throw new Error('it opened on ' + r.sections + ' sections');
    if(!r.another) throw new Error('there is no Add Another DBT');
    return r.boxes + ' fields across ' + r.columns + ' columns in a wide dialog, with Add Another DBT under it';
  });

  await t.step('adding one keeps what was typed, and takes the answers that repeat', async () => {
    const r = await t.eval(async (cid)=>{
      openBusinessForm();
      const set = (k, i, v)=>{ const el = document.getElementById('f_' + k + '__' + i); if(el) el.value = v; };
      set('clientId', 0, cid);
      set('sourceOfBusiness', 0, cfgLabels('business.sources')[0]);
      set('productCategory', 0, cfgLabels('business.productCategories')[0]);
      set('platform', 0, cfgLabels('alloc.platforms')[0]);
      set('transactionType', 0, 'Purchase');
      set('amount', 0, '1000000');
      dbtAddAnother();
      const get = (k, i)=>(document.getElementById('f_' + k + '__' + i) || {}).value;
      const out = {kept: numVal(get('amount', 0)), second: get('amount', 1),
                   client: get('clientId', 1), platform: get('platform', 1),
                   sections: document.querySelectorAll('.dbt-entry').length,
                   remove: /dbtRemoveRow/.test(document.getElementById('modalBody').innerHTML)};
      window._dbtBatch = null; closeModal();
      return out;
    }, 'CMS-MULTI');
    if(r.kept !== 1000000) throw new Error('the first amount came back as ' + r.kept);
    if(r.second) throw new Error('the new section opened holding "' + r.second + '"');
    if(r.client !== 'CMS-MULTI') throw new Error('the client did not carry across');
    if(!r.platform) throw new Error('the platform did not carry across');
    if(r.sections !== 2) throw new Error(r.sections + ' sections');
    if(!r.remove) throw new Error('neither section can be removed');
    return 'the first keeps its 10,00,000; the second opens on the same client and platform with its own blank amount';
  });

  await t.step('and a sheet cannot be emptied to nothing', async () => {
    const before = t.dialogs.length;
    const r = await t.eval(async ()=>{
      openBusinessForm();
      dbtRemoveRow(0);
      const out = document.querySelectorAll('.dbt-entry').length;
      window._dbtBatch = null; closeModal();
      return out;
    });
    if(r !== 1) throw new Error('the last section was removed, leaving ' + r);
    if(!t.dialogs.slice(before).some(x=>/at least one DBT/.test(String(x))))
      throw new Error('it refused without saying why');
    return 'the last one stays, and says to cancel the sheet instead';
  });

  t.section('four sections, four DBTs, four execution plans');

  let made = null;
  await t.step('each amount lands on its own plan, and none of them pool', async () => {
    made = await t.eval(async (cid)=>{
      await SEED_FN();
      openBusinessForm();
      const cats = cfgLabels('business.productCategories');
      const set = (k, i, v)=>{ const el = document.getElementById('f_' + k + '__' + i); if(el) el.value = v; };
      const amounts = ['1000000','250000','700000','50000'];
      for(let i = 0; i < amounts.length; i++){
        if(i) dbtAddAnother();
        set('clientId', i, cid);
        set('sourceOfBusiness', i, cfgLabels('business.sources')[0]);
        set('productCategory', i, cats[i % cats.length]);
        set('platform', i, cfgLabels('alloc.platforms')[0]);
        set('transactionType', i, 'Purchase');
        set('amount', i, amounts[i]);
      }
      await saveDbtBatch();
      const entries = DB.businessEntries.filter(e=>e.clientId === cid && !e.deletedAt);
      const plans = entries.map(e=>allocationForDbt(e.id));
      const review = (document.querySelector('.modal-body') || {}).textContent || '';
      closeModal();
      return {
        ids: entries.map(e=>e.id),
        amounts: entries.map(e=>numVal(e.amount)),
        cats: entries.map(e=>e.productCategory),
        planIds: plans.map(p=>p && p.id),
        planAmounts: plans.map(p=>p ? allocSchemes(p).reduce((s,l)=>s+numVal(l.amount), 0) : null),
        planDbt: plans.map(p=>p && p.dbtEntryId),
        linkedBack: entries.map(e=>e.recommendationId),
        statuses: entries.map(e=>e.status),
        reviewNamesAll: entries.every(e=>review.indexOf(e.id) >= 0),
        reviewSends: (review.match(/Send for consent/g) || []).length};
    }, 'CMS-MULTI');
    if(made.ids.length !== 4) throw new Error('it wrote ' + made.ids.length + ' entries');
    if(new Set(made.ids).size !== 4) throw new Error('two entries share an id');
    if(made.amounts.join(',') !== '1000000,250000,700000,50000')
      throw new Error('the amounts came out ' + made.amounts.join(', '));
    if(new Set(made.cats).size < 2) throw new Error('every entry took the same category: ' + made.cats.join(', '));
    if(made.planIds.some(x=>!x)) throw new Error('a DBT got no execution plan');
    if(new Set(made.planIds).size !== 4) throw new Error('two DBTs share one plan');
    if(made.planAmounts.join(',') !== made.amounts.join(','))
      throw new Error('the plans hold ' + made.planAmounts.join(', ') + ' against ' + made.amounts.join(', '));
    made.planDbt.forEach((d, i)=>{
      if(d !== made.ids[i]) throw new Error('plan ' + i + ' names ' + d + ', not ' + made.ids[i]);
      if(made.linkedBack[i] !== made.planIds[i]) throw new Error('entry ' + i + ' does not name its plan back');
    });
    if(made.statuses.some(x=>x !== 'Pending from Client Consent'))
      throw new Error('one of them was written on ' + made.statuses.join(', '));
    if(!made.reviewNamesAll) throw new Error('the review step does not list every DBT');
    if(made.reviewSends !== 4) throw new Error('the review offers ' + made.reviewSends + ' ways to send for consent');
    return '4 DBTs → 4 plans → ₹10L / ₹2.5L / ₹7L / ₹50k, each plan naming its own DBT and named back, '
      + 'all four Pending from Client Consent with a Send for consent beside each';
  });

  await t.step('nothing is written if one section is unanswered', async () => {
    const before = t.dialogs.length;
    const r = await t.eval(async (cid)=>{
      const was = DB.businessEntries.filter(e=>e.clientId === cid).length;
      openBusinessForm();
      const set = (k, i, v)=>{ const el = document.getElementById('f_' + k + '__' + i); if(el) el.value = v; };
      [0, 1].forEach(i=>{
        if(i) dbtAddAnother();
        set('clientId', i, cid);
        set('sourceOfBusiness', i, cfgLabels('business.sources')[0]);
        set('productCategory', i, cfgLabels('business.productCategories')[0]);
        set('transactionType', i, 'Purchase');
      });
      set('amount', 0, '100000');          // the second is left blank
      await saveDbtBatch();
      const now = DB.businessEntries.filter(e=>e.clientId === cid).length;
      window._dbtBatch = null; closeModal();
      return {was, now, open: !!window._dbtBatch};
    }, 'CMS-MULTI');
    if(r.now !== r.was)
      throw new Error('it wrote ' + (r.now - r.was) + ' entries from a sheet it should have refused');
    if(!t.dialogs.slice(before).length) throw new Error('it refused without saying anything');
    return 'half a meeting in the system and half in a closed dialog is worse than none: it writes all or nothing';
  });

  t.section('and each one goes on down the chain by itself');

  await t.step('consent on one raises its transactions and leaves the others alone', async () => {
    const r = await t.eval(async (ids)=>{
      /* Put a scheme on the first plan, split across two lines, and
         approve only that one. */
      const first = allocationForDbt(ids[0]);
      const lines = allocSchemes(first);
      lines[0].schemeName = 'ZZ Multi Scheme A';
      lines[0].amount = '600000';
      lines.push(Object.assign(newAllocSchemeLine({productCategory: first.productCategory}),
        {schemeName:'ZZ Multi Scheme B', amount:'400000', mode: lines[0].mode,
         transactionType:'Purchase'}));
      first.schemes = lines;
      first.status = 'Sent to Client';
      first.acceptedAt = new Date().toISOString();
      await save('recommendations');
      await onAllocationAccepted(first);
      const mine = id => txnsForAllocation(id);
      return {
        onFirst: mine(first.id).map(x=>numVal(x.amount)).sort((a,b)=>b-a),
        onOthers: ids.slice(1).map(d=>{
          const p = allocationForDbt(d);
          return {status: p.status, txns: mine(p.id).length};
        }),
        firstStatus: first.status,
        dbtStatus: (DB.businessEntries.find(e=>e.id === ids[0]) || {}).status};
    }, made.ids);
    if(r.onFirst.join(',') !== '600000,400000')
      throw new Error('the approved plan raised ' + (r.onFirst.join(', ') || 'nothing'));
    if(r.onOthers.some(x=>x.txns))
      throw new Error('approving one plan raised transactions on another');
    if(r.onOthers.some(x=>/approved/i.test(x.status)))
      throw new Error('approving one plan approved another: ' + r.onOthers.map(x=>x.status).join(', '));
    return 'the approved plan raised its two lines as two transactions; the other three DBTs are untouched, '
      + 'still waiting on their own consent';
  });

  await t.step('and the three still waiting cannot be moved on', async () => {
    const r = await t.eval(ids=>ids.slice(1).map(d=>{
      const p = allocationForDbt(d);
      return {status: p.status,
              txns: (DB.transactions || []).filter(x=>!x.deletedAt && x.recommendationId === p.id).length};
    }), made.ids);
    if(r.some(x=>x.txns)) throw new Error('a plan with no consent has transactions under it');
    return r.length + ' plans still on ' + Array.from(new Set(r.map(x=>x.status))).join(' / ')
      + ', with no transaction raised under any of them';
  });

  t.section('one link for all of it, and a section to each DBT');
  /* Each step below draws the client's page again before it touches it.
     The suite drives that page inside a signed-in session, where the live
     layer is running, and a redraw landing between two steps replaces it
     with the CRM — so a step that assumed the page was still there failed
     on a loaded machine and nowhere else. A real client's link never
     starts that layer (boot returns at renderPublicDocForm, before
     liveConnect), so this is the harness keeping up with the page rather
     than a guard against anything the product does. */


  let bundle = null;
  await t.step('one link carries every plan, and every plan names it', async () => {
    bundle = await t.eval(async (cid)=>{
      await SEED_FN();
      /* Three DBTs for one client, each with a scheme on its plan. */
      const cats = cfgLabels('business.productCategories');
      const ids = [];
      for(const amt of ['300000','200000','100000']){
        const out = await dbtRaiseEntry({clientId: cid, dbtType:'Investment',
          sourceOfBusiness: cfgLabels('business.sources')[0],
          productCategory: cats[ids.length % cats.length],
          platform: cfgLabels('alloc.platforms')[0],
          transactionType:'Purchase', amount: amt, status: dbtConsentStatus(),
          sourceModule:'Manual', entryMode:'User'});
        const plan = allocationForDbt(out.entry.id);
        allocSchemes(plan)[0].schemeName = 'ZZ Bundle ' + ids.length;
        ids.push(plan.id);
      }
      await save('recommendations');
      const token = uid('DOC');
      await deliverAllocationToClient(ids, {to:'multi@example.com', subject:'ZZ', body:'ZZ', token});
      const link = DB.docLinks.find(l=>l.token === token);
      return {token, ids,
              onLink: link ? (link.allocationIds || []) : [],
              first: link ? link.allocationId : '',
              sentStatuses: ids.map(x=>DB.recommendations.find(y=>y.id===x).status),
              tokens: ids.map(x=>DB.recommendations.find(y=>y.id===x).clientLinkToken),
              links: DB.docLinks.filter(l=>l.allocationIds
                && l.allocationIds.some(a=>ids.indexOf(a) >= 0)).length};
    }, 'CMS-MULTI');
    if(bundle.links !== 1) throw new Error(bundle.links + ' links were made for three plans');
    if(bundle.onLink.join(',') !== bundle.ids.join(','))
      throw new Error('the link carries ' + bundle.onLink.join(', '));
    if(bundle.first !== bundle.ids[0])
      throw new Error('the link does not answer which allocation it is for, so older readers break');
    if(bundle.sentStatuses.some(x=>x !== 'Sent to Client'))
      throw new Error('a plan on the link was not marked sent: ' + bundle.sentStatuses.join(', '));
    if(new Set(bundle.tokens).size !== 1 || bundle.tokens[0] !== bundle.token)
      throw new Error('the three plans do not share the one token');
    return 'one link, three plans on it, each marked Sent to Client and all three holding the same token';
  });

  await t.step('the page is one per DBT, with the disclaimer said once', async () => {
    const r = await t.eval(token=>{
      renderPublicDocForm(token);
      const root = document.getElementById('root');
      const txt = root.textContent || '';
      return {sections: root.querySelectorAll('.alloc-consent-section').length,
              answers: root.querySelectorAll('.plan-answer').length,
              remarks: root.querySelectorAll('textarea[id^="f_allocRemarks_"]').length,
              acks: root.querySelectorAll('#f_discAck').length,
              verified: (txt.match(/Identity Verified/g) || []).length,
              disabled: Array.from(root.querySelectorAll('.plan-answer')).every(b=>b.disabled)};
    }, bundle.token);
    if(r.sections !== 3) throw new Error('the page drew ' + r.sections + ' sections for three plans');
    if(r.answers !== 6) throw new Error(r.answers + ' answer buttons for three plans');
    if(r.remarks !== 3) throw new Error('the sections share ' + r.remarks + ' remarks boxes');
    if(r.acks !== 1) throw new Error('the acknowledgement is asked ' + r.acks + ' times');
    if(r.verified !== 1) throw new Error('the identity line is printed ' + r.verified + ' times');
    if(!r.disabled) throw new Error('an answer was open before the disclosure was acknowledged');
    return 'three sections, three remarks boxes, six answers \u2014 under one identity line and one acknowledgement, all shut until it is ticked';
  });

  await t.step('one tick opens every section, not just the first', async () => {
    const r = await t.eval(()=>{
      const ack = document.getElementById('f_discAck');
      ack.checked = true; planAckChanged();
      return Array.from(document.querySelectorAll('.plan-answer')).filter(b=>!b.disabled).length;
    });
    if(r !== 6) throw new Error('the tick opened ' + r + ' of 6 answers');
    return 'all six, on the one tick';
  });

  await t.step('answering one answers only that one', async () => {
    const r = await t.eval(async (b)=>{
      renderPublicDocForm(b.token);          // see the note above this section
      document.getElementById('f_discAck').checked = true; planAckChanged();
      await submitAllocationDecision(b.token, true, b.ids[1]);
      const root = document.getElementById('root');
      const plans = b.ids.map(id=>DB.recommendations.find(x=>x.id===id));
      const link = DB.docLinks.find(l=>l.token === b.token);
      return {statuses: plans.map(p=>p.status),
              subs: b.ids.map(id=>(DB.docSubmissions || [])
                .filter(x=>x.token === b.token && x.allocationId === id).length),
              sectionsLeft: root.querySelectorAll('.alloc-consent-section').length,
              linkStatus: link.status,
              txns: b.ids.map(id=>txnsForAllocation(id).length)};
    }, bundle);
    if(r.statuses[1] !== 'Client Accepted')
      throw new Error('the answered plan reads ' + r.statuses[1]);
    if(r.statuses[0] === 'Client Accepted' || r.statuses[2] === 'Client Accepted')
      throw new Error('answering one approved another: ' + r.statuses.join(', '));
    if(r.subs.join(',') !== '0,1,0') throw new Error('submissions: ' + r.subs.join(', '));
    if(r.sectionsLeft !== 2) throw new Error(r.sectionsLeft + ' sections still open, not two');
    if(r.linkStatus === 'Answered') throw new Error('the link closed before the other two were answered');
    if(r.txns[1] !== 1) throw new Error('the approved plan raised ' + r.txns[1] + ' transactions');
    if(r.txns[0] || r.txns[2]) throw new Error('an unanswered plan raised a transaction');
    return 'the second approved and raised its transaction; the other two still open on the same live link';
  });

  await t.step('a query on one leaves the rest answerable, and its remark is its own', async () => {
    const r = await t.eval(async (b)=>{
      renderPublicDocForm(b.token);          // see the note above this section
      document.getElementById('f_discAck').checked = true; planAckChanged();
      const box = document.getElementById('f_allocRemarks_' + b.ids[0]);
      box.value = 'ZZ Please show me a lower-risk option.';
      await submitAllocationDecision(b.token, false, b.ids[0]);
      const link = DB.docLinks.find(l=>l.token === b.token);
      const plans = b.ids.map(id=>DB.recommendations.find(x=>x.id===id));
      return {decisions: plans.map(p=>p.clientDecision || ''),
              remarks: plans.map(p=>p.clientRemarks || ''),
              left: document.querySelectorAll('.alloc-consent-section').length,
              linkStatus: link.status};
    }, bundle);
    if(r.decisions[0] !== 'Query') throw new Error('the queried plan reads ' + r.decisions[0]);
    if(r.remarks[1] || r.remarks[2])
      throw new Error('the remark landed on another plan: ' + r.remarks.join(' | '));
    if(!/lower-risk/.test(r.remarks[0])) throw new Error('the remark did not reach its own plan');
    if(r.left !== 1) throw new Error(r.left + ' sections left, not one');
    if(r.linkStatus === 'Answered') throw new Error('the link closed with one section unanswered');
    return 'the first queried with its own words, the third still open, and the link still live for it';
  });

  await t.step('and the link closes only when the last one is answered', async () => {
    const r = await t.eval(async (b)=>{
      renderPublicDocForm(b.token);          // see the note above this section
      document.getElementById('f_discAck').checked = true; planAckChanged();
      await submitAllocationDecision(b.token, true, b.ids[2]);
      const link = DB.docLinks.find(l=>l.token === b.token);
      const txt = document.getElementById('root').textContent || '';
      return {linkStatus: link.status,
              closing: /2 of 3 approved/.test(txt),
              said: /lower-risk/.test(txt),
              open: document.querySelectorAll('.alloc-consent-section').length};
    }, bundle);
    if(r.open) throw new Error(r.open + ' sections are still asking after all three were answered');
    if(!r.closing) throw new Error('the closing page does not say 2 of 3 were approved');
    if(!r.said) throw new Error('the closing page does not repeat what was asked about the first');
    if(r.linkStatus !== 'Answered') throw new Error('the link is still ' + r.linkStatus);
    return '2 of 3 approved, the third quoted back, and only now is the link closed';
  });

  await t.step('nothing was alerted but the two refusals this suite asked for', async () => {
    /* The container has no mail connector, so a send says so and
       hands back the link — which is the behaviour, not a failure. */
    const odd = t.dialogs.filter(x=>!/at least one DBT|Please fill|Enter the amount|No email connector/.test(String(x)));
    if(odd.length) throw new Error('alerts: ' + odd.join(' | ').slice(0, 240));
    return t.dialogs.length + ' pop-up(s), every one of them a refusal this suite provoked';
  });
});
