/* FOUR THINGS AN RM FOUND, AND WHAT EACH ONE ACTUALLY WAS.

   The firm sent four screenshots from one Relationship Manager's
   account. None of them was the thing it looked like.

   1. "Not able to view call logs." The refusal was correct — the
      account has no View on Calls — but it was one grey line that
      named no permission, no administrator and no way to ask. Every
      other module in BOSS says all three. This one, and ARC with it,
      now do too.

   2. "Not able to view ARC." The same line, the same silence.

   3. "I have prepared 7 events but when I click on 7 Events no data
      is available." The records were there. A lead's owner is
      assignedTo and a client's is rmName, and the blueprint list read
      assignedTo off both — so every CLIENT on a blueprint arrived at
      the scope check with no owner, and the scope check, comparing it
      against the signed-in account, drew none of them. Admins saw
      everything, which is why it had not been caught.

   4. "I have entered client branch Mumbai but entry shows in
      Varanasi." A meeting, a task, an allocation and a transaction
      each carry a branch stamped on them the day they were written,
      and the reader took that copy before it took the client's own.
      Move a client and every record under them stayed where it was. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();

  t.section('a refusal that says where it is undone');

  await t.step('Call Logs names the permission, the place and the way to ask', async () => {
    const r = await t.eval(async ()=>{
      const m = {id: uid('TM'), name:'ZZ Divya', role: roleList()[2] || 'Executive', status:'Active',
        scope:'own', branch:'Varanasi', email:'zz.divya@zz.in',
        adminFlags: fullAdminFlags(false), perms: fullPerms(true),
        createdAt:new Date().toISOString()};
      /* Everything on, View on Calls and Meetings off — the shape the
         screenshots were taken in. */
      ['Calls','Meetings'].forEach(k=>{ if(m.perms[k]) m.perms[k].view = false; });
      DB.team.push(m); await save('team');
      currentUser = m.id;
      const calls = viewCalls(), arc = viewARC();
      return {calls, arc,
              callsSaysWhere: /Users &amp; Access/.test(calls),
              callsAsk: /Request access/.test(calls),
              callsTitled: /Call Logs/.test(calls),
              arcSaysWhere: /Users &amp; Access/.test(arc),
              arcAsk: /Request access/.test(arc),
              arcTitleTwice: (arc.match(/Annual Review Calendar/g) || []).length,
              who: (me()||{}).name || 'nobody'};
    });
    if(/have permission to view call logs/.test(r.calls))
      throw new Error('Call Logs still answers with the bare line');
    if(!r.callsTitled) throw new Error('the Call Logs wall does not say which page it is');
    if(!r.callsSaysWhere) throw new Error('Call Logs does not say where the permission is granted; '
      + 'signed in as ' + r.who);
    if(!r.callsAsk) throw new Error('Call Logs offers no way to request access');
    if(!r.arcSaysWhere) throw new Error('ARC does not say where the permission is granted');
    if(!r.arcAsk) throw new Error('ARC offers no way to request access');
    /* ARC is titled by the topbar, so a wall that titled it again
       would print the name of the page twice. */
    if(r.arcTitleTwice > 1) throw new Error('the ARC wall repeats the page title');
    return 'both name the permission, the Setup path and a Request access button';
  });

  t.section('a client on a blueprint belongs to its RM');

  await t.step('the 7 Events list draws a client whose RM is the one signed in', async () => {
    const r = await t.eval(async ()=>{
      const rm = DB.team.find(x=>x.name === 'ZZ Divya');
      const c = {id: uid('CMS'), cmsName:'ZZ Blueprint Client', rmName: rm.id, branch:'Varanasi',
        status:'Active', createdAt:new Date().toISOString(),
        planRounds:[{n:1, type:'SEVENEVENTS', at:new Date().toISOString()}]};
      DB.clients.push(c); await save('clients');
      const before = planOwnerOf(c);
      const rows = blueprintRecords('SEVENEVENTS');
      const mine = visibleRecords(rows.map(x=>Object.assign({}, x, {
        owner: (x.store==='clients' ? x.record.rmName : x.record.assignedTo) || '',
        branch: x.record.branch})), y=>y.owner, y=>y.branch);
      const html = viewBlueprintList(blueprintModuleFor('bp:SEVENEVENTS'));
      return {owner: before, onBlueprint: rows.some(x=>x.record.id === c.id),
              visible: mine.some(x=>x.record.id === c.id),
              drawn: html.indexOf(c.id) >= 0,
              named: html.indexOf('ZZ Divya') >= 0};
    });
    if(!r.onBlueprint) throw new Error('the client is not on the blueprint at all');
    if(r.owner !== undefined && !r.owner) throw new Error('planOwnerOf gives a client no owner');
    if(!r.visible) throw new Error('the scope check still drops a client off the blueprint');
    if(!r.drawn) throw new Error('the list does not draw the client');
    if(!r.named) throw new Error('the RM column is blank for a client');
    return 'the client is on the list, and the RM column names who it belongs to';
  });

  t.section('the branch is the client’s, not a copy of it');

  await t.step('moving a client to Mumbai moves everything under them', async () => {
    const r = await t.eval(async ()=>{
      const rm = DB.team.find(x=>x.name === 'ZZ Divya');
      const c = {id: uid('CMS'), cmsName:'ZZ Branch Client', rmName: rm.id, branch:'Varanasi',
        status:'Active', createdAt:new Date().toISOString()};
      DB.clients.push(c);
      /* Stamped Varanasi the day it was written, which is what the
         old reader went by. */
      const meeting = {id: uid('MTG'), clientId: c.id, assignTo: rm.id, branch:'Varanasi',
        subject:'ZZ Review', scheduledDate:new Date().toISOString().slice(0,10),
        createdAt:new Date().toISOString()};
      const task = {id: uid('DST'), clientId: c.id, assignTo: rm.id, branch:'Varanasi',
        taskType:'ZZ Task', overallStatus:'Not Started', createdAt:new Date().toISOString()};
      const call = {id: uid('CALL'), clientId: c.id, loggedBy: rm.id, branch:'Varanasi',
        subject:'ZZ Call', callDate:new Date().toISOString().slice(0,10),
        createdAt:new Date().toISOString()};
      DB.meetings.push(meeting); DB.tasks.push(task); DB.callEntries.push(call);
      await save('clients'); await save('meetings'); await save('tasks'); await save('callEntries');
      const was = {m: listBranchOf(meeting, MEETING_OWNER_FIELDS),
                   t: listBranchOf(task, TASK_OWNER_FIELDS), c: callBranchOf(call)};
      // The correction the firm made.
      c.branch = 'Mumbai'; await save('clients');
      const now = {m: listBranchOf(meeting, MEETING_OWNER_FIELDS),
                   t: listBranchOf(task, TASK_OWNER_FIELDS), c: callBranchOf(call)};
      // A record naming nobody keeps its own stamp rather than losing it.
      const orphan = {id: uid('CALL'), loggedBy: rm.id, branch:'Pune', subject:'ZZ Orphan'};
      const kept = callBranchOf(orphan);
      // A client with no branch at all must not drop the row out of every tab.
      const blank = {id: uid('CMS'), cmsName:'ZZ No Branch', rmName: rm.id, branch:''};
      DB.clients.push(blank); await save('clients');
      const onBlank = callBranchOf({id:uid('CALL'), clientId: blank.id, loggedBy: rm.id, branch:'Pune'});
      return {was, now, kept, onBlank};
    });
    if(r.was.m !== 'Varanasi') throw new Error('the fixture did not take');
    ['m','t','c'].forEach(k=>{
      if(r.now[k] !== 'Mumbai')
        throw new Error('a record still reads ' + r.now[k] + ' after the client moved to Mumbai');
    });
    if(r.kept !== 'Pune') throw new Error('a record naming no client lost its own branch');
    if(r.onBlank !== 'Pune') throw new Error('a client with no branch dropped the row out of every tab');
    return 'meeting, task and call all follow the client to Mumbai; an orphan keeps its own';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 220));
    return 'none';
  });
});
