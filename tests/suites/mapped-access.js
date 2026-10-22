/* A LIST THAT HIDES A ROW, AND A PAGE THAT HANDS IT OVER ON REQUEST.

   Scope already decided which rows a module's list drew. It decided
   nothing about a record asked for by name: navigate('cms','C-0007')
   opened C-0007 for whoever typed it, and the whole profile came with
   it — the portfolio, the blueprint, the money, the minutes. The
   editor, the save, the delete and the recycle bin were the same. An
   executive on "own" scope could not see a colleague's client in the
   list and could read every word of it one click later.

   The firm found a quieter version of it: an Executive opened ISEQ
   Forms and the panel under the list, "the risk profile of every
   client", meant every client in the firm.

   What this holds to: the record door asks visibleRecords() about the
   one record, so a record is open exactly when its own list would have
   drawn it; the editor, the save, the delete and the bin ask the same
   question; exports carry the same answer; and an Admin — or anyone on
   "all" — loses nothing. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();
  let mine = null, theirs = null, ids = null;

  await t.step('two executives on "own", each with a lead, a client, a review and a task', async () => {
    const r = await t.eval(async ()=>{
      const mk = name => {
        const m = {id: uid('TM'), name, role: roleList()[2] || 'Executive', status:'Active',
          scope:'own', branch:'ZZ Branch', email:name.replace(/\s+/g,'.').toLowerCase()+'@zz.in',
          adminFlags: fullAdminFlags(false), perms: fullPerms(true),
          createdAt:new Date().toISOString()};
        DB.team.push(m); return m.id;
      };
      const a = mk('ZZ Holder'), b = mk('ZZ Other');
      await save('team');
      const now = new Date().toISOString(), day = now.slice(0,10);
      const ids = {};
      [['a', a], ['b', b]].forEach(([tag, who])=>{
        const lead = uid('LMS'), client = uid('CMS'), review = uid('RMS'), task = uid('DST');
        const l = {id: lead, firstName:'ZZ Lead', lastName: tag, mobile:'90000000'+(tag==='a'?1:2),
          email:'zz.'+tag+'@zz.in', assignedTo: who, branch:'ZZ Branch', createdAt: now};
        initState('LMS', l); DB.leads.push(l);
        const c = {id: client, cmsName:'ZZ Client '+tag, rmName: who, branch:'ZZ Branch',
          iseqScore: 31, iseqCategory:'Moderate', iseqProfileDate: day, createdAt: now};
        initState('CMS', c); DB.clients.push(c);
        const v = {id: review, clientId: client, reviewType:'Annual', assignTo: who,
          meetingDate: day, createdAt: now};
        initState('RMS', v); DB.reviews.push(v);
        DB.tasks.push({id: task, taskType:'ZZ job '+tag, assignTo: who, overallStatus:'Not Started',
          assignedDate: day, dueDate: day, createdAt: now, createdBy: who});
        DB.businessEntries.push({id: uid('BIZ'), clientId: client, amount:'50000',
          status:'Initiated', loggedDate: day, createdAt: now, createdBy: who});
        ids[tag] = {lead, client, review, task};
      });
      await Promise.all(['leads','clients','reviews','tasks','businessEntries'].map(k=>save(k)));
      return {a, b, ids};
    });
    mine = r.a; theirs = r.b; ids = r.ids;
    return 'ZZ Holder and ZZ Other, both on "own", with a lead, client, review, task and business entry each';
  });

  await t.step('a record page opened by id is refused when the record is not mapped to me', async () => {
    const r = await t.eval((a)=>{
      const was = currentUser; currentUser = a.mine;
      const pages = {
        lead:   [viewLeadDetail(a.ids.a.lead),     viewLeadDetail(a.ids.b.lead)],
        client: [viewClientDetail(a.ids.a.client), viewClientDetail(a.ids.b.client)],
        review: [viewReviewDetail(a.ids.a.review), viewReviewDetail(a.ids.b.review)],
        task:   [viewTaskDetail(a.ids.a.task),     viewTaskDetail(a.ids.b.task)],
      };
      const out = {};
      Object.keys(pages).forEach(k=>{
        out[k] = {ownOpens: pages[k][0].indexOf('is not mapped to you') < 0,
                  otherRefused: pages[k][1].indexOf('is not mapped to you') >= 0,
                  leaked: pages[k][1].indexOf('ZZ Client b') >= 0
                       || pages[k][1].indexOf('ZZ job b') >= 0};
      });
      currentUser = was;
      return out;
    }, {mine, ids});
    const open = Object.keys(r).filter(k=>!r[k].otherRefused);
    if(open.length) throw new Error('still opens somebody else’s record: ' + open.join(', '));
    const spilt = Object.keys(r).filter(k=>r[k].leaked);
    if(spilt.length) throw new Error('refused the page but printed the record anyway: ' + spilt.join(', '));
    const shut = Object.keys(r).filter(k=>!r[k].ownOpens);
    if(shut.length) throw new Error('shut somebody out of their own record: ' + shut.join(', '));
    return 'lead, client, review and task each open for their holder and are refused to the other';
  });

  await t.step('the editor, the save and the delete ask the same question', async () => {
    const r = await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.mine;
      const before = JSON.stringify(DB.clients.find(c=>c.id===a.ids.b.client));
      const may = {
        ownEditor:   mayEditRecord('CMS', a.ids.a.client),
        otherEditor: mayEditRecord('CMS', a.ids.b.client),
        otherLead:   mayEditRecord('LMS', a.ids.b.lead),
        otherTask:   mayEditRecord('DST', a.ids.b.task),
        newRecord:   mayEditRecord('CMS', ''),
      };
      await saveClient(a.ids.b.client);
      const after = JSON.stringify(DB.clients.find(c=>c.id===a.ids.b.client));
      currentUser = was;
      return {may, untouched: before === after};
    }, {mine, ids});
    if(r.may.otherEditor || r.may.otherLead || r.may.otherTask)
      throw new Error('the editor still opens on an unmapped record');
    if(!r.may.ownEditor) throw new Error('the holder can no longer edit their own client');
    if(!r.may.newRecord) throw new Error('a brand new record was refused — it belongs to nobody yet');
    if(!r.untouched) throw new Error('saveClient() wrote to a client that is not mapped to this user');
    return 'the editor refuses an unmapped record, a new one still passes, and the save wrote nothing';
  });

  await t.step('"the risk profile of every client" counts one book, not the firm', async () => {
    const r = await t.eval((a)=>{
      const was = currentUser; currentUser = a.mine;
      const html = iseqCoverageHtml();
      currentUser = was;
      return {own: html.indexOf('ZZ Client a') >= 0, other: html.indexOf('ZZ Client b') >= 0,
              admin: iseqCoverageHtml().indexOf('ZZ Client b') >= 0};
    }, {mine, ids});
    if(r.other) throw new Error('the ISEQ panel still lists a client this user cannot open');
    if(!r.own) throw new Error('the ISEQ panel lost the user’s own client');
    if(!r.admin) throw new Error('the Admin lost sight of the firm’s clients');
    return 'the panel shows the holder their own client only, and the Admin still sees both';
  });

  await t.step('the recycle bin is a view of your records, not of everybody’s', async () => {
    const r = await t.eval(async (a)=>{
      const now = new Date().toISOString();
      [a.ids.a.client, a.ids.b.client].forEach(id=>{
        const c = DB.clients.find(x=>x.id===id); c.deletedAt = now; c.deletedBy = 'TM-0001';
      });
      await save('clients');
      const was = currentUser; currentUser = a.mine;
      const html = viewRecycleBin();
      const out = {own: html.indexOf('ZZ Client a') >= 0, other: html.indexOf('ZZ Client b') >= 0};
      currentUser = was;
      out.admin = viewRecycleBin().indexOf('ZZ Client b') >= 0;
      [a.ids.a.client, a.ids.b.client].forEach(id=>{
        const c = DB.clients.find(x=>x.id===id); delete c.deletedAt; delete c.deletedBy;
      });
      await save('clients');
      return out;
    }, {mine, ids});
    if(r.other) throw new Error('the bin shows a deleted record that was never this user’s');
    if(!r.own) throw new Error('the bin lost the user’s own deleted record');
    if(!r.admin) throw new Error('the Admin can no longer see the whole bin');
    return 'the bin lists the holder’s deleted client and not the other, and the Admin sees both';
  });

  await t.step('an export carries the same answer, module by module', async () => {
    const r = await t.eval((a)=>{
      const was = currentUser; currentUser = a.mine;
      const got = {};
      ['leads','clients','reviews','tasks','businessEntries'].forEach(id=>{
        const rows = exportRows(exportSource(id));
        got[id] = {own: rows.some(x=>x.id === a.ids.a[({leads:'lead',clients:'client',
                      reviews:'review',tasks:'task'})[id]] || (id==='businessEntries' && x.clientId===a.ids.a.client)),
                   other: rows.some(x=>x.id === a.ids.b[({leads:'lead',clients:'client',
                      reviews:'review',tasks:'task'})[id]] || (id==='businessEntries' && x.clientId===a.ids.b.client))};
      });
      currentUser = was;
      return got;
    }, {mine, ids});
    const leaking = Object.keys(r).filter(k=>r[k].other);
    if(leaking.length) throw new Error('an export still takes out somebody else’s rows: ' + leaking.join(', '));
    const empty = Object.keys(r).filter(k=>!r[k].own);
    if(empty.length) throw new Error('an export lost the user’s own rows: ' + empty.join(', '));
    return 'leads, clients, reviews, tasks and business entries each export one book and no more';
  });

  await t.step('and on "all" scope every door opens again', async () => {
    const r = await t.eval(async (a)=>{
      const m = DB.team.find(x=>x.id === a.mine);
      m.scope = 'all'; await save('team');
      const was = currentUser; currentUser = a.mine;
      const out = {
        client: viewClientDetail(a.ids.b.client).indexOf('is not mapped to you') < 0,
        review: viewReviewDetail(a.ids.b.review).indexOf('is not mapped to you') < 0,
        editor: mayEditRecord('LMS', a.ids.b.lead),
        iseq:   iseqCoverageHtml().indexOf('ZZ Client b') >= 0,
        export: exportRows(exportSource('clients')).some(x=>x.id === a.ids.b.client),
      };
      currentUser = was;
      m.scope = 'own'; await save('team');
      return out;
    }, {mine, ids});
    const shut = Object.keys(r).filter(k=>!r[k]);
    if(shut.length) throw new Error('"all" scope is still shut out of: ' + shut.join(', '));
    return 'nothing was taken from anybody meant to have it — "all" opens every one of them';
  });
});
