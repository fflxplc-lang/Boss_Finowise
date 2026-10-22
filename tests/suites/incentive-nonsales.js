/* THE OTHER HALF, AND WHAT NOBODY HAS TOLD US.

   The workbook is the Relationship Executive grid. It covers sales
   people and says nothing whatever about anybody else: no task bank,
   no points, no payout slab, no eligibility rule. So the non-sales
   half is a frame with the firm's own rules to be poured into it, and
   the one thing that must never happen is BOSS inventing the missing
   number. Until somebody says what a point is worth, points are
   awarded, no rupees are shown, and a month cannot be finalised.

   The two rules that do exist and must hold: a record counts once —
   two task rows over the same source must not pay twice for one piece
   of work — and a person is on one method, never both. */
const {suite} = require('../lib/harness');

const SEED = async ()=>{
  DB.config.departments = (DB.config.departments || []).concat(
    [{id:'DEP-ZSALES', name:'ZZ Sales Floor', active:true},
     {id:'DEP-ZOPS', name:'ZZ Back Office', active:true}]);
  ['ZZ Seller','ZZ Clerk','ZZ Both'].forEach((nm, i)=>{
    const id = 'USR-INC' + i;
    let u = DB.team.find(x=>x.id === id);
    if(!u){ u = {id, documents:[], notes:[], perms:{}, adminFlags:{}}; DB.team.push(u); }
    Object.assign(u, {name:nm, email:'inc' + i + '@example.com', role: defaultRole(),
      status:'Active', branch:'Varanasi', incentiveCtc: 360000});
    delete u.incentiveCategory;
    setUserDepartments(u, i === 0 ? ['DEP-ZSALES'] : ['DEP-ZOPS']);
  });
  DB.config.incentive = Object.assign({}, DB.config.incentive, {
    salesRoles: [], salesDepartments: ['ZZ Sales Floor'], pointValue: null,
    tasks: [
      {id:'IT-A', name:'ZZ Service task', source:'dst', points:5, cap:0, active:true,
       roles:[], departments:[]},
      {id:'IT-B', name:'ZZ Any task again', source:'dst', points:9, cap:0, active:true,
       roles:[], departments:[]}]});
  /* Four DST tasks on the clerk in the month, one outside it. */
  const month = '2026-08';
  DB.tasks = (DB.tasks || []).filter(x=>!/^TSK-INC/.test(x.id || ''));
  for(let i = 0; i < 4; i++) DB.tasks.push({id:'TSK-INC' + i, assignTo:'USR-INC1',
    title:'ZZ task ' + i, taskType:'KYC Update', createdAt: month + '-1' + i + 'T09:00:00.000Z'});
  DB.tasks.push({id:'TSK-INCX', assignTo:'USR-INC1', title:'ZZ last month',
    taskType:'KYC Update', createdAt:'2026-07-11T09:00:00.000Z'});
  DB.hrSourceMaps = (DB.hrSourceMaps || []).filter(m=>m.source !== 'dst')
    .concat([{id:'HRMAP-ZZ', source:'dst', incentive:true, appraisal:false, userField:'assignTo'}]);
  await save('config'); await save('team'); await save('tasks'); await save('hrSourceMaps');
  return month;
};

suite(async t => {

  t.section('who is paid which way');

  await t.step('the central rule decides, and the account overrules it', async () => {
    await t.eval(SEED);
    const r = await t.eval(async ()=>{
      const say = id => incCategoryOf(id) + ' (' + incCategoryWhy(id) + ')';
      const byDept = say('USR-INC0'), none = say('USR-INC1');
      /* A role rule as well as a department one. */
      DB.config.incentive = Object.assign({}, DB.config.incentive,
        {salesRoles:[roleOf(DB.team.find(x=>x.id === 'USR-INC2'))]});
      const byRole = say('USR-INC2');
      /* And the account beats both. */
      DB.team.find(x=>x.id === 'USR-INC0').incentiveCategory = 'nonSales';
      const pinned = say('USR-INC0');
      DB.config.incentive = Object.assign({}, DB.config.incentive, {salesRoles:[]});
      delete DB.team.find(x=>x.id === 'USR-INC0').incentiveCategory;
      return {byDept, none, byRole, pinned};
    });
    if(!/^sales \(their department, ZZ Sales Floor\)/.test(r.byDept))
      throw new Error('the department rule gave: ' + r.byDept);
    if(!/^nonSales \(no sales rule matches them\)/.test(r.none))
      throw new Error('somebody matching nothing gave: ' + r.none);
    if(!/^sales \(their role, /.test(r.byRole)) throw new Error('the role rule gave: ' + r.byRole);
    if(!/^nonSales \(set on this account\)/.test(r.pinned))
      throw new Error('the account did not overrule the department: ' + r.pinned);
    return 'department → sales, role → sales, neither → non-sales, and the account wins';
  });

  await t.step('nobody is on both methods at once', async () => {
    const r = await t.eval(()=>(DB.team || []).filter(isMemberActive)
      .map(p=>incCategoryOf(p)).filter(c=>c !== 'sales' && c !== 'nonSales').length);
    if(r) throw new Error(r + ' account(s) resolved to something other than one of the two');
    return 'every account resolves to exactly one of the two';
  });

  t.section('the task bank');

  await t.step('points come off records BOSS already keeps, inside the month', async () => {
    const month = '2026-08';
    const r = await t.eval((m)=>{
      const p = incTaskPoints('USR-INC1', m);
      return {points: p.points, rows: p.rows.map(x=>x.task.name + ':' + x.found + '/' + x.counted),
              rate: p.rate, payable: p.payable};
    }, month);
    if(r.points !== 20) throw new Error('4 tasks at 5 points should be 20, not ' + r.points);
    return '4 tasks found in ' + month + ' (the fifth is last month), 20 points';
  });

  await t.step('a record counts once, however many tasks claim it', async () => {
    const r = await t.eval((m)=>{
      const p = incTaskPoints('USR-INC1', m);
      const second = p.rows.find(x=>x.task.id === 'IT-B');
      return {total: p.points, found: second.found, counted: second.counted,
              already: second.already, pts: second.points};
    }, '2026-08');
    if(r.found !== 4) throw new Error('the second task did not see the same 4 records');
    if(r.counted !== 0 || r.pts !== 0)
      throw new Error('it counted ' + r.counted + ' of them again, paying ' + r.pts);
    if(r.already !== 4) throw new Error('and it did not report them as already counted');
    if(r.total !== 20) throw new Error('the total double-counted: ' + r.total);
    return 'the second task saw all 4, took none, and said why — 20 points, not 56';
  });

  await t.step('a cap is a cap', async () => {
    const r = await t.eval(async ()=>{
      const was = JSON.parse(JSON.stringify(DB.config.incentive.tasks));
      DB.config.incentive.tasks = [Object.assign({}, was[0], {cap: 2})];
      const p = incTaskPoints('USR-INC1', '2026-08');
      DB.config.incentive.tasks = was;
      return {points: p.points, capped: p.rows[0].capped, counted: p.rows[0].counted};
    });
    if(r.counted !== 2 || r.points !== 10) throw new Error('a cap of 2 counted ' + r.counted);
    if(!r.capped) throw new Error('and it did not say it had capped');
    return '4 found, 2 counted, 10 points, and it says it capped';
  });

  await t.step('a task scoped to a role or department skips everybody else', async () => {
    const r = await t.eval(async ()=>{
      const was = JSON.parse(JSON.stringify(DB.config.incentive.tasks));
      DB.config.incentive.tasks = [Object.assign({}, was[0], {departments:['ZZ Sales Floor']})];
      const clerk = incTaskPoints('USR-INC1', '2026-08');
      DB.config.incentive.tasks = was;
      return {rows: clerk.rows.length, points: clerk.points};
    });
    if(r.rows || r.points) throw new Error('it applied anyway: ' + JSON.stringify(r));
    return 'a Sales Floor task finds nothing on somebody in Back Office';
  });

  t.section('and the rule nobody has given us');

  await t.step('points, but no rupees, until somebody sets the conversion', async () => {
    const r = await t.eval(()=>{
      const p = incTaskPoints('USR-INC1', '2026-08');
      return {points: p.points, rate: p.rate, payable: p.payable,
              said: (INCENTIVE_QUERIES.find(q=>q.id === 'pointValue') || {}).title || ''};
    });
    if(r.rate !== null || r.payable !== null)
      throw new Error('a conversion was invented: ' + r.rate + ' / ' + r.payable);
    if(!r.points) throw new Error('and it awarded no points either');
    if(!/point/i.test(r.said)) throw new Error('the gap is not raised to the firm');
    return r.points + ' points, no payout, and the missing rule is on the screen';
  });

  await t.step('and a non-sales month cannot be finalised without it', async () => {
    const r = await t.eval(async ()=>{
      const sheet = incBlankSheet('USR-INC1', '2026-08');
      DB.hrIncentives = (DB.hrIncentives || []).filter(x=>x.id !== sheet.id).concat([sheet]);
      await save('hrIncentives');
      await incFinalise(sheet.id);
      const refused = incSheetFor('USR-INC1', '2026-08').status;
      DB.config.incentive = Object.assign({}, DB.config.incentive, {pointValue: 25});
      await incFinalise(sheet.id);
      const after = incSheetFor('USR-INC1', '2026-08');
      return {refused, status: after.status, total: after.finalTotal};
    });
    if(r.refused !== 'Draft') throw new Error('it finalised with no conversion set');
    if(r.status !== 'Finalised') throw new Error('and it would not finalise once one was: ' + r.status);
    if(r.total !== 500) throw new Error('20 points at ₹25 should be ₹500, not ' + r.total);
    return 'refused while unset; ₹500 once the firm said ₹25 a point';
  });

  t.section('history');

  await t.step('a finalised month is not restated by a later change', async () => {
    const r = await t.eval(async ()=>{
      const sheet = incSheetFor('USR-INC1', '2026-08');
      const atFinal = incResultOf(sheet).total;
      DB.config.incentive = Object.assign({}, DB.config.incentive, {pointValue: 1000});
      const stillFinal = incResultOf(sheet).total;
      await incReopen(sheet.id);
      const asDraft = incResultOf(incSheetFor('USR-INC1', '2026-08')).total;
      DB.config.incentive = Object.assign({}, DB.config.incentive, {pointValue: 25});
      return {atFinal, stillFinal, asDraft};
    });
    if(r.atFinal !== 500 || r.stillFinal !== 500)
      throw new Error('a rate change restated a finalised month: ' + r.atFinal + ' → ' + r.stillFinal);
    if(r.asDraft !== 20000) throw new Error('and a reopened draft did not follow the new rate: ' + r.asDraft);
    return 'finalised at ₹500 and stayed ₹500 while the rate went to ₹1,000; reopened, it follows it';
  });

  await t.step('nothing was alerted but the refusal and the reopen', async () => {
    const stray = t.dialogs.filter(d=>!/point is not worth anything yet|^Reopen /.test(String(d)));
    if(stray.length) throw new Error('alerts: ' + stray.join(' | ').slice(0, 220));
    return 'only the refusal and the reopen confirmation';
  });
});
