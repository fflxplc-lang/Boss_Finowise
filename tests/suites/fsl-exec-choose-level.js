/* THE LEVEL THE ROOM SETTLES ON.

   The plan is written for a level and approved at it. What the family
   agrees to in the meeting may be a different rung — they hear what
   Level 4 asks for and take it, or look at Level 3 and ask for Level 2.
   Section D already works every rung out, so the Required Execution
   Plan now opens with a Choose FSL on the level the plan was written
   for and lets it be changed; every figure under it follows.

   Three things this must get right. The plan itself is not rewritten:
   what the reporting manager approved stays approved, and the ladder
   and the client's copy still read the level it was written for. The
   required figures move to the chosen rung, the agreed figures are
   typed against it, and both reach the Final Execution Plan under that
   rung's name. And a level that is no longer being executed leaves no
   allocation line behind.

   Action points came off the page with it, so this checks they are
   gone from the page and that nothing already raised from one broke. */
const {suite} = require('../lib/harness');

const SETUP = `async (tag) => {
  const l = {id: uid('LMS'), firstName:'ZZ Choose', lastName: tag, mobile:'98000005' + tag,
    email:'zz.choose.' + tag + '@zz.in', assignedTo: currentUser, branch: DB.config.branches[0],
    createdAt:new Date().toISOString(), transformationForm:'FSL', dob:'1985-04-12',
    iseqScore: 44, iseqCategory:'Moderate'};
  initState('LMS', l); DB.leads.push(l); await save('leads');
  window._fslLeadId = l.id; window._fslStep = 'input';
  navigate('fsl');
  await new Promise(r=>setTimeout(r, 400));
  Object.assign(_fsl.s.personal, {name:'ZZ Choose ' + tag, mobile:'98000005' + tag,
    email:'zz.choose.' + tag + '@zz.in', dob:'1985-04-12'});
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

  t.section('Choose FSL');

  await t.step('it opens on the level the plan was written for', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const id = await (${SETUP})("01");
      const box = document.querySelector('[data-fslp="exec.level"]');
      const titles = Array.from(document.querySelectorAll('.se-card .section-title'))
        .map(x=>x.textContent.trim());
      return {id, titles, box: !!box, value: box ? box.value : null,
              planned: String((((_fsl.C||{}).chosen)||{}).lvl || ''),
              picked: String((fslExecLevel(_fsl.C)||{}).lvl || ''),
              stored: String((_fsl.s.exec||{}).level || ''),
              options: box ? Array.from(box.options).length : 0};
    })()`));
    if(titles_missing(r.titles)) throw new Error('there is no Choose FSL card: ' + r.titles.join(', '));
    if(!r.box) throw new Error('there is no level box on it');
    if(!r.planned) throw new Error('the plan has no level, so this proves nothing');
    if(r.picked !== r.planned)
      throw new Error('it opened on Level ' + r.picked + ', not the plan’s Level ' + r.planned);
    if(r.value !== r.planned)
      throw new Error('the box reads "' + r.value + '" rather than the plan\u2019s Level ' + r.planned);
    if(r.stored !== r.planned)
      throw new Error('the preselection was not written down: "' + r.stored + '"');
    if(r.options < 6) throw new Error('only ' + r.options + ' levels to choose from');
    return 'Choose FSL first on the page, preselected on the plan\u2019s Level ' + r.planned
         + ' and written down, ' + r.options + ' to choose from';
    function titles_missing(ts){ return ts.indexOf('Choose FSL') !== 0; }
  });

  await t.step('and the action points card is gone from the page', async () => {
    const r = await t.eval(()=>({
      titles: Array.from(document.querySelectorAll('.se-card .section-title')).map(x=>x.textContent.trim()),
      boxes: Array.from(document.querySelectorAll('[data-fslp^="exec."]')).map(e=>e.getAttribute('data-fslp')),
      sync: typeof fslAddAction === 'function' && typeof seActionTaskHtml === 'function',
    }));
    if(r.titles.some(x=>/action point/i.test(x)))
      throw new Error('it is still there: ' + r.titles.join(', '));
    if(r.boxes.some(k=>/^exec\.actions/.test(k) || k === 'exec.overall'))
      throw new Error('its boxes are still drawn: ' + r.boxes.join(', '));
    if(!r.sync) throw new Error('the task sync behind it was removed too, which would orphan existing tasks');
    return 'gone from the page; the sync that raised existing tasks is untouched. Page now: '
         + r.titles.join(' · ');
  });

  t.section('changing it');

  await t.step('the required figures follow the rung chosen', async () => {
    const r = await t.eval(async ()=>{
      const before = fslExecRows(planRecordOf(window._fslLeadId))[0];
      const levels = (_fsl.C.levels||[]).filter(l=>!l.achieved);
      const other = levels.find(l=>String(l.lvl) !== String(before.level));
      _fsl.s.exec.level = String(other.lvl);
      _fsl.dirty = true; fslRecompute(); fslRedraw();
      await new Promise(r=>setTimeout(r, 400));
      const after = fslExecRows(planRecordOf(window._fslLeadId))[0];
      return {before: {lvl: before.level, lump: before.lump, sip: before.sip, name: before.name},
              after:  {lvl: after.level,  lump: after.lump,  sip: after.sip,  name: after.name},
              want: {lump: other.lump, sip: other.sip},
              plan: String(_fsl.s.chosenLevel||''),
              warn: /Different from the plan/.test((document.getElementById('root')||{}).textContent||'')};
    });
    if(r.after.lvl === r.before.lvl) throw new Error('the level did not change');
    if(Math.round(r.after.lump) !== Math.round(r.want.lump))
      throw new Error('the required one-time is ' + r.after.lump + ', not Level ' + r.after.lvl + '’s ' + r.want.lump);
    if(Math.round(r.after.sip) !== Math.round(r.want.sip))
      throw new Error('the required monthly is ' + r.after.sip + ', not ' + r.want.sip);
    if(r.after.name.indexOf('Level ' + r.after.lvl) < 0)
      throw new Error('the row is still named "' + r.after.name + '"');
    if(r.plan !== String(r.before.lvl))
      throw new Error('it rewrote the plan’s own level to ' + r.plan);
    if(!r.warn) throw new Error('nothing says this differs from the approved plan');
    return 'Level ' + r.before.lvl + ' → ' + r.after.lvl + ': required ' + money0(r.after.lump)
         + ' / ' + money0(r.after.sip) + ' a month, the plan still written for Level ' + r.plan
         + ', and the page says they differ';
    function money0(x){ return Math.round(Number(x)||0); }
  });

  await t.step('the agreed figures are written down as business under that rung', async () => {
    const r = await t.eval(async ()=>{
      const id = window._fslLeadId;
      const lvl = fslExecRows(planRecordOf(id))[0].level;
      const name = fslExecRows(planRecordOf(id))[0].name;
      _fsl.s.exec.agreedLump = 1500000;
      _fsl.s.exec.agreedSip = 30000;
      _fsl.dirty = true; await fslSaveSheet();
      await fslUpdateDbt(id);
      await new Promise(r=>setTimeout(r, 800));
      const round = latestPlanRound(planRecordOf(id));
      const lines = (round.allocation||{}).lines || [];
      const round0 = latestPlanRound(planRecordOf(id));
      return {step: window._fslStep, dbts: planDbtsFor(id, round0.n).length, lvl, name,
              labels: lines.map(l=>l.label),
              lump: lines.filter(l=>!allocLineIsSip(l)).reduce((a,l)=>a+(Number(l.amount)||0),0),
              sip: lines.filter(l=>allocLineIsSip(l)).reduce((a,l)=>a+(Number(l.amount)||0),0),
              rounds: planRoundsOf(planRecordOf(id)).length};
    });
    if(!r.dbts) throw new Error('no DBT was written from the agreed figures');
    if(r.lump !== 1500000) throw new Error('the agreed one-time came through as ' + r.lump);
    if(r.sip !== 30000) throw new Error('the agreed monthly came through as ' + r.sip);
    if(r.labels.some(l=>l !== r.name))
      throw new Error('a line from a level no longer being executed is still there: ' + r.labels.join(' | '));
    if(r.rounds !== 1) throw new Error('a second plan was made: ' + r.rounds + ' rounds');
    return r.labels.length + ' line(s), all under "' + r.name + '" — nothing left from the old rung';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
