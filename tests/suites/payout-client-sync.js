/* PAYOUT CLIENTS ARE BOSS CLIENTS. A client that arrives through Payouts
   becomes one CMS record, never a second copy of a client BOSS already had;
   its RM and team come from the payout mapping, and they see it by the
   ordinary rules while somebody off the mapping does not; and the name,
   PAN, email and mobile stay equal in both systems, whichever side was
   changed. */
const {suite} = require('../lib/harness');

suite(async t => {
  let ids = {};
  const as = (who, fn, arg) => t.eval(async ([who, src, arg]) => {
    const was = currentUser; currentUser = who;
    try { return await (eval('(' + src + ')'))(arg); } finally { currentUser = was; }
  }, [who, fn.toString(), arg]);
  const sees = who => as(who, () => mdClients().map(c=>c.cmsName).filter(n=>/^ZZ Sync/i.test(n)).sort().join('|'));

  await t.step('a manager, an RM under them, and an RM elsewhere, on BOSS and on the payout team', async () => {
    await t.home();
    await t.page.waitForFunction(() => typeof PY !== 'undefined' && PY.me !== undefined, null, {timeout: 10000});
    ids = await t.eval(async () => {
      window.alert = () => {};
      const now = new Date().toISOString();
      const mk = (id, name, email, scope, up) => ({id, name, email, role: 'Relationship Manager', status: 'Active', scope,
        parentUserId: up || '', perms: fullPerms(true), adminFlags: {}, createdAt: now});
      DB.team.push(mk('TM-SYA', 'Asha Manager', 'asha.sync@example.com', 'team'),
        mk('TM-SYB', 'Bala RM', 'bala.sync@example.com', 'own', 'TM-SYA'),
        mk('TM-SYC', 'Chitra RM', 'chitra.sync@example.com', 'own'));
      await save('team');
      const a = await pyPost('/users', {name: 'Asha Manager', email: 'asha.sync@example.com', code: 'SY-A', level: 3, role: 'ops', parent_id: ''});
      const b = await pyPost('/users', {name: 'Bala RM', email: 'bala.sync@example.com', code: 'SY-B', level: 1, role: 'ops', parent_id: a.id});
      const c = await pyPost('/users', {name: 'Chitra RM', email: 'chitra.sync@example.com', code: 'SY-C', level: 1, role: 'ops', parent_id: ''});
      return {a: a.id, b: b.id, c: c.id};
    });
    return 'payout users ' + JSON.stringify(ids);
  });

  await t.step('payout clients become CMS clients, and one BOSS already had is matched, not copied', async () => {
    const r = await t.eval(async ids => {
      DB.clients.push({id: 'CL-SYX', cmsName: 'ZZ Sync Existing Kumar', pan: 'PQRSX5678K', mobile: '9811100000', createdAt: new Date().toISOString()});
      await save('clients');
      const one = await pyPost('/clients', {name: 'ZZ SYNC ONE', pan: 'ABCSY1234F', email: 'one.sync@example.com', mobile: '9822200000'});
      await pyPut('/clients/' + one.id + '/map', {rmId: ids.b});
      const dup = await pyPost('/clients', {name: 'ZZ SYNC EXISTING KUMAR', pan: 'pqrsx5678k', mobile: ''});
      const res = await pyClientSync();
      const c1 = DB.clients.find(c=>!c.deletedAt && Number(c.payoutClientId) === one.id);
      const ex = DB.clients.filter(c=>!c.deletedAt && c.pan === 'PQRSX5678K');
      return {res, c1: c1 && {name: c1.cmsName, rm: c1.rmName, team: c1.mappedTo, via: c1.createdVia}, ex: ex.map(c=>({id: c.id, py: c.payoutClientId})),
        dupId: dup.id, oneId: one.id};
    }, ids);
    if(!r.c1 || r.c1.rm !== 'TM-SYB' || r.c1.team.join() !== 'TM-SYB,TM-SYA' || r.c1.via !== 'Payout import') throw new Error(JSON.stringify(r));
    if(r.ex.length !== 1 || r.ex[0].id !== 'CL-SYX' || Number(r.ex[0].py) !== r.dupId) throw new Error('matched ' + JSON.stringify(r.ex));
    ids.one = r.oneId; ids.dup = r.dupId;
    return r.res.created + ' created, ' + r.res.linked + ' matched to CL-SYX on PAN; RM Bala, team Bala › Asha';
  });

  await t.step('the RM and their manager see it; an RM off the mapping does not', async () => {
    const r = {bala: await sees('TM-SYB'), asha: await sees('TM-SYA'), chitra: await sees('TM-SYC')};
    if(!/ZZ SYNC ONE/.test(r.bala) || !/ZZ SYNC ONE/.test(r.asha) || /ZZ SYNC ONE/.test(r.chitra)) throw new Error(JSON.stringify(r));
    return 'Bala: ' + r.bala + '; Asha: ' + r.asha + '; Chitra: ' + (r.chitra || 'nothing');
  });

  await t.step('a change in BOSS reaches Payouts, and a change in Payouts reaches BOSS', async () => {
    const r = await t.eval(async ids => {
      const c = DB.clients.find(x=>Number(x.payoutClientId) === ids.one);
      c.mobile = '9833300000';
      await save('clients');
      await pyClientSync();
      const there = (await pyGet('/clients?all=1&q=ZZ SYNC ONE')).rows[0];
      await pyPut('/clients/' + ids.one, {name: 'ZZ SYNC ONE RENAMED', pan: there.pan, email: 'new.sync@example.com', mobile: there.mobile});
      await pyClientSync();
      const here = DB.clients.find(x=>Number(x.payoutClientId) === ids.one);
      return {payoutMobile: there.mobile, name: here.cmsName, email: here.email, mobile: here.mobile,
        copies: DB.clients.filter(x=>!x.deletedAt && Number(x.payoutClientId) === ids.one).length};
    }, ids);
    if(r.payoutMobile !== '9833300000' || r.name !== 'ZZ SYNC ONE RENAMED' || r.email !== 'new.sync@example.com' || r.mobile !== '9833300000' || r.copies !== 1)
      throw new Error(JSON.stringify(r));
    return 'mobile out to Payouts, rename and email back into CMS, still one record';
  });

  await t.step('a client added in Payouts arrives in CMS by itself', async () => {
    const r = await t.eval(async ids => {
      const two = await pyPost('/clients', {name: 'ZZ SYNC TWO', pan: 'ABCSY9999Z'});
      await pyPut('/clients/' + two.id + '/map', {rmId: ids.c});
      for(let i = 0; i < 40; i++){
        await new Promise(r=>setTimeout(r, 250));
        const c = DB.clients.find(x=>Number(x.payoutClientId) === two.id);
        if(c && c.rmName === 'TM-SYC') return {ok: true, rm: c.rmName};
      }
      return {ok: false};
    }, ids);
    if(!r.ok) throw new Error('not synced within 10 seconds');
    return 'ZZ SYNC TWO is in CMS with Chitra as RM';
  });

  await t.step('Clients & Map offers the sync to an admin', async () => {
    await t.eval(() => { PY.s.clientsTab = 'clients'; pyInvalidate(); navigate('pyclients'); });
    await t.page.waitForFunction(() => !document.querySelector('#content .py-loading'), null, {timeout: 15000});
    const has = await t.eval(() => Array.from(document.querySelectorAll('#content button')).some(b=>/Sync to BOSS clients/.test(b.textContent)));
    if(!has) throw new Error('no sync button');
    return 'the button is there';
  });
});
