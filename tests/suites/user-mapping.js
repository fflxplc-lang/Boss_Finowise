/* ONE PERSON, TWO DEPARTMENTS, TWO MANAGERS.

   Department was a line of free text on the account and Reporting
   Manager was one id. Neither survives contact with how a firm
   actually works: somebody splits their week between Sales and
   Operations, and reports to the Branch Head for attendance and to the
   Product Head for the work. Typed into one box, "Sales / Ops" is a
   string nothing can count, and the second manager is not written down
   at all.

   Both are lists now, and the departments come from a master an
   administrator keeps in Setup rather than from whatever each person
   typed. Ids are stored, so a rename cannot orphan a mapping; names
   are shown, so nobody has to read an id.

   WHAT MATTERS MOST HERE IS WHAT DID NOT CHANGE. parentUserId is still
   the one reporting line visibility walks — it is kept as managerIds[0]
   so the two can never disagree — and a second manager grants exactly
   nothing. A department grants nothing either. That is tested below
   more carefully than any of the rest, because it is the part that
   would be a security hole rather than a bug. */
const {suite} = require('../lib/harness');

const SETUP = `async () => {
  DB.config.departments = (deptAll() || []).filter(d=>!/^ZZ /.test(d.name)).concat([
    {id:'DEP-ZZS', name:'ZZ Sales',      active:true,  createdAt:new Date().toISOString()},
    {id:'DEP-ZZO', name:'ZZ Operations', active:true,  createdAt:new Date().toISOString()},
    {id:'DEP-ZZX', name:'ZZ Wound Down', active:false, createdAt:new Date().toISOString()}]);
  await save('config');
  const mk = n => { const m = {id:uid('TM'), name:n, role:roleList()[2]||'Executive', status:'Active',
    scope:'own', branch:DB.config.branches[0], email:n.replace(/\\s+/g,'.').toLowerCase()+'@zz.in',
    adminFlags: fullAdminFlags(false), perms: fullPerms(true), createdAt:new Date().toISOString()};
    DB.team.push(m); return m; };
  const head = mk('ZZ Branch Head'), prod = mk('ZZ Product Head'), exec = mk('ZZ Split Exec');
  await save('team');
  setUserDepartments(exec, ['DEP-ZZS','DEP-ZZO']);
  setUserManagers(exec, [head.id, prod.id]);
  await save('team');
  return {head: head.id, prod: prod.id, exec: exec.id};
}`;

suite(async t => {
  await t.home();
  let ids = null;

  await t.step('a central list in Setup, with add, rename and deactivate', async () => {
    const r = await t.eval(async ()=>{
      const n0 = deptAll().length;
      document.body.insertAdjacentHTML('beforeend', '<input id="newDeptName" value="ZZ Temp Dept">');
      await addDepartment();
      const made = deptIdByName('ZZ Temp Dept');
      const d = deptById(made);
      d.name = 'ZZ Temp Renamed'; await save('config');     // rename() prompts; the write is the same
      await toggleDepartment(made);
      const off = deptById(made).active;
      const inPicker = deptActive().some(x=>x.id === made);
      await removeDepartment(made);
      const gone = !deptById(made);
      const el = document.getElementById('newDeptName'); if(el) el.remove();
      return {n0, made: !!made, off, inPicker, gone, now: deptAll().length};
    });
    if(!r.made) throw new Error('Add Department did not add one');
    if(r.off !== false) throw new Error('Deactivate left it active');
    if(r.inPicker) throw new Error('a deactivated department is still offered in the picker');
    if(!r.gone) throw new Error('Delete left it behind');
    if(r.now !== r.n0) throw new Error('the list did not come back to where it started');
    return 'added, renamed, deactivated out of the picker, and deleted when nobody was in it';
  });

  await t.step('one account in two departments and reporting to two people', async () => {
    const r = await t.eval(async (a)=>{
      ids = await eval('(' + a.SETUP + ')')();
      const exec = DB.team.find(x=>x.id === ids.exec);
      return {ids,
        depts: userDepartmentNames(exec), mgrs: userManagerNames(exec),
        legacy: exec.department, primary: exec.parentUserId,
        inSales: membersInDepartment('DEP-ZZS').map(x=>x.name),
        inOps: membersInDepartment('DEP-ZZO').map(x=>x.name),
        toHead: membersReportingTo(ids.head).map(x=>x.name),
        toProd: membersReportingTo(ids.prod).map(x=>x.name)};
    }, {SETUP});
    ids = r.ids;
    if(JSON.stringify(r.depts) !== '["ZZ Sales","ZZ Operations"]')
      throw new Error('the departments read ' + JSON.stringify(r.depts));
    if(JSON.stringify(r.mgrs) !== '["ZZ Branch Head","ZZ Product Head"]')
      throw new Error('the managers read ' + JSON.stringify(r.mgrs));
    if(r.primary !== ids.head) throw new Error('the primary manager is not the first one picked');
    if(r.legacy !== 'ZZ Sales') throw new Error('the old single field reads "' + r.legacy + '"');
    if(r.inSales.indexOf('ZZ Split Exec') < 0 || r.inOps.indexOf('ZZ Split Exec') < 0)
      throw new Error('a department-wise list does not find somebody in two departments');
    if(r.toHead.indexOf('ZZ Split Exec') < 0 || r.toProd.indexOf('ZZ Split Exec') < 0)
      throw new Error('a manager-wise list does not find somebody with two managers');
    return 'ZZ Sales + ZZ Operations, reporting to the Branch Head (primary) and the Product Head, '
      + 'and found by both counts';
  });

  await t.step('a second manager grants nothing — the scope still walks one line', async () => {
    const r = await t.eval((a)=>({
      headSees: userDescendants(a.head).map(x=>x.name),
      prodSees: userDescendants(a.prod).map(x=>x.name),
      /* and the record scope itself, which is what would actually leak */
      prodScope: (()=>{ const was = currentUser; currentUser = a.prod;
        const m = DB.team.find(x=>x.id === a.prod); m.scope = 'team';
        const n = visibleRecords(DB.leads.filter(l=>l.assignedTo === a.exec),
          l=>l.assignedTo, l=>l.branch).length;
        currentUser = was; return n; })(),
      headScope: (()=>{ const was = currentUser; currentUser = a.head;
        const m = DB.team.find(x=>x.id === a.head); m.scope = 'team';
        const n = visibleRecords(DB.leads.filter(l=>l.assignedTo === a.exec),
          l=>l.assignedTo, l=>l.branch).length;
        currentUser = was; return n; })(),
      planted: (()=>{ const now = new Date().toISOString();
        const l = {id: uid('LMS'), firstName:'ZZ Mapped', lastName:'Lead', assignedTo: a.exec,
          branch: DB.config.branches[0], createdAt: now};
        initState('LMS', l); DB.leads.push(l); return 1; })(),
    }), ids);
    if(r.headSees.indexOf('ZZ Split Exec') < 0)
      throw new Error('the primary manager lost sight of their own report');
    if(r.prodSees.indexOf('ZZ Split Exec') >= 0)
      throw new Error('the SECOND manager was handed the reporting line — a mapping became a grant');
    return 'the primary manager has them in their chain and the second does not; a mapping is a '
      + 'record of who somebody is, not a key to anything';
  });

  await t.step('and a record owned by them reaches the primary only', async () => {
    const r = await t.eval((a)=>{
      const count = who => { const was = currentUser; currentUser = who;
        const m = DB.team.find(x=>x.id === who); m.scope = 'team';
        const n = visibleRecords(DB.leads.filter(l=>l.firstName === 'ZZ Mapped'),
          l=>l.assignedTo, l=>l.branch).length;
        currentUser = was; return n; };
      return {head: count(a.head), prod: count(a.prod)};
    }, ids);
    if(r.head !== 1) throw new Error('the primary manager cannot see their report’s lead');
    if(r.prod !== 0) throw new Error('the second manager can see a lead the mapping must not reach');
    return 'the primary sees the lead, the second manager sees none — on "their team" scope, which is '
      + 'the one that would have leaked';
  });

  await t.step('a ring is refused, and so is reporting to yourself', async () => {
    const r = await t.eval((a)=>({
      ring: managerPickProblem(a.head, [a.exec]),
      self: managerPickProblem(a.exec, [a.exec]),
      ghost: managerPickProblem(a.exec, ['TM-NOBODY']),
      fine: managerPickProblem(a.exec, [a.head, a.prod]),
      deep: (()=>{ /* exec → head is already there; head → prod → exec would close it */
        const prod = DB.team.find(x=>x.id === a.prod);
        setUserManagers(prod, [a.exec]);
        const out = managerPickProblem(a.head, [a.prod]);
        setUserManagers(prod, []);
        return out; })(),
    }), ids);
    if(!/ring/.test(r.ring)) throw new Error('a direct ring was allowed: "' + r.ring + '"');
    if(!/themselves/.test(r.self)) throw new Error('reporting to yourself was allowed');
    if(!/no longer on the team/.test(r.ghost)) throw new Error('an id nobody holds was allowed');
    if(r.fine) throw new Error('a sound pick was refused: ' + r.fine);
    if(!/ring/.test(r.deep)) throw new Error('a ring two edges long was allowed: "' + r.deep + '"');
    return 'self, a direct ring, a ring through somebody else and a ghost id all refused with the reason';
  });

  await t.step('the list filters, counts and exports by either of them', async () => {
    const r = await t.eval(async (a)=>{
      navigate('teammembers');
      const sees = () => filteredTeamMembers().map(x=>x.name);
      tmFilters().department = 'DEP-ZZO';
      const byDept = sees();
      tmFilters().department = '';
      tmFilters().manager = a.prod;
      const byMgr = sees();
      tmFilters().manager = '';
      const exec = DB.team.find(x=>x.id === a.exec);
      return {byDept, byMgr,
        csvDept: exportCellFor(exec, 'departmentNames'),
        csvMgr: exportCellFor(exec, 'reportingManagers'),
        shaped: (()=>{ const src = exportSource('team');
          const row = exportRows(src).find(x=>x.id === a.exec) || {};
          return {d: row.departmentNames, m: row.reportingManagers}; })()};
    }, ids);
    if(r.byDept.indexOf('ZZ Split Exec') < 0)
      throw new Error('filtering on the SECOND department does not find them');
    if(r.byMgr.indexOf('ZZ Split Exec') < 0)
      throw new Error('filtering on the SECOND manager does not find them');
    if(r.csvDept !== 'ZZ Sales, ZZ Operations') throw new Error('the export column reads "' + r.csvDept + '"');
    if(r.csvMgr !== 'ZZ Branch Head, ZZ Product Head') throw new Error('the manager column reads "' + r.csvMgr + '"');
    if(r.shaped.d !== r.csvDept || r.shaped.m !== r.csvMgr)
      throw new Error('Setup’s export writes something different: ' + JSON.stringify(r.shaped));
    return 'found by the second department and the second manager; both columns export as names';
  });

  await t.step('an import reads them as names and lands them as a list', async () => {
    const r = await t.eval((a)=>{
      const f = bulkFieldsFor('Team');
      const dep = f.find(x=>x.k === 'departments'), mgr = f.find(x=>x.k === 'managerIds');
      if(!dep || !mgr) return {missing: true};
      const good = mapImpCoerce(dep, 'ZZ Operations, ZZ Sales');
      const part = mapImpCoerce(dep, 'ZZ Sales, ZZ Nowhere');
      const people = mapImpCoerce(mgr, 'ZZ Product Head, ZZ Branch Head');
      /* and a row written through the importer's own normaliser */
      const rec = {id: uid('TM'), name:'ZZ Imported'};
      DB.team.push(rec);
      impNormaliseRow('team', rec, {departments: good, managerIds: people});
      const out = {good, part, people, landed: userDepartmentNames(rec),
        landedMgrs: userManagerNames(rec), primary: rec.parentUserId === a.prod,
        legacy: rec.department,
        why: mapImpRowIssues('team', rec, dep, part).map(x=>x.why).join(' ')};
      DB.team = DB.team.filter(x=>x.id !== rec.id);
      return out;
    }, ids);
    if(r.missing) throw new Error('the Team import template has no department or manager column');
    if(JSON.stringify(r.good) !== '["DEP-ZZO","DEP-ZZS"]')
      throw new Error('two department names read as ' + JSON.stringify(r.good));
    if(!r.part || !r.part.__bad) throw new Error('a name nothing matches was accepted silently');
    if(!/ZZ Nowhere/.test(r.why)) throw new Error('it does not name the one it could not match: ' + r.why);
    if(JSON.stringify(r.landed) !== '["ZZ Operations","ZZ Sales"]')
      throw new Error('the imported row landed ' + JSON.stringify(r.landed));
    if(!r.primary) throw new Error('the first manager named is not the primary on the imported row');
    if(r.legacy !== 'ZZ Operations') throw new Error('the old single field was not kept in step');
    return 'names in, ids on the record, the first manager primary, and one BOSS has never heard of '
      + 'named rather than swallowed';
  });

  await t.step('a rename keeps everybody in it, and a deactivation does too', async () => {
    const r = await t.eval(async (a)=>{
      const exec = DB.team.find(x=>x.id === a.exec);
      const d = deptById('DEP-ZZS');
      d.name = 'ZZ Sales & Advisory';
      (DB.team || []).forEach(t=>{ if(userDepartments(t)[0] === 'DEP-ZZS') t.department = d.name; });
      await save('config'); await save('team');
      const afterRename = {in: userDepartments(exec).indexOf('DEP-ZZS') >= 0,
        names: userDepartmentNames(exec), legacy: exec.department};
      deptById('DEP-ZZO').active = false;
      await save('config');
      const afterOff = {in: userDepartments(exec).indexOf('DEP-ZZO') >= 0,
        names: userDepartmentNames(exec),
        offered: deptActive().some(x=>x.id === 'DEP-ZZO'),
        counted: membersInDepartment('DEP-ZZO').length};
      deptById('DEP-ZZO').active = true; d.name = 'ZZ Sales';
      (DB.team || []).forEach(t=>{ if(userDepartments(t)[0] === 'DEP-ZZS') t.department = 'ZZ Sales'; });
      await save('config'); await save('team');
      return {afterRename, afterOff};
    }, ids);
    if(!r.afterRename.in) throw new Error('a rename dropped somebody out of the department');
    if(r.afterRename.names[0] !== 'ZZ Sales & Advisory') throw new Error('the new name is not shown');
    if(r.afterRename.legacy !== 'ZZ Sales & Advisory') throw new Error('the old single field kept the old name');
    if(!r.afterOff.in) throw new Error('deactivating threw somebody out of the department');
    if(r.afterOff.offered) throw new Error('a deactivated department is still offered');
    if(!r.afterOff.counted) throw new Error('a deactivated department stopped counting its people');
    return 'a rename follows the mapping and the display; a deactivation leaves everybody where they '
      + 'are and only stops it being chosen again';
  });

  await t.step('and assigning either is an administrator’s to do', async () => {
    const r = await t.eval((a)=>{
      const was = currentUser;
      currentUser = a.exec;                                   // no Manage Users
      const asExec = {may: mayMapPeople(),
        fields: teamMemberFieldGroups(a.exec)['Professional Information']
          .filter(f=>f.k === 'departments' || f.k === 'managerIds').map(f=>f.k + ':' + !!f.readOnly)};
      currentUser = was;
      const asAdmin = {may: mayMapPeople(),
        fields: teamMemberFieldGroups(a.exec)['Professional Information']
          .filter(f=>f.k === 'departments' || f.k === 'managerIds').map(f=>f.k + ':' + !!f.readOnly)};
      return {asExec, asAdmin};
    }, ids);
    if(r.asExec.may) throw new Error('somebody without Manage Users may map people');
    if(r.asExec.fields.join(' ') !== 'departments:true managerIds:true')
      throw new Error('the fields are editable to them: ' + r.asExec.fields.join(' '));
    if(!r.asAdmin.may) throw new Error('an administrator may not map people');
    if(r.asAdmin.fields.join(' ') !== 'departments:false managerIds:false')
      throw new Error('they are read-only to an administrator: ' + r.asAdmin.fields.join(' '));
    return 'read-only without Manage Users, editable with it';
  });

  t.section('the list a firm starts from');

  await t.step('a firm with no departments at all is given five to start', async () => {
    const r = await t.eval(async ()=>{
      const wasCfg = JSON.parse(JSON.stringify(DB.config.departments || []));
      const wasTeam = DB.team.map(x=>({id:x.id, d:(x.departments||[]).slice(), n:x.department||''}));
      DB.config.departments = [];
      DB.team.forEach(x=>{ x.departments = []; x.department = ''; });
      await save('config'); await save('team');
      await healDepartments();
      const made = deptAll().map(d=>d.name);
      /* And a firm that already has one keeps exactly what it has. */
      DB.config.departments = [{id:'DEP-ONLY', name:'ZZ The only one', active:true}];
      await save('config');
      await healDepartments();
      const kept = deptAll().map(d=>d.name);
      DB.config.departments = wasCfg;
      wasTeam.forEach(w=>{ const x = DB.team.find(y=>y.id===w.id); if(x){ x.departments = w.d; x.department = w.n; } });
      await save('config'); await save('team');
      return {made, kept, starter: DEPARTMENT_STARTER.slice()};
    });
    if(r.made.join(',') !== r.starter.join(','))
      throw new Error('an empty firm was given ' + (r.made.join(', ') || 'nothing'));
    if(r.kept.join(',') !== 'ZZ The only one')
      throw new Error('a firm with its own list had the starter list pushed onto it: ' + r.kept.join(', '));
    return r.made.join(' · ') + ' — and a firm with its own list keeps it';
  });

  await t.step('Setup offers whatever is missing from it, and adds only that', async () => {
    const r = await t.eval(async ()=>{
      const was = JSON.parse(JSON.stringify(DB.config.departments || []));
      DB.config.departments = [{id:'DEP-KEEP', name:'Admin', active:true},
                               {id:'DEP-OWN',  name:'ZZ Something of our own', active:true}];
      await save('config');
      const missing = departmentsMissingFromStarter();
      const offered = renderSettingsDepartments().indexOf('addStarterDepartments()') >= 0;
      await addStarterDepartments();
      const after = deptAll().map(d=>d.name);
      const none = departmentsMissingFromStarter();
      const gone = renderSettingsDepartments().indexOf('addStarterDepartments()') >= 0;
      DB.config.departments = was; await save('config');
      return {missing, offered, after, none, gone};
    });
    if(!r.offered) throw new Error('Setup did not offer the ones that were missing');
    if(r.missing.indexOf('Admin') >= 0) throw new Error('it counted one already on the list as missing');
    if(r.after.indexOf('ZZ Something of our own') < 0) throw new Error('it trampled the firm’s own department');
    if(r.after.filter(n=>n === 'Admin').length !== 1) throw new Error('it added a second Admin');
    if(r.none.length) throw new Error('after adding them, ' + r.none.length + ' are still missing');
    if(r.gone) throw new Error('and Setup still offers to add them');
    return 'added ' + r.missing.join(', ') + ' and left Admin and the firm’s own alone';
  });

  await t.step('a picker with nothing in it is put back, whatever emptied it', async () => {
    const r = await t.eval(async ()=>{
      const wasCfg = JSON.parse(JSON.stringify(DB.config.departments || []));
      const wasAligned = DB.config.departmentsAlignedAt;
      /* Three ways it can read as empty, and none of them is a state
         anybody can work in: no master at all, a master wiped to
         nothing, and every department deactivated. */
      const out = {};
      /* Clear the name mirrors too: a department somebody is still
         filed under by name is re-created by the repair above, which
         is right and is not what this is testing. */
      const wasTeam = DB.team.map(x=>({id:x.id, d:(x.departments||[]).slice(), n:x.department||''}));
      DB.team.forEach(x=>{ x.departments = []; x.department = ''; });
      DB.config.departmentsAlignedAt = 'done';          // the one-time move is behind us
      DB.config.departments = [];
      await healDepartments();
      out.wiped = deptActive().map(d=>d.name);
      DB.config.departments = [{id:'DEP-X', name:'Management', active:false},
                               {id:'DEP-Y', name:'ZZ Theirs', active:false}];
      await healDepartments();
      out.allOff = deptActive().map(d=>d.name);
      out.keptTheirs = deptAll().some(d=>d.name === 'ZZ Theirs');
      out.reusedId = (deptAll().find(d=>d.name === 'Management') || {}).id;
      DB.config.departments = wasCfg;
      if(wasAligned) DB.config.departmentsAlignedAt = wasAligned;
      else delete DB.config.departmentsAlignedAt;
      wasTeam.forEach(w=>{ const x = DB.team.find(y=>y.id===w.id); if(x){ x.departments = w.d; x.department = w.n; } });
      await save('config'); await save('team');
      return Object.assign(out, {starter: DEPARTMENT_STARTER.slice()});
    });
    if(r.wiped.join(',') !== r.starter.join(','))
      throw new Error('a wiped master came back as ' + (r.wiped.join(', ') || 'nothing'));
    if(r.allOff.join(',') !== r.starter.join(','))
      throw new Error('with everything deactivated the picker offers ' + (r.allOff.join(', ') || 'nothing'));
    if(r.reusedId !== 'DEP-X')
      throw new Error('it made a second Management rather than reactivating the one on file');
    if(!r.keptTheirs) throw new Error('and it threw away a department of the firm’s own');
    return 'wiped or all-deactivated, the five come back — reactivating the ids already on file, '
      + 'so no mapping is broken, and leaving the firm’s own alone';
  });

  await t.step('a firm’s old list is brought to the five, once, losing nobody', async () => {
    const r = await t.eval(async ()=>{
      const wasCfg = JSON.parse(JSON.stringify(DB.config.departments || []));
      const wasAligned = DB.config.departmentsAlignedAt;
      const wasTeam = DB.team.map(x=>({id:x.id, d:(x.departments||[]).slice(), n:x.department||''}));
      /* The four a running site actually had, with somebody in one of
         them and nobody in the rest. */
      DB.config.departments = [
        {id:'DEP-OLD1', name:'Sales and IT', active:true},
        {id:'DEP-OLD2', name:'Sale & Operations', active:true},
        {id:'DEP-OLD3', name:'Admin', active:true},
        {id:'DEP-OLD4', name:'Insurance', active:true}];
      const who = DB.team.filter(isMemberActive)[0];
      setUserDepartments(who, ['DEP-OLD1']);
      delete DB.config.departmentsAlignedAt;
      await save('config'); await save('team');

      const ran = await alignDepartmentsOnce();
      const after = deptAll().map(d=>d.name + (d.active === false ? ' (inactive)' : ''));
      const active = deptActive().map(d=>d.name);
      const stillMapped = userDepartments(who).slice();
      /* and never again: an administrator's later edit must survive a
         deploy, so a second pass does nothing at all. */
      DB.config.departments = deptAll().concat([{id:'DEP-THEIRS', name:'ZZ Their own', active:true}]);
      const again = await alignDepartmentsOnce();
      const kept = deptAll().some(d=>d.name === 'ZZ Their own');

      DB.config.departments = wasCfg;
      if(wasAligned) DB.config.departmentsAlignedAt = wasAligned;
      else delete DB.config.departmentsAlignedAt;
      wasTeam.forEach(w=>{ const x = DB.team.find(y=>y.id===w.id); if(x){ x.departments = w.d; x.department = w.n; } });
      await save('config'); await save('team');
      return {ran, after, active, stillMapped, again, kept, starter: DEPARTMENT_STARTER.slice()};
    });
    if(!r.ran) throw new Error('it did not run on a list that needed it');
    if(r.active.join(',') !== r.starter.join(','))
      throw new Error('the picker now offers ' + r.active.join(', '));
    if(r.after.indexOf('Sale & Operations') >= 0 || r.after.indexOf('Insurance') >= 0)
      throw new Error('an empty old department was kept: ' + r.after.join(', '));
    if(r.after.indexOf('Sales and IT (inactive)') < 0)
      throw new Error('a department with somebody in it was not deactivated: ' + r.after.join(', '));
    if(r.stillMapped.join(',') !== 'DEP-OLD1')
      throw new Error('somebody’s mapping was thrown away: ' + r.stillMapped.join(','));
    if(r.again) throw new Error('it ran a second time');
    if(!r.kept) throw new Error('and it undid a department an administrator added afterwards');
    return 'the picker reads ' + r.active.join(' · ') + '; the empty old ones gone, the one with somebody '
      + 'in it deactivated with them still mapped, and a later edit left alone';
  });
});
