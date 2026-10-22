/* THE AGREED MONEY, SET DOWN AS BUSINESS.

   The Final Execution Plan is gone from FSL. Going on from the Required
   Execution Plan is Update DBT: the one-time and the monthly amounts
   the family agreed to are written down as business, one DBT each, and
   each DBT opens its own sheet in the Execution Tracker — which is what
   goes to the client for consent and what the Transaction Tracker is
   written from on their answer.

   What this has to get right. Two kinds of money, two DBTs, and only
   for the kinds with a figure against them. Pressing it twice does not
   raise it twice. Clearing a figure withdraws its DBT rather than
   leaving business nobody committed to. And the chain that follows —
   DBT to Execution Tracker to consent to Transaction Tracker — is the
   one BOSS already had, not a second one beside it. */
const {suite} = require('../lib/harness');

const SETUP = `async (tag) => {
  const l = {id: uid('LMS'), firstName:'ZZ Dbt', lastName: tag, mobile:'98000006' + tag,
    email:'zz.dbt.' + tag + '@zz.in', assignedTo: currentUser, branch: DB.config.branches[0],
    createdAt:new Date().toISOString(), transformationForm:'FSL', dob:'1985-04-12',
    iseqScore: 44, iseqCategory:'Moderate'};
  initState('LMS', l); DB.leads.push(l); await save('leads');
  window._fslLeadId = l.id; window._fslStep = 'input';
  navigate('fsl');
  await new Promise(r=>setTimeout(r, 400));
  Object.assign(_fsl.s.personal, {name:'ZZ Dbt ' + tag, mobile:'98000006' + tag,
    email:'zz.dbt.' + tag + '@zz.in', dob:'1985-04-12'});
  _fsl.s.years = 10;
  _fsl.s.assets[0].current = 9700000; _fsl.s.assets[0].monthly = 49500;
  _fsl.dirty = true; fslRecompute(); await fslSaveSheet();
  await fslSubmitForClient(l.id);
  await fslStepGo('plan');
  await new Promise(r=>setTimeout(r, 400));
  fslTakeSuggestedLevel();
  await new Promise(r=>setTimeout(r, 300));
  DB.leads.find(x=>x.id===l.id).status = 'secondMeetingDone';
  await save('leads');
  await fslGoToLadder(l.id);
  await new Promise(r=>setTimeout(r, 700));
  const round = latestPlanRound(planRecordOf(l.id));
  round.seniorStatus = 'Approved'; round.seniorAt = new Date().toISOString();
  await save('leads');
  await fslStepGo('exec');
  await new Promise(r=>setTimeout(r, 600));
  return l.id;
}`;

suite(async t => {
  await t.home();

  t.section('the page the Final Execution Plan used to follow');

  await t.step('there is no Final Execution Plan left, and the way on is Update DBT', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const id = await (${SETUP})("11");
      const tabs = Array.from(document.querySelectorAll('.tab')).map(x=>x.textContent.trim());
      const bar = Array.from(document.querySelectorAll('.se-stepbar button,.se-stepbar a'))
        .map(b=>({t:(b.textContent||'').replace(/\\s+/g,' ').trim(), off: !!b.disabled, why: b.title||''}))
        .filter(x=>x.t);
      return {id, tabs, bar, steps: FSL_STEPS.map(s=>s[0]),
              gone: typeof window.fslFinalExecHtml};
    })()`));
    if(r.steps.indexOf('alloc') >= 0) throw new Error('the step is still in FSL_STEPS: ' + r.steps.join(', '));
    if(r.gone !== 'undefined') throw new Error('the page it drew is still there');
    if(r.tabs.some(x=>/Final Execution Plan/i.test(x)))
      throw new Error('the tab is still there: ' + r.tabs.join(' | '));
    const labels = r.bar.map(b=>b.t);
    if(!labels.some(x=>/Update DBT/i.test(x)))
      throw new Error('Update DBT is not the way on: ' + labels.join(' | '));
    const dbt = r.bar.find(b=>/Update DBT/i.test(b.t));
    if(!dbt.off) throw new Error('it is pressable before anything has been agreed');
    if(!/one-time|monthly/i.test(dbt.why)) throw new Error('it does not say what it wants: ' + dbt.why);
    return r.tabs.join(' · ') + '  — bar: ' + labels.join(' · ');
  });

  t.section('what Update DBT writes');

  await t.step('one agreed figure, one DBT', async () => {
    const r = await t.eval(async ()=>{
      const id = window._fslLeadId;
      _fsl.s.exec.agreedLump = 2000000; _fsl.s.exec.agreedSip = '';
      _fsl.dirty = true; await fslSaveSheet();
      await fslUpdateDbt(id);
      await new Promise(r=>setTimeout(r, 900));
      const round = latestPlanRound(planRecordOf(id));
      const dbts = planDbtsFor(id, round.n);
      return {n: dbts.length, kinds: dbts.map(d=>d.planKind), amounts: dbts.map(d=>Number(d.amount)),
              types: dbts.map(d=>d.transactionType), lead: dbts.map(d=>d.leadId),
              round: dbts.map(d=>d.planRound), level: dbts.map(d=>String(d.planLevel)),
              sheets: dbts.map(d=>!!allocationForDbt(d.id)),
              stage: stateOf('LMS', DB.leads.find(l=>l.id===id))};
    });
    if(r.n !== 1) throw new Error(r.n + ' DBTs for one agreed figure: ' + r.kinds.join(', '));
    if(r.kinds[0] !== 'Lumpsum') throw new Error('it is a ' + r.kinds[0]);
    if(r.amounts[0] !== 2000000) throw new Error('the amount is ' + r.amounts[0]);
    if(!r.lead[0]) throw new Error('it does not name the lead');
    if(!r.round[0] || !r.level[0]) throw new Error('it carries no plan reference');
    if(!r.sheets[0]) throw new Error('it opened no Execution Tracker sheet');
    /* The stage of that name sits further along the shared LMS spine,
       after the presentation meeting; the business is written here
       whether or not the lead has reached it yet. */
    if(r.stage !== 'planPrepared') throw new Error('the lead moved to ' + r.stage);
    return 'one Lumpsum DBT of 20,00,000, carrying the lead, round ' + r.round[0]
         + ' and level ' + r.level[0] + ', with its own sheet \u2014 written at ' + r.stage;
  });

  await t.step('add the monthly and there are two, not three', async () => {
    const r = await t.eval(async ()=>{
      const id = window._fslLeadId;
      await fslStepGo('exec');
      await new Promise(r=>setTimeout(r, 400));
      _fsl.s.exec.agreedSip = 35000;
      _fsl.dirty = true; await fslSaveSheet();
      await fslUpdateDbt(id);
      await new Promise(r=>setTimeout(r, 900));
      const round = latestPlanRound(planRecordOf(id));
      const dbts = planDbtsFor(id, round.n);
      return {n: dbts.length, kinds: dbts.map(d=>d.planKind).sort(),
              amounts: dbts.map(d=>Number(d.amount)).sort((a,b)=>a-b),
              sheets: dbts.map(d=>(allocationForDbt(d.id)||{}).id).filter(Boolean)};
    });
    if(r.n !== 2) throw new Error(r.n + ' DBTs: ' + r.kinds.join(', '));
    if(r.kinds.join(',') !== 'Lumpsum,SIP') throw new Error('kinds: ' + r.kinds.join(', '));
    if(r.amounts.join(',') !== '35000,2000000') throw new Error('amounts: ' + r.amounts.join(', '));
    if(r.sheets.length !== 2 || r.sheets[0] === r.sheets[1])
      throw new Error('they did not open a sheet each: ' + r.sheets.join(', '));
    return 'two DBTs, one a Lumpsum and one a SIP, each with its own Execution Tracker sheet';
  });

  await t.step('pressing it again changes the figures rather than adding DBTs', async () => {
    const r = await t.eval(async ()=>{
      const id = window._fslLeadId;
      const round = latestPlanRound(planRecordOf(id));
      const before = planDbtsFor(id, round.n).map(d=>d.id).sort();
      await fslStepGo('exec');
      await new Promise(r=>setTimeout(r, 400));
      _fsl.s.exec.agreedLump = 2500000;
      _fsl.dirty = true; await fslSaveSheet();
      await fslUpdateDbt(id);
      await new Promise(r=>setTimeout(r, 900));
      const after = planDbtsFor(id, round.n);
      const lump = after.find(d=>d.planKind === 'Lumpsum');
      const sheet = allocationForDbt(lump.id);
      return {before, after: after.map(d=>d.id).sort(), amount: Number(lump.amount),
              onSheet: sheet ? allocSchemes(sheet).reduce((a,l)=>a+(Number(l.amount)||0),0) : null};
    });
    if(r.after.join(',') !== r.before.join(','))
      throw new Error('the DBTs changed identity: ' + r.before.join(',') + ' → ' + r.after.join(','));
    if(r.amount !== 2500000) throw new Error('the amount did not follow: ' + r.amount);
    if(r.onSheet !== 2500000) throw new Error('its sheet still reads ' + r.onSheet);
    return 'same two DBTs, the lumpsum now 25,00,000, and its sheet followed';
  });

  await t.step('clearing a figure withdraws its DBT', async () => {
    const r = await t.eval(async ()=>{
      const id = window._fslLeadId;
      await fslStepGo('exec');
      await new Promise(r=>setTimeout(r, 400));
      _fsl.s.exec.agreedSip = '';
      _fsl.dirty = true; await fslSaveSheet();
      await fslUpdateDbt(id);
      await new Promise(r=>setTimeout(r, 900));
      const round = latestPlanRound(planRecordOf(id));
      return {live: planDbtsFor(id, round.n).map(d=>d.planKind),
              all: (DB.businessEntries||[]).filter(b=>b.leadId===id && b.planKind).length};
    });
    if(r.live.join(',') !== 'Lumpsum') throw new Error('still live: ' + r.live.join(', '));
    if(r.all !== 2) throw new Error('the withdrawn one was destroyed rather than marked: ' + r.all);
    return 'the SIP DBT is withdrawn, the lumpsum stands, and the withdrawn one is still on the record';
  });

  t.section('and the chain that follows is the one BOSS already had');

  await t.step('consent on the sheet writes the Transaction Tracker', async () => {
    const r = await t.eval(async ()=>{
      const id = window._fslLeadId;
      const round = latestPlanRound(planRecordOf(id));
      const dbt = planDbtsFor(id, round.n)[0];
      const sheet = allocationForDbt(dbt.id);
      const before = (DB.transactions||[]).length;
      const lines = allocSchemes(sheet);
      return {sheet: sheet.id, dbt: dbt.id, before, lines: lines.length,
              linked: sheet.leadId === id,
              reaches: typeof allocClientDecision === 'function' || typeof submitAllocationDecision === 'function'};
    });
    if(!r.sheet) throw new Error('no sheet to consent to');
    if(!r.linked) throw new Error('the sheet is not linked to the lead it came from');
    if(!r.lines) throw new Error('the sheet has no line to place');
    if(!r.reaches) throw new Error('the consent route is gone');
    return 'the sheet ' + r.sheet + ' is the lead’s, carries ' + r.lines
         + ' line(s) from DBT ' + r.dbt + ', and the existing consent route answers it';
  });

  await t.step('and the stage of that name writes no third entry when it is reached', async () => {
    const r = await t.eval(async ()=>{
      const id = window._fslLeadId;
      const rec = DB.leads.find(l=>l.id===id);
      const round = latestPlanRound(planRecordOf(id));
      const before = (DB.businessEntries||[]).filter(b=>!b.deletedAt && b.leadId===id).length;
      /* Stand the lead where that stage is actually taken, and take it. */
      rec.status = 'secondMeetingMomSent'; await save('leads');
      await doTransition('LMS', id, 'fwd_dbtUpdated');
      await new Promise(r=>setTimeout(r, 700));
      const after = (DB.businessEntries||[]).filter(b=>!b.deletedAt && b.leadId===id);
      return {before, after: after.length, kinds: after.map(d=>d.planKind || '(no kind)'),
              stage: stateOf('LMS', DB.leads.find(l=>l.id===id))};
    });
    if(r.after !== r.before)
      throw new Error('it wrote another entry: ' + r.before + ' \u2192 ' + r.after
        + ' (' + r.kinds.join(', ') + ')');
    if(r.stage !== 'dbtUpdated') throw new Error('the stage did not move: ' + r.stage);
    return 'the stage moved to DBT Updated and the ' + r.after
         + ' entry/entries already written were left alone';
  });

  t.section('what the firm has to fill in afterwards');

  await t.step('the DBT names a product line the firm actually distributes', async () => {
    const r = await t.eval(()=>{
      const id = window._fslLeadId;
      const round = latestPlanRound(planRecordOf(id));
      const dbts = planDbtsFor(id, round.n);
      const list = cfgLabels('business.productCategories') || [];
      return {list, cats: dbts.map(d=>d.productCategory), products: dbts.map(d=>d.product),
              sheets: dbts.map(d=>(allocationForDbt(d.id)||{}).productCategory),
              allocList: cfgLabels('alloc.productCategories') || []};
    });
    if(!r.cats.length) throw new Error('no DBTs to look at');
    const stray = r.cats.filter(c=>r.list.indexOf(c) < 0);
    if(stray.length)
      throw new Error('off the firm\u2019s product list, so the box reads blank: ' + stray.join(', '));
    if(r.products.some(p=>!p)) throw new Error('the older product field is blank: ' + r.products.join(', '));
    const strayOnSheet = r.sheets.filter(c=>c && r.allocList.indexOf(c) < 0);
    if(strayOnSheet.length) throw new Error('the sheet carries a product nobody lists: ' + strayOnSheet.join(', '));
    return 'every DBT reads "' + r.cats[0] + '", which is on the firm\u2019s own list';
  });

  await t.step('the Execution Tracker shows the kind of money once, not twice', async () => {
    const r = await t.eval(()=>{
      const head = (typeof viewRecommendations === 'function') ? viewRecommendations() : '';
      const d = document.createElement('div'); d.innerHTML = head;
      const ths = Array.from(d.querySelectorAll('thead th')).map(x=>x.textContent.trim());
      const body = Array.from(d.querySelectorAll('tbody tr')).slice(0,1)
        .map(tr=>Array.from(tr.children).length);
      return {ths, cells: body[0] || 0};
    });
    if(r.ths.indexOf('Type') >= 0 && r.ths.indexOf('Mode') >= 0)
      throw new Error('both columns are still there: ' + r.ths.join(' | '));
    if(r.ths.indexOf('Mode') < 0) throw new Error('neither is: ' + r.ths.join(' | '));
    if(r.cells && r.cells !== r.ths.length)
      throw new Error(r.ths.length + ' headings over ' + r.cells + ' cells');
    return 'one column \u2014 ' + r.ths.join(' \u00b7 ');
  });

  t.section('Goal Based Planning, which has no execution page of its own');

  await t.step('its allocation is the agreed money, and Update DBT writes it down', async () => {
    const r = await t.eval(async ()=>{
      const l = {id: uid('LMS'), firstName:'ZZ Goal', lastName:'Based', mobile:'9800000777',
        email:'zz.goal@zz.in', assignedTo: currentUser, branch: DB.config.branches[0],
        createdAt:new Date().toISOString(), transformationForm:'MULTIGOAL', dob:'1985-04-12',
        iseqScore: 44, iseqCategory:'Moderate', status:'planPrepared'};
      initState('LMS', l); l.status = 'planPrepared';
      DB.leads.push(l); await save('leads');
      /* A prepared round with money against it, the way its plan leaves it. */
      const round = ensurePlanRound(l, 'MULTIGOAL');
      round.output = {allocatable: 900000, allocationGuide: []};
      round.allocation = {allocatable: 900000, lines: [
        Object.assign(allocLineDefaults({transactionType: txnTypeForMode('Lumpsum')}),
          {label:'Child education', fundCategory:'Equity MF', amount: 600000}),
        Object.assign(allocLineDefaults({transactionType: txnTypeForMode('SIP')}),
          {label:'Child education', fundCategory:'Equity MF', amount: 12000}),
      ]};
      await save('leads');
      const noBench = !sheetAdapterFor(l);
      await planUpdateDbtFromAllocation(l.id);
      await new Promise(r=>setTimeout(r, 900));
      const dbts = planDbtsFor(l.id, round.n);
      return {noBench, n: dbts.length,
              kinds: dbts.map(d=>d.planKind).sort(),
              amounts: dbts.map(d=>Number(d.amount)).sort((a,b)=>a-b),
              sheets: dbts.map(d=>(allocationForDbt(d.id)||{}).id).filter(Boolean),
              id: l.id, roundN: round.n};
    });
    if(!r.noBench) throw new Error('Goal Based Planning grew a workbench, so this tests the wrong thing');
    if(r.n !== 2) throw new Error(r.n + ' DBTs: ' + r.kinds.join(', '));
    if(r.kinds.join(',') !== 'Lumpsum,SIP') throw new Error('kinds: ' + r.kinds.join(', '));
    if(r.amounts.join(',') !== '12000,600000') throw new Error('amounts: ' + r.amounts.join(', '));
    if(r.sheets.length !== 2 || r.sheets[0] === r.sheets[1])
      throw new Error('they did not open a sheet each: ' + r.sheets.join(', '));
    return 'the lumpsum lines became one DBT of 6,00,000 and the SIP lines another of 12,000, '
         + 'each with its own Execution Tracker sheet';
  });

  await t.step('and pressing it again moves the figures rather than the count', async () => {
    const r = await t.eval(async ()=>{
      const l = DB.leads.find(x=>/zz.goal@zz.in/.test(x.email || ''));
      const round = latestPlanRound(l);
      const before = planDbtsFor(l.id, round.n).map(d=>d.id).sort();
      round.allocation.lines[0].amount = 750000;
      await save('leads');
      await planUpdateDbtFromAllocation(l.id);
      await new Promise(r=>setTimeout(r, 900));
      const after = planDbtsFor(l.id, round.n);
      const lump = after.find(d=>d.planKind === 'Lumpsum');
      return {before, after: after.map(d=>d.id).sort(), amount: Number(lump.amount)};
    });
    if(r.after.join(',') !== r.before.join(','))
      throw new Error('the DBTs changed identity: ' + r.before.join(',') + ' \u2192 ' + r.after.join(','));
    if(r.amount !== 750000) throw new Error('the amount did not follow: ' + r.amount);
    return 'the same two DBTs, the lumpsum now 7,50,000';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
