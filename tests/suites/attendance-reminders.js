/* A REMINDER THAT ONLY FIRES ONCE IS NOT A REMINDER.

   Somebody who forgets to punch in at nine is not helped by a message
   that appears at 9:10 and is gone by the time they look up from what
   they were doing. So these come back at a configured interval until
   the thing they are asking for is done, and stop the moment it is.

   They sit outside #root, so a render cannot wipe them and they are
   on screen whichever module somebody is working in. They never punch
   on anybody's behalf.

   And nobody is nagged on a day they are not working: an approved
   leave, a weekly off and a holiday each silence both, read from the
   same configuration the rest of attendance reads. */
const {suite} = require('../lib/harness');

const AT = (hh, mm) => `(()=>{ const d = new Date(); d.setHours(${hh}, ${mm}, 0, 0); return d; })()`;

suite(async t => {

  const setup = async (cfg)=>t.eval(async (c)=>{
    DB.hrConfig = Object.assign({}, DB.hrConfig, {
      location: {required: false, note: ''},
      activity: {enabled: false, idleMinutes: '', beatSeconds: 30, saveSeconds: 120},
      reminders: Object.assign({enabled: true, inAfter: '09:10', outAfter: '19:00',
        repeatMinutes: 30}, c || {}),
      weeklyOff: [], holidays: [],
      /* open all day, every day: this suite is not about the punch clock's hours */
      day: Object.assign({}, (DB.hrConfig || {}).day, {punchInFrom: '00:00', punchOutUntil: '23:59'})});
    window.hrClosedDayWhy = () => ''; window.hrIsSunday = () => false;
    DB.hrAttendance = []; DB.hrLeave = [];
    await save('hrConfig'); await save('hrAttendance'); await save('hrLeave');
    hrNudgeClear();
    return true;
  }, cfg || {});

  /* The clock is moved rather than waited for: the reminder decides
     from the wall clock, so the configured times are set around now. */
  const nowPlus = (mins)=>t.eval((m)=>{
    const d = new Date(Date.now() + m * 60000);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }, mins);

  t.section('punch in');

  await t.step('nothing before the hour, a reminder after it', async () => {
    await setup();
    const soon = await nowPlus(5);
    const past = await nowPlus(-5);
    const r = await t.eval(async (times)=>{
      DB.hrConfig.reminders.inAfter = times.soon;
      hrNudgeTick();
      const before = {due: !!hrNudgeDue(), on: document.getElementById('hrNudge').classList.contains('on')};
      DB.hrConfig.reminders.inAfter = times.past;
      hrNudgeClear(); hrNudgeTick();
      const el = document.getElementById('hrNudge');
      return {before, after: {due: (hrNudgeDue() || {}).key, on: el.classList.contains('on'),
              text: el.textContent.replace(/\s+/g, ' ').trim(),
              hasButton: el.innerHTML.indexOf('hrPunchIn()') >= 0,
              outsideRoot: !document.getElementById('root').contains(el)}};
    }, {soon, past});
    if(r.before.due || r.before.on) throw new Error('it nagged before the configured time');
    if(r.after.due !== 'in' || !r.after.on) throw new Error('it did not appear after it');
    if(!r.after.hasButton) throw new Error('and it offers no way to punch in');
    if(!r.after.outsideRoot) throw new Error('it lives inside #root, so a render would wipe it');
    if(!/have not punched in/.test(r.after.text)) throw new Error('it says: ' + r.after.text);
    return '“' + r.after.text.slice(0, 54) + '…”, outside #root so every module shows it';
  });

  await t.step('it comes back at the interval, not once', async () => {
    const r = await t.eval(()=>{
      const el = document.getElementById('hrNudge');
      /* Dismissed, then the interval passes. */
      hrNudgeSnooze('in');
      const dismissed = el.classList.contains('on');
      hrNudgeTick();
      const stillQuiet = el.classList.contains('on');
      hrNudgeState.snoozedTo.in = Date.now() - 1;        // the interval has gone by
      hrNudgeState.shownAt.in = Date.now() - 99 * 60000;
      hrNudgeTick();
      return {dismissed, stillQuiet, back: el.classList.contains('on')};
    });
    if(r.dismissed) throw new Error('dismissing it did not take it off the screen');
    if(r.stillQuiet) throw new Error('it came straight back inside the interval');
    if(!r.back) throw new Error('and it never came back at all');
    return 'dismissed, quiet for the interval, then back — until it is done';
  });

  await t.step('a punch in stops it dead, and nothing punched for anybody', async () => {
    const r = await t.eval(async ()=>{
      const before = (hrNudgeDue() || {}).key;
      await hrPunchIn();
      hrNudgeTick();
      const el = document.getElementById('hrNudge');
      const rec = hrAttendanceOf(me().id, hrToday());
      return {before, after: hrNudgeDue(), on: el.classList.contains('on'),
              sessions: (rec.sessions || []).length, byMe: (rec.sessions || [])[0].inBy === me().id};
    });
    if(r.before !== 'in') throw new Error('it was not asking before the punch');
    if(r.after || r.on) throw new Error('it is still asking after the punch');
    if(r.sessions !== 1) throw new Error('the punch produced ' + r.sessions + ' sessions');
    if(!r.byMe) throw new Error('the punch is not attributed to the person');
    return 'gone the moment the punch landed, one session, theirs';
  });

  t.section('punch out');

  await t.step('an open session past the hour is asked about, and only then', async () => {
    const soon = await nowPlus(5);
    const past = await nowPlus(-5);
    const r = await t.eval((times)=>{
      DB.hrConfig.reminders.outAfter = times.soon;
      hrNudgeClear();
      const before = (hrNudgeDue() || {}).key;
      DB.hrConfig.reminders.outAfter = times.past;
      hrNudgeClear(); hrNudgeTick();
      const el = document.getElementById('hrNudge');
      return {before, after: (hrNudgeDue() || {}).key,
              hasButton: el.innerHTML.indexOf('hrPunchOut()') >= 0,
              text: el.textContent.replace(/\s+/g, ' ').trim()};
    }, {soon, past});
    if(r.before) throw new Error('it asked before the configured time: ' + r.before);
    if(r.after !== 'out') throw new Error('it did not ask after it');
    if(!r.hasButton) throw new Error('and it offers no way to punch out');
    if(!/still punched in/.test(r.text)) throw new Error('it says: ' + r.text);
    return '“' + r.text.slice(0, 50) + '…”';
  });

  await t.step('and a punch out stops it', async () => {
    const r = await t.eval(async ()=>{
      await hrPunchOut();
      hrNudgeTick();
      return {due: hrNudgeDue(), on: document.getElementById('hrNudge').classList.contains('on')};
    });
    if(r.due || r.on) throw new Error('it is still asking after the punch out');
    return 'gone';
  });

  t.section('and not on a day nobody is working');

  await t.step('approved leave, a weekly off and a holiday each silence it', async () => {
    const past = await nowPlus(-5);
    const r = await t.eval(async (p)=>{
      DB.hrAttendance = []; await save('hrAttendance');
      DB.hrConfig.reminders.inAfter = p;
      const say = () => { hrNudgeClear(); return !!hrNudgeDue(); };
      const plain = say();
      DB.hrLeave = [{id:'LV-ZZ', userId: me().id, status:'Approved', type:'Casual',
        from: hrToday(), to: hrToday()}];
      const onLeave = say();
      DB.hrLeave = [];
      const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      DB.hrConfig.weeklyOff = [names[new Date().getDay()]];
      const onOff = say();
      DB.hrConfig.weeklyOff = [];
      DB.hrConfig.holidays = [{date: hrToday(), name:'ZZ Founders Day'}];
      const onHoliday = say();
      DB.hrConfig.holidays = [];
      return {plain, onLeave, onOff, onHoliday, after: say()};
    }, past);
    if(!r.plain) throw new Error('it was not asking on an ordinary day');
    if(r.onLeave) throw new Error('it nagged somebody on approved leave');
    if(r.onOff) throw new Error('it nagged somebody on a weekly off');
    if(r.onHoliday) throw new Error('it nagged somebody on a holiday');
    if(!r.after) throw new Error('and it stayed quiet once the exception was gone');
    return 'quiet on leave, on a weekly off and on a holiday; asking again on an ordinary day';
  });

  await t.step('switched off in Setup, it says nothing at all', async () => {
    const r = await t.eval(()=>{
      DB.hrConfig.reminders.enabled = false;
      hrNudgeClear();
      const off = !!hrNudgeDue();
      DB.hrConfig.reminders.enabled = true;
      hrNudgeClear();
      return {off, on: !!hrNudgeDue()};
    });
    if(r.off) throw new Error('it ignored the switch');
    if(!r.on) throw new Error('and it did not come back when switched on');
    return 'off means off';
  });

  await t.step('nothing was alerted but the headless browser having no GPS', async () => {
    const stray = t.dialogs.filter(d=>!/Your location was not recorded/.test(String(d)));
    if(stray.length) throw new Error('alerts: ' + stray.join(' | ').slice(0, 220));
    return 'only the location notices';
  });
});
