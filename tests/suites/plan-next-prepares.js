/* GOING ON FROM RM WORKING IS PREPARING THE PLAN (FSL AND GAB).

   RM Working carried a Prepare Plan button of its own beside a Success
   Ladder that was dead until the plan existed: two presses for one
   intention, and a page that looked finished while the ladder behind it
   was stale. The firm asked for three actions on that bar — LMS, Input
   Form, The Success Ladder — and for the last of them to do the
   preparing.

   What this has to get right. The bar carries those three and nothing
   else. Going on works the ladder out over the form AS IT NOW STANDS and
   opens it, in one press. It is the same preparation the stage used to
   fire, not a second one — pressing it twice leaves one plan, not two,
   and the lead still moves to Plan Prepared. And it refuses, saying what
   is missing, rather than opening an empty ladder. */
const {suite} = require('../lib/harness');

const SETUP = `async (tag) => {
  const l = {id: uid('LMS'), firstName:'ZZ Ladder', lastName: tag, mobile:'98000001' + tag,
    email:'zz.next.' + tag + '@zz.in', assignedTo: currentUser, branch: DB.config.branches[0],
    createdAt:new Date().toISOString(), transformationForm:'FSL', dob:'1985-04-12',
    iseqScore: 44, iseqCategory:'Moderate'};
  initState('LMS', l); DB.leads.push(l); await save('leads');
  window._fslLeadId = l.id; window._fslStep = 'input';
  navigate('fsl');
  await new Promise(r=>setTimeout(r, 400));
  Object.assign(_fsl.s.personal, {name:'ZZ Ladder ' + tag, mobile:'98000001' + tag,
    email:'zz.next.' + tag + '@zz.in', dob:'1985-04-12'});
  _fsl.s.years = 10;
  _fsl.s.assets[0].current = 9700000; _fsl.s.assets[0].monthly = 49500;
  _fsl.dirty = true; fslRecompute(); await fslSaveSheet();
  await fslSubmitForClient(l.id);
  await fslStepGo('plan');
  await new Promise(r=>setTimeout(r, 500));
  return l.id;
}`;

/* What the bar at the foot of the page actually offers. */
const BAR = `() => {
  const bar = document.querySelector('.se-stepbar');
  if(!bar) return {none:true};
  const btns = Array.from(bar.querySelectorAll('button,a'))
    .map(b=>({t:(b.textContent||'').replace(/\\s+/g,' ').trim(), off: !!b.disabled, why: b.title||''}))
    .filter(x=>x.t);
  return {btns, text: (bar.textContent||'').replace(/\\s+/g,' ').trim()};
}`;

suite(async t => {
  await t.home();

  t.section('the bar at the foot of RM Working');

  await t.step('three actions, and not one of them says Prepare', async () => {
    await t.eval(new Function('return (' + SETUP + ')("71")'));
    const r = await t.eval(new Function('return (' + BAR + ')()'));
    if(r.none) throw new Error('there is no bar at the foot of the page');
    const labels = r.btns.map(b=>b.t);
    if(labels.some(x=>/prepare/i.test(x)))
      throw new Error('a Prepare button is still on it: ' + labels.join(', '));
    if(!labels.some(x=>/input form/i.test(x)))
      throw new Error('Input Form is not on it: ' + labels.join(', '));
    if(!labels.some(x=>/success ladder/i.test(x)))
      throw new Error('The Success Ladder is not on it: ' + labels.join(', '));
    if(!/LMS/.test(r.text)) throw new Error('the way back to LMS is not on it: ' + r.text);
    return 'LMS · ' + labels.join(' · ');
  });

  await t.step('and it is off, with its reason, while the form cannot be worked out', async () => {
    const r = await t.eval(async ()=>{
      const was = _fsl.s.chosenLevel;
      _fsl.s.chosenLevel = '';                   // the one thing this page settles
      _fsl.dirty = true; fslRecompute(); fslRedraw();
      await new Promise(r=>setTimeout(r, 400));
      const b = Array.from(document.querySelectorAll('button'))
        .find(x=>/success ladder/i.test(x.textContent||''));
      const out = {off: !!(b && b.disabled), why: (b && b.title) || '',
                   missing: fslMissing('any').map(m=>m.label)};
      _fsl.s.chosenLevel = was;
      return out;
    });
    if(!r.missing.length) throw new Error('nothing reads as missing, so this proves nothing');
    if(!r.off) throw new Error('it is still pressable with ' + r.missing.join(', ') + ' outstanding');
    if(r.why.indexOf(r.missing[0]) < 0)
      throw new Error('it does not say what is missing: "' + r.why + '"');
    return 'off, and it says: "' + r.why + '"';
  });

  t.section('pressing it');

  await t.step('one press works the ladder out and opens it', async () => {
    const r = await t.eval(async ()=>{
      const id = window._fslLeadId;
      fslTakeSuggestedLevel();                   // settle the one open answer
      await new Promise(r=>setTimeout(r, 300));
      const rec = DB.leads.find(l=>l.id===id);
      /* Stand it where the meeting leaves it; what is under test is the
         move out of that stage, not the walk up to it. */
      rec.status = 'secondMeetingDone'; await save('leads');
      const before = {rounds: planRoundsOf(rec).length,
                      out: !!(latestPlanRound(rec)||{}).output,
                      state: stateOf('LMS', rec)};
      await fslGoToLadder(id);
      await new Promise(r=>setTimeout(r, 800));
      const after = DB.leads.find(l=>l.id===id);
      const round = latestPlanRound(after);
      return {before, step: window._fslStep, rounds: planRoundsOf(after).length,
              out: !!(round||{}).output, n: (round||{}).n,
              computedAt: !!(round||{}).computedAt, state: stateOf('LMS', after)};
    });
    if(r.before.out) throw new Error('a plan already existed, so this proves nothing');
    if(!r.out) throw new Error('no plan was worked out');
    if(!r.computedAt) throw new Error('the round carries no time it was prepared');
    if(r.step !== 'bp') throw new Error('it landed on step "' + r.step + '", not the ladder');
    if(r.state !== 'planPrepared')
      throw new Error('the lead went from ' + r.before.state + ' to ' + r.state + ', not planPrepared');
    return 'one press: version ' + r.n + ' written, lead ' + r.before.state + ' → ' + r.state
         + ', and the page is on the ladder';
  });

  await t.step('pressing it again rewrites that plan rather than adding one', async () => {
    const r = await t.eval(async ()=>{
      const id = window._fslLeadId;
      const rec = DB.leads.find(l=>l.id===id);
      const before = {rounds: planRoundsOf(rec).length, n: latestPlanRound(rec).n,
                      at: latestPlanRound(rec).computedAt};
      await fslStepGo('plan');
      await new Promise(r=>setTimeout(r, 400));
      /* Change the form, so a re-run has something to show for itself. */
      _fsl.s.assets[0].monthly = 60000; _fsl.dirty = true; fslRecompute(); await fslSaveSheet();
      await new Promise(r=>setTimeout(r, 50));
      await fslGoToLadder(id);
      await new Promise(r=>setTimeout(r, 800));
      const after = DB.leads.find(l=>l.id===id);
      const round = latestPlanRound(after);
      return {before, rounds: planRoundsOf(after).length, n: round.n,
              at: round.computedAt, step: window._fslStep,
              monthly: (round.output && round.output.summary || {}).totMonthly};
    });
    if(r.rounds !== r.before.rounds)
      throw new Error('it went from ' + r.before.rounds + ' round(s) to ' + r.rounds + ' — a second plan');
    if(r.n !== r.before.n) throw new Error('the version jumped ' + r.before.n + ' → ' + r.n);
    if(r.at === r.before.at) throw new Error('it did not re-work the plan at all');
    if(r.step !== 'bp') throw new Error('it landed on "' + r.step + '" the second time');
    return 'still ' + r.rounds + ' round at version ' + r.n + ', re-worked over the changed form';
  });

  t.section('and GAB, which was asked for the same bar');

  const GAB_SETUP = `async (tag) => {
    const l = {id: uid('LMS'), firstName:'ZZ Golden', lastName: tag, mobile:'98000002' + tag,
      email:'zz.gab.' + tag + '@zz.in', assignedTo: currentUser, branch: DB.config.branches[0],
      createdAt:new Date().toISOString(), transformationForm:'GAB', dob:'1975-04-12',
      iseqScore: 44, iseqCategory:'Moderate'};
    initState('LMS', l); DB.leads.push(l); await save('leads');
    openGab(l.id, 'input');
    await new Promise(r=>setTimeout(r, 500));
    const g = _gab.s;
    g.client.planDate = '2026-10-16'; g.client.rm = 'ZZ RM'; g.client.firm = 'Freedom LifeX';
    g.s1.name = 'ZZ Golden ' + tag; g.s1.dobSelf = '1975-04-12'; g.s1.retYear = '2040';
    g.s1.fa[0].amount = 2500000;
    g.s2[0].monthly = 60000;
    g.s4.rows[0].existing = 2500000; g.s4.rows[0].monthly = 25000; g.s4.rows[0].ret = 0.12;
    g.s3.riskProfile = 'Moderate';
    _gab.dirty = true; gabRecompute(); await gabSaveSheet();
    await gabSubmitForClient(l.id);
    await gabStepGo('plan');
    await new Promise(r=>setTimeout(r, 600));
    return l.id;
  }`;

  await t.step('its bar carries the same three, and no Prepare', async () => {
    const r = await t.eval(new Function('return (' + GAB_SETUP + ')("72")'));
    const bar = await t.eval(new Function('return (' + BAR + ')()'));
    if(bar.none) throw new Error('there is no bar at the foot of GAB\u2019s page');
    const labels = bar.btns.map(b=>b.t);
    if(labels.some(x=>/prepare/i.test(x)))
      throw new Error('a Prepare button is still on it: ' + labels.join(', '));
    if(!labels.some(x=>/input form/i.test(x)))
      throw new Error('Input Form is not on it: ' + labels.join(', '));
    if(!labels.some(x=>/golden age blueprint/i.test(x)))
      throw new Error('The Golden Age Blueprint is not on it: ' + labels.join(', '));
    const cards = await t.eval(()=>Array.from(document.querySelectorAll('.se-card .section-title'))
      .map(x=>x.textContent.trim()));
    if(cards.some(x=>/prepare the plan|the plan is prepared/i.test(x)))
      throw new Error('the Prepare the plan card is still on it: ' + cards.join(', '));
    return 'LMS \u00b7 ' + labels.join(' \u00b7 ') + ' \u2014 and no Prepare card';
  });

  await t.step('one press runs the nine steps and opens the blueprint', async () => {
    const r = await t.eval(async ()=>{
      const id = window._gabLeadId;
      const rec = DB.leads.find(l=>l.id===id);
      rec.status = 'secondMeetingDone'; await save('leads');
      const before = {rounds: planRoundsOf(rec).length,
                      out: !!(latestPlanRound(rec)||{}).output,
                      state: stateOf('LMS', rec)};
      await gabGoToBlueprint(id);
      await new Promise(r=>setTimeout(r, 800));
      const after = DB.leads.find(l=>l.id===id);
      const round = latestPlanRound(after);
      const roundsOnce = planRoundsOf(after).length;
      /* And again, to prove it rewrites rather than stacks. */
      await gabStepGo('plan');
      await new Promise(r=>setTimeout(r, 300));
      await gabGoToBlueprint(id);
      await new Promise(r=>setTimeout(r, 800));
      const twice = DB.leads.find(l=>l.id===id);
      return {before, step: window._gabStep, out: !!(round||{}).output, n: (round||{}).n,
              state: stateOf('LMS', after), roundsOnce, rounds: planRoundsOf(twice).length,
              nTwice: (latestPlanRound(twice)||{}).n};
    });
    if(r.before.out) throw new Error('a plan already existed, so this proves nothing');
    if(!r.out) throw new Error('no blueprint was worked out');
    if(r.step !== 'bp') throw new Error('it landed on step "' + r.step + '", not the blueprint');
    if(r.state !== 'planPrepared')
      throw new Error('the lead went from ' + r.before.state + ' to ' + r.state + ', not planPrepared');
    if(r.rounds !== r.roundsOnce || r.nTwice !== r.n)
      throw new Error('pressing twice went from ' + r.roundsOnce + ' round(s) at version ' + r.n
        + ' to ' + r.rounds + ' at version ' + r.nTwice);
    return 'one press: version ' + r.n + ', lead ' + r.before.state + ' \u2192 ' + r.state
         + ', on the blueprint \u2014 and twice leaves one round';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
