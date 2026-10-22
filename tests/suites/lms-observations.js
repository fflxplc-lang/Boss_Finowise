/* OBSERVATIONS WHILE EXPLORING LMS AND 7 EVENTS.

   Five things the firm met on the data gathering form and the meeting
   mails: the Type list on an aspirational goal and the income heads have
   to open in full; the pure insurance table asks for the term plan; a
   meeting link pasted by hand reaches the client with the meeting
   details, not under the signature; and the minutes of a meeting go out
   laid out as minutes. */
const {suite} = require('../lib/harness');

suite({mail: true}, async t => {
  let lead = null;

  await t.step('a lead on the 7 Events form', async () => {
    lead = await t.eval(async ()=>{
      const l = {id:uid('LEAD'), firstName:'ZZ', lastName:'Observer', mobile:'9800011111', email:'zz.observer@example.com',
        assignedTo:currentUser, dob:'1988-01-01', transformationForm:'SEVENEVENTS',
        createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('LMS', l); DB.leads.push(l);
      const st = seStateOf(l);
      st.income = [{id:uid('SER'), desc:'Self Salary', gross:220000, ded:26000}, seNewRow('income')];
      st.aspGoals = [Object.assign(seNewRow('aspGoals'), {desc:'Foreign Trip to Switzerland', year:2028})];
      seWriteState(l, st);
      await save('leads');
      return l.id;
    });
    return lead;
  });

  t.section('the lists open in full');

  for(const [name, re, want] of [['income heads', /Monthly gross income/i, 7], ['goal Type', /Goal description/i, 2]]){
    await t.step('the ' + name + ' list opens over the table, every option reachable', async () => {
      const r = await t.eval(async a=>{
        sheetAdapter('SEVENEVENTS').open(a.lead, 'input');
        await new Promise(r=>setTimeout(r,700));
        const tbl = Array.from(document.querySelectorAll('.se-t')).find(x=>new RegExp(a.re, 'i').test(x.textContent));
        const picks = tbl ? tbl.querySelectorAll('.pick-input') : [];
        const inp = a.re.indexOf('Goal') >= 0 ? picks[0] : picks[picks.length-1];
        if(!inp) return {err:'no picker'};
        inp.scrollIntoView({block:'center'}); inp.focus();
        await new Promise(r=>setTimeout(r,200));
        const list = document.getElementById('picklist_' + inp.id.replace('pickbox_',''));
        const rows = Array.from(list.querySelectorAll('.pick-row'));
        const last = rows[rows.length-1].getBoundingClientRect();
        const hit = document.elementFromPoint(last.left + 8, last.top + last.height/2);
        const ok = rows.length && list.contains(hit);
        inp.blur();
        return {rows: rows.length, lastVisible: ok, labels: rows.map(r=>r.textContent.trim())};
      }, {lead, re: re.source});
      if(r.err) throw new Error(r.err);
      if(r.rows < want) throw new Error('only ' + r.rows + ' options: ' + r.labels.join(', '));
      if(!r.lastVisible) throw new Error('the last option is covered or cut off');
      return r.labels.join(' · ');
    });
  }

  t.section('term plan details are mandatory');

  await t.step('a new form opens the pure insurance table on a Term Plan row, and Term Plan is first in the list', async () => {
    const r = await t.eval(()=>({first: (seBlank().pureIns[0]||{}).type, list: seTagged('PURE','term'),
      order: cfgList('se.list.PURE').map(i=>i.label)[0]}));
    if(r.first !== 'Term Plan' || r.order !== 'Term Plan') throw new Error(JSON.stringify(r));
    return 'opens on ' + r.first;
  });

  await t.step('the form is not complete without the term plan, and a sum assured of 0 answers it', async () => {
    const r = await t.eval(async id=>{
      const l = DB.leads.find(x=>x.id===id);
      const st = seStateOf(l);
      const term = m => m.filter(x=>/Term Plan/.test(x.label)).map(x=>x.label);
      st.pureIns = [Object.assign(seNewRow('pureIns'), {type:'Mediclaim Policy', sa:500000})];
      seWriteState(l, st);
      const without = term(seMissingOn(l, 'any'));
      st.pureIns = [Object.assign(seNewRow('pureIns'), {type:'Mediclaim Policy', sa:500000}),
                    Object.assign(seNewRow('pureIns'), {type:'Term Plan'})];
      seWriteState(l, st);
      const blankSa = seMissingOn(l, 'any').filter(x=>/Pure insurance policies row 2/.test(x.label)).map(x=>x.label);
      st.pureIns[1].sa = 0; seWriteState(l, st);
      const answered = term(seMissingOn(l, 'any')).concat(seMissingOn(l, 'any').filter(x=>/Pure insurance/.test(x.label)).map(x=>x.label));
      return {without, blankSa, answered};
    }, lead);
    if(!r.without.length) throw new Error('no term plan, yet nothing is missing');
    if(!r.blankSa.length) throw new Error('a Term Plan row with no sum assured passed');
    if(r.answered.length) throw new Error('a sum assured of 0 was not taken as an answer: ' + r.answered.join('; '));
    return r.without[0];
  });

  t.section('the meeting link');

  await t.step('a link pasted by hand is in the meeting details, above the signature', async () => {
    const r = await t.eval(async id=>{
      const l = DB.leads.find(x=>x.id===id);
      l.status = 'qualified'; await save('leads');
      const tr = availableTransitions('LMS','qualified','forward', l).find(x=>MEETING_SCHEDULE_TRANSITIONS.has(x.id));
      openScheduleMeetingModal('LMS', l.id, tr.id);
      await new Promise(r=>setTimeout(r,300));
      const sel = document.getElementById('f_schedPlatform'); sel.value = 'Google Meet';
      await meetingPlatformChosen();
      document.getElementById('f_schedLink').value = 'https://meet.google.com/abc-defg-hij';
      document.getElementById('f_schedWhen').value = '2026-11-02T11:00';
      await submitScheduleMeeting('LMS', l.id, tr.id);
      return tr.id;
    }, lead);
    await t.wait(1200);
    const m = t.mail.received.find(x=>/Meeting/.test(x.subject));
    if(!m) throw new Error('no invitation went out');
    const text = m.text || '';
    const at = text.indexOf('meet.google.com/abc-defg-hij'), sig = text.indexOf('sig-html'), mode = text.indexOf('Mode: Google Meet');
    if(at < 0) throw new Error('the link is not in the mail');
    if(sig >= 0 && at > sig) throw new Error('the link is still below the signature');
    if(mode < 0 || at < mode) throw new Error('the link is not with the meeting details');
    if(!/<a href="https:\/\/meet\.google\.com\/abc-defg-hij"/.test(text)) throw new Error('the link is not clickable');
    return 'under the Mode line, clickable';
  });

  t.section('the minutes');

  await t.step('the minutes go out with the details table, numbered points and an action-point table', async () => {
    t.mail.clear();
    await t.eval(async id=>{
      const l = DB.leads.find(x=>x.id===id);
      const m = DB.meetings.find(x=>x.linkedRecordId===id); if(m){ m.status = 'Completed'; await save('meetings'); }
      l.status = 'firstMeetingCompleted'; await save('leads');
      const tr = availableTransitions('LMS','firstMeetingCompleted','forward', l)[0];
      openSendMomModal('LMS', id, tr.id);
      await new Promise(r=>setTimeout(r,300));
      document.getElementById('f_momText').value = 'Reviewed current savings and expenses\n- Discussed term cover for the family\n3. Agreed to share bank statements';
      document.getElementById('f_momAp0').value = 'Share the last six months of bank statements';
      await submitSendMom('LMS', id, tr.id);
    }, lead);
    await t.wait(1200);
    const m = t.mail.received.find(x=>/minutes/i.test(x.subject));
    if(!m) throw new Error('no minutes went out');
    const text = m.text || '';
    const checks = {details: /Minutes of Meeting<\/td>/.test(text) && /Attended By/.test(text),
      numbered: (text.match(/<li/g)||[]).length === 3 && !/<li[^>]*>- /.test(text),
      actions: /Action Point<\/td>/.test(text) && /bank statements/.test(text),
      headings: /font-weight:bold;color:#164B5E;font-size:14.5px[^>]*>1\. Discussion Summary/.test(text)};
    const bad = Object.keys(checks).filter(k=>!checks[k]);
    if(bad.length) throw new Error('missing: ' + bad.join(', ') + ' — ' + text.slice(0, 600));
    return Object.keys(checks).join(', ');
  });
});
