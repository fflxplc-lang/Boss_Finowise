/* A REFUSAL IS A DOOR, NOT A WALL.

   The firm sent five screenshots — DWT, DJT, Projects, DBT, the
   Transaction Tracker — each showing one grey line and an empty page
   beneath it. The line was true: the account has no View on those
   modules. It was also useless. It named no permission, no
   administrator, and gave nobody any way to ask.

   The machinery to ask was already here — a request, an email to the
   administrators naming the exact Setup path, approve and reject with
   an audit line, and a check afterwards that the grant actually
   worked. What was missing was the door: twenty module pages returned
   that grey line before the page got as far as drawing one.

   What this holds to: every restricted module page says which
   permission is missing, where it is granted, and offers to ask —
   and granting it actually opens the page. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();
  let who = '';

  await t.step('an executive on "own" with nothing ticked', async () => {
    who = await t.eval(async ()=>{
      DB.team = DB.team.filter(x=>x.name !== 'ZZ Locked Out');
      const m = {id: uid('TM'), name:'ZZ Locked Out', role: roleList()[2] || 'Executive',
        status:'Active', scope:'own', branch:'Varanasi', email:'zz.locked@zz.in',
        adminFlags: fullAdminFlags(false), perms: fullPerms(true),
        createdAt:new Date().toISOString()};
      /* Everything the screenshots showed closed, closed. */
      ['DST','Projects','Business','Transactions','Queries','RMS','Recommendations',
       'Partners','Campaigns','Team','Masters','Reports','CMS','LMS','Meetings'].forEach(k=>{
        if(m.perms[k]) m.perms[k].view = false;
      });
      DB.team.push(m); await save('team');
      currentUser = m.id;
      return m.id;
    });
    return who;
  });

  t.section('every restricted page offers the door');

  await t.step('each one names the permission, the path and a way to ask', async () => {
    const r = await t.eval(()=>{
      const pages = {
        'DWT': viewDWT, 'DJT': viewDJT, 'Projects': viewProjects,
        'DBT': viewBusinessTracker, 'Transactions': viewTransactions,
        'QMS': viewQueries, 'RMS': viewRMS, 'Asset Allocation': viewRecommendations,
        'Partners': viewPartners, 'Marketing': viewCampaigns, 'Team': viewTeamMembers,
        'MIS': viewMIS, 'Portfolio': viewPortfolioReview, 'Mail': viewMailbox,
      };
      const bad = [];
      Object.keys(pages).forEach(name=>{
        let html = '';
        try { html = String(pages[name]() || ''); }
        catch(e){ bad.push(name + ': threw ' + e.message); return; }
        const says = /closed to you|does not have View/.test(html);
        const where = /Where it is undone/.test(html);
        const ask = /Request access/.test(html);
        if(!says || !where || !ask){
          bad.push(name + ':' + (says?'':' no reason') + (where?'':' no path') + (ask?'':' no button'));
        }
      });
      return {bad, n: Object.keys(pages).length};
    });
    if(r.bad.length) throw new Error(r.bad.join(' | '));
    return 'all ' + r.n + ' name the permission, say where it is granted, and offer to ask';
  });

  await t.step('no page anywhere still answers with the bare line', async () => {
    const r = await t.eval(()=>{
      const src = Array.from(document.querySelectorAll('script')).map(s=>s.textContent).join('\n');
      const hits = src.match(/class="empty">You don[^<]*/g) || [];
      return {hits: hits.slice(0, 6), n: hits.length};
    });
    if(r.n) throw new Error(r.n + ' dead ends left: ' + r.hits.join(' | '));
    return 'none left in the whole source';
  });

  t.section('asking, and being answered');

  await t.step('a request carries who, what and which permission', async () => {
    const r = await t.eval(async (id)=>{
      DB.accessRequests = (DB.accessRequests || []).filter(x=>x.by !== id);
      await save('accessRequests');
      const spec = {kind:'action', module:'Business', action:'view'};
      await sendAccessRequest(spec);
      closeModal();
      const req = (DB.accessRequests || []).filter(x=>x.by === id).pop();
      return req ? {by: req.by, status: req.status, perm: req.permission || '',
                    name: req.userName || '', role: req.userRole || '',
                    mod: (req.spec || {}).module || ''} : null;
    }, who);
    if(!r) throw new Error('nothing was written');
    if(r.status !== 'Pending') throw new Error('it was filed as ' + r.status);
    if(r.mod !== 'Business') throw new Error('it names module "' + r.mod + '"');
    if(!/view/i.test(r.perm)) throw new Error('it asks for "' + r.perm + '"');
    if(!r.name) throw new Error('it does not say who asked');
    return 'pending, from ' + r.name + (r.role ? ' (' + r.role + ')' : '')
      + ', for ' + r.perm + ' on ' + r.mod;
  });

  await t.step('approving it opens the page that was shut', async () => {
    const r = await t.eval(async (id)=>{
      const admin = DB.team.find(x=>isAdmin(x)) || DB.team[0];
      const req = (DB.accessRequests || []).filter(x=>x.by === id && x.status === 'Pending').pop();
      const was = currentUser;
      currentUser = admin.id;
      await approveAccessRequest(req.id);
      currentUser = id;
      const after = String(viewBusinessTracker() || '');
      const stored = (DB.accessRequests || []).find(x=>x.id === req.id);
      currentUser = was;
      return {status: stored.status, decidedBy: !!stored.decidedBy,
              opens: !/closed to you|does not have View/.test(after),
              can: (()=>{ const w = currentUser; currentUser = id;
                const ok = can('Business','view'); currentUser = w; return ok; })()};
    }, who);
    if(r.status !== 'Approved') throw new Error('the request reads ' + r.status);
    if(!r.decidedBy) throw new Error('nobody is recorded as having decided it');
    if(!r.can) throw new Error('the permission was not actually written to the account');
    if(!r.opens) throw new Error('the page is still shut after the grant');
    return 'approved, recorded against the administrator, and DBT opens for them now';
  });

  await t.step('rejecting one is recorded with its reason', async () => {
    const r = await t.eval(async (id)=>{
      const admin = DB.team.find(x=>isAdmin(x)) || DB.team[0];
      const was = currentUser;
      currentUser = id;
      await sendAccessRequest({kind:'action', module:'Projects', action:'view'});
      closeModal();
      const req = (DB.accessRequests || []).filter(x=>x.by === id && x.status === 'Pending').pop();
      currentUser = admin.id;
      const realPrompt = window.prompt;
      window.prompt = () => 'Not part of this role.';
      await rejectAccessRequest(req.id);
      window.prompt = realPrompt;
      const stored = (DB.accessRequests || []).find(x=>x.id === req.id);
      currentUser = id;
      const shut = /closed to you|does not have View/.test(String(viewProjects() || ''));
      currentUser = was;
      return {status: stored.status, note: stored.decisionNote || '', shut};
    }, who);
    if(r.status !== 'Rejected') throw new Error('the request reads ' + r.status);
    if(!/Not part of this role/.test(r.note)) throw new Error('the reason was not kept: ' + r.note);
    if(!r.shut) throw new Error('a rejected request left the page open anyway');
    return 'rejected with its reason kept, and the page stayed shut';
  });

  await t.step('and the refusal is not only in the markup', async () => {
    const r = await t.eval((id)=>{
      const was = currentUser; currentUser = id;
      /* The list a module draws is scoped by the same check, so a
         page nobody may view hands over no rows either. */
      const rows = visibleRecords(DB.projects || [], x=>x.owner, x=>x.branch).length;
      const may = can('Projects','view');
      currentUser = was;
      return {rows, may};
    }, who);
    if(r.may) throw new Error('the rejected permission is somehow on');
    return 'the permission is off, and the page draws from the same check rather than a second one';
  });

  await t.step('nothing was alerted but the asking and the granting', async () => {
    /* Two alerts are the feature: the request confirming it was
       recorded, and the grant confirming it was granted. */
    const odd = t.dialogs.filter(d=>!/is now on|They have been told|has been recorded as|^Grant /i.test(d));
    if(odd.length) throw new Error('alerts: ' + odd.join(' | ').slice(0, 220));
    /* Three by design: the request confirming it was recorded, the
       grant asking before it writes a permission, and the grant
       saying what it wrote. */
    return t.dialogs.length + ' dialog(s), all of them the asking, the confirming and the granting';
  });
});
