/* ELAPSED IS NOT ACTIVE, AND NEITHER OF THEM IS "WE DON'T KNOW".

   Punched in at nine, it is now two: that is five hours elapsed, and
   it says nothing about whether anybody was working. Actual active
   time is a different number and must never be printed as though it
   were the same one.

   BOSS writes a heartbeat while a session is open. A beat that lands
   when it should, with input behind it, extends an ACTIVE span. A beat
   that lands when it should with no input for longer than the
   configured threshold opens an IDLE span — inactivity BOSS actually
   watched happen. A beat that is late, or never came, means BOSS was
   not running at all: the tab was shut, the machine slept, the browser
   suspended the timer. That is AWAY, and it is reported as unmeasured
   rather than guessed at in either direction, because a page in a
   browser genuinely cannot see a screen go off or a workstation lock.

   The threshold is not invented. It ships empty, and while it is empty
   nothing is separated out as idle and the screen says so.

   And none of it ends a session: closing the tab does not punch
   anybody out. */
const {suite} = require('../lib/harness');

/* The beat is driven directly rather than waited for, so a test of an
   eight-hour day does not take eight hours. */
const SEED = async ()=>{
  const u = me();
  DB.hrConfig = Object.assign({}, DB.hrConfig, {
    location: {required: false, note: ''},
    activity: {enabled: true, idleMinutes: 5, beatSeconds: 30, saveSeconds: 120},
    reminders: {enabled: true, inAfter: '09:10', outAfter: '19:00', repeatMinutes: 30},
    weeklyOff: [], holidays: [],
    /* open all day, every day: this suite is not about the punch clock's hours */
    day: Object.assign({}, (DB.hrConfig || {}).day, {punchInFrom: '00:00', punchOutUntil: '23:59'})});
  window.hrClosedDayWhy = () => ''; window.hrIsSunday = () => false;
  DB.hrAttendance = [];
  DB.hrLeave = [];
  await save('hrConfig'); await save('hrAttendance'); await save('hrLeave');
  return u.id;
};

suite(async t => {

  t.section('the threshold the firm set');

  await t.step('five minutes ships as the default, and a blank falls back to it', async () => {
    const r = await t.eval(async ()=>{
      const was = DB.hrConfig;
      DB.hrConfig = {};
      const fresh = hrActCfg();
      /* A config saved while the threshold was still blank must not
         pin it to blank for ever. */
      DB.hrConfig = {activity: {enabled: true, idleMinutes: '', beatSeconds: 30, saveSeconds: 120}};
      const blanked = hrActCfg();
      DB.hrConfig = {activity: {enabled: true, idleMinutes: 12, beatSeconds: 30, saveSeconds: 120}};
      const chosen = hrActCfg();
      DB.hrConfig = was;
      return {fresh: {min: fresh.idleMs / 60000, set: fresh.idleSet},
              blanked: {min: blanked.idleMs / 60000, set: blanked.idleSet},
              chosen: {min: chosen.idleMs / 60000, set: chosen.idleSet}};
    });
    if(r.fresh.min !== 5 || !r.fresh.set)
      throw new Error('a firm with no HR config gets ' + JSON.stringify(r.fresh));
    if(r.blanked.min !== 5 || !r.blanked.set)
      throw new Error('a stored blank pinned it to nothing: ' + JSON.stringify(r.blanked));
    if(r.chosen.min !== 12) throw new Error('a chosen number did not win: ' + JSON.stringify(r.chosen));
    return '5 minutes out of the box, 5 where a blank was stored, 12 where somebody chose 12';
  });

  t.section('the counter starts at the punch, and not before');

  await t.step('no session, no accumulation', async () => {
    const r = await t.eval(async ()=>{
      await (async()=>{})();
      const id = await (async()=>{ return null; })();
      return {before: hrDayTimes(hrAttendanceOf(me().id, hrToday()))};
    });
    if(r.before.activeMs || r.before.elapsedMs)
      throw new Error('time accumulated with nobody punched in');
    return 'nothing is counted against a day nobody punched into';
  });

  await t.step('a punch opens the session and the first beat is active', async () => {
    await t.eval(SEED);
    const r = await t.eval(async ()=>{
      await hrPunchIn();
      const rec = hrAttendanceOf(me().id, hrToday());
      const s = hrOpenSession(rec);
      await new Promise(r=>setTimeout(r, 1200));
      hrAct.lastInput = Date.now();
      hrAct.lastBeat = Date.now() - 1000;
      await hrActBeat(true);
      const t1 = hrSessionTimes(hrOpenSession(hrAttendanceOf(me().id, hrToday())));
      return {open: !!s, kinds: (hrOpenSession(rec).spans || []).map(x=>x.kind),
              active: Math.round(t1.activeMs / 100) / 10, idle: t1.idleMs, away: t1.awayMs};
    });
    if(!r.open) throw new Error('the punch did not open a session');
    if(r.kinds.join(',') !== 'active') throw new Error('the first span is ' + r.kinds.join(','));
    if(r.active < 0.8 || r.active > 1.6) throw new Error('one second became ' + r.active);
    if(r.idle || r.away) throw new Error('something was counted as idle or unmeasured');
    return 'the punch opened the session and the first beat counted ' + r.active + 's of it as active';
  });

  await t.step('a day cannot be waited through, so one is laid down to drive', async () => {
    /* The server keeps attendance append-only \u2014 a punch-in time
       already written cannot be moved, which is exactly right and is
       why the backdated session below is laid down as a new record
       after a full wipe rather than by editing the one just punched.
       Everything after this drives the real engine against it. */
    const r = await t.eval(async ()=>{
      DB.hrAttendance = [];
      await save('hrAttendance');
      const rec = {id: uid('HRA'), userId: me().id, date: hrToday(),
        sessions: [{in: new Date(Date.now() - 4 * 3600 * 1000).toISOString(), out: null,
                    inBy: me().id, inLoc: null, spans: []}],
        createdAt: new Date().toISOString(), createdBy: me().id};
      DB.hrAttendance = [rec];
      await save('hrAttendance');
      const back = (await sget('hrAttendance', [])) || [];
      return {accepted: back.length === 1, open: !!hrOpenSession(hrAttendanceOf(me().id, hrToday()))};
    });
    if(!r.accepted) throw new Error('the server refused the fixture');
    if(!r.open) throw new Error('there is no open session to drive');
    return 'a four-hour session on file, which the append-only guard accepted as a new record';
  });

  t.section('what the browser can actually see');

  await t.step('no input past the threshold is idle, not active', async () => {
    const r = await t.eval(async ()=>{
      /* Twenty seconds of real work first, then twenty with the last
         input ten minutes ago, against a five-minute threshold. */
      hrAct.lastInput = Date.now();
      hrAct.lastBeat = Date.now() - 40000;
      await hrActBeat(true);
      hrAct.lastInput = Date.now() - 10 * 60000;
      hrAct.lastBeat = Date.now() - 20000;
      await hrActBeat(true);
      const s = hrOpenSession(hrAttendanceOf(me().id, hrToday()));
      const times = hrSessionTimes(s);
      return {kinds: (s.spans || []).map(x=>x.kind),
              idle: Math.round(times.idleMs / 1000), active: Math.round(times.activeMs / 1000)};
    });
    if(r.kinds.join(',') !== 'active,idle')
      throw new Error('the spans read ' + r.kinds.join(','));
    if(r.idle < 19 || r.idle > 22) throw new Error('the idle stretch is ' + r.idle + 's');
    if(r.active < 39 || r.active > 42) throw new Error('the active stretch moved to ' + r.active + 's');
    return '40s active then 20s idle — the idle stretch is its own span, and the active one it followed '
      + 'is untouched';
  });

  await t.step('input again resumes it, with nobody pressing anything', async () => {
    const r = await t.eval(async ()=>{
      hrAct.lastInput = Date.now();
      hrAct.lastBeat = Date.now() - 20000;
      await hrActBeat(true);
      const s = hrOpenSession(hrAttendanceOf(me().id, hrToday()));
      return {kinds: (s.spans || []).map(x=>x.kind),
              active: Math.round(hrSessionTimes(s).activeMs / 1000)};
    });
    if(r.kinds.join(',') !== 'active,idle,active')
      throw new Error('the spans read ' + r.kinds.join(','));
    if(r.active < 59 || r.active > 62) throw new Error('active came to ' + r.active + 's, expected ~60');
    return 'back to active on its own — 60s active, 20s idle, no manual resume';
  });

  await t.step('a beat that never came is unmeasured, not active and not idle', async () => {
    const r = await t.eval(async ()=>{
      /* Two hours with no beat at all: the tab was shut, or the
         machine slept. BOSS was not there and does not pretend. */
      hrAct.lastInput = Date.now();
      hrAct.lastBeat = Date.now() - 2 * 3600 * 1000;   // inside the backdated session
      await hrActBeat(true);
      const s = hrOpenSession(hrAttendanceOf(me().id, hrToday()));
      const times = hrSessionTimes(s);
      return {kinds: (s.spans || []).map(x=>x.kind),
              away: Math.round(times.awayMs / 60000), active: Math.round(times.activeMs / 1000),
              idle: Math.round(times.idleMs / 1000)};
    });
    if(r.kinds.slice(-1)[0] !== 'away') throw new Error('the last span is ' + r.kinds.slice(-1)[0]);
    if(r.away !== 120) throw new Error('two hours of absence came to ' + r.away + ' minutes');
    if(r.active > 62) throw new Error('some of it was counted as active: ' + r.active + 's');
    if(r.idle > 22) throw new Error('some of it was counted as idle: ' + r.idle + 's');
    return 'two hours unmeasured; active and idle both exactly where they were';
  });

  await t.step('and the session is still open — a closed tab is not a punch out', async () => {
    const r = await t.eval(()=>{
      const rec = hrAttendanceOf(me().id, hrToday());
      return {open: !!hrOpenSession(rec), status: hrDayStatus(me().id, hrToday(), rec).code};
    });
    if(!r.open) throw new Error('the session was closed by an absence');
    if(r.status !== 'in') throw new Error('the day reads "' + r.status + '"');
    return 'still punched in, exactly as before';
  });

  t.section('reconciling after a reload');

  await t.step('the stretch BOSS was away for is closed off before counting resumes', async () => {
    const r = await t.eval(async ()=>{
      const s = hrOpenSession(hrAttendanceOf(me().id, hrToday()));
      const before = (s.spans || []).length;
      /* What a reload looks like: the heartbeat state is gone and the
         record carries a last-beat stamp from half an hour ago. */
      s.lastBeatAt = new Date(Date.now() - 30 * 60000).toISOString();
      hrAct.lastBeat = 0;
      await hrActReconcile();
      const after = hrOpenSession(hrAttendanceOf(me().id, hrToday()));
      const times = hrSessionTimes(after);
      return {before, added: (after.spans || []).length - before,
              lastKind: (after.spans || []).slice(-1)[0].kind,
              away: Math.round(times.awayMs / 60000)};
    });
    if(r.added !== 1 || r.lastKind !== 'away')
      throw new Error('a reload added ' + r.added + ' span(s), last ' + r.lastKind);
    if(r.away !== 150) throw new Error('120 + 30 minutes away should be 150, it is ' + r.away);
    return 'half an hour of absence written down as unmeasured, not quietly added to active';
  });

  t.section('elapsed and active are different numbers');

  await t.step('and are reported as different numbers', async () => {
    const r = await t.eval(()=>{
      const rec = hrAttendanceOf(me().id, hrToday());
      const t2 = hrDayTimes(rec);
      const html = hrTimesHtml(rec);
      return {elapsed: t2.elapsedMs, active: t2.activeMs, away: t2.awayMs,
              four: ['elapsed','active','idle','away'].every(k=>html.indexOf('data-hrtime="' + k + '"') >= 0),
              saysLimit: /cannot see a screen going off|cannot see a screen go off/.test(html),
              saysAgent: /desktop agent/.test(html)};
    });
    if(r.elapsed <= r.active) throw new Error('elapsed is not greater than active');
    if(!r.four) throw new Error('the screen does not print all four figures separately');
    if(!r.saysLimit || !r.saysAgent)
      throw new Error('the screen does not state what a browser cannot see');
    return 'four separate figures, and the limits written on the screen rather than implied';
  });

  await t.step('punching out closes the books and keeps them', async () => {
    const r = await t.eval(async ()=>{
      const before = hrSessionTimes(hrOpenSession(hrAttendanceOf(me().id, hrToday())));
      await hrPunchOut();
      const rec = hrAttendanceOf(me().id, hrToday());
      const s = (rec.sessions || [])[0];
      const after = hrSessionTimes(s);
      return {open: !!hrOpenSession(rec), out: !!s.out,
              activeKept: Math.abs(after.activeMs - before.activeMs) < 65000,
              active: Math.round(after.activeMs / 1000)};
    });
    if(r.open || !r.out) throw new Error('the punch out did not close the session');
    if(!r.activeKept) throw new Error('the active total moved on punch out');
    return 'session closed, active time ' + r.active + 's and still there afterwards';
  });

  await t.step('nothing was alerted but the headless browser having no GPS', async () => {
    /* There is no location device behind a test browser, so each punch
       says so. That is the designed behaviour with location not
       required: the punch stands and says plainly that it has no
       reading, rather than inventing one. */
    const stray = t.dialogs.filter(d=>!/Your location was not recorded/.test(String(d)));
    if(stray.length) throw new Error('alerts: ' + stray.join(' | ').slice(0, 220));
    return 'only the two “location not recorded” notices, which is the point of them';
  });
});
