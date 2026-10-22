/* A FIGURE ON THE DASHBOARD IS A QUESTION HALF ANSWERED.

   Live AUM reads a number with nine digits in it and the only thing
   anybody wants next is WHOSE — which meant leaving the dashboard,
   opening CMS and rebuilding the same filter by hand, for every figure
   on the board.

   So every figure opens. Press the total, a bar of whichever cut is
   showing, a pipeline figure, either money cell of the growth table, a
   compliance rule, and the records that add up to it come up over the
   page: named, totalled, each one a press from the record itself.

   Two things have to hold or the feature is worse than nothing. The
   list must add up to the figure it opened from — a drill-down that
   disagrees with the card teaches people to trust neither. And it must
   obey the same scope rule the card does, because a figure that
   withholds somebody else's clients cannot open on them. Both come
   from reading dashCtx(), which is what the card itself is drawn
   from. */
const {suite} = require('../lib/harness');

const SEED = async ()=>{
  ['Asha Menon','Rohit Khanna'].forEach((nm, i)=>{
    if(DB.team.some(x=>x.id === 'USR-D' + i)) return;
    DB.team.push({id:'USR-D' + i, name:nm, email:'d' + i + '@example.com', role:defaultRole(),
      status:'Active', branch: i ? 'Mumbai' : 'Varanasi', documents:[], notes:[],
      perms:{}, adminFlags:{}});
  });
  const today = new Date().toISOString().slice(0, 10);
  for(let i = 0; i < 12; i++){
    const id = 'CMS-DRL' + i;
    if(DB.clients.some(c=>c.id === id)) continue;
    const c = {id, cmsName:'ZZ Drill ' + i, mobile:'98001000' + (10 + i),
      email:'drill' + i + '@example.com', clientCategory:['A','B','C'][i % 3],
      rmName:'USR-D' + (i % 2), branch: i % 2 ? 'Mumbai' : 'Varanasi',
      kycStatus: i % 3 ? 'Validated' : '', createdAt:new Date().toISOString()};
    initState('CMS', c); DB.clients.push(c);
    DB.transactions.push({id:'TXN-DRL' + i, clientId:id, status:'Completed',
      transactionType: i % 4 === 3 ? 'Redemption' : 'Purchase',
      productCategory:['Equity','Debt','Hybrid'][i % 3],
      platform: i % 2 ? 'NJ' : 'Finowise', amount: 100000 * (i + 3), transactionDate: today});
    if(i % 2 === 0) DB.transactions.push({id:'TXN-DRS' + i, clientId:id, status:'Completed',
      transactionType:'SIP', productCategory:'Equity', platform:'NJ',
      amount: 5000 * (i + 1), transactionDate: today});
    DB.businessEntries.push({id:'BIZ-DRL' + i, clientId:id, amount: 50000 * (i + 1),
      transactionType: i % 2 ? 'SIP' : 'Purchase', productCategory:'Equity',
      status: i % 3 === 0 ? 'Completed' : 'Logged', executionDate: today,
      createdAt:new Date().toISOString(), createdBy:currentUser});
  }
  await save('clients'); await save('transactions');
  await save('businessEntries'); await save('team');
  navigate('dashboard');
  return true;
};

suite(async t => {

  t.section('every figure says it opens');

  await t.step('the totals, the bars and the cells all carry a way in', async () => {
    await t.eval(SEED);
    await t.wait(800);
    const r = await t.eval(()=>{
      const n = sel => document.querySelectorAll(sel).length;
      const card = id => document.querySelector('[data-widget="' + id + '"]');
      return {totals: n('.md-total.md-open'), bars: n('.md-bar.md-open'),
              figs: n('.md-fig.md-open'), growth: n('table .md-open'),
              gauge: n('.md-gauge.md-open'),
              keyed: [...document.querySelectorAll('.md-open')]
                       .every(e=>e.getAttribute('tabindex') === '0'),
              anyCard: !!card};
    });
    if(r.totals < 3) throw new Error('only ' + r.totals + ' headline figures open');
    if(r.bars < 3) throw new Error('only ' + r.bars + ' bars open');
    if(!r.figs) throw new Error('the pipeline figures do not open');
    if(r.growth !== 6) throw new Error('the growth table offers ' + r.growth + ' cells, not 6');
    if(!r.gauge) throw new Error('the compliance gauge does not open');
    if(!r.keyed) throw new Error('something that opens cannot be reached from the keyboard');
    return r.totals + ' totals, ' + r.bars + ' bars, ' + r.figs + ' pipeline figures, '
      + r.growth + ' growth cells and the compliance gauge';
  });

  t.section('and what it opens on adds up to it');

  await t.step('Live AUM: the list sums to the figure on the card', async () => {
    const r = await t.eval(()=>{
      const c = dashCtx();
      const card = c.aumRows.reduce((s, x)=>s + x.aum, 0);
      const out = MD_DRILLS.aum(c, '', '');
      const back = n => Number(String(n).replace(/[^0-9.-]/g, ''));
      return {card: Math.round(card), drill: back(out.figure),
              rows: out.rows.length, clients: new Set(c.aumRows.map(x=>x.clientId)).size};
    });
    if(Math.abs(r.card - r.drill) > 1)
      throw new Error('the card says ' + r.card + ' and the list ' + r.drill);
    if(!r.rows) throw new Error('it opened on nothing');
    return r.rows + ' clients, summing to the same ' + r.drill + ' the card prints';
  });

  await t.step('a bar opens on its own bucket, and only that', async () => {
    const r = await t.eval(()=>{
      const c = dashCtx();
      const cuts = mdBookCuts(c.aumRows, x=>x.aum);
      const bar = cuts.branch.find(b=>b.label === 'Mumbai');
      const out = MD_DRILLS.aum(c, 'branch', 'Mumbai');
      const back = n => Number(String(n).replace(/[^0-9.-]/g, ''));
      const branches = out.rows.map(row=>row.cells[1]);
      return {bar: Math.round(bar.value), drill: back(out.figure),
              branches: Array.from(new Set(branches)), n: out.rows.length,
              all: cuts.branch.reduce((s, b)=>s + b.value, 0)};
    });
    if(Math.abs(r.bar - r.drill) > 1)
      throw new Error('the bar reads ' + r.bar + ' and its list ' + r.drill);
    if(r.branches.length !== 1 || r.branches[0] !== 'Mumbai')
      throw new Error('it let other branches in: ' + r.branches.join(', '));
    if(r.drill >= r.all) throw new Error('one branch cannot be the whole book');
    return r.n + ' Mumbai clients, ' + r.drill + ' of the book’s ' + Math.round(r.all);
  });

  await t.step('the client count opens on exactly that many clients', async () => {
    const r = await t.eval(()=>{
      const c = dashCtx();
      const all = MD_DRILLS.clients(c, '', '');
      const cat = c.clientCuts.category.find(x=>x.label === 'A');
      const one = MD_DRILLS.clients(c, 'category', 'A');
      return {total: c.clients.length, rows: all.rows.length,
              catSays: cat ? cat.value : 0, catRows: one.rows.length,
              onlyA: one.rows.every(r2=>r2.cells[3] === 'A')};
    });
    if(r.rows !== r.total) throw new Error('the card counts ' + r.total + ' and the list shows ' + r.rows);
    if(r.catRows !== r.catSays)
      throw new Error('the Category A bar says ' + r.catSays + ' and its list shows ' + r.catRows);
    if(!r.onlyA) throw new Error('the Category A list is not all Category A');
    return r.rows + ' clients in all, ' + r.catRows + ' of them Category A';
  });

  await t.step('the pipeline, the growth cells and the redemptions all open', async () => {
    const r = await t.eval(()=>{
      const c = dashCtx();
      const back = n => Number(String(n).replace(/[^0-9.-]/g, ''));
      const lump = c.pipeline.find(p=>p.label === 'Lumpsum');
      const pipe = MD_DRILLS.pipeline(c, '', 'Lumpsum');
      const g = c.growth[0];
      const now = MD_DRILLS.growth(c, 'now', g.label);
      const before = MD_DRILLS.growth(c, 'before', g.label);
      const lost = MD_DRILLS.lost(c, '', '');
      return {pipeSays: Math.round(lump.value), pipeDrill: back(pipe.figure), pipeRows: pipe.rows.length,
              nowSays: Math.round(g.cur), nowDrill: back(now.figure),
              beforeSays: Math.round(g.prev), beforeDrill: back(before.figure),
              lostSays: Math.round(c.lost.total), lostDrill: back(lost.figure),
              lostRows: lost.rows.length};
    });
    if(r.pipeSays !== r.pipeDrill)
      throw new Error('the Lumpsum figure reads ' + r.pipeSays + ' and its list ' + r.pipeDrill);
    if(!r.pipeRows) throw new Error('the Lumpsum figure opened on nothing');
    if(r.nowSays !== r.nowDrill)
      throw new Error('this month reads ' + r.nowSays + ' and its list ' + r.nowDrill);
    if(r.beforeSays !== r.beforeDrill)
      throw new Error('last month reads ' + r.beforeSays + ' and its list ' + r.beforeDrill);
    if(r.lostSays !== r.lostDrill)
      throw new Error('Business Lost reads ' + r.lostSays + ' and its list ' + r.lostDrill);
    if(!r.lostRows) throw new Error('Business Lost opened on no redemptions');
    return 'Lumpsum ' + r.pipeRows + ' entries, this month ' + r.nowDrill
      + ' against ' + r.beforeDrill + ' before, ' + r.lostRows + ' redemptions';
  });

  await t.step('compliance opens on who is left to chase, and says what is missing', async () => {
    const r = await t.eval(()=>{
      const c = dashCtx();
      const rule = (c.comp.rules || [])[0];
      if(!rule) return {skip:true};
      const out = MD_DRILLS.compliance(c, '', rule.label);
      return {label: rule.label, ok: rule.ok, of: rule.of, rows: out.rows.length,
              named: out.rows.every(r2=>r2.cells[3] === rule.label)};
    });
    if(r.skip) return 'no rules configured in this book — nothing to check';
    if(r.rows !== r.of - r.ok)
      throw new Error(r.ok + ' of ' + r.of + ' satisfy it, so ' + (r.of - r.ok)
        + ' should be listed, not ' + r.rows);
    if(!r.named) throw new Error('the list does not say which rule is unmet');
    return r.rows + ' still to chase on “' + r.label + '”, each saying so';
  });

  t.section('it can only open on what the card was allowed to count');

  await t.step('a scope that hides a client hides it here too', async () => {
    const r = await t.eval(async ()=>{
      const me0 = DB.team.find(x=>x.id === currentUser);
      const was = me0.scope, wasRole = me0.role;
      me0.scope = 'own'; me0.role = 'Relationship Manager';
      const c = dashCtx();
      const out = MD_DRILLS.clients(c, '', '');
      const aum = MD_DRILLS.aum(c, '', '');
      const theirs = out.rows.filter(x=>/ZZ Drill/.test(x.cells[0])).length;
      const inAum = aum.rows.filter(x=>/ZZ Drill/.test(x.cells[0])).length;
      me0.scope = was; me0.role = wasRole;
      const back = dashCtx();
      return {counted: c.clients.length, listed: out.rows.length, theirs, inAum,
              full: back.clients.length,
              fullListed: MD_DRILLS.clients(back, '', '').rows.length};
    });
    if(r.listed !== r.counted)
      throw new Error('under a narrow scope the card counts ' + r.counted + ' and the list shows ' + r.listed);
    if(r.theirs || r.inAum)
      throw new Error('somebody else’s clients came through the drill-down: '
        + r.theirs + ' in the count, ' + r.inAum + ' in the AUM');
    if(r.fullListed !== r.full) throw new Error('and the full scope no longer lists everything');
    return 'on "own" the list shows ' + r.listed + ' and none of the twelve belonging to others; '
      + 'back on the admin scope, all ' + r.full;
  });

  t.section('and it reaches the record');

  await t.step('pressing a line opens the client it came from', async () => {
    const r = await t.eval(async ()=>{
      mdDrill('aum', '', '');
      const row = document.querySelector('.modal .row-clickable');
      const name = row ? row.querySelector('td b').textContent : '';
      if(row) row.click();
      await new Promise(res=>setTimeout(res, 250));
      return {name, open: document.getElementById('overlay').classList.contains('show'),
              where: currentView, id: window._clientId || ''};
    });
    if(!r.name) throw new Error('the drill-down showed no rows to press');
    if(r.open) throw new Error('the paper stayed up over the record it opened');
    if(r.where !== 'cms') throw new Error('it landed on "' + r.where + '" rather than the client');
    return 'pressing “' + r.name + '” closed the paper and opened them in CMS';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
