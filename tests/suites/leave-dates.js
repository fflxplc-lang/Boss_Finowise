/* THE DATES A LEAVE REQUEST MAY CARRY.

   The + Leave Request button is for time ahead: From and To cannot be
   earlier than today, in the calendar or on submit. Apply Leave on a day
   in the attendance history is for that day: both dates are set to it,
   cannot be changed, and the request is refused if they are. Who approves
   it and how is unchanged. */
const {suite} = require('../lib/harness');

suite(async t => {
  let plain = null, day = null, today = null;

  await t.step('a member, somebody in HR to approve, and a past day', async () => {
    const r = await t.eval(async ()=>{
      const mk = (name, extra) => {
        const m = Object.assign({id: uid('TM'), name, role: roleList().slice(-1)[0],
          email: name.replace(/\s+/g,'.').toLowerCase() + '@example.com', status:'Active', scope:'own',
          branch:'Varanasi', adminFlags: fullAdminFlags(false), perms: fullPerms(false, {view:1}),
          createdAt: new Date().toISOString()}, extra || {});
        DB.team.push(m); return m.id;
      };
      const out = {plain: mk('ZZ Leave Asker'), hr: mk('ZZ Leave HR', {hrAccess: {attendance: 1, staff: 1}})};
      await save('team');
      const d = new Date(); d.setDate(d.getDate() - 3);
      while(d.getDay() === 0) d.setDate(d.getDate() - 1);
      out.day = hrDateKey(d); out.today = hrToday();
      return out;
    });
    plain = r.plain; day = r.day; today = r.today;
    return 'today ' + today + ', history day ' + day;
  });

  const fill = async (a) => t.eval(async (a)=>{
    const was = currentUser; currentUser = a.who;
    hrOpenLeaveRequest(a.lock);
    const f = document.getElementById('f_hrReqFrom'), to = document.getElementById('f_hrReqTo');
    const seen = {min: f.min, max: f.max, readonly: f.readOnly, toMin: to.min, toReadonly: to.readOnly,
      from: f.value, to: to.value, note: document.getElementById('overlay').textContent};
    const sel = document.getElementById('f_hrReqType');
    if(sel && sel.options.length > 1) sel.value = sel.options[1].value;
    if(a.from) f.value = a.from;
    if(a.to) to.value = a.to;
    document.getElementById('f_hrReqReason').value = a.reason;
    const said = []; const al = window.alert; window.alert = m => said.push(String(m));
    await hrSubmitLeaveRequest();
    window.alert = al; closeModal(); currentUser = was;
    const row = (DB.hrLeave || []).find(l=>l.reason === a.reason);
    return Object.assign(seen, {said, row: row && {from: row.from, to: row.to, status: row.status}});
  }, a);

  t.section('+ Leave Request');

  await t.step('the calendar starts at today and nothing before it is offered', async () => {
    const r = await fill({who: plain, reason: 'ZZ look only', from: '', to: ''});
    if(r.min !== today || r.toMin !== today) throw new Error('min ' + r.min + ' / ' + r.toMin);
    if(r.readonly) throw new Error('the regular form should be editable');
    return 'From and To min = ' + r.min;
  });

  await t.step('a past start date is refused on submit', async () => {
    const r = await fill({who: plain, reason: 'ZZ past start', from: day, to: today});
    if(r.row) throw new Error('a request starting ' + day + ' was saved');
    if(!r.said.some(m=>/before today/.test(m))) throw new Error(r.said.join(' | '));
    return r.said[0];
  });

  await t.step('today onwards goes through as before, Pending', async () => {
    const r = await fill({who: plain, reason: 'ZZ today onwards', from: today, to: today});
    if(!r.row || r.row.status !== 'Pending') throw new Error(JSON.stringify(r.row) + ' ' + r.said.join(' | '));
    return r.row.from + ' to ' + r.row.to + ', ' + r.row.status;
  });

  t.section('Apply Leave from the attendance history');

  await t.step('the form opens on that day, and the dates cannot be changed', async () => {
    const r = await fill({who: plain, lock: day, reason: 'ZZ look only 2', from: '', to: ''});
    if(r.from !== day || r.to !== day) throw new Error('opened on ' + r.from + ' / ' + r.to);
    if(!r.readonly || !r.toReadonly || r.min !== day || r.max !== day) throw new Error(JSON.stringify(r));
    if(!/only/.test(r.note)) throw new Error('no note saying it is for that day only');
    return 'locked to ' + day;
  });

  await t.step('a request with another date is refused', async () => {
    const r = await fill({who: plain, lock: day, reason: 'ZZ moved date', to: today});
    if(r.row) throw new Error('saved with ' + JSON.stringify(r.row));
    if(!r.said.some(m=>/only/.test(m))) throw new Error(r.said.join(' | '));
    return r.said[0];
  });

  await t.step('the day itself goes through, even though it is past', async () => {
    const r = await fill({who: plain, lock: day, reason: 'ZZ history day'});
    if(!r.row || r.row.from !== day || r.row.to !== day || r.row.status !== 'Pending')
      throw new Error(JSON.stringify(r.row) + ' ' + r.said.join(' | '));
    return r.row.from + ', ' + r.row.status;
  });
});
