/* AN EXECUTIVE OPENED MEETINGS AND SAW THE WHOLE FIRM'S DIARY.

   Scope — own, team, branch, all — is what decides which records a
   person sees, and visibleRecords() is the one function that applies
   it. Every list module goes through it: LMS, CMS, RMS, Calls,
   Queries, Projects. Four did not — Meetings, Transactions, the
   Execution Tracker and DST read their whole store and drew the lot.
   The firm found it the obvious way: a Senior Executive on "own"
   opened Meetings and read somebody else's name in the Owner column.

   The test looks for each row's OWN id rather than its owner's,
   because a user id turns up in a filter dropdown whether the row was
   drawn or not — which is how the first version of this test lied to
   me twice.

   What it holds to: those four now answer to the same rule as the
   rest; a scope of "all" still sees everything, so nothing was taken
   from anybody meant to have it; and the Admin and the already
   filtered lists are untouched. */
const {suite} = require('../lib/harness');

const LISTS = [
  ['Meetings',          'viewMeetings'],
  ['Transactions',      'viewTransactions'],
  ['Execution Tracker', 'viewRecommendations'],
  ['DST',               'viewDST'],
];

suite(async t => {
  await t.home();
  let mine = null, theirs = null, ids = null;

  await t.step('two people on "own" scope, with a record of each kind each', async () => {
    const r = await t.eval(async ()=>{
      const mk = name => {
        const m = {id: uid('TM'), name, role: roleList()[2] || 'Executive', status:'Active',
          scope:'own', branch:'ZZ Branch', email:name.replace(/\s+/g,'.').toLowerCase()+'@zz.in',
          adminFlags: fullAdminFlags(false), perms: fullPerms(true),
          createdAt:new Date().toISOString()};
        DB.team.push(m); return m.id;
      };
      const a = mk('ZZ Mine'), b = mk('ZZ Theirs');
      await save('team');
      const now = new Date().toISOString(), day = now.slice(0, 10);
      const ids = {};
      [['a', a], ['b', b]].forEach(pair=>{
        const tag = pair[0], who = pair[1];
        const mtg = uid('MTG'), txn = uid('TXN'), rec = uid('REC'), dst = uid('DST');
        DB.meetings.push({id: mtg, subject:'ZZ meeting ' + tag, assignTo: who,
          scheduledDate: day, status:'Scheduled', createdAt: now, createdBy: who});
        DB.transactions.push({id: txn, transactionType:'Purchase', amount:'1000',
          status:'Initiated', rmName: who, initiatedDate: day, createdAt: now, createdBy: who});
        DB.recommendations.push({id: rec, status:'Draft', createdBy: who,
          createdAt: now, productCategory:'Mutual Funds'});
        DB.tasks.push({id: dst, taskType:'ZZ task ' + tag, assignTo: who, overallStatus:'Not Started',
          assignedDate: day, dueDate: day, createdAt: now, createdBy: who});
        ids[tag] = {Meetings: mtg, Transactions: txn, 'Execution Tracker': rec, DST: dst};
      });
      await Promise.all(['meetings','transactions','recommendations','tasks'].map(k=>save(k)));
      return {a, b, ids};
    });
    mine = r.a; theirs = r.b; ids = r.ids;
    return 'ZZ Mine and ZZ Theirs, both on "own", one meeting, transaction, allocation and task each';
  });

  await t.step('each of the four draws their own row and not the other', async () => {
    const r = await t.eval((a)=>{
      const was = currentUser; currentUser = a.mine;
      const out = {};
      a.lists.forEach(pair=>{
        const label = pair[0], html = window[pair[1]]();
        out[label] = {own: html.indexOf(a.ids.a[label]) >= 0,
                      other: html.indexOf(a.ids.b[label]) >= 0};
      });
      currentUser = was;
      return out;
    }, {mine, ids, lists: LISTS});
    const leaking = Object.keys(r).filter(k=>r[k].other);
    if(leaking.length) throw new Error('still drawing somebody else’s row: ' + leaking.join(', '));
    const blind = Object.keys(r).filter(k=>!r[k].own);
    if(blind.length) throw new Error('their own row vanished from: ' + blind.join(', '));
    return 'Meetings, Transactions, Execution Tracker and DST each draw their own row and nobody else’s';
  });

  await t.step('and with scope "all" every one of them shows everything again', async () => {
    const r = await t.eval(async (a)=>{
      const m = DB.team.find(t=>t.id === a.mine);
      m.scope = 'all'; await save('team');
      const was = currentUser; currentUser = a.mine;
      const out = {};
      a.lists.forEach(pair=>{
        const label = pair[0], html = window[pair[1]]();
        out[label] = html.indexOf(a.ids.b[label]) >= 0;
      });
      currentUser = was;
      m.scope = 'own'; await save('team');
      return out;
    }, {mine, ids, lists: LISTS});
    const blind = Object.keys(r).filter(k=>!r[k]);
    if(blind.length) throw new Error('"all" scope still cannot see everything on: ' + blind.join(', '));
    return 'nothing was taken from anybody meant to have it — "all" sees all four again';
  });

  await t.step('the Admin is unaffected, and the already-filtered lists are untouched', async () => {
    const r = await t.eval((a)=>{
      const admin = {};
      a.lists.forEach(pair=>{
        const label = pair[0];
        admin[label] = window[pair[1]]().indexOf(a.ids.b[label]) >= 0;
      });
      const was = currentUser; currentUser = a.mine;
      const already = {lms: visibleRecords(DB.leads, l=>l.assignedTo, l=>l.branch).length,
        allLeads: DB.leads.filter(l=>!l.deletedAt).length};
      currentUser = was;
      return {admin, already};
    }, {mine, ids, lists: LISTS});
    const lost = Object.keys(r.admin).filter(k=>!r.admin[k]);
    if(lost.length) throw new Error('the Admin lost sight of: ' + lost.join(', '));
    if(r.already.lms > r.already.allLeads) throw new Error('LMS visibility changed');
    return 'the Admin still sees all four; LMS is exactly where it was';
  });
});
