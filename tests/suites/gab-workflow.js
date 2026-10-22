/* GOAL BASED BLUEPRINT STOPPED AT THE BLUEPRINT.

   Its last tab said "Asset Allocation" and was not a page: pressing it
   bounced the planner out to the Plan Output screen. The two steps
   between the advice and the client's consent — what the family agreed
   to in the room, and where that money is actually placed — had
   nowhere to happen, which is the same hole FSL had and 7 Events had
   fixed for itself long before either.

   The firm asked for 7 Events' workflow here too, so GAB now walks:

     Input Form · RM Working · The Golden Age Blueprint
     Required Execution Plan · Final Execution Plan

   with the Formula Audit left where it was, last, because it is a
   diagnostic anybody may open at any time and not a step of the
   journey.

   GAB's goals are its buckets — the time slices the corpus is cut into
   — plus the lumpsum the financial goals need, and they are read off
   the ROUND'S OWN allocation guide rather than a fresh computation.
   That matters twice: what the execution plan lists is exactly what
   was approved, and the labels match the allocation lines without a
   second spelling of them existing anywhere.

   What this holds to: the gate, the carry-across, the squaring, the
   pages staying editable after approval, and the action points
   reaching the Daily Service Tracker through the one shared sync. */
const {suite} = require('../lib/harness');

const SETUP = `async (tag) => {
  const now = new Date().toISOString();
  const l = {id: uid('LMS'), firstName:'ZZ Golden', lastName: tag, mobile:'98000000' + tag,
    email:'zz.gab.' + tag + '@zz.in', assignedTo: currentUser, branch: DB.config.branches[0],
    createdAt: now, transformationForm:'GAB', dob:'1975-04-12',
    iseqScore: 40, iseqCategory:'Moderate'};
  initState('LMS', l); DB.leads.push(l); await save('leads');
  window._gabLeadId = l.id; window._gabStep = 'input';
  navigate('gab');
  await new Promise(r=>setTimeout(r, 350));
  const s = _gab.s;
  s.client.planDate = '2026-10-16'; s.client.rm = 'ZZ RM'; s.client.firm = 'Freedom LifeX';
  s.s1.name = 'ZZ Golden ' + tag; s.s1.dobSelf = '1975-04-12'; s.s1.retYear = '2035';
  s.s1.fa[0].amount = 2500000;
  s.s2[0].monthly = 60000;
  s.s4.rows[0].existing = 2500000; s.s4.rows[0].monthly = 25000; s.s4.rows[0].ret = 0.12;
  s.s3.riskProfile = 'Moderate';
  _gab.dirty = true; gabRecompute(); await gabSaveSheet();
  await gabSubmitForClient(l.id);
  await gabPreparePlan(l.id);
  return l.id;
}`;

suite(async t => {
  await t.home();

  await t.step('six tabs, the journey first and the audit last', async () => {
    const r = await t.eval(()=>GAB_STEPS.map(x=>x[1]));
    const want = ['Input Form','RM Working','The Golden Age Blueprint',
                  'Required Execution Plan','Final Execution Plan','Formula Audit'];
    if(JSON.stringify(r) !== JSON.stringify(want)) throw new Error('the steps read ' + r.join(' · '));
    return r.join(' → ');
  });

  await t.step('the Final Execution Plan is shut until the advice is signed off', async () => {
    const r = await t.eval(async (a)=>{
      const id = await eval('(' + a.SETUP + ')')('61');
      const rec = planRecordOf(id), round = latestPlanRound(rec);
      const before = {open: GAB_STEPS.map(([k])=>k + ':' + gabStepOpen(k, rec, round)),
        why: gabStepWhy('alloc', rec, round)};
      round.seniorStatus = 'Approved'; round.seniorAt = new Date().toISOString();
      await save('leads');
      return {id, before, prepared: !!(round && round.output),
        after: GAB_STEPS.map(([k])=>k + ':' + gabStepOpen(k, rec, round)),
        guide: (round.output.allocationGuide || []).map(g=>g.label)};
    }, {SETUP});
    if(!r.prepared) throw new Error('the plan was not prepared, so nothing below means anything');
    /* Both execution pages wait for the sign-off, as on FSL. */
    if(r.before.open.indexOf('exec:false') < 0)
      throw new Error('the Required Execution Plan is open on a plan nobody signed off: ' + r.before.open.join(' '));
    if(r.before.open.indexOf('alloc:false') < 0)
      throw new Error('the Final Execution Plan opened before the advice was signed off');
    if(r.before.open.indexOf('audit:true') < 0) throw new Error('the Formula Audit stopped being open');
    if(!/signed the advice off/.test(r.before.why)) throw new Error('it does not say why: ' + r.before.why);
    if(r.after.indexOf('alloc:true') < 0 || r.after.indexOf('exec:true') < 0)
      throw new Error('an execution page is still shut after approval: ' + r.after.join(' '));
    if(!r.guide.length) throw new Error('the plan has no buckets to execute');
    return r.guide.length + ' bucket(s) to execute; both execution pages wait for the sign-off and say why';
  });

  await t.step('the Required Execution Plan lists the buckets the plan was approved with', async () => {
    await t.eval(()=>{ window._gabStep = 'exec'; render(); });
    await t.wait(700);
    const r = await t.eval(()=>{
      const rec = planRecordOf(window._gabLeadId), round = latestPlanRound(rec);
      const rows = gabExecRows(rec);
      const guide = (round.output.allocationGuide || []);
      const c = document.getElementById('content');
      return {rows: rows.map(x=>({name: x.name, lump: x.lump, key: x.key})),
        guide: guide.map(g=>({label: g.label, amount: g.amount})),
        boxes: c.querySelectorAll('[data-gabp^="exec.rows."]').length,
        bars: c.querySelectorAll('.se-stepbar').length,
        approval: /Send for Approval/.test(c.textContent)};
    });
    if(r.rows.length !== r.guide.length)
      throw new Error(r.rows.length + ' rows against ' + r.guide.length + ' in the approved guide');
    r.rows.forEach((row, i)=>{
      if(row.name !== r.guide[i].label) throw new Error('row ' + i + ' is "' + row.name + '" against "' + r.guide[i].label + '"');
      if(Math.round(row.lump) !== Math.round(r.guide[i].amount))
        throw new Error('row ' + i + ' asks ' + row.lump + ' against ' + r.guide[i].amount);
    });
    if(r.boxes !== r.rows.length * 2)
      throw new Error(r.boxes + ' agreed boxes for ' + r.rows.length + ' rows');
    if(!r.approval) throw new Error('Send for Approval is not on the page');
    if(r.bars !== 1) throw new Error(r.bars + ' foot bars on the page');
    return r.rows.length + ' buckets, each with its required figure off the approved plan and two agreed '
      + 'boxes, Send for Approval, and one foot bar';
  });

  await t.step('the agreed figures are carried across, placed, and square exactly', async () => {
    const r = await t.eval(async ()=>{
      const rec = planRecordOf(window._gabLeadId);
      const rows = gabExecRows(rec);
      _gab.s.exec.rows = {};
      rows.forEach((x, i)=>{ _gab.s.exec.rows[x.key] = {agreedLump: 100000 * (i + 1), agreedSip: i === 0 ? 5000 : ''}; });
      _gab.dirty = true; await gabSaveSheet();
      await gabExecSaveAndNext(window._gabLeadId);
      const round = latestPlanRound(planRecordOf(window._gabLeadId));
      const lines = (round.allocation || {}).lines || [];
      return {step: window._gabStep, n: rows.length,
        lines: lines.map(l=>({label: l.label, amount: l.amount, sip: allocLineIsSip(l)})),
        gaps: gabAllocReconcile(planRecordOf(window._gabLeadId), round).off,
        names: rows.map(x=>x.name)};
    });
    if(r.step !== 'alloc') throw new Error('Save & Next landed on "' + r.step + '"');
    if(r.gaps.length) throw new Error('it reports a gap on figures it placed itself: ' + JSON.stringify(r.gaps));
    r.names.forEach((name, i)=>{
      const lump = r.lines.find(l=>l.label === name && !l.sip);
      if(!lump || lump.amount !== 100000 * (i + 1))
        throw new Error('"' + name + '" placed ' + JSON.stringify(lump));
    });
    const sip = r.lines.find(l=>l.sip);
    if(!sip || sip.amount !== 5000) throw new Error('the agreed SIP is ' + JSON.stringify(sip));
    if(sip.label !== r.names[0]) throw new Error('the SIP is labelled "' + sip.label + '"');
    return r.n + ' buckets placed at what was agreed, one of them with a SIP beside its lumpsum, and '
      + 'nothing outstanding';
  });

  await t.step('and the two execution pages stay the planner’s after approval', async () => {
    const r = await t.eval(()=>{
      const rec = planRecordOf(window._gabLeadId), round = latestPlanRound(rec);
      const c = document.getElementById('content');
      return {rmLock: gabRmLocked(rec, round), execLock: gabExecLocked(rec, round),
        send: /Send to Client/.test(c.textContent),
        bring: /Bring the agreed amounts/.test(c.textContent)};
    });
    if(!r.rmLock) throw new Error('the fixture is not in the state this is testing');
    if(r.execLock) throw new Error('the execution pages locked themselves on approval');
    if(!r.send) throw new Error('Send to Client vanished exactly when it is needed');
    if(!r.bring) throw new Error('the bring-across button vanished');
    return 'the input sheet is locked and the two execution pages are not';
  });

  await t.step('an unplaced amount holds the plan back from the client', async () => {
    const r = await t.eval(async ()=>{
      const rec = planRecordOf(window._gabLeadId), round = latestPlanRound(rec);
      const lines = round.allocation.lines;
      const was = lines[0].amount;
      lines[0].amount = was - 25000;
      await save('leads');
      const gaps = gabAllocReconcile(rec, round).off;
      lines[0].amount = was;
      await save('leads');
      return {gaps, clean: gabAllocReconcile(rec, round).off.length};
    });
    if(!r.gaps.length) throw new Error('taking ₹25,000 out of the allocation went unnoticed');
    if(Math.abs(r.gaps[0].diff - 25000) > 1) throw new Error('it reports a difference of ' + r.gaps[0].diff);
    if(r.clean) throw new Error('putting it back did not clear the gap');
    return 'a ₹25,000 hole is named with the figure, and clears when it is filled';
  });

  await t.step('an action point raises a task marked GAB, through the shared sync', async () => {
    const r = await t.eval(async ()=>{
      _gab.s.exec.actions = [{desc:'ZZ gab place the corpus', owner: currentUser,
        by:'2026-12-01', amt:100000, status:'Open'}];
      _gab.dirty = true; await gabSaveSheet();
      const tasks = DB.tasks.filter(x=>/ZZ gab place the corpus/.test(x.description || ''));
      const sheet = gabStateOf(planRecordOf(window._gabLeadId));
      return {made: tasks.length, source: (tasks[0] || {}).sourceModule, due: (tasks[0] || {}).dueDate,
        linked: ((sheet.exec || {}).actions || [])[0] || {}};
    });
    if(r.made !== 1) throw new Error(r.made + ' task(s) raised, expected 1');
    if(r.source !== 'GAB') throw new Error('the task says it came from "' + r.source + '"');
    if(r.due !== '2026-12-01') throw new Error('the due date is ' + r.due);
    if(!r.linked.dstId) throw new Error('the row does not remember the task it raised');
    return 'one task on the DST, dated, marked GAB, and linked back to the row that raised it';
  });
});
