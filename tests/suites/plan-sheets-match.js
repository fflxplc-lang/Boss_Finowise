/* THE THREE SHEETS, WORKING THE SAME WAY.

   7 Events, FSL and GAB are three different plans and always will be —
   different questions, different arithmetic, different pages in the
   middle. What a planner DOES with them should not differ, and it did.

   The Input Form's bar was the worst of it. 7 Events offers one extra
   button, Send to Client, and folds submitting on the family's behalf
   into Save & Next, on the reasoning that a planner who has filled the
   form and pressed Next has said the same thing twice. FSL and GAB
   each carried two more buttons for that — one of which, "Save the
   form", asked for something that happens on every keystroke.

   The firm asked for those two to come off FSL, and they did; but only
   half the change was made, because the submit was not folded into
   Next. That left FSL with no way for an adviser to answer on the
   family's behalf at all — a worse state than before. Doing it
   properly, on both sheets, is what this covers.

   7 Events itself is not touched, by instruction. What is checked here
   is that the other two now behave as it does. */
const {suite} = require('../lib/harness');

const MK = `async (kind, tag) => {
  const now = new Date().toISOString();
  const l = {id: uid('LMS'), firstName:'ZZ Match', lastName: tag, mobile:'98000000' + tag.slice(-2),
    email:'zz.match.' + tag + '@zz.in', assignedTo: currentUser, branch: DB.config.branches[0],
    createdAt: now, transformationForm: kind, dob:'1985-04-12',
    iseqScore: 40, iseqCategory:'Moderate'};
  initState('LMS', l); DB.leads.push(l); await save('leads');
  return l.id;
}`;

const BAR = `() => {
  const bar = document.getElementById('content').querySelector('.se-stepbar');
  if(!bar) return null;
  const next = bar.querySelector('.btn.primary');
  return {buttons: Array.from(bar.querySelectorAll('button')).map(b=>b.textContent.trim()),
    next: next ? next.getAttribute('onclick') : ''};
}`;

suite(async t => {
  await t.home();

  await t.step('all three Input Forms offer the same bar', async () => {
    const r = await t.eval(async (a)=>{
      const read = async (open)=>{ await open(); await new Promise(x=>setTimeout(x, 350));
        return eval('(' + a.BAR + ')')(); };
      const se = await read(async ()=>{
        const id = await eval('(' + a.MK + ')')('SEVENEVENTS','071'); openSevenEvents(id,'input'); });
      const fsl = await read(async ()=>{
        const id = await eval('(' + a.MK + ')')('FSL','072');
        window._fslLeadId = id; window._fslStep='input'; navigate('fsl'); });
      const gab = await read(async ()=>{
        const id = await eval('(' + a.MK + ')')('GAB','073');
        window._gabLeadId = id; window._gabStep='input'; navigate('gab'); });
      return {se, fsl, gab};
    }, {MK, BAR});
    const shape = b => b.buttons.slice(0, 2).join(' | ');
    ['se','fsl','gab'].forEach(k=>{ if(!r[k]) throw new Error('no foot bar on ' + k); });
    if(shape(r.se) !== 'LMS | Send to Client')
      throw new Error('7 Events now reads "' + shape(r.se) + '" — it was not to be changed');
    ['fsl','gab'].forEach(k=>{
      if(shape(r[k]) !== shape(r.se))
        throw new Error(k.toUpperCase() + ' reads "' + shape(r[k]) + '" against 7 Events’ "' + shape(r.se) + '"');
      if(/Save the form|behalf/i.test(r[k].buttons.join(' ')))
        throw new Error(k.toUpperCase() + ' still carries a button 7 Events does not');
    });
    if(!/fslInputSaveAndNext/.test(r.fsl.next)) throw new Error('FSL’s Next is a plain save: ' + r.fsl.next);
    if(!/gabInputSaveAndNext/.test(r.gab.next)) throw new Error('GAB’s Next is a plain save: ' + r.gab.next);
    return 'LMS | Send to Client | Next on all three, and on FSL and GAB the Next submits on the way';
  });

  await t.step('Save & Next submits on the family’s behalf, as 7 Events’ does', async () => {
    const r = await t.eval(async (a)=>{
      const out = {};
      /* FSL */
      const fid = await eval('(' + a.MK + ')')('FSL','074');
      window._fslLeadId = fid; window._fslStep='input'; navigate('fsl');
      await new Promise(x=>setTimeout(x, 350));
      Object.assign(_fsl.s.personal, {dob:'1985-04-12', mobile:'9800000074', email:'zz.match.074@zz.in',
        name:'ZZ Match 074', city:'Pune', occupation:'Salaried'});
      _fsl.s.years = 10; _fsl.s.assets[0].current = 500000; _fsl.s.assets[0].monthly = 10000;
      _fsl.s.aspiration = '3'; _fsl.s.chosenLevel = '3';
      _fsl.dirty = true; fslRecompute(); await fslSaveSheet();
      const beforeF = fslInputIsIn(planRecordOf(fid), latestPlanRound(planRecordOf(fid)));
      await fslInputSaveAndNext(fid);
      out.fsl = {before: beforeF, after: fslInputIsIn(planRecordOf(fid), latestPlanRound(planRecordOf(fid))),
        step: window._fslStep};
      /* GAB */
      const gid = await eval('(' + a.MK + ')')('GAB','075');
      window._gabLeadId = gid; window._gabStep='input'; navigate('gab');
      await new Promise(x=>setTimeout(x, 350));
      const s = _gab.s;
      s.client.planDate='2026-10-16'; s.client.rm='ZZ RM'; s.client.firm='F';
      s.s1.name='ZZ Match 075'; s.s1.dobSelf='1985-04-12'; s.s1.retYear='2040';
      s.s1.fa[0].amount=2500000; s.s2[0].monthly=60000;
      s.s4.rows[0].existing=2500000; s.s4.rows[0].monthly=25000; s.s4.rows[0].ret=0.12;
      s.s3.riskProfile='Moderate';
      _gab.dirty = true; gabRecompute(); await gabSaveSheet();
      const beforeG = gabInputIsIn(planRecordOf(gid), latestPlanRound(planRecordOf(gid)));
      await gabInputSaveAndNext(gid);
      out.gab = {before: beforeG, after: gabInputIsIn(planRecordOf(gid), latestPlanRound(planRecordOf(gid))),
        step: window._gabStep};
      return out;
    }, {MK});
    ['fsl','gab'].forEach(k=>{
      if(r[k].before) throw new Error(k.toUpperCase() + ' counted the input as already in before Next');
      if(!r[k].after)
        throw new Error(k.toUpperCase() + ' did not submit on the family’s behalf — the adviser now has '
          + 'no way to do it at all');
      if(r[k].step !== 'plan') throw new Error(k.toUpperCase() + ' landed on "' + r[k].step + '"');
    });
    return 'on both sheets Next submitted the form and opened RM Working, which is the one 7 Events makes';
  });

  await t.step('and it refuses, and stays put, when the form is not answered', async () => {
    const r = await t.eval(async (a)=>{
      const fid = await eval('(' + a.MK + ')')('FSL','076');
      window._fslLeadId = fid; window._fslStep='input'; navigate('fsl');
      await new Promise(x=>setTimeout(x, 350));
      await fslInputSaveAndNext(fid);        // nothing filled in
      return {step: window._fslStep,
        inAfter: fslInputIsIn(planRecordOf(fid), latestPlanRound(planRecordOf(fid)))};
    }, {MK});
    if(r.inAfter) throw new Error('an empty form was submitted on the family’s behalf');
    if(r.step !== 'input') throw new Error('it moved on to "' + r.step + '" without the form');
    return 'an empty form is refused with the reason and the planner stays on it';
  });

  await t.step('the button says "again" once it has gone, on both', async () => {
    const r = await t.eval(async (a)=>{
      const out = {};
      const fid = await eval('(' + a.MK + ')')('FSL','077');
      await createDocLink(fid, 'FSL');
      window._fslLeadId = fid; window._fslStep='input'; navigate('fsl');
      await new Promise(x=>setTimeout(x, 350));
      out.fsl = eval('(' + a.BAR + ')')().buttons.join(' | ');
      const gid = await eval('(' + a.MK + ')')('GAB','078');
      await createDocLink(gid, 'GAB');
      window._gabLeadId = gid; window._gabStep='input'; navigate('gab');
      await new Promise(x=>setTimeout(x, 350));
      out.gab = eval('(' + a.BAR + ')')().buttons.join(' | ');
      return out;
    }, {MK, BAR});
    ['fsl','gab'].forEach(k=>{
      if(!/Send to Client again/.test(r[k]))
        throw new Error(k.toUpperCase() + ' still says "Send to Client" after one has gone: ' + r[k]);
    });
    return 'both read "Send to Client again" once a link has gone out, the way 7 Events does';
  });

  await t.step('the stage panel offers the form and the next step, and nothing else', async () => {
    const r = await t.eval(()=>{
      const src = {fsl: String(fslDataGatheringPanelHtml || ''), gab: String(gabDataGatheringPanelHtml || '')};
      return src;
    }).catch(()=>null);
    /* The two panels are inline in their blueprint's stage file, so they are
       read off a rendered lead rather than by name. */
    const got = await t.eval(()=>{
      const out = {};
      const html = document.body.innerHTML;
      out.fslHasExtra = /openFsl\([^)]*'plan'\)/.test(html);
      out.gabHasExtra = /openGab\([^)]*'plan'\)/.test(html);
      /* read the source of the page instead: the panel builders are plain
         functions in the one file */
      const all = Object.getOwnPropertyNames(window)
        .filter(k=>{ try { return typeof window[k] === 'function'
          && /Send it to the client again/.test(String(window[k])); } catch(e){ return false; } });
      return {panels: all};
    });
    const stillAsking = got.panels.filter(n=>/fsl|gab/i.test(n));
    if(stillAsking.length)
      throw new Error('these still offer "Send it to the client again": ' + stillAsking.join(', '));
    return 'neither FSL nor GAB’s panel carries the extra buttons the firm asked to have removed';
  });
});
