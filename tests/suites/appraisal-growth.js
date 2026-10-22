/* THE FOUR THINGS THE FIRM CAME BACK AND SAID.

   1. The annual CTC comes off the user record. It already does, from
      Salary (Monthly) x 12, and the appraisal reads that and nothing
      else — so this checks it reads as LIVE rather than as a gap.

   2. Everybody is eligible from the day the account is made. A new
      account has no role mapping and no department mapping, and
      waiting for somebody to write one is how a first year goes
      unrecorded. There is a fallback KPI set, named in Setup, and an
      administrator can still put one person somewhere else.

   3. Company growth is read from the AUM files imported every month.
      A platform snapshot overwrites the holding it belongs to, so the
      book's own history lived nowhere; one line a month is now
      written as each file lands, and the growth figures come off it.
      Lumpsum comes off the Business tracker, whose entries carry
      their own date.

   4. Curiosity, Competence, Commitment and Creativity are entered by
      an administrator. A reporting manager works the KPIs, which are
      about what happened; the Cs are the firm's call. */
const {suite} = require('../lib/harness');

const SEED = async ()=>{
  ['ZZ Grow Person','ZZ Grow Manager'].forEach((nm, i)=>{
    const id = 'USR-GRW' + i;
    let u = DB.team.find(x=>x.id === id);
    if(!u){ u = {id, documents:[], notes:[], perms:{}, adminFlags:{}}; DB.team.push(u); }
    Object.assign(u, {name:nm, email:'grw' + i + '@example.com', role: defaultRole(),
      status:'Active', branch:'Varanasi', monthlySalary: 50000});
    delete u.appraisalRoleKey; delete u.incentiveCtc;
  });
  setUserManagers(DB.team.find(x=>x.id === 'USR-GRW0'), ['USR-GRW1']);
  DB.config.appraisal = {roleMap:{}, growth:{}};
  DB.aumMonthly = [];
  DB.hrAppraisals = [];
  DB.businessEntries = (DB.businessEntries || []).filter(e=>!/^BIZ-GRW/.test(e.id || ''));
  await save('team'); await save('config'); await save('aumMonthly');
  await save('hrAppraisals'); await save('businessEntries');
  return true;
};

suite(async t => {

  t.section('1 — the CTC comes off the user record');

  await t.step('and reads as live, not as a gap', async () => {
    await t.eval(SEED);
    const r = await t.eval(()=>{
      const m = apprMapping('USR-GRW0', '2026');
      const row = m.have.find(h=>/Annual CTC/.test(h.field));
      return {salary: apprSalaryOf('USR-GRW0'), row: row || null,
              missing: m.missing.some(x=>/Annual CTC/.test(x.field))};
    });
    if(r.salary !== 600000) throw new Error('50,000 a month should read 6,00,000, it reads ' + r.salary);
    if(!r.row || r.missing) throw new Error('the CTC is still listed as not in BOSS');
    if(!/team record/.test(r.row.from)) throw new Error('it says it comes from ' + r.row.from);
    return '₹6,00,000, live from the team record';
  });

  t.section('2 — eligible from day one');

  await t.step('an account nobody has mapped still has a KPI set', async () => {
    const r = await t.eval(()=>{
      const key = apprRoleKeyOf('USR-GRW0');
      const m = apprMapping('USR-GRW0', '2026');
      return {key, why: apprRoleWhy('USR-GRW0'), label: m.role ? m.role.label : '',
              kpis: (m.kpis || []).length, def: apprDefaultRoleKey()};
    });
    if(!r.key) throw new Error('a brand-new account has no KPI set at all');
    if(r.key !== r.def) throw new Error('it landed on ' + r.key + ' rather than the default ' + r.def);
    if(!r.kpis) throw new Error('and the Contribution half has no KPIs');
    if(!/default/.test(r.why)) throw new Error('the screen does not say why: ' + r.why);
    return 'on “' + r.label + '” with ' + r.kpis + ' KPIs, because it is the default';
  });

  await t.step('and an administrator can move one person off it', async () => {
    const r = await t.eval(async ()=>{
      await apprSetDefaultRole('operations');
      const byDefault = apprRoleKeyOf('USR-GRW0');
      DB.team.find(x=>x.id === 'USR-GRW0').appraisalRoleKey = 'partnersRM';
      const pinned = {key: apprRoleKeyOf('USR-GRW0'), why: apprRoleWhy('USR-GRW0')};
      delete DB.team.find(x=>x.id === 'USR-GRW0').appraisalRoleKey;
      /* and a role mapping still beats the default */
      DB.config.appraisal.roleMap = {['role:' + incKey(defaultRole())]: 'clientsRM'};
      const byRole = apprRoleKeyOf('USR-GRW0');
      DB.config.appraisal.roleMap = {};
      return {byDefault, pinned, byRole};
    });
    if(r.byDefault !== 'operations') throw new Error('the default did not take: ' + r.byDefault);
    if(r.pinned.key !== 'partnersRM' || !/this account/.test(r.pinned.why))
      throw new Error('the account did not win: ' + JSON.stringify(r.pinned));
    if(r.byRole !== 'clientsRM') throw new Error('a role mapping lost to the default');
    return 'default → account → role mapping, in that order of precedence';
  });

  t.section('3 — growth off the monthly AUM files');

  await t.step('an import writes one line a month, and re-importing replaces it', async () => {
    const r = await t.eval(async ()=>{
      DB.platformHoldings = [{id:'PFH-A', clientId:'C1', current: 10000000},
                             {id:'PFH-B', clientId:'C2', current: 5000000}];
      DB.platformSips = [{id:'PFS-A', clientId:'C1', monthlyAmount: 40000}];
      await aumLedgerRecord('2025-04-30', 'B1');
      const one = aumLedgerAll().length;
      /* the same month again: the file was re-imported */
      DB.platformHoldings[0].current = 11000000;
      await aumLedgerRecord('2025-04-30', 'B2');
      const still = aumLedgerAll();
      /* a file with no as-on date is filed under the month it arrived,
         and says so rather than being filed under a guess */
      await aumLedgerRecord('', 'B3');
      const undated = aumLedgerAll().find(x=>!x.dated);
      return {one, after: still.length, aum: still[0].aum, sip: still[0].sip,
              month: still[0].month, undatedMonth: undated ? undated.month : '',
              thisMonth: new Date().toISOString().slice(0, 7)};
    });
    if(r.one !== 1) throw new Error('the first import wrote ' + r.one + ' lines');
    if(r.after !== 1) throw new Error('re-importing the same month wrote ' + r.after + ' lines');
    if(r.aum !== 16000000) throw new Error('the replaced line holds ' + r.aum);
    if(r.sip !== 40000) throw new Error('the SIP book reads ' + r.sip);
    if(r.month !== '2025-04') throw new Error('it was filed under ' + r.month);
    if(r.undatedMonth !== r.thisMonth) throw new Error('an undated file was filed under ' + r.undatedMonth);
    return 'one line for 2025-04 holding ₹1,60,00,000, replaced not doubled; an undated file says so';
  });

  await t.step('a year apart gives the two growth figures, with their working', async () => {
    const r = await t.eval(async ()=>{
      DB.aumMonthly = [];
      DB.platformHoldings = [{id:'PFH-A', clientId:'C1', current: 10000000}];
      DB.platformSips = [{id:'PFS-A', clientId:'C1', monthlyAmount: 100000}];
      await aumLedgerRecord('2026-04-05', 'B1');          // the year opens
      DB.platformHoldings = [{id:'PFH-A', clientId:'C1', current: 11800000}];
      DB.platformSips = [{id:'PFS-A', clientId:'C1', monthlyAmount: 122000}];
      await aumLedgerRecord('2027-03-28', 'B2');          // and closes
      const g = apprGrowthAuto('2026', apprConfig());
      return {abs: g.abs, sip: g.sip, lump: g.lump};
    });
    if(!r.abs.ok) throw new Error('absolute growth: ' + r.abs.why);
    if(r.abs.value !== 18) throw new Error('1.0cr → 1.18cr is 18%, it says ' + r.abs.value);
    if(!r.sip.ok || r.sip.value !== 22) throw new Error('the SIP figure is ' + JSON.stringify(r.sip));
    if(!/2026-04/.test(r.abs.working) || !/2027-03/.test(r.abs.working))
      throw new Error('it does not show which two months: ' + r.abs.working);
    if(r.lump.ok) throw new Error('lumpsum came from nowhere: ' + JSON.stringify(r.lump));
    return 'absolute 18%, SIP 22%, each naming the two months it came from';
  });

  await t.step('lumpsum comes off the Business tracker, year against year', async () => {
    const r = await t.eval(async ()=>{
      /* Finished business, asked for by name. "The last status on the
         list" meant that until Declined was added after Completed. */
      const done = businessDoneStatus();
      DB.businessEntries = (DB.businessEntries || []).concat([
        {id:'BIZ-GRW1', amount: 1000000, transactionType:'Purchase', status: done,
         executionDate:'2025-08-10', createdAt:'2025-08-10T00:00:00.000Z'},
        {id:'BIZ-GRW2', amount: 1150000, transactionType:'Purchase', status: done,
         executionDate:'2026-08-10', createdAt:'2026-08-10T00:00:00.000Z'}]);
      await save('businessEntries');
      const g = apprGrowthAuto('2026', apprConfig());
      return {lump: g.lump};
    });
    if(!r.lump.ok) throw new Error('lumpsum: ' + r.lump.why);
    if(r.lump.value !== 15) throw new Error('10L → 11.5L is 15%, it says ' + r.lump.value);
    return 'new lumpsum 15%, from dated business entries — no ledger needed for that one';
  });

  await t.step('“Use these” writes them, and the appraisal picks them up', async () => {
    const r = await t.eval(async ()=>{
      await apprTakeGrowth('2026');
      const g = apprGrowthFor('2026');
      const pool = window.AppraisalEngine.companyGrowthPool(
        {abs: Number(g.abs), sip: Number(g.sip), lump: Number(g.lump)},
        apprConfig().poolWeights);
      const m = apprMapping('USR-GRW0', '2026');
      return {g, pool, live: m.have.filter(h=>/Company growth/.test(h.field)).length};
    });
    if(Number(r.g.abs) !== 18 || Number(r.g.sip) !== 22 || Number(r.g.lump) !== 15)
      throw new Error('the figures written are ' + JSON.stringify(r.g));
    if(r.pool !== 18.25) throw new Error('the pool comes to ' + r.pool + ', by hand 18.25');
    if(r.live !== 3) throw new Error('only ' + r.live + ' of the three read as live on the mapping');
    return 'all three taken, a pool of 18.25%, and all three listed as live rather than as gaps';
  });

  await t.step('an empty ledger says so rather than returning zero', async () => {
    const r = await t.eval(()=>{
      const was = DB.aumMonthly;
      DB.aumMonthly = [];
      const g = apprGrowthAuto('2026', apprConfig());
      DB.aumMonthly = was;
      return {ok: g.abs.ok, why: g.abs.why};
    });
    if(r.ok) throw new Error('an empty ledger produced a growth figure');
    if(!/begins with the next import/.test(r.why)) throw new Error('it says: ' + r.why);
    return 'it says the ledger begins with the next import, rather than reporting 0% growth';
  });

  t.section('4 — the four Cs are an administrator’s');

  await t.step('a reporting manager works the KPIs and not the Cs', async () => {
    const r = await t.eval(async ()=>{
      await apprOpen('USR-GRW0', '2026');
      const rec = apprRecordFor('USR-GRW0', '2026');
      const as = (id, fn) => { const was = currentUser; currentUser = id;
        try { return fn(); } finally { currentUser = was; } };
      const mgrMayJudge = as('USR-GRW1', ()=>apprMayJudge());
      const mgrMayRate = as('USR-GRW1', ()=>apprMayRate('USR-GRW0'));
      const adminMayJudge = apprMayJudge();
      /* the manager tries anyway */
      let blocked = null;
      await (async()=>{ const was = currentUser; currentUser = 'USR-GRW1';
        try { await apprSetRating(rec.id, 'curiosity', 90); }
        finally { currentUser = was; } })();
      blocked = (apprRecordFor('USR-GRW0', '2026').rating || {}).curiosity;
      /* but the KPI is theirs */
      await (async()=>{ const was = currentUser; currentUser = 'USR-GRW1';
        try { await apprSetKpi(rec.id, 0, 80); } finally { currentUser = was; } })();
      const kpi = ((apprRecordFor('USR-GRW0', '2026').rating || {}).kpi || [])[0];
      /* and an administrator may */
      await apprSetRating(rec.id, 'curiosity', 85);
      const byAdmin = (apprRecordFor('USR-GRW0', '2026').rating || {}).curiosity;
      const html = apprRatingCardHtml(apprRecordFor('USR-GRW0', '2026'),
        apprMapping('USR-GRW0', '2026'), true);
      return {mgrMayJudge, mgrMayRate, adminMayJudge, blocked, kpi, byAdmin,
              saysAdmin: /Entered by an administrator/.test(html)};
    });
    if(r.mgrMayJudge) throw new Error('a reporting manager may enter the Cs');
    if(!r.mgrMayRate) throw new Error('and they may not rate at all, which is too far');
    if(!r.adminMayJudge) throw new Error('an administrator may not enter them either');
    if(r.blocked !== undefined && r.blocked !== '')
      throw new Error('the manager’s C landed anyway: ' + r.blocked);
    if(r.kpi !== 80) throw new Error('the manager could not set a KPI: ' + r.kpi);
    if(r.byAdmin !== 85) throw new Error('the administrator’s C did not land: ' + r.byAdmin);
    if(!r.saysAdmin) throw new Error('and the screen does not say whose call it is');
    return 'the manager set the KPI and was refused the C; the administrator set the C; the screen says so';
  });

  await t.step('nothing was alerted but the refusal explaining itself', async () => {
    const stray = t.dialogs.filter(d=>!/entered by an administrator/i.test(String(d)));
    if(stray.length) throw new Error('alerts: ' + stray.join(' | ').slice(0, 220));
    return 'only the refusal, which names who may';
  });
});
