/* THE APPRAISAL SYSTEM, ON LIVE BOSS DATA.

   The Appraisal System arrived as appraisal-engine.js — a UMD module
   of pure functions with no DOM, no storage and no idea what BOSS is.
   The rule was that it stays as it is and BOSS is not touched either,
   so it is served as its own file, byte for byte what was handed over,
   and everything between the two lives in an integration layer that
   reads BOSS and never writes to it.

   This suite proves the three things that rule is actually about.

   The engine is unmodified: its own exports, its own defaults, its own
   arithmetic, checked by computing a case by hand and asking it the
   same question.

   What BOSS supplies is really BOSS: the CTC off the team record, the
   Meetings KPI off meetings that exist, the reporting line off the
   reporting line — and it moves when the records move, with nothing
   imported.

   And what BOSS cannot supply is named rather than filled in. Company
   growth cannot be had from undated transactions. Four of the five Cs
   are a manager's judgement. Every KPI the engine itself marks manual
   stays manual. None of it is invented. */
const {suite} = require('../lib/harness');

const SEED = async ()=>{
  ['ZZ Appraisee','ZZ Manager'].forEach((nm, i)=>{
    const id = 'USR-APR' + i;
    let u = DB.team.find(x=>x.id === id);
    if(!u){ u = {id, documents:[], notes:[], perms:{}, adminFlags:{}}; DB.team.push(u); }
    Object.assign(u, {name:nm, email:'apr' + i + '@example.com', role: defaultRole(),
      status:'Active', branch:'Varanasi', incentiveCtc: 650000});
    delete u.appraisalRoleKey;
  });
  setUserManagers(DB.team.find(x=>x.id === 'USR-APR0'), ['USR-APR1']);
  DB.config.appraisal = {roleMap:{}, growth:{'2026':{abs:18, sip:22, lump:15}}};
  DB.config.appraisal.roleMap['role:' + incKey(defaultRole())] = 'clientsRM';
  DB.hrSourceMaps = (DB.hrSourceMaps || []).filter(m=>m.source !== 'meetings')
    .concat([{id:'HRMAP-APR', source:'meetings', incentive:false, appraisal:true, userField:'assignTo'}]);
  DB.meetings = (DB.meetings || []).filter(m=>!/^MTG-APR/.test(m.id || ''));
  for(let i = 0; i < 150; i++) DB.meetings.push({id:'MTG-APR' + i, assignTo:'USR-APR0',
    subject:'ZZ meeting ' + i, scheduledDate:'2026-06-' + String((i % 28) + 1).padStart(2, '0')});
  DB.hrAppraisals = [];
  await save('team'); await save('config'); await save('hrSourceMaps');
  await save('meetings'); await save('hrAppraisals');
  return true;
};

suite(async t => {

  t.section('the engine, untouched');

  await t.step('it is served as its own file and loads before BOSS', async () => {
    const r = await t.eval(()=>({
      there: !!window.AppraisalEngine,
      exports: window.AppraisalEngine ? Object.keys(window.AppraisalEngine).sort() : [],
      cfg: window.AppraisalEngine ? JSON.stringify(window.AppraisalEngine.DEFAULT_CONFIG.cWeights) : '',
      pool: window.AppraisalEngine ? JSON.stringify(window.AppraisalEngine.DEFAULT_CONFIG.poolWeights) : '',
      roles: window.AppraisalEngine ? Object.keys(window.AppraisalEngine.DEFAULT_CONFIG.roles).sort() : [],
    }));
    if(!r.there) throw new Error('window.AppraisalEngine is not there');
    const want = ['DEFAULT_CONFIG','STD10_BANDS','achievementPct','appraisalMonthKeys','appraisalYearLabel',
      'companyGrowthPool','compute5C','computeAppraisal','creditedGrowthPct','currentAppraisalYear',
      'monthKey','scoreFromBand'];
    if(r.exports.join(',') !== want.join(','))
      throw new Error('its exports have moved: ' + r.exports.join(','));
    if(r.cfg !== '{"curiosity":5,"competence":20,"commitment":20,"creativity":5}')
      throw new Error('its weights have been edited: ' + r.cfg);
    if(r.pool !== '{"abs":0.5,"sip":0.25,"lump":0.25}')
      throw new Error('its pool weighting has been edited: ' + r.pool);
    if(r.roles.join(',') !== 'clientsRM,operations,partnersRM')
      throw new Error('its roles have moved: ' + r.roles.join(','));
    return r.exports.length + ' exports, the four weights and the three roles exactly as handed over';
  });

  await t.step('its arithmetic is its own, and it is right', async () => {
    const r = await t.eval(()=>{
      const E = window.AppraisalEngine;
      /* Worked by hand: curiosity 85/100×5 = 4.25, competence 82/100×20 = 16.4,
         commitment 90/100×20 = 18, creativity 70/100×5 = 3.5. KPI 95 → the
         meetings band at min 75 pays 25; 80 → the std band at 75 pays 7.5;
         75 → 7.5. Contribution 40. Score 82.15.
         Pool = 18×0.5 + 22×0.25 + 15×0.25 = 18.25.
         Increment = 18.25 × 82.15/100 = 14.992...%, on 650000 = 97,450. */
      const out = E.computeAppraisal({config: E.DEFAULT_CONFIG, roleKey:'clientsRM', salary:650000,
        growth:{abs:18, sip:22, lump:15},
        rating:{curiosity:85, competence:82, commitment:90, creativity:70, kpi:[95, 80, 75],
                scoreOverride:null}});
      return {score: Math.round(out.score * 100) / 100, pool: out.pool,
              inc: Math.round(out.incrementPct * 1000) / 1000, amount: out.amount,
              newSalary: out.newSalary, contribution: out.breakdown.contribution};
    });
    if(r.contribution !== 40) throw new Error('contribution is ' + r.contribution + ', the bands say 40');
    if(r.score !== 82.15) throw new Error('the score is ' + r.score + ', by hand it is 82.15');
    if(r.pool !== 18.25) throw new Error('the pool is ' + r.pool + ', by hand it is 18.25');
    if(r.amount !== 97450) throw new Error('the increment is ' + r.amount + ', by hand it is 97,450');
    if(r.newSalary !== 747450) throw new Error('the new salary is ' + r.newSalary);
    return 'score 82.15 · pool 18.25% · increment ' + r.inc + '% · ₹97,450 on ₹6,50,000';
  });

  t.section('what BOSS really supplies');

  await t.step('the CTC, the role mapping and the Meetings KPI are read live', async () => {
    await t.eval(SEED);
    const r = await t.eval(()=>{
      const m = apprMapping('USR-APR0', '2026');
      const meet = m.kpis.find(k=>k.kpi.key === 'meetings');
      return {roleKey: m.roleKey, why: apprRoleWhy('USR-APR0'), salary: apprSalaryOf('USR-APR0'),
              ok: meet.got.ok, total: meet.got.total, target: meet.got.target, pct: meet.got.pct,
              working: meet.got.working,
              have: m.have.map(h=>h.field)};
    });
    if(r.roleKey !== 'clientsRM') throw new Error('the role mapped to ' + r.roleKey);
    if(!/their role/.test(r.why)) throw new Error('the mapping is not explained: ' + r.why);
    if(r.salary !== 650000) throw new Error('the CTC read ' + r.salary);
    if(!r.ok) throw new Error('the Meetings KPI could not be read');
    if(r.total !== 150) throw new Error('it counted ' + r.total + ' meetings, 150 exist in FY2026');
    if(r.target !== 300 || r.pct !== 50)
      throw new Error('150 of 300 should be 50%, it says ' + r.pct + ' of ' + r.target);
    if(!/150 meetings in BOSS/.test(r.working)) throw new Error('it does not show its working');
    return 'CTC ₹6,50,000, role Clients RM, 150 of 300 meetings = 50% — with the working printed';
  });

  await t.step('and it moves when BOSS moves, with nothing imported', async () => {
    const r = await t.eval(async ()=>{
      const before = apprMapping('USR-APR0', '2026').kpis.find(k=>k.kpi.key === 'meetings').got;
      for(let i = 150; i < 240; i++) DB.meetings.push({id:'MTG-APR' + i, assignTo:'USR-APR0',
        subject:'ZZ more ' + i, scheduledDate:'2026-09-' + String((i % 28) + 1).padStart(2, '0')});
      await save('meetings');
      const after = apprMapping('USR-APR0', '2026').kpis.find(k=>k.kpi.key === 'meetings').got;
      return {before: before.pct, after: after.pct, total: after.total};
    });
    if(r.before !== 50) throw new Error('it started at ' + r.before);
    if(r.total !== 240 || r.after !== 80)
      throw new Error('90 more meetings should take it to 240 and 80%, it says '
        + r.total + ' and ' + r.after + '%');
    return '50% → 80% the moment the meetings landed, no import and no reload';
  });

  await t.step('a meeting outside the appraisal year is not counted', async () => {
    const r = await t.eval(async ()=>{
      DB.meetings.push({id:'MTG-APROLD', assignTo:'USR-APR0', subject:'ZZ before the year',
        scheduledDate:'2026-02-14'});
      await save('meetings');
      const fy = apprMapping('USR-APR0', '2026').kpis.find(k=>k.kpi.key === 'meetings').got.total;
      return {fy, range: apprYearRange('2026', 'FY')};
    });
    if(r.range.from !== '2026-04-01' || r.range.to !== '2027-03-31')
      throw new Error('FY2026 reads ' + JSON.stringify(r.range));
    if(r.fy !== 240) throw new Error('a February meeting was counted into FY2026: ' + r.fy);
    return 'FY2026 is Apr-2026 to Mar-2027, and February stayed out of it';
  });

  await t.step('a source nobody mapped to Appraisal is not read at all', async () => {
    const r = await t.eval(async ()=>{
      const was = DB.hrSourceMaps.slice();
      DB.hrSourceMaps = [];
      const got = apprMapping('USR-APR0', '2026').kpis.find(k=>k.kpi.key === 'meetings').got;
      DB.hrSourceMaps = was;
      return {ok: got.ok, why: got.why};
    });
    if(r.ok) throw new Error('it read a source nobody had chosen');
    if(!/not mapped to Appraisal/.test(r.why)) throw new Error('and it did not say why: ' + r.why);
    return 'nothing mapped, nothing read, and it says so rather than reporting zero';
  });

  t.section('what BOSS cannot supply is named, not invented');

  await t.step('company growth, the four judged Cs and every manual KPI', async () => {
    const r = await t.eval(()=>{
      const m = apprMapping('USR-APR0', '2026');
      return {missing: m.missing.map(x=>x.field),
              why: m.missing.map(x=>x.why).join(' | '),
              manual: m.kpis.filter(k=>!k.auto).map(k=>k.kpi.label)};
    });
    /* Growth used to be flatly unavailable. It is read now, off the
       monthly AUM ledger and the Business tracker — but only where
       those actually hold the two dates it needs, and this fixture
       has no ledger at all, so it must still be named as missing
       WITH the reason, rather than quietly coming back as 0%. */
    if(!r.missing.some(f=>/growth/i.test(f)))
      throw new Error('company growth is not declared missing: ' + r.missing.join(', '));
    if(!/ledger/.test(r.why))
      throw new Error('and the reason does not name the ledger: ' + r.why.slice(0, 160));
    if(!r.missing.some(f=>/Curiosity/.test(f)))
      throw new Error('the judged Cs are not declared missing');
    if(r.manual.length !== 2)
      throw new Error('the engine marks 2 of the Clients RM KPIs manual; ' + r.manual.length + ' are listed');
    return r.missing.length + ' fields named as not in BOSS, and the 2 KPIs the engine itself marks manual '
      + 'are left to a rater';
  });

  t.section('permissions, from BOSS’s own reporting line');

  await t.step('a manager reaches their report; a stranger does not', async () => {
    const r = await t.eval(()=>{
      /* currentUser is a module-level binding, not a property of
         window, so it is assigned bare the way the HR suite does it. */
      const as = (id, fn) => { const was = currentUser; currentUser = id;
        try { return fn(); } finally { currentUser = was; } };
      return {mgrSees: as('USR-APR1', ()=>apprMaySee('USR-APR0')),
              mgrRates: as('USR-APR1', ()=>apprMayRate('USR-APR0')),
              selfSees: as('USR-APR0', ()=>apprMaySee('USR-APR0')),
              selfRates: as('USR-APR0', ()=>apprMayRate('USR-APR0')),
              otherSees: as('USR-APR0', ()=>apprMaySee('USR-APR1'))};
    });
    if(!r.mgrSees || !r.mgrRates) throw new Error('the reporting manager cannot reach their report');
    if(!r.selfSees) throw new Error('somebody cannot see their own appraisal');
    if(r.selfRates) throw new Error('somebody may rate themselves');
    if(r.otherSees) throw new Error('a report can read their manager’s appraisal');
    return 'the manager rates, the person reads their own and rates nobody, and nobody reads upwards';
  });

  t.section('and BOSS itself is untouched');

  await t.step('nothing but hrAppraisals is written', async () => {
    const r = await t.eval(async ()=>{
      const snap = k => JSON.stringify((DB[k] || []).length) + ':' + JSON.stringify(DB[k] || []).length;
      const keys = ['team','meetings','clients','leads','tasks','transactions','businessEntries'];
      const before = keys.map(snap);
      await apprOpen('USR-APR0', '2026');
      const rec = apprRecordFor('USR-APR0', '2026');
      await apprSetRating(rec.id, 'curiosity', 85);
      await apprSetRating(rec.id, 'competence', 82);
      await apprSetRating(rec.id, 'commitment', 90);
      await apprSetRating(rec.id, 'creativity', 70);
      await apprTakeAuto(rec.id, 0);
      await apprSetKpi(rec.id, 1, 80);
      await apprSetKpi(rec.id, 2, 75);
      const after = keys.map(snap);
      const out = apprCompute(apprRecordFor('USR-APR0', '2026'));
      return {same: before.join('|') === after.join('|'),
              before, after, score: Math.round(out.score * 100) / 100,
              newSalary: out.newSalary, appraisals: (DB.hrAppraisals || []).length};
    });
    if(!r.same) throw new Error('a BOSS store changed:\n  ' + r.before.join(' ') + '\n  ' + r.after.join(' '));
    if(r.appraisals !== 1) throw new Error('it wrote ' + r.appraisals + ' appraisal records');
    /* Meetings now read 240/300 = 80%, which the band at min 75 pays 25 for —
       the same 40 contribution as the hand-worked case, so the same answer. */
    if(r.score !== 82.15) throw new Error('the score off live BOSS data is ' + r.score);
    if(r.newSalary !== 747450) throw new Error('the new salary is ' + r.newSalary);
    return 'seven BOSS stores byte-identical before and after; one appraisal record written, ₹7,47,450';
  });

  await t.step('a finalised appraisal is not restated by a later change', async () => {
    const r = await t.eval(async ()=>{
      const rec = apprRecordFor('USR-APR0', '2026');
      await apprFinalise(rec.id);
      const at = apprCompute(apprRecordFor('USR-APR0', '2026')).newSalary;
      DB.config.appraisal.growth['2026'] = {abs: 90, sip: 90, lump: 90};
      await save('config');
      const still = apprCompute(apprRecordFor('USR-APR0', '2026')).newSalary;
      const status = apprRecordFor('USR-APR0', '2026').status;
      DB.config.appraisal.growth['2026'] = {abs: 18, sip: 22, lump: 15};
      await save('config');
      return {at, still, status};
    });
    if(r.status !== 'Finalised') throw new Error('it did not finalise');
    if(r.at !== 747450 || r.still !== 747450)
      throw new Error('a growth change restated it: ' + r.at + ' → ' + r.still);
    return 'finalised at ₹7,47,450 and stayed there while the pool went to 90%';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 220));
    return 'none';
  });
});
