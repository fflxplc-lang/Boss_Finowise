/* THE TRACKER IS DRAWN TWO WAYS, AND THE SWITCH IS ONE CLICK.

   It was a flat wall of cards. The firm asked for a board and a list
   with a switch between them, where the page's own actions are.

   The board is the tracker's four stages as four columns, and a card
   is under the stage its own record puts it on — txnStage reads the
   record, so a card cannot be in a column the work does not agree
   with. That is the thing worth guarding: not that four boxes are
   drawn, but that each transaction is in the right one.

   The list is the table the rest of BOSS uses, one row per
   transaction, the same row that opens the record.

   Which one somebody is looking at is theirs, kept on their own
   device the way dark mode is, so it survives a reload and reaches
   nothing shared. */
const {suite} = require('../lib/harness');

/* Five transactions spread across the four stages, so every column has
   something to be right or wrong about and one of them has two. */
const SEED = `async function(){
  DB.transactions = (DB.transactions || []).filter(t=>String(t.id).indexOf('TXN-VS') !== 0);
  let l = DB.leads.find(x=>x.id === 'LMS-VSWITCH');
  if(!l){ l = {id:'LMS-VSWITCH'}; DB.leads.push(l); }
  Object.assign(l, {firstName:'ZZ View', lastName:'Switch', mobile:'9800777222',
    email:'view@example.com', assignedTo: currentUser, createdAt:new Date().toISOString()});
  if(!stateOf('LMS', l)) initState('LMS', l);
  await save('leads');
  const now = new Date().toISOString();
  const mk = (n, scheme, amt, stage) => {
    const t = {id:'TXN-VS' + n, leadId:l.id, schemeName:scheme, amount:amt,
      transactionType:'SIP', productCategory:'Mutual Fund', createdAt:now, status:'In Progress'};
    if(stage >= 1) t.placedAt = now;
    if(stage >= 2) t.allottedAt = now;
    if(stage >= 3){ t.goalId = 'GOAL-VS'; t.status = 'Completed'; }
    return t;
  };
  DB.transactions.push(mk(1, 'ZZ Gilt Index Fund',   8000, 2));
  DB.transactions.push(mk(2, 'ZZ Allocation Fund',  12000, 1));
  DB.transactions.push(mk(3, 'ZZ Arbitrage Fund',   10000, 1));
  DB.transactions.push(mk(4, 'ZZ Bluechip Fund',    25000, 0));
  DB.transactions.push(mk(5, 'ZZ Small Cap Fund',    5000, 3));
  await save('transactions');
  navigate('transactions');
  return DB.transactions.filter(t=>String(t.id).indexOf('TXN-VS') === 0).length;
}`;

suite(async t => {
  await t.home();
  /* A step below reloads the app, so the boot migrations write and the
     live layer starts reading; whichever of those is still in the air
     when the browser closes logs a failure that is the teardown rather
     than anything under test. Allowed for the whole suite because it
     does not always land in the step that provokes it. */
  t.expectConsole(/storage (get|set) failed/);

  t.section('the switch');

  await t.step('two ways to look at it, the board to start with', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const n = await (${SEED})();
      return {n, labels: Array.from(document.querySelectorAll('.view-switch button'))
                            .map(b=>(b.textContent||'').trim()),
              on: Array.from(document.querySelectorAll('.view-switch button.on'))
                            .map(b=>(b.textContent||'').trim()),
              /* it sits with the page's own actions, not off on its own */
              besideNew: !!(document.querySelector('.view-switch')||{}).parentElement
                && !!((document.querySelector('.view-switch')||{}).parentElement||{})
                     .querySelector('.btn.primary')};
    })()`));
    if(r.n !== 5) throw new Error('the fixture laid down ' + r.n + ' transactions, not 5');
    if(r.labels.join(' / ') !== 'Board / List')
      throw new Error('the switch offers: ' + (r.labels.join(' / ') || 'nothing'));
    if(r.on.join('') !== 'Board') throw new Error('what is lit is "' + r.on.join('') + '", not Board');
    if(!r.besideNew) throw new Error('the switch is not beside New Transaction');
    return 'Board / List, Board lit, beside New Transaction';
  });

  t.section('the board');

  await t.step('a column per stage, and every card under the stage its record is on', async () => {
    const r = await t.eval(()=>{
      const cols = Array.from(document.querySelectorAll('.txn-col')).map(c=>({
        label: (c.querySelector('.txn-col-head b').textContent || '').trim(),
        count: (c.querySelector('[data-card-count]').textContent || '').trim(),
        ids: Array.from(c.querySelectorAll('.txn-card'))
               .map(x=>((x.querySelector('.txn-card-foot span')||{}).textContent || '').trim()),
      }));
      /* what the records themselves say, worked out the other way */
      const want = {};
      TXN_STAGES.forEach(st=>{ want[st.label] = DB.transactions
        .filter(x=>String(x.id).indexOf('TXN-VS') === 0 && txnStage(x) === st.id)
        .map(x=>x.id).sort(); });
      return {cols, want, stages: TXN_STAGES.map(s=>s.label)};
    });
    if(r.cols.map(c=>c.label).join(' | ') !== r.stages.join(' | '))
      throw new Error('the columns read ' + r.cols.map(c=>c.label).join(' | '));
    r.cols.forEach(c=>{
      const mine = c.ids.filter(id=>id.indexOf('TXN-VS') === 0).sort();
      const want = r.want[c.label];
      if(mine.join(',') !== want.join(','))
        throw new Error(c.label + ' holds [' + mine.join(', ') + '] — the records say ['
          + want.join(', ') + ']');
      if(Number(c.count) !== c.ids.length)
        throw new Error(c.label + ' counts ' + c.count + ' but draws ' + c.ids.length);
    });
    return r.cols.map(c=>c.label + ' ' + c.count).join(' · ');
  });

  await t.step('the search hides cards and the heads follow', async () => {
    const r = await t.eval(()=>{
      filterCards('txnBoard', 'Arbitrage');
      const shown = Array.from(document.querySelectorAll('.txn-card'))
        .filter(c=>c.style.display !== 'none').length;
      const counts = Array.from(document.querySelectorAll('.txn-col'))
        .map(c=>(c.querySelector('.txn-col-head b').textContent || '').trim()
              + '=' + (c.querySelector('[data-card-count]').textContent || '').trim());
      filterCards('txnBoard', '');
      const back = Array.from(document.querySelectorAll('.txn-card'))
        .filter(c=>c.style.display !== 'none').length;
      return {shown, counts, back};
    });
    if(r.shown !== 1) throw new Error('searching one scheme left ' + r.shown + ' cards showing');
    const sum = r.counts.reduce((a,c)=>a + Number(c.split('=')[1] || 0), 0);
    if(sum !== 1) throw new Error('the heads add up to ' + sum + ' while one card is showing: '
      + r.counts.join(' | '));
    if(r.back !== 5) throw new Error('clearing the search brought back ' + r.back + ' of 5');
    return r.counts.join(' | ') + ', and all five come back';
  });

  t.section('the list');

  await t.step('one click, and the same records are a table', async () => {
    const r = await t.eval(async ()=>{
      await setTxnView('list');
      const rows = Array.from(document.querySelectorAll('#txnTable tbody tr'));
      return {
        board: !!document.querySelector('.txn-board'),
        heads: Array.from(document.querySelectorAll('#txnTable thead th')).map(x=>(x.textContent||'').trim()),
        rows: rows.length,
        ids: rows.map(x=>(x.lastElementChild.textContent || '').trim()).filter(id=>id.indexOf('TXN-VS') === 0),
        clickable: rows.every(x=>x.classList.contains('row-clickable')
                                && /openTransactionCard/.test(x.getAttribute('onclick') || '')),
        on: Array.from(document.querySelectorAll('.view-switch button.on')).map(b=>(b.textContent||'').trim()),
      };
    });
    if(r.board) throw new Error('the board is still drawn underneath the list');
    if(r.on.join('') !== 'List') throw new Error('the switch still lights "' + r.on.join('') + '"');
    if(r.ids.length !== 5) throw new Error('the table has ' + r.ids.length + ' of the 5 transactions');
    if(!r.clickable) throw new Error('a row does not open the transaction');
    const want = ['Client / Lead','Scheme','Amount','Type','Category','Stage','Blueprint','Goal','Done','Reference'];
    if(r.heads.join(' · ') !== want.join(' · '))
      throw new Error('the columns read: ' + r.heads.join(' · '));
    return r.rows + ' rows — ' + r.heads.join(' · ');
  });

  await t.step('and the choice is still theirs after a reload', async () => {
    /* The step proves what it is about with a fetch of its own, below,
       so nothing here is taken on trust. */
    await t.home();
    const r = await t.eval(async ()=>{
      navigate('transactions');
      return {view: txnView, list: !!document.querySelector('#txnTable'),
              board: !!document.querySelector('.txn-board'),
              /* kept on the device, not in anything the firm shares */
              local: localStorage.getItem('crm_local_txnViewPref'),
              shared: await (async ()=>{
                const res = await fetch('/api/storage/txnViewPref', {headers: apiHeaders()});
                return res.status;
              })()};
    });
    if(r.view !== 'list' || !r.list || r.board)
      throw new Error('the reload went back to ' + r.view);
    if(r.local !== '"list"') throw new Error('the device holds ' + r.local);
    if(r.shared !== 404) throw new Error('the choice was written to the shared store too (' + r.shared + ')');
    await t.eval(async ()=>{ await setTxnView('board'); });
    return 'List survived the reload, on the device and nowhere else';
  });

});
