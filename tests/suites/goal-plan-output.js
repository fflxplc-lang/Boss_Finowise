/* GOAL BASED PLANNING: THE PLAN OUTPUT PAGE, AND WHAT FOLLOWS APPROVAL.

   The firm marked up the page and asked for five things.

   Three actions on it and no more — the record, the sheet it was
   worked out from, and Send for Approval. It carried six.

   The cashflow the client already gave, printed on the plan. They
   answered it under Part B of their own form and then the plan said
   nothing about it, so the one figure an adviser wants beside a
   monthly SIP — what is actually spare each month — was a page away.

   Inflation and the expected return typed where they are read. They
   are the two assumptions the whole plan turns on, and changing one
   meant three pages away on the input sheet. Typing one writes it
   onto that goal's own row and the plan is worked out again from it.

   The allocation off the page. It asked an adviser to place money
   into schemes on the page where the advice was still being read and
   sent up for approval.

   And, in its place, the Required Execution Plan — the ladder's own
   post-approval flow, on the same code: what the plan asks for
   against what the family agreed, then Update DBT, which writes the
   business and opens the execution sheet the client consents to. */
const {suite} = require('../lib/harness');

const LEAD = 'LMS-GPO';
const SEED = `async function(){
  let l = DB.leads.find(x=>x.id === '${LEAD}');
  if(!l){ l = {id:'${LEAD}'}; DB.leads.push(l); }
  Object.assign(l, {firstName:'ZZ Goal', lastName:'Output', mobile:'9800888222',
    email:'gpo@example.com', dob:'2001-01-01', assignedTo: currentUser,
    transformationForm:'MULTIGOAL', createdAt:new Date().toISOString(),
    iseqScore:22, iseqMaxScore:100, iseqCategory:'Conservative'});
  if(!stateOf('LMS', l)) initState('LMS', l);
  l.planRounds = [];
  l.formData = {MULTIGOAL:{
    name:'ZZ Goal Output', mobile:'9800888222', email:'gpo@example.com', dob:'2001-01-01',
    mg_income:'150000', mg_expense:'90000', mg_liabilities:'400000',
    mg_goals:[{goal:'Car', years:'5', currentValue:'2500000', inflation:'7', returns:'12'},
              {goal:'House', years:'10', currentValue:'8000000', inflation:'7', returns:'12'}]}};
  await save('leads');
  await markPlanInputSubmitted(l, 'Client');
  await recomputePlan(l);
  openPlanOutput(l.id);
  return l.id;
}`;

suite(async t => {
  await t.home();

  t.section('the page');

  await t.step('three things to do on it, and the allocation is not one of them', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const id = await (${SEED})();
      const rec = planRecordOf(id);
      const round = latestPlanRound(rec);
      /* the stage the firm sees it on: the plan is prepared and not yet sent up */
      const acts = planOutputActions(rec, round, {isLead:true, leadId:id, canSend:true})
        .filter(Boolean).map(a=>a.label);
      return {acts, body: document.body.innerText,
              alloc: !!document.querySelector('.alloc-grid, .alloc-line, #allocLines'),
              html: planDocumentHtml(rec, round, {})};
    })()`));
    if(r.acts.join(' / ') !== 'LMS / Input Sheet / Send for Approval')
      throw new Error('the page offers: ' + r.acts.join(' / '));
    if(/ASSET ALLOCATION/i.test(r.html))
      throw new Error('the allocation section is still on the plan document');
    if(/Add a line|Back to the suggested split|Update DBT/i.test(r.html))
      throw new Error('the allocation’s own buttons are still on the page');
    return r.acts.join(' / ') + ', and no allocation under the goals';
  });

  await t.step('the cashflow the client gave is printed with the plan', async () => {
    const r = await t.eval(id=>{
      const o = latestPlanRound(planRecordOf(id)).output;
      const txt = document.body.innerText;
      return {cash: o.cash, surplusShown: /Surplus/i.test(txt),
              income: /1,50,000/.test(txt), expense: /90,000/.test(txt),
              liab: /4,00,000/.test(txt),
              /* and the engine still does not read any of it */
              lump: Math.round(o.summary.lumpsumTotal)};
    }, LEAD);
    if(!r.cash) throw new Error('the plan carries no cashflow at all');
    if(r.cash.income !== 150000 || r.cash.expense !== 90000 || r.cash.liabilities !== 400000)
      throw new Error('it carries ' + JSON.stringify(r.cash));
    if(r.cash.surplus !== 60000) throw new Error('the surplus reads ' + r.cash.surplus);
    if(!r.surplusShown || !r.income || !r.expense || !r.liab)
      throw new Error('one of the four is not on the page');
    return 'income 1,50,000 · expense 90,000 · surplus 60,000 · liabilities 4,00,000';
  });

  await t.step('and the arithmetic is untouched by it', async () => {
    const r = await t.eval(id=>{
      const rec = planRecordOf(id);
      const a = Object.assign({}, leadFormData(rec, 'MULTIGOAL'));
      const before = computeMultiGoalPlan(a);
      const after = computeMultiGoalPlan(Object.assign({}, a,
        {mg_income:'9900000', mg_expense:'10', mg_liabilities:'0'}));
      return {same: JSON.stringify(before.goals) === JSON.stringify(after.goals)
                 && JSON.stringify(before.summary) === JSON.stringify(after.summary)};
    }, LEAD);
    if(!r.same) throw new Error('changing the cashflow changed what the plan works out');
    return 'the goals and the totals are the same to the rupee';
  });

  t.section('the two assumptions, typed where they are read');

  await t.step('a new return writes onto the goal’s own row and the plan follows', async () => {
    const r = await t.eval(async id=>{
      const was = latestPlanRound(planRecordOf(id)).output.goals[0];
      await planGoalRateSet(id, 1, 'returns', '15');
      const rec = planRecordOf(id);
      const now = latestPlanRound(rec).output.goals[0];
      return {wasLump: Math.round(was.lumpsum), wasSip: Math.round(was.sip),
              nowLump: Math.round(now.lumpsum), nowSip: Math.round(now.sip),
              nowRate: now.returns,
              onForm: (leadFormData(rec,'MULTIGOAL').mg_goals||[])[0],
              /* the other goal is untouched */
              other: Math.round(latestPlanRound(rec).output.goals[1].lumpsum)};
    }, LEAD);
    if(String(r.onForm.returns) !== '15')
      throw new Error('the input form row holds "' + r.onForm.returns + '"');
    if(Math.abs(r.nowRate - 0.15) > 1e-9) throw new Error('the plan read it as ' + r.nowRate);
    if(!(r.nowLump < r.wasLump) || !(r.nowSip < r.wasSip))
      throw new Error('a higher return did not lower what has to be found: '
        + r.wasLump + '→' + r.nowLump + ', ' + r.wasSip + '→' + r.nowSip);
    return 'returns 12% → 15%: lumpsum ' + r.wasLump + ' → ' + r.nowLump
         + ', SIP ' + r.wasSip + ' → ' + r.nowSip;
  });

  await t.step('but not once it has gone up for approval', async () => {
    const r = await t.eval(async id=>{
      const rec = planRecordOf(id), round = latestPlanRound(rec);
      const open = planRatesAreOpen(rec, round);
      round.sentForApprovalAt = new Date().toISOString();
      await save('leads');
      const shut = planRatesAreOpen(rec, round);
      const html = planDocumentHtml(rec, round, {});
      round.seniorStatus = 'Declined';
      const backAgain = planRatesAreOpen(rec, round);
      delete round.seniorStatus;
      await save('leads');
      return {open, shut, backAgain, boxes: (html.match(/rate-in/g)||[]).length};
    }, LEAD);
    if(!r.open) throw new Error('the rates were not open while the plan was being written');
    if(r.shut) throw new Error('they are still open after it went up for approval');
    if(r.boxes) throw new Error('the page still draws ' + r.boxes + ' rate box(es)');
    if(!r.backAgain) throw new Error('a plan the senior sent back does not open again');
    return 'open while it is being written, shut once it is up, open again if it is sent back';
  });

  t.section('and after the senior signs it off');

  await t.step('the Required Execution Plan is shut until then', async () => {
    const r = await t.eval(async id=>{
      const rec = planRecordOf(id), round = latestPlanRound(rec);
      delete round.sentForApprovalAt;
      await save('leads');
      const before = planFormStepOpen('exec', rec, 'MULTIGOAL');
      round.seniorStatus = 'Approved';
      await save('leads');
      return {before, after: planFormStepOpen('exec', rec, 'MULTIGOAL'),
              steps: PLAN_FORM_STEPS.map(x=>x[1]),
              why: planFormStepWhy('exec')};
    }, LEAD);
    if(r.steps.join(' | ') !== 'Input Form | RM Working | Required Execution Plan')
      throw new Error('the steps read: ' + r.steps.join(' | '));
    if(r.before) throw new Error('it was open before the senior had signed anything off');
    if(!r.after) throw new Error('it did not open once the senior approved it');
    if(!/signed the advice off/i.test(r.why)) throw new Error('it does not say why: ' + r.why);
    return r.steps.join(' | ');
  });

  await t.step('what was agreed writes the business and opens the execution sheet', async () => {
    const r = await t.eval(async id=>{
      openPlanFormPage(id, 'MULTIGOAL', 'exec');
      await planExecTakeRequired(id, 'lump');
      const rec = planRecordOf(id), round = latestPlanRound(rec);
      const rows = planExecRows(rec, round);
      const agreed = rows.reduce((a,x)=>a + (Number(x.agreedLump)||0), 0);
      await planExecUpdateDbt(id);
      const dbts = planDbtsFor(id, round.n);
      return {rows: rows.map(x=>x.name), agreed,
              dbts: dbts.map(d=>({kind:d.planKind, amt:Number(d.amount)})),
              sheets: dbts.map(d=>!!allocationForDbt(d.id)),
              lines: ((latestPlanRound(planRecordOf(id)).allocation||{}).lines||[])
                       .map(l=>({label:l.label, amt:Number(l.amount)})),
              required: rows.map(x=>Math.round(Number(x.lump)||0))};
    }, LEAD);
    if(r.rows.join(', ') !== 'Car, House')
      throw new Error('the page lists: ' + r.rows.join(', '));
    const lump = r.dbts.filter(d=>d.kind === 'Lumpsum');
    if(lump.length !== 1) throw new Error(lump.length + ' one-time DBTs were written');
    if(lump[0].amt !== r.agreed)
      throw new Error('the DBT is ' + lump[0].amt + ' against ' + r.agreed + ' agreed');
    if(!r.sheets.every(Boolean)) throw new Error('a DBT opened no execution sheet');
    /* the agreed money is placed against the goal it was agreed for */
    const byGoal = {}; r.lines.forEach(l=>{ byGoal[l.label] = (byGoal[l.label]||0) + l.amt; });
    if(byGoal.Car !== r.required[0] || byGoal.House !== r.required[1])
      throw new Error('the allocation reads ' + JSON.stringify(byGoal)
        + ' against ' + JSON.stringify(r.required) + ' agreed');
    return 'DBT ' + lump[0].amt + ', one execution sheet, placed as '
         + Object.keys(byGoal).map(k=>k + ' ' + byGoal[k]).join(' · ');
  });

  await t.step('and nothing is agreed twice when it is pressed again', async () => {
    const r = await t.eval(async id=>{
      const round = latestPlanRound(planRecordOf(id));
      await planExecUpdateDbt(id);
      const dbts = planDbtsFor(id, round.n);
      return {n: dbts.length, amts: dbts.map(d=>Number(d.amount)),
              lines: ((latestPlanRound(planRecordOf(id)).allocation||{}).lines||[]).length};
    }, LEAD);
    if(r.n !== 1) throw new Error('a second press left ' + r.n + ' DBTs');
    if(r.lines !== 2) throw new Error('it left ' + r.lines + ' allocation lines, not 2');
    return 'one DBT of ' + r.amts[0] + ' and two lines, pressed twice';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
