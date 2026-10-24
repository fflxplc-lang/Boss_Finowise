/* The payout team, from a sheet: the template's columns go back in, each
   person lands on the payout team with their level and manager, and is
   made a BOSS team member with a sign-in account whose password is
   mailed to them. A second import of the same sheet updates. */
const {suite} = require('../lib/harness');

suite({mail: true}, async t => {
  const p = t.page;
  const csv = (rows) => rows.map(r => r.join(',')).join('\n') + '\n';
  const head = ['Name', 'Email (BOSS login)', 'Mobile', 'Employee / ARN Code', 'Role', 'Primary Level', 'Additional Levels', 'Reports To', 'Sharing %', 'BOSS Role', 'Bank Name', 'IFSC', 'City'];
  const sheet = csv([head,
    ['Ravi RM', 'ravi.rm@example.com', '9876500002', 'EMP-014', 'Ops / RM', 'L2', '', 'mona.mentor@example.com', '30', 'Executive', 'HDFC Bank', 'hdfc0001234', 'Pune'],
    ['Mona Mentor', 'mona.mentor@example.com', '9876500001', 'ARN-111', 'Mentor', 'L4', 'L3', '', '40', 'Manager', '', '', 'Mumbai'],
    ['', 'nobody@example.com', '', '', 'Ops / RM', 'L1', '', '', '', '', '', '', ''],
    ['Bad Role', 'bad@example.com', '', '', 'Boss', 'L1', '', '', '', '', '', '', '']]);
  const pick = text => t.eval(async text => {
    await pyTeamImport(new File([text], 'team.csv', {type: 'text/csv'}));
    return {go: document.getElementById('pyTeamGo').textContent, rows: PY.s._teamPlan.map(x => ({n: x.r.name, skip: x.skip, upd: !!x.payout, acc: !!x.member, why: x.problems.join('; ')}))};
  }, text);

  await t.step('the template downloads with the import columns', async () => {
    await t.home();
    await p.waitForFunction(() => typeof PY !== 'undefined' && PY.me !== undefined, null, {timeout: 10000});
    const r = await t.eval(() => { let got; const was = window.downloadXlsx; window.downloadXlsx = (s, n) => { got = {n, h: s[0].rows[0]}; }; pyTeamTemplate(); window.downloadXlsx = was; return got; });
    if(!/Template/.test(r.n) || !['Name', 'Email (BOSS login)', 'Role', 'Primary Level', 'Reports To', 'BOSS Role'].every(h => r.h.includes(h))) throw new Error(JSON.stringify(r));
    return r.n;
  });

  await t.step('the sheet is previewed: two to import, two refused with a reason', async () => {
    const r = await pick(sheet);
    if(r.go !== 'Import 2 people' || !r.rows[2].skip || !/no name/.test(r.rows[2].why) || !/not Ops \/ RM/.test(r.rows[3].why) || r.rows[0].acc) throw new Error(JSON.stringify(r));
    return r.go;
  });

  await t.step('they land on the payout team and in BOSS, with sign-in accounts mailed', async () => {
    t.mail.clear();
    const r = await t.eval(async () => {
      window.alert = () => {};
      await pyTeamImportApply();
      const users = await pyGet('/users');
      const ravi = users.find(u => u.email === 'ravi.rm@example.com'), mona = users.find(u => u.email === 'mona.mentor@example.com');
      const tRavi = DB.team.find(x => x.email === 'ravi.rm@example.com'), tMona = DB.team.find(x => x.email === 'mona.mentor@example.com');
      await loadAccounts();
      return {ravi: ravi && {lvl: ravi.level, role: ravi.role, parent: ravi.parent_id === (mona || {}).id, share: ravi.sharing_pct, ifsc: (ravi.bank || {}).ifsc, city: (ravi.address || {}).city},
        mona: mona && {lvl: mona.level, role: mona.role, extra: mona.extra_levels},
        team: tRavi && tMona && {role: tRavi.role + '/' + tMona.role, mgr: userManagerIds(tRavi).includes(tMona.id), mobile: tRavi.mobile},
        acc: !!(accountFor(tRavi) && accountFor(tMona))};
    });
    if(!r.ravi || r.ravi.lvl !== 2 || r.ravi.role !== 'ops' || !r.ravi.parent || r.ravi.share !== 30 || r.ravi.ifsc !== 'HDFC0001234' || r.ravi.city !== 'Pune') throw new Error(JSON.stringify(r));
    if(!r.mona || r.mona.lvl !== 4 || r.mona.role !== 'mentor' || (r.mona.extra || []).join() !== '3') throw new Error(JSON.stringify(r));
    if(!r.team || r.team.role !== 'Executive/Manager' || !r.team.mgr || r.team.mobile !== '9876500002' || !r.acc) throw new Error(JSON.stringify(r));
    await t.wait(400);
    const to = t.mail.received.map(m => (m.to || []).join()).join(' ');
    if(!to.includes('ravi.rm@example.com') || !to.includes('mona.mentor@example.com')) throw new Error('passwords not mailed: ' + to);
    return 'Ravi L2 under Mona L4 (mentor); both BOSS members with accounts, passwords mailed';
  });

  await t.step('importing again updates the same people, no second account', async () => {
    t.mail.clear();
    const r = await pick(sheet.replace('Ravi RM,ravi.rm@example.com,9876500002,EMP-014,Ops / RM,L2', 'Ravi RM,ravi.rm@example.com,9876500002,EMP-014,Ops / RM,L3'));
    if(!r.rows[0].upd || !r.rows[0].acc || !r.rows[1].upd) throw new Error(JSON.stringify(r));
    const after = await t.eval(async () => { await pyTeamImportApply(); const u = await pyGet('/users');
      return {lvl: u.find(x => x.email === 'ravi.rm@example.com').level, n: u.filter(x => /example\.com$/.test(x.email)).length, team: DB.team.filter(x => x.email === 'ravi.rm@example.com').length}; });
    await t.wait(300);
    if(after.lvl !== 3 || after.n !== 2 || after.team !== 1 || t.mail.received.length) throw new Error(JSON.stringify(after) + ' mails ' + t.mail.received.length);
    return 'Ravi moved to L3; still one of each; no mail';
  });

  await t.step('picking the primary level fills Sharing % from the rule, and a custom rate stays', async () => {
    const r = await t.eval(async () => {
      await pyUserModal(-1);
      const val = () => document.getElementById('pyU_sharing_pct').value;
      const lvl = v => { const s = document.getElementById('pyU_level'); s.value = String(v); s.dispatchEvent(new Event('change')); return val(); };
      const out = {l1: val(), l3: lvl(3), l4: lvl(4), l5: lvl(5), l2: lvl(2), note: document.querySelector('#modal, .modal, body').textContent.includes('Rule for L2')};
      document.getElementById('pyU_sharing_pct').value = '40';
      out.custom = lvl(3);
      lvl(2); document.getElementById('pyU_sharing_pct').value = '50';
      document.getElementById('pyU_sharing_pct').dispatchEvent(new Event('input'));
      document.getElementById('pyU_name').value = 'Rule Follower'; document.getElementById('pyU_email').value = 'rule@example.com';
      // back to the rule's own figure before saving
      lvl(2);
      document.getElementById('pyU_sharing_pct').value = '50';
      await pyUserSave(false);
      const u = (await pyGet('/users')).find(x => x.email === 'rule@example.com');
      let got; const was = window.downloadXlsx; window.downloadXlsx = (sh) => { got = sh[0].rows; }; await pyUserExport(); window.downloadXlsx = was;
      const col = got[0].indexOf('Sharing %'), row = got.find(x => x[1] === 'rule@example.com');
      return Object.assign(out, {stored: u && u.sharing_pct, exported: row && row[col]});
    });
    if(r.l1 !== '25' || r.l3 !== '75' || r.l4 !== '85' || r.l5 !== '5' || r.l2 !== '50' || !r.note) throw new Error(JSON.stringify(r));
    if(r.custom !== '40' || r.stored !== 0 || Number(r.exported) !== 50) throw new Error(JSON.stringify(r));
    return 'L1 25 · L2 50 · L3 75 · L4 85 · L5 5; a typed 40 kept; the rule saved as "follow the rule", exported as 50';
  });
});
