/* THE MAIN DASHBOARD.

   Two sections, as Main_Dashboard_Updated.docx sets them out. What is worth
   testing here is not that a panel exists — a screenshot shows that — but
   that the figures are the firm's own records added up, and that the panels
   which cannot be honest say so.

   So: the parts sum to the whole on every breakdown, Revenue disappears for
   anyone without the permission, and the two places where BOSS does not
   capture what the note asks for carry a sentence saying which. A dashboard
   that quietly shows zero where it means "we never recorded this" is the
   failure mode this file exists to catch. */
const {suite} = require('../lib/harness');

/* A small book, laid out so the arithmetic has a known answer. */
const SEED = async () => {
  const br = (DB.config.branches || ['Varanasi'])[0];
  /* Finished business, asked for by name. "The last status on the
     list" meant that until Declined was added after Completed. */
  const done = businessDoneStatus();
  const iso = d => d.toISOString().slice(0, 10);
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const mk = (i) => {
    const c = {id:uid('CMS'), cmsName:'ZZ Dash ' + i, rmName:currentUser, branch:br,
      kycStatus: i % 2 ? 'Validated' : 'Pending',
      clientCategory: ['Alpha','Beta','Charlie','Delta'][i % 4],
      createdAt:new Date().toISOString(), createdBy:currentUser};
    initState('CMS', c); DB.clients.push(c);
    return c;
  };
  // four purchases of 100000 each, in four product buckets, and one SIP
  const cats = ['Equity','Debt','Hybrid','PMS'];
  for(let i = 0; i < 4; i++){
    const c = mk(i);
    DB.transactions.push({id:uid('TXN'), clientId:c.id, amount:100000, status:'Completed',
      transactionType:'Purchase', productCategory:cats[i], platform:'BSE StAR MF',
      createdAt:new Date().toISOString(), createdBy:currentUser});
  }
  const sipClient = mk(4);
  DB.transactions.push({id:uid('TXN'), clientId:sipClient.id, amount:5000, status:'Completed',
    transactionType:'SIP', productCategory:'Equity', platform:'NSE NMF II',
    createdAt:new Date().toISOString(), createdBy:currentUser});
  // one redemption of 20000 — business lost
  DB.transactions.push({id:uid('TXN'), clientId:sipClient.id, amount:20000, status:'Completed',
    transactionType:'Redemption', productCategory:'Equity', platform:'BSE StAR MF',
    createdAt:new Date().toISOString(), createdBy:currentUser});
  // business: one completed this month, one last month, one still open
  DB.businessEntries.push(
    {id:uid('DBT'), clientId:sipClient.id, amount:100000, dbtType:'Investment', status:done,
     transactionType:'Purchase', productCategory:'Equity', executionDate:iso(now),
     createdAt:new Date().toISOString(), createdBy:currentUser},
    {id:uid('DBT'), clientId:sipClient.id, amount:50000, dbtType:'Investment', status:done,
     transactionType:'Purchase', productCategory:'Equity', executionDate:iso(lastMonth),
     createdAt:new Date().toISOString(), createdBy:currentUser},
    {id:uid('DBT'), clientId:sipClient.id, amount:70000, dbtType:'Investment', status:'In Process',
     transactionType:'SIP', productCategory:'Equity', executionDate:iso(now),
     createdAt:new Date().toISOString(), createdBy:currentUser});
  DB.commissionRates.push({id:uid('COM'), productCategory:'Equity', ratePct:'1',
    createdBy:currentUser, createdAt:new Date().toISOString()});
  await save('clients'); await save('transactions');
  await save('businessEntries'); await save('commissionRates');
  navigate('dashboard');
};

suite(async t => {
  await t.step('seed a small book with a known answer', async () => {
    await t.eval(SEED);
    await t.wait(600);
    return 'five clients, six transactions, three business entries, one rate';
  });

  t.section('the two sections the note asks for');

  await t.step('Dashboard and Business Efficiency Report, in that order', async () => {
    const heads = await t.eval(()=>Array.from(document.querySelectorAll('.md-sec-head h2')).map(h=>h.textContent.trim()));
    if(heads.indexOf('Dashboard') !== 0) throw new Error('the first section is ' + heads[0]);
    if(heads.indexOf('Business Efficiency Report') !== 1) throw new Error('the sections read ' + heads.join(' / '));
    return heads.join(' → ');
  });

  await t.step('all nine panels of section one are drawn', async () => {
    const want = ['Live AUM','Live SIP','Number of Clients','Business in Pipeline (DBT)',
                  'Growth %','Revenue','Compliance','Project Summary','Business Lost'];
    const txt = await t.eval(()=>document.getElementById('content').textContent);
    const missing = want.filter(w => txt.indexOf(w) < 0);
    if(missing.length) throw new Error('missing: ' + missing.join(', '));
    return want.length + ' panels';
  });

  t.section('the figures are the records added up');

  await t.step('Live AUM is the signed sum, and its parts add to it', async () => {
    const r = await t.eval(()=>{
      const txns = mdTxns();
      const total = txns.reduce((s,x)=>s+mdSigned(x), 0);
      const cuts = mdCuts(txns, mdSigned);
      const sums = {};
      Object.keys(cuts).forEach(k=>{ sums[k] = cuts[k].reduce((s,x)=>s+x.value, 0); });
      return {total, sums, buckets: cuts.product.map(x=>x.label)};
    });
    // 4 × 100000 + 5000 − 20000
    if(r.total !== 385000) throw new Error('AUM reads ' + r.total + ', expected 385000');
    for(const k of Object.keys(r.sums))
      if(r.sums[k] !== r.total) throw new Error('the ' + k + ' cut sums to ' + r.sums[k] + ', not ' + r.total);
    const odd = r.buckets.filter(b => ['Equity','Debt','Hybrid','Others'].indexOf(b) < 0);
    if(odd.length) throw new Error('product buckets outside the four: ' + odd.join(', '));
    return '₹385,000, and all four cuts agree';
  });

  await t.step('PMS falls into Others rather than off the edge', async () => {
    const got = await t.eval(()=>[mdProductBucket({productCategory:'Equity'}),
                                 mdProductBucket({productCategory:'Debt'}),
                                 mdProductBucket({productCategory:'Hybrid'}),
                                 mdProductBucket({productCategory:'PMS'}),
                                 mdProductBucket({})]);
    if(got.join(',') !== 'Equity,Debt,Hybrid,Others,Others') throw new Error(got.join(','));
    return got.join(' / ');
  });

  await t.step('Live SIP counts only the SIP lines', async () => {
    const v = await t.eval(()=>mdTxns().filter(x=>/sip/i.test(x.transactionType||''))
      .reduce((s,x)=>s+numVal(x.amount), 0));
    if(v !== 5000) throw new Error('SIP reads ' + v);
    return '₹5,000';
  });

  await t.step('the client card can be cut by category as well', async () => {
    const pills = await t.eval(()=>{
      const cards = Array.from(document.querySelectorAll('.md-card'));
      const card = cards.find(c=>/Number of Clients/.test(c.textContent));
      return card ? Array.from(card.querySelectorAll('.md-pill')).map(p=>p.textContent.trim()) : null;
    });
    if(!pills) throw new Error('no client card');
    for(const w of ['Product','Platform','Branch','RM','Category'])
      if(pills.indexOf(w) < 0) throw new Error('no ' + w + ' pill: ' + pills.join(', '));
    return pills.join(' · ');
  });

  await t.step('clicking a pill changes the cut that is drawn', async () => {
    const r = await t.eval(async ()=>{
      setMdCut('clients','category');
      await new Promise(r=>setTimeout(r,200));
      const card = Array.from(document.querySelectorAll('.md-card')).find(c=>/Number of Clients/.test(c.textContent));
      const labels = Array.from(card.querySelectorAll('.md-bar-lbl')).map(x=>x.textContent.trim());
      setMdCut('clients','product');
      return labels;
    });
    const cats = ['Alpha','Beta','Charlie','Delta'];
    if(!r.some(l=>cats.indexOf(l) >= 0)) throw new Error('the category cut shows ' + r.join(', '));
    return 'category cut shows ' + r.join(', ');
  });

  await t.step('the DBT pipeline counts what is open, not what is done', async () => {
    const rows = await t.eval(()=>mdPipelineFigures());
    const sip = rows.find(r=>r.label==='SIP');
    const lump = rows.find(r=>r.label==='Lumpsum');
    if(!sip || sip.value !== 70000) throw new Error('SIP in pipeline reads ' + (sip && sip.value));
    if(!lump || lump.value !== 0) throw new Error('a completed entry leaked into the pipeline: ' + lump.value);
    return 'SIP ₹70,000 open, nothing completed counted';
  });

  await t.step('Life and Health split themselves once the categories exist', async () => {
    const before = await t.eval(()=>mdPipelineFigures().map(r=>r.label));
    const after = await t.eval(async ()=>{
      const e = DB.businessEntries.find(x=>x.status!=='Completed');
      e.productCategory = 'Life Insurance';
      DB.businessEntries.push(Object.assign({}, e, {id:uid('DBT'), productCategory:'Health Insurance', amount:30000}));
      await save('businessEntries');
      return mdPipelineFigures().map(r=>r.label);
    });
    if(before.indexOf('Life Insurance') >= 0) throw new Error('it was already split before the categories existed');
    for(const w of ['Life Insurance','Health Insurance'])
      if(after.indexOf(w) < 0) throw new Error('no ' + w + ' row: ' + after.join(', '));
    return before.join('/') + '  →  ' + after.join('/');
  });

  await t.step('growth compares this month with last', async () => {
    const g = await t.eval(()=>mdGrowth());
    const mom = g.find(x=>x.label==='Month on month');
    if(!mom) throw new Error('no month-on-month row');
    if(mom.cur !== 100000 || mom.prev !== 50000)
      throw new Error('this month ' + mom.cur + ' against last ' + mom.prev);
    if(mom.pct !== 100) throw new Error('growth reads ' + mom.pct + '%, expected 100');
    if(g.length !== 3) throw new Error(g.length + ' periods, expected MoM, QoQ and YoY');
    return '₹1,00,000 against ₹50,000 — +100%';
  });

  await t.step('compliance is every client against every rule', async () => {
    const c = await t.eval(()=>mdCompliance());
    if(c.pct === null) throw new Error('no percentage computed');
    if(c.pct < 0 || c.pct > 100) throw new Error('out of range: ' + c.pct);
    const kyc = c.rules.find(r=>/kyc/i.test(r.label));
    if(!kyc) throw new Error('the KYC rule is not counted');
    if(kyc.of !== c.clients) throw new Error('a rule is counted over ' + kyc.of + ' of ' + c.clients + ' clients');
    return c.pct + '% across ' + c.clients + ' clients, ' + c.rules.length + ' rules';
  });

  t.section('revenue is the one figure not everybody may see');

  await t.step('it is computed from the rate card, not stored', async () => {
    const r = await t.eval(()=>mdRevenue());
    // Equity purchases: 100000 + 5000 SIP, at 1% = 1050. The redemption is not revenue.
    if(Math.round(r.total) !== 1050) throw new Error('revenue reads ' + r.total + ', expected 1050');
    if(!r.unrated) throw new Error('it did not notice the categories with no rate');
    return '₹' + Math.round(r.total) + ', with ' + r.unrated + ' transactions unrated';
  });

  await t.step('without the permission the panel is not drawn at all', async () => {
    const r = await t.eval(async ()=>{
      const real = window.canAdmin;
      window.canAdmin = (f) => f === 'manageReports' ? false : real(f);
      navigate('dashboard');
      await new Promise(r=>setTimeout(r,250));
      const hidden = document.getElementById('content').textContent.indexOf('Admin only') < 0;
      window.canAdmin = real;
      navigate('dashboard');
      await new Promise(r=>setTimeout(r,250));
      const shown = document.getElementById('content').textContent.indexOf('Admin only') >= 0;
      return {hidden, shown};
    });
    if(!r.hidden) throw new Error('Revenue was still on screen without the permission');
    if(!r.shown) throw new Error('Revenue did not come back with the permission');
    return 'hidden without manageReports, shown with it';
  });

  t.section('what BOSS does not capture, it says so');

  await t.step('business lost names the good-against-bad gap', async () => {
    const txt = await t.eval(()=>document.getElementById('content').textContent);
    if(txt.indexOf('Good against bad redemption is not shown') < 0)
      throw new Error('the gap is not stated on the panel');
    const lost = await t.eval(()=>mdLost());
    if(lost.total !== 20000) throw new Error('redemptions total ' + lost.total);
    return 'stated, and ₹20,000 of redemption counted';
  });

  await t.step('the TAT label stands, with its meaning written beside it', async () => {
    const txt = await t.eval(()=>document.getElementById('content').textContent);
    if(txt.indexOf('TAT Flowing Rate') < 0) throw new Error('the label was changed');
    if(!/Measured as the days/.test(txt)) throw new Error('nothing says what it is measured as');
    return 'label kept, definition shown';
  });

  t.section('the efficiency section');

  await t.step('conversion, time to convert and the source pie', async () => {
    const r = await t.eval(()=>{
      const e = mdEfficiency();
      const card = Array.from(document.querySelectorAll('.md-card')).find(c=>/LEAD MANAGEMENT/i.test(c.textContent));
      const legend = card ? Array.from(card.querySelectorAll('.alloc-pie-val')).map(x=>x.textContent.trim()) : [];
      return {conv: e.convRatio, of: e.convOf, legend, pie: !!(card && card.querySelector('svg'))};
    });
    if(r.conv === null) throw new Error('no conversion ratio');
    if(!r.pie) throw new Error('the lead source pie is not drawn');
    if(r.legend.some(v=>/₹/.test(v)))
      throw new Error('the pie legend reads lead counts as money: ' + r.legend.join(', '));
    return 'conversion over ' + r.of + ' leads, pie legend ' + r.legend.join('/');
  });

  await t.step('RMS shows plan against actual and the two averages', async () => {
    const txt = await t.eval(()=>document.getElementById('content').textContent);
    for(const w of ['Plan vs actual','New business per review','References per review'])
      if(txt.indexOf(w) < 0) throw new Error('no "' + w + '"');
    return 'all three';
  });

  await t.step('a person’s own day is still on the screen', async () => {
    const txt = await t.eval(()=>document.getElementById('content').textContent);
    for(const w of ['Your day','My Open Leads','Overdue Tasks'])
      if(txt.indexOf(w) < 0) throw new Error('"' + w + '" went missing');
    return 'leads, overdue tasks and reviews kept';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
