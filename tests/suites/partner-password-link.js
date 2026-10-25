/* A PARTNER'S PASSWORD LINK says why it stopped working. A link works
   once; a newer link replaces the older one. Opening a spent link used
   to say only "expired or been used", which reads as broken when the
   partner had simply set their password already, or opened an older
   letter. Each case now says what happened and what to do. */
const {suite} = require('../lib/harness');

suite(async t => {
  const tokenOf = u => decodeURIComponent(u.split('t=')[1]);
  const open = async tok => (await fetch(t.base + '/partner/setup?t=' + encodeURIComponent(tok))).text();
  const setPw = tok => fetch(t.base + '/partner/setup', {method: 'POST', redirect: 'manual', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({t: tok, password: 'linkpass123', confirm: 'linkpass123'})});

  await t.step('a link replaced by a newer one, a used link, and the newest link', async () => {
    await t.eval(async () => {
      DB.pjOnboarding.push({id: 'POB-PWL1', firstName: 'Lina', lastName: 'Link', email: 'lina.pwl@example.com', pobStage: 'active', assignedTo: currentUser, createdAt: new Date().toISOString()});
      await save('pjOnboarding');
    });
    const first = await t.eval(() => pobPortalCall('accounts', {pobId: 'POB-PWL1', email: 'lina.pwl@example.com'}));
    const second = await t.eval(() => pobPortalCall('accounts', {pobId: 'POB-PWL1', email: 'lina.pwl@example.com'}));
    const old = await open(tokenOf(first.setupUrl));
    if(!/A newer password link has been sent/.test(old)) throw new Error('replaced: ' + old.slice(0, 600));
    const fresh = await open(tokenOf(second.setupUrl));
    if(!/Set your password/.test(fresh)) throw new Error('newest link did not open the form');
    const set = await setPw(tokenOf(second.setupUrl));
    if(set.status !== 302) throw new Error('setting the password answered ' + set.status);
    const used = await open(tokenOf(second.setupUrl));
    if(!/already set with this link/.test(used) || !/value="lina.pwl@example.com"/.test(used)) throw new Error('used: ' + used.slice(0, 600));
    const login = await fetch(t.base + '/partner/login', {method: 'POST', redirect: 'manual', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({email: 'lina.pwl@example.com', password: 'linkpass123'})});
    if(login.status !== 302 || !/flx_partner=/.test(login.headers.get('set-cookie') || '')) throw new Error('sign-in with the set password failed: ' + login.status);
    const junk = await open('x'.repeat(32));
    if(!/has expired/.test(junk)) throw new Error('unknown link: ' + junk.slice(0, 400));
    return 'older link: "a newer link was sent"; used link: "already set, sign in" with the email filled; sign-in works';
  });
  await t.step('the RM sets the password in BOSS: no link needed, even with no account on this server yet', async () => {
    const link = await t.eval(() => pobPortalCall('accounts', {pobId: 'POB-PWL1', email: 'lina.pwl@example.com'}));
    const r = await t.eval(async () => {
      // A partner whose record says it has a login, but this server holds no account for them.
      DB.pjOnboarding.push({id: 'POB-PWL2', firstName: 'Omar', lastName: 'Nolink', email: 'omar.pwl@example.com', pobStage: 'active', assignedTo: currentUser,
        createdAt: new Date().toISOString(), login: {userId: 'omar.pwl@example.com', status: 'Created', portal: true}});
      pobLive().find(x => x.id === 'POB-PWL1').login = {userId: 'lina.pwl@example.com', status: 'Created', portal: true};
      await save('pjOnboarding');
      const alerts = [], was = window.alert; window.alert = m => alerts.push(m);
      for(const [id, pw] of [['POB-PWL1', 'staffset123'], ['POB-PWL2', 'omarpass123']]){
        pobOpenSetPassword(id); document.getElementById('f_spPw').value = pw; await pobSaveSetPassword(id);
      }
      window.alert = was;
      return {alerts, audit: DB.auditLog.filter(a => a.action === 'Login Password Set').map(a => a.recordId)};
    });
    const signIn = async (email, password) => (await fetch(t.base + '/partner/login', {method: 'POST', redirect: 'manual', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({email, password})})).headers.get('set-cookie') || '';
    const lina = await signIn('lina.pwl@example.com', 'staffset123'), omar = await signIn('omar.pwl@example.com', 'omarpass123'), oldPw = await signIn('lina.pwl@example.com', 'linkpass123');
    const old = await open(tokenOf(link.setupUrl));
    if(!/flx_partner=/.test(lina) || !/flx_partner=/.test(omar) || /flx_partner=/.test(oldPw)) throw new Error(JSON.stringify({lina: !!lina, omar: !!omar, oldPw: !!oldPw}));
    if(!/Your RM has set a password for you/.test(old)) throw new Error('old link: ' + old.slice(0, 500));
    if(r.audit.length !== 2 || !r.alerts.every(a => /Login ID: .*pwl@example.com/.test(a))) throw new Error(JSON.stringify(r));
    return 'both sign in with the password the RM set; the old password and the old link are done with';
  });
});
