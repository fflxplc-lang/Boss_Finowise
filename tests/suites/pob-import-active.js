/* Partners who were active before BOSS, from the payout team's sheet:
   Full Name, Access Email, Employee/ARN Code, Level, Reports To … Mapped
   Clients. Each row lands as an Active Partner with no letters and no
   tasks, and also gets a BOSS login at its level (emailed its password),
   a place on the payout team under whoever it reports to, and the clients
   named in Mapped Clients. Importing again updates rather than doubles;
   L3 and up see on Payouts everyone mapped below them, L1 and L2 their
   own; and the whole import can be deleted again in one go. */
const {suite} = require('../lib/harness');
const {execFileSync} = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

suite({mail: true}, async t => {
  const head = 'Full Name,Access Email,Employee/ARN Code,Level,Reports To,Role,Sharing %,Additional Levels,GSTIN,PAN,Account Holder,Bank Name,Branch,Account Number,IFSC,Street,City,State,Pincode,Mapped Clients\n';
  const sheet = head
    + 'Nikhil Jain,nikhil.imp@example.com,EMP-021,L1,kavya.imp@example.com,Partner,25,,,,,,,,,,Pune,Maharashtra,,\n'
    + 'Kavya Rao,Kavya.Imp@example.com,ARN-270604,Sherpa,ravi.imp@example.com,Partner,75,L2,27abcde1234f1z5,abcde1234f,Kavya Rao,HDFC Bank,Andheri,50100012345678,hdfc0001234,12 MG Road,Mumbai,Maharashtra,400001,Asha Imp; BQHPM1234K\n'
    + 'Zed Wrong,not-an-email,EMP-9,L7,,,,,,,,,,,,,,,,\n';
  const pick = text => t.eval(async text => {
    const input = document.getElementById('pobImpFile');
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'partners.csv', {type: 'text/csv'}));
    input.files = dt.files;
    await pobImportRead(input);
    return {rows: (window._pobImport||[]).map(p => ({name: p.x.name, level: p.level, up: p.staff ? p.staff.name : p.upRow ? p.upRow.name : '', clients: p.clients.length,
      skip: p.skip, update: !!p.pob, why: p.problems.concat(p.warn).join('; ')})), button: document.getElementById('pobImpGo').textContent};
  }, text);
  let ids = {};

  await t.step('the sheet is read and previewed: level, who they report to, their clients', async () => {
    ids = await t.eval(async () => {
      window.alert = () => {};
      DB.team.push({id: 'TM-IMP-RAVI', name: 'Ravi Importer', email: 'ravi.imp@example.com', role: 'Relationship Manager', status: 'Active',
        scope: 'all', perms: fullPerms(true), adminFlags: {}, createdAt: new Date().toISOString()});
      await save('team');
      DB.clients.push({id: 'CL-IMP-ASHA', cmsName: 'Asha Imp', firstName: 'Asha', lastName: 'Imp', createdAt: new Date().toISOString()});
      await save('clients');
      const c = await pyPost('/clients', {name: 'Pan Client Imp', pan: 'BQHPM1234K'});
      // A partner who came the long way round, to show the delete leaves it alone.
      const p = {id: uid('PMS'), firstName: 'Long', lastName: 'Way', mobile: '9876512399', email: 'long.way@example.com', assignedTo: currentUser, createdAt: new Date().toISOString()};
      initState('PMS', p); p.pmsStage = 'onboarded'; pjPartners().push(p); await save('pjPartners');
      const o = await pobStart(p.id, {quiet: true});
      pobOpenImportActive();
      return {payoutClient: c.id, longWay: o.id};
    });
    const r = await pick(sheet);
    const by = n => r.rows.find(x => x.name === n) || {};
    if(by('Kavya Rao').level !== 'L3' || by('Kavya Rao').up !== 'Ravi Importer' || by('Kavya Rao').clients !== 2) throw new Error(JSON.stringify(r.rows));
    if(by('Nikhil Jain').level !== 'L1' || by('Nikhil Jain').up !== 'Kavya Rao' || by('Nikhil Jain').skip) throw new Error(JSON.stringify(r.rows));
    if(!by('Zed Wrong').skip || !/email/.test(by('Zed Wrong').why) || !/L1–L6/.test(by('Zed Wrong').why)) throw new Error(JSON.stringify(by('Zed Wrong')));
    if(r.button !== 'Import 2 Partners') throw new Error(r.button);
    return 'Kavya L3 under Ravi with 2 clients; Nikhil L1 under Kavya; the bad row skipped (email, L7)';
  });

  await t.step('they land as active partners with BOSS logins at their level, and passwords emailed', async () => {
    t.mail.clear();
    const r = await t.eval(async () => {
      await pobImportApply();
      const recs = pobLive().filter(x => x.imported);
      const by = n => recs.find(x => pjName(x) === n);
      const kavya = by('Kavya Rao'), nikhil = by('Nikhil Jain');
      const km = pobMemberOf(kavya), nm = pobMemberOf(nikhil);
      const pms = pjPartners().find(p => p.id === kavya.partnerId);
      return {n: recs.length, stage: recs.map(x => stateOf('POB', x)).join(), pms: stateOf('PMS', pms), arn: kavya.arn, pan: kavya.pan,
        kLevel: km && km.partnerLevel, kScope: km && km.scope, kUp: km && km.parentUserId, kRm: kavya.assignedTo,
        nLevel: nm && nm.partnerLevel, nUp: nm && nm.parentUserId === km.id, nRm: nikhil.assignedTo, email: km && km.email,
        gst: kavya.payout.gst, ifsc: kavya.payout.bank.ifsc, sharing: kavya.payout.sharing, extra: kavya.payout.extraLevels.join(),
        journey: pobClientJourneyOpen(nikhil), tasks: nikhil.tasks.length, asha: (DB.clients.find(c => c.id === 'CL-IMP-ASHA')||{}).partnerPobId === kavya.id,
        kPayout: kavya.payoutUserId, nPayout: nikhil.payoutUserId, admin: !!window.CRM_IS_ADMIN};
    });
    if(r.n !== 2 || r.stage !== 'active,active' || r.pms !== 'onboarded' || r.arn !== 'ARN-270604' || r.pan !== 'ABCDE1234F') throw new Error(JSON.stringify(r));
    if(r.kLevel !== 'L3' || r.kScope !== 'team' || r.kUp !== 'TM-IMP-RAVI' || r.kRm !== 'TM-IMP-RAVI' || r.email !== 'kavya.imp@example.com') throw new Error(JSON.stringify(r));
    if(r.nLevel !== 'L1' || !r.nUp || r.nRm !== 'TM-IMP-RAVI' || !r.journey || r.tasks) throw new Error(JSON.stringify(r));
    if(r.gst !== '27ABCDE1234F1Z5' || r.ifsc !== 'HDFC0001234' || r.sharing !== 75 || r.extra !== '2' || !r.asha) throw new Error(JSON.stringify(r));
    Object.assign(ids, {kPayout: r.kPayout, nPayout: r.nPayout});
    await t.wait(300);
    if(r.admin){
      const to = t.mail.received.map(m => (m.to||[]).join()).join();
      if(!/kavya\.imp@example\.com/.test(to) || !/nikhil\.imp@example\.com/.test(to)) throw new Error('password letters: ' + to);
    }
    return 'Kavya L3 (Sherpa) under Ravi, Nikhil L1 under Kavya; both active, Client Journey open, no tasks' + (r.admin ? '; passwords emailed' : '');
  });

  await t.step('the payout team follows: same levels, same reporting line, the clients mapped', async () => {
    const r = await t.eval(async ids => {
      const team = await pyGet('/users');
      const k = team.find(u => u.email === 'kavya.imp@example.com'), n = team.find(u => u.email === 'nikhil.imp@example.com');
      const c = (await pyGet('/clients?all=1')).rows.find(x => x.id === ids.payoutClient);
      PY.s.clientsTab = 'hierarchy'; navigate('pyclients');
      await new Promise(r => setTimeout(r, 800)); render();
      return {k: k && {level: k.level, role: k.role, code: k.code, sharing: k.sharing_pct, gst: k.gst, bank: (k.bank||{}).account, city: (k.address||{}).city, extra: (k.extra_levels||[]).join()},
        n: n && {level: n.level, parent: n.parent_id === (k||{}).id},
        map: c && c.hierarchy, button: /Sync from Partner Journey/.test(document.body.textContent), badge: /Kavya Rao\s*Partner Journey/.test(document.body.textContent)};
    }, ids);
    if(!r.k || r.k.level !== 3 || r.k.role !== 'partner' || r.k.code !== 'ARN-270604' || r.k.gst !== '27ABCDE1234F1Z5' || r.k.bank !== '50100012345678' || r.k.city !== 'Mumbai' || r.k.extra !== '2') throw new Error(JSON.stringify(r));
    if(!r.n || r.n.level !== 1 || !r.n.parent) throw new Error(JSON.stringify(r));
    if(!r.map || Number(r.map['3']) !== ids.kPayout) throw new Error('client not mapped: ' + JSON.stringify(r.map));
    if(!r.button || !r.badge) throw new Error('hierarchy screen: ' + JSON.stringify(r));
    return 'Kavya L3 and Nikhil L1 under her on the payout team, with code, GSTIN, bank and address; the PAN client mapped to Kavya';
  });

  await t.step('Payouts shows each one by the rule: L3 everyone below them, L1 their own', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyscope-'));
    const script = `
      process.env.CRM_PAYOUT_DB = ${JSON.stringify(path.join(dir, 'p.db'))};
      const { db } = await import(${JSON.stringify('file://' + path.resolve(__dirname, '../../payout/db.js'))});
      const { scopeIds } = await import(${JSON.stringify('file://' + path.resolve(__dirname, '../../payout/auth.js'))});
      const add = (name, level, parent) => Number(db.prepare("INSERT INTO users(name, email, level, parent_id, role) VALUES(?, ?, ?, ?, 'partner')").run(name, name + '@x.com', level, parent).lastInsertRowid);
      const l4 = add('l4', 4, null), l3 = add('l3', 3, l4), l2 = add('l2', 2, l3), l1 = add('l1', 1, l2), other = add('other', 1, null);
      const see = (id, level) => scopeIds({ user: { id, level, role: 'partner' } }).length;
      console.log(JSON.stringify({ l4: see(l4, 4), l3: see(l3, 3), l2: see(l2, 2), l1: see(l1, 1) }));`;
    const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim().split('\n').pop());
    fs.rmSync(dir, {recursive: true, force: true});
    if(out.l4 !== 4 || out.l3 !== 3 || out.l2 !== 1 || out.l1 !== 1) throw new Error(JSON.stringify(out));
    return 'L4 sees 4 (all below), L3 sees 3, L2 and L1 only themselves';
  });

  await t.step('the list shows levels, not FBM / FBP', async () => {
    const r = await t.eval(() => {
      window._pobTab = 'partners'; window._pobRole = 'L3'; navigate('pob');
      const chips = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
      const rows = Array.from(document.querySelectorAll('#pobTable tbody tr')).map(tr => tr.textContent);
      window._pobRole = ''; render();
      return {chips: chips.filter(c => /^L\d · |All levels|No login yet|^FBM$|^FBP$/.test(c)), rows};
    });
    if(r.chips.includes('FBM') || r.chips.includes('FBP') || !r.chips.includes('L3 · Sherpa') || !r.chips.includes('No login yet')) throw new Error(JSON.stringify(r.chips));
    if(r.rows.length !== 1 || !/Kavya Rao/.test(r.rows[0]) || !/L3 · Sherpa/.test(r.rows[0])) throw new Error(JSON.stringify(r.rows));
    return r.chips.join(' · ');
  });

  await t.step('importing the same sheet again updates, it does not double', async () => {
    await t.eval(() => pobOpenImportActive());
    const r = await pick(sheet.replace('Mumbai', 'Thane'));
    if(!r.rows.filter(x => !x.skip).every(x => x.update)) throw new Error(JSON.stringify(r.rows));
    const after = await t.eval(async () => {
      await pobImportApply();
      const team = await pyGet('/users');
      return {n: pobLive().filter(x => x.imported).length, partners: pjPartners().filter(p => p.source === 'Import' && !p.deletedAt).length,
        logins: DB.team.filter(t => /\.imp@example\.com$/.test(t.email||'') && t.partnerPobId).length,
        payout: team.filter(u => /\.imp@example\.com$/.test(u.email)).length,
        city: ((team.find(u => u.email === 'kavya.imp@example.com')||{}).address||{}).city};
    });
    if(after.n !== 2 || after.partners !== 2 || after.logins !== 2 || after.payout !== 2 || after.city !== 'Thane') throw new Error(JSON.stringify(after));
    return 'still 2 partners, 2 logins, 2 on the payout team; the new city written';
  });

  await t.step('Delete Imported Data removes the import, its logins and its payout team, and nothing else', async () => {
    const r = await t.eval(async ids => {
      window._pobTab = 'partners'; navigate('pob');
      const button = Array.from(document.querySelectorAll('button')).some(b => /Delete Imported Data/.test(b.textContent));
      const memberIds = pobLive().filter(x => x.imported).map(x => pobMemberOf(x).id);
      pobOpenDeleteImported();
      document.getElementById('pobDelConfirm').value = 'delete please';
      await pobDeleteImported();
      const refused = pobLive().filter(x => x.imported).length;
      document.getElementById('pobDelConfirm').value = 'DELETE';
      await pobDeleteImported();
      const team = await pyGet('/users');
      return {button, refused, left: pobLive().filter(x => x.imported).length, bin: pobRecords().filter(x => x.imported && x.deletedAt).length,
        logins: DB.team.filter(t => memberIds.includes(t.id)).length, payout: team.filter(u => /\.imp@example\.com$/.test(u.email)).length,
        longWay: !!pobLive().find(x => x.id === ids.longWay), ravi: !!DB.team.find(t => t.id === 'TM-IMP-RAVI'),
        pms: pjPartners().filter(p => p.source === 'Import' && !p.deletedAt).length, again: Array.from(document.querySelectorAll('button')).some(b => /Delete Imported Data/.test(b.textContent))};
    }, ids);
    if(!r.button || r.refused !== 2) throw new Error('confirmation: ' + JSON.stringify(r));
    if(r.left || r.bin !== 2 || r.logins || r.payout || r.pms) throw new Error(JSON.stringify(r));
    if(!r.longWay || !r.ravi || r.again) throw new Error(JSON.stringify(r));
    return 'refused until DELETE was typed; then 2 partners to the recycle bin, their logins and payout entries gone; the PMS partner and Ravi kept';
  });
});
