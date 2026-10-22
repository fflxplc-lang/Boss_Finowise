/* DOWNLOAD A BACKUP, PUT IT BACK.

   A backup nobody can restore is a file, not a backup. What is tested
   here is the round trip: take a snapshot, change the system under it,
   restore, and find the system as it was — records, the links between
   them, and the firm's configuration alike.

   The other half is refusal. A restore replaces everything, so a file
   that is not a backup must be turned away with a reason before a
   single store is written, and the confirmation must say what it is
   about to overwrite. Each of those is a separate step below.

   The file never reaches a real <input type=file> here; the reader is
   driven through the same backupInspect/confirmRestoreBackup path the
   picker uses, which is where all the judgement lives. */
const {suite} = require('../lib/harness');

const onServer = async (t, key) => t.eval(async (k)=>{
  const res = await fetch('/api/storage/' + encodeURIComponent(k), {headers: apiHeaders()});
  if(res.status === 404) return null;
  if(!res.ok) throw new Error('storage get failed: ' + res.status);
  return JSON.parse((await res.json()).value);
}, key);

/* Hand a parsed object to the restore exactly as the file picker would,
   then confirm it. Only the reload is stood down. */
const RESTORE = `async (parsed, name) => {
  const look = backupInspect(parsed);
  if(!look.ok) return {refused: look.why};
  window._rstFile = {name: name || 'test-backup.json', look};
  openRestoreConfirm();
  const modal = document.getElementById('modalBody');
  const text = modal.textContent;
  const go = document.getElementById('rstGo');
  const lockedBefore = go.disabled;
  document.getElementById('rstUnderstood').checked = true;
  document.getElementById('rstUnderstood').onchange();
  const lockedAfter = go.disabled;
  window.__reloaded = false;
  window.resetReloadNow = () => { window.__reloaded = true; };
  await confirmRestoreBackup();
  return {text, lockedBefore, lockedAfter, reloaded: window.__reloaded};
}`;

suite(async t => {

  await t.step('the Data Backup page offers a restore beside the download', async () => {
    await t.eval(()=>{ navigate('settings','datarecovery'); });
    await t.wait(400);
    const r = await t.eval(()=>{
      const c = document.getElementById('content');
      return {restore: c.textContent.indexOf('Restore a Full Backup') >= 0,
              picker: !!document.getElementById('rstFile'),
              accept: (document.getElementById('rstFile')||{}).accept,
              replaces: /replaces what is in BOSS now/.test(c.textContent),
              download: /Download Full Backup/.test(c.textContent)};
    });
    if(!r.download) throw new Error('the download went missing');
    if(!r.restore) throw new Error('there is no restore on the page');
    if(!r.picker) throw new Error('there is nothing to choose a file with');
    if(!/json/.test(r.accept||'')) throw new Error('it accepts "' + r.accept + '"');
    if(!r.replaces) throw new Error('the page does not warn that a restore replaces');
    return 'Setup › Data Administration › Data Backup, under the download';
  });

  await t.step('a backup carries every store, and says what it is', async () => {
    const r = await t.eval(async ()=>{
      DB.config.company = DB.config.company || {};
      DB.config.company.name = 'ZZ Backup Firm';
      DB.config.roles = ['Admin','Manager','Relationship Manager','Operations','ZZ Role From Backup'];
      DB.leads = [{id:'ZZL1', leadName:'ZZ Saved Lead', firstName:'ZZ', lastName:'Saved',
        email:'zzsaved@example.in', assignedTo:currentUser, createdAt:new Date().toISOString()}];
      initState('LMS', DB.leads[0]);
      DB.clients = [{id:'ZZC1', cmsName:'ZZ Saved Client', email:'zzc@example.in',
        leadId:'ZZL1', rmName:currentUser, createdAt:new Date().toISOString()}];
      initState('CMS', DB.clients[0]);
      DB.tasks = [{id:'ZZT1', taskType:'ZZ Saved Task', leadId:'ZZL1', assignTo:currentUser,
        overallStatus:'Not Started'}];
      DB.amcs = [{id:'AMC1', name:'ZZ Saved AMC'}];
      for(const k of ['config','leads','clients','tasks','amcs']) await save(k);
      const snap = backupSnapshot();
      return {stores: Object.keys(snap).length, dbStores: backupStoreKeys().length,
              mark: snap[BACKUP_MARK], records: backupRecordCount(snap),
              hasConfig: !!snap.config, hasTeam: Array.isArray(snap.team),
              snap: JSON.stringify(snap).length};
    });
    if(r.stores !== r.dbStores + 1) throw new Error('the snapshot holds ' + r.stores + ' of ' + r.dbStores + ' stores');
    if(!r.hasConfig || !r.hasTeam) throw new Error('the configuration or the team is not in it');
    if(!r.mark || r.mark.format !== 1) throw new Error('it carries no header');
    if(r.mark.firm !== 'ZZ Backup Firm') throw new Error('the header names ' + r.mark.firm);
    return r.dbStores + ' stores, ' + r.records + ' records, headed and named';
  });

  t.section('a file that is not a backup is turned away, with a reason');

  await t.step('each kind of wrong file is refused before anything is written', async () => {
    const r = await t.eval(()=>{
      const tries = {
        aList:        backupInspect([1,2,3]),
        aString:      backupInspect('leads,clients\n1,2'),
        nothing:      backupInspect(null),
        someOtherJson:backupInspect({invoice:'INV-1', total:4200}),
        wrongShape:   backupInspect({leads:{}, clients:[], team:[], config:{}, tasks:[], amcs:[]}),
        aFragment:    backupInspect({leads:[], clients:[]}),
      };
      const out = {};
      Object.entries(tries).forEach(([k,v])=>{ out[k] = v.ok ? 'ACCEPTED' : v.why; });
      out.leads = DB.leads.length;
      return out;
    });
    const accepted = Object.entries(r).filter(([k,v])=>v === 'ACCEPTED').map(([k])=>k);
    if(accepted.length) throw new Error('these were accepted: ' + accepted.join(', '));
    if(!/not a BOSS backup/.test(r.aList)) throw new Error('a list: "' + r.aList + '"');
    if(!/none of the stores/.test(r.someOtherJson)) throw new Error('other JSON: "' + r.someOtherJson + '"');
    if(!/wrong shape/.test(r.wrongShape)) throw new Error('wrong shape: "' + r.wrongShape + '"');
    if(!/fragment/.test(r.aFragment)) throw new Error('a fragment: "' + r.aFragment + '"');
    if(r.leads !== 1) throw new Error('something was written while refusing');
    return 'a list, a string, nothing, other JSON, a wrong shape and a fragment — each refused by name';
  });

  await t.step('a real backup is accepted, header or no header', async () => {
    const r = await t.eval(()=>{
      const snap = backupSnapshot();
      const headed = backupInspect(snap);
      const older = JSON.parse(JSON.stringify(snap));
      delete older[BACKUP_MARK];
      const bare = backupInspect(older);
      return {headed: headed.ok, bare: bare.ok, mark: !!headed.mark, bareMark: !!bare.mark,
              extra: backupInspect(Object.assign({zzFutureStore:[]}, snap)).extra};
    });
    if(!r.headed) throw new Error('its own backup was refused');
    if(!r.bare) throw new Error('a backup from before the header was refused');
    if(!r.mark || r.bareMark) throw new Error('the header was not read correctly');
    if((r.extra||[]).join(',') !== 'zzFutureStore') throw new Error('an unknown store was not noticed');
    return 'both accepted; an unknown store is noticed and set aside';
  });

  t.section('the round trip');

  await t.step('the confirmation says what it replaces and what it leaves', async () => {
    const r = await t.eval(async (src)=>{
      window.__snap = backupSnapshot();
      /* change the system under the backup */
      DB.leads = DB.leads.concat([{id:'ZZL2', leadName:'ZZ Later Lead', firstName:'ZZ', lastName:'Later',
        email:'zzlater@example.in', assignedTo:currentUser, createdAt:new Date().toISOString()}]);
      initState('LMS', DB.leads[1]);
      DB.config.company.name = 'ZZ Renamed Firm';
      DB.config.roles = ['Admin','Manager'];
      DB.amcs = [];
      for(const k of ['leads','config','amcs']) await save(k);
      const look = backupInspect(window.__snap);
      window._rstFile = {name:'zz-backup.json', look};
      openRestoreConfirm();
      const m = document.getElementById('modalBody');
      const text = m.textContent;
      const go = document.getElementById('rstGo');
      const locked = go.disabled;
      const buttons = Array.from(m.querySelectorAll('.modal-foot button')).map(b=>b.textContent.trim());
      closeModal();
      return {text, locked, buttons, leads: DB.leads.length, firm: DB.config.company.name};
    }, RESTORE);
    if(!/WILL BE REPLACED/.test(r.text)) throw new Error('it does not say what is replaced');
    if(!/WILL BE LEFT ALONE/.test(r.text)) throw new Error('it does not say what is left');
    if(!/Nothing is merged, so nothing is doubled/.test(r.text)) throw new Error('it does not address duplication');
    if(!/zz-backup\.json/.test(r.text)) throw new Error('it does not name the file');
    if(!r.locked) throw new Error('the restore button was live before anything was acknowledged');
    if(!r.buttons.some(b=>/^Cancel$/.test(b))) throw new Error('there is no way out of it');
    if(r.leads !== 2 || r.firm !== 'ZZ Renamed Firm') throw new Error('it restored on opening the dialog');
    return 'both lists, a locked button, a cancel, and nothing written by looking';
  });

  await t.step('restoring puts the records, their links and the configuration back', async () => {
    const ran = await t.eval(async (src)=>
      (new Function('return (' + src + ')')())(window.__snap, 'zz-backup.json'), RESTORE);
    if(ran.refused) throw new Error('it refused its own backup: ' + ran.refused);
    if(ran.lockedBefore !== true || ran.lockedAfter !== false) throw new Error('the acknowledgement does not gate it');
    if(!ran.reloaded) throw new Error('the screens were not refreshed afterwards');
    await t.wait(600);
    const leads = await onServer(t, 'leads');
    const clients = await onServer(t, 'clients');
    const tasks = await onServer(t, 'tasks');
    const cfg = await onServer(t, 'config');
    const amcs = await onServer(t, 'amcs');
    if((leads||[]).length !== 1) throw new Error((leads||[]).length + ' leads came back, not 1');
    if(leads[0].id !== 'ZZL1') throw new Error('the wrong lead came back: ' + leads[0].id);
    if((clients[0]||{}).leadId !== 'ZZL1') throw new Error('the client lost its link to the lead');
    if((tasks[0]||{}).leadId !== 'ZZL1') throw new Error('the task lost its link to the lead');
    if(((cfg||{}).company||{}).name !== 'ZZ Backup Firm') throw new Error('the company name is ' + ((cfg||{}).company||{}).name);
    if(((cfg||{}).roles||[]).indexOf('ZZ Role From Backup') < 0) throw new Error('the roles list did not come back');
    if(!(amcs||[]).length) throw new Error('the masters did not come back');
    return 'one lead, its client and its task still pointing at it, and the firm’s setup as it was';
  });

  await t.step('it is written down, and the restore is recorded on the system', async () => {
    const log = await onServer(t, 'auditLog');
    const entry = (log||[]).filter(x=>x.action === 'Full Backup Restored').slice(-1)[0];
    if(!entry) throw new Error('nothing says a restore happened');
    const file = (entry.details||[]).find(d=>d.field === 'File') || {};
    if(file.newValue !== 'zz-backup.json') throw new Error('it names ' + file.newValue);
    const state = await onServer(t, 'systemState');
    if(!(state||{}).restoredAt) throw new Error('the system does not record that it was restored');
    return 'an audit entry naming the file, and the restore on the system record';
  });

  await t.step('running the same file twice changes nothing and doubles nothing', async () => {
    const before = (await onServer(t, 'leads')).length;
    await t.eval(async (src)=>{ systemResetting = false;
      return (new Function('return (' + src + ')')())(window.__snap, 'zz-backup.json'); }, RESTORE);
    await t.wait(600);
    const after = await onServer(t, 'leads');
    if((after||[]).length !== before) throw new Error(before + ' leads became ' + (after||[]).length);
    return 'still ' + before + ' lead(s) — it replaces rather than merges';
  });

  await t.step('a backup without the restoring account puts that account back', async () => {
    const r = await t.eval(async (src)=>{
      systemResetting = false;
      const snap = backupSnapshot();
      snap.team = [{id:'ZZSTRANGER', name:'ZZ Stranger', email:'zzstranger@example.in',
        role:'Operations', status:'Active', perms: fullPerms(false, {view:1}),
        adminFlags: fullAdminFlags(false)}];
      const mine = DB.team.find(x=>x.id===currentUser);
      const out = await (new Function('return (' + src + ')')())(snap, 'zz-no-me.json');
      return {warned: /not in this backup/.test(out.text||''), refused: out.refused, myId: mine.id};
    }, RESTORE);
    if(r.refused) throw new Error('it refused: ' + r.refused);
    if(!r.warned) throw new Error('it did not warn that the account was missing');
    await t.wait(600);
    const team = await onServer(t, 'team');
    const stranger = (team||[]).find(x=>x.id === 'ZZSTRANGER');
    const me_ = (team||[]).find(x=>x.id === r.myId);
    if(!stranger) throw new Error('the backup’s own team did not come back');
    if(!me_) throw new Error('the restoring account was not put back, so nobody can administer the system');
    if(me_.role !== 'Admin') throw new Error('it came back as ' + me_.role);
    return 'the backup’s team restored, with the restoring Admin added back beside it';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error(t.dialogs.join(' | '));
    return 'none';
  });
});
