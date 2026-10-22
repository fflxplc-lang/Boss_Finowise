/* THE HORIZON IS A SUM, SO IT IS NOT ASKED FOR.

   It was a text box beside the target date. A goal dated 2047 could
   read "15 years" because somebody typed that in 2032, or read nothing
   at all because the box is easy to skip. It is the target date less
   today, and the firm asked for it to be worked out.

   Three forms raise a goal — CMS Goal Planning, the one a completed
   DBT offers, and the one a transaction offers once its units are
   allotted — and they were three copies that had already drifted.
   They are one now, which is how all three got this at once. */
const {suite} = require('../lib/harness');

const inYears = n => {
  const d = new Date(); d.setHours(0,0,0,0);
  d.setFullYear(d.getFullYear() + n);
  return d.toISOString().slice(0,10);
};

suite(async t => {
  await t.home();

  t.section('the sum itself');

  await t.step('it reads the gap between today and the target date', async () => {
    const r = await t.eval(()=>{
      const on = n => { const d = new Date(); d.setHours(0,0,0,0);
                        d.setMonth(d.getMonth() + n); return d.toISOString().slice(0,10); };
      return {y15: goalHorizonFrom(on(180)), y1: goalHorizonFrom(on(12)),
              m7: goalHorizonFrom(on(7)), m1: goalHorizonFrom(on(1)),
              mixed: goalHorizonFrom(on(27)), none: goalHorizonFrom(''),
              today: goalHorizonFrom(on(0)), past: goalHorizonFrom(on(-6)),
              junk: goalHorizonFrom('not a date')};
    });
    if(r.y15 !== '15 years') throw new Error('180 months reads "' + r.y15 + '"');
    if(r.y1 !== '1 year') throw new Error('12 months reads "' + r.y1 + '" — it should not be plural');
    if(r.m7 !== '7 months') throw new Error('7 months reads "' + r.m7 + '"');
    if(r.m1 !== '1 month') throw new Error('1 month reads "' + r.m1 + '"');
    if(r.mixed !== '2 years 3 months') throw new Error('27 months reads "' + r.mixed + '"');
    if(r.today !== 'under a month') throw new Error('today reads "' + r.today + '"');
    if(!/passed/.test(r.past)) throw new Error('a date gone by reads "' + r.past + '"');
    if(r.none !== '' || r.junk !== '')
      throw new Error('no date gave "' + r.none + '" and nonsense gave "' + r.junk + '"');
    return '15 years, 1 year, 7 months, 2 years 3 months — singular where it should be, '
      + 'and nothing at all where there is no date to work from';
  });

  t.section('on the form');

  await t.step('it fills itself when the date is picked, and cannot be typed into', async () => {
    const r = await t.eval(d=>{
      const c = DB.clients.find(x=>!x.deletedAt);
      openGoalForm('', c.id);
      const box = document.getElementById('f_glHorizon');
      const before = box.value;
      document.getElementById('f_glDate').value = d;
      goalHorizonPaint();
      const after = box.value;
      const locked = box.readOnly;
      closeModal();
      return {before, after, locked};
    }, inYears(20));
    if(r.before) throw new Error('it opened holding "' + r.before + '" with no date set');
    if(!/20 years/.test(r.after)) throw new Error('after a 20-year date it reads "' + r.after + '"');
    if(!r.locked) throw new Error('the box can still be typed into, so it can still disagree with the date');
    return 'blank until a date is picked, then 20 years, and read-only either way';
  });

  await t.step('all three forms that raise a goal ask it the same way', async () => {
    const r = await t.eval(()=>{
      const s = Array.from(document.querySelectorAll('script')).map(x=>x.textContent).join('\n');
      /* One renderer, and no form building the fields itself. */
      return {renderer: (s.match(/goalFieldsHtml\(/g) || []).length,
              strays: (s.match(/id="f_glHorizon"/g) || []).length,
              users: ['openGoalForm','openBusinessNewGoal','openTxnNewGoal']
                .filter(fn=>typeof window[fn] === 'function')};
    });
    if(r.users.length !== 3) throw new Error('only these raise a goal: ' + r.users.join(', '));
    if(r.strays !== 1) throw new Error(r.strays + ' copies of the Horizon box — the forms have drifted apart again');
    if(r.renderer < 4) throw new Error('the three forms do not all go through one renderer');
    return 'three ways in, one form, one Horizon box';
  });

  t.section('and what is saved is the sum, not the box');

  await t.step('the figure stored is worked out again at save', async () => {
    const r = await t.eval(async d=>{
      const c = DB.clients.find(x=>!x.deletedAt);
      DB.clientGoals = DB.clientGoals.filter(g=>g.name !== 'ZZ Horizon Goal');
      openGoalForm('', c.id);
      document.getElementById('f_glName').value = 'ZZ Horizon Goal';
      document.getElementById('f_glTarget').value = '20000000';
      document.getElementById('f_glDate').value = d;
      /* Left holding something else entirely, as a stale box would be. */
      document.getElementById('f_glHorizon').value = 'ZZ nonsense';
      await saveGoal('', c.id);
      const g = DB.clientGoals.find(x=>x.name === 'ZZ Horizon Goal');
      return {horizon: g ? g.horizon : '', date: g ? g.targetDate : ''};
    }, inYears(21));
    if(/nonsense/.test(r.horizon))
      throw new Error('it stored what the box was left holding: "' + r.horizon + '"');
    if(!/21 years/.test(r.horizon)) throw new Error('it stored "' + r.horizon + '"');
    return 'the box was left saying something else and the goal still stored 21 years';
  });

  await t.step('and an older goal re-reads it from its date rather than its own stale text', async () => {
    const r = await t.eval(d=>{
      const g = DB.clientGoals.find(x=>x.name === 'ZZ Horizon Goal');
      g.horizon = '3 years';                      // as typed years ago
      g.targetDate = d;
      openGoalForm(g.id, g.clientId);
      const shown = document.getElementById('f_glHorizon').value;
      closeModal();
      /* With no date there is nothing to work it out from, so what it
         says is what it keeps. */
      g.targetDate = '';
      openGoalForm(g.id, g.clientId);
      const noDate = document.getElementById('f_glHorizon').value;
      closeModal();
      return {shown, noDate};
    }, inYears(21));
    if(!/21 years/.test(r.shown))
      throw new Error('it opened on the stale "' + r.shown + '" rather than on its date');
    if(r.noDate !== '3 years')
      throw new Error('with no date it should keep what it says, but reads "' + r.noDate + '"');
    return 'a date on it wins over the text; no date and the text stands';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
