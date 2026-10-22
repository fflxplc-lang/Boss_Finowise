/* ONE CHAIN, FOUR RECORDS, NO RE-TYPING.

   Business that is not a Blueprint plan arrives one of two ways — a
   client rings up, or it is agreed in a review — and from either one
   it runs the same course:

     DBT entry → Asset Allocation → client consent → Transaction

   A Blueprint plan reaches the same place by its own road: its
   execution plan goes for consent, and consent raises both the DBT
   entry and the transaction together, from the approved sheet.

   What has to hold, or the whole thing is worse than four separate
   screens: every record names the one before it, nothing is typed
   twice, and nothing is written twice. The guards are on the links
   rather than on a flag somebody could clear, so a refreshed page, a
   re-sent consent mail and a double press all land on the same
   record.

   And the last link: a transaction marked complete is business the
   firm has done, so the DBT entry says so — once. AUM and SIP need no
   adjusting, because BOSS keeps no running total to adjust: they are
   summed from the completed transactions every time they are asked,
   which is the only arrangement that cannot be double counted. */
const {suite} = require('../lib/harness');

const SEED = async ()=>{
  DB.config.alloc = Object.assign({}, DB.config.alloc);
  DB.config.settings = DB.config.settings || {};
  let c = DB.clients.find(x=>x.id === 'CMS-CHAIN');
  if(!c){ c = {id:'CMS-CHAIN'}; DB.clients.push(c); }
  Object.assign(c, {cmsName:'ZZ Chain Client', mobile:'9800123456', email:'chain@example.com',
    rmName: currentUser, branch:'Varanasi', clientCategory:'A',
    createdAt:new Date().toISOString()});
  if(!stateOf('CMS', c)) initState('CMS', c);
  DB.businessEntries = (DB.businessEntries || []).filter(e=>!/^DBT-/.test(e.id || '') || e.clientId !== 'CMS-CHAIN');
  DB.recommendations = (DB.recommendations || []).filter(r=>r.clientId !== 'CMS-CHAIN');
  DB.transactions = (DB.transactions || []).filter(t=>t.clientId !== 'CMS-CHAIN');
  await save('clients'); await save('businessEntries');
  await save('recommendations'); await save('transactions');
  return c.id;
};

suite(async t => {
  let id = 'CMS-CHAIN';

  t.section('the form the firm asked for');

  /* The nine the firm wrote down, in the order they wrote them. The
     list is asserted whole rather than by presence: a tenth question
     creeping back onto a form the firm trimmed is the failure this
     step exists to catch. */
  /* The firm's own list, with the two boxes a monthly investment adds
     after the amount. They are asked only when the transaction type
     says monthly, which the SIP suite checks; here they have to be in
     the list and in their place. */
  const DBT_FORM = ['dbtType','clientId','leadId','sourceOfBusiness','productCategory',
    'platform','transactionType','executionDate','amount','sipStartDate','sipTenure','status'];

  await t.step('the form asks what the firm wrote down, in that order', async () => {
    const r = await t.eval(()=>{
      const keys = BUSINESS_FIELDS.map(f=>f.k);
      const labels = BUSINESS_FIELDS.map(f=>f.l);
      const dupes = keys.filter((k, i)=>keys.indexOf(k) !== i);
      return {keys, labels, dupes,
              all: BUSINESS_ALL_FIELDS.map(f=>f.k),
              statuses: cfgLabels('business.statuses'),
              txnStatuses: cfgLabels('business.transactionStatuses'),
              consent: dbtConsentStatus(), start: txnStartStatus()};
    });
    if(r.keys.join(',') !== DBT_FORM.join(','))
      throw new Error('the form reads ' + r.keys.join(', '));
    if(r.dupes.length) throw new Error('asked twice: ' + r.dupes.join(', '));
    if(r.keys.indexOf('product') >= 0)
      throw new Error('Product and Investment Category are both still on the form');
    if(r.labels.indexOf('Investment Category') < 0)
      throw new Error('the category is not labelled as the firm names it');
    if(r.labels.indexOf('Client / Lead Name') < 0)
      throw new Error('the name field is not labelled as the firm names it');
    /* Trimmed from the raise form, not from the record: the module's
       own form still edits all three, or an entry written before this
       change could never have its folio corrected. */
    ['folioNumber','loggedDate','remarks'].forEach(k=>{
      if(r.keys.indexOf(k) >= 0) throw new Error(k + ' is still asked when business is raised');
      if(r.all.indexOf(k) < 0) throw new Error(k + ' fell out of the record altogether');
    });
    if(r.consent !== 'Pending from Client Consent')
      throw new Error('a new entry starts on "' + r.consent + '"');
    if(r.start !== 'Not Started') throw new Error('a new transaction starts on "' + r.start + '"');
    return 'the firm\u2019s nine in order (and the two a monthly investment adds), '
      + 'folio/logged/remarks off the raise form but still on the record';
  });

  await t.step('both raise forms open on Pending from Client Consent', async () => {
    id = await t.eval(SEED);
    const r = await t.eval(async (cid)=>{
      /* The sheet can hold several DBTs now, so every box carries the
         number of the section it belongs to. The first is __0. */
      openCmsDbtModal(cid);
      const cms = {status: (document.getElementById('f_status__0')||{}).value,
                   name: (document.getElementById('derived_clientId__0')||{}).value,
                   asked: !document.getElementById('f_clientId__0'),
                   exec: (document.getElementById('f_executionDate__0')||{}).value,
                   noFolio: !document.getElementById('f_folioNumber__0'),
                   noLogged: !document.getElementById('f_loggedDate__0'),
                   noRemarks: !document.getElementById('f_remarks__0'),
                   sections: document.querySelectorAll('.dbt-entry').length,
                   another: /dbtAddAnother/.test(document.getElementById('modalBody').innerHTML)};
      closeModal();
      return cms;
    }, id);
    if(r.status !== 'Pending from Client Consent')
      throw new Error('the Fresh DBT form opens on "' + r.status + '"');
    if(!r.name) throw new Error('the client name is not shown on the form');
    if(!r.asked) throw new Error('the profile\'s own client is a picker, so it can be mis-filed');
    if(!r.exec) throw new Error('the execution date opens blank');
    if(!r.noFolio || !r.noLogged || !r.noRemarks)
      throw new Error('a trimmed field is still on the Fresh DBT form');
    if(r.sections !== 1) throw new Error('it opened on ' + r.sections + ' sections, not one');
    if(!r.another) throw new Error('there is no way to add a second DBT to the sheet');
    return 'shows ' + r.name + ', status Pending from Client Consent, execution date filled, '
      + 'one section and a way to add another';
  });

  t.section('CMS — business straight from the client');

  await t.step('the profile offers it, and saving writes both records', async () => {
    id = await t.eval(SEED);
    const r = await t.eval(async (cid)=>{
      const shell = JSON.stringify(viewClientDetail(cid));
      const onProfile = shell.indexOf('openCmsDbtModal') >= 0;
      const freshLabel = shell.indexOf('+ Fresh DBT') >= 0;
      /* The quick row used to offer a bare allocation, which skipped the
         DBT entirely. Business from the profile starts at the DBT now. */
      const bareAlloc = shell.indexOf('New Asset Allocation') >= 0;
      openCmsDbtModal(cid);
      const asked = BUSINESS_FIELDS.filter(f=>f.k !== 'leadId' && f.k !== 'clientId')
        .every(f=>!!document.getElementById('f_' + f.k + '__0'));
      const set = (k, v)=>{ const el = document.getElementById('f_' + k + '__0'); if(el) el.value = v; };
      set('dbtType','Investment'); set('sourceOfBusiness','CMS');
      set('productCategory', cfgLabels('business.productCategories')[0]);
      set('platform', cfgLabels('alloc.platforms')[0]);
      set('transactionType','Purchase'); set('amount','500000');
      set('executionDate', new Date().toISOString().slice(0,10));
      set('status', dbtConsentStatus());
      await saveDbtBatch();
      closeModal();
      const entry = (DB.businessEntries || []).filter(e=>e.clientId === cid && !e.deletedAt).pop();
      const rec = entry ? allocationForDbt(entry.id) : null;
      return {onProfile, asked, entry: entry ? {id:entry.id, amount:entry.amount, status:entry.status,
                source:entry.sourceOfBusiness, mod:entry.sourceModule, rec:entry.recommendationId,
                product:entry.product} : null,
              rec: rec ? {id:rec.id, dbt:rec.dbtEntryId, amount:(allocSchemes(rec)[0]||{}).amount} : null,
              freshLabel, bareAlloc};
    }, id);
    if(!r.onProfile) throw new Error('the client profile has no way into the DBT');
    if(!r.freshLabel) throw new Error('the quick row does not offer "+ Fresh DBT"');
    if(r.bareAlloc) throw new Error('the profile still offers a bare allocation, which skips the DBT');
    if(!r.asked) throw new Error('the form did not ask for every field');
    if(!r.entry) throw new Error('no DBT entry was written');
    if(r.entry.status !== 'Pending from Client Consent')
      throw new Error('it was written on "' + r.entry.status + '"');
    if(r.entry.mod !== 'CMS') throw new Error('it is filed under ' + r.entry.mod);
    if(!r.entry.product) throw new Error('the older product field was left blank, so older reports lose it');
    if(!r.rec) throw new Error('no asset allocation was opened under it');
    if(r.rec.dbt !== r.entry.id || r.entry.rec !== r.rec.id)
      throw new Error('the two do not name each other');
    if(Number(r.rec.amount) !== 500000)
      throw new Error('the allocation opened at ' + r.rec.amount + ', not the agreed 5,00,000');
    return 'DBT ' + r.entry.id + ' → allocation ' + r.rec.id + ', same ₹5,00,000, each naming the other';
  });

  await t.step('saving it again does not open a second allocation', async () => {
    const r = await t.eval(async (cid)=>{
      const entry = (DB.businessEntries || []).filter(e=>e.clientId === cid && !e.deletedAt).pop();
      const before = (DB.recommendations || []).filter(x=>x.clientId === cid).length;
      await ensureAllocationFromDbt(entry);
      await ensureAllocationFromDbt(entry);
      return {before, after: (DB.recommendations || []).filter(x=>x.clientId === cid).length};
    }, id);
    if(r.after !== r.before) throw new Error(r.before + ' → ' + r.after + ' allocations');
    return 'one allocation, however many times the entry is saved';
  });

  t.section('consent, and the transaction under it');

  await t.step('approval raises the transaction, Not Started, linked both ways', async () => {
    const r = await t.eval(async (cid)=>{
      const rec = (DB.recommendations || []).filter(x=>x.clientId === cid).pop();
      const line = allocSchemes(rec)[0];
      line.schemeName = 'ZZ Scheme'; line.transactionType = 'Purchase';
      line.productCategory = cfgLabels('business.productCategories')[0];
      rec.status = 'Sent to Client';
      rec.acceptedAt = new Date().toISOString();
      await save('recommendations');
      await onAllocationAccepted(rec);
      const txns = txnsForAllocation(rec.id);
      const entry = dbtEntryForAllocation(rec.id) || dbtEntryOf(rec);
      return {n: txns.length, t0: txns[0] ? {status:txns[0].status, rec:txns[0].recommendationId,
                dbt:txns[0].businessEntryId, amount:txns[0].amount} : null,
              entryId: entry ? entry.id : null,
              dbtCount: (DB.businessEntries||[]).filter(e=>e.clientId===cid && !e.deletedAt).length};
    }, id);
    if(r.n !== 1) throw new Error(r.n + ' transactions from one line');
    if(r.t0.status !== 'Not Started') throw new Error('it starts on "' + r.t0.status + '"');
    if(r.t0.dbt !== r.entryId) throw new Error('the transaction does not name the DBT entry');
    if(r.dbtCount !== 1) throw new Error('consent wrote a second DBT entry: ' + r.dbtCount);
    return 'one transaction, Not Started, naming both the allocation and the DBT entry behind it';
  });

  await t.step('a re-sent consent does not raise a second transaction', async () => {
    const r = await t.eval(async (cid)=>{
      const rec = (DB.recommendations || []).filter(x=>x.clientId === cid).pop();
      await onAllocationAccepted(rec);
      await onAllocationAccepted(rec);
      return {txns: txnsForAllocation(rec.id).length,
              dbts: (DB.businessEntries||[]).filter(e=>e.clientId===cid && !e.deletedAt).length};
    }, id);
    if(r.txns !== 1) throw new Error(r.txns + ' transactions after three approvals');
    if(r.dbts !== 1) throw new Error(r.dbts + ' DBT entries after three approvals');
    return 'three approvals, still one transaction and one DBT entry';
  });

  t.section('completion is business, counted once');

  await t.step('marking it complete recognises the business, and only once', async () => {
    const r = await t.eval(async (cid)=>{
      const txn = (DB.transactions || []).filter(x=>x.clientId === cid).pop();
      const entry = (DB.businessEntries || []).filter(e=>e.clientId === cid && !e.deletedAt).pop();
      const before = {biz: entry.status, aum: clientAum({id:cid})};
      txn.status = txnDoneStatus(); txn.completedDate = new Date().toISOString().slice(0,10);
      await txnRecogniseBusiness(txn, 'In Progress');
      const after = {biz: dbtEntryForAllocation(txn.recommendationId).status,
                     aum: clientAum({id:cid}),
                     by: dbtEntryForAllocation(txn.recommendationId).recognisedByTxnId};
      /* Pressing Save again, and again. */
      await txnRecogniseBusiness(txn, 'In Progress');
      await txnRecogniseBusiness(txn, txnDoneStatus());
      const twice = {aum: clientAum({id:cid}),
                     biz: dbtEntryForAllocation(txn.recommendationId).status};
      return {before, after, twice, amount: numVal(txn.amount)};
    }, id);
    if(r.before.biz === 'Completed') throw new Error('it was already recognised before completion');
    if(r.after.biz !== 'Completed') throw new Error('it was not recognised: ' + r.after.biz);
    if(!r.after.by) throw new Error('and the transaction that caused it was not recorded');
    if(r.after.aum !== r.before.aum + r.amount)
      throw new Error('AUM moved by ' + (r.after.aum - r.before.aum) + ', expected ' + r.amount);
    if(r.twice.aum !== r.after.aum)
      throw new Error('AUM moved again on a repeat: ' + r.after.aum + ' → ' + r.twice.aum);
    return 'recognised once, AUM up by ₹' + r.amount + ', and unmoved by two more presses';
  });

  t.section('Blueprint — consent raises both');

  await t.step('an execution plan with no DBT behind it gets one on approval', async () => {
    const r = await t.eval(async (cid)=>{
      const rec = {id: uid('REC'), clientId: cid, leadId: null, status:'Sent to Client',
        productCategory:'Mutual Fund', allocType:'New Investment', investmentMode:'Lumpsum',
        sourceModule:'Blueprint', acceptedAt: new Date().toISOString(),
        schemes:[{schemeName:'ZZ Plan Scheme', amount:'250000', transactionType:'Purchase',
                  productCategory:'Mutual Fund', platform:'NJ'}],
        createdAt:new Date().toISOString()};
      DB.recommendations.push(rec);
      await save('recommendations');
      await onAllocationAccepted(rec);
      const dbt = dbtEntryForAllocation(rec.id);
      const txns = txnsForAllocation(rec.id);
      /* and again, the way a re-sent consent mail would */
      await onAllocationAccepted(rec);
      return {dbt: dbt ? {id:dbt.id, amount:dbt.amount, src:dbt.sourceOfBusiness,
                mod:dbt.sourceModule, status:dbt.status, rec:dbt.recommendationId} : null,
              txns: txns.length,
              afterTwice: {dbts: (DB.businessEntries||[]).filter(e=>e.recommendationId===rec.id && !e.deletedAt).length,
                           txns: txnsForAllocation(rec.id).length}};
    }, id);
    if(!r.dbt) throw new Error('consent on a Blueprint plan raised no DBT entry');
    if(Number(r.dbt.amount) !== 250000)
      throw new Error('it was raised at ' + r.dbt.amount + ' rather than the approved 2,50,000');
    if(r.dbt.src !== 'Blueprint Plan') throw new Error('its source reads ' + r.dbt.src);
    if(r.dbt.rec !== undefined && r.dbt.status !== 'Pending from Client Consent')
      throw new Error('it was raised on "' + r.dbt.status + '"');
    if(r.txns !== 1) throw new Error(r.txns + ' transactions from one line');
    if(r.afterTwice.dbts !== 1 || r.afterTwice.txns !== 1)
      throw new Error('a second consent duplicated: ' + JSON.stringify(r.afterTwice));
    return 'DBT ' + r.dbt.id + ' at ₹2,50,000 and one transaction, both from the approved plan, '
      + 'and neither duplicated by a second approval';
  });

  t.section('Switch and STP say where the money goes');

  await t.step('To Scheme appears for those two and is enforced', async () => {
    const r = await t.eval(()=>({
      purchase: allocNeedsToScheme({transactionType:'Purchase'}),
      sw: allocNeedsToScheme({transactionType:'Switch'}),
      swOut: allocNeedsToScheme({transactionType:'Switch Out'}),
      stp: allocNeedsToScheme({transactionType:'STP'}),
      stpLong: allocNeedsToScheme({transactionType:'STP (Systematic Transfer Plan)'}),
      redeem: allocNeedsToScheme({transactionType:'Redemption'}),
      shows: allocSchemeLineHtml({transactionType:'Switch', schemeName:'x'}, 0, ['Lumpsum'])
               .indexOf('To Scheme') >= 0,
      hides: allocSchemeLineHtml({transactionType:'Purchase', schemeName:'x'}, 0, ['Lumpsum'])
               .indexOf('To Scheme') >= 0}));
    if(r.purchase || r.redeem) throw new Error('it is asked for on a plain purchase or redemption');
    if(!r.sw || !r.swOut || !r.stp || !r.stpLong)
      throw new Error('it is not asked for on every Switch or STP: ' + JSON.stringify(r));
    if(!r.shows) throw new Error('the line editor does not show it for a Switch');
    if(r.hides) throw new Error('and it shows it for a Purchase');
    return 'asked on Switch, Switch Out, STP and the long form; not on Purchase or Redemption';
  });


  t.section('every line is its own transaction, and its own guard');

  await t.step('three lines raise three, each naming its own', async () => {
    const r = await t.eval(async (cid)=>{
      const rec = {id: uid('REC'), clientId: cid, status:'Sent to Client',
        productCategory:'Mutual Fund', allocType:'New Investment', investmentMode:'Lumpsum',
        acceptedAt: new Date().toISOString(),
        schemes:[{schemeName:'ZZ A', amount:'100000', transactionType:'Purchase'},
                 {schemeName:'ZZ B', amount:'200000', transactionType:'Purchase'},
                 {schemeName:'ZZ C', amount:'300000', transactionType:'Purchase'}],
        createdAt:new Date().toISOString()};
      DB.recommendations.push(rec);
      await save('recommendations');
      await onAllocationAccepted(rec);
      const txns = txnsForAllocation(rec.id);
      const lines = allocSchemes(rec);
      return {recId: rec.id, n: txns.length,
              amounts: txns.map(t=>numVal(t.amount)).sort((a,b)=>a-b),
              everyLineHasId: lines.every(l=>!!l.id),
              oneEach: lines.every(l=>!!txnForAllocLine(l.id)),
              distinct: new Set(txns.map(t=>t.allocLineId)).size};
    }, id);
    if(r.n !== 3) throw new Error('three lines raised ' + r.n + ' transactions');
    if(r.amounts.join(',') !== '100000,200000,300000')
      throw new Error('the amounts came through as ' + r.amounts.join(', '));
    if(!r.everyLineHasId) throw new Error('a line was left with no id');
    if(!r.oneEach) throw new Error('a line has no transaction of its own');
    if(r.distinct !== 3) throw new Error('two transactions name the same line');
    t.state = t.state || {}; t.state.recId = r.recId;
    return 'three lines → three transactions, ₹1L/₹2L/₹3L, one per line and no line shared';
  });

  await t.step('a line added afterwards is raised; the three already placed are not', async () => {
    const r = await t.eval(async (recId)=>{
      const rec = DB.recommendations.find(x=>x.id === recId);
      rec.schemes.push({schemeName:'ZZ D', amount:'400000', transactionType:'Purchase'});
      await save('recommendations');
      await onAllocationAccepted(rec);
      const txns = txnsForAllocation(rec.id);
      return {n: txns.length, amounts: txns.map(t=>numVal(t.amount)).sort((a,b)=>a-b),
              distinct: new Set(txns.map(t=>t.allocLineId)).size};
    }, t.state.recId);
    /* The old sheet-level guard would have raised nothing here, and the
       fourth line would never have been placed. */
    if(r.n !== 4) throw new Error('after adding a fourth line there are ' + r.n + ' transactions');
    if(r.amounts.join(',') !== '100000,200000,300000,400000')
      throw new Error('the amounts read ' + r.amounts.join(', '));
    if(r.distinct !== 4) throw new Error('a line is shared between transactions');
    return 'the fourth line raised ₹4L; the first three were left exactly as they were';
  });

  await t.step('a sheet approved before line ids existed adopts, it does not duplicate', async () => {
    const r = await t.eval(async (cid)=>{
      /* Exactly what is on a firm's books today: a sheet whose lines
         carry no id, and transactions that name the sheet but no line. */
      const rec = {id: uid('REC'), clientId: cid, status:'Client Accepted',
        productCategory:'Mutual Fund', allocType:'New Investment', investmentMode:'Lumpsum',
        acceptedAt: new Date().toISOString(),
        schemes:[{schemeName:'ZZ Old A', amount:'150000', transactionType:'Purchase'},
                 {schemeName:'ZZ Old B', amount:'250000', transactionType:'Purchase'}],
        createdAt:new Date().toISOString()};
      DB.recommendations.push(rec);
      DB.transactions.push({id:uid('TXN'), clientId:cid, recommendationId:rec.id,
        amount:'150000', transactionType:'Purchase', status:'Completed'});
      DB.transactions.push({id:uid('TXN'), clientId:cid, recommendationId:rec.id,
        amount:'250000', transactionType:'Purchase', status:'Completed'});
      await save('recommendations'); await save('transactions');
      const before = txnsForAllocation(rec.id).length;
      await onAllocationAccepted(rec);
      const after = txnsForAllocation(rec.id);
      return {before, n: after.length,
              adopted: after.every(t=>!!t.allocLineId),
              distinct: new Set(after.map(t=>t.allocLineId)).size};
    }, id);
    if(r.before !== 2) throw new Error('the fixture did not take');
    if(r.n !== 2) throw new Error('an old sheet was duplicated: ' + r.before + ' → ' + r.n);
    if(!r.adopted) throw new Error('the old transactions were not adopted onto lines');
    if(r.distinct !== 2) throw new Error('both adopted the same line');
    return 'two old transactions adopted onto their two lines, and nothing raised twice';
  });

  t.section('one name for business the client brings');

  await t.step('the list offers CMS and not Direct Call from Client', async () => {
    const r = await t.eval(async ()=>{
      return {labels: cfgLabels('business.sources'), def: BUSINESS_SOURCES.slice()};
    });
    if(r.def.join(',') !== 'RMS,LMS,CMS')
      throw new Error('the shipped list reads ' + r.def.join(', '));
    if(r.labels.some(l=>/direct call from client/i.test(l)))
      throw new Error('the picker still offers Direct Call from Client');
    if(!r.labels.some(l=>/^cms$/i.test(l))) throw new Error('the picker does not offer CMS');
    return r.labels.join(', ');
  });

  await t.step('a list already in use is brought across, entries and all', async () => {
    const r = await t.eval(async (cid)=>{
      /* Exactly the shape on the firm's books: their own stored list,
         still carrying the old option, and entries filed under it. */
      DB.settings['business.sources'] = {value:[
        {id:'OPT-A', label:'RMS', isActive:true, isArchived:false},
        {id:'OPT-B', label:'LMS', isActive:true, isArchived:false},
        {id:'OPT-C', label:'Direct Call from Client', isActive:true, isArchived:false},
        {id:'OPT-D', label:'CMS', isActive:true, isArchived:false}],
        updatedAt:new Date().toISOString(), updatedBy:'test'};
      const old = {id: uid('DBT'), clientId: cid, dbtType:'Investment',
        sourceOfBusiness:'Direct Call from Client', amount:'100000',
        status:'Not Started', createdAt:new Date().toISOString()};
      DB.businessEntries.push(old);
      await save('settings'); await save('businessEntries');
      const moved = await migrateDirectCallToCms();
      const again = await migrateDirectCallToCms();
      return {moved, again, labels: cfgLabels('business.sources'),
              entry: (DB.businessEntries.find(e=>e.id === old.id) || {}).sourceOfBusiness,
              ids: (DB.settings['business.sources'].value || []).map(x=>x.id)};
    }, id);
    if(!r.moved) throw new Error('the migration did nothing on a list that plainly needed it');
    if(r.again !== 0) throw new Error('it ran a second time: ' + r.again);
    if(r.labels.join(',') !== 'RMS,LMS,CMS')
      throw new Error('the list now reads ' + r.labels.join(', '));
    if(r.entry !== 'CMS') throw new Error('the old entry still says "' + r.entry + '"');
    if(r.ids.indexOf('OPT-D') < 0) throw new Error('the firm\'s own CMS option was the one removed');
    return 'RMS, LMS, CMS — the duplicate gone, its one entry moved to CMS, and a second run a no-op';
  });

  await t.step('a firm with no CMS of its own keeps the id, renamed', async () => {
    const r = await t.eval(async ()=>{
      DB.settings['business.sources'] = {value:[
        {id:'OPT-A', label:'RMS', isActive:true, isArchived:false},
        {id:'OPT-C', label:'Direct Call from Client', isActive:true, isArchived:false}],
        updatedAt:new Date().toISOString(), updatedBy:'test'};
      await save('settings');
      await migrateDirectCallToCms();
      const list = DB.settings['business.sources'].value || [];
      return {labels: list.map(x=>x.label), kept: list.some(x=>x.id === 'OPT-C' && x.label === 'CMS')};
    });
    if(!r.kept) throw new Error('the option was replaced rather than renamed: ' + r.labels.join(', '));
    return 'OPT-C kept its id and its place, reading CMS';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 220));
    return 'none';
  });
});
