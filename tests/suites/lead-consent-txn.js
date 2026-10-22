/* A CONSENT A LEAD GAVE IS STILL A CONSENT.

   A Blueprint plan is prepared, agreed and consented to while the
   person is still a lead — conversion comes after, on the business.
   onAllocationAccepted() did not know that. It moved the lead's stage
   on and returned, and everything below that line — the DBT the sheet
   should raise, and the transaction each approved scheme line turns
   into — was never reached.

   What the firm saw: the Execution Tracker reading "Client Accepted"
   against a lead's sheet, and the Transaction Tracker empty.

   Three things are guarded. That a lead's consent now raises the
   transactions a client's always did. That the tracker can say whose
   they are, rather than printing a dash for half its rows. And that
   the sheets already stuck that way are raised by the backfill —
   nobody can approve a consent twice, so a fix that only worked
   going forward would leave the firm's own records broken. */
const {suite} = require('../lib/harness');

/* A lead, an execution plan with two lines, and the link it goes out
   on — the shape FSL's Update DBT leaves behind. */
const SEED = `async function(tag){
  const lid = 'LMS-TXN-' + tag;
  let l = DB.leads.find(x=>x.id === lid);
  if(!l){ l = {id: lid}; DB.leads.push(l); }
  Object.assign(l, {firstName:'ZZ Consent Lead', lastName: tag, mobile:'9800111222',
    email:'zz' + tag + '@example.com', assignedTo: currentUser,
    createdAt:new Date().toISOString()});
  if(!stateOf('LMS', l)) initState('LMS', l);
  DB.recommendations = (DB.recommendations || []).filter(r=>r.leadId !== lid);
  DB.transactions = (DB.transactions || []).filter(t=>t.leadId !== lid);
  const rec = {id: uid('REC'), leadId: lid, clientId: null, status:'Sent to Client',
    productCategory:'Mutual Fund', investmentMode:'SIP', allocType:'Purchase',
    planType:'FSL', planRound:1, planKind:'SIP',
    schemes:[
      Object.assign(newAllocSchemeLine({productCategory:'Mutual Fund'}),
        {schemeName:'ZZ Scheme One', amount:'25000', transactionType:'Purchase'}),
      Object.assign(newAllocSchemeLine({productCategory:'Mutual Fund'}),
        {schemeName:'ZZ Scheme Two', amount:'500000', transactionType:'Purchase'}),
    ],
    attachments:[], createdAt:new Date().toISOString()};
  DB.recommendations.push(rec);
  await save('leads'); await save('recommendations'); await save('transactions');
  const token = uid('DOC');
  DB.docLinks.push({token, type:'ALLOC', recordModule:'LMS', recordId: lid,
    allocationId: rec.id, allocationIds:[rec.id], status:'Active',
    createdAt:new Date().toISOString(),
    expiresAt:new Date(Date.now() + 72*3600*1000).toISOString()});
  await save('docLinks');
  return {lid, rec: rec.id, token};
}`;

suite(async t => {
  await t.home();

  t.section('the lead answers their own execution plan');

  await t.step('approving it raises a transaction for every line', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const b = await (${SEED})('A');
      renderPublicDocForm(b.token);
      document.getElementById('f_discAck').checked = true; planAckChanged();
      await submitAllocationDecision(b.token, true, b.rec);
      const rec = DB.recommendations.find(x=>x.id === b.rec);
      const txns = (DB.transactions || []).filter(x=>x.recommendationId === b.rec);
      return {status: rec.status, decision: rec.clientDecision,
              txns: txns.length,
              amounts: txns.map(x=>Number(x.amount)).sort((a,c)=>a-c),
              lead: txns.every(x=>x.leadId === b.lid),
              lines: txns.every(x=>!!x.allocLineId),
              plan: txns.every(x=>x.planType === 'FSL' && String(x.planRound) === '1'),
              consent: rec.consentReceivedAt || (DB.leads.find(x=>x.id===b.lid)||{}).consentReceivedAt};
    })()`));
    if(r.status !== 'Client Accepted') throw new Error('the sheet reads ' + r.status);
    if(r.txns !== 2)
      throw new Error(r.txns + ' transaction(s) for two approved lines — the tracker would show '
        + (r.txns ? 'half of it' : 'nothing'));
    if(r.amounts.join(',') !== '25000,500000')
      throw new Error('the amounts are ' + r.amounts.join(', '));
    if(!r.lead) throw new Error('a transaction does not say which lead it is for');
    if(!r.lines) throw new Error('a transaction does not name the line it came from');
    if(!r.plan) throw new Error('the blueprint did not travel onto the transactions');
    if(!r.consent) throw new Error('the lead\\u2019s own stage was not told about the consent');
    return 'Client Accepted and two transactions, ₹25,000 and ₹5,00,000, each naming its line, '
         + 'its lead and the blueprint — and the lead’s stage still moved';
  });

  await t.step('and answering twice raises nothing twice', async () => {
    const r = await t.eval(async ()=>{
      const rec = DB.recommendations.find(x=>x.leadId === 'LMS-TXN-A');
      const before = (DB.transactions || []).filter(x=>x.recommendationId === rec.id).length;
      await allocRaiseTransactions(rec);
      await onAllocationAccepted(rec);
      return {before, after: (DB.transactions || []).filter(x=>x.recommendationId === rec.id).length};
    });
    if(r.after !== r.before)
      throw new Error('it went from ' + r.before + ' to ' + r.after + ' transactions');
    return r.before + ' transactions, and running it again leaves ' + r.after;
  });

  await t.step('the tracker says whose they are', async () => {
    const r = await t.eval(()=>{
      const rec = DB.recommendations.find(x=>x.leadId === 'LMS-TXN-A');
      const txn = (DB.transactions || []).find(x=>x.recommendationId === rec.id);
      const html = viewTransactions();
      const d = document.createElement('div'); d.innerHTML = html;
      const text = (d.textContent || '').replace(/\s+/g,' ');
      return {who: txnWhoName(txn), text: text.slice(0, 400),
              empty: /No transactions yet/.test(text)};
    });
    if(r.empty) throw new Error('the Transaction Tracker still says there are none');
    if(!/ZZ Consent Lead A \(Lead\)/.test(r.who))
      throw new Error('the transaction reads "' + r.who + '"');
    if(r.text.indexOf('ZZ Consent Lead A') < 0)
      throw new Error('the lead is not named on the tracker: ' + r.text);
    return 'the tracker lists them under "' + r.who + '" instead of a dash';
  });

  t.section('the sheets already stuck that way');

  await t.step('the backfill raises what the old code never did', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const b = await (${SEED})('B');
      /* A sheet accepted the way the old code left it: answered, with
         no transaction behind any of its lines. */
      const rec = DB.recommendations.find(x=>x.id === b.rec);
      rec.status = 'Client Accepted';
      rec.clientDecision = 'Approved';
      rec.acceptedAt = new Date().toISOString();
      await save('recommendations');
      const before = (DB.transactions || []).filter(x=>x.recommendationId === b.rec).length;
      const made = await migrateConsentTransactions();
      const after = (DB.transactions || []).filter(x=>x.recommendationId === b.rec);
      /* Twice is once. */
      const again = await migrateConsentTransactions();
      return {before, made, after: after.length, again,
              lead: after.every(x=>x.leadId === b.lid),
              amounts: after.map(x=>Number(x.amount)).sort((a,c)=>a-c)};
    })()`));
    if(r.before) throw new Error('the fixture already had ' + r.before + ' transactions');
    if(r.after !== 2) throw new Error('the backfill left ' + r.after + ' transactions, not two');
    if(r.amounts.join(',') !== '25000,500000') throw new Error('amounts: ' + r.amounts.join(', '));
    if(!r.lead) throw new Error('the backfilled transactions do not name the lead');
    if(r.again) throw new Error('it raised ' + r.again + ' more on a second run');
    return 'a sheet stuck on Client Accepted with nothing behind it gets its two transactions, once';
  });

  await t.step('and it invents nothing for a sheet nobody answered', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const b = await (${SEED})('C');
      const made = await migrateConsentTransactions();
      return {made, txns: (DB.transactions || []).filter(x=>x.recommendationId === b.rec).length};
    })()`));
    if(r.txns) throw new Error('it raised ' + r.txns + ' for a sheet still with the client');
    return 'a sheet still out for consent is left exactly as it is';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
