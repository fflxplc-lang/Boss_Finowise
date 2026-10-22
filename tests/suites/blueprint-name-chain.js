/* WHICH BLUEPRINT THIS CAME FROM, SAID ONCE AND CARRIED.

   A piece of business raised from a plan knows which blueprint wrote
   it. Until now only the DBT knew: the sheet it opened, the transaction
   that sheet raised and the page the client consented on had all
   forgotten, so an adviser looking at an execution record could not say
   whether it came out of FSL, GAB, 7 Events or Goal Based Planning.

   One value, carried rather than re-derived — planType, from the DBT
   onto the allocation and from the allocation onto the transaction — so
   every module reads the same answer and none has its own idea of where
   a plan came from. Nobody types it.

   What this measures: that the value reaches each link of the chain,
   that it is the SAME value at each link, that each surface shows it,
   and that a record with no plan behind it shows nothing rather than
   guessing. */
const {suite} = require('../lib/harness');

const SETUP = `async (tag) => {
  const l = {id: uid('LMS'), firstName:'ZZ Trace', lastName: tag, mobile:'98000008' + tag,
    email:'zz.trace.' + tag + '@zz.in', assignedTo: currentUser, branch: DB.config.branches[0],
    createdAt:new Date().toISOString(), transformationForm:'FSL', dob:'1985-04-12',
    iseqScore: 44, iseqCategory:'Moderate'};
  initState('LMS', l); DB.leads.push(l); await save('leads');
  window._fslLeadId = l.id; window._fslStep = 'input';
  navigate('fsl');
  await new Promise(r=>setTimeout(r, 400));
  Object.assign(_fsl.s.personal, {name:'ZZ Trace ' + tag, mobile:'98000008' + tag,
    email:'zz.trace.' + tag + '@zz.in', dob:'1985-04-12'});
  _fsl.s.years = 10;
  _fsl.s.assets[0].current = 9700000; _fsl.s.assets[0].monthly = 49500;
  _fsl.dirty = true; fslRecompute(); await fslSaveSheet();
  await fslSubmitForClient(l.id);
  await fslStepGo('plan');
  await new Promise(r=>setTimeout(r, 400));
  fslTakeSuggestedLevel();
  await new Promise(r=>setTimeout(r, 300));
  DB.leads.find(x=>x.id===l.id).status = 'secondMeetingDone';
  await save('leads');
  await fslGoToLadder(l.id);
  await new Promise(r=>setTimeout(r, 700));
  const round = latestPlanRound(planRecordOf(l.id));
  round.seniorStatus = 'Approved'; round.seniorAt = new Date().toISOString();
  await save('leads');
  await fslStepGo('exec');
  await new Promise(r=>setTimeout(r, 500));
  _fsl.s.exec.agreedLump = 800000;
  _fsl.dirty = true; await fslSaveSheet();
  await fslUpdateDbt(l.id);
  await new Promise(r=>setTimeout(r, 900));
  return l.id;
}`;

suite(async t => {
  await t.home();

  t.section('the chain carries one answer');

  await t.step('DBT, sheet and transaction all name the same blueprint', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const id = await (${SETUP})("21");
      const round = latestPlanRound(planRecordOf(id));
      const dbt = planDbtsFor(id, round.n)[0];
      const sheet = allocationForDbt(dbt.id);
      /* The client answers the sheet; that is what raises the txn. */
      const before = (DB.transactions||[]).length;
      sheet.clientId = sheet.clientId || null;
      return {id, roundN: round.n,
              plan: round.type,
              dbt: planBlueprintTypeOf(dbt), dbtRound: dbt.planRound,
              sheet: planBlueprintTypeOf(sheet), sheetRound: sheet.planRound,
              label: planBlueprintLabel(sheet), short: planBlueprintShort(sheet),
              sheetId: sheet.id, dbtId: dbt.id};
    })()`));
    if(r.plan !== 'FSL') throw new Error('the fixture is not an FSL plan: ' + r.plan);
    if(r.dbt !== 'FSL') throw new Error('the DBT says "' + r.dbt + '"');
    if(r.sheet !== 'FSL') throw new Error('the Execution Tracker sheet says "' + r.sheet + '"');
    if(String(r.sheetRound) !== String(r.roundN))
      throw new Error('the sheet is against version ' + r.sheetRound + ', the plan is version ' + r.roundN);
    if(!/Financial Success Ladder/.test(r.label)) throw new Error('it reads "' + r.label + '"');
    if(!r.short) throw new Error('there is no short form for a badge');
    return 'plan, DBT and sheet all FSL at version ' + r.roundN + ' — "' + r.label + '"';
  });

  await t.step('and the transaction raised on consent carries it too', async () => {
    const r = await t.eval(async ()=>{
      const id = window._fslLeadId;
      const round = latestPlanRound(planRecordOf(id));
      const dbt = planDbtsFor(id, round.n)[0];
      const sheet = allocationForDbt(dbt.id);
      /* Raise what consent raises, the way consent raises it. */
      const line = allocSchemes(sheet)[0];
      const txn = {id: uid('TXN'), clientId: sheet.clientId, recommendationId: sheet.id,
        allocLineId: line.id, businessEntryId: dbt.id,
        amount: String(line.amount), status: txnStartStatus(),
        initiatedDate: new Date().toISOString().slice(0,10), sourceModule:'Asset Allocation',
        planType: sheet.planType || (dbt && dbt.planType) || '',
        planRound: sheet.planRound !== undefined ? sheet.planRound : (dbt && dbt.planRound),
        planKind: sheet.planKind || (dbt && dbt.planKind) || ''};
      DB.transactions.push(txn); await save('transactions');
      const card = txnTrackerCardHtml(txn);
      const d = document.createElement('div'); d.innerHTML = card;
      return {type: planBlueprintTypeOf(txn), round: txn.planRound, kind: txn.planKind,
              onCard: /FSL/.test(d.textContent || ''),
              find: /FSL/.test((d.querySelector('.txn-card')||{}).getAttribute('data-find') || '')};
    });
    if(r.type !== 'FSL') throw new Error('the transaction says "' + r.type + '"');
    if(!r.kind) throw new Error('it lost which kind of money it is');
    if(!r.onCard) throw new Error('the tracker card does not show it');
    if(!r.find) throw new Error('searching the tracker for the blueprint would not find it');
    return 'the transaction is FSL v' + r.round + ' (' + r.kind
         + '), shown on its card and searchable by it';
  });

  t.section('and every surface says it');

  await t.step('the Execution Tracker, the DBT list and the client card all show it', async () => {
    const r = await t.eval(()=>{
      const id = window._fslLeadId;
      const round = latestPlanRound(planRecordOf(id));
      const dbt = planDbtsFor(id, round.n)[0];
      const sheet = allocationForDbt(dbt.id);
      const txns = (DB.transactions||[]).filter(x=>x.recommendationId === sheet.id);
      const text = h => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent || ''; };
      return {tracker: text(viewRecommendations()),
              dbtList: text(viewBusinessTracker()),
              clientCard: text(cpTxnSummaryHtml({id: sheet.clientId}, txns)),
              brief: planBlueprintBrief(sheet),
              badge: planBlueprintBadgeHtml(sheet),
              long: planBlueprintShort(sheet)};
    });
    const miss = [];
    if(r.tracker.indexOf(r.brief) < 0) miss.push('the Execution Tracker');
    if(r.dbtList.indexOf(r.brief) < 0) miss.push('the DBT list');
    if(r.clientCard && r.clientCard.indexOf(r.brief) < 0) miss.push('the client card');
    if(miss.length) throw new Error('"' + r.brief + '" is missing from: ' + miss.join(', '));
    /* The firm says "FSL", so the badge says FSL. The long form belongs on
       a page and in the badge's own tooltip, not spelled out in a cell. */
    if(r.brief !== 'FSL') throw new Error('the badge reads "' + r.brief + '", not the abbreviation');
    const shown = r.badge.replace(/<[^>]*>/g, '');
    if(shown.indexOf('Success Ladder') >= 0)
      throw new Error('the badge still spells it out: ' + shown.trim());
    if(r.badge.indexOf(r.long) < 0 && r.badge.indexOf('Financial Success Ladder') < 0)
      throw new Error('the long name is not even in the tooltip: ' + r.badge);
    return '"' + r.brief + '" reads on the Execution Tracker, the DBT list and the client’s own card, '
         + 'with the full name kept to the tooltip';
  });

  await t.step('and the consent page names the plan the client is answering', async () => {
    const r = await t.eval(()=>{
      const id = window._fslLeadId;
      const round = latestPlanRound(planRecordOf(id));
      const sheet = allocationForDbt(planDbtsFor(id, round.n)[0].id);
      const html = typeof allocationDocHtml === "function" ? allocationDocHtml(sheet) : '';
      const d = document.createElement('div'); d.innerHTML = html;
      return {text: d.textContent || '', label: planBlueprintLabel(sheet), round: sheet.planRound};
    });
    if(!r.text) throw new Error('the consent document drew nothing');
    if(r.text.indexOf(r.label) < 0)
      throw new Error('it does not name the blueprint: looked for "' + r.label + '"');
    if(r.round && r.text.indexOf('version ' + r.round) < 0)
      throw new Error('it does not say which version');
    return 'the client reads "From your ' + r.label + ', version ' + r.round + '"';
  });

  await t.step('a record with no plan behind it claims none', async () => {
    const r = await t.eval(()=>({
      bare: planBlueprintBadgeHtml({id:'ZZ', amount: 1}),
      label: planBlueprintLabel({}),
      nullish: planBlueprintBadgeHtml(null),
    }));
    if(r.bare) throw new Error('it invented a blueprint for a record with none: ' + r.bare);
    if(r.label) throw new Error('it named one anyway: ' + r.label);
    if(r.nullish) throw new Error('it drew something for nothing at all');
    return 'nothing shown where there is no plan behind the record';
  });

  t.section('the Blueprint section on the consent document');

  await t.step('FSL shows both rungs and what the selected one asks for', async () => {
    const r = await t.eval(()=>{
      const id = window._fslLeadId;
      const round = latestPlanRound(planRecordOf(id));
      const sheet = allocationForDbt(planDbtsFor(id, round.n)[0].id);
      const html = allocBlueprintSectionHtml(sheet);
      const d = document.createElement('div'); d.innerHTML = html;
      const L = allocFslLevelsFor(sheet, allocPlanRoundFor(sheet));
      const doc = allocationDocHtml(sheet);
      const dd = document.createElement('div'); dd.innerHTML = doc;
      const body = dd.querySelector('.alloc-doc-body');
      const first = body ? body.firstElementChild : null;
      return {text: d.textContent || '',
              kickers: Array.from(d.querySelectorAll('.alloc-doc-kicker')).map(x=>x.textContent.trim()),
              rungs: Array.from(d.querySelectorAll('.alloc-bp-rung .alloc-bp-lvl')).map(x=>x.textContent.trim()),
              current: L && L.current ? L.current.lvl : null,
              picked: L && L.picked ? L.picked.lvl : null,
              assetClass: L ? fslAssetClassFor(L.years) : '',
              firstClass: first ? first.className : '(nothing)'};
    });
    if(r.kickers.indexOf('BLUEPRINT') < 0) throw new Error('no Blueprint heading: ' + r.kickers.join(' | '));
    if(!/Financial Success Ladder/.test(r.text)) throw new Error('it does not name the blueprint');
    if(r.rungs.length !== 2) throw new Error(r.rungs.length + ' rung(s): ' + r.rungs.join(' | '));
    if(!/current FSL level/i.test(r.kickers.join(' ')) || !/selected FSL level/i.test(r.kickers.join(' ')))
      throw new Error('the two subsections are not named: ' + r.kickers.join(' | '));
    if(!r.picked) throw new Error('no selected level was found');
    if(r.rungs[1].indexOf('Level ' + r.picked) < 0)
      throw new Error('the selected rung reads "' + r.rungs[1] + '", not Level ' + r.picked);
    if(r.current && r.rungs[0].indexOf('Level ' + r.current) < 0)
      throw new Error('the current rung reads "' + r.rungs[0] + '", not Level ' + r.current);
    if(r.text.indexOf(r.assetClass) < 0)
      throw new Error('the asset allocation for that level is missing: ' + r.assetClass);
    if(!/alloc-doc-bp/.test(r.firstClass))
      throw new Error('it is not the first thing in the document body, it is: ' + r.firstClass);
    return 'current ' + (r.current ? 'Level ' + r.current : 'none') + ' \u2192 selected Level ' + r.picked
         + ', placed in ' + r.assetClass + ', at the top of the body';
  });

  await t.step('and a blueprint that is not FSL shows no FSL fields', async () => {
    const r = await t.eval(()=>{
      const read = (type)=>{
        const sheet = {id:'ZZ-BP-' + type, planType: type, planRound: 1, leadId:'ZZ-NONE'};
        const d = document.createElement('div');
        d.innerHTML = allocBlueprintSectionHtml(sheet);
        return {type, text: (d.textContent || '').replace(/\s+/g,' ').trim(),
                rungs: d.querySelectorAll('.alloc-bp-rung').length};
      };
      return {gab: read('GAB'), se: read('SEVENEVENTS'), mg: read('MULTIGOAL'),
              none: allocBlueprintSectionHtml({id:'ZZ', leadId:'ZZ-NONE'})};
    });
    ['gab','se','mg'].forEach(k=>{
      if(r[k].rungs) throw new Error(r[k].type + ' drew ' + r[k].rungs + ' FSL rung(s)');
      if(/FSL level/i.test(r[k].text)) throw new Error(r[k].type + ' mentions an FSL level: ' + r[k].text);
      if(!/BLUEPRINT/i.test(r[k].text)) throw new Error(r[k].type + ' has no Blueprint heading');
    });
    if(r.none) throw new Error('a sheet with no plan behind it still drew a section');
    return 'GAB, 7 Events and Goal Based each get their own detail and no FSL rungs; '
         + 'a sheet with no plan draws nothing';
  });

  t.section('records written before the link travelled');

  await t.step('a sheet and a transaction from the old world are filled in', async () => {
    const r = await t.eval(async ()=>{
      /* Exactly the shape the firm was looking at: a DBT that knows its
         blueprint, a sheet opened from it that does not, and a
         transaction raised from that sheet that does not either. */
      const dbt = {id: uid('DBT'), leadId:'ZZ-OLD-LEAD', sourceModule:'LMS',
        dbtType:'Investment', transactionType:'Lumpsum', amount:'500000',
        planRound: 1, planType:'FSL', planKind:'Lumpsum',
        createdAt:new Date().toISOString()};
      DB.businessEntries.push(dbt);
      const rec = {id: uid('REC'), leadId:'ZZ-OLD-LEAD', dbtEntryId: dbt.id,
        sourceModule:'DBT', status:'Draft', schemes:[], createdAt:new Date().toISOString()};
      DB.recommendations.push(rec);
      const txn = {id: uid('TXN'), recommendationId: rec.id, businessEntryId: dbt.id,
        amount:'500000', status: txnStartStatus(), sourceModule:'Asset Allocation'};
      DB.transactions.push(txn);
      await save('businessEntries'); await save('recommendations'); await save('transactions');
      const before = {rec: planBlueprintTypeOf(rec), txn: planBlueprintTypeOf(txn)};
      const changed = await migrateBlueprintLinks();
      const again = await migrateBlueprintLinks();     // and it settles
      return {before, changed, again,
              rec: planBlueprintTypeOf(rec), recRound: rec.planRound,
              txn: planBlueprintTypeOf(txn), txnRound: txn.planRound, kind: txn.planKind};
    });
    if(r.before.rec || r.before.txn) throw new Error('the fixture already knew, so this proves nothing');
    if(!r.changed) throw new Error('it reported nothing to fill in');
    if(r.rec !== 'FSL') throw new Error('the sheet still says "' + r.rec + '"');
    if(r.txn !== 'FSL') throw new Error('the transaction still says "' + r.txn + '"');
    if(String(r.recRound) !== '1' || String(r.txnRound) !== '1')
      throw new Error('the version did not come with it: ' + r.recRound + ' / ' + r.txnRound);
    if(r.kind !== 'Lumpsum') throw new Error('the kind of money did not come with it: ' + r.kind);
    if(r.again) throw new Error('it found work to do a second time, so it is not settled');
    return 'the old sheet and its transaction both read FSL v1 (Lumpsum), and a second run finds nothing';
  });

  await t.step('and it invents nothing for a record with no plan behind it', async () => {
    const r = await t.eval(async ()=>{
      const rec = {id: uid('REC'), clientId:'ZZ-NOPLAN', sourceModule:'Manual',
        status:'Draft', schemes:[], createdAt:new Date().toISOString()};
      const txn = {id: uid('TXN'), clientId:'ZZ-NOPLAN', amount:'1000',
        status: txnStartStatus(), sourceModule:'CMS'};
      DB.recommendations.push(rec); DB.transactions.push(txn);
      await save('recommendations'); await save('transactions');
      await migrateBlueprintLinks();
      return {rec: planBlueprintTypeOf(rec), txn: planBlueprintTypeOf(txn),
              badge: planBlueprintBadgeHtml(rec)};
    });
    if(r.rec || r.txn) throw new Error('it made one up: ' + r.rec + ' / ' + r.txn);
    if(r.badge) throw new Error('and drew a badge for it');
    return 'a hand-made allocation and a CMS transaction are left exactly as they were';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
