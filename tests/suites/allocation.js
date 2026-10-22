/* THE ALLOCATION TABLE, AND WHICH GOAL A LINE IS FOR.

   Modification 19 asked for the For column to go. It repeated under every
   line the goal already written across the top of the box the line sits in.
   The job it did — pointing a line at a different goal — became ⇄ Goal, a
   row action, and this is what holds that bargain to its terms: the column
   is gone, the job is not. */
const {suite} = require('../lib/harness');

suite(async t => {
  t.section('the column is gone, in both renderings');

  await t.step('no For header, no per-row goal box, and ⇄ Goal in their place', async () => {
    const r = await t.eval(()=>{
      const src = Array.from(document.querySelectorAll('script')).map(s=>s.textContent).join('\n');
      const i = src.indexOf('alloc-goal-head');
      if(i < 0) return {err:'the allocation renderer was not found at all'};
      const chunk = src.slice(i, i + 1600);
      return {forCol: /<th>For<\/th>/.test(chunk),
              lbl: /f_planLbl\$\{i\}/.test(chunk),
              repoint: typeof window.openPlanLineGoal === 'function' && /⇄ Goal/.test(chunk),
              scheme: chunk.indexOf('Scheme / Strategy') >= 0,
              folio: chunk.indexOf('Folio / Account ID') >= 0};
    });
    if(r.err) throw new Error(r.err);
    if(r.forCol) throw new Error('the For column is still drawn');
    if(r.lbl) throw new Error('the per-row goal input is still drawn');
    if(!r.repoint) throw new Error('there is no way left to point a line at another goal');
    if(!r.scheme) throw new Error('the table does not say Scheme / Strategy');
    if(!r.folio) throw new Error('the table does not say Folio / Account ID');
    return 'gone from the header and the row; ⇄ Goal in their place';
  });

  await t.step('the subtotal lines its figure up under Amount', async () => {
    const src = await t.eval(()=>{
      const s = Array.from(document.querySelectorAll('script')).map(x=>x.textContent).join('\n');
      const i = s.indexOf('alloc-sub');
      return s.slice(i - 40, i + 120);
    });
    if(!/colspan="5">This goal/.test(src))
      throw new Error('the subtotal spans the wrong column count: ' + src.slice(0, 90));
    return 'five columns before the amount, read-only and editable alike';
  });

  t.section('⇄ Goal does the job the column used to');

  let leadId;
  await t.step('a line moves, keeps its money, and the move is audited', async () => {
    const r = await t.eval(async ()=>{
      const l = {id:uid('LEAD'), leadName:'ZZ Repoint', firstName:'ZZ', lastName:'Repoint',
        rmName:currentUser, createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('LMS', l);
      l.planRounds = [{n:1, type:'SEVENEVENTS', allocation:{lines:[
        {id:uid('ALLOC'), label:'Retirement', amount:100000, transactionType:'Lumpsum'}]}}];
      DB.leads.push(l); await save('leads');
      openPlanLineGoal(l.id, 0);
      const pick = document.getElementById('f_lineGoalPick');
      if(!pick) return {err:'the picker never opened'};
      const offered = Array.from(pick.options).map(o=>o.value);
      pick.value = '__other'; planLineGoalPicked();
      const other = document.getElementById('f_lineGoalOther');
      if(!other || other.closest('.field').style.display === 'none')
        return {err:'the free-text goal never appeared'};
      other.value = "Child's education";
      await savePlanLineGoal(l.id, 0);
      const line = DB.leads.find(x=>x.id===l.id).planRounds[0].allocation.lines[0];
      const audit = (DB.auditLog||[]).filter(a=>a.recordId===l.id && /Re-pointed/.test(a.action||''));
      return {id:l.id, offered, label:line.label, amount:line.amount,
              scheme:line.schemeId, audits:audit.length};
    });
    if(r.err) throw new Error(r.err);
    if(r.offered.indexOf('Retirement') < 0)
      throw new Error('the goal it already had was not offered: ' + r.offered.join('/'));
    if(r.label !== "Child's education") throw new Error('the line still reads ' + r.label);
    if(r.amount !== 100000) throw new Error('the amount changed to ' + r.amount);
    if(!r.audits) throw new Error('nothing was written to the audit');
    leadId = r.id;
    return 'moved to "' + r.label + '", amount untouched, ' + r.audits + ' audit entry';
  });

  await t.step('a goal already on the plan can be picked rather than retyped', async () => {
    const r = await t.eval(async (id)=>{
      openPlanLineGoal(id, 0);
      const pick = document.getElementById('f_lineGoalPick');
      if(!pick) return {err:'no picker'};
      const has = Array.from(pick.options).map(o=>o.value);
      pick.value = "Child's education";                   // the one it is already on
      await savePlanLineGoal(id, 0);
      const line = DB.leads.find(x=>x.id===id).planRounds[0].allocation.lines[0];
      const ov = document.getElementById('overlay');
      return {has, label:line.label, open: !!(ov && ov.classList.contains('show'))};
    }, leadId);
    if(r.err) throw new Error(r.err);
    if(r.has.indexOf("Child's education") < 0)
      throw new Error('its own goal is not in the list: ' + r.has.join('/'));
    if(r.label !== "Child's education") throw new Error('the label changed to ' + r.label);
    if(r.open) throw new Error('choosing the goal it is already on left the box open');
    return 'the list carries what the plan knows; choosing the same one just closes';
  });

  await t.step('a goal named as nothing is refused', async () => {
    const before = t.dialogs.length;
    const label = await t.eval(async (id)=>{
      openPlanLineGoal(id, 0);
      document.getElementById('f_lineGoalPick').value = '__other';
      planLineGoalPicked();
      document.getElementById('f_lineGoalOther').value = '   ';
      await savePlanLineGoal(id, 0);
      return DB.leads.find(x=>x.id===id).planRounds[0].allocation.lines[0].label;
    }, leadId);
    if(t.dialogs.length === before) throw new Error('an empty goal was accepted silently');
    if(label !== "Child's education") throw new Error('the line was blanked to "' + label + '"');
    await t.eval(()=>{ if(typeof closeModal==='function') closeModal(); });
    return 'refused, and the line kept the goal it had';
  });

  t.section('the scheme line is the thirteen the firm wrote down');

  await t.step('each one asked, in order, and the five that came off are gone', async () => {
    const r = await t.eval(()=>{
      const line = {schemeName:'ZZ Fund', amount:'100000', transactionType:'Purchase',
                    status: allocStatusAt('pending')};
      const html = allocSchemeLineHtml(line, 0, ['Lumpsum']);
      const labels = (html.match(/<label>[^<]*/g) || [])
        .map(x=>x.replace('<label>','').trim()).filter(Boolean);
      const sw = allocSchemeLineHtml(Object.assign({}, line, {transactionType:'Switch'}), 0, ['Lumpsum']);
      return {labels, toScheme: /<label>To Scheme/.test(sw),
              statusOpts: cfgLabels('alloc.lineStatuses'), pending: allocStatusAt('pending'),
              statusInHtml: html.indexOf(allocStatusAt('pending')) >= 0};
    });
    const want = ['Investment Category','Platform','Fund House (AMC)','Scheme / Strategy',
      'Transaction Type','Folio / Account ID','Amount','Remark','Fund Objective',
      'Fund Manager','About Fund Manager','Status'];
    const got = r.labels.map(l=>l.replace(/\s*\u2014.*$/, '').replace(/\s*\(\u20b9\)$/, '').trim());
    if(got.join(' | ') !== want.join(' | '))
      throw new Error('the line reads ' + got.join(' | '));
    ['Plan','Category','Risk Level (Riskometer)','Product','Allocation (%)'].forEach(l=>{
      if(got.indexOf(l) >= 0) throw new Error(l + ' is still asked on the line');
    });
    if(!r.toScheme) throw new Error('a Switch line does not ask where the money goes');
    if(r.pending !== 'Pending from Client Consent')
      throw new Error('a new line opens on "' + r.pending + '"');
    if(r.statusOpts.indexOf(r.pending) < 0)
      throw new Error('the status a line opens on is not among the options the picker offers');
    if(!r.statusInHtml) throw new Error('the picker does not carry the opening status at all');
    return 'twelve labels in the firm\u2019s order, To Scheme on a Switch, opening on Pending from Client Consent';
  });

  await t.step('the five that came off still reach the line from the master', async () => {
    const r = await t.eval(async ()=>{
      const amc = {id: uid('AMC'), name:'ZZ AMC', createdAt:new Date().toISOString()};
      DB.amcs.push(amc);
      const sc = {id: uid('SCH'), amcId: amc.id, schemeName:'ZZ Alloc Fund', fundCategory:'Flexi Cap',
        riskLevel:'Very High', plan:'Regular Plan', fundManager:'ZZ Manager',
        aboutFundManager:'Twenty years of it.', fundObjective:'Long-term capital appreciation',
        createdAt:new Date().toISOString()};
      DB.schemes.push(sc);
      await save('amcs'); await save('schemes');
      window._allocDraft = {id:'', clientId:'', schemes:[allocNewLineFor({})], attachments:[],
        productCategory:'Mutual Fund', investmentMode:'Lumpsum'};
      allocPickScheme(0, sc.id);
      const l = window._allocDraft.schemes[0];
      closeModal();
      return {cat:l.fundCategory, risk:l.riskLevel, plan:l.plan, fm:l.fundManager,
              about:l.aboutFundManager, obj:l.fundObjective};
    });
    ['cat','risk','plan','fm','about','obj'].forEach(k=>{
      if(!r[k]) throw new Error(k + ' did not come across from the Scheme Master');
    });
    return 'category, risk, plan, fund manager, about and objective all fetched from the scheme';
  });

  await t.step('typing the scheme name fetches the manager, without a click', async () => {
    const r = await t.eval(async ()=>{
      const amc = {id: uid('AMC'), name:'ZZ AMC 2', createdAt:new Date().toISOString()};
      DB.amcs.push(amc);
      const sc = {id: uid('SCH'), amcId: amc.id, schemeName:'ZZ Typed Growth Fund',
        fundCategory:'Mid Cap', riskLevel:'High', plan:'Regular Plan',
        fundManager:'ZZ Typed Manager', aboutFundManager:'Known for the long view.',
        fundObjective:'Capital appreciation over a cycle', createdAt:new Date().toISOString()};
      DB.schemes.push(sc);
      await save('amcs'); await save('schemes');
      window._allocDraft = {id:'', clientId:'', schemes:[allocNewLineFor({}), allocNewLineFor({})],
        attachments:[], productCategory:'Mutual Fund', investmentMode:'Lumpsum'};
      /* Typed in full, never clicked. Case and spacing as a paste from a
         factsheet would give it. */
      allocSchemeTyped(0, '  zz   typed growth FUND ');
      const l = window._allocDraft.schemes[0];
      /* Read now: a later line in this step deliberately types a name
         that matches nothing, and that must drop the link. */
      const took = {fm: l.fundManager, about: l.aboutFundManager, obj: l.fundObjective,
                    id: !!l.schemeId, cat: l.fundCategory};
      /* A manager the adviser wrote themselves is not overwritten. */
      window._allocDraft.schemes[1].fundManager = 'ZZ Mine, not the master\u2019s';
      allocSchemeTyped(1, 'ZZ Typed Growth Fund');
      const l2 = window._allocDraft.schemes[1];
      const second = {kept: l2.fundManager, obj: l2.fundObjective};
      /* A name the master has never heard of drops the link rather
         than leaving the line pointing at the last scheme it knew. */
      allocSchemeTyped(0, 'ZZ No Such Fund At All');
      const after = window._allocDraft.schemes[0];
      return Object.assign({}, took, {kept: second.kept, l2obj: second.obj,
        letGo: !after.schemeId, keptWords: after.schemeName});
    });
    if(r.fm !== 'ZZ Typed Manager') throw new Error('the manager did not come across: ' + r.fm);
    if(!r.about) throw new Error('About the Fund Manager stayed empty');
    if(!r.obj) throw new Error('the fund objective stayed empty');
    if(!r.id) throw new Error('the line was not tied to the master scheme');
    if(r.cat !== 'Mid Cap') throw new Error('the category did not come across');
    if(r.kept !== 'ZZ Mine, not the master\u2019s')
      throw new Error('an adviser\'s own words were overwritten: ' + r.kept);
    if(!r.l2obj) throw new Error('the blank fields on that line were not filled');
    if(!r.letGo) throw new Error('a name matching nothing left the old scheme attached');
    if(r.keptWords !== 'ZZ No Such Fund At All')
      throw new Error('the words typed were lost: "' + r.keptWords + '"');
    return 'typed in full, case and spacing ignored: manager, about, objective and category all '
      + 'fetched \u2014 and a name the master does not know drops the link, keeping the words';
  });

  t.section('the sheet asks three questions, then the lines');

  await t.step('the five that came off the top are gone, and still filled', async () => {
    const r = await t.eval(async ()=>{
      const c = DB.clients.find(x=>!x.deletedAt) || DB.clients[0];
      openRecommendationForm(null, c.id, null, true);
      const d = window._allocDraft;
      const html = document.getElementById('modalBody')
        ? document.getElementById('modalBody').innerHTML : document.body.innerHTML;
      const gone = ['f_alType','f_alSource','f_alValidity','f_alSchemePick']
        .filter(id=>!!document.getElementById(id));
      /* The sheet-level objective and conclusion boxes, not the
         per-line Fund Objective, which stays. */
      const objBox = !!document.getElementById('f_alObjective');
      const concBox = !!document.getElementById('f_alConclusion');
      const kept = ['f_alProduct','f_alMode'].filter(id=>!document.getElementById(id));
      const out = {gone, objBox, concBox, kept,
        lineCount: html.indexOf('Scheme Lines') >= 0,
        bulk: html.indexOf('Add the selected schemes') >= 0,
        addOne: html.indexOf('+ Add Scheme') >= 0,
        // still on the record, whatever the form stopped asking
        objective: !!d.investmentObjective, conclusion: !!d.conclusion,
        validity: String(d.validityDays || ''), source: d.source || '',
        lineScheme: !!document.getElementById('f_alScheme0')};
      closeModal();
      return out;
    });
    if(r.gone.length) throw new Error('still on the form: ' + r.gone.join(', '));
    if(r.objBox) throw new Error('the Investment Objective box is still on the sheet');
    if(r.concBox) throw new Error('the Conclusion / Summary box is still on the sheet');
    if(r.kept.length) throw new Error('a field that should have stayed is gone: ' + r.kept.join(', '));
    if(r.lineCount) throw new Error('the Scheme Lines heading is still drawn');
    if(r.bulk) throw new Error('the bulk scheme picker is still drawn');
    if(!r.addOne) throw new Error('there is no way left to add a scheme line');
    if(!r.lineScheme) throw new Error('the line lost its own scheme box');
    /* Trimmed from the form, not from the record — the letter still
       has its paragraphs and the sheet still expires. */
    if(!r.objective) throw new Error('the objective is no longer drafted, so the letter loses it');
    if(!r.conclusion) throw new Error('the conclusion is no longer drafted');
    if(!r.validity) throw new Error('the sheet has no validity, so it never expires');
    if(!r.source) throw new Error('the source was not guessed');
    return 'Product and Investment Mode stay; type, objective, source, conclusion, validity and the '
      + 'bulk picker are off the form and still filled (' + r.validity + ' days, source "' + r.source + '")';
  });

  await t.step('the scheme is one field, over the chosen fund house', async () => {
    const r = await t.eval(async ()=>{
      const a = {id: uid('AMC'), name:'ZZ House A', status:'Active', createdAt:new Date().toISOString()};
      const b = {id: uid('AMC'), name:'ZZ House B', status:'Active', createdAt:new Date().toISOString()};
      DB.amcs.push(a, b);
      const mk = (amc, nm) => { const sc = {id: uid('SCH'), amcId: amc.id, schemeName: nm,
        fundCategory:'Flexi Cap', createdAt:new Date().toISOString()}; DB.schemes.push(sc); return sc; };
      const a1 = mk(a, 'ZZ A One'), a2 = mk(a, 'ZZ A Two'), b1 = mk(b, 'ZZ B One');
      await save('amcs'); await save('schemes');
      const onA = allocSchemeLineHtml({amcId: a.id, schemeName:'', amount:'1'}, 0, ['Lumpsum']);
      const rowsOnA = (window._pickRows['f_alScheme0'] || []).map(x=>x.value);
      return {oneBox: (onA.match(/id="pickbox_f_alScheme0"/g) || []).length,
              /* The line has other dropdowns — category, platform,
                 transaction type, status. What must be gone is a
                 second control carrying the scheme list. */
              noSchemeSelect: !new RegExp('<select[^>]*>\\s*<option[^>]*>[^<]*' + a1.id).test(onA)
                && onA.indexOf('allocPickScheme') < 0,
              hidden: onA.indexOf('id="f_alScheme0"') >= 0,
              hasA: rowsOnA.indexOf(a1.id) >= 0 && rowsOnA.indexOf(a2.id) >= 0,
              bLeaked: rowsOnA.indexOf(b1.id) >= 0,
              saysWhose: onA.indexOf('ZZ House A scheme') >= 0,
              saysFree: /not in the master can be typed/.test(onA)};
    });
    if(r.oneBox !== 1) throw new Error('the scheme is ' + r.oneBox + ' boxes, not one');
    if(!r.noSchemeSelect) throw new Error('there is still a dropdown of schemes beside the box');
    if(!r.hidden) throw new Error('the id the line reads is gone');
    if(!r.hasA) throw new Error('the fund house\'s own schemes are not offered');
    if(r.bLeaked) throw new Error('another fund house\'s scheme is offered');
    if(!r.saysWhose) throw new Error('it does not say whose schemes it is offering');
    if(!r.saysFree) throw new Error('it does not say a strategy off the master can be typed');
    return 'one field, offering the chosen house\u2019s schemes and saying so';
  });

  await t.step('a strategy the master has never heard of is kept as words', async () => {
    const r = await t.eval(()=>{
      window._allocDraft = {id:'', clientId:'', schemes:[allocNewLineFor({})], attachments:[],
        productCategory:'Mutual Fund', investmentMode:'Lumpsum'};
      allocSchemeTyped(0, 'ZZ Bespoke PMS Mandate');
      const l = window._allocDraft.schemes[0];
      return {name: l.schemeName, id: l.schemeId || ''};
    });
    if(r.name !== 'ZZ Bespoke PMS Mandate')
      throw new Error('the words were lost: "' + r.name + '"');
    if(r.id) throw new Error('it claims to point at a master scheme it does not');
    return 'the words stand, and the line carries no scheme id behind them';
  });

  t.section('the client\u2019s approval page says it once');

  await t.step('the document drops its own disclaimer where the page carries one', async () => {
    const r = await t.eval(()=>{
      /* A sheet of its own, so the step does not depend on what
         earlier steps happened to leave in the store. */
      const c = DB.clients.find(x=>!x.deletedAt) || DB.clients[0];
      const rec = {id: uid('REC'), clientId: c.id, status:'Sent to Client',
        productCategory:'Mutual Fund', investmentMode:'Lumpsum', allocType:'New Investment',
        createdAt:new Date().toISOString(), createdBy: currentUser, attachments:[],
        schemes:[{schemeName:'ZZ Disc Fund', amount:'100000', transactionType:'Purchase'}]};
      DB.recommendations.push(rec);
      const co = DB.config.company || (DB.config.company = {});
      const was = co.disclaimerText;
      co.disclaimerText = 'ZZ Mutual fund investments are subject to market risks.';
      const withIt = allocationDocHtml(rec);
      const without = allocationDocHtml(rec, {noDisclaimer: true});
      co.disclaimerText = was;
      return {withIt: withIt.indexOf('ZZ Mutual fund investments') >= 0,
              without: without.indexOf('ZZ Mutual fund investments') >= 0,
              stillWhole: without.indexOf('system generated document') >= 0};
    });
    /* The PDF and the print view have nothing around them to carry
       the warning, so they keep it. */
    if(!r.withIt) throw new Error('the document lost its disclaimer where it is the only copy');
    if(r.without) throw new Error('the disclaimer is still printed twice on the approval page');
    if(!r.stillWhole) throw new Error('dropping the disclaimer cut the rest of the document short');
    return 'kept where it stands alone, dropped where the page already carries the full disclosure';
  });

  await t.step('only the one alert we provoked', async () => {
    const loose = t.dialogs.filter(d => !/Name the goal/.test(d));
    if(loose.length) throw new Error('alerts: ' + loose.join(' | ').slice(0, 200));
    return t.dialogs.length + ' dialog(s), all asked for';
  });
});
