/* ASKING FOR THE KEY, FROM THE DOOR THAT IS SHUT.

   "You do not have permission to move this record forward" used to be
   the end of it. Who could give the permission, where it is given, what
   it is even called — none of that was on the screen, so the next step
   was to find somebody in the office and describe a panel they cannot
   see, to an administrator who then has to guess which of two hundred
   and ten checkboxes was meant.

   So what is worth testing is not that a button exists. It is that the
   letter which goes out is enough to act on without asking a second
   question: the person, their address, the module, the one permission,
   and the route through Setup that grants that one thing — a route
   worked out per request and read from Setup itself, not one path
   written down and sent for everything. Then that asking twice sends
   one letter, and that granting it writes exactly what was asked for
   and nothing else. */
const {suite} = require('../lib/harness');

const AS = `(id, fn) => { const was = currentUser; currentUser = id; try { return fn(); } finally { currentUser = was; } }`;

suite({mail: true}, async t => {
  await t.home();
  await t.useMail();
  let who = null, admin = null;

  await t.step('somebody who cannot move a CMS record, and an administrator to ask', async () => {
    const r = await t.eval(async ()=>{
      const a = DB.team.find(x=>isAdmin(x));
      a.email = a.email || 'admin@example.in';
      const m = {id: uid('TM'), name:'ZZ Access Asker', role:(roleList().find(x=>x !== 'Admin') || 'Manager'),
        email:'zzasker@example.in', scope:'all', adminFlags:{},
        perms:{CMS:{view:1, edit:1}, LMS:{view:1}}, permsOff:{CMS:{changeStage:1}},
        createdAt:new Date().toISOString()};
      DB.team.push(m); await save('team');
      const c = {id: uid('CMS'), cmsName:'ZZ Access Client', cmsStage:'clientCreated', rmName: m.id};
      DB.clients.push(c); await save('clients');
      return {who: m.id, admin: a.id, adminMail: a.email, client: c.id};
    });
    who = r.who; admin = r.admin;
    const can = await t.eval((a)=>eval('(' + a.AS + ')')(a.who, ()=>can('CMS','changeStage')), {AS, who});
    if(can) throw new Error('the fixture is not actually restricted');
    return 'CMS stage changes turned off for ZZ Access Asker; the request would go to ' + r.adminMail;
  });

  t.section('from the door itself');

  await t.step('the read-only stage panel carries a way to ask', async () => {
    const r = await t.eval((a)=>eval('(' + a.AS + ')')(a.who, ()=>{
      const c = DB.clients.find(x=>/^ZZ Access Client$/.test(x.cmsName || ''));
      const html = blueprintWidget('CMS', c, {});
      return {readOnly: /Read-only/.test(html), asks: /openAccessRequest/.test(html),
        label: /Request access/.test(html)};
    }), {AS, who});
    if(!r.readOnly) throw new Error('the fixture is not read-only');
    if(!r.asks || !r.label) throw new Error('there is no way to ask from the panel itself');
    return 'the refusal and the request are in the same place';
  });

  await t.step('the dialog names the person, the permission and where it is granted', async () => {
    const r = await t.eval((a)=>eval('(' + a.AS + ')')(a.who, ()=>{
      openAccessRequest({kind:'action', module:'CMS', action:'changeStage'});
      const txt = (document.querySelector('.modal') || {}).textContent || '';
      return {txt: txt.replace(/\s+/g, ' '),
        hasUser: /ZZ Access Asker/.test(txt), hasAddress: /zzasker@example\.in/.test(txt),
        hasPerm: /CMS . Change stage|CMS · Change stage/.test(txt),
        hasAdmin: /admin@/.test(txt),
        hasPath: /Users & Access/.test(txt) && /Modules, one at a time/.test(txt),
        why: !!document.getElementById('accReqWhy')};
    }), {AS, who});
    if(!r.hasUser || !r.hasAddress) throw new Error('it does not say who is asking');
    if(!r.hasPerm) throw new Error('it does not name the permission');
    if(!r.hasAdmin) throw new Error('it does not say who it goes to');
    if(!r.hasPath) throw new Error('it does not show the path: ' + r.txt.slice(0, 300));
    if(!r.why) throw new Error('there is nowhere to say why');
    return 'who, what, to whom, and the route through Setup — before it is sent';
  });

  t.section('the letter');

  await t.step('one letter to the administrator, with everything needed to act on it', async () => {
    t.mail.clear();
    await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.who;
      try {
        openAccessRequest({kind:'action', module:'CMS', action:'changeStage'});
        document.getElementById('accReqWhy').value = 'The client is mine and the stage is where the work stops.';
        await sendAccessRequest({kind:'action', module:'CMS', action:'changeStage'});
      } finally { currentUser = was; }
    }, {who});
    await t.wait(700);
    const got = t.mail.matching(/Access request/i);
    if(!got.length) throw new Error('no letter was sent (' + t.mail.received.length + ' in the box)');
    const m = got[got.length - 1];
    const body = m.text || m.body || '';
    const want = {
      'the name': /ZZ Access Asker/, 'the address': /zzasker@example\.in/,
      'the module': /CMS/, 'the permission': /Change stage/,
      'the path': /Users & Access/, 'the panel section': /Modules, one at a time/,
      'what to tick': /tick "Change stage"/, 'the reference': /ACR-/,
      'the reason given': /where the work stops/,
      'when it was asked': /20\d\d|\d{4}/,
    };
    const missing = Object.keys(want).filter(k=>!want[k].test(body));
    if(missing.length) throw new Error('the letter is missing ' + missing.join(', ')
      + '\n---\n' + body.slice(0, 700));
    if(/\{\w+\}/.test(body)) throw new Error('a token was left unfilled: ' + (body.match(/\{\w+\}/) || [])[0]);
    const to = (m.to || []).join(',');
    if(!/admin@/.test(to)) throw new Error('it went to ' + to);
    return 'to ' + to + ', naming the person, the permission and the exact route to grant it';
  });

  await t.step('and it is recorded as Pending, with the administrator told inside BOSS too', async () => {
    const r = await t.eval((a)=>({
      rows: (DB.accessRequests || []).length,
      row: (DB.accessRequests || [])[0] || null,
      notified: DB.notifications.filter(n=>n.userId === a.admin && n.kind === 'accessRequest').length,
    }), {admin});
    if(r.rows !== 1) throw new Error(r.rows + ' request(s) recorded');
    if(r.row.status !== 'Pending') throw new Error('it reads ' + r.row.status);
    if(r.row.by !== who) throw new Error('it is filed against the wrong account');
    if(!r.row.path || !r.row.path.length) throw new Error('the path was not kept with it');
    if(r.row.mail.status !== 'Sent') throw new Error('the mail status reads ' + r.row.mail.status);
    if(!r.notified) throw new Error('no notification reached the administrator');
    const said = t.dialogs.map(String).join(' ');
    if(!/has been sent/i.test(said)) throw new Error('the person was not told: ' + said.slice(-160));
    return r.row.id + ' Pending, emailed and on the administrator’s bell, and the asker was told';
  });

  await t.step('asking again while it is waiting sends nothing twice', async () => {
    t.mail.clear();
    const r = await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.who;
      try {
        openAccessRequest({kind:'action', module:'CMS', action:'changeStage'});
        const txt = (document.querySelector('.modal') || {}).textContent || '';
        closeModal();
        return {says: /still waiting/i.test(txt), rows: (DB.accessRequests || []).length,
          chip: /Access requested/.test(accessRequestChip({kind:'action', module:'CMS', action:'changeStage'}))};
      } finally { currentUser = was; }
    }, {who});
    await t.wait(300);
    if(!r.says) throw new Error('it offered to send a second one');
    if(r.rows !== 1) throw new Error(r.rows + ' rows after asking twice');
    if(t.mail.received.length) throw new Error('a second letter went out');
    if(!r.chip) throw new Error('the door still shows an unasked "Request access"');
    return 'the second ask reads the first one back instead of repeating it';
  });

  t.section('a different lock, a different path');

  await t.step('a stage and a page are granted somewhere else, and the letter says so', async () => {
    const r = await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.who;
      try {
        const stage = getBlueprint('CMS').states[2].id;
        const sPath = accessGrantPath({kind:'stage', module:'CMS', stage}, me()).join(' | ');
        const pPath = accessGrantPath({kind:'page', view:'lng'}, me()).join(' | ');
        const mPath = accessGrantPath({kind:'module', module:'RMS'}, me()).join(' | ');
        const aPath = accessGrantPath({kind:'action', module:'CMS', action:'changeStage'}, me()).join(' | ');
        return {sPath, pPath, mPath, aPath,
          sWhat: accessWhat({kind:'stage', module:'CMS', stage}),
          pPerm: accessPermLabel({kind:'page', view:'lng'})};
      } finally { currentUser = was; }
    }, {who});
    if(!/Workflows and their stages/.test(r.sPath)) throw new Error('the stage path: ' + r.sPath);
    if(!/Sub-modules and pages/.test(r.pPath)) throw new Error('the page path: ' + r.pPath);
    if(!/Module access/.test(r.mPath)) throw new Error('the module path: ' + r.mPath);
    if(r.sPath === r.pPath || r.pPath === r.mPath || r.mPath === r.aPath)
      throw new Error('two different locks produced the same path');
    if(!/Lead Nurture Group/.test(r.pPerm)) throw new Error('the page is not named: ' + r.pPerm);
    return 'four kinds of lock, four routes — each read from the Setup registry, none written into the letter';
  });

  await t.step('a page the router turns away offers the same thing', async () => {
    const r = await t.eval(async (a)=>{
      const m = DB.team.find(x=>x.id === a.who);
      m.pagePerms = ['cms'];
      await save('team');
      const was = currentUser; currentUser = a.who;
      try {
        navigate('lng');
        const txt = (document.querySelector('.modal') || {}).textContent || '';
        const offers = /openAccessRequest/.test((document.querySelector('.modal') || {}).innerHTML || '');
        closeModal();
        return {view: currentView, txt: txt.replace(/\s+/g, ' ').slice(0, 200), offers};
      } finally {
        currentUser = was; m.pagePerms = []; await save('team');
      }
    }, {who});
    if(r.view !== 'dashboard') throw new Error('the page opened anyway');
    if(!r.offers) throw new Error('the refusal does not offer to ask: ' + r.txt);
    return 'turned away to the Dashboard, with the way to ask on the same message';
  });

  t.section('answering it');

  await t.step('granting it writes exactly the permission that was asked for', async () => {
    const r = await t.eval(async (a)=>{
      const id = (DB.accessRequests || [])[0].id;
      await approveAccessRequest(id);
      const m = DB.team.find(x=>x.id === a.who);
      const was = currentUser; currentUser = a.who;
      const out = {status: (DB.accessRequests || [])[0].status,
        may: can('CMS','changeStage'), lms: can('LMS','changeStage'),
        off: JSON.stringify(m.permsOff || {}),
        told: DB.notifications.some(n=>n.userId === a.who && /approved/i.test(n.title || '')),
        otherPerms: JSON.stringify(m.perms.LMS)};
      currentUser = was;
      return out;
    }, {who});
    if(r.status !== 'Approved') throw new Error('it reads ' + r.status);
    if(!r.may) throw new Error('the permission was not actually granted');
    if(/changeStage/.test(r.off)) throw new Error('the deny is still on the account: ' + r.off);
    if(!r.told) throw new Error('the person who asked was not told');
    if(r.otherPerms !== JSON.stringify({view:1})) throw new Error('something else was granted too: ' + r.otherPerms);
    return 'CMS stage changes on, nothing else touched, and the asker told';
  });

  await t.step('a grant that would not work says so, and can open the module too', async () => {
    const r = await t.eval(async (a)=>{
      /* the firm's case: the module is closed to the role, so a tick on
         the account reaches nothing */
      const t2 = DB.team.find(x=>x.id === a.who);
      DB.config.moduleRoles = {RMS:['Admin']};
      await save('config');
      const was = currentUser; currentUser = a.who;
      await sendAccessRequest({kind:'action', module:'RMS', action:'create'});
      currentUser = was;
      const req = (DB.accessRequests || []).find(x=>x.spec && x.spec.module === 'RMS' && x.status === 'Pending');
      /* first: approve it and decline to open the module */
      let said = '';
      const oldC = window.confirm, oldA = window.alert;
      window.confirm = m2 => !/Open RMS to/.test(m2);          // yes to the grant, no to the module
      window.alert = m2 => { said = m2; };
      try { await approveAccessRequest(req.id); } finally { window.confirm = oldC; window.alert = oldA; }
      const stillStuck = {ticked: !!(t2.perms.RMS && t2.perms.RMS.create),
        works: accessRequestWorks(t2, {kind:'action', module:'RMS', action:'create'}), said};
      /* the screen says it too */
      navigate('settings', 'accessrequests');
      const screen = document.getElementById('content').textContent.replace(/\s+/g, ' ');
      /* now open the module, the way the dialog offered */
      await toggleModuleRole('RMS', roleOf(t2), true);
      const after = accessRequestWorks(t2, {kind:'action', module:'RMS', action:'create'});
      DB.config.moduleRoles = {}; await save('config');
      navigate('dashboard');
      return {stillStuck, after, screenSays: /granted, and still blocked/.test(screen)};
    }, {who});
    if(!r.stillStuck.ticked) throw new Error('the permission was not written at all');
    if(r.stillStuck.works) throw new Error('the fixture is not actually blocked by the module');
    if(!/DOES NOT WORK YET/.test(r.stillStuck.said))
      throw new Error('it claimed success: ' + String(r.stillStuck.said).slice(0, 160));
    if(!/closed to the/.test(r.stillStuck.said))
      throw new Error('it did not name what is in the way: ' + String(r.stillStuck.said).slice(0, 200));
    if(!r.screenSays) throw new Error('the Access Requests screen still reads as a clean Approved');
    if(!r.after) throw new Error('opening the module to the role did not make it work');
    return 'approved, checked as them, and told plainly that it does not work yet \u2014 with the rule that '
      + 'is blocking it named, and the offer to open the module as part of granting';
  });

  await t.step('refusing one says so, with the reason, and asks nothing of the person', async () => {
    const r = await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.who;
      try { await sendAccessRequest({kind:'action', module:'CMS', action:'delete'}); }
      finally { currentUser = was; }
      const req = (DB.accessRequests || []).find(x=>x.spec && x.spec.action === 'delete');
      const old = window.prompt;
      window.prompt = ()=>'Deleting a client is an administrator’s job here.';
      try { await rejectAccessRequest(req.id); } finally { window.prompt = old; }
      const after = (DB.accessRequests || []).find(x=>x.id === req.id);
      const m = DB.team.find(x=>x.id === a.who);
      const wasU = currentUser; currentUser = a.who;
      const may = can('CMS','delete');
      currentUser = wasU;
      return {status: after.status, note: after.decisionNote, may,
        told: DB.notifications.some(n=>n.userId === a.who && /not granted/i.test(n.title || '')),
        perms: JSON.stringify(m.perms.CMS)};
    }, {who});
    if(r.status !== 'Rejected') throw new Error('it reads ' + r.status);
    if(!/administrator/.test(r.note || '')) throw new Error('the reason was not kept: ' + r.note);
    if(r.may) throw new Error('refusing it granted it');
    if(!r.told) throw new Error('the person was not told');
    return 'Rejected with the reason, nothing granted, and the person told what was said';
  });

  await t.step('the screen shows them, and only to somebody who may answer them', async () => {
    const r = await t.eval((a)=>{
      navigate('settings', 'accessrequests');
      const mine = document.getElementById('content').textContent;
      const was = currentUser; currentUser = a.who;
      const theirs = renderSettingsAccessRequests();
      currentUser = was;
      navigate('dashboard');
      return {lists: /ZZ Access Asker/.test(mine), approved: /Approved/.test(mine),
        rejected: /Rejected/.test(mine), shut: /Manage Users or Manage Permissions/.test(theirs)};
    }, {who});
    if(!r.lists) throw new Error('the screen does not list the requests');
    if(!r.approved || !r.rejected) throw new Error('the statuses are not on it');
    if(!r.shut) throw new Error('somebody who cannot manage access can open the screen');
    return 'both requests on one screen with their status, and shut to everybody else';
  });
});
