/* THE TRANSACTION'S OWN JOURNEY, ON A CARD THAT OPENS.

   A transaction raised from an approved allocation line was a row with
   a status somebody typed. The work it stands for has four steps —
   Not Started, Transaction Placed, Unit Allotted, Goal Mapped — with
   Rejected as the other answer at the third, and a row has nowhere to
   put any of that.

   Two things this suite is really guarding.

   The stage is READ, never stored: placing writes a placedAt and a
   reference, allotment an allottedAt, mapping a goalId, and the stage
   and the percentage are worked out from those. So the battery cannot
   disagree with the record, and a rejection that clears placedAt moves
   the stage back without anything having to remember to.

   And a rejection makes no second transaction. The attempt is closed
   with its reason and its reference, kept, and the next placement
   opens attempt two on the same record. */
const {suite} = require('../lib/harness');

const SEED = async ()=>{
  let c = DB.clients.find(x=>x.id === 'CMS-STAGE');
  if(!c){ c = {id:'CMS-STAGE'}; DB.clients.push(c); }
  Object.assign(c, {cmsName:'ZZ Stage Client', rmName: currentUser, branch:'Varanasi',
    email:'stage@example.com', createdAt:new Date().toISOString()});
  DB.transactions = (DB.transactions || []).filter(x=>x.clientId !== 'CMS-STAGE');
  DB.clientGoals = (DB.clientGoals || []).filter(g=>g.clientId !== 'CMS-STAGE');
  DB.businessEntries = (DB.businessEntries || []).filter(e=>e.clientId !== 'CMS-STAGE');
  const entry = {id: uid('DBT'), clientId: c.id, dbtType:'Investment', amount:'1000000',
    transactionType:'Purchase', productCategory:'Mutual Fund', status: dbtConsentStatus(),
    createdAt:new Date().toISOString()};
  DB.businessEntries.push(entry);
  const made = ['600000','400000'].map((amt, i)=>({
    id: uid('TXN'), clientId: c.id, amount: amt, transactionType:'Purchase',
    productCategory:'Mutual Fund', platform: cfgLabels('alloc.platforms')[0],
    schemeName:'ZZ Stage Scheme ' + (i + 1), status: txnStartStatus(),
    businessEntryId: entry.id, allocLineId: 'LINE-' + i, sourceModule:'Allocation',
    initiatedDate: new Date().toISOString().slice(0,10)}));
  DB.transactions = DB.transactions.concat(made);
  await save('clients'); await save('transactions');
  await save('clientGoals'); await save('businessEntries');
  return {client: c.id, entry: entry.id, txns: made.map(x=>x.id)};
};

suite(async t => {
  await t.home();
  await t.eval(src => { window.SEED_FN = eval('(' + src + ')'); }, String(SEED));
  let ids = null;

  t.section('a card for each line, and it opens');

  await t.step('every transaction is a card, and clicking one opens its page', async () => {
    ids = await t.eval(async ()=>await SEED_FN());
    const r = await t.eval(async (x)=>{
      navigate('transactions');
      await new Promise(d=>setTimeout(d, 150));
      const cards = Array.from(document.querySelectorAll('.txn-card'));
      const mine = cards.filter(el=>/ZZ Stage Scheme/.test(el.textContent));
      const opens = /openTransactionCard/.test((mine[0] || {}).outerHTML || '');
      openTransactionCard(x.txns[0]);
      await new Promise(d=>setTimeout(d, 150));
      const page = document.getElementById('content').textContent || '';
      return {cards: mine.length, opens, open: txnDetailId,
              named: /ZZ Stage Scheme 1/.test(page),
              shell: !!document.querySelector('.prof-head'),
              battery: !!document.querySelector('.txn-battery'),
              /* the battery sits at the bottom of the page, under the facts */
              atBottom: (()=>{
                const main = document.querySelector('.prof-main');
                const b = main && main.querySelector('.txn-battery');
                const cards_ = main ? Array.from(main.children) : [];
                return !!b && cards_.indexOf(b.closest('.prof-card')) === cards_.length - 1;
              })()};
    }, ids);
    if(r.cards !== 2) throw new Error('the wall drew ' + r.cards + ' cards for two transactions');
    if(!r.opens) throw new Error('a card does not open anything');
    if(r.open !== ids.txns[0]) throw new Error('it opened ' + r.open);
    if(!r.named || !r.shell) throw new Error('the detail page is not the profile card shell');
    if(!r.battery) throw new Error('there is no battery on the detail page');
    if(!r.atBottom) throw new Error('the battery is not at the bottom of the page');
    return 'two cards, one per allocation line; clicking one opens the client-card shell with the battery at its foot';
  });

  t.section('the four stages, and the percentage read off them');

  await t.step('a new transaction is Not Started at 0%', async () => {
    const r = await t.eval(x=>{
      const t0 = DB.transactions.find(y=>y.id === x.txns[0]);
      return {stage: txnStage(t0), pct: txnProgress(t0), status: t0.status,
              stages: TXN_STAGES.map(s=>s.label)};
    }, ids);
    if(r.stage !== 'notStarted') throw new Error('it starts on ' + r.stage);
    if(r.pct !== 0) throw new Error('it starts at ' + r.pct + '%');
    if(r.status !== 'Not Started') throw new Error('its status reads ' + r.status);
    if(r.stages.join(' → ') !== 'Not Started → Transaction Placed → Unit Allotted → Goal Mapped')
      throw new Error('the stages are ' + r.stages.join(', '));
    return 'Not Started at 0%, on the four stages the firm wrote down';
  });

  await t.step('placing it takes its reference, and will not go without one', async () => {
    const before = t.dialogs.length;
    const r = await t.eval(async x=>{
      openTxnPlace(x.txns[0]);
      await txnMarkPlaced(x.txns[0]);                 // nothing typed
      const t0 = DB.transactions.find(y=>y.id === x.txns[0]);
      const refused = txnStage(t0);
      document.getElementById('f_txnRef').value = 'ZZ-REF-001';
      await txnMarkPlaced(x.txns[0]);
      const after = DB.transactions.find(y=>y.id === x.txns[0]);
      return {refused, stage: txnStage(after), pct: txnProgress(after), status: after.status,
              ref: txnReference(after), attempts: txnAttempts(after).length};
    }, ids);
    if(r.refused !== 'notStarted') throw new Error('it was placed with no reference');
    if(!t.dialogs.slice(before).some(d=>/reference number/.test(String(d))))
      throw new Error('it refused without saying why');
    if(r.stage !== 'placed') throw new Error('after placing it reads ' + r.stage);
    if(r.pct !== 33) throw new Error('placed reads ' + r.pct + '%');
    if(r.ref !== 'ZZ-REF-001') throw new Error('the reference came back as ' + r.ref);
    if(r.attempts !== 1) throw new Error(r.attempts + ' attempts after one placement');
    if(r.status === 'Not Started') throw new Error('the configured status did not move off Not Started');
    return 'refused without a reference; placed under ZZ-REF-001 at 33%, status ' + r.status;
  });

  await t.step('allotment completes the business, once', async () => {
    const r = await t.eval(async x=>{
      openTxnAllot(x.txns[0]);
      document.getElementById('f_txnUnits').value = '1204.318';
      await txnMarkAllotted(x.txns[0]);
      const t0 = DB.transactions.find(y=>y.id === x.txns[0]);
      const entry = DB.businessEntries.find(e=>e.id === x.entry);
      return {stage: txnStage(t0), pct: txnProgress(t0), status: t0.status, units: t0.units,
              entryStatus: entry.status, recognisedBy: entry.recognisedByTxnId,
              /* the other line is untouched */
              other: txnStage(DB.transactions.find(y=>y.id === x.txns[1]))};
    }, ids);
    if(r.stage !== 'allotted') throw new Error('after allotment it reads ' + r.stage);
    if(r.pct !== 67) throw new Error('allotted reads ' + r.pct + '%');
    if(r.status !== 'Completed') throw new Error('its status reads ' + r.status);
    if(r.units !== '1204.318') throw new Error('the units came back as ' + r.units);
    if(!/Complete/i.test(r.entryStatus))
      throw new Error('the DBT entry was not recognised as completed business: ' + r.entryStatus);
    if(r.recognisedBy !== ids.txns[0]) throw new Error('the entry does not name the transaction that completed it');
    if(r.other !== 'notStarted') throw new Error('allotting one moved the other to ' + r.other);
    return '67%, units recorded, the DBT entry recognised as completed business by this transaction — and the second line untouched';
  });

  t.section('goal mapping, against CMS and nothing else');

  await t.step('with no goal on file it offers to create one, in CMS', async () => {
    const r = await t.eval(async x=>{
      openTxnGoalMap(x.txns[0]);
      const empty = (document.getElementById('modalBody').textContent || '');
      const offers = /openTxnNewGoal/.test(document.getElementById('modalBody').innerHTML);
      openTxnNewGoal(x.txns[0]);
      document.getElementById('f_glName').value = 'ZZ Retirement 2045';
      document.getElementById('f_glTarget').value = '30000000';
      await saveTxnNewGoal(x.txns[0]);
      const t0 = DB.transactions.find(y=>y.id === x.txns[0]);
      const goals = DB.clientGoals.filter(g=>g.clientId === x.client && !g.deletedAt);
      const onServer = goals.map(g=>g.name);
      return {saidNone: /has no goals/.test(empty), offers,
              stage: txnStage(t0), pct: txnProgress(t0),
              goalId: t0.goalId, goalName: t0.goalId ? goalNameOf(t0.goalId) : '',
              inCms: onServer, cmsCount: goals.length,
              storedOnTxn: Object.keys(t0).filter(k=>/goal/i.test(k))};
    }, ids);
    if(!r.saidNone || !r.offers) throw new Error('with no goals it did not offer to create one');
    if(r.cmsCount !== 1) throw new Error('CMS holds ' + r.cmsCount + ' goals for this client');
    if(r.inCms[0] !== 'ZZ Retirement 2045') throw new Error('the goal in CMS reads ' + r.inCms[0]);
    if(r.goalName !== 'ZZ Retirement 2045') throw new Error('the transaction reads ' + r.goalName);
    if(r.stage !== 'goalMapped') throw new Error('after mapping it reads ' + r.stage);
    if(r.pct !== 100) throw new Error('mapped reads ' + r.pct + '%');
    /* The transaction keeps the id and the date it was mapped — not a
       copy of the goal, which would be a second source for it. */
    if(r.storedOnTxn.sort().join(',') !== 'goalId,goalMappedAt')
      throw new Error('the transaction stores ' + r.storedOnTxn.join(', ') + ' about the goal');
    return 'no goal on file → created in CMS Goal Planning and mapped; 100%, and the transaction holds its id, not a copy of it';
  });

  await t.step('with goals on file it offers them, read live from CMS', async () => {
    const r = await t.eval(async x=>{
      DB.clientGoals.push({id: uid('GOL'), clientId: x.client, name:'ZZ Child Education',
        target:'5000000', createdAt:new Date().toISOString()});
      await save('clientGoals');
      /* The allotted one: a transaction is only mapped once its units
         are in, which the step below is about. */
      openTxnGoalMap(x.txns[0]);
      const rows = (window._pickRows['f_txnGoal'] || []).map(o=>o.label);
      /* Renamed in CMS, and the picker reads the new name next time. */
      DB.clientGoals.find(g=>g.name === 'ZZ Child Education').name = 'ZZ Child Education (renamed)';
      await save('clientGoals');
      openTxnGoalMap(x.txns[0]);
      const again = (window._pickRows['f_txnGoal'] || []).map(o=>o.label);
      closeModal();
      return {rows, again};
    }, ids);
    if(r.rows.length !== 2) throw new Error('it offered ' + r.rows.length + ' goals');
    if(!r.rows.some(x=>/Retirement 2045/.test(x)) || !r.rows.some(x=>/Child Education/.test(x)))
      throw new Error('it offered: ' + r.rows.join(', '));
    if(!r.again.some(x=>/renamed/.test(x)))
      throw new Error('a goal renamed in CMS did not read renamed here — it is being copied somewhere');
    return 'both of the client’s CMS goals offered, and a rename in CMS reads through — one source, not a copy';
  });

  await t.step('and a transaction with no units yet cannot be mapped at all', async () => {
    const before = t.dialogs.length;
    const r = await t.eval(x=>{
      openTxnGoalMap(x.txns[1]);
      const open = document.getElementById('overlay').classList.contains('show');
      closeModal();
      return {open, goal: (DB.transactions.find(y=>y.id === x.txns[1]) || {}).goalId || ''};
    }, ids);
    if(r.goal) throw new Error('a transaction with no allotment was mapped to a goal');
    if(!t.dialogs.slice(before).some(d=>/units are allotted/.test(String(d))))
      throw new Error('it refused without saying why');
    return 'refused, and said the units have to be in first';
  });

  t.section('rejected, and placed again, on the one record');

  await t.step('a rejection needs its reason and sends it back to the start', async () => {
    const before = t.dialogs.length;
    const r = await t.eval(async x=>{
      const id = x.txns[1];
      openTxnPlace(id);
      document.getElementById('f_txnRef').value = 'ZZ-REF-002';
      await txnMarkPlaced(id);
      openTxnReject(id);
      await txnMarkRejected(id);                    // no reason typed
      const t1 = DB.transactions.find(y=>y.id === id);
      const refused = txnStage(t1);
      document.getElementById('f_txnRejectWhy').value = 'ZZ Folio mismatch at the AMC.';
      await txnMarkRejected(id);
      const after = DB.transactions.find(y=>y.id === id);
      return {refused, stage: txnStage(after), pct: txnProgress(after), status: after.status,
              attempts: txnAttempts(after).length,
              kept: txnAttempts(after)[0],
              count: DB.transactions.filter(y=>y.clientId === x.client && !y.deletedAt).length};
    }, ids);
    if(r.refused !== 'placed') throw new Error('it was rejected with no reason given');
    if(!t.dialogs.slice(before).some(d=>/rejection needs its reason/.test(String(d))))
      throw new Error('it refused without saying why');
    if(r.stage !== 'notStarted') throw new Error('after rejection it reads ' + r.stage);
    if(r.pct !== 0) throw new Error('a rejected transaction reads ' + r.pct + '%');
    if(r.attempts !== 1) throw new Error(r.attempts + ' attempts after one rejection');
    if(r.kept.reference !== 'ZZ-REF-002')
      throw new Error('the reference it was placed under was lost: ' + r.kept.reference);
    if(!/Folio mismatch/.test(r.kept.reason || '')) throw new Error('the reason was lost');
    if(r.count !== 2) throw new Error('a rejection made a ' + r.count + 'th transaction record');
    return 'back to Not Started at 0%, the attempt kept with its reference and reason, and still two records — not three';
  });

  await t.step('and placing it again opens attempt two on the same record', async () => {
    const r = await t.eval(async x=>{
      const id = x.txns[1];
      openTxnPlace(id);
      document.getElementById('f_txnRef').value = 'ZZ-REF-003';
      await txnMarkPlaced(id);
      openTxnAllot(id);
      await txnMarkAllotted(id);
      const after = DB.transactions.find(y=>y.id === id);
      return {stage: txnStage(after), pct: txnProgress(after),
              attempts: txnAttempts(after).map(a=>a.reference),
              rejections: txnRejections(after).length,
              count: DB.transactions.filter(y=>y.clientId === x.client && !y.deletedAt).length,
              ref: after.allotmentRef};
    }, ids);
    if(r.attempts.join(',') !== 'ZZ-REF-002,ZZ-REF-003')
      throw new Error('the attempts read ' + r.attempts.join(', '));
    if(r.rejections !== 1) throw new Error(r.rejections + ' rejections kept');
    if(r.stage !== 'allotted') throw new Error('the second attempt reads ' + r.stage);
    if(r.count !== 2) throw new Error('placing again made a ' + r.count + 'th record');
    if(r.ref !== 'ZZ-REF-003') throw new Error('it was allotted under ' + r.ref);
    return 'attempt two placed under ZZ-REF-003 and allotted, attempt one kept rejected, still two records';
  });

  await t.step('the page shows both attempts and the percentage it worked out', async () => {
    const r = await t.eval(async x=>{
      openTransactionCard(x.txns[1]);
      await new Promise(d=>setTimeout(d, 150));
      const txt = document.getElementById('content').textContent || '';
      const cells = document.querySelectorAll('.txn-battery .txn-cell');
      const on = document.querySelectorAll('.txn-battery .txn-cell.on');
      return {both: /ZZ-REF-002/.test(txt) && /ZZ-REF-003/.test(txt),
              reason: /Folio mismatch/.test(txt),
              pct: (document.querySelector('.txn-battery-pct') || {}).textContent,
              cells: cells.length, on: on.length};
    }, ids);
    if(!r.both) throw new Error('the page does not show both attempts');
    if(!r.reason) throw new Error('the page does not show why the first was rejected');
    if(r.pct !== '67%') throw new Error('the battery reads ' + r.pct);
    if(r.cells !== 4) throw new Error('the battery has ' + r.cells + ' cells');
    if(r.on !== 3) throw new Error(r.on + ' of 4 cells are filled at 67%');
    return 'both references and the rejection reason on the page, battery 3 of 4 cells at 67%';
  });

  await t.step('nothing was alerted but the refusals this suite asked for', async () => {
    const odd = t.dialogs.filter(x=>
      !/reference number|rejection needs its reason|units are allotted/.test(String(x)));
    if(odd.length) throw new Error('alerts: ' + odd.join(' | ').slice(0, 240));
    return t.dialogs.length + ' pop-up(s), every one of them a refusal this suite provoked';
  });
});
