/* ONE MAIN TRANSACTION PER CONSENT.

   A consolidated consent covers a whole family of products — two
   sheets, two platforms, four schemes — and the tracker showed it as
   four unrelated rows with nothing saying they were one decision. The
   firm asked for one record per consent request, carrying what that
   consent comes to, which opens into the breakdown underneath it:

     Mutual Fund     platform → transaction type → scheme
     Wealth Product  product → platform → transaction type → scheme

   What it must NOT become is a second place the work happens, or a
   second copy of the money. So this checks three things in particular:

     · the Main is raised once per consent, however many sheets are
       answered under it and however often they are answered;
     · it carries no money in the field every total in BOSS sums, so
       the family's investment cannot land in the AUM twice;
     · each scheme transaction underneath is the record it always was,
       placed and allotted through the same four moves, and the Main
       follows them rather than leading them.
*/
const {suite} = require('../lib/harness');

const LEAD = 'LMS-MAINT';
const SEED = `async function(){
  let l = DB.leads.find(x=>x.id === '${LEAD}');
  if(!l){ l = {id:'${LEAD}'}; DB.leads.push(l); }
  Object.assign(l, {firstName:'ZZ Main', lastName:'Txn', mobile:'9800222888',
    email:'maintxn@example.com', dob:'1985-05-05', assignedTo: currentUser,
    transformationForm:'MULTIGOAL', createdAt:new Date().toISOString(),
    iseqScore:50, iseqMaxScore:100, iseqCategory:'Moderate'});
  if(!stateOf('LMS', l)) initState('LMS', l);
  l.formData = {MULTIGOAL:{name:'ZZ Main Txn', mobile:'9800222888', email:'maintxn@example.com',
    dob:'1985-05-05', mg_goals:[{goal:'Car', years:'5', currentValue:'2500000',
                                 inflation:'7', returns:'12'}]}};
  l.planRounds = [];
  DB.businessEntries = (DB.businessEntries||[]).filter(b=>b.leadId !== l.id);
  DB.recommendations = (DB.recommendations||[]).filter(r=>r.leadId !== l.id);
  DB.transactions = (DB.transactions||[]).filter(x=>x.leadId !== l.id);
  DB.docLinks = (DB.docLinks||[]).filter(x=>x.leadId !== l.id);
  await save('leads'); await save('businessEntries'); await save('recommendations');
  await save('transactions'); await save('docLinks');
  await markPlanInputSubmitted(l, 'Client');
  const round = await recomputePlan(l);
  round.allocation.lines = [
    {label:'Car', product:'Mutual Fund', platform:'Finowise', transactionType:'Purchase',
     schemeName:'ZZ Bluechip', amount:800000},
    {label:'Car', product:'Mutual Fund', platform:'Ametra', transactionType:'SIP',
     schemeName:'ZZ Flexi', amount:30000, sipStartDate:'2027-05-01', sipTenure:'48'},
    {label:'Car', product:'PMS', platform:'Ametra', transactionType:'Purchase',
     schemeName:'ZZ PMS One', amount:5000000},
  ];
  round.seniorStatus = 'Approved';
  await save('leads');
  const rec = planRecordOf(l.id);
  await planRaiseDbtHierarchy(rec, latestPlanRound(rec));
  /* the adviser maps every sheet: two schemes on the funds purchase,
     one on each of the others, so a platform really does hold more
     than one scheme underneath the consent */
  const roundN = latestPlanRound(rec).n;
  for(const sh of allocLeavesFor(l.id, roundN, null)){
    allocSchemes(sh).forEach(x=>{ x.schemeName = 'ZZ ' + (sh.dbtPath||'').replace(/\\//g,' '); });
  }
  const purchase = allocLeavesFor(l.id, roundN, 'Mutual Fund')
    .find(x=>/Purchase/i.test(x.dbtPath||''));
  const first = allocSchemes(purchase)[0];
  first.amount = String(numVal(first.amount) - 300000);
  allocSchemes(purchase).push(Object.assign(allocLineCommon(first), {
    schemeName:'ZZ Second Fund', amount:'300000', platform:'Finowise'}));
  await save('recommendations');
  return roundN;
}`;

/* Send a category's consent without the compose window, then answer
   every section of it as the client does. */
const CONSENT = `async function(category){
  const roundN = latestPlanRound(planRecordOf('${LEAD}')).n;
  const sheets = allocLeavesFor('${LEAD}', roundN, category);
  const token = uid('DOC');
  await deliverAllocationToClient(sheets.map(x=>x.id),
    {to:'maintxn@example.com', subject:'ZZ', body:'ZZ', token});
  renderPublicDocForm(token);
  document.getElementById('f_discAck').checked = true; planAckChanged();
  for(const sh of sheets){
    renderPublicDocForm(token);
    document.getElementById('f_discAck').checked = true; planAckChanged();
    await submitAllocationDecision(token, true, sh.id);
  }
  return token;
}`;

const SHAPE = `function(){
  const mine = (DB.transactions||[]).filter(t=>!t.deletedAt && t.leadId === '${LEAD}');
  return {
    mains: mine.filter(txnIsMain).map(m=>({id:m.id, cat:m.dbtCategory, token:m.consentToken,
      head:m.headRecommendationId, amount:m.amount, lump:m.lumpAmount, sip:m.sipAmount,
      status:m.status, stage: txnStage(m), label: txnAmountLabel(m),
      kids: txnChildren(m).length})).sort((a,b)=>String(a.cat).localeCompare(String(b.cat))),
    kids: txnBusinessOnly(mine).map(t=>({id:t.id, main:t.mainTransactionId || '',
      scheme:t.schemeName || '', platform:t.platform, type:t.transactionType,
      amount:Number(t.amount), stage: txnStage(t)})),
  };
}`;

suite(async t => {
  await t.home();
  t.expectConsole(/storage (get|set) failed/);

  t.section('the consent becomes one record, not four');

  await t.step('approving every sheet of a category raises one Main transaction', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      await (${SEED})();
      const token = await (${CONSENT})('Mutual Fund');
      const s = (${SHAPE})();
      return {token, mains: s.mains, kids: s.kids};
    })()`));
    if(r.mains.length !== 1)
      throw new Error(r.mains.length + ' Main transactions for one consent');
    const m = r.mains[0];
    if(m.cat !== 'Mutual Fund') throw new Error('the Main says it covers ' + m.cat);
    if(m.token !== r.token) throw new Error('it is not tied to the consent that made it');
    if(!m.head) throw new Error('it does not point back at the Main execution plan');
    if(m.kids !== 3)
      throw new Error(m.kids + ' scheme transactions under it, expected 3 (two funds and a SIP)');
    const loose = r.kids.filter(k=>!k.main);
    if(loose.length) throw new Error(loose.length + ' scheme transactions hang off nothing');
    return 'one Main over ' + m.kids + ' scheme transactions, on consent ' + m.token;
  });

  await t.step('it says what the consent comes to, and holds none of it', async () => {
    const r = await t.eval(new Function(`return (${SHAPE})()`));
    const m = r.mains[0];
    /* 5,00,000 + 3,00,000 of one-time money, and 30,000 a month */
    if(Number(m.lump) !== 800000) throw new Error('the one-time total reads ' + m.lump);
    if(Number(m.sip) !== 30000) throw new Error('the monthly total reads ' + m.sip);
    if(Number(m.amount) !== 0)
      throw new Error('the Main carries ' + m.amount + ' in the field every total sums, '
        + 'so this consent is counted twice');
    if(!/8,00,000/.test(m.label) || !/30,000\/mo/.test(m.label))
      throw new Error('it reads “' + m.label + '”');
    return 'it reads ' + m.label + ' and sums as zero';
  });

  await t.step('so the AUM and the SIP book are not doubled', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      /* every scheme under the consent completed, the way a desk completes them */
      const main = (DB.transactions||[]).find(t=>txnIsMain(t) && t.leadId === '${LEAD}');
      const kids = txnChildren(main);
      for(const k of kids){
        k.clientId = 'CMS-MAINT';
        k.status = txnDoneStatus(); k.allottedAt = new Date().toISOString();
      }
      main.clientId = 'CMS-MAINT';
      await mainTxnRoll(main);
      await save('transactions');
      let c = DB.clients.find(x=>x.id === 'CMS-MAINT');
      if(!c){ c = {id:'CMS-MAINT', cmsName:'ZZ Main Client', rmName: currentUser}; DB.clients.push(c); }
      await save('clients');
      return {aum: clientAum(c), sip: clientActiveSip(c), status: main.status,
              lump: Number(main.lumpAmount)};
    })()`));
    /* 8,00,000 of one-time money and the 30,000 SIP, each once */
    if(r.aum !== 830000) throw new Error('the AUM reads ' + r.aum + ', not 8,30,000');
    if(r.sip !== 30000) throw new Error('the SIP book reads ' + r.sip);
    if(r.status !== 'Completed') throw new Error('the Main did not follow its children: ' + r.status);
    return 'AUM ' + r.aum + ', SIP ' + r.sip + ' — each counted once, and the Main reads Completed';
  });

  t.section('the tracker shows the consent, and opens into the whole of it');

  await t.step('one row per consent, and none of its schemes beside it', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      /* put them back where a desk would find them, unplaced */
      const main = (DB.transactions||[]).find(t=>txnIsMain(t) && t.leadId === '${LEAD}');
      for(const k of txnChildren(main)){
        k.status = txnStartStatus(); delete k.allottedAt; delete k.placedAt;
      }
      await mainTxnRoll(main);
      await save('transactions');
      txnDetailId = null; navigate('transactions');
      const cells = Array.from(document.querySelectorAll('#txnTable tbody tr, .txn-card'))
        .map(el=>el.textContent || '');
      const on = id => cells.some(c=>c.indexOf(id) >= 0);
      const kidIds = txnChildren(main).map(k=>k.id);
      return {main: main.id, rows: cells.length, kidsListed: kidIds.filter(on),
              mainListed: on(main.id),
              text: (document.getElementById('root').textContent || '').replace(/\\s+/g,' ')};
    })()`));
    if(!r.mainListed) throw new Error('the consent is not on the tracker at all');
    if(r.kidsListed.length)
      throw new Error('its schemes are listed beside it: ' + r.kidsListed.join(', '));
    if(!/one consent/.test(r.text))
      throw new Error('nothing on the row says it is a consent rather than a transaction');
    return 'the consent is listed, and none of its schemes is listed beside it ('
      + r.rows + ' rows in all)';
  });

  await t.step('opening it gives platform → transaction type → scheme', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const main = (DB.transactions||[]).find(t=>txnIsMain(t) && t.leadId === '${LEAD}');
      const kids = txnChildren(main);
      /* what the data says the breakdown should come to, so this reads
         the grouping rather than a number typed into the test */
      const want = {
        platforms: new Set(kids.map(k=>k.platform || '—')).size,
        pairs: new Set(kids.map(k=>(k.platform||'') + '|' + (k.transactionType||''))).size,
      };
      openTransactionCard(main.id);
      const root = document.getElementById('root');
      const txt = (root.textContent || '').replace(/\\s+/g, ' ');
      return {txt, want, rows: root.querySelectorAll('tbody tr').length,
              platforms: (txt.match(/Platform:/g) || []).length,
              types: (txt.match(/Transaction type:/g) || []).length,
              product: /Product:/.test(txt)};
    })()`));
    if(r.platforms !== r.want.platforms)
      throw new Error('it groups by ' + r.platforms + ' platforms, and the consent covers '
        + r.want.platforms);
    if(r.types !== r.want.pairs)
      throw new Error('it shows ' + r.types + ' transaction-type groups under them, and the consent '
        + 'has ' + r.want.pairs + ' platform-and-type pairs');
    if(r.product) throw new Error('a mutual fund consent is grouped by product, which it has none of');
    if(r.rows < 3) throw new Error('only ' + r.rows + ' scheme rows under the breakdown');
    if(!/ZZ Second Fund/.test(r.txt))
      throw new Error('a scheme on the consent is missing from the breakdown');
    return r.platforms + ' platforms, ' + r.types + ' transaction types, ' + r.rows + ' scheme rows';
  });

  await t.step('a wealth product consent has its product above the platform', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      await (${CONSENT})('Wealth Product');
      const main = (DB.transactions||[]).filter(t=>txnIsMain(t) && t.leadId === '${LEAD}')
        .find(t=>t.dbtCategory === 'Wealth Product');
      openTransactionCard(main.id);
      const txt = (document.getElementById('root').textContent || '').replace(/\\s+/g, ' ');
      return {found: !!main, product: /Product: PMS/.test(txt),
              platform: /Platform: Ametra/.test(txt), txt: txt.slice(0, 400),
              mains: (DB.transactions||[]).filter(t=>txnIsMain(t) && t.leadId === '${LEAD}').length};
    })()`));
    if(!r.found) throw new Error('the wealth consent raised no Main transaction');
    if(r.mains !== 2) throw new Error(r.mains + ' Main transactions for two consents');
    if(!r.product) throw new Error('the wealth breakdown does not lead with the product');
    if(!r.platform) throw new Error('the platform is missing under the product');
    return 'product → platform → transaction type → scheme, and two Mains for two consents';
  });

  t.section('the work still happens on the scheme, and the parent follows');

  await t.step('placing and allotting a scheme moves the Main with it', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const main = (DB.transactions||[]).filter(t=>txnIsMain(t) && t.leadId === '${LEAD}')
        .find(t=>t.dbtCategory === 'Mutual Fund');
      const kids = txnChildren(main);
      const before = txnStage(main);
      /* one of three placed: the consent is not "placed" while two are not */
      openTxnPlace(kids[0].id);
      document.getElementById('f_txnRef').value = 'REF-ONE';
      await txnMarkPlaced(kids[0].id);
      const partway = {main: txnStage(main), kid: txnStage(kids[0]),
                       ref: txnReference(kids[0]), status: main.status};
      for(let i = 1; i < kids.length; i++){
        openTxnPlace(kids[i].id);
        document.getElementById('f_txnRef').value = 'REF-' + i;
        await txnMarkPlaced(kids[i].id);
      }
      const allPlaced = txnStage(main);
      for(const k of kids){
        openTxnAllot(k.id);
        await txnMarkAllotted(k.id);
      }
      return {before, partway, allPlaced, allAllotted: txnStage(main),
              status: main.status, attempts: kids.map(k=>(k.attempts||[]).length),
              amount: main.amount};
    })()`));
    if(r.before !== 'notStarted') throw new Error('the Main started at ' + r.before);
    if(r.partway.kid !== 'placed') throw new Error('the scheme itself did not move: ' + r.partway.kid);
    if(r.partway.ref !== 'REF-ONE') throw new Error('its reference reads ' + r.partway.ref);
    if(r.partway.main !== 'notStarted')
      throw new Error('one of three placed moved the consent to ' + r.partway.main);
    if(r.allPlaced !== 'placed') throw new Error('all three placed left the consent at ' + r.allPlaced);
    if(r.allAllotted !== 'allotted')
      throw new Error('all three allotted left the consent at ' + r.allAllotted);
    if(r.status !== 'Completed') throw new Error('its status reads ' + r.status);
    if(r.attempts.some(n=>n !== 1))
      throw new Error('the attempts on the schemes read ' + r.attempts.join(', '));
    if(Number(r.amount) !== 0) throw new Error('the Main picked up money of its own: ' + r.amount);
    return 'one placed → still Not Started; all placed → Placed; all allotted → Allotted and Completed';
  });

  await t.step('and nothing is raised twice when the work is repeated', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const before = (${SHAPE})();
      const roundN = latestPlanRound(planRecordOf('${LEAD}')).n;
      for(const sh of allocLeavesFor('${LEAD}', roundN, null)) await allocRaiseTransactions(sh);
      for(const sh of allocLeavesFor('${LEAD}', roundN, null)) await onAllocationAccepted(sh);
      const after = (${SHAPE})();
      return {mainsBefore: before.mains.length, mainsAfter: after.mains.length,
              kidsBefore: before.kids.length, kidsAfter: after.kids.length};
    })()`));
    if(r.mainsAfter !== r.mainsBefore)
      throw new Error(r.mainsBefore + ' Mains became ' + r.mainsAfter);
    if(r.kidsAfter !== r.kidsBefore)
      throw new Error(r.kidsBefore + ' scheme transactions became ' + r.kidsAfter);
    return 'raising and accepting it all again: still ' + r.mainsAfter + ' Mains and '
      + r.kidsAfter + ' scheme transactions';
  });
});
