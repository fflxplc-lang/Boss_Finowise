/* THE PUNCH CLOCK'S HOURS, WHAT A DAY IS WORTH, AND REGULARIZING ONE.

   Punch In once a day, from 08:45. Punch Out as often as somebody likes,
   the latest standing, until 20:45. Neither on a Sunday or a holiday.

   Attendance % is the time from punch in to the latest punch out, plus
   approved regularized periods, over nine hours, capped at 100 — with a
   minute covered twice counted once. A day at 100% is one day worked;
   approved leave is a day; pending leave is nothing.

   Any date in the history offers Regularize Attendance and Apply Leave.
   A regularization is emailed to HR, changes nothing while Pending, and
   once approved the day's hours and % are worked out again. */
const {suite} = require('../lib/harness');

suite({mail: true}, async t => {
  let plain = null, hr = null, day = null;

  await t.step('a member, and somebody in HR with an inbox', async () => {
    const r = await t.eval(async ()=>{
      const mk = (name, extra) => {
        const m = Object.assign({id: uid('TM'), name, role: roleList().slice(-1)[0],
          email: name.replace(/\s+/g,'.').toLowerCase() + '@example.com', status:'Active', scope:'own',
          branch:'Varanasi', adminFlags: fullAdminFlags(false), perms: fullPerms(false, {view:1}),
          createdAt: new Date().toISOString()}, extra || {});
        DB.team.push(m); return m.id;
      };
      const out = {plain: mk('ZZ Rita Verma'), hr: mk('ZZ HR Desk', {hrAccess: {attendance: 1, staff: 1}})};
      await save('team');
      DB.hrConfig = Object.assign({}, DB.hrConfig, {location: {required: false, note: ''},
        activity: {enabled: false, idleMinutes: 5, beatSeconds: 30, saveSeconds: 120}});
      await save('hrConfig');
      /* a past working day, not a Sunday */
      const d = new Date(); d.setDate(d.getDate() - 2);
      while(d.getDay() === 0) d.setDate(d.getDate() - 1);
      out.day = hrDateKey(d);
      return out;
    });
    plain = r.plain; hr = r.hr; day = r.day;
    return 'regularizing ' + day;
  });

  t.section('when a punch is allowed');

  await t.step('Punch In opens at 08:45, once a day; Punch Out until 20:45', async () => {
    const r = await t.eval(()=>{
      const at = (date, hhmm) => new Date(date + 'T' + hhmm + ':00');
      /* a Wednesday */
      const wed = '2026-10-21', sun = '2026-10-25';
      const none = null, punched = {sessions: [{in: at(wed, '09:02').toISOString(), out: null}]};
      return {
        early: hrPunchRules(none, at(wed, '08:44')),
        open: hrPunchRules(none, at(wed, '08:45')),
        twice: hrPunchRules(punched, at(wed, '11:00')),
        outMid: hrPunchRules(punched, at(wed, '18:30')),
        outLate: hrPunchRules(punched, at(wed, '20:45')),
        inLate: hrPunchRules(none, at(wed, '20:50')),
        sunday: hrPunchRules(none, at(sun, '10:00')),
      };
    });
    if(r.early.inOk || !/08:45/.test(r.early.inWhy)) throw new Error('08:44 allowed a punch in: ' + JSON.stringify(r.early));
    if(!r.open.inOk) throw new Error('08:45 refused a punch in');
    if(r.open.outOk) throw new Error('Punch Out was offered before any punch in');
    if(r.twice.inOk || !/once a day/.test(r.twice.inWhy)) throw new Error('a second punch in was allowed');
    if(!r.outMid.outOk) throw new Error('Punch Out was refused mid-evening');
    if(r.outLate.outOk || !/20:45/.test(r.outLate.outWhy)) throw new Error('Punch Out stayed open after 20:45');
    if(r.inLate.inOk) throw new Error('Punch In was allowed after the clock closed');
    if(r.sunday.inOk || r.sunday.outOk || !/Sunday/.test(r.sunday.inWhy)) throw new Error('Sunday was open');
    return '08:44 shut, 08:45 open; once a day; Punch Out until 20:45; Sunday shut — each with its reason';
  });

  await t.step('a holiday shuts both, and the buttons are drawn disabled with the reason', async () => {
    const r = await t.eval(async ()=>{
      const c = hrCfg(); c.holidays = [{date: '2026-10-22', name: 'ZZ Festival'}]; DB.hrConfig = c;
      const hol = hrPunchRules(null, new Date('2026-10-22T10:00:00'));
      c.holidays = []; DB.hrConfig = c; await save('hrConfig');
      /* the widget, before the clock opens */
      const real = window.hrNow;
      window.hrNow = () => new Date(hrToday() + 'T07:30:00');
      const html = hrPunchButtonsHtml(null, 'sm');
      window.hrNow = real;
      return {hol, disabled: /disabled/.test(html), why: /opens at 08:45/.test(html)};
    });
    if(r.hol.inOk || r.hol.outOk || !/ZZ Festival/.test(r.hol.inWhy)) throw new Error('the holiday was open');
    if(!r.disabled || !r.why) throw new Error('the button is not disabled with its reason');
    return 'holiday shut by name; Punch In greyed out with "opens at 08:45" beside it';
  });

  await t.step('Punch Out pressed again replaces the earlier one, which is kept', async () => {
    const r = await t.eval(async (a)=>{
      const realClosed = hrClosedDayWhy, realNow = hrNow;
      window.hrClosedDayWhy = () => '';
      const c = hrCfg(); c.day.punchInFrom = '00:00'; c.day.punchOutUntil = '23:59'; DB.hrConfig = c; await save('hrConfig');
      const was = currentUser; currentUser = a.who;
      await hrPunchIn();
      await hrPunchOut();
      const first = hrAttendanceOf(a.who, hrToday()).sessions[0].out;
      await new Promise(r=>setTimeout(r, 1100));
      await hrPunchOut();
      const rec = hrAttendanceOf(a.who, hrToday());
      const server = ((await sget('hrAttendance')) || []).find(x=>x.id === rec.id) || {};
      const html = hrPunchButtonsHtml(rec, 'sm');
      currentUser = was;
      window.hrClosedDayWhy = realClosed; window.hrNow = realNow;
      const c2 = hrCfg(); c2.day.punchInFrom = '08:45'; c2.day.punchOutUntil = '20:45'; DB.hrConfig = c2; await save('hrConfig');
      return {sessions: rec.sessions.length, latest: rec.sessions[0].out, first,
        kept: (rec.sessions[0].outHistory || []).map(x=>x.out), serverOut: (server.sessions || [{}])[0].out,
        offersOut: /Punch Out/.test(html) && !/Punch In/.test(html)};
    }, {who: plain});
    if(r.sessions !== 1) throw new Error(r.sessions + ' sessions');
    if(r.latest === r.first || r.kept[0] !== r.first) throw new Error('the earlier punch out was not replaced and kept');
    if(r.serverOut !== r.latest) throw new Error('the server did not take it');
    if(!r.offersOut) throw new Error('after a punch out it does not offer Punch Out again');
    return 'one session; latest punch out stands on the server, the earlier one kept in its history';
  });

  t.section('what a day is worth');

  await t.step('9 hours is 100%, half of it 50%, and more is still 100%', async () => {
    const r = await t.eval((d)=>{
      const rec = (a, b) => ({sessions: [{in: new Date(d + 'T' + a + ':00').toISOString(), out: new Date(d + 'T' + b + ':00').toISOString()}]});
      return {full: hrDayPct('x', d, rec('09:00', '18:00')), half: hrDayPct('x', d, rec('09:00', '13:30')),
        over: hrDayPct('x', d, rec('08:45', '20:45')), none: hrDayPct('x', d, null),
        credit: hrDayCredit('x', d, rec('09:00', '13:30')).credit};
    }, day);
    if(r.full !== 100 || r.half !== 50 || r.over !== 100 || r.none !== 0)
      throw new Error(JSON.stringify(r));
    if(r.credit !== 0.5) throw new Error('a 50% day counted as ' + r.credit);
    return '9h → 100%, 4h30 → 50% (half a day), 12h → 100%, nothing → 0%';
  });

  await t.step('approved leave is a day, pending leave nothing, and no date counts twice', async () => {
    const r = await t.eval(async (a)=>{
      const was = DB.hrLeave;
      DB.hrLeave = [{id:'L1', userId: a.who, from: a.day, to: a.day, type:'Full Day', unit:'full', status:'Approved'}];
      const rec = {sessions: [{in: new Date(a.day + 'T09:00:00').toISOString(), out: new Date(a.day + 'T18:00:00').toISOString()}]};
      const approved = hrDayCredit(a.who, a.day, null).credit;
      const both = hrDayCredit(a.who, a.day, rec).credit;
      DB.hrLeave[0].status = 'Pending';
      const pending = hrDayCredit(a.who, a.day, null).credit;
      DB.hrLeave[0].status = 'Declined';
      const declined = hrDayCredit(a.who, a.day, null).credit;
      DB.hrLeave = was;
      return {approved, both, pending, declined};
    }, {who: plain, day});
    if(r.approved !== 1) throw new Error('approved leave counted as ' + r.approved);
    if(r.both !== 1) throw new Error('a worked day on leave counted as ' + r.both);
    if(r.pending !== 0 || r.declined !== 0) throw new Error('pending or declined leave counted');
    return 'approved 1, worked and on leave still 1, pending 0, declined 0';
  });

  t.section('the history, and regularizing a day');

  await t.step('every date in the history offers Regularize Attendance and Apply Leave', async () => {
    const r = await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.who;
      navigate('hrattendance');
      const rows = document.querySelectorAll('tr[data-hrdate]').length;
      const row = document.querySelector('tr[data-hrdate="' + a.day + '"]');
      row.click();
      const modal = document.getElementById('overlay').textContent;
      hrOpenLeaveRequest(a.day);
      const from = document.getElementById('f_hrReqFrom').value, to = document.getElementById('f_hrReqTo').value;
      closeModal();
      currentUser = was;
      return {rows, reg: /Regularize Attendance/.test(modal), leave: /Apply Leave/.test(modal), from, to,
        kpi: /Days worked this month/.test(document.getElementById('content').innerHTML) || true};
    }, {who: plain, day});
    if(r.rows !== 30) throw new Error(r.rows + ' dates in the history');
    if(!r.reg || !r.leave) throw new Error('the date does not offer both');
    if(r.from !== day || r.to !== day) throw new Error('Apply Leave did not start on that date: ' + r.from);
    return '30 dates, each clickable; Apply Leave opens on the date clicked';
  });

  await t.step('a request goes to HR by email and changes nothing until it is approved', async () => {
    const r = await t.eval(async (a)=>{
      DB.hrAttendance = hrAttendanceAll().concat([{id: uid('HRA'), userId: a.who, date: a.day, createdAt: new Date().toISOString(),
        sessions: [{in: new Date(a.day + 'T09:00:00').toISOString(), out: new Date(a.day + 'T13:00:00').toISOString(), inBy: a.who}]}]);
      await save('hrAttendance');
      const was = currentUser; currentUser = a.who;
      const before = hrDayPct(a.who, a.day);
      hrOpenRegularize(a.day);
      const form = document.getElementById('overlay').textContent;
      const rows = document.querySelectorAll('#hrRegPeriods .hr-reg-period');
      rows[0].querySelector('.hr-reg-from').value = '12:00';
      rows[0].querySelector('.hr-reg-to').value = '14:00';
      hrRegAddPeriod();
      const r2 = document.querySelectorAll('#hrRegPeriods .hr-reg-period')[1];
      r2.querySelector('.hr-reg-from').value = '13:30';
      r2.querySelector('.hr-reg-to').value = '15:00';
      hrRegPreview();
      const preview = document.getElementById('hrRegPreviewNote').textContent;
      /* no reason: refused */
      await hrSubmitRegularize(a.day);
      const noReason = hrRegsOn(a.who, a.day).length;
      document.getElementById('f_hrRegReason').value = 'ZZ client meeting at Indiranagar';
      await hrSubmitRegularize(a.day);
      const row = hrRegsOn(a.who, a.day)[0];
      const after = hrDayPct(a.who, a.day);
      /* the same times again, while it is pending: refused */
      hrOpenRegularize(a.day);
      const rr = document.querySelectorAll('#hrRegPeriods .hr-reg-period')[0];
      rr.querySelector('.hr-reg-from').value = '16:00'; rr.querySelector('.hr-reg-to').value = '17:00';
      document.getElementById('f_hrRegReason').value = 'again';
      await hrSubmitRegularize(a.day);
      closeModal();
      const count = hrRegsOn(a.who, a.day).length;
      currentUser = was;
      const stored = ((await sget('hrRegularizations')) || []).find(x=>x.id === row.id);
      return {before, after, form: /Punch in/.test(form) && /Latest punch out/.test(form) && /Add More/.test(form),
        preview, noReason, status: row.status, adds: row.addsMinutes, count, stored: !!stored,
        inbox: (DB.notifications || []).filter(n=>n.userId === a.hr && /regularize/i.test(n.title)).length};
    }, {who: plain, day, hr});
    if(!r.form) throw new Error('the form does not show the day or offer Add More');
    if(r.noReason !== 0) throw new Error('a request with no reason was sent');
    if(r.status !== 'Pending' || !r.stored) throw new Error('the request is ' + r.status);
    if(r.adds !== 120) throw new Error('12:00–14:00 and 13:30–15:00 over 09:00–13:00 add ' + r.adds + ' min, not 120');
    if(r.after !== r.before) throw new Error('a pending request changed the day: ' + r.before + ' → ' + r.after);
    if(r.count !== 1) throw new Error('a second request for the same day was accepted while one was pending');
    if(!r.inbox) throw new Error('HR was not told inside BOSS');
    await t.wait(900);
    const mail = t.mail.received.find(m=>/regularization request/i.test(m.subject));
    if(!mail) throw new Error('no email to HR: ' + t.mail.received.map(m=>m.subject).join(' | '));
    if(!/zz\.hr\.desk@example\.com/.test(mail.to.join(','))) throw new Error('it went to ' + mail.to.join(','));
    if(!/12:00 to 14:00/.test(mail.text) || !/Indiranagar/.test(mail.text) || !/09:00/.test(mail.text))
      throw new Error('the email is missing the details: ' + mail.text.slice(0, 300));
    if(/\{[A-Za-z]+\}/.test(mail.text)) throw new Error('a token was left in the email');
    return 'overlaps counted once (adds 2h); Pending; ' + r.before + '% unchanged; emailed to HR with the day, the periods and the reason';
  });

  await t.step('HR approves it, and the day is worked out again', async () => {
    const r = await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.hr;
      navigate('hrattendance');
      const inbox = /Regularization requests waiting on HR/.test(document.getElementById('content').innerHTML);
      const row = hrRegsOn(a.who, a.day)[0];
      hrOpenRegDecision(row.id, false);
      await hrDecideReg(row.id, false);                       // a rejection needs a reason
      const stillPending = row.status;
      hrOpenRegDecision(row.id, true);
      await hrDecideReg(row.id, true);
      currentUser = was;
      return {inbox, stillPending, status: row.status, history: (row.history || []).map(h=>h.action),
        pct: hrDayPct(a.who, a.day), minutes: Math.round(hrEligibleMinutes(a.who, a.day))};
    }, {who: plain, day, hr});
    if(!r.inbox) throw new Error('HR has no inbox for it');
    if(r.stillPending !== 'Pending') throw new Error('a blank rejection went through');
    if(r.status !== 'Approved') throw new Error('it is ' + r.status);
    if(r.minutes !== 360 || r.pct !== 66.7) throw new Error('after approval: ' + r.minutes + ' min, ' + r.pct + '%');
    if(r.history.join(',') !== 'Requested,Approved') throw new Error('history: ' + r.history.join(','));
    await t.wait(900);
    const mail = t.mail.received.find(m=>/regularization for .* was approved/i.test(m.subject));
    if(!mail || !/zz\.rita\.verma@example\.com/.test(mail.to.join(','))) throw new Error('the member was not emailed');
    return '4h → 6h, 44.4% → ' + r.pct + '%; history Requested → Approved; the member emailed';
  });
});
