/* THE AUDIT: SIX THINGS THE FIRM ASKED FOR, CHECKED AGAINST WHAT IS
   ACTUALLY SAVED.

   Every one of these has its own suite already. This one exists
   because the firm asked a different question: not "does each change
   work in the place it was made" but "is it true of the system".
   So these steps go the long way round — through the saved records,
   the transactions raised, the markup every module actually renders
   — rather than calling the function that was changed and believing
   its answer. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();
  let cid = '';

  await t.step('a client to hang the audit off', async () => {
    cid = await t.eval(async ()=>{
      let c = DB.clients.find(x=>x.cmsName === 'ZZ Audit Client');
      if(!c){
        c = {id: uid('CMS'), cmsName:'ZZ Audit Client', status:'Active', branch:'Varanasi',
          rmName: currentUser, createdAt:new Date().toISOString()};
        DB.clients.push(c); await save('clients');
      }
      return c.id;
    });
    return cid;
  });

  t.section('1 — each allocation line raises its own transaction');

  await t.step('four lines, four transactions, each naming its own line', async () => {
    const r = await t.eval(async (id)=>{
      const rec = {id: uid('REC'), clientId: id, status:'Sent to Client',
        productCategory:'Mutual Fund', investmentMode:'Lumpsum',
        acceptedAt:new Date().toISOString(), createdAt:new Date().toISOString(),
        schemes:[{schemeName:'ZZ Au A', amount:'100000', transactionType:'Purchase'},
                 {schemeName:'ZZ Au B', amount:'200000', transactionType:'Purchase'},
                 {schemeName:'ZZ Au C', amount:'300000', transactionType:'Purchase'},
                 {schemeName:'ZZ Au D', amount:'400000', transactionType:'Purchase'}]};
      DB.recommendations.push(rec);
      await save('recommendations');
      await onAllocationAccepted(rec);
      /* A second consent must not raise a second set. */
      await onAllocationAccepted(rec);
      const txns = (DB.transactions || []).filter(x=>x.recommendationId === rec.id && !x.deletedAt);
      return {n: txns.length,
              amounts: txns.map(x=>numVal(x.amount)).sort((a,b)=>a-b),
              lines: new Set(txns.map(x=>x.allocLineId)).size,
              named: txns.every(x=>!!x.allocLineId),
              toClient: txns.every(x=>x.clientId === id)};
    }, cid);
    if(r.n !== 4) throw new Error('four lines raised ' + r.n + ' transactions');
    if(r.amounts.join(',') !== '100000,200000,300000,400000')
      throw new Error('the amounts read ' + r.amounts.join(', '));
    if(r.lines !== 4) throw new Error('the transactions name ' + r.lines + ' distinct lines');
    if(!r.named) throw new Error('a transaction does not name the line it came from');
    if(!r.toClient) throw new Error('a transaction was filed against another client');
    return 'four saved transactions, four distinct lines, right amounts, and a re-consent added none';
  });

  t.section('2 — search-as-you-type, everywhere a record is picked');

  await t.step('every record picker in the system is one type-ahead field', async () => {
    const r = await t.eval(async ()=>{
      /* Enough of everything for the threshold to bite. */
      const bulk = (n, make) => { for(let i = 0; i < n; i++) make(i); };
      if(DB.clients.filter(c=>!c.deletedAt).length < 12)
        bulk(12, i=>DB.clients.push({id: uid('CMS'), cmsName:'ZZ Au Client ' + i, status:'Active'}));
      if(DB.leads.filter(c=>!c.deletedAt).length < 12)
        bulk(12, i=>DB.leads.push({id: uid('LMS'), firstName:'ZZ Au Lead', lastName:''+i}));
      if(DB.team.filter(isMemberActive).length < 12)
        bulk(12, i=>DB.team.push({id: uid('TM'), name:'ZZ Au Member ' + i, status:'Active',
          role: roleList()[2] || 'Executive', scope:'own',
          adminFlags: fullAdminFlags(false), perms: fullPerms(true)}));
      if(DB.amcs.filter(x=>!x.deletedAt).length < 12)
        bulk(12, i=>DB.amcs.push({id: uid('AMC'), name:'ZZ Au AMC ' + i, status:'Active'}));
      if(DB.schemes.filter(x=>!x.deletedAt).length < 12)
        bulk(12, i=>DB.schemes.push({id: uid('SCH'), schemeName:'ZZ Au Scheme ' + i, amcId:''}));
      if((DB.partners||[]).filter(x=>!x.deletedAt).length < 12)
        bulk(12, i=>DB.partners.push({id: uid('PTR'), name:'ZZ Au Partner ' + i}));
      if((DB.projects||[]).filter(x=>!x.deletedAt).length < 12)
        bulk(12, i=>DB.projects.push({id: uid('PRJ'), name:'ZZ Au Project ' + i}));
      await save('clients'); await save('leads'); await save('team');
      await save('amcs'); await save('schemes'); await save('partners'); await save('projects');
      const one = html => html.indexOf('pick-input') >= 0;
      const out = {};
      /* The form builder every module's dialog goes through. */
      ['clientselect','leadselect','team','amcselect','schemeselect',
       'partnerselect','projectselect'].forEach(tp=>{
        out[tp] = one(fieldInput({k:'zz_' + tp, l:'X', t:tp}, ''));
      });
      /* And the five built by hand outside it. */
      const grab = fn => { try { fn(); } catch(e){}
        const el = document.getElementById('modalBody');
        const h = el ? el.innerHTML : ''; closeModal(); return h; };
      out.queryForm   = one(grab(()=>openQueryForm()));
      out.callForm    = one(grab(()=>openCallFormFor('client', DB.clients[0].id)));
      out.arcSchedule = one(grab(()=>openArcPickClient()));
      return out;
    });
    const missing = Object.keys(r).filter(k=>!r[k]);
    if(missing.length) throw new Error('still not a type-ahead: ' + missing.join(', '));
    return Object.keys(r).length + ' pickers checked — the seven the form builder makes and '
      + 'the ticket, call and review ones built by hand';
  });

  t.section('3 — an allocation row opens the work, not a summary');

  await t.step('a draft opens the editor; a sent sheet stays read-only', async () => {
    const r = await t.eval(async (id)=>{
      const mk = status => { const rec = {id: uid('REC'), clientId: id, status,
        productCategory:'Mutual Fund', investmentMode:'Lumpsum', schemes:[], attachments:[],
        createdAt:new Date().toISOString()}; DB.recommendations.push(rec); return rec; };
      const draft = mk('Draft'), sent = mk('Sent to Client');
      await save('recommendations');
      const body = () => (document.getElementById('modalBody') || {}).innerHTML || '';
      openAllocationRow(draft.id);
      const onDraft = {editor: body().indexOf('Save Asset Allocation') >= 0,
                       send: /Save &amp; Send (to Client|for Internal)/.test(body())};
      closeModal();
      openAllocationRow(sent.id);
      const onSent = {readOnly: body().indexOf('Save Asset Allocation') < 0};
      closeModal();
      return {onDraft, onSent};
    }, cid);
    if(!r.onDraft.editor) throw new Error('a draft row did not open the editor');
    if(!r.onDraft.send) throw new Error('the editor has no Send on it, so it is still two pages');
    if(!r.onSent.readOnly)
      throw new Error('a sheet already with the client opened editable underneath them');
    return 'a draft opens straight into the editor with Send on the footer; a sent sheet does not';
  });

  t.section('4 — Add Scheme lands on the scheme it added');

  await t.step('the new line is scrolled to and focused', async () => {
    const r = await t.eval(async (id)=>{
      const rec = DB.recommendations.find(x=>x.clientId === id && x.status === 'Draft');
      window._allocDraft = JSON.parse(JSON.stringify(Object.assign({schemes:[], attachments:[]}, rec)));
      window._allocDraft.schemes = [allocNewLineFor(window._allocDraft)];
      renderAllocationForm(true);
      let scrolled = null;
      const real = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function(o){ scrolled = {cls: this.className, o}; };
      allocAddScheme();
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      Element.prototype.scrollIntoView = real;
      const lines = document.querySelectorAll('.alloc-line');
      const active = document.activeElement;
      const inLast = !!(lines.length && lines[lines.length - 1].contains(active));
      closeModal();
      return {n: lines.length, scrolled: !!scrolled, onLine: scrolled && /alloc-line/.test(scrolled.cls||''),
              smooth: scrolled && scrolled.o && scrolled.o.behavior === 'smooth', inLast,
              /* In the new line is not enough: a painted dropdown leaves
                 its <select> on the line, off the screen, and the cursor
                 must not land in that. */
              onSomethingVisible: !!(active && !active.classList.contains('pick-native')
                && active.type !== 'hidden'),
              landedOn: active ? (active.className || active.tagName) : 'nothing'};
    }, cid);
    if(r.n !== 2) throw new Error('Add Scheme left ' + r.n + ' lines');
    if(!r.scrolled) throw new Error('nothing was scrolled to');
    if(!r.onLine) throw new Error('it scrolled to something that is not a scheme line');
    if(!r.smooth) throw new Error('the scroll was not smooth');
    if(!r.inLast) throw new Error('the cursor did not land in the new line');
    if(!r.onSomethingVisible)
      throw new Error('the cursor landed on something nobody can see: ' + r.landedOn);
    return 'the new line is scrolled to smoothly and the cursor is in it, on a box you can see';
  });

  t.section('5 and 6 — the new line inherits, and the money is shared');

  await t.step('inherits category and platform; splits the agreed amount; refuses to exceed it',
    async () => {
    const r = await t.eval(async (id)=>{
      const entry = {id: uid('DBT'), clientId: id, dbtType:'Investment', amount:'1200000',
        transactionType:'Purchase', productCategory:'Mutual Fund', platform:'Finowise',
        status:'Pending from Client Consent', createdAt:new Date().toISOString()};
      DB.businessEntries.push(entry); await save('businessEntries');
      const rec = {id: uid('REC'), clientId: id, status:'Draft', sourceModule:'DBT',
        dbtEntryId: entry.id, productCategory:'Mutual Fund', investmentMode:'Lumpsum',
        schemes:[], attachments:[], createdAt:new Date().toISOString()};
      DB.recommendations.push(rec); await save('recommendations');
      window._allocDraft = JSON.parse(JSON.stringify(rec));
      const d = window._allocDraft;
      d.schemes = [allocNewLineFor(d)];
      d.schemes[0].productCategory = 'Mutual Fund';
      d.schemes[0].platform = 'Finowise';
      d.schemes[0].schemeName = 'ZZ Au Split One';
      allocSpreadAmounts(d);
      renderAllocationForm(true);
      allocAddScheme();
      const two = d.schemes.map(l=>numVal(l.amount));
      const inherited = {cat: d.schemes[1].productCategory, plat: d.schemes[1].platform};
      allocAddScheme();
      const three = d.schemes.map(l=>numVal(l.amount));
      allocAmountChanged(0, '800000');
      const typed = d.schemes.map(l=>numVal(l.amount));
      /* Over the top: 4,00,000 is left across two lines; ask for 9,00,000. */
      allocAmountChanged(1, '900000');
      const capped = d.schemes.map(l=>numVal(l.amount));
      /* Capping line 2 at the whole remaining balance leaves line 3
         holding nothing. The sheet says so rather than letting the
         save explain it badly. */
      const starvedSaid = /nothing left to allocate/.test(allocBudgetNoteHtml(d));
      /* Make room again so the sheet is savable, and name the lines:
         a sheet will not save without a scheme on every line, which
         is right. */
      allocAmountChanged(1, '250000');
      d.schemes.forEach((l, n)=>{ if(!l.schemeName) l.schemeName = 'ZZ Au Split ' + (n + 1); });
      /* And it survives a save: the figures on the record, not the form. */
      await saveRecommendation(rec.id);
      const onRecord = (DB.recommendations.find(x=>x.id === rec.id).schemes || [])
        .map(l=>numVal(l.amount));
      return {two, three, inherited, typed, capped, onRecord, starvedSaid,
              sum: onRecord.reduce((a,b)=>a+b, 0)};
    }, cid);
    /* The cap interrupts on a timer, after the redraw it explains. */
    await t.wait(150);
    if(r.inherited.cat !== 'Mutual Fund' || r.inherited.plat !== 'Finowise')
      throw new Error('the new line did not inherit: ' + JSON.stringify(r.inherited));
    if(r.two.join(',') !== '600000,600000') throw new Error('two lines read ' + r.two.join(', '));
    if(r.three.join(',') !== '400000,400000,400000')
      throw new Error('three lines read ' + r.three.join(', '));
    if(r.typed[0] !== 800000) throw new Error('the typed 8,00,000 became ' + r.typed[0]);
    if(r.typed[1] + r.typed[2] !== 400000)
      throw new Error('the rest was not shared: ' + r.typed.join(', '));
    if(r.capped[1] !== 400000)
      throw new Error('the over-ask took ' + r.capped[1] + ' of the 4,00,000 available');
    /* The cap says so in a pop-up now, which the harness collects. */
    if(!t.dialogs.some(x=>/was set to/.test(String(x)))) throw new Error('it capped silently');
    if(!r.starvedSaid)
      throw new Error('a line left holding nothing was not called out on the sheet');
    if(r.sum > 1200000)
      throw new Error('the SAVED record adds to ' + r.sum + ', over the agreed 12,00,000');
    if(!r.sum) throw new Error('nothing was saved at all');
    return 'inherited Mutual Fund / Finowise; 2×6L, 3×4L; 8L typed and held; an over-ask capped '
      + 'at 4L with a message; the saved record totals ' + r.sum;
  });

  await t.step('nothing was alerted but the cap itself', async () => {
    const odd = t.dialogs.filter(x=>!/was set to/.test(String(x)));
    if(odd.length) throw new Error('alerts: ' + odd.join(' | ').slice(0, 300));
    return t.dialogs.length + ' pop-up(s), every one of them the cap explaining itself';
  });
});
