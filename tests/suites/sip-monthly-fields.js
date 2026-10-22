/* A MONTHLY INVESTMENT HAS THREE FACTS, AND BOSS CARRIED ONE.

   A SIP is an amount a month, a date the first installment goes out
   and a number of months it runs for. The system held the amount and
   nothing else: nobody could say when a family's SIP starts or when
   it ends, on the plan, on the DBT, on the sheet the client consents
   to or on the transaction a desk places.

   The firm asked for all three wherever a monthly investment is
   created, edited, reviewed or tracked — "across all relevant screens
   rather than fixing only one form".

   The amount is the figure already on the line. A SIP line's amount
   has always been one month of it, which is why every total prints it
   as "/mo", so it is LABELLED as the monthly amount wherever a SIP is
   described rather than asked for again in a second box — two boxes
   holding one promise is how a plan and a transaction come to
   disagree about what a family is paying. That labelling is checked
   here too, because it is the half of the requirement that is easy to
   quietly not do.

   The other two are new, and this follows them the whole way down:

     plan line → execution plan sheet → DBT → transaction
*/
const {suite} = require('../lib/harness');

const LEAD = 'LMS-SIPF';
const SEED = `async function(){
  let l = DB.leads.find(x=>x.id === '${LEAD}');
  if(!l){ l = {id:'${LEAD}'}; DB.leads.push(l); }
  Object.assign(l, {firstName:'ZZ Monthly', lastName:'Money', mobile:'9800222555',
    email:'monthly@example.com', dob:'1990-01-01', assignedTo: currentUser,
    transformationForm:'MULTIGOAL', createdAt:new Date().toISOString(),
    iseqScore:50, iseqMaxScore:100, iseqCategory:'Moderate'});
  if(!stateOf('LMS', l)) initState('LMS', l);
  l.formData = {MULTIGOAL:{name:'ZZ Monthly Money', mobile:'9800222555',
    email:'monthly@example.com', dob:'1990-01-01',
    mg_goals:[{goal:'Car', years:'5', currentValue:'2500000', inflation:'7', returns:'12'}]}};
  l.planRounds = [];
  DB.businessEntries = (DB.businessEntries||[]).filter(b=>b.leadId !== l.id);
  DB.recommendations = (DB.recommendations||[]).filter(r=>r.leadId !== l.id);
  DB.transactions = (DB.transactions||[]).filter(x=>x.leadId !== l.id);
  await save('leads'); await save('businessEntries');
  await save('recommendations'); await save('transactions');
  await markPlanInputSubmitted(l, 'Client');
  const round = await recomputePlan(l);
  round.allocation.lines = [
    {label:'Car', product:'Mutual Fund', platform:'Finowise', transactionType:'Purchase',
     schemeName:'ZZ Bluechip', amount:500000},
    {label:'Car', product:'Mutual Fund', platform:'Finowise', transactionType:'SIP',
     schemeName:'ZZ Flexi', amount:25000, sipStartDate:'2027-04-05', sipTenure:'60'},
  ];
  round.seniorStatus = 'Approved';
  await save('leads');
  return l.id;
}`;

suite(async t => {
  await t.home();
  t.expectConsole(/storage (get|set) failed/);

  t.section('the plan says when the monthly money starts and how long it runs');

  await t.step('the allocation grid asks for both, and only where there is a SIP', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      await (${SEED})();
      const rec = planRecordOf('${LEAD}'), round = latestPlanRound(rec);
      const withSip = planAllocationHtml(rec, round, {});
      /* the same grid on a plan of one-time money only */
      const lump = JSON.parse(JSON.stringify(round));
      lump.allocation.lines = lump.allocation.lines.filter(l=>!allocLineIsSip(l));
      const withoutSip = planAllocationHtml(rec, lump, {});
      const d = document.createElement('div'); d.innerHTML = withSip;
      const heads = Array.from(d.querySelectorAll('th')).map(x=>x.textContent.trim());
      return {heads, start: /f_planSipFrom/.test(withSip), tenure: /f_planSipTenure/.test(withSip),
              onLumpOnly: /f_planSipFrom/.test(withoutSip),
              value: (d.querySelector('[id^=f_planSipFrom]')||{}).value,
              months: (d.querySelector('[id^=f_planSipTenure]')||{}).value};
    })()`));
    if(!r.start || !r.tenure)
      throw new Error('the grid has no boxes for the two: ' + r.heads.join(' | '));
    if(r.onLumpOnly)
      throw new Error('a plan of one-time money is widened by two columns it can never fill');
    if(r.value !== '2027-04-05') throw new Error('the start date reads ' + r.value);
    if(r.months !== '60') throw new Error('the tenure reads ' + r.months);
    return 'two columns — ' + r.heads.filter(h=>/Monthly|Tenure/.test(h)).join(', ')
      + ' — and none on a lumpsum-only plan';
  });

  await t.step('and they survive a save of the line', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const rec = planRecordOf('${LEAD}'), round = latestPlanRound(rec);
      const i = round.allocation.lines.findIndex(allocLineIsSip);
      document.getElementById('root').innerHTML =
        '<input id="f_planSipFrom' + i + '" value="2027-06-01">' +
        '<input id="f_planSipTenure' + i + '" value="36">';
      await setPlanLine('${LEAD}', i);
      const l = latestPlanRound(planRecordOf('${LEAD}')).allocation.lines[i];
      return {from: l.sipStartDate, months: l.sipTenure, amount: l.amount};
    })()`));
    if(r.from !== '2027-06-01') throw new Error('the saved start date reads ' + r.from);
    if(Number(r.months) !== 36) throw new Error('the saved tenure reads ' + r.months);
    if(Number(r.amount) !== 25000) throw new Error('saving the two changed the amount to ' + r.amount);
    return 'start 2027-06-01, tenure 36 months, the amount untouched';
  });

  t.section('and they travel the whole chain');

  await t.step('plan line → DBT → execution plan → transaction', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const rec = planRecordOf('${LEAD}'), round = latestPlanRound(rec);
      const leaves = await planRaiseDbtHierarchy(rec, round);
      const dbt = leaves.find(b=>/SIP/i.test(b.dbtPath || ''));
      const sheet = allocationForDbt(dbt.id);
      /* the adviser names the scheme, the family consents, the desk gets a transaction */
      allocSchemes(sheet).forEach(l=>{ l.schemeName = 'ZZ Flexi'; });
      await save('recommendations');
      await allocRaiseTransactions(sheet);
      const txn = (DB.transactions||[]).filter(x=>x.recommendationId === sheet.id)[0] || {};
      const lump = leaves.find(b=>/Purchase/i.test(b.dbtPath || ''));
      const lumpTxnLine = allocSchemes(allocationForDbt(lump.id))[0] || {};
      return {dbt: {from: dbt.sipStartDate, months: dbt.sipTenure, path: dbt.dbtPath},
              line: {from: (allocSchemes(sheet)[0]||{}).sipStartDate,
                     months: (allocSchemes(sheet)[0]||{}).sipTenure},
              txn: {from: txn.sipStartDate, months: txn.sipTenure, amount: txn.amount},
              lump: {from: lumpTxnLine.sipStartDate || '', months: lumpTxnLine.sipTenure || ''}};
    })()`));
    if(r.dbt.from !== '2027-06-01' || Number(r.dbt.months) !== 36)
      throw new Error('the DBT reads ' + JSON.stringify(r.dbt));
    if(r.line.from !== '2027-06-01' || Number(r.line.months) !== 36)
      throw new Error('the sheet it opened reads ' + JSON.stringify(r.line));
    if(r.txn.from !== '2027-06-01' || Number(r.txn.months) !== 36)
      throw new Error('the transaction reads ' + JSON.stringify(r.txn));
    if(Number(r.txn.amount) !== 25000)
      throw new Error('the transaction is for ' + r.txn.amount + ', not one month of it');
    if(r.lump.from || r.lump.months)
      throw new Error('the one-time business picked up monthly facts: ' + JSON.stringify(r.lump));
    return 'start and tenure on the DBT, the sheet and the transaction — and not on the lumpsum';
  });

  t.section('the forms ask for them, and call the amount what it is');

  await t.step('the DBT sheet shows both boxes once the type is monthly', async () => {
    const r = await t.eval(()=>{
      openDbtBatchForm({clientId:''});
      const wrapFor = k => document.getElementById('fieldwrap_f_' + k + '__0');
      const type = document.getElementById('f_transactionType__0');
      const amountLabel = () => (wrapFor('amount').querySelector('label').textContent || '').trim();
      const shown = k => wrapFor(k) && wrapFor(k).style.display !== 'none';
      type.value = 'Purchase'; applyConditionalFields();
      const lump = {start: shown('sipStartDate'), tenure: shown('sipTenure'), label: amountLabel()};
      type.value = 'SIP'; applyConditionalFields();
      const sip = {start: shown('sipStartDate'), tenure: shown('sipTenure'), label: amountLabel()};
      const req = !!wrapFor('amount').querySelector('.req');
      closeModal();
      return {lump, sip, req};
    });
    if(r.lump.start || r.lump.tenure)
      throw new Error('a purchase is asked for a starting date and a tenure');
    if(!r.sip.start || !r.sip.tenure)
      throw new Error('a SIP is not asked for them either');
    if(!/Monthly Investment Amount/.test(r.sip.label))
      throw new Error('on a SIP the amount box still says “' + r.sip.label + '”');
    if(!/^Amount/.test(r.lump.label))
      throw new Error('on a purchase it says “' + r.lump.label + '”');
    if(!r.req) throw new Error('the amount stopped being required when its label changed');
    return 'hidden on a purchase, both shown on a SIP, and the amount reads “'
      + r.sip.label + '”';
  });

  await t.step('so does the transaction form', async () => {
    const r = await t.eval(()=>{
      openTransactionForm();
      const wrap = k => document.getElementById('fieldwrap_f_' + k);
      const type = document.getElementById('f_transactionType');
      type.value = 'SIP'; applyConditionalFields();
      const out = {start: wrap('sipStartDate').style.display !== 'none',
                   tenure: wrap('sipTenure').style.display !== 'none',
                   label: (wrap('amount').querySelector('label').textContent||'').trim()};
      closeModal();
      return out;
    });
    if(!r.start || !r.tenure) throw new Error('the transaction form does not ask for them');
    if(!/Monthly Investment Amount/.test(r.label))
      throw new Error('its amount box says “' + r.label + '”');
    return 'both boxes, and the amount reads “' + r.label + '”';
  });

  await t.step('and the execution plan sheet asks on the scheme line itself', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const rec = planRecordOf('${LEAD}'), round = latestPlanRound(rec);
      const dbt = planDbtsFor('${LEAD}', round.n).find(b=>/SIP/i.test(b.dbtPath||''));
      openRecommendationForm(allocationForDbt(dbt.id).id);
      const body = document.querySelector('#modalBody .modal-body') || document.body;
      const txt = (body.textContent || '').replace(/\\s+/g, ' ');
      const out = {monthlyLabel: /Monthly Investment Amount/.test(txt),
                   start: /Monthly Investment Starting Date/.test(txt),
                   tenure: /Investment Tenure/.test(txt),
                   says: /60 months|36 months|3 years|5 years/.test(txt)};
      closeModal();
      return out;
    })()`));
    if(!r.monthlyLabel) throw new Error('the amount on a SIP line is not called the monthly amount');
    if(!r.start || !r.tenure) throw new Error('the line does not ask for the start date and the tenure');
    return 'the SIP line asks for all three, and reads the tenure back in years';
  });

  t.section('and the family is told');

  await t.step('the consent document carries them on the monthly line', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const rec = planRecordOf('${LEAD}'), round = latestPlanRound(rec);
      const dbt = planDbtsFor('${LEAD}', round.n).find(b=>/SIP/i.test(b.dbtPath||''));
      const sheet = allocationForDbt(dbt.id);
      const d = document.createElement('div');
      d.innerHTML = allocationDocHtml(sheet, {noDisclaimer:true});
      return {txt: (d.textContent || '').replace(/\\s+/g, ' ')};
    })()`));
    if(!/Monthly/.test(r.txt)) throw new Error('the document does not say it is monthly');
    if(!/from 01 Jun 2027|from 1 Jun 2027|Jun 2027/.test(r.txt))
      throw new Error('the document does not say when it starts');
    if(!/36 months/.test(r.txt))
      throw new Error('the document does not say how long it runs for');
    return 'the client reads the monthly amount, the start date and the tenure';
  });
});
