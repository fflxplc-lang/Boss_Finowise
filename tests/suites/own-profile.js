/* A PAGE ALLOW-LIST THAT TOOK AWAY SOMEBODY'S OWN RECORD.

   Narrowing an account to named pages is a real feature: a Senior
   Executive is given the twenty-eight screens he works and nothing
   else. What nobody meant is what came with it. The picker in Setup
   names pages from the rail, and neither My Profile nor the Dashboard
   is on the rail — so the moment one page was ticked, both of those
   closed, with nothing in Setup able to tick them back. The man could
   not open his own profile to put a phone number in it, and the
   refusal sent him to the Dashboard, which the same rule had shut.

   What this holds to: that the two personal pages are never closed by
   that list, while every other page on it still is; that a person may
   fill in their own details and the firm's record of them actually
   changes, on the server, not just on the screen; that the fields
   which say what an account IS — role, scope, status, sign-in email,
   employee id, reporting line — are text on that page and cannot be
   written from it even by a forged input; and that none of this opens
   anybody else's profile or a single Setup screen. */
const {suite} = require('../lib/harness');

const AS = `(id, fn) => { const was = currentUser; currentUser = id; try { return fn(); } finally { currentUser = was; } }`;

suite(async t => {
  await t.home();
  let who = null, boss = null, named = 0;

  await t.step('an account narrowed to named pages, as the firm has it', async () => {
    const r = await t.eval(async ()=>{
      const role = 'Senior Executive';
      if(roleList().indexOf(role) < 0){ DB.config.roles = roleList().concat([role]); await save('config'); }
      /* every page the rail offers, which is every page the picker in
         Setup can name — the twenty-eight-odd screens on his account */
      const pages = [].concat.apply([], NAV_GROUPS.map(g=>(g.items||[]).slice()));
      const boss = DB.team.find(x=>isAdmin(x)) || DB.team[0];
      const m = {id: uid('TM'), name:'ZZ Shubham Seth', role, email:'zzshubham@zz.in',
        status:'Active', scope:'own', branch:'Varanasi', parentUserId: boss.id,
        joinedAt:new Date().toISOString(), createdAt:new Date().toISOString(),
        employeeId:'EMP-ZZ-1', designation:'Senior Executive', pagePerms: pages,
        adminFlags: fullAdminFlags(false),
        perms:(()=>{ const p = fullPerms(false);
          ['LMS','CMS','RMS'].forEach(x=>['view','create','edit'].forEach(a=>{ p[x][a] = 1; }));
          return p; })()};
      DB.team.push(m);
      await save('team');
      return {who: m.id, boss: boss.id, named: pages.length};
    });
    who = r.who; boss = r.boss; named = r.named;
    if(named < 10) throw new Error('the fixture only named ' + named + ' pages');
    return named + ' page(s) named on the account, and neither "profile" nor "dashboard" among them '
      + '— the picker in Setup cannot name either';
  });

  t.section('the two pages that are his');

  await t.step('My Profile opens, and so does the Dashboard he would be sent to', async () => {
    const r = await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.who;
      const out = {};
      ['profile','dashboard'].forEach(v=>{
        navigate(v);
        out[v] = {landed: currentView,
          modal: ((document.querySelector('.modal')||{}).textContent||'').replace(/\s+/g,' ').slice(0,90)};
        closeModal();
      });
      out.allowed = {profile: pageOpenToMe('profile'), dashboard: pageOpenToMe('dashboard')};
      /* and the rule itself is untouched: a page that is NOT named is
         still refused, which is the whole point of the list */
      const m = DB.team.find(x=>x.id === a.who);
      const kept = m.pagePerms.slice();
      m.pagePerms = kept.filter(v=>v !== 'cms');
      navigate('cms');
      out.cms = {landed: currentView,
        said: ((document.querySelector('.modal')||{}).textContent||'').replace(/\s+/g,' ').slice(0,120)};
      closeModal();
      m.pagePerms = kept;
      currentUser = was; navigate('dashboard');
      return out;
    }, {who});
    if(r.profile.landed !== 'profile') throw new Error('My Profile still bounced to ' + r.profile.landed);
    if(r.profile.modal) throw new Error('it still refused: ' + r.profile.modal);
    if(r.dashboard.landed !== 'dashboard') throw new Error('the Dashboard bounced to ' + r.dashboard.landed);
    if(!r.allowed.profile || !r.allowed.dashboard) throw new Error('pageOpenToMe still says no');
    if(r.cms.landed === 'cms') throw new Error('a page left off the list opened anyway — the rule is gone');
    if(!/not one of the ones your account is allowed/.test(r.cms.said))
      throw new Error('an unnamed page did not say why: ' + r.cms.said);
    return 'My Profile and the Dashboard open with ' + named + ' pages named and neither of them on the list '
      + '— and a page taken off the list is still refused, with the reason';
  });

  t.section('filling in his own details');

  await t.step('the page offers his own fields and names what is still blank', async () => {
    const r = await t.eval((a)=>eval('(' + a.AS + ')')(a.who, ()=>{
      navigate('profile');
      const html = document.getElementById('content').innerHTML;
      const mine = profileMyGroups().map(p=>p[0]);
      const miss = profileMissing().map(x=>x.k);
      return {mine, miss,
        /* an input exists for a field that is his */
        phone: !!document.getElementById('f_phone'),
        pan: !!document.getElementById('f_panNumber'),
        arn: !!document.getElementById('f_arnNo'),
        bank: !!document.getElementById('f_bankAccountNumber'),
        /* and none exists for anything the firm decides */
        role: !!document.getElementById('f_role'),
        scope: !!document.getElementById('f_scope'),
        status: !!document.getElementById('f_status'),
        email: !!document.getElementById('f_email'),
        employeeId: !!document.getElementById('f_employeeId'),
        parent: !!document.getElementById('f_parentUserId'),
        /* what it says instead */
        saysRole: /administrator-controlled/.test(html),
        nudge: /detail\(s\) still to fill in/.test(html),
        shownRole: html.indexOf('Senior Executive') >= 0,
      };
    }), {AS, who});
    const locked = ['role','scope','status','email','employeeId','parent'].filter(k=>r[k]);
    if(locked.length) throw new Error('editable on his own profile: ' + locked.join(', '));
    if(!r.phone || !r.pan || !r.arn || !r.bank)
      throw new Error('his own details are not offered: ' + JSON.stringify(r));
    if(!r.saysRole) throw new Error('the page does not say which card is the administrator’s');
    if(!r.nudge) throw new Error('nothing tells him what is still missing');
    if(!r.miss.length) throw new Error('the fixture has nothing missing to fill in');
    return r.mine.length + ' section(s) of his own — ' + r.mine.join(', ') + ' — with '
      + r.miss.length + ' blank named; role, scope, status, sign-in email, employee id and the reporting '
      + 'line are text';
  });

  await t.step('he fills some in, presses Save, and the server has them', async () => {
    const r = await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.who;
      navigate('profile');
      const groups = profileMyGroups();
      const gi = groups.findIndex(p=>p[0] === 'Personal Information');
      const before = profileMissing().length;
      document.getElementById('f_phone').value = '9800011122';
      document.getElementById('f_personalEmail').value = 'shubham.personal@zz.in';
      document.getElementById('f_emergencyName').value = 'ZZ Next of Kin';
      await saveProfileSection(gi);
      const after = profileMissing().length;
      const said = (document.getElementById('content').textContent||'').replace(/\s+/g,' ');
      /* read it back off the store rather than off DB, because "saved"
         means the server has it, not that the page remembers it */
      const stored = (await sget('team') || []).find(x=>x.id === a.who) || {};
      const mem = DB.team.find(x=>x.id === a.who);
      const audit = (DB.auditLog||[]).filter(l=>l.recordId === a.who && /Profile Updated/.test(l.action));
      currentUser = was; navigate('dashboard');
      return {before, after, said: said.slice(0, 160), confirmed: /Personal Information saved/.test(said),
        stored: {phone: stored.phone, personalEmail: stored.personalEmail,
                 emergencyName: stored.emergencyName, role: stored.role, scope: stored.scope},
        mem: {phone: mem.phone}, audit: audit.length,
        lastAudit: audit.length ? (audit[audit.length-1].action + ' / '
          + ((audit[audit.length-1].details||[]).map(c=>c.field).join(', ') || 'nothing named')) : ''};
    }, {who});
    if(r.stored.phone !== '9800011122') throw new Error('the server still has ' + r.stored.phone);
    if(r.stored.personalEmail !== 'shubham.personal@zz.in') throw new Error('personal email not saved');
    if(r.stored.emergencyName !== 'ZZ Next of Kin') throw new Error('emergency contact not saved');
    if(r.stored.role !== 'Senior Executive' || r.stored.scope !== 'own')
      throw new Error('saving his own details moved something that is not his: '
        + r.stored.role + ' / ' + r.stored.scope);
    if(r.after !== r.before - 3) throw new Error('the count went ' + r.before + ' → ' + r.after);
    if(!r.confirmed) throw new Error('the page did not confirm the save: ' + r.said);
    if(!r.audit) throw new Error('nothing was written to the audit log');
    if(!/Personal Mobile/.test(r.lastAudit) || !/Personal Email/.test(r.lastAudit))
      throw new Error('the audit line does not say what changed: ' + r.lastAudit);
    return 'three details filled in, on the server and in the audit log (' + r.lastAudit + '); '
      + 'the nudge went ' + r.before + ' → ' + r.after + ', and role and scope are untouched';
  });

  await t.step('a forged input for an admin field is not written by that Save', async () => {
    const r = await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.who;
      navigate('profile');
      /* exactly what the Save reads for a field it owns, for one it does
         not: if the section saved whatever the page happens to hold, this
         would make him an Admin with the run of the firm */
      const box = document.createElement('div');
      box.innerHTML = '<input id="f_role" value="Admin"><input id="f_scope" value="all">'
        + '<input id="f_status" value="Inactive"><input id="f_employeeId" value="EMP-0001">';
      document.body.appendChild(box);
      const gi = profileMyGroups().findIndex(p=>p[0] === 'Personal Information');
      await saveProfileSection(gi);
      box.remove();
      const stored = (await sget('team') || []).find(x=>x.id === a.who) || {};
      currentUser = was; navigate('dashboard');
      return {role: stored.role, scope: stored.scope, status: stored.status, employeeId: stored.employeeId};
    }, {who});
    if(r.role !== 'Senior Executive' || r.scope !== 'own' || r.status !== 'Active'
       || r.employeeId !== 'EMP-ZZ-1')
      throw new Error('an admin field was written from My Profile: ' + JSON.stringify(r));
    return 'role, scope, status and employee id all unchanged — the Save writes the section’s own '
      + 'fields and nothing else';
  });

  t.section('and nobody else’s');

  await t.step('his own profile, not the firm’s people and not Setup', async () => {
    const r = await t.eval(async (a)=>{
      const was = currentUser; currentUser = a.who;
      const out = {setup: isSettingsVisible(), mine: maySeeMember(DB.team.find(x=>x.id === a.who)),
        boss: maySeeMember(DB.team.find(x=>x.id === a.boss)),
        teamEdit: can('Team','edit')};
      navigate('settings');
      out.settings = currentView; closeModal();
      /* Team Members is on his named list — it is a page of the rail,
         so the picker offers it — but the module permission behind it
         is the thing that actually shows people, and he has none. */
      navigate('teammembers');
      out.teammembers = currentView;
      out.teammembersSaid = (document.getElementById('content').textContent||'')
        .replace(/\s+/g,' ').trim().slice(0, 80);
      out.teammembersRows = document.querySelectorAll('#teamMembersTable tbody tr').length;
      out.teammembersAsk = /Request access/.test(document.getElementById('content').innerHTML || '');
      closeModal();
      /* and the page itself offers no second editor at all — the
         administrator's member form is reached where accounts are
         administered, not from somebody's own profile */
      navigate('profile');
      const html = document.getElementById('content').innerHTML;
      out.adminEditor = /Edit as administrator|openMemberForm/.test(html);
      out.otherProfile = /openUserProfile/.test(html);
      currentUser = was; navigate('dashboard');
      return out;
    }, {who, boss});
    if(r.setup) throw new Error('Setup is visible to him again');
    if(r.settings === 'settings') throw new Error('the Setup route opened');
    if(r.teammembersRows) throw new Error('the Team Members page listed ' + r.teammembersRows + ' people');
    /* The refusal is a wall with a way out now, not a grey line, so
       what is checked is that it refuses AND offers the door. */
    if(!/closed to you|does not have View/.test(r.teammembersSaid))
      throw new Error('Team Members said: ' + r.teammembersSaid);
    if(!r.teammembersAsk)
      throw new Error('Team Members refused without offering a way to ask');
    if(!r.mine) throw new Error('he cannot open his own record');
    if(r.boss) throw new Error('he can open the account above him');
    if(r.teamEdit) throw new Error('the fixture was given Team edit');
    if(r.adminEditor) throw new Error('the administrator’s member form is offered on My Profile');
    if(r.otherProfile) throw new Error('My Profile still opens a profile card by id');
    return 'his own record opens, the account above him does not, Setup is shut and Team Members lists '
      + 'nobody — and the page carries no editor but his own sections';
  });

  await t.step('an administrator sees their own page the same way, and loses nothing', async () => {
    const r = await t.eval(async (a)=>{
      navigate('profile');
      const html = document.getElementById('content').innerHTML;
      const out = {adminEditor: /Edit as administrator|openMemberForm/.test(html),
        groups: profileMyGroups().map(p=>p[0]).length,
        roleInput: !!document.getElementById('f_role'),
        pages: pageOpenToMe('cms') && pageOpenToMe('teammembers'),
        other: maySeeMember(DB.team.find(x=>x.id === a.who))};
      navigate('dashboard');
      return out;
    }, {who});
    if(r.adminEditor) throw new Error('My Profile still carries the member form for an Admin');
    if(r.roleInput) throw new Error('an Admin can edit their own role from My Profile');
    if(!r.groups) throw new Error('an Admin has no sections of their own to fill in');
    if(!r.pages || !r.other) throw new Error('an Admin lost something');
    return 'the Admin keeps every page and sees the page an executive sees — their own sections, '
      + 'no member form, and their own role still not a field on it';
  });
});
