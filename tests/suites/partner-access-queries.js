/* PARTNER ACCESS, QUERIES AND DASHBOARDS. PMS and Onboarding swap names
   and nothing else; every level (L1–L6) raises and follows queries in PQS,
   L1 its own, L3 up its team's too; a query goes by its category to the
   department responsible (Technical to the IT Admin), who maps it to an
   associate, who writes the solution; L4–L6 open PPS, Onboarding and PMS
   for their own team only; and the dashboard says whose numbers it shows,
   and narrows to one person of the team on request. */
const {suite} = require('../lib/harness');

suite(async t => {
  let ids = {};
  /* Act as somebody for the length of fn, then come back. */
  const as = (who, fn, arg) => t.eval(async ([who, src, arg]) => {
    const was = currentUser; currentUser = who;
    try { return await (eval('(' + src + ')'))(arg); } finally { currentUser = was; }
  }, [who, fn.toString(), arg]);

  await t.step('the names swap: PMS reads Onboarding, Onboarding reads PMS', async () => {
    const r = await t.eval(async () => {
      navigate('pob'); await new Promise(r=>setTimeout(r,40));
      const pob = document.getElementById('content').textContent;
      navigate('pms'); await new Promise(r=>setTimeout(r,40));
      const pms = document.getElementById('content').textContent;
      return {short: [NAV_SHORT.pms, NAV_SHORT.pob], pob: pob.includes('PMS — Partner Managing System'), pms: pms.includes('Onboarding — Partner Onboarding'),
        stillWorks: typeof viewPOB === 'function' && MODULE_VIEW.PMS === 'pms'};
    });
    if(r.short.join() !== 'Onboarding,PMS' || !r.pob || !r.pms || !r.stillWorks) throw new Error(JSON.stringify(r));
    return 'rail: pms → ' + r.short[0] + ', pob → ' + r.short[1];
  });

  await t.step('a team of partners: Leo L4 › Sam L3 › Nina L1, and Ola L1 elsewhere; IT has an admin and an associate', async () => {
    ids = await t.eval(async () => {
      window.alert = () => {};
      const now = new Date().toISOString();
      DB.team.push({id: 'TM-ITA', name: 'Ira IT', email: 'ira.it@example.com', role: 'Relationship Manager', designation: 'IT Admin', departments: ['IT'],
          status: 'Active', scope: 'own', perms: fullPerms(true), adminFlags: {}, createdAt: now},
        {id: 'TM-ITB', name: 'Tej Tech', email: 'tej.tech@example.com', role: 'Relationship Manager', designation: 'Support Associate',
          status: 'Active', scope: 'own', perms: fullPerms(true), adminFlags: {}, createdAt: now});
      await save('team');
      const mk = async (first, email, level, up) => {
        const p = {id: uid('PMS'), firstName: first, lastName: 'Partner', mobile: '98765' + String(10000 + DB.team.length), email, assignedTo: currentUser, createdAt: now};
        initState('PMS', p); p.pmsStage = 'onboarded'; pjPartners().push(p); await save('pjPartners');
        const o = await pobStart(p.id, {quiet: true});
        o.pobStage = 'active'; o.operationalStatus = 'Active';
        const res = await pobGiveLogin(o, {email, level, up, noAccount: true, noPayout: true});
        await save('pjOnboarding');
        return {member: res.member.id, pob: o.id, partner: p.id};
      };
      const leo = await mk('Leo', 'leo.p@example.com', 'L4', currentUser);
      const sam = await mk('Sam', 'sam.p@example.com', 'L3', leo.member);
      const nina = await mk('Nina', 'nina.p@example.com', 'L1', sam.member);
      const ola = await mk('Ola', 'ola.p@example.com', 'L1', currentUser);
      return {leo, sam, nina, ola, admin: currentUser};
    });
    return 'four partner logins and two IT people';
  });

  await t.step('every level opens PQS and raises a query; only L4 up opens PPS, Onboarding and PMS', async () => {
    const lv = async m => as(m, () => ({pqs: pageOpenToMe('pqs'), raise: can('PQS','create'), pps: pageOpenToMe('pps'), pms: pageOpenToMe('pms'),
      pob: pageOpenToMe('pob'), ppo: pageOpenToMe('ppo')}));
    const nina = await lv(ids.nina.member), sam = await lv(ids.sam.member), leo = await lv(ids.leo.member);
    if(!nina.pqs || !nina.raise || nina.pps || nina.pms || nina.pob) throw new Error('L1 ' + JSON.stringify(nina));
    if(!sam.pqs || sam.pps || sam.pob) throw new Error('L3 ' + JSON.stringify(sam));
    if(!leo.pqs || !leo.pps || !leo.pms || !leo.pob || leo.ppo) throw new Error('L4 ' + JSON.stringify(leo));
    return 'L1 and L3: PQS only; L4: PQS, PPS, Onboarding and PMS (not payouts)';
  });

  await t.step('Nina raises a Technical query: it goes to the IT Admin, who is told', async () => {
    const r = await as(ids.nina.member, async () => {
      pjOpenQueryForm();
      const opts = pqsRaiseFields()[0].opts, picked = document.getElementById('f_partnerId').value;
      document.getElementById('f_subject').value = 'Cannot open my payouts';
      document.getElementById('f_category').value = 'Technical';
      document.getElementById('f_description').value = 'The page stays blank.';
      await pjSaveQuery();
      const q = pjQueries().find(x=>x.subject==='Cannot open my payouts');
      return {opts: opts.length, picked: picked === opts[0], q: q && {handler: q.handler, dept: q.department, status: q.status},
        told: DB.notifications.some(n=>n.userId==='TM-ITA' && n.arg===(q && q.id)), id: q && q.id};
    });
    if(r.opts !== 1 || !r.picked || !r.q || r.q.handler !== 'TM-ITA' || r.q.dept !== 'IT' || r.q.status !== 'Open' || !r.told) throw new Error(JSON.stringify(r));
    ids.q = r.id;
    return 'only her own partner record to pick; routed to IT (Ira IT), and Ira’s bell has it';
  });

  await t.step('Nina and her Sherpa see it; Ola, on another team, does not', async () => {
    const seen = m => as(m, id => pqsVisibleList().some(q=>q.id===id), ids.q);
    const r = {nina: await seen(ids.nina.member), sam: await seen(ids.sam.member), leo: await seen(ids.leo.member), ola: await seen(ids.ola.member),
      tej: await seen('TM-ITB'), ira: await seen('TM-ITA')};
    if(!r.nina || !r.sam || !r.leo || r.ola || r.tej || !r.ira) throw new Error(JSON.stringify(r));
    return 'Nina, Sam, Leo and Ira see it; Ola and the unmapped associate do not';
  });

  await t.step('the IT Admin maps it to an associate, who writes the solution; Nina is told and closes it', async () => {
    const mapped = await as('TM-ITA', async id => {
      pqsOpenQuery(id);
      document.getElementById('pqsAssoc').value = 'TM-ITB';
      await pqsAct(id, 'route');
      const q = pjQueries().find(x=>x.id===id);
      return {to: q.assignTo, status: q.status, told: DB.notifications.some(n=>n.userId==='TM-ITB' && n.arg===id)};
    }, ids.q);
    if(mapped.to !== 'TM-ITB' || mapped.status !== 'In Progress' || !mapped.told) throw new Error(JSON.stringify(mapped));
    const solved = await as('TM-ITB', async id => {
      const waiting = pqsVisibleList().filter(pqsWaitingOnMe).some(q=>q.id===id);
      pqsOpenQuery(id);
      document.getElementById('pqsSol').value = 'Clear the browser cache and sign in again.';
      await pqsAct(id, 'resolve');
      const q = pjQueries().find(x=>x.id===id);
      return {waiting, status: q.status, nina: DB.notifications.some(n=>n.userId!==currentUser && n.arg===id && /Resolved/.test(n.body))};
    }, ids.q);
    if(!solved.waiting || solved.status !== 'Resolved' || !solved.nina) throw new Error(JSON.stringify(solved));
    const closed = await as(ids.nina.member, async id => {
      pqsOpenQuery(id); await pqsAct(id, 'close');
      const q = pjQueries().find(x=>x.id===id);
      return {status: q.status, trail: q.trail.map(x=>x.what)};
    }, ids.q);
    if(closed.status !== 'Closed') throw new Error(JSON.stringify(closed));
    return closed.trail.join(' → ');
  });

  await t.step('Leo (L4) works PMS for his own team only', async () => {
    const r = await as(ids.leo.member, () => ({
      pob: visibleRecords(pobLive(), x=>x.assignedTo, x=>x.branch).map(x=>x.id),
      edit: can('POB','edit'), create: can('POB','create')}));
    const want = [ids.leo.pob, ids.sam.pob, ids.nina.pob];
    if(!want.every(x=>r.pob.includes(x)) || r.pob.includes(ids.ola.pob) || !r.edit || !r.create) throw new Error(JSON.stringify(r));
    return r.pob.length + ' records: Leo, Sam and Nina, not Ola';
  });

  await t.step('the dashboard says whose numbers it shows, and narrows to one person', async () => {
    await t.eval(async ids => {
      const now = new Date().toISOString();
      DB.clients.push({id: 'CL-DA1', cmsName: 'Leo Client', rmName: ids.leo.member, createdAt: now},
        {id: 'CL-DA2', cmsName: 'Nina Client', rmName: ids.nina.member, createdAt: now},
        {id: 'CL-DA3', cmsName: 'Ola Client', rmName: ids.ola.member, createdAt: now});
      await save('clients');
    }, ids);
    const r = await as(ids.leo.member, async ids => {
      window._dashWho = '';
      navigate('dashboard'); await new Promise(r=>setTimeout(r,40));
      const bar = (document.getElementById('dashScope')||{}).textContent || '';
      const count = () => mdClients().map(c=>c.id).filter(x=>/^CL-DA/.test(x)).sort().join();
      const all = count();
      window._dashWho = 'me'; const me = count();
      window._dashWho = ids.sam.member; const sam = count();
      window._dashWho = '';
      return {bar, all, me, sam};
    }, ids);
    if(!/you and the 2 people reporting to you/.test(r.bar.replace(/\s+/g, ' '))) throw new Error(r.bar);
    if(r.all !== 'CL-DA1,CL-DA2' || r.me !== 'CL-DA1' || r.sam !== 'CL-DA2') throw new Error(JSON.stringify(r));
    return 'team: ' + r.all + '; only me: ' + r.me + '; Sam and his team: ' + r.sam;
  });
});
