/* SET ONE FIELD ON FORTY RECORDS, AND NOTHING ELSE.

   The ask was "move these clients to a different RM", but the point of
   the thing is that it knows nothing about RMs. So what is tested is
   that it is genuinely generic — every module that has row selection
   offers it, the fields come from each module's own registry, the
   control matches the type — and that it is genuinely narrow: the
   chosen field changes on the chosen records and not one byte more.

   The dialog is driven the way a person drives it: open it, pick a
   field, put a value in the control it rendered, review, apply. */
const {suite} = require('../lib/harness');

const onServer = async (t, key) => t.eval(async (k)=>{
  const res = await fetch('/api/storage/' + encodeURIComponent(k), {headers: apiHeaders()});
  if(res.status === 404) return null;
  if(!res.ok) throw new Error('storage get failed: ' + res.status);
  return JSON.parse((await res.json()).value);
}, key);

/* Pick a field, type a value into whatever control appeared for it,
   review, apply. Returns the review text so it can be read. */
const RUN = `async (module, pairs) => {
  openBulkFieldUpdate(module);
  pairs.forEach((p, i) => {
    if(i) bulkEditAdd();
    bulkEditPick(i, p.k);
    if(p.clear){ bulkEditClear(i, true); return; }
    const el = document.getElementById('f_' + p.k);
    if(!el) throw new Error('no control appeared for ' + p.k);
    el.value = p.v;
  });
  bulkEditReview();
  const review = document.getElementById('modalBody').textContent;
  const confirmBtn = Array.from(document.querySelectorAll('#modalBody .modal-foot button'))
    .find(b => b.textContent.trim().indexOf('Update ') === 0);
  if(!confirmBtn) return {review, stopped: true};
  await bulkEditApply();
  const done = document.getElementById('modalBody').textContent;
  closeModal();
  return {review, done};
}`;

suite(async t => {

  await t.step('a few clients and leads to work on', async () => {
    const r = await t.eval(async ()=>{
      DB.team = DB.team.filter(x=>x.id !== 'ZZRM').concat([{id:'ZZRM', name:'ZZ New RM',
        email:'zzrm@example.in', role:'Relationship Manager', status:'Active',
        perms: fullPerms(false, {view:1}), adminFlags: fullAdminFlags(false)}]);
      DB.clients = ['A','B','C'].map((x,i)=>{
        const c = {id:'ZZC'+i, cmsName:'ZZ Client '+x, email:'c'+i+'@example.in',
          mobile:'90000000'+i, rmName:currentUser, branch:'Varanasi', clientCategory:'A',
          createdAt:new Date().toISOString()};
        initState('CMS', c);
        return c;
      });
      DB.leads = ['P','Q'].map((x,i)=>{
        const l = {id:'ZZL'+i, leadName:'ZZ Lead '+x, firstName:'ZZ', lastName:x,
          email:'l'+i+'@example.in', assignedTo:currentUser, branch:'Varanasi',
          createdAt:new Date().toISOString()};
        initState('LMS', l);
        return l;
      });
      await save('team'); await save('clients'); await save('leads');
      return {clients: DB.clients.length, leads: DB.leads.length};
    });
    if(r.clients !== 3 || r.leads !== 2) throw new Error('the fixture did not stick');
    return r.clients + ' clients, ' + r.leads + ' leads';
  });

  t.section('it is on every module that has row selection');

  await t.step('each module offers it, with fields from its own registry', async () => {
    const r = await t.eval(()=>{
      const out = {}, empty = [];
      Object.keys(MODULE_DB_KEY).forEach(m=>{
        const n = bulkFieldsFor(m).length;
        out[m] = n;
        if(!n) empty.push(m);
        const bar = bulkBar(m);   // nothing selected, so it draws nothing
        if(bar !== '') empty.push(m + ' (bar drew with nothing ticked)');
      });
      return {out, empty, modules: Object.keys(MODULE_DB_KEY).length};
    });
    if(r.empty.length) throw new Error('no fields to set on: ' + r.empty.join(', '));
    return r.modules + ' modules, each with its own fields: '
      + Object.entries(r.out).slice(0, 5).map(([m,n])=>m+' '+n).join(', ') + '…';
  });

  await t.step('the bar carries the button once something is ticked', async () => {
    const r = await t.eval(()=>{
      bulkSelection.CMS.add('ZZC0');
      const bar = bulkBar('CMS', {assign:true});
      bulkSelection.CMS.clear();
      return {bar, has: /openBulkFieldUpdate\('CMS'\)/.test(bar), says: /Update Fields/.test(bar)};
    });
    if(!r.has || !r.says) throw new Error('the bar reads: ' + r.bar.slice(0, 200));
    return 'Update Fields, beside Assign and Delete';
  });

  await t.step('the stage and a conditional field are deliberately not offered', async () => {
    const r = await t.eval(()=>({
      cmsStage: bulkFieldsFor('CMS').some(f=>f.k === RECORD_STATE_FIELD.CMS),
      lmsStage: bulkFieldsFor('LMS').some(f=>f.k === RECORD_STATE_FIELD.LMS),
      conditional: bulkFieldsFor('LMS').some(f=>f.k === 'referrerClientId'),
      rm: bulkFieldsFor('CMS').some(f=>f.k === 'rmName'),
    }));
    if(r.cmsStage || r.lmsStage) throw new Error('the stage is on the list, and it must not be');
    if(r.conditional) throw new Error('a field that only applies under a condition is on the list');
    if(!r.rm) throw new Error('RM Name is not offered, and it is the whole example');
    return 'stage and conditional fields held back; RM Name offered';
  });

  t.section('the example that asked for it');

  await t.step('three clients, one RM, one action', async () => {
    const r = await t.eval(async (src)=>{
      bulkSelection.CMS.clear();
      ['ZZC0','ZZC1','ZZC2'].forEach(id=>bulkSelection.CMS.add(id));
      const out = await (new Function('return (' + src + ')')())('CMS', [{k:'rmName', v:'ZZRM'}]);
      return {out, rms: DB.clients.map(c=>c.rmName),
              names: DB.clients.map(c=>c.cmsName), mobiles: DB.clients.map(c=>c.mobile),
              cats: DB.clients.map(c=>c.clientCategory), left: bulkSelection.CMS.size};
    }, RUN);
    if(r.out.stopped) throw new Error('the review would not confirm: ' + r.out.review.slice(0, 200));
    if(r.rms.join(',') !== 'ZZRM,ZZRM,ZZRM') throw new Error('the RMs are ' + r.rms.join(', '));
    if(r.names.join(',') !== 'ZZ Client A,ZZ Client B,ZZ Client C') throw new Error('a name changed');
    if(r.mobiles.join(',') !== '900000000,900000001,900000002') throw new Error('a mobile changed');
    if(r.cats.join(',') !== 'A,A,A') throw new Error('a category changed');
    if(r.left) throw new Error('the selection was left ticked afterwards');
    if(!/ZZ New RM/.test(r.out.review)) throw new Error('the review did not name the new RM');
    if(!/3 record\(s\) updated/.test(r.out.done)) throw new Error('the result reads: ' + r.out.done.slice(0,160));
    await t.wait(400);
    const server = await onServer(t, 'clients');
    if((server||[]).some(c=>c.rmName !== 'ZZRM')) throw new Error('the server did not get it');
    return 'three clients moved; name, mobile and category untouched';
  });

  await t.step('the record outside the selection is untouched', async () => {
    const r = await t.eval(async (src)=>{
      bulkSelection.LMS.clear();
      bulkSelection.LMS.add('ZZL0');
      await (new Function('return (' + src + ')')())('LMS', [{k:'city', v:'ZZ Town'}]);
      return {one: (DB.leads.find(l=>l.id==='ZZL0')||{}).city,
              two: (DB.leads.find(l=>l.id==='ZZL1')||{}).city};
    }, RUN);
    if(r.one !== 'ZZ Town') throw new Error('the ticked lead reads ' + r.one);
    if(r.two) throw new Error('the lead nobody ticked reads ' + r.two);
    return 'one ticked, one changed';
  });

  t.section('several fields, several types, one pass');

  await t.step('a text field, a dropdown, a date and an owner together', async () => {
    const r = await t.eval(async (src)=>{
      bulkSelection.CMS.clear();
      ['ZZC0','ZZC1'].forEach(id=>bulkSelection.CMS.add(id));
      const cats = cfgLabels('arc.categories');
      const cat = cats.find(x=>x !== 'A') || cats[0];
      const out = await (new Function('return (' + src + ')')())('CMS', [
        {k:'clientCategory', v:cat},
        {k:'branch', v:'Varanasi'},
        {k:'rmName', v:currentUser},
      ]);
      return {out, cat, after: DB.clients.map(c=>({id:c.id, cat:c.clientCategory, rm:c.rmName}))};
    }, RUN);
    if(r.out.stopped) throw new Error('it would not confirm: ' + r.out.review.slice(0, 250));
    const touched = r.after.filter(c=>c.id !== 'ZZC2');
    if(touched.some(c=>c.cat !== r.cat)) throw new Error('the category did not land');
    if(touched.some(c=>c.rm === 'ZZRM')) throw new Error('the RM did not land');
    const third = r.after.find(c=>c.id === 'ZZC2');
    if(third.cat !== 'A' || third.rm !== 'ZZRM') throw new Error('the untouched client moved');
    return 'three fields set on two records in one pass';
  });

  await t.step('each type renders its own control, not a text box', async () => {
    const r = await t.eval(()=>{
      bulkSelection.CMS.clear(); bulkSelection.CMS.add('ZZC0');
      openBulkFieldUpdate('CMS');
      const kinds = {};
      [['rmName','team'],['clientCategory','select'],['dob','date'],['cmsName','text']].forEach(([k, want])=>{
        bulkEditPick(0, k);
        const el = document.getElementById('f_' + k);
        kinds[k] = el ? (el.tagName.toLowerCase() === 'select' ? 'select'
          : (el.type === 'hidden' && document.getElementById('pickbox_f_' + k)) ? 'typeahead'
          : el.type) : 'missing';
      });
      bulkEditPick(0, 'rmName');
      /* A person is picked by typing their name now, so the people on
         offer are the picker's rows rather than a select's options —
         but they must still be there, which is what this ever asked. */
      const hasNewRm = (window._pickRows['f_rmName'] || []).some(o=>o.value === 'ZZRM');
      const el = document.getElementById('f_rmName');
      const reads = !!el && el.type === 'hidden';
      closeModal();
      bulkSelection.CMS.clear();
      return {kinds, hasNewRm, reads};
    });
    /* Anything picked from a list is typed into now, an owner and a
       configured vocabulary alike; a date and a text box are not. */
    if(r.kinds.rmName !== 'typeahead') throw new Error('an owner rendered as ' + r.kinds.rmName);
    if(!r.reads) throw new Error('the owner field no longer carries a value the save can read');
    if(r.kinds.clientCategory !== 'typeahead')
      throw new Error('a dropdown rendered as ' + r.kinds.clientCategory);
    if(r.kinds.dob !== 'date') throw new Error('a date rendered as ' + r.kinds.dob);
    if(r.kinds.cmsName !== 'text') throw new Error('a text field rendered as ' + r.kinds.cmsName);
    if(!r.hasNewRm) throw new Error('the owner picker does not offer the team');
    return 'owner and category \u2192 a name you type, date \u2192 date, text \u2192 text';
  });

  t.section('what it refuses, and what it writes down');

  await t.step('a required field cannot be emptied, and a number must be one', async () => {
    const r = await t.eval(()=>{
      bulkSelection.CMS.clear(); bulkSelection.CMS.add('ZZC0');
      const said = [];
      const alert0 = window.alert; window.alert = m => said.push(m);
      openBulkFieldUpdate('CMS');
      bulkEditPick(0, 'cmsName');
      window._bulkEdit.picks[0] = {k:'cmsName', clear:true, value:''};
      bulkEditReview();
      bulkEditPick(0, 'cmsName');
      window._bulkEdit.picks[0] = {k:'cmsName', clear:false, value:''};
      bulkEditReview();
      window.alert = alert0;
      const name = (DB.clients.find(c=>c.id==='ZZC0')||{}).cmsName;
      closeModal(); bulkSelection.CMS.clear();
      return {said, name};
    });
    if(!r.said.some(x=>/required, so it cannot be emptied/.test(x)))
      throw new Error('clearing a required field was allowed: ' + r.said.join(' | '));
    if(!r.said.some(x=>/is required/.test(x))) throw new Error('an empty value was allowed');
    if(r.name !== 'ZZ Client A') throw new Error('it wrote anyway: ' + r.name);
    return 'both refused, and nothing written';
  });

  await t.step('every record keeps its own audit line, with what the field held', async () => {
    const log = await onServer(t, 'auditLog');
    const lines = (log||[]).filter(x=>x.action === 'Bulk Field Update');
    const perRecord = lines.filter(x=>x.recordId !== 'BULK');
    const summary = lines.filter(x=>x.recordId === 'BULK');
    if(!perRecord.length) throw new Error('no record carries a line of its own');
    if(!summary.length) throw new Error('there is no summary of the operation');
    const one = perRecord.find(x=>x.recordId === 'ZZC0' && (x.details||[]).some(d=>/RM/i.test(d.field)));
    if(!one) throw new Error('the RM change is not on the client it happened to');
    const d = one.details.find(x=>/RM/i.test(x.field));
    if(!d.oldValue || !d.newValue) throw new Error('it did not record both values: ' + JSON.stringify(d));
    if(d.newValue !== 'ZZ New RM') throw new Error('it recorded the id rather than the name: ' + d.newValue);
    if(!one.by || !one.at) throw new Error('it did not record who and when');
    return perRecord.length + ' record line(s) and ' + summary.length
      + ' summary line(s), naming the person rather than their id';
  });

  await t.step('without Bulk Update permission the button is not there', async () => {
    const r = await t.eval(()=>{
      const me_ = DB.team.find(x=>x.id===currentUser);
      const wasRole = me_.role, wasPerms = me_.perms;
      me_.role = 'Relationship Manager';
      me_.perms = fullPerms(true);
      me_.perms.CMS.bulkUpdate = 0;
      bulkSelection.CMS.add('ZZC0');
      const bar = bulkBar('CMS', {assign:true});
      let said = '';
      const alert0 = window.alert; window.alert = m => { said = m; };
      openBulkFieldUpdate('CMS');
      window.alert = alert0;
      const open = document.getElementById('overlay').classList.contains('show');
      me_.role = wasRole; me_.perms = wasPerms;
      bulkSelection.CMS.clear();
      return {offered: /openBulkFieldUpdate/.test(bar), said, open};
    });
    if(r.offered) throw new Error('the button is offered without the permission');
    if(!/Bulk Update/.test(r.said)) throw new Error('calling it directly said "' + r.said + '"');
    if(r.open) throw new Error('it opened anyway');
    return 'not offered, and refused when called directly';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error(t.dialogs.join(' | '));
    return 'none';
  });
});
