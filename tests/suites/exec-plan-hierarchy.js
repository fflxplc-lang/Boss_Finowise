/* THE EXECUTION PLANS STAND IN THE SAME SHAPE AS THE DBTs, AND THE
   FAMILY IS ASKED ONCE PER FAMILY OF PRODUCTS.

   Part one of the restructure put the business into a product-wise
   tree: one Main DBT for Mutual Fund (funds and SIFs together), one
   for Wealth Product, the transaction types under them. This is the
   half above it and the half after it:

     Mutual Fund          Main Execution Plan   (a heading, no money)
       └─ Purchase        a sheet an adviser maps
       └─ SIP             a sheet an adviser maps
                          → ONE consent for all of it

     Wealth Product       Main Execution Plan
       └─ PMS · Purchase
       └─ AIF · SIP
                          → ONE consent, its own, for all of it

   Two things are being guarded. The first is that the Main plan is a
   heading and nothing else: it holds no schemes, it is in no total,
   and it never appears in the Execution Tracker as a sheet somebody
   could fill in — or the same money is counted twice.

   The second is the gate. A consent cannot go to a family until every
   sheet under that Main plan names a scheme against every rupee that
   was agreed, and when it does go, it goes once: one link carrying
   every sheet of that category, and the other category untouched. */
const {suite} = require('../lib/harness');

const LEAD = 'LMS-EXH';
const SEED = `async function(lines){
  let l = DB.leads.find(x=>x.id === '${LEAD}');
  if(!l){ l = {id:'${LEAD}'}; DB.leads.push(l); }
  Object.assign(l, {firstName:'ZZ Exec', lastName:'Hier', mobile:'9800222777',
    email:'exec@example.com', dob:'1986-03-03', assignedTo: currentUser,
    transformationForm:'MULTIGOAL', createdAt:new Date().toISOString(),
    iseqScore:50, iseqMaxScore:100, iseqCategory:'Moderate'});
  if(!stateOf('LMS', l)) initState('LMS', l);
  l.formData = {MULTIGOAL:{name:'ZZ Exec Hier', mobile:'9800222777', email:'exec@example.com',
    dob:'1986-03-03', mg_goals:[{goal:'Car', years:'5', currentValue:'2500000',
                                 inflation:'7', returns:'12'}]}};
  l.planRounds = [];
  DB.businessEntries = (DB.businessEntries||[]).filter(b=>b.leadId !== l.id);
  DB.recommendations = (DB.recommendations||[]).filter(r=>r.leadId !== l.id);
  DB.transactions = (DB.transactions||[]).filter(x=>x.leadId !== l.id);
  DB.docLinks = (DB.docLinks||[]).filter(x=>x.leadId !== l.id);
  await save('leads'); await save('businessEntries'); await save('recommendations');
  await save('transactions'); await save('docLinks');
  await markPlanInputSubmitted(l, 'Client');
  const round = await recomputePlan(l);
  round.allocation.lines = lines;
  round.seniorStatus = 'Approved';
  await save('leads');
  const rec = planRecordOf(l.id);
  await planRaiseDbtHierarchy(rec, latestPlanRound(rec));
  return l.id;
}`;

const LINES = `[
  {label:'Car', product:'Mutual Fund', platform:'Finowise', transactionType:'Purchase',
   schemeName:'ZZ Bluechip', amount:1000000},
  {label:'Car', product:'SIF', platform:'Finowise', transactionType:'Purchase',
   schemeName:'ZZ SIF One', amount:200000},
  {label:'Car', product:'Mutual Fund', platform:'Ametra', transactionType:'SIP',
   schemeName:'ZZ Flexi', amount:50000},
  {label:'Car', product:'PMS', platform:'Ametra', transactionType:'Purchase',
   schemeName:'ZZ PMS One', amount:5000000},
  {label:'Car', product:'AIF', platform:'Ametra', transactionType:'SIP',
   schemeName:'ZZ AIF One', amount:100000}
]`;

/* Name a scheme on every line of every sheet of a category: what an
   adviser does on the sheet, done to all of them at once. */
const MAP = `async function(category){
  const rec = planRecordOf('${LEAD}'), round = latestPlanRound(rec);
  for(const s of allocLeavesFor('${LEAD}', round.n, category)){
    allocSchemes(s).forEach((l, i)=>{ l.schemeName = 'ZZ Mapped ' + i; });
  }
  await save('recommendations');
}`;

const SHAPE = `function(){
  const rec = planRecordOf('${LEAD}'), round = latestPlanRound(rec);
  const mine = (DB.recommendations||[]).filter(r=>!r.deletedAt && r.leadId === '${LEAD}');
  return {
    heads: mine.filter(allocIsHeading).map(h=>({id:h.id, cat:h.dbtCategory,
      amount:Number(h.headAmount), schemes: allocSchemes(h).length, status: h.status,
      rolled: allocHeadStatus(h)})).sort((a,b)=>a.cat.localeCompare(b.cat)),
    sheets: allocBusinessOnly(mine).map(s=>({id:s.id, cat:s.dbtCategory, path:s.dbtPath,
      parent:s.parentRecommendationId || '', status:s.status, total: allocTotal(s),
      mapped: allocMappingState(s).mapped, why: allocMappingWhy(s)}))
      .sort((a,b)=>String(a.path).localeCompare(String(b.path))),
    mf: allocCategoryReady('${LEAD}', round.n, 'Mutual Fund'),
    wealth: allocCategoryReady('${LEAD}', round.n, 'Wealth Product'),
  };
}`;

suite(async t => {
  await t.home();
  /* The page reconciles itself against the server a beat after the
     last step, and the browser is shut by then: the fetch that fails
     is the teardown, not the application. */
  t.expectConsole(/storage (get|set) failed/);

  t.section('one Main Execution Plan per family of products');

  await t.step('the tree the blueprint raises has a head over each category', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      await (${SEED})(${LINES});
      const s = (${SHAPE})();
      return {heads: s.heads, sheets: s.sheets};
    })()`));
    const cats = r.heads.map(h=>h.cat).join(', ');
    if(cats !== 'Mutual Fund, Wealth Product')
      throw new Error('the heads read: ' + (cats || 'none at all'));
    /* 10,00,000 + 2,00,000 SIF purchase + 50,000 SIP */
    if(r.heads[0].amount !== 1250000)
      throw new Error('the Mutual Fund head covers ' + r.heads[0].amount);
    if(r.heads[1].amount !== 5100000)
      throw new Error('the Wealth Product head covers ' + r.heads[1].amount);
    if(r.heads.some(h=>h.schemes))
      throw new Error('a head carries schemes of its own, so its money is on two records');
    if(r.sheets.length !== 4)
      throw new Error(r.sheets.length + ' sheets under them: ' + r.sheets.map(s=>s.path).join(', '));
    const orphan = r.sheets.filter(s=>!s.parent);
    if(orphan.length) throw new Error('a sheet hangs off nothing: ' + orphan.map(s=>s.path).join(', '));
    const wrong = r.sheets.filter(s=>{
      const h = r.heads.find(x=>x.id === s.parent);
      return !h || h.cat !== s.cat;
    });
    if(wrong.length) throw new Error('a sheet is under the wrong head: ' + wrong.map(s=>s.path).join(', '));
    return '2 heads — ' + r.heads.map(h=>h.cat + ' ' + h.amount).join(' and ')
      + ' — over ' + r.sheets.length + ' sheets';
  });

  await t.step('a head is a heading, not a sheet the tracker lists', async () => {
    const r = await t.eval(()=>{
      navigate('recommendations');
      const rows = Array.from(document.querySelectorAll('#recoTable tbody tr'));
      const ids = rows.map(tr=>(tr.querySelector('.cp-code') || {}).textContent || '');
      const heads = (DB.recommendations||[]).filter(x=>!x.deletedAt && allocIsHeading(x)).map(x=>x.id);
      return {listed: heads.filter(h=>ids.indexOf(h) >= 0),
              sheetsListed: ids.filter(x=>/^REC/.test(x)).length,
              path: (document.querySelector('#recoTable tbody') || {}).textContent || ''};
    });
    if(r.listed.length)
      throw new Error('the Execution Tracker lists a heading as a sheet: ' + r.listed.join(', '));
    if(!/Mutual Fund\s*›\s*SIP/.test(r.path.replace(/\s+/g, ' ')))
      throw new Error('a sheet does not say where it sits in the hierarchy');
    return r.sheetsListed + ' sheets listed, no headings among them, each showing its path';
  });

  t.section('the consent waits until every sheet is mapped');

  await t.step('a sheet opened from a DBT is not mapped yet, and says why', async () => {
    const r = await t.eval(new Function(`return (${SHAPE})()`));
    if(r.mf.ready) throw new Error('the Mutual Fund consent is ready before a scheme was named');
    if(r.wealth.ready) throw new Error('the Wealth Product consent is ready before a scheme was named');
    const why = r.sheets.map(s=>s.why);
    if(!why.every(w=>/no scheme named/.test(w)))
      throw new Error('the sheets explain themselves as: ' + why.join(' | '));
    return r.mf.why;
  });

  await t.step('pressing Send anyway says which sheet is short, and sends nothing', async () => {
    const before = await t.eval(()=>DB.docLinks.length);
    t.dialogs.length = 0;
    await t.eval(new Function(`
      const rec = planRecordOf('${LEAD}'), round = latestPlanRound(rec);
      sendCategoryConsent(allocHeadFor('${LEAD}', round.n, 'Mutual Fund').id);`));
    const after = await t.eval(()=>DB.docLinks.length);
    const said = t.dialogs.join(' ');
    if(after !== before) throw new Error('a link was minted for a half-mapped category');
    if(!/cannot go out yet/.test(said))
      throw new Error('it said: ' + (said || 'nothing at all'));
    if(!/REC/.test(said))
      throw new Error('it did not name the sheets that are holding it up: ' + said);
    return 'refused, naming the sheets — ' + said.split('\n').filter(Boolean).length + ' lines';
  });

  await t.step('mapping one category readies that one and not the other', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      await (${MAP})('Mutual Fund');
      return (${SHAPE})();
    })()`));
    if(!r.mf.ready) throw new Error('Mutual Fund is still not ready: ' + r.mf.why);
    if(r.wealth.ready) throw new Error('mapping the funds readied the wealth products too');
    return 'Mutual Fund ready (' + r.mf.sheets.length + ' sheets), Wealth Product: ' + r.wealth.why;
  });

  t.section('one consent per category, and only for that category');

  await t.step('the send carries every Mutual Fund sheet on one link', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const rec = planRecordOf('${LEAD}'), round = latestPlanRound(rec);
      const head = allocHeadFor('${LEAD}', round.n, 'Mutual Fund');
      sendCategoryConsent(head.id);
      const offered = (window._allocSend || {}).id || [];
      document.getElementById('f_allocMailTo').value = 'exec@example.com';
      await confirmSendAllocationToClient();
      const link = (DB.docLinks||[]).filter(l=>l.leadId === '${LEAD}').slice(-1)[0] || {};
      const s = (${SHAPE})();
      return {offered, link: {ids: link.allocationIds || [], cat: link.dbtCategory,
                head: link.headRecommendationId, round: link.planRound},
              links: (DB.docLinks||[]).filter(l=>l.leadId === '${LEAD}').length,
              headId: head.id, shape: s};
    })()`));
    const mf = r.shape.sheets.filter(s=>s.cat === 'Mutual Fund').map(s=>s.id).sort();
    if(r.offered.slice().sort().join(',') !== mf.join(','))
      throw new Error('the send offered ' + r.offered.join(', ') + ', not the two Mutual Fund sheets');
    if(r.links !== 1) throw new Error(r.links + ' links went out for one consent');
    if(r.link.ids.slice().sort().join(',') !== mf.join(','))
      throw new Error('the link carries ' + r.link.ids.join(', '));
    if(r.link.cat !== 'Mutual Fund')
      throw new Error('the link does not say which consent it is: ' + (r.link.cat || 'blank'));
    if(r.link.head !== r.headId)
      throw new Error('the link does not point back at the Main plan');
    const sent = r.shape.sheets.filter(s=>s.status === 'Sent to Client').map(s=>s.cat);
    if(sent.join(',') !== 'Mutual Fund,Mutual Fund')
      throw new Error('what went to the client reads: ' + sent.join(', '));
    const head = r.shape.heads.find(h=>h.cat === 'Mutual Fund');
    if(head.status !== 'Sent to Client')
      throw new Error('the Main plan still reads ' + head.status);
    return 'one link, both Mutual Fund sheets on it, the Main plan with them';
  });

  await t.step('the wealth products are still sitting here, unasked', async () => {
    const r = await t.eval(new Function(`return (${SHAPE})()`));
    const w = r.sheets.filter(s=>s.cat === 'Wealth Product');
    if(w.some(s=>s.status !== 'Draft'))
      throw new Error('a wealth sheet moved on the funds consent: ' + w.map(s=>s.status).join(', '));
    const head = r.heads.find(h=>h.cat === 'Wealth Product');
    if(head.rolled !== 'Draft') throw new Error('its Main plan reads ' + head.rolled);
    return w.length + ' wealth sheets untouched, their Main plan still a draft';
  });

  await t.step('and they get a consent of their own once they are mapped', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      await (${MAP})('Wealth Product');
      const rec = planRecordOf('${LEAD}'), round = latestPlanRound(rec);
      const head = allocHeadFor('${LEAD}', round.n, 'Wealth Product');
      sendCategoryConsent(head.id);
      document.getElementById('f_allocMailTo').value = 'exec@example.com';
      await confirmSendAllocationToClient();
      const links = (DB.docLinks||[]).filter(l=>l.leadId === '${LEAD}');
      return {links: links.map(l=>({cat: l.dbtCategory, n:(l.allocationIds||[]).length,
                                    token: l.token})),
              shape: (${SHAPE})()};
    })()`));
    if(r.links.length !== 2)
      throw new Error(r.links.length + ' consent links for two categories');
    if(r.links.map(l=>l.cat).sort().join(', ') !== 'Mutual Fund, Wealth Product')
      throw new Error('the two links read: ' + r.links.map(l=>l.cat).join(', '));
    if(new Set(r.links.map(l=>l.token)).size !== 2)
      throw new Error('both categories went out on the same token');
    if(r.shape.sheets.some(s=>s.status !== 'Sent to Client'))
      throw new Error('a sheet was left behind: '
        + r.shape.sheets.map(s=>s.path + ' ' + s.status).join(' | '));
    return 'two consents — ' + r.links.map(l=>l.cat + ' (' + l.n + ')').join(' and ');
  });

  t.section('and none of it can be done twice');

  await t.step('raising the hierarchy again makes no second head or sheet', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const rec = planRecordOf('${LEAD}'), round = latestPlanRound(rec);
      const before = (${SHAPE})();
      await planRaiseDbtHierarchy(rec, round);
      await planRaiseDbtHierarchy(rec, round);
      const after = (${SHAPE})();
      return {beforeHeads: before.heads.length, afterHeads: after.heads.length,
              beforeSheets: before.sheets.length, afterSheets: after.sheets.length,
              parents: after.sheets.map(s=>s.parent)};
    })()`));
    if(r.afterHeads !== r.beforeHeads)
      throw new Error(r.beforeHeads + ' heads became ' + r.afterHeads);
    if(r.afterSheets !== r.beforeSheets)
      throw new Error(r.beforeSheets + ' sheets became ' + r.afterSheets);
    if(new Set(r.parents).size !== 2)
      throw new Error('the sheets now point at ' + new Set(r.parents).size + ' heads');
    return 'two more presses: still ' + r.afterHeads + ' heads and ' + r.afterSheets + ' sheets';
  });

  t.section('the lead’s own page shows the shape and the one button');

  await t.step('the plan tab draws each Main plan with its sheets under it', async () => {
    const r = await t.eval(()=>{
      const html = planExecTreeHtml(planRecordOf('LMS-EXH'));
      const d = document.createElement('div'); d.innerHTML = html;
      const txt = (d.textContent || '').replace(/\s+/g, ' ');
      return {tables: d.querySelectorAll('table').length,
              mains: (txt.match(/Main/g) || []).length,
              mapped: (txt.match(/mapped/g) || []).length,
              consent: /One consent covered all/.test(txt),
              send: /sendCategoryConsent/.test(html),
              txt: txt.slice(0, 200)};
    });
    if(r.tables !== 2) throw new Error(r.tables + ' tables drawn, expected one per category');
    if(r.mains !== 2) throw new Error('the Main plans are labelled ' + r.mains + ' times');
    if(r.mapped < 4) throw new Error('the sheets do not say whether they are mapped');
    if(!r.consent) throw new Error('a category already sent does not say so: ' + r.txt);
    return r.tables + ' categories drawn, each with its sheets and where the consent stands';
  });
});
