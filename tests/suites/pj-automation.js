/* THE PARTNER JOURNEY'S LETTERS THAT NOBODY PRESSES A BUTTON FOR.

   Two days before a webinar every prospect registered for it is written
   to, twice a day, and 24 hours before it they get the joining link — sent
   by the server, so it happens with no CRM tab open. From six months
   before an onboarded partner's ARN or EUIN runs out, their RM's bell says
   so once a week and the partner is written to. And the prospect's own
   registration form, which the acknowledgement links to, works without an
   account and lands on their record.

   The moment is named rather than waited for: the run endpoint takes the
   time it should believe it is. */
const {suite} = require('../lib/harness');

suite({mail: true}, async t => {
  const run = at => t.eval(async at => {
    const r = await fetch('/api/partner-journey/run', {method:'POST', headers: Object.assign({'Content-Type':'application/json'}, apiHeaders()),
      body: JSON.stringify({at})});
    return r.json();
  }, at);
  const stored = key => t.eval(async key => (await (await fetch('/api/storage/' + key, {headers: apiHeaders()})).json()).value, key)
    .then(v => JSON.parse(v || '[]'));
  let web = null, ids = {};

  t.section('the session reminders');

  await t.step('prospects are registered for a webinar on 10 Dec at 7 PM', async () => {
    const r = await t.eval(async ()=>{
      const w = {id: uid('WEB'), title: 'ZZ Auto Webinar', date: '2026-12-10', time: '7:00 PM',
        joiningLink: 'https://meet.example.com/zz-session', createdAt: new Date().toISOString()};
      const other = {id: uid('WEB'), title: 'ZZ Other Webinar', date: '2027-03-01', time: '7:00 PM', createdAt: new Date().toISOString()};
      DB.partnerWebinars.push(w, other);
      const mk = (first, stage, extra) => {
        const p = Object.assign({id: uid('PPS'), firstName: first, lastName: 'Test', mobile: '98765' + String(Math.floor(Math.random()*90000)+10000),
          email: first.toLowerCase() + '@example.com', commChannel: 'Email', webinarId: w.id, assignedTo: currentUser,
          createdAt: new Date().toISOString()}, extra || {});
        initState('PPS', p); p.ppsStage = stage;
        DB.partnerProspects.push(p); return p.id;
      };
      const ids = {acked: mk('Anil', 'acknowledged'), fresh: mk('Bina', 'registered'),
        whats: mk('Chetan', 'acknowledged', {commChannel: 'WhatsApp'}), gone: mk('Dev', 'community'),
        elsewhere: mk('Esha', 'acknowledged', {webinarId: other.id})};
      await save('partnerWebinars'); await save('partnerProspects');
      return {w: w.id, ids};
    });
    web = r.w; ids = r.ids;
    return '5 prospects, 4 on this webinar';
  });

  await t.step('two days before, at 10 AM, the registered are reminded and the stage follows', async () => {
    t.mail.clear();
    const r = await run('2026-12-08T04:35:00Z');           // 10:05 in India
    await t.wait(300);
    const list = await stored('partnerProspects');
    const st = id => (list.find(p=>p.id===id)||{}).ppsStage;
    const got = t.mail.matching(/Reminder: ZZ Auto Webinar/);
    const comms = (await stored('communications')).filter(c=>c.module==='PPS' && c.label==='Session reminder (automatic)');
    if(got.length !== 3) throw new Error('expected 3 letters, got ' + got.length + ' ' + JSON.stringify(r));
    if(st(ids.acked) !== 'remindersSent' || st(ids.whats) !== 'remindersSent') throw new Error('stages ' + st(ids.acked) + '/' + st(ids.whats));
    if(st(ids.fresh) !== 'registered') throw new Error('a prospect nobody acknowledged was moved on');
    if(st(ids.gone) !== 'community' || comms.some(c=>c.recordId===ids.gone || c.recordId===ids.elsewhere)) throw new Error('wrote to someone not on this session');
    if(!comms.some(c=>c.channel==='WhatsApp' && c.recordId===ids.whats && c.status==='Not Sent')) throw new Error('the WhatsApp registration has no WhatsApp line');
    if(!/2 days/.test(got[0].text)) throw new Error('the letter should say how far off it is');
    return got.length + ' letters, ' + r.reminders.moved + ' moved to Reminders Sent, WhatsApp recorded as owed';
  });

  await t.step('the same slot is not sent twice', async () => {
    t.mail.clear();
    const r = await run('2026-12-08T05:30:00Z');
    if(t.mail.received.length || r.reminders.letters) throw new Error('sent again: ' + JSON.stringify(r));
    return 'nothing on a second run';
  });

  await t.step('the evening slot is the second of the day', async () => {
    t.mail.clear();
    await run('2026-12-08T12:35:00Z');                      // 18:05 in India
    const got = t.mail.matching(/Reminder: ZZ Auto Webinar/);
    if(got.length !== 3) throw new Error('expected 3 letters, got ' + got.length);
    return '3 more letters at 6 PM';
  });

  await t.step('24 hours before, the joining link goes and the stage follows', async () => {
    t.mail.clear();
    await run('2026-12-09T13:35:00Z');                      // 19:05 the day before
    await t.wait(300);
    const link = t.mail.matching(/joining link for ZZ Auto Webinar/i);
    const list = await stored('partnerProspects');
    const st = id => (list.find(p=>p.id===id)||{}).ppsStage;
    if(link.length !== 3) throw new Error('expected 3 joining links, got ' + link.length);
    if(!link[0].text.includes('https://meet.example.com/zz-session')) throw new Error('the letter does not carry the link');
    if(st(ids.acked) !== 'sessionDay') throw new Error('stage ' + st(ids.acked));
    return link.length + ' joining links, Session Day reached';
  });

  await t.step('once the session has started, nothing more goes', async () => {
    t.mail.clear();
    const r = await run('2026-12-10T14:00:00Z');
    if(t.mail.received.length) throw new Error(JSON.stringify(r));
    return 'quiet';
  });

  await t.step('email for PPS switched off holds the letter and says so', async () => {
    t.mail.clear();
    const r = await t.eval(async ()=>{
      const w = {id: uid('WEB'), title: 'ZZ Held Webinar', date: '2026-12-20', time: '19:00', createdAt: new Date().toISOString()};
      DB.partnerWebinars.push(w);
      const p = {id: uid('PPS'), firstName: 'Farah', email: 'farah@example.com', mobile: '9876511111', commChannel: 'Email',
        webinarId: w.id, createdAt: new Date().toISOString()};
      initState('PPS', p); p.ppsStage = 'acknowledged'; DB.partnerProspects.push(p);
      DB.config.mailModuleOff = Object.assign({}, DB.config.mailModuleOff, {PPS: 1});
      await save('partnerWebinars'); await save('partnerProspects'); await save('config');
      return p.id;
    });
    await run('2026-12-18T04:35:00Z');
    const held = (await stored('communications')).find(c=>c.recordId===r);
    await t.eval(async ()=>{ delete DB.config.mailModuleOff.PPS; await save('config'); });
    if(t.mail.received.length || !held || held.status !== 'Held') throw new Error(JSON.stringify(held));
    return 'Held: ' + held.statusNote.split('.')[0];
  });

  t.section('the prospect’s own form');

  let token = null;
  await t.step('the form opens on its token, filled with what is on file, and needs no sign-in', async () => {
    token = await t.eval(async id=>{
      const p = DB.partnerProspects.find(x=>x.id===id);
      p.ackFormToken = pjNewFormToken(); p.city = 'Pune';
      await save('partnerProspects');
      return p.ackFormToken;
    }, ids.acked);
    const res = await fetch(t.base + '/api/public/pps-form?token=' + encodeURIComponent(token));
    const d = await res.json();
    const page = await fetch(t.base + '/partner-form?pf=' + encodeURIComponent(token), {redirect: 'manual'});
    const bad = await fetch(t.base + '/api/public/pps-form?token=nottherightoneatallxx');
    if(!d.ok || d.values.firstName !== 'Anil' || d.values.city !== 'Pune') throw new Error(JSON.stringify(d));
    if(page.status !== 200) throw new Error('the page answered ' + page.status + ' without a sign-in');
    if(bad.status !== 404) throw new Error('a wrong token answered ' + bad.status);
    return 'Anil, Pune — page 200 signed out, a wrong token 404';
  });

  await t.step('what they send back is checked, and lands on the record', async () => {
    const post = answers => fetch(t.base + '/api/public/pps-form?token=' + encodeURIComponent(token), {method: 'POST',
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify({answers})}).then(r => r.json());
    const wrong = await post({firstName: 'Anil', mobile: '12345'});
    const ok = await post({firstName: 'Anil', lastName: 'Kumar', mobile: '9876543210', email: 'anil.k@example.com', city: 'Mumbai',
      qualification: 'MBA', interest: 'Helping families invest'});
    await t.wait(300);
    const p = (await stored('partnerProspects')).find(x=>x.id===ids.acked);
    const bell = (await stored('notifications')).find(n=>n.arg===ids.acked && /Registration form submitted/.test(n.title));
    if(wrong.ok) throw new Error('a 5-digit mobile was taken');
    if(!ok.ok || p.city !== 'Mumbai' || p.lastName !== 'Kumar' || !p.ackFormSubmittedAt || (p.ackForm.answers||{}).qualification !== 'MBA') throw new Error(JSON.stringify(p));
    if(!bell) throw new Error('the RM was not told');
    return 'refused a bad mobile; city now Mumbai, qualification kept, the RM’s bell rang';
  });

  t.section('ARN / EUIN expiry');

  let pid = null;
  await t.step('an onboarded partner whose ARN runs out in three months is flagged, once a week', async () => {
    t.mail.clear();
    const now = Date.now();
    pid = await t.eval(async ()=>{
      const until = new Date(Date.now() + 90 * 86400000).toISOString().slice(0,10);
      const far = new Date(Date.now() + 900 * 86400000).toISOString().slice(0,10);
      const p = {id: uid('PMS'), firstName: 'Gita', lastName: 'Shah', email: 'gita@example.com', assignedTo: currentUser,
        arn: 'ARN-998877', arnValidTo: until, euin: 'E998877', euinValidTo: far, createdAt: new Date().toISOString()};
      initState('PMS', p); p.pmsStage = 'onboarded';
      DB.pjPartners.push(p); await save('pjPartners');
      return p.id;
    });
    const first = await run(new Date(now).toISOString());
    const again = await run(new Date(now + 60000).toISOString());
    const nextWeek = await run(new Date(now + 8 * 86400000).toISOString());
    const bells = (await stored('notifications')).filter(n=>n.arg===pid && n.kind==='arnExpiry');
    const letters = t.mail.matching(/Your ARN expires/);
    const flagged = await t.eval(id=>{ navigate('pms'); return pjExpiring(DB.pjPartners.find(x=>x.id===id)).map(x=>x.what); }, pid);
    if(first.expiry.notified !== 1 || again.expiry.notified !== 0 || nextWeek.expiry.notified !== 1) throw new Error(JSON.stringify([first.expiry, again.expiry, nextWeek.expiry]));
    if(bells.length !== 2 || letters.length !== 2) throw new Error(bells.length + ' bells, ' + letters.length + ' letters');
    if(flagged.join() !== 'ARN') throw new Error('PMS flags ' + flagged.join());
    return 'ARN only (EUIN is years off): a bell and a letter this week, none on a rerun, again next week';
  });

  t.section('importing prospects');

  await t.step('PPS has Template, Import and Export, and an imported code fills its name', async () => {
    const r = await t.eval(()=>{
      DB.partnerReferrals.push({id: uid('REF'), code: 'MS-IMP01', name: 'Imran Sherpa'});
      const rec = {firstName: 'Hari', mobile: '9876522222', referralCode: 'ms-imp01'};
      impNormaliseRow('partnerProspects', rec, rec);
      return {doors: moduleIoActions('PPS').map(a=>a.label), rec};
    });
    if(['Template','Import','Export'].some(l=>!r.doors.includes(l))) throw new Error(r.doors.join());
    if(r.rec.referralName !== 'Imran Sherpa' || r.rec.source !== 'Master Sherpa') throw new Error(JSON.stringify(r.rec));
    return r.doors.join(' / ') + '; MS-IMP01 → ' + r.rec.referralName;
  });
});
