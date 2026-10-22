/* AN IMPORT, AND THE WAY BACK OUT OF IT.

   A wrong sheet is the commonest way a CRM gets five hundred records it
   does not want. Every import goes through one upsert, so every import
   can write down what it did — the id of each record it created, and
   for each record it changed, the fields it moved with the value each
   one held before.

   What is worth testing is not that a Delete button exists. It is the
   four things that stop an undo doing damage of its own: a record the
   import created that something else now points at is kept, a field
   somebody has changed since is left alone, a second import of the same
   file is untouched, and what the dialog promised is what happens. */
const {suite} = require('../lib/harness');

const onServer = async (t, key) => t.eval(async (k)=>{
  const res = await fetch('/api/storage/' + encodeURIComponent(k), {headers: apiHeaders()});
  if(res.status === 404) return null;
  if(!res.ok) throw new Error('storage get failed: ' + res.status);
  return JSON.parse((await res.json()).value);
}, key);

/* Run a sheet through the real importer and come back with the history id. */
const IMPORT = `async (srcId, rows, name, key, mode) => {
  window._mapImpSrc = srcId;
  const bytes = xlsxWrite([{name:'Sheet1', rows}]);
  const file = new File([bytes], name, {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const inp = document.createElement('input');
  Object.defineProperty(inp, 'files', {value: [file]});
  await mapImpPick(inp);
  if(key){ mapImpSetKey(key); }
  if(mode){ mapImpSetMode(mode); }
  await mapImpApply();
  const h = DB.importHistory[DB.importHistory.length - 1];
  return h.id;
}`;

suite(async t => {
  let first = null, second = null;

  await t.step('an import writes down what it did, record by record', async () => {
    const r = await t.eval(async (imp)=>{
      const f = mapImpFields('leads');
      const name = f.find(x=>x.req) || f[0];
      const mob = f.find(x=>/mobile/i.test(x.k));
      const email = f.find(x=>x.k === 'email');
      const call = f.find(x=>x.req && x !== name && x !== mob && x !== email);
      const head = [name.l, mob.l, email.l].concat(call ? [call.l] : []);
      const reqs = f.filter(x=>x.req).filter(x=>head.indexOf(x.l) < 0);
      /* whatever else this module insists on, so the sheet is importable */
      reqs.forEach(x=>head.push(x.l));
      const val = x => x.t === 'select' ? (effectiveOpts('LMS', x) || [''])[0]
        : /mobile/i.test(x.k) ? '9800000001' : 'ZZ ' + x.k;
      const row = n => head.map(hl=>{
        const fd = f.find(x=>(x.l) === hl);
        if(fd === name) return 'ZZ Undo ' + n;
        if(fd === mob) return '98000000' + (10 + n);
        if(fd === email) return 'zzundo' + n + '@example.in';
        return val(fd);
      });
      const id = await eval('(' + imp + ')')('leads', [head, row(1), row(2)], 'first.xlsx');
      const h = DB.importHistory.find(x=>x.id === id);
      const u = impUndoFor(h);
      return {id, undoId: h.undoId, created: u ? u.created.length : 0,
        updated: u ? u.updated.length : 0, imported: h.imported,
        madeIds: u ? u.created.map(c=>c.id) : [],
        allLeads: DB.leads.filter(x=>/^ZZ Undo /.test(x.firstName || '')).length,
        emailKey: email.k, nameKey: name.k};
    }, IMPORT);
    if(r.imported !== 2 || r.allLeads !== 2) throw new Error('the import wrote ' + r.allLeads + ' lead(s)');
    if(!r.undoId) throw new Error('no record of what it did was kept');
    if(r.created !== 2) throw new Error('it recorded ' + r.created + ' creations, not 2');
    first = r.id;
    const undo = await onServer(t, 'importUndo');
    if(!(undo || []).some(u=>u.id === r.undoId)) throw new Error('the record is not on the server');
    return '2 records created, both named in the undo record, and the record is in storage';
  });

  await t.step('the history offers Delete, and says whether it can be reversed', async () => {
    const r = await t.eval((id)=>{
      navigate('settings', 'importback');
      const c = document.getElementById('content');
      return {button: c.innerHTML.indexOf("askDeleteImport('" + id + "')") >= 0,
        reversible: /no record kept|made,/.test(c.textContent),
        header: Array.from(c.querySelectorAll('table thead th')).map(x=>x.textContent.trim())
          .filter(x=>/Reversible/.test(x)).length};
    }, first);
    if(!r.button) throw new Error('the import has no Delete');
    if(!r.header) throw new Error('the history does not say whether an import can be reversed');
    return 'Delete on the row, and a column saying what the undo record holds';
  });

  t.section('what an undo refuses to touch');

  await t.step('a record something else points at is kept, not deleted', async () => {
    const r = await t.eval(async (id)=>{
      const u = impUndoFor(DB.importHistory.find(x=>x.id === id));
      const keep = u.created[0].id, go = u.created[1].id;
      /* a task raised against one of them since the import */
      DB.tasks.push({id:'DST-ZZLINK', taskType:'Follow-up Call', leadId: keep,
        overallStatus:'Not Started'});
      await save('tasks');
      const plan = impUndoPlan(id);
      return {keep, go, linked: plan.linked.map(x=>x.id), remove: plan.remove.map(x=>x.id),
        can: plan.can};
    }, first);
    if(r.linked.join() !== r.keep) throw new Error('the linked record was not held back: ' + r.linked.join());
    if(r.remove.join() !== r.go) throw new Error('it would remove ' + r.remove.join());
    return 'the lead with a task against it stays; the other one goes';
  });

  await t.step('a field somebody changed since is left alone, the rest go back', async () => {
    const r = await t.eval(async (imp)=>{
      const f = mapImpFields('leads');
      const name = f.find(x=>x.req) || f[0];
      const email = f.find(x=>x.k === 'email');
      const mob = f.find(x=>/mobile/i.test(x.k));
      const head = f.filter(x=>x.req).map(x=>x.l);
      if(head.indexOf(email.l) < 0) head.push(email.l);
      const val = x => x.t === 'select' ? (effectiveOpts('LMS', x) || [''])[0]
        : /mobile/i.test(x.k) ? '9811111111' : 'ZZ ' + x.k;
      const row = head.map(hl=>{
        const fd = f.find(x=>x.l === hl);
        if(fd === name) return 'ZZ Updated Name';
        if(fd === email) return 'zzundo1@example.in';   // matches a lead the first import made
        if(fd === mob) return '9899999999';
        return val(fd);
      });
      const target = DB.leads.find(x=>x.email === 'zzundo1@example.in');
      const wasName = target[name.k], wasMob = target[mob.k];
      const id = await eval('(' + imp + ')')('leads', [head, row], 'second.xlsx', email.k, 'update');
      const after = DB.leads.find(x=>x.id === target.id);
      const u = impUndoFor(DB.importHistory.find(x=>x.id === id));
      /* and now somebody edits one of the very fields it changed */
      after[mob.k] = '9777777777';
      await save('leads');
      const plan = impUndoPlan(id);
      return {id, wasName, wasMob, nowName: after[name.k],
        updated: u.updated.length, created: u.created.length,
        restoreFields: plan.restore.length ? Object.keys(plan.restore[0].put) : [],
        movedFields: plan.moved.length ? plan.moved[0].fields : [],
        nameKey: name.k, mobKey: mob.k, targetId: target.id};
    }, IMPORT);
    if(r.created !== 0 || r.updated !== 1) throw new Error('it should have updated one and created none');
    if(r.nowName !== 'ZZ Updated Name') throw new Error('the update did not land');
    if(r.restoreFields.indexOf(r.nameKey) < 0) throw new Error('the name would not be put back');
    if(r.restoreFields.indexOf(r.mobKey) >= 0) throw new Error('it would overwrite the later edit');
    if(r.movedFields.indexOf(r.mobKey) < 0) throw new Error('the later edit was not reported as held back');
    second = r.id;
    return 'the name goes back to "' + r.wasName + '"; the mobile somebody edited afterwards is left as it is';
  });

  t.section('and reversing does exactly what it said');

  await t.step('the dialog says what will happen, and then that is what happens', async () => {
    const r = await t.eval(async (id)=>{
      const plan = impUndoPlan(id);
      askDeleteImport(id);
      const said = document.getElementById('modalBody').textContent;
      const promised = {remove: plan.remove.length, restore: plan.restore.length,
        linked: plan.linked.length, moved: plan.moved.length};
      const f = mapImpFields('leads');
      const name = (f.find(x=>x.req) || f[0]).k;
      const before = DB.leads.length;
      const was = plan.restore.length ? plan.restore[0].put[name] : null;
      const who = plan.restore.length ? plan.restore[0].id : '';
      await deleteImport(id);
      const rec = DB.leads.find(x=>x.id === who);
      return {promised, said,
        saysRestore: /put back to what they were/.test(said),
        saysHeld: /left alone, and why/.test(said),
        before, after: DB.leads.length, was, now: rec ? rec[name] : '(gone)',
        histGone: !DB.importHistory.some(x=>x.id === id),
        undoGone: !(DB.importUndo||[]).some(u=>u.id === (plan.undo||{}).id),
        audit: DB.auditLog.some(a=>a.action === 'Import deleted and reversed')};
    }, second);
    if(!r.saysRestore) throw new Error('the dialog does not say the changed records are put back');
    if(!r.saysHeld) throw new Error('the dialog does not say what is left alone');
    if(r.after !== r.before) throw new Error('an update-only import changed the row count: '
      + r.before + ' -> ' + r.after + ' (it would remove ' + r.promised.remove + ')');
    if(r.now !== r.was) throw new Error('the field was not put back: "' + r.now + '" vs "' + r.was + '"');
    if(!r.histGone) throw new Error('the line is still in the history');
    if(!r.undoGone) throw new Error('the undo record was left behind');
    if(!r.audit) throw new Error('it is not in the audit trail');
    return 'restored the field the import overwrote, left the later edit, dropped the line and the undo '
      + 'record, and wrote it to the audit trail';
  });

  await t.step('the first import is untouched by the second being reversed, and then reverses itself', async () => {
    const r = await t.eval(async (id)=>{
      const still = DB.importHistory.some(x=>x.id === id);
      const plan = impUndoPlan(id);
      const before = DB.leads.filter(x=>/^ZZ Undo |^ZZ Updated Name/.test(x.firstName || '')).length;
      await deleteImport(id);
      const left = DB.leads.filter(x=>/^ZZ Undo |^ZZ Updated Name/.test(x.firstName || ''));
      DB.tasks = DB.tasks.filter(x=>x.id !== 'DST-ZZLINK'); await save('tasks');
      return {still, before, removed: plan.remove.length, linked: plan.linked.length,
        after: left.length, names: left.map(x=>x.firstName)};
    }, first);
    if(!r.still) throw new Error('reversing the second import removed the first from the history');
    if(r.after !== r.linked)
      throw new Error(r.after + ' lead(s) left, expected the ' + r.linked + ' held back by a link');
    return r.removed + ' deleted, ' + r.linked + ' kept because a task still points at it — and the '
      + 'other import was never involved';
  });

  await t.step('nothing was alerted that was not a result', async () => {
    const seen = (t.dialogs || []).map(String);
    const bad = seen.filter(m=>/undefined|not a function|\[object/i.test(m));
    if(bad.length) throw new Error(bad.join(' | '));
    return seen.length ? seen.length + ' confirmation(s)' : 'none';
  });
});
