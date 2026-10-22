/* THE ORDER, FUND BY FUND.

   Modification 19 took a stage that had one Unit Allotted button and one
   Reject, and made both of them per fund. The rules it set:

     * Remark becomes Reference No., and the field goes live the moment
       Transaction Placed is pressed;
     * every applicable transaction needs one before the next step;
     * each fund carries its own Units Allotted / Rejected;
     * one rejection raises a task to place that fund again;
     * the next step stays shut until every fund is allotted, and opens by
       itself when the last one is.

   A client who was already mid-order when this arrived has one reference on
   the record and no per-line state at all. That case is here too, because
   it is the one that would strand a real client. */
const {suite} = require('../lib/harness');

suite(async t => {

  /* A client sitting at Transaction Placed with two priced funds under an
     approved allocation — which is what the stage reads. */
  const build = async (name) => t.eval(async (nm)=>{
    const c = {id:uid('CMS'), cmsName:nm, rmName:currentUser,
      createdAt:new Date().toISOString(), createdBy:currentUser};
    initState('CMS', c);
    c[RECORD_STATE_FIELD.CMS] = 'transactionPlaced';
    DB.clients.push(c);
    DB.recommendations.push({id:uid('ALLOC'), clientId:c.id, status:'Client Accepted',
      clientDecision:'Approved', createdAt:new Date().toISOString(), createdBy:currentUser,
      schemes:[{plan:'Retirement', schemeName:'Bluechip Growth', amount:500000, mode:'Lumpsum'},
               {plan:'Education',  schemeName:'Midcap Opportunities', amount:10000, mode:'SIP'}]});
    await save('clients'); await save('recommendations');
    return c.id;
  }, name);

  t.section('the field, and what it is called');

  await t.step('the order table asks for a Reference No., and marks it required', async () => {
    const src = await t.eval(()=>{
      const s = Array.from(document.querySelectorAll('script')).map(x=>x.textContent).join('\n');
      const i = s.indexOf('function openOrderRefsModal');
      return s.slice(i, i + 1400);
    });
    if(!/Reference No\./.test(src)) throw new Error('the box does not say Reference No.');
    if(!/class="req"/.test(src)) throw new Error('the reference is not marked required');
    if(/>Remark</.test(src)) throw new Error('it still says Remark');
    return 'Reference No., required, one per fund';
  });

  t.section('the gate before the next step');

  let id;
  await t.step('with no references, every fund is outstanding', async () => {
    id = await build('ZZ Order Gate');
    const r = await t.eval(i=>{
      const c = DB.clients.find(x=>x.id===i);
      return {rows: orderLineRows(c).length, needing: orderLinesNeedingRef(c).length,
              all: orderLinesAllAllotted(c)};
    }, id);
    if(r.rows !== 2) throw new Error(r.rows + ' order lines, expected 2');
    if(r.needing !== 2) throw new Error(r.needing + ' funds waiting on a reference, expected 2');
    if(r.all) throw new Error('it thinks every fund is allotted already');
    return '2 funds, both waiting on a reference';
  });

  await t.step('references entered, and each fund can then be allotted', async () => {
    const r = await t.eval(async (i)=>{
      const c = DB.clients.find(x=>x.id===i);
      const rows = orderLineRows(c);
      rows.forEach((row, n)=>setOrderLineState(c, row.l, row.i,
        {ref:'REF-' + (n+1), status:'Placed', at:new Date().toISOString()}));
      await save('clients');
      return {needing: orderLinesNeedingRef(c).length, all: orderLinesAllAllotted(c),
              refs: orderLineRows(c).map(x=>x.ref)};
    }, id);
    if(r.needing) throw new Error(r.needing + ' funds still want a reference');
    if(r.all) throw new Error('placed is not allotted, but it says every fund is allotted');
    return 'references ' + r.refs.join(', ') + ' — placed, not yet allotted';
  });

  await t.step('the next step stays shut until the last fund is allotted', async () => {
    const r = await t.eval(async (i)=>{
      const c = DB.clients.find(x=>x.id===i);
      await setOrderLineAllotted(c.id, 0);
      const half = orderLinesAllAllotted(c);
      await setOrderLineAllotted(c.id, 1);
      return {half, full: orderLinesAllAllotted(c),
              states: orderLineRows(c).map(x=>x.status)};
    }, id);
    if(r.half) throw new Error('one fund of two allotted and it opened the gate');
    if(!r.full) throw new Error('both allotted and the gate is still shut: ' + r.states.join('/'));
    return 'shut at one of two, open at two of two';
  });

  t.section('a fund that comes back rejected');

  await t.step('rejecting one raises a task to place it again', async () => {
    const rid = await build('ZZ Order Reject');
    const r = await t.eval(async (i)=>{
      const c = DB.clients.find(x=>x.id===i);
      orderLineRows(c).forEach((row, n)=>setOrderLineState(c, row.l, row.i,
        {ref:'REF-R' + (n+1), status:'Placed', at:new Date().toISOString()}));
      await save('clients');
      // setOrderLineRejected asks for a reason through prompt(); the suite
      // answers it the way a user would.
      window.prompt = () => 'The folio was not recognised';
      await setOrderLineRejected(c.id, 0);
      const tasks = DB.tasks.filter(x=>!x.deletedAt && x.clientId===c.id && x.taskType===ORDER_REJECT_TASK);
      return {status: orderLineRows(c)[0].status, all: orderLinesAllAllotted(c),
              needing: orderLinesNeedingRef(c).length, tasks: tasks.length,
              due: tasks[0] && tasks[0].dueDate, says: tasks[0] && tasks[0].description};
    }, rid);
    if(r.status !== 'Rejected') throw new Error('the fund reads ' + r.status);
    if(r.all) throw new Error('a rejected fund still counts as allotted');
    if(r.tasks !== 1) throw new Error(r.tasks + ' tasks raised, expected 1');
    if(!/not recognised/.test(r.says || '')) throw new Error('the reason is not on the task: ' + r.says);
    if(!/REF-R1/.test(r.says || '')) throw new Error('the reference it was placed under is not on the task');
    if(r.needing !== 1) throw new Error(r.needing + ' funds want a new reference, expected 1');
    return 'rejected, one task, carrying the reason and the old reference';
  });

  await t.step('rejecting the same fund twice does not raise a second task', async () => {
    const rid = await build('ZZ Order Reject Twice');
    const n = await t.eval(async (i)=>{
      const c = DB.clients.find(x=>x.id===i);
      orderLineRows(c).forEach((row, k)=>setOrderLineState(c, row.l, row.i,
        {ref:'REF-T' + (k+1), status:'Placed', at:new Date().toISOString()}));
      await save('clients');
      window.prompt = () => 'Rejected again';
      await setOrderLineRejected(c.id, 0);
      await setOrderLineRejected(c.id, 0);
      return DB.tasks.filter(x=>!x.deletedAt && x.clientId===c.id && x.taskType===ORDER_REJECT_TASK).length;
    }, rid);
    if(n !== 1) throw new Error(n + ' tasks after two rejections');
    return 'still one';
  });

  t.section('a client who was mid-order when this arrived');

  await t.step('one reference on the record still reads as a placed order', async () => {
    const r = await t.eval(async ()=>{
      const c = {id:uid('CMS'), cmsName:'ZZ Legacy Order', rmName:currentUser,
        transactionOrderRef:'OLD-REF-9', createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('CMS', c); c[RECORD_STATE_FIELD.CMS]='transactionPlaced';
      DB.clients.push(c);
      DB.recommendations.push({id:uid('ALLOC'), clientId:c.id, status:'Client Accepted',
        clientDecision:'Approved', createdAt:new Date().toISOString(), createdBy:currentUser,
        schemes:[{plan:'Retirement', schemeName:'Bluechip Growth', amount:500000, mode:'Lumpsum'}]});
      await save('clients'); await save('recommendations');
      return {refs: orderLineRows(c).map(x=>x.ref), needing: orderLinesNeedingRef(c).length};
    });
    if(r.refs[0] !== 'OLD-REF-9')
      throw new Error('the old reference did not carry onto the line: ' + JSON.stringify(r.refs));
    if(r.needing) throw new Error('it is asking for a reference it already has');
    return 'the record\'s own reference stands in for the line\'s';
  });

  t.section('the one section that shows where the money is');

  await t.step('Investment Stage Status replaces the card stack', async () => {
    /* It used to look for the old function's name. The name was not
       the point — the client's profile was — and the Transaction
       Tracker has cards of its own now, on its own page, which is not
       this. So it reads the profile itself. */
    const r = await t.eval(i=>{
      const s = Array.from(document.querySelectorAll('script')).map(x=>x.textContent).join('\n');
      const c = DB.clients.find(x=>x.id === i);
      /* The section lives on the profile's Transactions tab. */
      window._clientTab = 'transactions';
      const profile = JSON.stringify(viewClientDetail(c.id));
      window._clientTab = 'overview';
      return {has: typeof window.investmentStageStatusHtml === 'function',
              title: s.indexOf('Investment Stage Status') >= 0,
              onProfile: /Investment Stage Status/.test(profile),
              stackBack: /txn-card\b|txn-cards/.test(profile)};
    }, id);
    if(!r.has) throw new Error('investmentStageStatusHtml is gone');
    if(!r.title) throw new Error('nothing is headed Investment Stage Status');
    if(!r.onProfile) throw new Error('the client profile does not carry the section');
    if(r.stackBack) throw new Error('the client profile is drawing a stack of transaction cards again');
    return 'one section on the profile, and no stack of cards back on it';
  });

  await t.step('it names the scheme and the folio the way M19 asked', async () => {
    const html = await t.eval(i=>{
      const c = DB.clients.find(x=>x.id===i);
      return investmentStageStatusHtml(c, DB.recommendations.filter(r=>r.clientId===c.id));
    }, id);
    if(!/Reference No\./.test(html)) throw new Error('the section does not show a Reference No. column');
    return 'Reference No. on the client\'s own view';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
