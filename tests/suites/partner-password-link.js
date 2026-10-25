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
});
