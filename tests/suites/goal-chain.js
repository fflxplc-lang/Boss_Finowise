/* ONE CHAIN: PLAN → GOAL → ALLOTMENT → MAPPING → CONVERSION → PROFILE.

   The firm asked for an audit before any change, and the audit found
   one real break and three things already true.

   Already true: every planning workflow's goals reach the client,
   because clientGoals() folds in blueprintGoalsOf() — 7 Events' goal
   table, GAB and Goal-Based Planning's goal list, FSL's rungs — each
   with a deterministic id, which is what stops a re-edited plan
   making a second copy of the same goal. Mapping is refused until
   units are allotted. And the client profile and the tracker read the
   same DB.transactions.

   The break: conversion re-pointed eight stores at the new client and
   not the three that matter most here. A goal agreed during the
   lead's planning was orphaned, the execution plan went on naming the
   lead, and anything raised off it stayed the lead's — so a converted
   client's profile showed no goals, no allocation and no
   transactions, and the funds mapped to those goals were invisible. */
const {suite} = require('../lib/harness');

const SEED = async ()=>{
  DB.leads = (DB.leads || []).filter(l=>!/^ZZ Chain/.test(l.firstName || ''));
  DB.clients = (DB.clients || []).filter(c=>!/^ZZ Chain/.test(c.cmsName || ''));
  DB.clientGoals = (DB.clientGoals || []).filter(g=>!/^ZZ /.test(g.name || ''));
  const lead = {id: uid('LMS'), firstName:'ZZ Chain', lastName:'Lead', mobile:'9800111222',
    email:'chain@example.com', assignedTo: currentUser, branch:'Varanasi',
    createdAt:new Date().toISOString()};
  /* A plan of each kind, in the shape blueprintGoalsOf() reads. */
  lead.planRounds = [{n:1, type:'FSL', clientDecision:'Approved', output:{
    years: 15,
    bpGoals: [{name:'ZZ Seven Retirement', fc: 30000000, year: 2046}],
    goals:   [{name:'ZZ Gab Education',   fv: 5000000,  year: 2034}],
    rows:    [{name:'ZZ Fsl Level Three', fv: 1500000}]}}];
  DB.leads.push(lead);
  await save('leads'); await save('clientGoals');
  return lead.id;
};

suite(async t => {
  await t.home();
  await t.eval(src => { window.SEED_FN = eval('(' + src + ')'); }, String(SEED));
  let leadId = null, clientId = null;

  t.section('every planning workflow’s goals are already central');

  await t.step('7 Events, GAB and FSL goals all read as the record’s goals', async () => {
    leadId = await t.eval(async ()=>await SEED_FN());
    const r = await t.eval(async (id)=>{
      const lead = DB.leads.find(l=>l.id === id);
      /* clientGoals() takes a record; a lead's plan reads the same way. */
      const asClient = {id: 'ZZ-TMP', planRounds: lead.planRounds};
      const goals = blueprintGoalsOf(asClient);
      /* Edit the plan and read again: the ids must not move, or a
         re-approved plan would double every goal. */
      const before = goals.map(g=>g.id);
      lead.planRounds[0].output.bpGoals[0].fc = 31000000;
      const after = blueprintGoalsOf(asClient);
      return {names: goals.map(g=>g.name), targets: goals.map(g=>g.target),
              dates: goals.map(g=>g.targetDate), before,
              afterIds: after.map(g=>g.id), afterTarget: after[0].target,
              count: after.length};
    }, leadId);
    if(r.names.length !== 3)
      throw new Error('the three workflows produced ' + r.names.length + ' goals: ' + r.names.join(', '));
    ['ZZ Seven Retirement','ZZ Gab Education','ZZ Fsl Level Three'].forEach(n=>{
      if(r.names.indexOf(n) < 0) throw new Error(n + ' did not come through');
    });
    if(!r.dates[0]) throw new Error('the 7 Events goal came through with no target date');
    if(r.before.join(',') !== r.afterIds.join(','))
      throw new Error('editing the plan changed the goal ids, so a re-approval would duplicate them');
    if(r.count !== 3) throw new Error('editing the plan left ' + r.count + ' goals');
    if(r.afterTarget !== 31000000) throw new Error('the edited figure did not follow through');
    return 'three workflows, three goals with their names, targets and years; '
      + 'the ids hold across an edit, so a re-approved plan does not double them';
  });

  t.section('and a lead that converts keeps all of it');

  await t.step('goals, the plan, its transactions and their mappings all move', async () => {
    const r = await t.eval(async (id)=>{
      const lead = DB.leads.find(l=>l.id === id);
      /* What the lead's journey produced: a goal of their own, an
         execution plan, and a transaction off it mapped to that goal. */
      const goal = {id: uid('GOL'), leadId: lead.id, name:'ZZ Lead Own Goal',
        target:'2000000', targetDate:'2035-01-01', createdAt:new Date().toISOString()};
      DB.clientGoals.push(goal);
      const rec = {id: uid('REC'), leadId: lead.id, clientId: null, sourceModule:'Blueprint',
        planRound: 1, status:'Client Accepted', productCategory:'Mutual Fund',
        schemes:[Object.assign(newAllocSchemeLine({productCategory:'Mutual Fund'}),
          {schemeName:'ZZ Chain Scheme', amount:'400000', transactionType:'Purchase'})],
        attachments:[], createdAt:new Date().toISOString()};
      DB.recommendations.push(rec);
      const txn = {id: uid('TXN'), leadId: lead.id, clientId: null, amount:'400000',
        transactionType:'Purchase', productCategory:'Mutual Fund', schemeName:'ZZ Chain Scheme',
        status: txnDoneStatus(), recommendationId: rec.id, sourceModule:'Asset Allocation',
        placedAt:new Date().toISOString(), allottedAt:new Date().toISOString(),
        goalId: goal.id, goalMappedAt:new Date().toISOString(),
        attempts:[{n:1, reference:'ZZ-CHAIN-1', placedAt:new Date().toISOString(),
                   allottedAt:new Date().toISOString()}],
        initiatedDate:new Date().toISOString().slice(0,10)};
      DB.transactions.push(txn);
      await save('clientGoals'); await save('recommendations'); await save('transactions');
      const client = await convertLeadIntoClient(lead);
      const c = DB.clients.find(x=>x.id === client.id);
      const goals = clientGoals(c);
      return {client: c.id,
              goalIds: DB.clientGoals.filter(g=>!g.deletedAt && /^ZZ /.test(g.name))
                .map(g=>({id:g.id, clientId:g.clientId, leadId:g.leadId || null, name:g.name})),
              sameGoalId: DB.clientGoals.find(g=>g.name === 'ZZ Lead Own Goal').id === goal.id,
              goalsOnProfile: goals.map(g=>g.name).sort(),
              planClient: (DB.recommendations.find(x=>x.id === rec.id) || {}).clientId,
              planLead: (DB.recommendations.find(x=>x.id === rec.id) || {}).leadId,
              txnClient: (DB.transactions.find(x=>x.id === txn.id) || {}).clientId,
              stillMapped: (DB.transactions.find(x=>x.id === txn.id) || {}).goalId === goal.id,
              attempts: (DB.transactions.find(x=>x.id === txn.id) || {}).attempts.length,
              dupes: DB.clientGoals.filter(g=>g.name === 'ZZ Lead Own Goal').length,
              roundFound: !!allocationForPlanRound(id, 1)};
    }, leadId);
    clientId = r.client;
    const own = r.goalIds.find(g=>g.name === 'ZZ Lead Own Goal');
    if(!own) throw new Error('the lead’s own goal is gone');
    if(own.clientId !== clientId || own.leadId)
      throw new Error('the goal still names the lead: ' + JSON.stringify(own));
    if(!r.sameGoalId) throw new Error('the goal was given a new id, so every mapping to it broke');
    if(r.dupes !== 1) throw new Error('conversion left ' + r.dupes + ' copies of the goal');
    if(r.planClient !== clientId || r.planLead)
      throw new Error('the execution plan still names the lead');
    if(r.txnClient !== clientId) throw new Error('the transaction still names the lead');
    if(!r.stillMapped) throw new Error('the fund lost its goal on conversion');
    if(r.attempts !== 1) throw new Error('the attempt history was lost');
    if(!r.roundFound)
      throw new Error('the plan round’s allocation cannot be found after conversion, so a DBT would open a second sheet');
    /* The plan's own goals follow the lead too, through planRoundForClient. */
    ['ZZ Seven Retirement','ZZ Gab Education','ZZ Fsl Level Three','ZZ Lead Own Goal'].forEach(n=>{
      if(r.goalsOnProfile.indexOf(n) < 0)
        throw new Error(n + ' is not on the converted profile: ' + r.goalsOnProfile.join(', '));
    });
    return 'the goal kept its id and its mapping, the plan and the transaction moved with it, '
      + 'the attempt history survived, and all four goals are on the profile — none of them twice';
  });

  t.section('the profile and the tracker are the same records');

  await t.step('the summary reads the tracker’s own, and opens them', async () => {
    const r = await t.eval(cid=>{
      const c = DB.clients.find(x=>x.id === cid);
      window._clientTab = 'transactions';
      const html = JSON.stringify(viewClientDetail(cid));
      const mine = DB.transactions.filter(x=>x.clientId === cid && !x.deletedAt);
      return {names: mine.length,
              hasSection: /Transaction Tracker/.test(html),
              opensIt: mine.every(x=>html.indexOf('openTransactionCard(\\u0027' + x.id + '\\u0027') >= 0
                                   || html.indexOf("openTransactionCard('" + x.id + "'") >= 0),
              saysStage: /Unit Allotted|Goal Mapped|Transaction Placed|Not Started/.test(html),
              saysGoal: /ZZ Lead Own Goal/.test(html),
              toTracker: /navigate\('transactions'\)/.test(html)};
    }, clientId);
    if(!r.hasSection) throw new Error('the profile has no Transaction Tracker summary');
    if(!r.opensIt) throw new Error('a row on the summary does not open the transaction itself');
    if(!r.saysStage) throw new Error('the summary does not say what stage anything is at');
    if(!r.saysGoal) throw new Error('the summary does not say which goal the fund is mapped to');
    if(!r.toTracker) throw new Error('there is no way through to the tracker');
    return r.names + ' transaction(s) summarised on the profile, each opening the tracker’s own record';
  });

  await t.step('a stage moved in the tracker is moved on the profile, with nothing to refresh', async () => {
    const r = await t.eval(async cid=>{
      const t0 = DB.transactions.find(x=>x.clientId === cid && !x.deletedAt);
      window._clientTab = 'transactions';
      const before = JSON.stringify(viewClientDetail(cid));
      /* Worked through the tracker's own move, not by editing a copy. */
      openTxnGoalMap(t0.id);
      closeModal();
      delete t0.goalId; delete t0.goalMappedAt;
      delete t0.allottedAt;
      t0.placedAt = new Date().toISOString();
      t0.attempts = [{n:1, reference:'ZZ-CHAIN-9', placedAt:t0.placedAt}];
      t0.status = txnPlacedStatus();
      await save('transactions');
      const after = JSON.stringify(viewClientDetail(cid));
      /* And the goal no longer claims the fund. */
      window._clientTab = 'goals';
      const goals = JSON.stringify(viewClientDetail(cid));
      return {before: /Goal Mapped/.test(before), after: /Transaction Placed/.test(after),
              stillMapped: /Goal Mapped/.test(after),
              goalShowsFund: /ZZ Chain Scheme/.test(goals)};
    }, clientId);
    if(!r.before) throw new Error('the summary did not show the mapped stage to begin with');
    if(!r.after) throw new Error('the profile did not follow the stage back to Transaction Placed');
    if(r.stillMapped) throw new Error('the profile is still showing the old stage — it is reading a copy');
    if(r.goalShowsFund) throw new Error('the goal still lists a fund that is no longer mapped to it');
    return 'the stage moved once and read the same in both places; the goal dropped the fund with it';
  });

  await t.step('and a fund mapped to a goal is listed under that goal', async () => {
    const r = await t.eval(async cid=>{
      const t0 = DB.transactions.find(x=>x.clientId === cid && !x.deletedAt);
      const goal = DB.clientGoals.find(g=>g.name === 'ZZ Lead Own Goal');
      t0.allottedAt = new Date().toISOString();
      t0.units = '2,104.55';
      await save('transactions');
      /* The mapping goes through the tracker's own save. */
      openTxnGoalMap(t0.id);
      document.getElementById('f_txnGoal').value = goal.id;
      await saveTxnGoalMap(t0.id);
      window._clientTab = 'goals';
      const html = JSON.stringify(viewClientDetail(cid));
      return {underGoal: /goal-funds/.test(html) && /ZZ Chain Scheme/.test(html),
              units: /2,104.55/.test(html),
              mapped: DB.transactions.find(x=>x.id === t0.id).goalId === goal.id};
    }, clientId);
    if(!r.mapped) throw new Error('the mapping did not save');
    if(!r.underGoal) throw new Error('the goal does not list the fund mapped to it');
    if(!r.units) throw new Error('the allotment details are not shown under the goal');
    return 'the fund is listed under its goal with its amount, its stage and its units';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 220));
    return 'none';
  });
});
