/* Partners who were active before BOSS: the old system's FBM and FBP
   exports go in as they are, and land as Active Partners with no
   letters and no tasks; the FBP finds its FBM, the FBM Owner becomes the
   RM, and importing again updates rather than doubles. */
const {suite} = require('../lib/harness');

suite({mail: true}, async t => {
  const fbm = 'Record Id,FBM Name,Mobile No,Email,ARN No,EUIN No,FBM Owner.id,FBM Owner,Modified Time\n'
    + 'zcrm_111,Anil Kumar Sharma,9876501111,anil@example.com,ARN-123456,E123456,zu_9,Ravi Importer,2025-08-01 10:00\n'
    + 'zcrm_112,Bina Rao,98765-02222,bina@example.com,,E654321,zu_8,Somebody Unknown,2025-08-02 10:00\n';
  const fbp = 'Record Id,FBP Name,Renewal Date,FBM.id,FBM,Mobile No,Email,ARN No,EUIN No,Pan Card No,Modified Time\n'
    + 'zcrm_201,Chetan Patel,15-03-2027,zcrm_111,Anil Kumar Sharma,9876503333,chetan@example.com,,,abcde1234f,2025-09-01 10:00\n'
    + 'zcrm_202,,,zcrm_111,Anil Kumar Sharma,9876504444,,,,,\n';
  const pick = (files) => t.eval(async files => {
    const input = document.getElementById('pobImpFile');
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(new File([f.text], f.name, {type: 'text/csv'})));
    input.files = dt.files;
    await pobImportRead(input);
    return {rows: (window._pobImport||[]).map(p => ({type: p.x.type, name: p.x.name, rm: p.rm, skip: p.skip, update: !!p.pob, warn: p.warn.join('; ')})),
      button: document.getElementById('pobImpGo').textContent};
  }, files);

  await t.step('the two sheets are read and previewed, FBM first', async () => {
    await t.eval(async () => {
      DB.team.push({id: 'TM-IMP-RAVI', name: 'Ravi Importer', email: 'ravi.imp@example.com', role: 'Relationship Manager', status: 'Active',
        scope: 'all', perms: fullPerms(true), adminFlags: {}, createdAt: new Date().toISOString()});
      await save('team');
      pobOpenImportActive();
    });
    const r = await pick([{name: 'FBP.csv', text: fbp}, {name: 'FBM.csv', text: fbm}]);
    const names = r.rows.map(x => x.type + ':' + (x.name || '-')).join();
    if(names !== 'FBM:Anil Kumar Sharma,FBM:Bina Rao,FBP:Chetan Patel,FBP:-') throw new Error(names);
    if(r.rows[0].rm !== 'TM-IMP-RAVI' || r.rows[2].rm !== 'TM-IMP-RAVI' || !/Somebody Unknown/.test(r.rows[1].warn) || !r.rows[3].skip)
      throw new Error(JSON.stringify(r.rows));
    if(r.button !== 'Import 3 Partners') throw new Error(r.button);
    return r.button + '; the unnamed row skipped; an unknown owner flagged';
  });

  await t.step('they land as active partners, with no letters', async () => {
    t.mail.clear();
    const r = await t.eval(async () => {
      await pobImportApply();
      const recs = pobRecords().filter(x => x.imported);
      const by = n => recs.find(x => pjName(x) === n);
      const anil = by('Anil Kumar Sharma'), chetan = by('Chetan Patel'), bina = by('Bina Rao');
      const pms = pjPartners().find(p => p.id === anil.partnerId);
      return {n: recs.length, stage: recs.map(x => stateOf('POB', x)).join(), pms: stateOf('PMS', pms), arn: pms.arn, rm: anil.assignedTo,
        chetanRm: chetan.assignedTo, fbm: chetan.fbmPobId === anil.id, renewal: chetan.renewalDate, pan: chetan.pan, binaMobile: bina.mobile,
        type: anil.partnerType + '/' + chetan.partnerType, journey: pobClientJourneyOpen(chetan), tasks: chetan.tasks.length,
        list: (render(), navigate('pob'), document.getElementById('pobTable').textContent.includes('FBP'))};
    });
    if(r.n !== 3 || r.stage !== 'active,active,active' || r.pms !== 'onboarded' || r.arn !== 'ARN-123456') throw new Error(JSON.stringify(r));
    if(r.rm !== 'TM-IMP-RAVI' || r.chetanRm !== 'TM-IMP-RAVI' || !r.fbm || r.renewal !== '2027-03-15' || r.pan !== 'ABCDE1234F' || r.binaMobile !== '9876502222') throw new Error(JSON.stringify(r));
    if(r.type !== 'FBM/FBP' || !r.journey || r.tasks || !r.list) throw new Error(JSON.stringify(r));
    await t.wait(300);
    if(t.mail.received.length) throw new Error('letters went: ' + t.mail.received.map(m => m.subject).join());
    return 'Active Partner, Onboarded in PMS; Chetan under Anil, with Ravi as RM; Client Journey open; no mail';
  });

  await t.step('importing the same sheet again updates, it does not double', async () => {
    await t.eval(() => pobOpenImportActive());
    const changed = fbm.replace('anil@example.com', 'anil.new@example.com');
    const r = await pick([{name: 'FBM.csv', text: changed}]);
    if(!r.rows.every(x => x.update)) throw new Error(JSON.stringify(r.rows));
    const after = await t.eval(async () => {
      await pobImportApply();
      const recs = pobRecords().filter(x => x.imported);
      return {n: recs.length, partners: pjPartners().filter(p => p.source === 'Import').length,
        email: recs.find(x => pjName(x) === 'Anil Kumar Sharma').email};
    });
    if(after.n !== 3 || after.partners !== 3 || after.email !== 'anil.new@example.com') throw new Error(JSON.stringify(after));
    return 'still 3; the new email written';
  });
});
