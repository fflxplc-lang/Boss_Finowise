/* ONE FIGURE, ENTERED WHERE SOMEBODY DECIDES IT.

   The Incentive grid and the Appraisal engine both need to know what
   a person earns, and both wanted it annually. Nobody decides a salary
   annually — a firm decides a monthly figure and anybody can check it
   against a payslip — so that is what the user record asks for, and
   everything annual is twelve times it, worked out where it is needed.

   Three things have to hold. The annual figure is never stored, so it
   cannot drift from the monthly one. Somebody who may not set pay is
   not shown the box AND cannot clear it by saving the rest of the
   form, which is the quiet way a salary goes to zero. And both modules
   read the same figure, so a raise moves the incentive sheet and the
   appraisal together. */
const {suite} = require('../lib/harness');

suite(async t => {

  t.section('monthly in, annual out');

  await t.step('the annual is twelve times it, and is not stored', async () => {
    const r = await t.eval(async ()=>{
      let u = DB.team.find(x=>x.id === 'USR-SAL');
      if(!u){ u = {id:'USR-SAL', documents:[], notes:[], perms:{}, adminFlags:{}}; DB.team.push(u); }
      Object.assign(u, {name:'ZZ Salaried', email:'sal@example.com', role: defaultRole(),
        status:'Active', branch:'Varanasi'});
      delete u.monthlySalary; delete u.incentiveCtc;
      await save('team');
      const empty = {m: memberMonthlySalary(u), a: memberAnnualCtc(u)};
      await setMemberMonthlySalary('USR-SAL', 30000);
      const set = {m: memberMonthlySalary(u), a: memberAnnualCtc(u),
                   storedKeys: Object.keys(u).filter(k=>/salary|ctc/i.test(k))};
      return {empty, set};
    });
    if(r.empty.m || r.empty.a) throw new Error('an account with no salary reported one');
    if(r.set.m !== 30000 || r.set.a !== 360000)
      throw new Error('30,000 a month should be 3,60,000 a year, it says ' + JSON.stringify(r.set));
    if(r.set.storedKeys.join(',') !== 'monthlySalary')
      throw new Error('it stored ' + r.set.storedKeys.join(', ') + '; only the monthly figure belongs on the record');
    return '₹30,000 a month → ₹3,60,000 a year, with only the monthly figure written down';
  });

  await t.step('a raise moves the annual with it, everywhere', async () => {
    const r = await t.eval(async ()=>{
      await setMemberMonthlySalary('USR-SAL', 45000);
      const sheet = incBlankSheet('USR-SAL', '2026-08');
      return {annual: memberAnnualCtc('USR-SAL'), appraisal: apprSalaryOf('USR-SAL'),
              incentiveSheet: sheet.annualCtc};
    });
    if(r.annual !== 540000) throw new Error('the annual reads ' + r.annual);
    if(r.appraisal !== 540000) throw new Error('the appraisal engine is handed ' + r.appraisal);
    if(r.incentiveSheet !== 540000) throw new Error('a new incentive sheet opens on ' + r.incentiveSheet);
    return 'one raise, and the appraisal and a fresh incentive sheet both read ₹5,40,000';
  });

  await t.step('an annual figure stored before the monthly one is still honoured', async () => {
    const r = await t.eval(async ()=>{
      const u = DB.team.find(x=>x.id === 'USR-SAL');
      delete u.monthlySalary; u.incentiveCtc = 600000;
      await save('team');
      const read = {m: memberMonthlySalary(u), a: memberAnnualCtc(u)};
      /* And setting the monthly figure clears the old one rather than
         leaving a pair of them to disagree. */
      await setMemberMonthlySalary('USR-SAL', 45000);
      return {read, after: {m: memberMonthlySalary(u), a: memberAnnualCtc(u),
              old: u.incentiveCtc === undefined}};
    });
    if(r.read.m !== 50000 || r.read.a !== 600000)
      throw new Error('an account carrying only the old annual field reads ' + JSON.stringify(r.read));
    if(!r.after.old) throw new Error('the old annual field was left behind to disagree');
    if(r.after.a !== 540000) throw new Error('and the new figure did not take: ' + r.after.a);
    return '₹6,00,000 a year reads as ₹50,000 a month; setting a monthly figure clears it';
  });

  t.section('on the form');

  await t.step('the box is offered, with the year beside it, to whoever may set pay', async () => {
    const r = await t.eval(()=>{
      const fields = teamMemberFieldsFlat('USR-SAL');
      const m = fields.find(f=>f.k === 'monthlySalary');
      const a = fields.find(f=>f.k === 'annualCtcCalc');
      const html = a ? fieldInput(a, "") : "";
      return {may: maySetSalary(), hasM: !!m, hasA: !!a,
              label: m ? m.l : '', live: m ? m.live : '',
              derivedHasNoFormId: html.indexOf('id="f_annualCtcCalc"') < 0,
              shows: /5,40,000/.test(a ? a.text : '')};
    });
    if(!r.may) throw new Error('the admin running this may not set pay');
    if(!r.hasM || r.label !== 'Salary (Monthly)') throw new Error('the monthly box is not on the form');
    if(!r.hasA) throw new Error('the calculated annual is not beside it');
    if(!/memberAnnualEcho/.test(r.live)) throw new Error('the year does not follow as it is typed');
    if(!r.derivedHasNoFormId)
      throw new Error('the calculated box carries a form id, so a save would write a derived value');
    if(!r.shows) throw new Error('it does not show the year: ' + JSON.stringify(r));
    return 'Salary (Monthly) with “Annual CTC (calculated)” beside it, echoed as you type and never saved';
  });

  await t.step('somebody who may not set pay is not shown it, and cannot clear it', async () => {
    const r = await t.eval(async ()=>{
      const was = currentUser;
      const plain = DB.team.find(x=>x.id === 'USR-SAL');
      currentUser = 'USR-SAL';                       // no Manage Users, no HR admin
      const fields = teamMemberFieldsFlat('USR-SAL').map(f=>f.k);
      currentUser = was;
      return {may: fields.indexOf('monthlySalary') >= 0,
              calc: fields.indexOf('annualCtcCalc') >= 0,
              /* saveMember() writes only the fields the form offered, so a
                 field it never showed cannot be blanked by it. */
              stillPaid: memberAnnualCtc(plain)};
    });
    if(r.may || r.calc) throw new Error('somebody without the right to set pay was shown the box');
    if(r.stillPaid !== 540000) throw new Error('and the salary did not survive: ' + r.stillPaid);
    return 'not on their form at all, so their save cannot blank it';
  });

  await t.step('a calculated box is not something a spreadsheet can import', async () => {
    const r = await t.eval(()=>{
      const defs = teamBulkFieldDefs().map(f=>f.k);
      return {monthly: defs.indexOf('monthlySalary') >= 0, calc: defs.indexOf('annualCtcCalc') >= 0};
    });
    if(r.calc) throw new Error('the calculated annual is offered as an import column');
    if(!r.monthly) throw new Error('and the monthly salary is not');
    return 'Salary (Monthly) imports; the calculated annual does not';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
