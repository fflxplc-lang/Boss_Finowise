/* PARTNER LOGIN ACCESS — a partner signs in at /partner with their own
   Freedom LifeX login and opens only what their access allows.
   An imported, already-active FBM gets a login from Create Partner Login
   on their record; Setup › Partner Login Access sets what a role opens;
   a partner's own list wins over the role's; a section left out is
   neither drawn nor answered; My Clients and My Payouts carry the
   partner's own rows only. */
const {suite} = require('../lib/harness');

suite(async t => {
  let cookie = '';
  const get = async path => { const r = await fetch(t.base + '/api/partner-portal/' + path, {headers: {Cookie: cookie}}); return {status: r.status, d: await r.json().catch(()=>({}))}; };

  await t.step('an imported active FBM, with a client, business and payouts; and another partner beside them', async () => {
    const r = await t.eval(async () => {
      const now = new Date().toISOString(), m = now.slice(0, 7);
      DB.pjOnboarding.push({id: 'POB-PLA1', firstName: 'Kiran', lastName: 'Rao', email: 'kiran.pla@example.com', partnerType: 'FBM', partnerId: 'PMS-PLA1',
          pobStage: 'active', imported: true, assignedTo: currentUser, createdAt: now},
        {id: 'POB-PLA2', firstName: 'Other', lastName: 'Partner', email: 'other.pla@example.com', role: 'Sherpa', partnerId: 'PMS-PLA2',
          pobStage: 'active', assignedTo: currentUser, createdAt: now});
      DB.clients.push({id: 'CMS-PLA1', cmsName: 'Asha Client', city: 'Pune', partnerPobId: 'POB-PLA1', createdAt: now, cmsStage: 'mandateStatus'},
        {id: 'CMS-PLA2', cmsName: 'Hidden Client', partnerPobId: 'POB-PLA2', createdAt: now, cmsStage: 'clientCreated'});
      DB.transactions.push({id: 'TXN-PLA1', clientId: 'CMS-PLA1', amount: '200000', status: 'Initiated', initiatedDate: m + '-03'},
        {id: 'TXN-PLA2', clientId: 'CMS-PLA1', amount: '5000', status: 'Rejected', initiatedDate: m + '-04'},
        {id: 'TXN-PLA3', clientId: 'CMS-PLA2', amount: '70000', status: 'Initiated', initiatedDate: m + '-04'});
      DB.partnerPayouts = (DB.partnerPayouts || []).concat([
        {id: 'PPO-PLA1', partnerId: 'PMS-PLA1', period: m, businessAmount: 200000, ratePct: 1, tdsPct: 10, status: 'Paid', paidOn: m + '-20', reference: 'UTR123'},
        {id: 'PPO-PLA2', partnerId: 'PMS-PLA1', period: '2026-01', businessAmount: 100000, ratePct: 1, tdsPct: 10, status: 'Approved', reference: 'not yet'},
        {id: 'PPO-PLA3', partnerId: 'PMS-PLA2', period: m, businessAmount: 900000, ratePct: 1, tdsPct: 10, status: 'Paid'}]);
      await save('pjOnboarding'); await save('clients'); await save('transactions'); await save('partnerPayouts');
      navigate('pob', 'POB-PLA1'); await new Promise(r => setTimeout(r, 80));
      return {button: !!Array.from(document.querySelectorAll('#content button')).find(b => b.textContent.trim() === 'Create Partner Login')};
    });
    if(!r.button) throw new Error('no Create Partner Login on the imported partner');
    return 'the imported FBM has no login, and their record offers Create Partner Login';
  });

  await t.step('Setup › Partner Login Access: the no-role column leaves out Payments and My Performance', async () => {
    const r = await t.eval(async () => {
      openSetupScreen('partnerlogin'); await new Promise(r => setTimeout(r, 60));
      const boxes = document.querySelectorAll('#content input[id^="pas_"]').length;
      document.getElementById('pas_Noroleyet_payments').checked = false;
      document.getElementById('pas_Noroleyet_performance').checked = false;
      const was = window.alert; window.alert = () => {}; await pobSavePortalSettings(); window.alert = was;
      return {boxes, saved: DB.config.partnerPortal.roles['No role yet'], sherpa: DB.config.partnerPortal.roles.Sherpa};
    });
    if(r.boxes !== 9 * 4 || r.saved.includes('payments') || r.saved.includes('performance') || !r.saved.includes('clients') || !r.sherpa.includes('payments')) throw new Error(JSON.stringify(r));
    return '36 boxes (9 sections × 4 roles); no role yet: ' + r.saved.join(', ');
  });

  await t.step('Create Partner Login: the login is made, following the role default, with no stage change', async () => {
    const r = await t.eval(async () => {
      pobOpenLoginModal('POB', 'POB-PLA1', '');
      const follow = document.getElementById('pa_follow').checked, perfOff = !document.getElementById('pa_performance').checked;
      await pobSaveLogin('POB-PLA1', '');
      const x = pobLive().find(y => y.id === 'POB-PLA1');
      const acct = await pobPortalCall('accounts', {pobId: 'POB-PLA1', email: x.login.userId});
      return {follow, perfOff, login: x.login && x.login.userId, own: x.portalAccess, stage: x.pobStage, setupUrl: acct.setupUrl,
        audit: DB.auditLog.filter(a => a.recordId === 'POB-PLA1').map(a => a.action)};
    });
    if(!r.follow || !r.perfOff || r.login !== 'kiran.pla@example.com' || r.own !== undefined || r.stage !== 'active' || !r.audit.includes('Partner Login Created')) throw new Error(JSON.stringify(r));
    const token = decodeURIComponent(r.setupUrl.split('t=')[1]);
    const set = await fetch(t.base + '/partner/setup', {method: 'POST', redirect: 'manual', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({t: token, password: 'kiranpass123', confirm: 'kiranpass123'})});
    cookie = ((set.headers.get('set-cookie') || '').match(/flx_partner=[^;]+/) || [])[0] || '';
    if(!cookie) throw new Error('no partner session: ' + set.status);
    return 'login ' + r.login + ' made; still active; audited';
  });

  await t.step('the server answers what the role opens and refuses the rest', async () => {
    const me = await get('me'), perf = await get('performance'), cl = await get('clients'), po = await get('payouts');
    if(!me.d.ok || me.d.access.includes('performance') || me.d.access.includes('payments') || me.d.payments.length || me.d.mayRecordPayment) throw new Error(JSON.stringify(me.d.access));
    if(perf.status !== 403) throw new Error('performance answered ' + perf.status);
    if(!cl.d.ok || cl.d.clients.length !== 1 || cl.d.clients[0].name !== 'Asha Client' || cl.d.totals.business !== 200000 || cl.d.totals.transactions !== 1 || !cl.d.clients[0].onboarded) throw new Error(JSON.stringify(cl.d));
    if(!po.d.ok || po.d.payouts.length !== 2 || po.d.totals.paid !== 1800 || po.d.totals.due !== 900 || po.d.payouts.find(p => p.status !== 'Paid').reference) throw new Error(JSON.stringify(po.d));
    if(JSON.stringify(cl.d).includes('Hidden Client') || JSON.stringify(po.d).includes('9000')) throw new Error('another partner leaked in');
    return 'performance 403; 1 client, ₹2,00,000 business; payouts ₹1,800 paid, ₹900 due — their own only';
  });

  await t.step('the partner’s own list wins over the role’s', async () => {
    const r = await t.eval(async () => {
      pobOpenAccessModal('POB-PLA1');
      document.getElementById('pa_follow').checked = false;
      document.getElementById('pa_performance').checked = true;
      document.getElementById('pa_payouts').checked = false;
      await pobSaveAccess('POB-PLA1');
      const x = pobLive().find(y => y.id === 'POB-PLA1');
      return {own: x.portalAccess, summary: pobAccessSummary(x), audit: DB.auditLog.filter(a => a.recordId === 'POB-PLA1').map(a => a.action)};
    });
    if(!r.own.includes('performance') || r.own.includes('payouts') || !/^Own list/.test(r.summary) || !r.audit.includes('Login Access Changed')) throw new Error(JSON.stringify(r));
    const perf = await get('performance'), po = await get('payouts');
    if(perf.status !== 200 || po.status !== 403) throw new Error('performance ' + perf.status + ', payouts ' + po.status);
    return r.summary;
  });

  await t.step('at /partner the tabs follow the access', async () => {
    const [name, value] = cookie.split('=');
    const ctx = await t.page.context().browser().newContext();
    await ctx.addCookies([{name, value, url: t.base}]);
    const p = await ctx.newPage();
    await p.goto(t.base + '/partner', {waitUntil: 'domcontentloaded'});
    await p.waitForSelector('nav button');
    const tabs = await p.$$eval('nav button', bs => bs.map(b => b.textContent.trim()));
    await p.click('nav button:has-text("My Clients")');
    await p.waitForSelector('text=Asha Client', {timeout: 10000});
    const text = await p.textContent('main');
    if(process.env.PLA_SHOT) await p.screenshot({path: process.env.PLA_SHOT, fullPage: true});
    await ctx.close();
    if(!tabs.includes('My Clients') || !tabs.includes('My Performance') || tabs.includes('My Payouts') || tabs.includes('Payments') || !/₹2,00,000/.test(text)) throw new Error(tabs.join('|') + ' :: ' + text.slice(0, 300));
    return tabs.join(' · ');
  });

  await t.step('the BOSS sign-in page points partners to their own login', async () => {
    const html = await (await fetch(t.base + '/login')).text();
    if(!/href="\/partner\/login"/.test(html)) throw new Error('no partner link on /login');
    return 'link to /partner/login';
  });
});
