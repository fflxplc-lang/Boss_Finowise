/* BUSINESS THAT WAS SAID NO TO.

   A DBT entry could be logged, worked and completed, but there was no
   way to record the one answer a client gives often enough to matter:
   no. The firm asked for Declined on the status list.

   Adding it is one line. What is NOT one line is what the rest of the
   system had assumed about that list. Seven places read "the last
   status on the list" and meant "finished" — so a fifth status after
   Completed would have made every one of them treat a refusal as
   business done. The pipeline figures had the mirror of the same
   assumption: anything that is not Completed is money still coming.

   So three things are guarded here. That Declined is offered. That
   finished still means Completed with Declined sitting after it. And
   that refused business is out of the figures while staying in the
   list, which is the whole reason for recording it. */
const {suite} = require('../lib/harness');

const SEED = `async function(){
  let c = DB.clients.find(x=>x.id === 'CMS-DECL');
  if(!c){ c = {id:'CMS-DECL'}; DB.clients.push(c); }
  Object.assign(c, {cmsName:'ZZ Declined Client', email:'decl@example.com',
    rmName: currentUser, branch:'Varanasi', createdAt:new Date().toISOString()});
  DB.businessEntries = (DB.businessEntries || []).filter(e=>e.clientId !== 'CMS-DECL');
  const month = new Date().toISOString().slice(0,7);
  const mk = (status, amount)=>{
    const e = {id: uid('DBT'), clientId:'CMS-DECL', dbtType:'Investment',
      productCategory:'Mutual Fund', transactionType:'Purchase', source:'CMS',
      amount:String(amount), status,
      loggedDate: month + '-05', createdAt:new Date().toISOString(), createdBy: currentUser};
    DB.businessEntries.push(e); return e;
  };
  const done     = mk('Completed', 100000);
  const working  = mk('In Process', 50000);
  const refused  = mk('Declined', 900000);
  await save('clients'); await save('businessEntries');
  return {done: done.id, working: working.id, refused: refused.id};
}`;

suite(async t => {
  await t.home();

  t.section('the status is on the list');

  await t.step('Declined is offered beside the four that were there', async () => {
    const r = await t.eval(()=>({
      list: cfgLabels('business.statuses'),
      tone: statusTone('Declined'),
    }));
    if(r.list.indexOf('Declined') < 0)
      throw new Error('the list reads: ' + r.list.join(' | '));
    if(r.list.indexOf('Completed') < 0) throw new Error('Completed went missing: ' + r.list.join(' | '));
    if(r.tone !== 'danger') throw new Error('a declined entry draws as "' + r.tone + '", not red');
    return r.list.join(' · ') + ' — and Declined draws red';
  });

  await t.step('and finished still means Completed, with Declined after it', async () => {
    const r = await t.eval(()=>{
      const shipped = businessDoneStatus();
      /* A firm that renamed the shipped list keeps working: the last
         status that is not a refusal is the finished one. */
      const was = DB.settings['business.statuses'];
      DB.settings['business.statuses'] = {value:
        ['Logged','Working','Booked','Declined'].map(l=>listItem(l)), updatedAt:'', updatedBy:'t'};
      const renamed = businessDoneStatus();
      DB.settings['business.statuses'] = was;
      return {shipped, renamed, after: businessDoneStatus()};
    });
    if(r.shipped !== 'Completed')
      throw new Error('finished business reads "' + r.shipped + '" now that Declined is last');
    if(r.renamed !== 'Booked')
      throw new Error('a firm with its own words gets "' + r.renamed + '", not their last real status');
    if(r.after !== 'Completed') throw new Error('the probe left the setting changed');
    return 'Completed on the shipped list, Booked on a firm’s own — never the refusal';
  });

  t.section('refused business is not business');

  await t.step('it is out of the pipeline, the total and the month', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const ids = await (${SEED})();
      navigate('business');
      const root = document.getElementById('root');
      const txt = (root.textContent || '').replace(/\\s+/g,' ');
      /* The figures are read as the label and the money beside it, so a
         number that happens to appear in a row below cannot answer for
         a card above. */
      const fig = label => {
        const m = txt.match(new RegExp(label + '\\\\s*(\u20b9[0-9,]+|[0-9]+%)'));
        return m ? m[1] : null;
      };
      return {ids,
        projected: fig('Projected'), actual: fig('Actual'),
        gap: fig('Gap'), achievement: fig('Achievement'),
        total: fig('Total Business Logged'), completed: fig('Completed'),
        pipeline: fig('Pipeline'),
        listed: Array.from(root.querySelectorAll('tbody tr'))
          .map(tr=>(tr.textContent || '').replace(/\\s+/g,' ').trim())
          .filter(x=>/9,00,000/.test(x)).length};
    })()`));
    /* 1,00,000 completed and 50,000 still working is 1,50,000 standing.
       The 9,00,000 that was declined is in none of it. */
    const want = {projected:'\u20b91,50,000', actual:'\u20b91,00,000', gap:'\u20b950,000',
                  achievement:'67%', total:'\u20b91,50,000', completed:'\u20b91,00,000',
                  pipeline:'\u20b950,000'};
    const wrong = Object.keys(want).filter(k=>r[k] !== want[k])
      .map(k=>k + ' reads ' + r[k] + ', not ' + want[k]);
    if(wrong.length) throw new Error(wrong.join('; '));
    if(!r.listed) throw new Error('the declined entry is not listed at all \u2014 it has to stay on the record');
    return 'Projected, Total and Pipeline all count the 1,50,000 standing and none of the declined '
         + '9,00,000, which is still listed';
  });

  await t.step('and the dashboard pipeline leaves it out too', async () => {
    const r = await t.eval(()=>{
      const all = (DB.businessEntries || []).filter(e=>!e.deletedAt && e.clientId === 'CMS-DECL');
      const f = mdPipelineFigures();
      const flat = JSON.stringify(f);
      return {had: all.length, flat, declined: all.filter(e=>businessIsDeclined(e)).length};
    });
    if(r.declined !== 1) throw new Error('the fixture has ' + r.declined + ' declined entries');
    if(/900000/.test(r.flat.replace(/[^0-9,]/g,'')) && /900000/.test(r.flat))
      throw new Error('the declined amount reached the dashboard pipeline');
    return 'the declined 9,00,000 is not in the dashboard pipeline either';
  });

  t.section('a firm that already holds its own list');

  await t.step('Declined is added once, and stays off if they take it off', async () => {
    const r = await t.eval(async ()=>{
      DB.settings['business.statuses'] = {value:
        ['Pending from Client Consent','Not Started','In Process','Completed'].map(l=>listItem(l)),
        updatedAt:'', updatedBy:'t'};
      delete DB.config.businessDeclinedAt;
      await save('settings'); await save('config');
      const added = await migrateBusinessDeclined();
      const after = cfgLabels('business.statuses');
      /* Twice is once. */
      const again = await migrateBusinessDeclined();
      /* And a firm that then removes it has removed it. */
      DB.settings['business.statuses'] = {value:
        ['Pending from Client Consent','Not Started','In Process','Completed'].map(l=>listItem(l)),
        updatedAt:'', updatedBy:'t'};
      await save('settings');
      const third = await migrateBusinessDeclined();
      const kept = cfgLabels('business.statuses');
      return {added, after, again, third, kept};
    });
    if(r.added !== 1) throw new Error('the migration added ' + r.added + ' to a list that lacked it');
    if(r.after.indexOf('Declined') < 0) throw new Error('the list reads: ' + r.after.join(' | '));
    if(r.after.slice(-1)[0] !== 'Declined') throw new Error('it was not added at the end: ' + r.after.join(' | '));
    if(r.again) throw new Error('it ran a second time');
    if(r.third) throw new Error('it put the status back after the firm removed it');
    if(r.kept.indexOf('Declined') >= 0) throw new Error('the firm’s removal did not stick');
    return 'added once at the end; it does not run twice, and a firm that removes it keeps it removed';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
