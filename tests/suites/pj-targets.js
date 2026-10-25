/* PARTNER PERFORMANCE — target against achievement, from the Partner
   Onboarding flowchart. A Sherpa's leads, clients, transactions and
   reviews are laid down across this month, the two before it and last
   year; Setup › Partner Targets sets the role's monthly targets; the
   page must then count each measure in the right month, compare it with
   the two months and the two years before, let the partner's own target
   win over the role's, add outside achievement, and list an imported
   active partner who has no role. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.step('a Sherpa with work across the months, and an imported partner with no role', async () => {
    const r = await t.eval(async () => {
      const m0 = ptToday().slice(0,7), m1 = ptShiftMonth(m0, -1), m2 = ptShiftMonth(m0, -2), ly = ptShiftMonth(m0, -12);
      const d = m => m + '-05T10:00:00.000Z';
      const now = new Date().toISOString();
      DB.pjOnboarding.push({id: 'POB-PT1', firstName: 'Tara', lastName: 'Shah', role: 'Sherpa', pobStage: 'active', assignedTo: currentUser, createdAt: d(ly)},
        {id: 'POB-PT2', firstName: 'Imran', lastName: 'Old', partnerType: 'FBM', pobStage: 'active', imported: true, assignedTo: currentUser, createdAt: now});
      const lead = (i, m, states) => ({id: 'LMS-PT' + i, firstName: 'Lead', lastName: String(i), mobile: '98000000' + String(10 + i), partnerPobId: 'POB-PT1',
        createdAt: d(m), status: states.length ? states[states.length - 1] : 'created',
        blueprintHistory: [{state: 'created', at: d(m)}].concat(states.map(s => ({state: s, at: d(m)})))});
      // This month 4 leads (2 qualified, 1 meeting); last month 2; two months back 1; a year ago 3.
      DB.leads.push(lead(1, m0, ['qualified']), lead(2, m0, ['qualified', 'firstMeetingScheduled']), lead(3, m0, []), lead(4, m0, []),
        lead(5, m1, []), lead(6, m1, ['qualified']), lead(7, m2, []), lead(8, ly, []), lead(9, ly, []), lead(10, ly, []));
      // A client converted this month and onboarded, with a ₹50,000 transaction and a closed review.
      DB.clients.push({id: 'CMS-PT1', cmsName: 'Client One', partnerPobId: 'POB-PT1', createdAt: d(m0), lmsCreatedAt: d(m1),
        lmsHistory: [{state: 'created', at: d(m1)}, {state: 'qualified', at: d(m1)}], cmsStage: 'mandateStatus',
        blueprintHistory: [{state: 'clientCreated', at: d(m0)}, {state: 'mandateRegistration', at: d(m0)}, {state: 'mandateStatus', at: d(m0)}]});
      DB.transactions.push({id: 'TXN-PT1', clientId: 'CMS-PT1', amount: '50000', status: 'Initiated', initiatedDate: m0 + '-06'},
        {id: 'TXN-PT2', clientId: 'CMS-PT1', amount: '99999', status: 'Rejected', initiatedDate: m0 + '-07'});
      DB.reviews.push({id: 'RMS-PT1', clientId: 'CMS-PT1', rmsStatus: 'closed', blueprintHistory: [{state: 'closed', at: d(m0)}]});
      pobReviews().push({id: 'PRV-PT1', pobId: 'POB-PT1', kind: 'Monthly Review', status: 'Completed', completedAt: d(m1), dueDate: m1 + '-01'});
      await save('pjOnboarding'); await save('leads'); await save('clients'); await save('transactions'); await save('reviews'); await save('pjReviews');
      const e = ptEventsOf(pobLive().find(x => x.id === 'POB-PT1'));
      return {m0: ptSum(e, m0, m0), m1: ptSum(e, m1, m1), m2: ptSum(e, m2, m2), ly: ptSum(e, ly, ly)};
    });
    const want = {m0: {prospects: 4, qualified: 2, meetings: 1, conversions: 1, onboarded: 1, transactions: 1, business: 50000, reviews: 1},
      m1: {prospects: 3, qualified: 2, monthly: 1}, m2: {prospects: 1}, ly: {prospects: 3}};
    const bad = [];
    Object.entries(want).forEach(([p, row]) => Object.entries(row).forEach(([k, v]) => { if(r[p][k] !== v) bad.push(`${p}.${k} ${r[p][k]} (want ${v})`); }));
    if(bad.length) throw new Error(bad.join('; '));
    return 'this month: 4 prospects, 2 qualified, 1 meeting, 1 converted and onboarded, ₹50,000 in 1 transaction (the rejected one left out), 1 client review';
  });

  await t.step('Setup › Partner Targets sets the Sherpa’s monthly targets', async () => {
    const r = await t.eval(async () => {
      openSetupScreen('partnertargets');
      await new Promise(r => setTimeout(r, 60));
      const inputs = document.querySelectorAll('#content input[id^="ptS_"]').length;
      document.getElementById('ptS_Sherpa_prospects').value = '8';
      document.getElementById('ptS_Sherpa_business').value = '100000';
      const was = window.alert; window.alert = () => {}; await ptSaveSettings(); window.alert = was;
      return {inputs, saved: DB.config.partnerTargets.roles.Sherpa, heads: Array.from(document.querySelectorAll('#content th')).map(th => th.textContent).join('|')};
    });
    if(r.inputs !== 11 * 4 || r.saved.prospects !== 8 || r.saved.business !== 100000 || r.saved.reviews !== 4 || !/No role yet/.test(r.heads)) throw new Error(JSON.stringify(r));
    return '44 boxes (11 measures × 3 roles + no role); Sherpa prospects 8 a month, business ₹1,00,000';
  });

  await t.step('the month view scores Tara against target and the two months before', async () => {
    const r = await t.eval(async () => {
      Object.assign(PT, {mode: 'month', month: '', role: '', partner: 'POB-PT1'});
      navigate('ppf'); await new Promise(r => setTimeout(r, 60));
      const row = name => { const tr = Array.from(document.querySelectorAll('#content table tr')).find(x => x.cells[0] && x.cells[0].textContent.startsWith(name));
        return tr ? Array.from(tr.cells).map(c => c.textContent.replace(/\s+/g, ' ').trim()) : null; };
      return {prospects: row('Prospects collected'), business: row('Business amount'), months: !!document.querySelector('.pt-grid'),
        tiles: Array.from(document.querySelectorAll('.mkpi')).map(k => k.textContent.replace(/\s+/g, ' ').trim()), svg: !!document.querySelector('.pt-svg')};
    });
    // Prospects: target 8, achieved 4 (50%), last month 3 (+33.3%), the month before 1 (+300%).
    const p = r.prospects;
    if(!p || p[1] !== '8' || p[2] !== '4' || !/50\.0%/.test(p[3]) || p[4] !== '3' || !/33\.3%/.test(p[5]) || p[6] !== '1' || !/300\.0%/.test(p[7])) throw new Error(JSON.stringify(p));
    if(!r.business || !/50,000/.test(r.business[2]) || !/50\.0%/.test(r.business[3]) || !r.months || !r.svg) throw new Error(JSON.stringify(r));
    return 'Prospects 4 of 8 (50%), ▲33.3% on last month, ▲300% on the month before; ' + r.tiles[0];
  });

  await t.step('the year view compares this year with the two before, like for like', async () => {
    const r = await t.eval(async () => {
      PT.mode = 'year'; render(); await new Promise(r => setTimeout(r, 60));
      const tr = Array.from(document.querySelectorAll('#content table')[0].rows).find(x => x.cells[0].textContent.startsWith('Prospects collected'));
      const head = Array.from(document.querySelectorAll('#content table')[0].rows[0].cells).map(c => c.textContent);
      return {cells: Array.from(tr.cells).map(c => c.textContent.replace(/\s+/g, ' ').trim()), head, title: document.querySelector('#content .pt-card h3').textContent,
        m: ptToday().slice(5,7)};
    });
    // This year to date: 4 + 3 + 1 (and last year's 3 only if they fall in this year's months, which they cannot).
    const yr = Number(r.cells[2]);
    if(!(yr >= 8) || r.cells[1] !== String(8 * 12) || !/vs|Growth/.test(r.head.join()) ) throw new Error(JSON.stringify(r));
    if(r.m !== '12' && !/like for like/.test(r.title)) throw new Error(r.title);
    return r.title.replace(/\s+/g, ' ') + ' — prospects ' + r.cells[2] + ' of ' + r.cells[1];
  });

  await t.step('Tara’s own target wins over the role’s, and outside work adds on', async () => {
    const r = await t.eval(async () => {
      const m0 = ptToday().slice(0,7), y = +m0.slice(0,4);
      ptOpenTargets('POB-PT1', y);
      document.getElementById('ptT_prospects').value = '2';
      await ptSaveTargets('POB-PT1', y);
      ptOpenManual('POB-PT1', m0);
      document.getElementById('ptM_onboarded').value = '2';
      await ptSaveManual('POB-PT1');
      const t = pobLive().find(x => x.id === 'POB-PT1');
      const e = ptEventsOf(t);
      return {target: ptTargetFor(t, 'prospects', m0), business: ptTargetFor(t, 'business', m0), onboarded: ptSum(e, m0, m0).onboarded,
        audit: (DB.auditLog||[]).filter(a => a.recordId === 'POB-PT1').map(a => a.action).join('|')};
    });
    if(r.target !== 2 || r.business !== 100000 || r.onboarded !== 3 || !/Targets Set/.test(r.audit) || !/Outside Achievement/.test(r.audit)) throw new Error(JSON.stringify(r));
    return 'own prospects target 2 (business still the role’s ₹1,00,000); onboarded 1 + 2 outside = 3; both in the audit trail';
  });

  await t.step('Tara signs in at /partner and sees the same scorecard, of her own work only', async () => {
    const acct = await t.eval(() => pobPortalCall('accounts', {pobId: 'POB-PT1', email: 'tara.pt@example.com'}));
    if(!acct.ok) throw new Error(JSON.stringify(acct));
    const token = decodeURIComponent(acct.setupUrl.split('t=')[1]);
    const set = await fetch(t.base + '/partner/setup', {method: 'POST', redirect: 'manual', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({t: token, password: 'tarapass123', confirm: 'tarapass123'})});
    const cookie = ((set.headers.get('set-cookie') || '').match(/flx_partner=[^;]+/) || [])[0] || '';
    if(!cookie) throw new Error('no partner session: ' + set.status);
    const d = await (await fetch(t.base + '/api/partner-portal/performance', {headers: {Cookie: cookie}})).json();
    const crm = await t.eval(() => { const r = pobLive().find(x => x.id === 'POB-PT1'), m0 = ptToday().slice(0,7);
      return {a: ptSum(ptEventsOf(r), m0, m0), t: ptTargets(r, m0, m0)}; });
    const cur = d.month && d.month.data[0];
    if(!d.ok || !cur || JSON.stringify(cur.achieved) !== JSON.stringify(crm.a) || JSON.stringify(cur.target) !== JSON.stringify(crm.t)) throw new Error(JSON.stringify({d: cur, crm}));
    if(cur.achieved.prospects !== 4 || cur.target.prospects !== 2 || cur.target.business !== 100000 || d.month.data[1].achieved.prospects !== 3) throw new Error(JSON.stringify(cur));
    if(JSON.stringify(d).includes('Imran')) throw new Error('another partner leaked into Tara\u2019s answer');
    const anon = await fetch(t.base + '/api/partner-portal/performance');
    if(anon.status !== 401) throw new Error('signed out got ' + anon.status);
    const [name, value] = cookie.split('=');
    const ctx = await t.page.context().browser().newContext();
    await ctx.addCookies([{name, value, url: t.base}]);
    const p2 = await ctx.newPage();
    await p2.goto(t.base + '/partner', {waitUntil: 'domcontentloaded'});
    await p2.waitForSelector('nav button');
    await p2.click('nav button:has-text("My Performance")');
    await p2.waitForSelector('text=Target vs achievement', {timeout: 10000});
    const month = await p2.textContent('main');
    await p2.click('button[data-pmode="year"]');
    const year = await p2.textContent('main');
    if(process.env.PT_SHOT) await p2.screenshot({path: process.env.PT_SHOT, fullPage: true});
    await ctx.close();
    if(!/Prospects collected/.test(month) || !/Month by month/.test(month) || !/whole year/.test(year)) throw new Error(month.slice(0, 400));
    return 'the server\u2019s count matches the CRM\u2019s to the measure; month and year views draw; signed out is refused';
  });

  await t.step('all partners: the board ranks them, the imported FBM included', async () => {
    const r = await t.eval(async () => {
      Object.assign(PT, {mode: 'month', partner: '', role: ''}); render(); await new Promise(r => setTimeout(r, 60));
      const rows = Array.from(document.querySelectorAll('#ptBoard tbody tr')).map(tr => tr.cells[0].textContent + ' · ' + tr.cells[1].textContent);
      PT.role = PT_NO_ROLE; render();
      const only = Array.from(document.querySelectorAll('#ptBoard tbody tr')).map(tr => tr.cells[0].textContent);
      PT.role = '';
      return {rows, only};
    });
    if(!r.rows.some(x => /Tara Shah · Sherpa/.test(x)) || !r.rows.some(x => /Imran Old · FBM · no role yet/.test(x)) || r.only.join() !== 'Imran Old') throw new Error(JSON.stringify(r));
    return r.rows.join('; ');
  });
});
