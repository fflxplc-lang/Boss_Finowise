/* ONE DECISION, OFFERED ONCE.

   A plan sitting on "Plan — Pending Senior Approval" drew its panel —
   who it is with, Open the plan, Approve, Send it back — and then drew
   a row of stage buttons underneath carrying the same two decisions
   under longer names: "Approve Plan" and "← Approval Declined — Rework
   Plan". Two pairs of buttons, one outcome each way, and nothing on the
   screen saying they were the same thing.

   The row is the one that goes, because the panel is the one that says
   who the plan is with and lets you read it first. The precedent is
   already in the code: the stage after the Data Gathering Meeting drops
   its row for exactly this reason.

   What this holds to: that an approver sees each decision once and both
   still work; that somebody who may NOT approve sees what they saw
   before, with the forward step held and the reason on it; and that no
   other stage lost its row. */
const {suite} = require('../lib/harness');

const AS = `(id, fn) => { const was = currentUser; currentUser = id; try { return fn(); } finally { currentUser = was; } }`;

suite(async t => {
  await t.home();
  let leadId, approver, outsider;

  await t.step('a plan with the reporting manager', async () => {
    const r = await t.eval(async ()=>{
      const boss = DB.team.find(x=>isAdmin(x)) || DB.team[0];
      const mk = (name, role, parent) => {
        const m = {id: uid('TM'), name, role, email: name.replace(/\s+/g,'.').toLowerCase() + '@zz.in',
          status:'Active', scope:'all', branch:'Varanasi', parentUserId: parent,
          adminFlags: fullAdminFlags(false), perms: fullPerms(true),
          createdAt:new Date().toISOString()};
        DB.team.push(m); return m.id;
      };
      const mgr = mk('ZZ Manish Singh', roleList()[1] || 'Manager', boss.id);
      const rm  = mk('ZZ Junior RM', roleList()[2] || 'Relationship Manager', mgr);
      const out = mk('ZZ Outsider', roleList()[2] || 'Relationship Manager', boss.id);
      await save('team');
      const l = {id:uid('LEAD'), leadName:'ZZ Vishal 2', firstName:'Vishal', lastName:'Two',
        mobile:'9800033333', email:'vishal2@example.com', rmName: rm, assignedTo: rm,
        transformationForm:'SEVENEVENTS', createdAt:new Date().toISOString(), createdBy: rm};
      initState('LMS', l);
      l.status = 'fbpPrepared';
      l.planRounds = [{n:1, type:'SEVENEVENTS', createdAt:new Date().toISOString(),
        inputSubmittedAt:new Date().toISOString(), inputSubmittedBy:'Client',
        output:{}, seniorStatus:'Pending', sentForApprovalAt:new Date().toISOString()}];
      DB.leads.push(l); await save('leads');
      return {id:l.id, mgr, out, state: stateOf('LMS', l)};
    });
    leadId = r.id; approver = r.mgr; outsider = r.out;
    if(r.state !== 'fbpPrepared') throw new Error('the fixture sits on ' + r.state);
    return 'on "Plan — Pending Senior Approval", with ZZ Manish Singh as the approver';
  });

  await t.step('the approver is offered each decision once', async () => {
    const r = await t.eval((a)=>eval('(' + a.AS + ')')(a.who, ()=>{
      const rec = DB.leads.find(x=>x.id === a.lead);
      const html = blueprintWidget('LMS', rec, {});
      const count = re => (html.match(re) || []).length;
      return {mine: canApprovePlan(rec),
        panelApprove: /approveBlueprint\('[^']+', true\)/.test(html),
        panelDecline: /approveBlueprint\('[^']+', false\)/.test(html),
        openPlan: /openPlanBlueprint\(/.test(html),
        rowForward: count(/Approve Plan/g),
        rowBack: count(/Approval Declined/g),
        transitions: count(/doTransition\(/g)};
    }), {AS, who: approver, lead: leadId});
    if(!r.mine) throw new Error('the fixture approver cannot approve');
    if(!r.panelApprove || !r.panelDecline)
      throw new Error('the panel lost its own buttons');
    if(!r.openPlan) throw new Error('the panel lost Open the plan');
    if(r.rowForward) throw new Error('"Approve Plan" is still drawn ' + r.rowForward + ' time(s)');
    if(r.rowBack) throw new Error('"Approval Declined" is still drawn ' + r.rowBack + ' time(s)');
    if(r.transitions) throw new Error('the stage row still offers ' + r.transitions + ' transition(s)');
    return 'Approve and Send it back once each, on the panel, with Open the plan beside them';
  });

  await t.step('and both of them still do what they did', async () => {
    const r = await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.who;
      const rec = DB.leads.find(x=>x.id === a.lead);
      await approveBlueprint(a.lead, true);
      const after = {state: stateOf('LMS', rec), status: (latestPlanRound(rec)||{}).seniorStatus};
      /* put it back and decline instead */
      rec.status = 'fbpPrepared';
      const round = latestPlanRound(rec); round.seniorStatus = 'Pending'; delete round.approvedAt;
      await save('leads');
      await approveBlueprint(a.lead, false, 'ZZ rework the goals');
      const declined = {state: stateOf('LMS', rec), status: (latestPlanRound(rec)||{}).seniorStatus};
      currentUser = was;
      return {after, declined};
    }, {who: approver, lead: leadId});
    if(r.after.state === 'fbpPrepared')
      throw new Error('Approve did not move the plan on: still ' + r.after.state);
    if(r.declined.state === r.after.state)
      throw new Error('Send it back landed in the same place as Approve: ' + r.declined.state);
    return 'Approve → ' + r.after.state + ' (' + r.after.status + '); '
      + 'Send it back → ' + r.declined.state + ' (' + r.declined.status + ')';
  });

  await t.step('somebody who may not approve sees exactly what they saw before', async () => {
    const r = await t.eval(async (a)=>{
      const rec = DB.leads.find(x=>x.id === a.lead);
      rec.status = 'fbpPrepared';
      const round = latestPlanRound(rec); round.seniorStatus = 'Pending';
      await save('leads');
      const was = currentUser; currentUser = a.who;
      const html = blueprintWidget('LMS', rec, {});
      const out = {mine: canApprovePlan(rec),
        panelButtons: /approveBlueprint\(/.test(html),
        /* the row they always had: the forward is the approver's and was
           never offered to them, the way back out is */
        row: /doTransition\(/.test(html) || /Approval Declined/.test(html),
        says: /with the reporting manager|Pending approval/i.test(html),
        dump: html.replace(/\s+/g,' ').slice(0, 500)};
      currentUser = was;
      return out;
    }, {who: outsider, lead: leadId});
    if(r.mine) throw new Error('the outsider can approve, so nothing was tested');
    if(r.panelButtons) throw new Error('the panel offers Approve to somebody who may not');
    if(!r.row) throw new Error('the stage row vanished for a non-approver too: ' + r.dump);
    if(!r.says) throw new Error('nothing says the plan is with the senior');
    return 'their row is untouched, the panel offers them no decision, and the stage says who it is with';
  });

  await t.step('no other stage lost its row', async () => {
    const r = await t.eval(async (a)=>{
      const rec = DB.leads.find(x=>x.id === a.lead);
      const kept = rec.status;
      const out = {};
      ['qualified','firstMeetingScheduled','secondMeetingScheduled'].forEach(st=>{
        rec.status = st;
        out[st] = (blueprintWidget('LMS', rec, {}).match(/doTransition\(|STAGE_FORM|openSend/g) || []).length;
      });
      rec.status = kept;
      return out;
    }, {lead: leadId});
    const dead = Object.entries(r).filter(([, n])=>!n).map(x=>x[0]);
    if(dead.length) throw new Error('these stages now offer nothing: ' + dead.join(', '));
    return Object.entries(r).map(([k, n])=>k + ': ' + n).join(' · ');
  });
});
