/* A NEW SECTION, AND THE PROMISE THAT IT CHANGED NOTHING.

   HR is three modules — Attendance, Incentive, Appraisal — added to a
   system that was asked not to move. So most of what matters here is
   negative: that HR writes only its own stores, that it reads the rest
   of BOSS without touching it, that its access is its own and does not
   leak into LMS, CMS, RMS or Setup, and that it has not invented a
   single business rule while nobody was looking.

   The positive half is small and concrete: a person punches in, the
   record lands against their own account and today's date, a second
   punch-in is refused, punching out closes the session and the day's
   total is the arithmetic of the timestamps.

   The rule this suite guards hardest: no incentive or appraisal
   calculation exists. Every figure those two modules show is a count
   of records that already existed. */
const {suite} = require('../lib/harness');

const AS = `(id, fn) => { const was = currentUser; currentUser = id; try { return fn(); } finally { currentUser = was; } }`;

const onServer = async (t, key) => t.eval(async (k)=>{
  const res = await fetch('/api/storage/' + encodeURIComponent(k), {headers: apiHeaders()});
  if(res.status === 404) return null;
  return JSON.parse((await res.json()).value);
}, key);

suite({mail: true}, async t => {
  await t.useMail();
  await t.home();
  let plain = null, hrUser = null, admin = null;

  await t.step('three accounts the firm already has, and no new ones', async () => {
    const r = await t.eval(async ()=>{
      const before = DB.team.length;
      const roles = roleList();
      const mk = (name, role) => {
        const m = {id: uid('TM'), name, role, email: name.replace(/\s+/g,'.').toLowerCase() + '@zz.in',
          status:'Active', scope:'own', branch:'Varanasi', adminFlags: fullAdminFlags(false),
          perms: fullPerms(false, {view:1}), createdAt:new Date().toISOString()};
        DB.team.push(m); return m.id;
      };
      const out = {plain: mk('ZZ Plain Staff', roles[roles.length-1] || 'Executive'),
                   hr:    mk('ZZ HR Officer',  roles[1] || 'Manager'),
                   admin: (DB.team.find(x=>isAdmin(x)) || DB.team[0]).id,
                   hrRole: roles[1] || 'Manager'};
      await save('team');
      out.added = DB.team.length - before;
      return out;
    });
    plain = r.plain; hrUser = r.hr; admin = r.admin;
    return 'two ordinary accounts plus the Admin — HR adds none of its own';
  });

  t.section('what HR owns, and what it only reads');

  await t.step('HR configuration starts empty — it invents no rule', async () => {
    const r = await t.eval(()=>{
      const c = hrCfg();
      return {start: c.day.start, end: c.day.end, grace: c.day.graceMinutes, hours: c.day.fullDayHours,
        offs: c.weeklyOff.length, holidays: c.holidays.length,
        types: c.leaveTypes.map(t=>t.name + ':' + t.unit).join(', '),
        /* nobody holds anything beyond their own record, by role or otherwise */
        beyondOwn: (DB.team || []).filter(t=>t && !isAdmin(t)
          && (hrHas('staff', t) || hrHas('admin', t) || hrHas('incentive', t) || hrHas('appraisal', t))).length,
        plainSees: (()=>{ const w = currentUser;
          currentUser = (DB.team.find(t=>t && !isAdmin(t)) || {}).id || w;
          const o = {section: hrSectionOpen(), att: hrModuleOpen('hrattendance'),
                     inc: hrModuleOpen('hrincentive'), app: hrModuleOpen('hrappraisal'),
                     hub: hrModuleOpen('hrdashboard'), staff: hrIsStaff(), admin: hrIsAdmin()};
          currentUser = w; return o; })(),
        /* and with nothing configured, nothing is called late */
        late: hrLateMinutes({sessions:[{in:new Date().toISOString(), out:null}]}),
        mapped: (DB.hrSourceMaps || []).length};
    });
    const set = Object.entries({start:r.start, end:r.end, grace:r.grace, hours:r.hours})
      .filter(([, v])=>v !== '' && v !== undefined && v !== null);
    if(set.length) throw new Error('a working-day rule was invented: ' + JSON.stringify(set));
    if(r.offs || r.holidays) throw new Error('weekly offs or holidays were invented');
    /* the three the firm named, and nothing beyond them */
    if(r.types !== 'Full Day:full, Half Day:half, Comp Off:full')
      throw new Error('the leave types are: ' + r.types);
    if(r.beyondOwn) throw new Error(r.beyondOwn + ' account(s) hold HR beyond their own record unasked');
    /* their own attendance is the default, and the whole of it */
    if(!r.plainSees.section || !r.plainSees.att)
      throw new Error('an ordinary account cannot mark its own attendance');
    ['inc','app','hub','staff','admin'].forEach(k=>{
      if(r.plainSees[k]) throw new Error('the default handed somebody ' + k);
    });
    if(r.late !== null) throw new Error('lateness was computed with no start time: ' + r.late);
    if(r.mapped) throw new Error('a source was mapped without anybody choosing it');
    return 'office hours, grace, full day, weekly offs, holidays and source maps all empty; every account '
      + 'marks its own attendance and holds nothing beyond it; '
      + 'lateness reads "not configured" rather than guessing; and the leave types are the three the firm '
      + 'named \u2014 ' + r.types;
  });

  await t.step('and it reads the existing stores without a second copy of them', async () => {
    const r = await t.eval(()=>{
      const stores = HR_SOURCES.map(s=>s.store);
      const dup = stores.filter(k=>String(k).indexOf('hr') === 0);
      /* what a source says about itself is counted off the rows on file */
      const info = HR_SOURCES.map(s=>{
        const i = hrSourceField(s);
        return {k: s.key, store: s.store, field: i.field, rows: i.rows, matched: i.matched};
      });
      return {stores, dup, info,
        hrStores: Object.keys(DB).filter(k=>k.indexOf('hr') === 0).sort()};
    });
    if(r.dup.length) throw new Error('a source reads an HR copy, not the original: ' + r.dup.join(', '));
    if(r.hrStores.join(',') !== 'hrAppraisals,hrAttendance,hrConfig,hrIncentives,hrLeave,hrRegularizations,hrSourceMaps')
      throw new Error('HR owns an unexpected set of stores: ' + r.hrStores.join(', '));
    return r.info.length + ' sources, read where they live (' + r.stores.join(', ') + '); HR owns '
      + r.hrStores.length + ' stores of its own and nothing else';
  });

  t.section('punching in and out');

  /* The punch clock has opening hours and is shut on Sundays. This suite
     is about what a punch records, not when, so the clock is opened for
     the whole day, every day; punch-clock.js tests the hours themselves. */
  await t.eval(async ()=>{
    const c = hrCfg(); c.day.punchInFrom = '00:00'; c.day.punchOutUntil = '23:59';
    DB.hrConfig = c; await save('hrConfig');
    window.hrClosedDayWhy = () => ''; window.hrIsSunday = () => false;
  });

  await t.step('a punch lands against that account and today, and twice is refused', async () => {
    const r = await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.who;
      const out = {};
      await hrPunchIn();
      const rec = hrAttendanceOf(a.who, hrToday());
      out.after1 = {sessions: (rec.sessions||[]).length, open: !!hrOpenSession(rec),
        userId: rec.userId, date: rec.date, worked: hrWorkedMinutes(rec)};
      await hrPunchIn();                       // the one that must be refused
      out.after2 = {sessions: (hrAttendanceOf(a.who, hrToday()).sessions||[]).length};
      /* The arithmetic is checked on a record of its own, because a
         recorded punch cannot be back-dated any more — the server
         refuses it, which is the point of the step below. */
      out.ninety = Math.round(hrWorkedMinutes({sessions:[
        {in:new Date(Date.now() - 90*60000).toISOString(), out:new Date().toISOString()}]}));
      await hrPunchOut();
      const done = hrAttendanceOf(a.who, hrToday());
      out.afterOut = {open: !!hrOpenSession(done), sessions: (done.sessions||[]).length,
        closed: !!(done.sessions||[]).filter(x=>x.out).length,
        status: hrDayStatus(a.who, hrToday(), done).code};
      const firstOut = done.sessions[0].out;
      await new Promise(r=>setTimeout(r, 1100));
      await hrPunchOut();                      // again: the later one replaces it
      const again = hrAttendanceOf(a.who, hrToday());
      out.afterOut2 = {sessions: (again.sessions||[]).length, moved: again.sessions[0].out !== firstOut,
        kept: ((again.sessions[0].outHistory || [])[0] || {}).out === firstOut};
      const server = ((await sget('hrAttendance')) || []).find(x=>x.id === again.id) || {};
      out.afterOut2.onServer = ((server.sessions || [])[0] || {}).out === again.sessions[0].out;
      currentUser = was;
      return out;
    }, {who: plain});
    if(r.after1.sessions !== 1 || !r.after1.open) throw new Error('the punch in did not open a session');
    if(r.after1.userId !== plain) throw new Error('it landed on ' + r.after1.userId);
    if(r.after2.sessions !== 1) throw new Error('a second punch in opened another session');
    if(r.afterOut.open) throw new Error('punch out left the session open');
    if(!r.afterOut.closed) throw new Error('punch out did not close the session');
    if(r.ninety < 89 || r.ninety > 91) throw new Error('ninety minutes came out as ' + r.ninety);
    if(r.afterOut2.sessions !== 1) throw new Error('a second punch out added a session');
    if(!r.afterOut2.moved || !r.afterOut2.kept) throw new Error('the second punch out did not replace the first and keep it');
    if(!r.afterOut2.onServer) throw new Error('the server did not take the later punch out');
    if(!t.dialogs.some(d=>/once a day/i.test(String(d))))
      throw new Error('the duplicate punch in was refused silently');
    return 'one session; ninety minutes of timestamps come out as ' + r.ninety + '; the second punch in is '
      + 'refused with the reason, and a second punch out replaces the first, which is kept';
  });

  await t.step('and the record is on the server, under HR’s own key', async () => {
    const rows = await onServer(t, 'hrAttendance');
    const mine = (rows || []).filter(x=>x.userId === plain);
    if(!mine.length) throw new Error('nothing reached the server');
    if(!mine[0].sessions || !mine[0].sessions[0].out) throw new Error('the session was not closed on the server');
    const leads = await onServer(t, 'leads');
    if((leads || []).some(l=>l && (l.hrAttendance || l.punchIn)))
      throw new Error('HR wrote a field onto a lead');
    return mine.length + ' attendance row(s) in hrAttendance, and nothing added to the existing stores';
  });

  await t.step('the Dashboard carries the punch clock by default, and loses it when revoked', async () => {
    /* The one HR action a person does every day, on the page they open
       — and it is the same two functions the Attendance page calls, so
       there is no second punch path to keep in step. It appears only
       for somebody an administrator has granted Attendance. */
    const r = await t.eval(async (a)=>{
      const m = DB.team.find(t=>t.id === a.who);
      delete m.hrAccess; await save('team');
      const was = currentUser; currentUser = a.who;
      navigate('dashboard');
      const byDefault = (document.getElementById('topbarRight') || {}).innerHTML || '';
      /* an administrator takes it away */
      currentUser = was;
      m.hrAccess = {attendance: 0}; await save('team');
      currentUser = a.who;
      navigate('dashboard');
      const revoked = (document.getElementById('topbarRight') || {}).innerHTML || '';
      /* and gives it back */
      currentUser = was;
      m.hrAccess = {attendance: 1}; await save('team');
      currentUser = a.who;
      navigate('dashboard');
      const slot = () => (document.getElementById('topbarRight') || {}).innerHTML || '';
      const out = {before: slot()};
      await hrPunchIn();
      out.after = slot();
      await hrPunchOut();
      out.done = slot();
      navigate('lms');
      out.elsewhere = slot();
      navigate('dashboard');
      currentUser = was;
      out.byDefault = byDefault; out.revoked = revoked;
      return out;
    }, {who: hrUser});
    if(!/Punch In/.test(r.byDefault)) throw new Error('the punch clock is missing by default');
    if(r.revoked) throw new Error('revoking Attendance left the punch clock on the Dashboard');
    if(!/Punch In/.test(r.before)) throw new Error('no Punch In on the Dashboard: ' + r.before.slice(0, 120));
    if(!/Not punched in yet/.test(r.before)) throw new Error('the status is missing before the first punch');
    if(!/Punch Out/.test(r.after) || /Punch In<\/button>/.test(r.after))
      throw new Error('it did not turn into Punch Out: ' + r.after.slice(0, 160));
    if(!/Punched in/.test(r.after)) throw new Error('the status did not follow the punch');
    if(!/Punch Out/.test(r.done) || /Punch In<\/button>/.test(r.done))
      throw new Error('after punching out it does not offer Punch Out again');
    if(r.elsewhere) throw new Error('the slot is filled on a page that is not the Dashboard');
    return 'there by default, gone when an administrator unticks Attendance, back when they tick it again; '
      + 'Punch In → Punch Out → Punch Out again with the status beside it, and nothing in that slot elsewhere';
  });

  t.section('leave, asked for and decided');

  await t.step('the Dashboard button is Leave Request, not Attendance', async () => {
    const r = await t.eval(async (a)=>{
      const m = DB.team.find(t=>t.id === a.who);
      m.hrAccess = {attendance: 1};
      await save('team');
      const was = currentUser; currentUser = a.who;
      navigate('dashboard');
      const slot = (document.getElementById('topbarRight') || {}).innerHTML || '';
      currentUser = was;
      return {slot, leave: /Leave Request/.test(slot),
        oldButton: /navigate\('hrattendance'\)/.test(slot), punch: /Punch In|Punch Out/.test(slot)};
    }, {who: plain});
    if(!r.leave) throw new Error('no Leave Request button: ' + r.slot.slice(0, 140));
    if(r.oldButton) throw new Error('the old Attendance button is still there');
    if(!r.punch) throw new Error('punching was lost along with it');
    return 'Punch In and Leave Request on the Dashboard; the Attendance link is gone';
  });

  await t.step('a request goes to the branch head for that branch, as Pending', async () => {
    const r = await t.eval(async (a)=>{
      /* a branch head in one branch, another in a different branch */
      const roles = roleList();
      const role = 'ZZ Branch Head';
      if(roles.indexOf(role) < 0){ DB.config.roles = roles.concat([role]); await save('config'); }
      const mk = (name, branch) => {
        const m = {id: uid('TM'), name, role, branch, status:'Active', scope:'own',
          email: name.replace(/\s+/g,'.').toLowerCase() + '@zz.in',
          adminFlags: fullAdminFlags(false), perms: fullPerms(false, {view:1}),
          /* a branch head needs HR access to answer a request at all */
          hrAccess: {attendance: 1, staff: 1},
          createdAt:new Date().toISOString()};
        DB.team.push(m); return m.id;
      };
      const here = mk('ZZ Head Here', 'ZZ Branch A');
      const elsewhere = mk('ZZ Head Elsewhere', 'ZZ Branch B');
      const who = DB.team.find(t=>t.id === a.who);
      who.branch = 'ZZ Branch A';
      await save('team');
      const c = hrCfg(); c.access.branchHeadRole = role;
      DB.hrConfig = c; await save('hrConfig');
      const was = currentUser; currentUser = a.who;
      const picked = hrApproverFor(a.who);
      hrOpenLeaveRequest();
      document.getElementById('f_hrReqType').value = 'Full Day';
      document.getElementById('f_hrReqFrom').value = '2026-11-02';
      document.getElementById('f_hrReqTo').value = '2026-11-04';
      document.getElementById('f_hrReqReason').value = 'ZZ family wedding';
      await hrSubmitLeaveRequest();
      currentUser = was;
      const row = (DB.hrLeave || []).find(l=>l.userId === a.who && l.reason === 'ZZ family wedding');
      const stored = ((await sget('hrLeave')) || []).find(l=>l.id === (row||{}).id);
      return {picked, here, elsewhere, row, stored: !!stored,
        notified: (DB.notifications || []).filter(n=>n && n.userId === here
          && /requested leave/i.test(n.title || '')).length};
    }, {who: plain});
    if(!r.picked || r.picked.id !== r.here)
      throw new Error('it picked ' + JSON.stringify(r.picked) + ', not the head of their own branch');
    if(!r.row) throw new Error('no request was written');
    if(r.row.status !== 'Pending') throw new Error('it was written ' + r.row.status);
    if(r.row.approverId !== r.here) throw new Error('it went to the wrong approver');
    if(!r.row.requestedAt || !r.row.reason || r.row.type !== 'Full Day')
      throw new Error('the request lost its type, reason or date');
    if(!r.stored) throw new Error('it never reached the server');
    if(!r.notified) throw new Error('the branch head was not told');
    return 'Pending with ZZ Head Here (' + r.picked.why + '), 3 days, on the server, and he was notified';
  });

  await t.step('only that branch head may decide it, and the decision comes back', async () => {
    const r = await t.eval(async (a)=>{
      const row = (DB.hrLeave || []).find(l=>l.userId === a.who && l.reason === 'ZZ family wedding');
      const head = row.approverId;
      const other = (DB.team.find(t=>t.name === 'ZZ Head Elsewhere') || {}).id;
      const was = currentUser;
      currentUser = other;
      const outsider = {may: hrMayDecideLeave(row), inbox: hrLeavePendingForMe().length};
      currentUser = head;
      const mine = {may: hrMayDecideLeave(row), inbox: hrLeavePendingForMe().length};
      hrOpenLeaveDecision(row.id, true);
      document.getElementById('f_hrDecideNote').value = 'ZZ enjoy it';
      await hrDecideLeave(row.id, true);
      currentUser = was;
      const after = (DB.hrLeave || []).find(l=>l.id === row.id);
      const stored = ((await sget('hrLeave')) || []).find(l=>l.id === row.id) || {};
      return {outsider, mine, after: {status: after.status, by: after.decidedBy,
          at: !!after.decidedAt, remarks: after.remarks},
        stored: stored.status,
        told: (DB.notifications || []).filter(n=>n && n.userId === a.who
          && /leave was approved/i.test(n.title || '')).length,
        /* and an approved leave is what the attendance day then reads */
        day: (()=>{ const w = currentUser; currentUser = a.who;
          const st = hrDayStatus(a.who, '2026-11-03'); currentUser = w; return st.label; })()};
    }, {who: plain});
    if(r.outsider.may) throw new Error('a head of another branch could decide it');
    if(r.outsider.inbox) throw new Error('it showed in the wrong head\u2019s inbox');
    if(!r.mine.may || !r.mine.inbox) throw new Error('the right head could not see or decide it');
    if(r.after.status !== 'Approved' || r.stored !== 'Approved')
      throw new Error('the decision did not stick: ' + r.after.status + ' / ' + r.stored);
    if(!r.after.by || !r.after.at || r.after.remarks !== 'ZZ enjoy it')
      throw new Error('the decision lost its approver, date or remarks');
    if(!r.told) throw new Error('the person was not told');
    if(!/approved leave/i.test(r.day)) throw new Error('the attendance day reads "' + r.day + '"');
    return 'the other branch\u2019s head could not touch it; approved with remarks, on the server, the person '
      + 'was told, and 3 Nov now reads "' + r.day + '"';
  });

  await t.step('Full Day, Half Day and Comp Off \u2014 and a half day counts as half', async () => {
    const r = await t.eval(async (a)=>{
      const types = hrCfg().leaveTypes;
      const out = {types: types.map(t=>t.name), labels: types.map(hrLeaveTypeLabel)};
      /* three dates, under each unit */
      out.fullSpan = hrLeaveDays({from:'2026-11-02', to:'2026-11-04', type:'Full Day'});
      out.halfSpan = hrLeaveDays({from:'2026-11-02', to:'2026-11-04', type:'Half Day'});
      out.halfOne = hrLeaveDays({from:'2026-11-02', to:'2026-11-02', type:'Half Day'});
      out.compOff = hrLeaveDays({from:'2026-11-02', to:'2026-11-02', type:'Comp Off'});
      out.label = hrDaysLabel(0.5);
      /* a request keeps the unit it was asked under, so re-reading the
         list later cannot re-count it */
      const was = currentUser; currentUser = a.who;
      hrOpenLeaveRequest();
      const options = Array.from(document.querySelectorAll('#f_hrReqType option')).map(o=>o.textContent.trim());
      document.getElementById('f_hrReqType').value = 'Half Day';
      document.getElementById('f_hrReqFrom').value = '2026-12-01';
      document.getElementById('f_hrReqTo').value = '2026-12-01';
      document.getElementById('f_hrReqReason').value = 'ZZ half day for a hospital visit';
      hrLeaveBalanceNote();
      out.note = (document.getElementById('hrBalNote') || {}).textContent || '';
      await hrSubmitLeaveRequest();
      currentUser = was;
      const row = ((await sget('hrLeave')) || []).find(x=>x.reason === 'ZZ half day for a hospital visit') || {};
      out.row = {type: row.type, unit: row.unit, days: hrLeaveDays(row)};
      /* and an older row, saved before units existed, still reads as whole days */
      out.legacy = hrLeaveDays({from:'2026-11-02', to:'2026-11-03', type:'Casual'});
      out.options = options;
      return out;
    }, {who: plain});
    if(r.types.join(',') !== 'Full Day,Half Day,Comp Off')
      throw new Error('the types are ' + r.types.join(', '));
    if(r.labels[1] !== 'Half Day (half a day)') throw new Error('the half-day type is not labelled as one');
    if(r.options.indexOf('Comp Off') < 0) throw new Error('Comp Off is not offered: ' + r.options.join(', '));
    if(r.fullSpan !== 3) throw new Error('three full days came out as ' + r.fullSpan);
    if(r.halfSpan !== 1.5) throw new Error('three half days came out as ' + r.halfSpan);
    if(r.halfOne !== 0.5) throw new Error('one half day came out as ' + r.halfOne);
    if(r.compOff !== 1) throw new Error('one Comp Off came out as ' + r.compOff);
    if(r.label !== '\u00bd day') throw new Error('0.5 reads as "' + r.label + '"');
    if(!/\u00bd day/.test(r.note)) throw new Error('the form did not say \u00bd day: ' + r.note);
    if(r.row.unit !== 'half' || r.row.days !== 0.5)
      throw new Error('the request did not keep its unit: ' + JSON.stringify(r.row));
    if(r.legacy !== 2) throw new Error('an older row counted ' + r.legacy + ' rather than 2');
    return 'Full Day, Half Day (half a day) and Comp Off offered; 3 dates = 3 days or 1.5 under Half Day; '
      + 'one half day reads "\u00bd day"; the request stores its own unit; an older row still counts whole days';
  });

  await t.step('the form shows their last request and what the year comes to', async () => {
    const r = await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.who;
      const out = {};
      /* first time out: it says so rather than showing an empty card */
      const kept = DB.hrLeave || [];
      DB.hrLeave = kept.filter(l=>l.userId !== a.who);
      hrOpenLeaveRequest();
      out.first = (document.querySelector('.modal-body') || {}).textContent || '';
      closeModal();
      /* then a decided one and a pending one, in this year */
      const yr = String(hrToday()).slice(0, 4);
      DB.hrLeave = DB.hrLeave.concat([
        {id:'ZZL1', userId:a.who, from:yr+'-03-02', to:yr+'-03-04', type:'Full Day', unit:'full',
         status:'Approved', approverId:a.who, decidedBy:a.who, decidedAt:yr+'-03-01',
         remarks:'Fine by me', requestedAt:yr+'-02-28', reason:'ZZ earlier one'},
        {id:'ZZL2', userId:a.who, from:yr+'-09-10', to:yr+'-09-10', type:'Half Day', unit:'half',
         status:'Pending', approverId:a.who, requestedAt:yr+'-09-01', reason:'ZZ latest one'}]);
      await save('hrLeave');
      hrOpenLeaveRequest();
      out.then = ((document.querySelector('.modal-body') || {}).textContent || '').replace(/\s+/g,' ');
      closeModal();
      DB.hrLeave = kept; await save('hrLeave');
      currentUser = was;
      return out;
    }, {who: plain});
    if(!/first request/i.test(r.first)) throw new Error('with no history it said: ' + r.first.slice(0, 120));
    if(!/Your last request/.test(r.then)) throw new Error('no last-request card: ' + r.then.slice(0, 200));
    /* the LAST one is the September half day, not the March one */
    if(!/Half Day/.test(r.then) || !/Pending/.test(r.then))
      throw new Error('it showed the wrong request: ' + r.then.slice(0, 220));
    if(/Fine by me/.test(r.then)) throw new Error('it showed the older request instead of the latest');
    /* and the year counts 3 approved and half a day pending */
    if(!/3 days approved/.test(r.then)) throw new Error('the approved tally is wrong: ' + r.then.slice(0, 260));
    if(!/\u00bd day pending/.test(r.then)) throw new Error('the pending tally is wrong: ' + r.then.slice(0, 260));
    if(!/2 requests/.test(r.then)) throw new Error('the request count is wrong: ' + r.then.slice(0, 260));
    return 'first time it says so; afterwards the latest request with its status, and "3 days approved \u00b7 '
      + '\u00bd day pending \u00b7 2 requests" for the year';
  });

  await t.step('Decline needs a reason, and the decision is emailed either way', async () => {
    const r = await t.eval(async (a)=>{
      const who = DB.team.find(t=>t.id === a.who);
      who.email = 'zz.requester@example.com';
      await save('team');
      const head = DB.team.find(t=>t.name === 'ZZ Head Here');
      const mk = async (reason, from, to) => {
        const was = currentUser; currentUser = a.who;
        hrOpenLeaveRequest();
        document.getElementById('f_hrReqType').value = 'Full Day';
        document.getElementById('f_hrReqFrom').value = from;
        document.getElementById('f_hrReqTo').value = to;
        document.getElementById('f_hrReqReason').value = reason;
        await hrSubmitLeaveRequest();
        currentUser = was;
        return (DB.hrLeave || []).find(l=>l.reason === reason);
      };
      const one = await mk('ZZ to be declined', '2027-01-04', '2027-01-05');
      const two = await mk('ZZ to be approved', '2027-02-08', '2027-02-08');
      const was = currentUser; currentUser = head.id;
      /* the inbox offers both decisions by name */
      navigate('hrattendance');
      const inbox = document.getElementById('content').innerHTML;
      const out = {approveBtn: />Approve</.test(inbox), declineBtn: /Decline</.test(inbox),
        decideBtn: />Decide</.test(inbox)};
      /* declining with nothing written is refused */
      hrOpenLeaveDecision(one.id, false);
      document.getElementById('f_hrDecideNote').value = '';
      await hrDecideLeave(one.id, false);
      out.blankStatus = (DB.hrLeave.find(l=>l.id === one.id) || {}).status;
      /* with a reason it goes through */
      document.getElementById('f_hrDecideNote').value = 'Two people already away that week';
      await hrDecideLeave(one.id, false);
      hrOpenLeaveDecision(two.id, true);
      document.getElementById('f_hrDecideNote').value = '';
      await hrDecideLeave(two.id, true);
      currentUser = was;
      const rows = (await sget('hrLeave')) || [];
      out.declined = rows.find(l=>l.id === one.id);
      out.approved = rows.find(l=>l.id === two.id);
      return out;
    }, {who: plain});
    if(!r.approveBtn || !r.declineBtn) throw new Error('the inbox does not offer Approve and Decline');
    if(r.decideBtn) throw new Error('the old Decide button is still there');
    if(r.blankStatus !== 'Pending')
      throw new Error('a decline with no reason went through as ' + r.blankStatus);
    if(r.declined.status !== 'Declined') throw new Error('it was stored as ' + r.declined.status);
    if(!/already away/.test(r.declined.remarks || '')) throw new Error('the reason was not kept');
    if(r.approved.status !== 'Approved') throw new Error('the approval did not land');
    if(r.approved.remarks) throw new Error('an empty remark was stored as something');
    await t.wait(900);
    const mails = t.mail.received.filter(m=>/zz\.requester@example\.com/.test(m.to.join(',')));
    if(mails.length < 2) throw new Error('only ' + mails.length + ' letter(s) went out');
    const dec = mails.find(m=>/declined/i.test(m.subject));
    const app = mails.find(m=>/approved/i.test(m.subject));
    if(!dec) throw new Error('no decline letter: ' + mails.map(m=>m.subject).join(' | '));
    if(!app) throw new Error('no approval letter: ' + mails.map(m=>m.subject).join(' | '));
    if(!/already away/.test(dec.text)) throw new Error('the decline letter carries no reason');
    if(/\{[A-Za-z]+\}/.test(dec.text + app.text))
      throw new Error('a token was left showing: ' + (/\{[A-Za-z]+\}/.exec(dec.text + app.text) || [])[0]);
    return 'Approve and Decline on the inbox; a blank decline refused and the request left Pending; the '
      + 'reason kept and emailed; both letters out to ' + mails[0].to.join(', ') + ' with no tokens showing';
  });

  t.section('where the punch happened');

  await t.step('a punch records the device\u2019s reading, or says it has none', async () => {
    const r = await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.who;
      const real = navigator.geolocation.getCurrentPosition;
      const out = {};
      /* the device answers */
      navigator.geolocation.getCurrentPosition = (ok)=>ok({coords:{latitude:25.3176, longitude:82.9739, accuracy:12.4}});
      /* One punch-in a day, so each case is somebody who has not punched
         in today: a colleague made for it. */
      const fresh = async name => {
        const m = {id: uid('TM'), name, role: roleList().slice(-1)[0], email: name.replace(/\s+/g,'.').toLowerCase() + '@zz.in',
          status:'Active', scope:'own', branch:'Varanasi', adminFlags: fullAdminFlags(false),
          perms: fullPerms(false, {view:1}), createdAt:new Date().toISOString()};
        DB.team.push(m); await save('team'); currentUser = m.id; return m.id;
      };
      const before = 0;
      a.who = await fresh('ZZ Loc One');
      await hrPunchIn();
      const rec = hrAttendanceOf(a.who, hrToday());
      out.inLoc = rec.sessions[before].inLoc;
      await hrPunchOut();
      out.outLoc = rec.sessions[before].outLoc;
      out.at = before;
      const first = a.who;
      a.who = await fresh('ZZ Loc Two');
      /* The device refuses. Location is required by default now, so
         the punch has to be let through explicitly to test that a
         refusal is RECORDED as a refusal rather than invented. */
      const c0 = hrCfg(); c0.location = {required:false, note:''}; DB.hrConfig = c0; await save('hrConfig');
      navigator.geolocation.getCurrentPosition = (ok, err)=>err({code:1, message:'denied'});
      await hrPunchIn();
      out.denied = hrAttendanceOf(a.who, hrToday()).sessions[before].inLoc;
      out.punchStood = hrAttendanceOf(a.who, hrToday()).sessions.length - before;
      /* …and with the policy on, the punch is refused rather than recorded */
      const c = hrCfg(); c.location = {required:true, note:''}; DB.hrConfig = c; await save('hrConfig');
      await hrPunchOut();                                  // closes session 2? must be refused
      out.blockedSessions = hrAttendanceOf(a.who, hrToday()).sessions.slice(before).filter(x=>x.out).length;
      c.location = {required:false, note:''}; DB.hrConfig = c; await save('hrConfig');
      navigator.geolocation.getCurrentPosition = real;
      currentUser = was;
      const stored = ((await sget('hrAttendance')) || []).find(x=>x.userId === first) || {};
      out.storedLat = ((stored.sessions || [])[before] || {}).inLoc;
      return out;
    }, {who: plain});
    if(!r.inLoc || r.inLoc.status !== 'captured' || r.inLoc.lat !== 25.3176)
      throw new Error('the punch-in did not record the reading: ' + JSON.stringify(r.inLoc));
    if(!r.outLoc || r.outLoc.status !== 'captured')
      throw new Error('the punch-out recorded no location: ' + JSON.stringify(r.outLoc));
    if(r.inLoc.at === r.outLoc.at) throw new Error('both punches share one location stamp');
    if(!r.denied || r.denied.status !== 'denied')
      throw new Error('a refusal was not recorded as a refusal: ' + JSON.stringify(r.denied));
    if(r.denied.lat !== undefined) throw new Error('a coordinate was invented for a refused reading');
    if(r.punchStood !== 1) throw new Error('the punch itself was lost when location was refused');
    if(r.blockedSessions !== 0)
      throw new Error('with the policy on, a punch with no location was still recorded');
    if(!r.storedLat || r.storedLat.lat !== 25.3176) throw new Error('the reading never reached the server');
    return 'in and out each carry their own reading; a refusal is stored as "denied" with no coordinates; '
      + 'and with the policy on the punch is refused instead';
  });

  await t.step('and the server refuses an edit to one that is already recorded', async () => {
    /* the refusals are the point, so the 409s they log are not defects */
    t.expectConsole(/409 \(Conflict\)/);
    const r = await t.eval(async (a)=>{
      const rows = (await sget('hrAttendance')) || [];
      const mine = rows.find(x=>x.userId === a.who);
      const put = async body => {
        const res = await fetch('/api/storage/hrAttendance', {method:'PUT',
          headers: Object.assign({'Content-Type':'application/json'}, apiHeaders()),
          body: JSON.stringify({value: JSON.stringify(body)})});
        return {status: res.status, body: await res.json().catch(()=>({}))};
      };
      const tamper = JSON.parse(JSON.stringify(rows));
      const t1 = tamper.find(x=>x.id === mine.id);
      t1.sessions[0].in = new Date(Date.now() - 6*3600000).toISOString();
      const edited = await put(tamper);
      const moved = JSON.parse(JSON.stringify(rows));
      moved.find(x=>x.id === mine.id).sessions[0].inLoc = {status:'captured', lat:0, lng:0};
      const movedLoc = await put(moved);
      /* with a second day on file, dropping one is a drop rather than
         the whole-store wipe a Reset is allowed to be */
      const withTwo = rows.concat([{id: uid('HRA'), userId: a.who, date: '2026-01-02',
        sessions: [{in: '2026-01-02T04:00:00.000Z', out: '2026-01-02T12:00:00.000Z'}]}]);
      const two = await put(withTwo);
      const dropped = withTwo.filter(x=>x.id !== mine.id);
      const gone = await put(dropped);
      /* a second punch-in on a day that has one is refused… */
      const appended = JSON.parse(JSON.stringify(withTwo));
      appended.find(x=>x.id === mine.id).sessions.push({in:new Date().toISOString(), out:null, inBy:a.who});
      const second = await put(appended);
      /* …so is a punch out moved earlier, or moved without keeping the one it replaced… */
      const s0 = mine.sessions[0];
      const earlier = JSON.parse(JSON.stringify(withTwo));
      Object.assign(earlier.find(x=>x.id === mine.id).sessions[0], {out: new Date(new Date(s0.out).getTime() - 60000).toISOString(),
        outHistory: (s0.outHistory || []).concat([{out: s0.out, outBy: s0.outBy, outLoc: s0.outLoc}])});
      const backwards = await put(earlier);
      const later = new Date(Date.now() + 1000).toISOString();
      const unkept = JSON.parse(JSON.stringify(withTwo));
      Object.assign(unkept.find(x=>x.id === mine.id).sessions[0], {out: later});
      const lost = await put(unkept);
      /* …while an honest later punch out, keeping the earlier one, goes through */
      const honest = JSON.parse(JSON.stringify(withTwo));
      Object.assign(honest.find(x=>x.id === mine.id).sessions[0], {out: later, outBy: a.who,
        outHistory: (s0.outHistory || []).concat([{out: s0.out, outBy: s0.outBy, outLoc: s0.outLoc}])});
      const ok = await put(honest);
      const back = (await sget('hrAttendance')) || [];
      const now = back.find(x=>x.id === mine.id) || {};
      return {edited, movedLoc, gone, ok, two, second, backwards, lost,
        kept: now.sessions && now.sessions[0] && now.sessions[0].in === mine.sessions[0].in,
        movedOut: now.sessions && now.sessions[0].out === later,
        sessions: (now.sessions || []).length, before: mine.sessions.length};
    }, {who: plain});
    if(r.edited.status !== 409) throw new Error('an edited timestamp was accepted (' + r.edited.status + ')');
    if(!/append-only/.test(r.edited.body.error || '')) throw new Error('it was refused for the wrong reason');
    if(r.movedLoc.status !== 409) throw new Error('an edited coordinate was accepted');
    if(r.two.status !== 200) throw new Error('adding a second day was refused (' + r.two.status + ')');
    if(r.gone.status !== 409) throw new Error('a dropped day was accepted');
    if(r.second.status !== 409) throw new Error('a second punch-in on the same day was accepted');
    if(r.backwards.status !== 409) throw new Error('a punch out moved earlier was accepted');
    if(r.lost.status !== 409) throw new Error('a punch out replaced without keeping the old one was accepted');
    if(r.ok.status !== 200) throw new Error('an honest later punch out was refused (' + r.ok.status + ' ' + JSON.stringify(r.ok.body) + ')');
    if(!r.kept) throw new Error('the original timestamp did not survive');
    if(!r.movedOut || r.sessions !== r.before) throw new Error('the later punch out did not land');
    return 'edited timestamp, edited coordinate, dropped day, a second punch-in and a punch out moved back '
      + 'or without its history all 409; a later punch out keeping the earlier one goes through';
  });

  t.section('whose records are whose');

  await t.step('the default is their own attendance, and nothing else under HR', async () => {
    const r = await t.eval(async (a)=>{
      const m = DB.team.find(t=>t.id === a.who);
      delete m.hrAccess; await save('team');
      const was = currentUser; currentUser = a.who;
      const out = {section: hrSectionOpen(),
        rail: railNavGroups().map(g=>g.id).indexOf('hr') >= 0,
        items: (NAV_GROUPS.find(g=>g.id === 'hr').items || []).filter(v=>hrModuleOpen(v)),
        widget: /Punch In|Punch Out/.test(hrPunchWidgetHtml()),
        leave: /Leave Request/.test(hrPunchWidgetHtml())};
      ['hrdashboard','hrincentive','hrappraisal'].forEach(v=>{
        navigate(v); out[v] = currentView; closeModal();
      });
      navigate('hrattendance');
      out.attendance = currentView;
      out.ownOnly = !/Everybody, today/.test(document.getElementById('content').innerHTML);
      navigate('dashboard');
      currentUser = was;
      return out;
    }, {who: plain});
    if(!r.section || !r.rail) throw new Error('HR is not in their rail by default');
    if(r.items.join(',') !== 'hrattendance')
      throw new Error('the HR group offers them: ' + r.items.join(', '));
    if(!r.widget || !r.leave) throw new Error('the punch clock or Leave Request is missing');
    if(r.attendance !== 'hrattendance') throw new Error('their own attendance did not open');
    if(!r.ownOnly) throw new Error('they can see everybody\u2019s attendance by default');
    ['hrdashboard','hrincentive','hrappraisal'].forEach(v=>{
      if(r[v] === v) throw new Error('typing the ' + v + ' route got them in');
    });
    return 'HR in the rail with Attendance Management alone, the punch clock and Leave Request on the '
      + 'Dashboard, their own records only \u2014 and the HR Dashboard, Incentive and Appraisal all bounce';
  });

  await t.step('granted Attendance only: their own, and neither of the other two', async () => {
    const r = await t.eval(async (a)=>{
      const m = DB.team.find(t=>t.id === a.who);
      m.hrAccess = {attendance: 1}; await save('team');
      const was = currentUser; currentUser = a.who;
      const out = {section: hrSectionOpen(), staff: hrIsStaff(), admin: hrIsAdmin(),
        rail: railNavGroups().map(g=>g.id).indexOf('hr') >= 0,
        attendance: hrModuleOpen('hrattendance'), incentive: hrModuleOpen('hrincentive'),
        appraisal: hrModuleOpen('hrappraisal'),
        people: hrPeople().map(p=>p.id), mine: hrMaySeeUser(a.who), theirs: hrMaySeeUser(a.other)};
      navigate('hrincentive');
      out.landed = currentView;
      out.said = ((document.querySelector('.modal')||{}).textContent||'').replace(/\s+/g,' ').slice(0, 200);
      closeModal();
      navigate('hrattendance');
      out.ownPage = currentView;
      out.ownHtml = /Punch In|Punch Out/.test(document.getElementById('content').innerHTML);
      out.sawOthers = /Everybody, today/.test(document.getElementById('content').innerHTML);
      navigate('dashboard');
      currentUser = was;
      return out;
    }, {who: plain, other: hrUser});
    if(!r.section || !r.rail) throw new Error('the section did not appear for a granted account');
    if(!r.attendance) throw new Error('they cannot reach their own attendance');
    if(r.staff || r.admin) throw new Error('a plain account is HR staff');
    if(r.incentive || r.appraisal) throw new Error('Incentive or Appraisal is open to a plain account');
    if(r.landed === 'hrincentive') throw new Error('typing the Incentive route got them in');
    if(!/HR screen|not open to this account/.test(r.said)) throw new Error('the refusal said: ' + r.said);
    if(r.people.length !== 1 || r.people[0] !== plain)
      throw new Error('they can list ' + r.people.length + ' people');
    if(!r.mine || r.theirs) throw new Error('they may read somebody else’s record');
    if(!r.ownPage || !r.ownHtml) throw new Error('their own attendance page did not draw');
    if(r.sawOthers) throw new Error('the everybody table was drawn for them');
    return 'their own punch buttons and their own history; Incentive and Appraisal refused by route as well '
      + 'as by the rail';
  });

  await t.step('an administrator grants it per submodule, and nothing else moves', async () => {
    const r = await t.eval(async (a)=>{
      const before = (()=>{ const was = currentUser; currentUser = a.who;
        const o = {lms: can('LMS','view'), cms: can('CMS','view'), setup: isSettingsVisible(),
                   team: can('Team','edit'), pages: pageAllowList().length,
                   caps: ADMIN_FLAGS.filter(f=>canAdmin(f)).join(',')};
        currentUser = was; return o; })();
      const m = DB.team.find(t=>t.id === a.who);
      /* exactly what an administrator ticks in Setup › Users & Access */
      m.hrAccess = {incentive: 1, staff: 1};
      await save('team');
      const was = currentUser; currentUser = a.who;
      const after = {staff: hrIsStaff(), admin: hrIsAdmin(),
        incentive: hrModuleOpen('hrincentive'), appraisal: hrModuleOpen('hrappraisal'),
        people: hrPeople().length,
        lms: can('LMS','view'), cms: can('CMS','view'), setup: isSettingsVisible(),
        team: can('Team','edit'), pages: pageAllowList().length,
        caps: ADMIN_FLAGS.filter(f=>canAdmin(f)).join(',')};
      navigate('hrappraisal');
      after.appraisalRoute = currentView; closeModal(); navigate('dashboard');
      currentUser = was;
      return {before, after};
    }, {who: hrUser});
    if(!r.after.incentive) throw new Error('the Incentive grant did not open Incentive');
    if(r.after.appraisal) throw new Error('Appraisal opened although it was not granted');
    if(r.after.appraisalRoute === 'hrappraisal') throw new Error('the Appraisal route got them in anyway');
    if(!r.after.staff) throw new Error('the "see everybody" grant did not take');
    if(r.after.admin) throw new Error('it made them an HR administrator too');
    if(r.after.people < 2) throw new Error('"see everybody" did not widen who they can see');
    ['lms','cms','setup','team','pages','caps'].forEach(k=>{
      if(String(r.before[k]) !== String(r.after[k]))
        throw new Error('granting HR changed ' + k + ': ' + r.before[k] + ' to ' + r.after[k]);
    });
    return 'Incentive and "see everybody" granted, Appraisal still refused by route as well as by the rail; '
      + 'LMS, CMS, Setup, Team edit, their page list and their capabilities are all exactly as they were';
  });

  await t.step('somebody granted "Administer HR" reaches Setup, and finds only HR in it', async () => {
    const r = await t.eval(async (a)=>{
      const before = (()=>{ const w = currentUser; currentUser = a.who;
        const o = {lms: can('LMS','view'), team: can('Team','edit'),
                   caps: ADMIN_FLAGS.filter(f=>canAdmin(f)).join(',')};
        currentUser = w; return o; })();
      const m = DB.team.find(t=>t.id === a.who);
      m.hrAccess = {admin: 1};
      await save('team');
      const was = currentUser; currentUser = a.who;
      const cats = settingsVisibleCategories();
      const out = {setup: isSettingsVisible(), hrAdmin: hrIsAdmin(),
        cats: cats.map(x=>x.id),
        tabs: [].concat.apply([], cats.map(x=>x.tabs.map(t=>t[0]))),
        /* and nothing of BOSS came with it */
        caps: ADMIN_FLAGS.filter(f=>canAdmin(f)),
        lms: can('LMS','view'), team: can('Team','edit')};
      navigate('settings','modulesetup');
      out.otherTab = settingsTab;
      navigate('dashboard');
      currentUser = was;
      /* and a person with no HR role at all still has no Setup */
      const was2 = currentUser; currentUser = a.plain;
      const plain = {setup: isSettingsVisible(), hrAdmin: hrIsAdmin()};
      currentUser = was2;
      return {out, plain, before};
    }, {who: hrUser, plain: plain});
    if(!r.out.hrAdmin) throw new Error('the grant did not make them an HR administrator');
    if(!r.out.setup) throw new Error('an HR administrator cannot reach Setup at all');
    if(r.out.cats.indexOf('hr') < 0) throw new Error('Setup did not show them HR');
    const beyond = r.out.cats.filter(x=>x !== 'hr' && x !== 'users');
    if(beyond.length) throw new Error('Setup also showed them: ' + beyond.join(', '));
    if(r.out.caps.join(',') !== r.before.caps)
      throw new Error('their BOSS capabilities moved: "' + r.before.caps + '" \u2192 "' + r.out.caps.join(',') + '"');
    if(String(r.out.lms) !== String(r.before.lms) || String(r.out.team) !== String(r.before.team))
      throw new Error('HR access moved LMS view or Team edit');
    if(r.out.otherTab === 'modulesetup') throw new Error('they opened a Setup screen that is not HR\u2019s');
    if(r.plain.setup || r.plain.hrAdmin) throw new Error('a plain account got Setup too');
    return 'Setup opens for them showing ' + r.out.cats.join(' and ') + ' (' + r.out.tabs.length
      + ' screens, HR\u2019s and the two links everybody has); no BOSS capability, no LMS, no Team edit, and '
      + 'Module Settings refused by route';
  });

  t.section('the formulas that have since been supplied');

  await t.step('Incentive computes the firm\u2019s workbook, Appraisal the engine', async () => {
    /* This used to assert that neither module computed anything,
       because neither had been given a rule. Both have been now: the
       Incentive module carries the firm\u2019s own grid, "RE Incentive
       Template - Ver 2", and the Appraisal module runs the Appraisal
       System\u2019s engine. What has NOT changed is where their inputs
       come from \u2014 the source registry, read-only \u2014 and that is
       what is checked here. */
    const r = await t.eval((a)=>eval('(' + a.AS + ')')(a.admin, ()=>{
      DB.hrSourceMaps = [{id:'HRMAP-ZZ1', source:'dst', incentive:true, appraisal:false, userField:''},
                         {id:'HRMAP-ZZ2', source:'reviews', incentive:false, appraisal:true, userField:''}];
      navigate('hrincentive');
      const inc = document.getElementById('content').innerHTML;
      navigate('hrappraisal');
      const app = document.getElementById('content').innerHTML;
      navigate('dashboard');
      const counts = hrSourceCounts(a.admin, 'incentive');
      const real = counts.map(c=>({k:c.src.key, field:c.info.field, n:c.n,
        actual: (DB[c.src.store]||[]).filter(x=>x && !x.deletedAt && c.info.field && x[c.info.field] === a.admin).length}));
      return {real,
        incGrid: /RE Incentive Template/.test(inc),
        incOpen: /the workbook does not settle/.test(inc),
        appEngine: !!window.AppraisalEngine,
        appWhere: /Where each figure comes from/.test(app),
        appMissing: /not in BOSS/.test(app),
        stores: {inc: DB.hrIncentives.length, app: DB.hrAppraisals.length}};
    }), {AS, admin});
    if(!r.incGrid) throw new Error('the Incentive module does not name the workbook it computes');
    if(!r.incOpen) throw new Error('and it does not raise what that workbook leaves open');
    if(!r.appEngine) throw new Error('the appraisal engine is not loaded');
    if(!r.appWhere) throw new Error('the Appraisal module does not say where its figures come from');
    if(!r.appMissing) throw new Error('and it does not name what BOSS cannot supply');
    const wrong = r.real.filter(x=>x.n !== x.actual);
    if(wrong.length) throw new Error('a count does not match the records: ' + JSON.stringify(wrong));
    return 'Incentive names its workbook and the questions it leaves open; Appraisal names every source and '
      + 'every gap; both still count real records';
  });

  await t.step('a source is read only once somebody has chosen it', async () => {
    const r = await t.eval((a)=>eval('(' + a.AS + ')')(a.admin, ()=>{
      DB.hrSourceMaps = [];
      /* Neither module may read a store the firm has not mapped to it.
         Both go through the same gate, so both are asked. */
      const incRows = incSourceRecords('dst', a.admin, new Date().toISOString().slice(0, 7)).length;
      const appr = apprSourceRows('meetings', a.admin, apprYearRange('2026', 'FY'));
      return {incRows, apprOk: appr.ok, apprWhy: appr.why,
        counts: hrSourceCounts(a.admin, 'incentive').length};
    }), {AS, admin});
    if(r.incRows) throw new Error('the task bank read ' + r.incRows + ' records off a source nobody chose');
    if(r.apprOk) throw new Error('the appraisal read a source nobody chose');
    if(!/not mapped to Appraisal/.test(r.apprWhy)) throw new Error('and it did not say why: ' + r.apprWhy);
    if(r.counts) throw new Error('it counted ' + r.counts + ' sources nobody chose');
    return 'nothing mapped, nothing read by either module, and each says so';
  });

  t.section('and the rest of BOSS is where it was');

  await t.step('the existing rail, routes and permissions are untouched', async () => {
    const r = await t.eval(()=>{
      const groups = NAV_GROUPS.map(g=>g.id);
      const hr = NAV_GROUPS.find(g=>g.id === 'hr');
      const others = NAV_GROUPS.filter(g=>g.id !== 'hr');
      return {groups, hrItems: hr ? hr.items : [],
        /* Payouts has its own gate (the payout team), and Partner Journey
           shows My Partner Journey to partners only; nothing else is gated. */
        gated: others.filter(g=>(g.gate || g.itemGate) && !['payouts','partnerjourney'].includes(g.id)).map(g=>g.id),
        modules: MODULES.filter(m=>/hr/i.test(m)),
        actions: ACTIONS.length, flags: ADMIN_FLAGS.length,
        /* every other module still routes */
        routes: ['lms','cms','rms','dst','reports','settings'].filter(v=>{ navigate(v); return currentView === v; })};
    });
    if(r.groups.indexOf('hr') < 0) throw new Error('the HR group is not in the rail registry');
    if(r.hrItems.length !== 4) throw new Error('HR carries ' + r.hrItems.length + ' items');
    if(r.gated.length) throw new Error('an existing group was given a gate: ' + r.gated.join(', '));
    if(r.modules.length) throw new Error('HR was added to the permission module list: ' + r.modules.join(', '));
    if(r.routes.length !== 6) throw new Error('an existing route stopped working: ' + r.routes.join(', '));
    return r.groups.length + ' rail groups with HR among them, no existing group gated, nothing added to '
      + 'MODULES, and LMS, CMS, RMS, DST, Reports and Setup all still route';
  });

  t.section('the logo in dark mode');

  await t.step('the wordmark gets its white back', async () => {
    const r = await t.eval(async ()=>{
      const c = DB.config.company || (DB.config.company = {});
      c.logoDataUrl = FREEDOM_LIFEX_LOGO;
      await save('config');
      const wasDark = darkMode;
      if(!darkMode) await toggleDarkMode();
      navigate('dashboard');
      const img = document.querySelector('.brand-logo');
      const dark = img ? getComputedStyle(img).backgroundColor : '';
      await toggleDarkMode();
      navigate('dashboard');
      const light = (document.querySelector('.brand-logo')
        ? getComputedStyle(document.querySelector('.brand-logo')).backgroundColor : '');
      if(wasDark) await toggleDarkMode();
      return {dark, light, had: !!img};
    });
    if(!r.had) throw new Error('there is no logo on the page to test');
    if(!/255,\s*255,\s*255/.test(r.dark))
      throw new Error('the logo has no white behind it in dark mode: ' + r.dark);
    if(/255,\s*255,\s*255/.test(r.light))
      throw new Error('the light theme was given a plate it does not need: ' + r.light);
    return 'white behind the logo in dark mode (' + r.dark + '), and nothing behind it in the light theme';
  });
});