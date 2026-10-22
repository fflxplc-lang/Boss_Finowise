/* A PROFILE THAT SAYS WHAT A RIGHT ANSWER LOOKS LIKE.

   Every box of a team member's own details carries an example of a good
   answer, and the ones with a fixed format — a mobile, an email, a PIN,
   a PAN, an Aadhaar, a UAN, an ESIC, an ARN, an EUIN, an IFSC, an account
   number — refuse a wrong one with a message under the box, on save as
   well as while typing. A PIN fills the city, state and country, and an
   IFSC the bank and branch, from the directories, and both stay editable.

   Aadhaar is checked whole and kept as its last four digits only.

   Then the Security card: two-step sign-in is real (a code emailed at
   sign-in, enabled only once a code comes back right), and desktop
   notifications ask the browser and only say ENABLED when it agrees. */
const http = require('http');
const {suite} = require('../lib/harness');
const {EMAIL, PASSWORD} = require('../lib/signin');

/* The two directories, standing in for India Post and the IFSC list. */
const LOOKUP_PORT = Number(process.env.BOSS_PORT || 3000) + 252;
const lookups = http.createServer((req, res) => {
  const pin = /^\/pincode\/(\d{6})$/.exec(req.url);
  const ifsc = /^\/ifsc\/([A-Z0-9]{11})$/.exec(req.url);
  res.setHeader('Content-Type', 'application/json');
  if(pin && pin[1] === '560001') return res.end(JSON.stringify([{Status:'Success', PostOffice:[
    {Name:'Bangalore G.P.O.', District:'Bengaluru', State:'Karnataka', Country:'India'}]}]));
  if(pin) return res.end(JSON.stringify([{Status:'Error', Message:'No records found', PostOffice:null}]));
  if(ifsc && ifsc[1] === 'SBIN0001234') return res.end(JSON.stringify({BANK:'State Bank of India',
    BRANCH:'Indiranagar Branch', CITY:'Bengaluru', STATE:'Karnataka', IFSC:'SBIN0001234'}));
  res.statusCode = 404; res.end('"Not Found"');
});

suite({mail: true}, async t => {
  await new Promise(r => lookups.listen(LOOKUP_PORT, '127.0.0.1', r));
  /* a PIN or IFSC that is not on file is reported as such, which logs a 404 */
  t.expectConsole(/404/);
  const open = async () => {
    await t.eval(()=>{ closeModal(); navigate('profile'); });
    await t.wait(300);
  };
  const card = name => t.page.locator('.card', {has: t.page.locator('.section-title', {hasText: name})});

  t.section('what each box asks for');

  await t.step('every detail shows an example of a right answer', async () => {
    await open();
    const r = await t.eval(()=>{
      const ph = id => (document.getElementById('f_' + id) || {}).placeholder || '';
      return {phone: ph('phone'), email: ph('personalEmail'), name: ph('emergencyName'), em: ph('emergencyPhone'),
        official: ph('officialMobile'), pin: ph('pincode'), line2: ph('addressLine2'),
        pan: ph('panNumber'), aadhaar: ph('aadhaarLast4'), uan: ph('pfUan'), esic: ph('esicNumber'),
        arn: ph('arnNo'), euin: ph('euinNo'), nism: ph('nismCert'), bank: ph('bankName'), holder: ph('bankAccountName'),
        acct: ph('bankAccountNumber'), ifsc: ph('bankIfsc'), branch: ph('bankBranch'),
        relation: (window._pickRows.f_emergencyRelation || []).map(o=>o.value).filter(Boolean),
        nismList: Array.from(document.querySelectorAll('#dl_f_nismCert option')).length,
        nismNo: !!document.getElementById('f_nismCertNo')};
    });
    const want = {pin:'560001', pan:'ABCDE1234F', aadhaar:'XXXX XXXX 1234', uan:'123456789012', esic:'1234567890',
      arn:'ARN-123456', euin:'E123456789', nism:'NISM-Series-V-A', bank:'State Bank of India', holder:'Ramesh Kumar',
      acct:'123456789012', ifsc:'SBIN0001234', branch:'Indiranagar Branch'};
    for(const [k, v] of Object.entries(want)) if(r[k] !== v) throw new Error(k + ' shows "' + r[k] + '", wanted "' + v + '"');
    ['phone','email','name','em','official','line2'].forEach(k=>{ if(!r[k]) throw new Error('no placeholder on ' + k); });
    if(r.relation.join(',') !== 'Father,Mother,Sister,Brother,Other')
      throw new Error('the relationship offers ' + r.relation.join(','));
    if(r.nismList < 5 || !r.nismNo) throw new Error('NISM has no list to pick from, or no certificate number');
    return 'placeholders on every box, the relationship is a dropdown of five, NISM has '
      + r.nismList + ' series to pick from and a certificate number';
  });

  await t.step('a wrong answer is refused with a message, and nothing is saved', async () => {
    const cases = [
      ['Personal Information', 'phone', '98765', /valid 10-digit mobile/i],
      ['Personal Information', 'personalEmail', 'ramesh@gmail', /valid email/i],
      ['Personal Information', 'emergencyName', 'R2D2', /letters, spaces and initials/i],
      ['Professional Information', 'officialMobile', '123456', /valid 10-digit mobile/i],
      ['Address', 'pincode', '56001', /6-digit PIN/i],
      ['Identity Documents', 'panNumber', 'ABCD1234F', /PAN/i],
      ['Identity Documents', 'aadhaarLast4', '123412341234', /Aadhaar/i],
      ['Identity Documents', 'pfUan', '12345', /exactly 12 digits/i],
      ['Identity Documents', 'esicNumber', '123456789', /exactly 10 digits/i],
      ['Certifications', 'arnNo', '123456', /ARN-/],
      ['Certifications', 'euinNo', '123456', /EUIN/],
      ['Bank Details', 'bankIfsc', 'SBIN1234', /IFSC/],
      ['Bank Details', 'bankAccountNumber', '12AB', /account number/i],
    ];
    const seen = [];
    for(const [group, k, bad, msg] of cases){
      await open();
      const before = await t.eval(k=>me()[k], k);
      await t.page.fill('#f_' + k, bad);
      const dialogs = t.dialogs.length;
      await card(group).getByRole('button', {name: 'Save ' + group}).click();
      await t.wait(250);
      const r = await t.eval(k=>({stored: me()[k],
        note: ((document.getElementById('fieldwrap_f_' + k) || {querySelector:()=>null}).querySelector('.field-error') || {}).textContent || ''}), k);
      const said = t.dialogs.slice(dialogs).join(' | ') + ' ' + r.note;
      if(r.stored !== before) throw new Error(k + ' saved the bad value "' + bad + '"');
      if(!msg.test(said)) throw new Error(k + ' said: ' + said);
      seen.push(k);
    }
    return seen.length + ' formats refused on save, each with its own message under the box';
  });

  await t.step('an emergency number with no name asks for the name', async () => {
    await open();
    await t.page.fill('#f_emergencyPhone', '9876543210');
    await t.page.fill('#f_emergencyName', '');
    const n = t.dialogs.length;
    await card('Personal Information').getByRole('button', {name: 'Save Personal Information'}).click();
    await t.wait(250);
    if(!t.dialogs.slice(n).some(d=>/emergency contact.s name/i.test(d)))
      throw new Error('it saved a number with nobody to reach: ' + t.dialogs.slice(n).join(' | '));
    return 'refused until the name is there';
  });

  await t.step('right answers save, normalised, and Aadhaar keeps only its last four', async () => {
    await open();
    const fill = {phone:'9876543210', personalEmail:'ramesh.kumar@gmail.com', emergencyName:'R. K. Sharma',
      emergencyPhone:'9123456780'};
    for(const [k, v] of Object.entries(fill)) await t.page.fill('#f_' + k, v);
    await t.eval(()=>{ const el = document.getElementById('f_emergencyRelation'); el.value = 'Mother';
      el.dispatchEvent(new Event('change', {bubbles:true})); });
    await card('Personal Information').getByRole('button', {name: 'Save Personal Information'}).click();
    await t.wait(400);
    await open();
    await t.page.fill('#f_panNumber', 'abcpe1234f');
    await t.page.fill('#f_aadhaarLast4', '2345 6789 0124');
    await t.page.fill('#f_pfUan', '123456789012');
    await t.page.fill('#f_esicNumber', '1234567890');
    /* a real Aadhaar check digit, worked out rather than remembered */
    const valid = await t.eval(()=>{
      for(let d = 0; d < 10; d++){ const n = '23456789012' + d; if(verhoeffOk(n)) return n; }
      return '';
    });
    await t.page.fill('#f_aadhaarLast4', valid.replace(/(\d{4})(?=\d)/g, '$1 '));
    await card('Identity Documents').getByRole('button', {name: 'Save Identity Documents'}).click();
    await t.wait(400);
    await open();
    await t.page.fill('#f_arnNo', 'arn-123456');
    await t.page.fill('#f_euinNo', 'E123456');
    await t.page.fill('#f_nismCert', 'NISM-Series-V-A');
    await card('Certifications').getByRole('button', {name: 'Save Certifications'}).click();
    await t.wait(400);
    const r = await t.eval(async ()=>{
      const u = me();
      const server = ((await sget('team')) || []).find(x=>x.id === u.id) || {};
      navigate('profile');
      return {pan: server.panNumber, aadhaar: server.aadhaarLast4, arn: server.arnNo, rel: server.emergencyRelation,
        phone: server.phone, shown: (document.getElementById('f_aadhaarLast4') || {}).value};
    });
    if(r.phone !== '9876543210' || r.rel !== 'Mother') throw new Error('personal details did not land: ' + JSON.stringify(r));
    if(r.pan !== 'ABCPE1234F') throw new Error('the PAN was stored as ' + r.pan);
    if(r.arn !== 'ARN-123456') throw new Error('the ARN was stored as ' + r.arn);
    if(r.aadhaar !== valid.slice(-4)) throw new Error('Aadhaar was stored as ' + r.aadhaar);
    if(r.shown !== 'XXXX XXXX ' + valid.slice(-4)) throw new Error('Aadhaar is shown as ' + r.shown);
    return 'PAN and ARN in capitals; Aadhaar checked whole, stored as ' + r.aadhaar + ' and shown as ' + r.shown;
  });

  t.section('a PIN fills the address, an IFSC the bank');

  await t.step('PIN 560001 fills city, state and country, and they stay editable', async () => {
    await open();
    await t.page.fill('#f_city', '');
    await t.page.fill('#f_pincode', '560001');
    await t.page.waitForFunction(()=>document.getElementById('f_city').value === 'Bengaluru', null, {timeout: 5000});
    const r = await t.eval(()=>({city: f_city.value, state: f_state.value, country: f_country.value,
      editable: !f_city.disabled && !f_city.readOnly,
      note: (document.querySelector('#fieldwrap_f_pincode .lookup-note') || {}).textContent || ''}));
    if(r.state !== 'Karnataka' || r.country !== 'India') throw new Error('filled ' + JSON.stringify(r));
    if(!r.editable) throw new Error('the city was locked');
    return r.city + ', ' + r.state + ', ' + r.country + ' — "' + r.note + '"';
  });

  await t.step('a PIN that is not on file says so', async () => {
    await t.page.fill('#f_pincode', '999999');
    await t.page.waitForFunction(()=>/not found/i.test((document.querySelector('#fieldwrap_f_pincode .lookup-note') || {}).textContent || ''),
      null, {timeout: 5000});
    return 'PIN code not found, under the box';
  });

  await t.step('IFSC SBIN0001234 fills the bank and branch; an unknown one says so', async () => {
    await open();
    await t.page.fill('#f_bankName', '');
    await t.page.fill('#f_bankIfsc', 'sbin0001234');
    await t.page.waitForFunction(()=>document.getElementById('f_bankName').value === 'State Bank of India', null, {timeout: 5000});
    const branch = await t.eval(()=>f_bankBranch.value);
    if(branch !== 'Indiranagar Branch') throw new Error('branch filled as ' + branch);
    await t.page.fill('#f_bankIfsc', 'HDFC0999999');
    await t.page.waitForFunction(()=>/IFSC not found/i.test((document.querySelector('#fieldwrap_f_bankIfsc .lookup-note') || {}).textContent || ''),
      null, {timeout: 5000});
    return 'State Bank of India, ' + branch + '; and "IFSC not found" for one that is not';
  });

  t.section('desktop notifications');

  await t.step('Enable asks the browser, and ENABLED only when it agrees', async () => {
    const r = await t.eval(async ()=>{
      const real = window.Notification;
      const shown = [];
      const fake = answer => { const F = function(title, o){ shown.push(title + ' — ' + (o && o.body || '')); this.close = ()=>{}; };
        F.permission = 'default'; F.requestPermission = async ()=>{ F.permission = answer; return answer; }; return F; };
      const out = {};
      window.Notification = fake('denied');
      await toggleDesktopNotifications();
      out.denied = !!me().desktopNotifEnabled;
      window.Notification = fake('granted');
      await toggleDesktopNotifications();
      out.granted = !!me().desktopNotifEnabled;
      out.badge = /ENABLED/.test(desktopNotifRowHtml(me())) && !/BLOCKED/.test(desktopNotifRowHtml(me()));
      /* a notification for this person arrives from elsewhere */
      DB.notifications.push({id: uid('NTF'), at: new Date().toISOString(), userId: currentUser,
        title: 'ZZ leave approved', body: 'Your leave was approved', kind: 'hr-leave-decided'});
      desktopNotifySweep();
      desktopNotifySweep();                     // once, not twice
      out.shown = shown.slice();
      await toggleDesktopNotifications();
      out.off = !!me().desktopNotifEnabled;
      window.Notification = real;
      return out;
    });
    if(r.denied) throw new Error('it was saved as on when the browser said no');
    if(!r.granted || !r.badge) throw new Error('it did not turn on when the browser said yes');
    if(r.shown.filter(x=>/ZZ leave approved/.test(x)).length !== 1)
      throw new Error('the notification was shown ' + JSON.stringify(r.shown));
    if(r.off) throw new Error('Disable did not turn it off');
    if(!t.dialogs.some(d=>/blocked/i.test(d))) throw new Error('a refusal was not explained');
    return 'refused → stays off with the reason; allowed → ENABLED; a new notification shows once; Disable turns it off';
  });

  t.section('two-step sign-in');
  /* the API refusing a page that has not finished signing in is the point */
  t.expectConsole(/401/);

  const lastCode = async (since) => {
    for(let i = 0; i < 30; i++){
      const m = t.mail.received.slice(since).reverse().find(x=>/verification code/i.test(x.subject));
      if(m) return (/(\d{6})/.exec(m.subject) || [])[1];
      await t.wait(150);
    }
    throw new Error('no code was emailed');
  };

  await t.step('it is off until a code comes back right', async () => {
    await open();
    await t.page.waitForFunction(()=>twoFactorState.loaded, null, {timeout: 5000});
    const before = await t.eval(()=>twoFactorState.enabled);
    if(before) throw new Error('it started on');
    const sent = t.mail.received.length;
    await t.eval(()=>twoFactorStart('enable'));
    const code = await lastCode(sent);
    const to = t.mail.received[t.mail.received.length - 1].to.join(',');
    if(to.toLowerCase() !== EMAIL) throw new Error('the code went to ' + to);
    await t.page.fill('#f_tfaCode', code === '000000' ? '111111' : '000000');
    await t.eval(()=>twoFactorVerify());
    const wrong = await t.eval(async ()=>({note: tfaNote.textContent,
      on: (await (await fetch('/api/me/2fa', {headers: apiHeaders()})).json()).enabled}));
    if(wrong.on || !/not right/i.test(wrong.note)) throw new Error('a wrong code: ' + JSON.stringify(wrong));
    await t.page.fill('#f_tfaCode', code);
    await t.eval(()=>twoFactorVerify());
    await t.wait(400);
    const r = await t.eval(async ()=>({on: (await (await fetch('/api/me/2fa', {headers: apiHeaders()})).json()).enabled,
      badge: /ENABLED/.test(twoFactorRowHtml()), simulated: /Simulated/.test(document.getElementById('content').innerHTML)}));
    if(!r.on || !r.badge) throw new Error('the right code did not turn it on');
    if(r.simulated) throw new Error('the page still calls it simulated');
    return 'a wrong code refused with tries left; the right one turns it on, and the card says ENABLED';
  });

  await t.step('signing in now needs the emailed code as well as the password', async () => {
    const page = t.page;
    await page.goto(t.base + '/logout', {waitUntil: 'domcontentloaded'});
    await page.fill('#email', EMAIL);
    await page.fill('#password', PASSWORD);
    const sent = t.mail.received.length;
    await Promise.all([page.waitForNavigation({waitUntil: 'domcontentloaded'}), page.click('button[type=submit]')]);
    if(!/\/login\/otp/.test(page.url())) throw new Error('the password alone went to ' + page.url());
    const gate = await page.evaluate(async ()=>(await fetch('/api/me/2fa')).status);
    if(gate !== 401) throw new Error('the API was open before the code (' + gate + ')');
    const code = await lastCode(sent);
    await page.fill('#code', code === '000000' ? '111111' : '000000');
    await Promise.all([page.waitForNavigation({waitUntil: 'domcontentloaded'}), page.click('button[type=submit]:not([formaction])')]);
    const wrong = await page.textContent('body');
    if(!/not right/i.test(wrong)) throw new Error('a wrong code was not refused');
    await page.fill('#code', code);
    await Promise.all([page.waitForNavigation({waitUntil: 'domcontentloaded'}), page.click('button[type=submit]:not([formaction])')]);
    await require('../lib/ready')(page);
    await page.waitForTimeout(500);
    const signedIn = await page.evaluate(async ()=>(await fetch('/api/me/2fa', {headers: apiHeaders()})).status);
    if(signedIn !== 200) throw new Error('the right code did not sign in (' + signedIn + ')');
    return 'password → code page; the API stays shut until the code; a wrong code refused; the right one signs in';
  });

  await t.step('turning it off takes a code too', async () => {
    await open();
    await t.page.waitForFunction(()=>twoFactorState.loaded, null, {timeout: 5000});
    const sent = t.mail.received.length;
    await t.eval(()=>twoFactorStart('disable'));
    const code = await lastCode(sent);
    await t.page.fill('#f_tfaCode', code);
    await t.eval(()=>twoFactorVerify());
    await t.wait(400);
    const on = await t.eval(async ()=>(await (await fetch('/api/me/2fa', {headers: apiHeaders()})).json()).enabled);
    if(on) throw new Error('it is still on');
    return 'off, with a code';
  });

  lookups.close();
});
