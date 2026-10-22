/* THE FIRM'S OWN INCENTIVE GRID, CHECKED AGAINST THE SHEET IT CAME FROM.

   The Incentive module held the wiring and said so in as many words:
   "No formula, payout rule, target, slab or eligibility condition has
   been created, because none has been supplied." One has now been
   supplied — "RE Incentive Template - Ver 2", three sheets of it — and
   this is the proof that what BOSS computes is what that workbook
   computes, not something near it.

   The sample below is the workbook's own filled-in month, line for
   line: three investment lines, two SIP lines, three insurance lines,
   the three counted summaries, a CTC of 3,60,000 and an August month.
   Every figure asserted here was read off a cell of REIS — the three
   multipliers on each line, the two totals under each section, the
   seven net credits, the seven slabs, the seven rates, the seven
   payouts, and the 36,000 at the bottom.

   Then the edges, because a payout argument is always about an edge:
   the exact baseline, the exact band floors, a stream that qualifies
   but lands under the lowest slab, and a line whose product is not on
   the firm's list. */
const {suite} = require('../lib/harness');

/* REIS, filled in exactly as the workbook ships it. */
const SAMPLE = {
  id:'INC-SAMPLE', userId:'', month:'2026-08', kind:'sales',
  annualCtc:360000, branch:'', designation:'', status:'Draft',
  netSalesRows:[
    {cat:'Mutual Fund',   sub:'Equity',          source:'Self',    meeting:'Independent meeting ', amount:4500000},
    {cat:'Mutual Fund',   sub:'Hybrid',          source:'Company', meeting:'Independent meeting ', amount:875000},
    {cat:'Direct Equity', sub:'Stocks Advisory', source:'Self',    meeting:'Independent meeting ', amount:600000}],
  sipRows:[
    {cat:'Mutual Fund', sub:'Equity', source:'Self',    meeting:'Independent meeting ', amount:124000},
    {cat:'Mutual Fund', sub:'Equity', source:'Company', meeting:'Independent meeting ', amount:100000}],
  meetingRows:[{label:'Individual', n:13}, {label:'Joint Meeting alongwith Senior', n:18},
               {label:'Joint Meeting alongwith Colleague with Support Role', n:3}],
  clientRows:[{label:'Reference by existing Client', n:4}],
  callRows:[{label:'Incoming', n:180}, {label:'Outgoing', n:200}],
  insuranceRows:[
    {cat:'Life',   sub:'Term Plan', source:'Company', meeting:'Independent meeting ',          amount:38000},
    {cat:'Life',   sub:'Term Plan', source:'Company', meeting:'Joint Meeting alongwith Senior', amount:45000},
    {cat:'Health', sub:'Health',    source:'Company', meeting:'Independent meeting ',          amount:24000}],
};

suite(async t => {

  t.section('every line of business, credited the workbook’s way');

  await t.step('the three multipliers and the credit on each line', async () => {
    const r = await t.eval((sheet)=>{
      const out = incCalculate(sheet);
      const say = p => [p.pcw, p.lsw, p.mw, p.mult, p.credit].join('/');
      return {inv: out.sections.investment.map(say),
              sip: out.sections.sip.map(say),
              ins: out.sections.insurance.map(say),
              bad: out.problems.length};
    }, SAMPLE);
    /* REIS O/R/T/V/X on rows 25, 27, 29 — 54, 56 — 80, 82, 84. */
    const want = {
      inv: ['1/1.25/1/1.25/5625000', '1/1/1/1/875000', '1/1.25/1/1.25/750000'],
      sip: ['1/1.25/1/1.25/155000', '1/1/1/1/100000'],
      ins: ['1/1/1/1/38000', '1/1/0.25/0.25/11250', '1/1/1/1/24000'],
    };
    ['inv','sip','ins'].forEach(k=>{
      if(r[k].join(' | ') !== want[k].join(' | '))
        throw new Error(k + ' reads ' + r[k].join(' | ') + '\n  want ' + want[k].join(' | '));
    });
    if(r.bad) throw new Error(r.bad + ' line(s) failed to look up');
    return 'eight lines, every PCW, LSW, MW, multiplier and credit matching REIS';
  });

  await t.step('the TOTAL under each section', async () => {
    const r = await t.eval((sheet)=>{
      const o = incCalculate(sheet);
      return {invA:o.totals.investment.amount, invC:o.totals.investment.credit,
              sipA:o.totals.sip.amount, sipC:o.totals.sip.credit,
              premium:o.premiumTotal,
              life:o.credits.lifeInsurance, health:o.credits.healthInsurance};
    }, SAMPLE);
    const want = {invA:5975000, invC:7250000, sipA:224000, sipC:255000,
                  premium:107000, life:49250, health:24000};
    Object.keys(want).forEach(k=>{
      if(Math.round(r[k]) !== want[k])
        throw new Error(k + ' is ' + r[k] + ', the workbook says ' + want[k]);
    });
    return 'M47 5,975,000 · X47 7,250,000 · M62 224,000 · X62 255,000 · X90 49,250 · X92 24,000';
  });

  await t.step('and the premium total leaves out what REIS!M90 wrongly adds', async () => {
    const r = await t.eval((sheet)=>({p: incCalculate(sheet).premiumTotal}), SAMPLE);
    if(r.p !== 107000) throw new Error('the premium total is ' + r.p);
    /* M90 is SUM(M66:M88), which reaches up into the New Client block
       and makes it 107,008. Nothing downstream reads it. */
    return '107,000, not the 107,008 the workbook’s own cell prints';
  });

  t.section('the seven streams');

  await t.step('baseline, credit, slab, rate and payout, all seven', async () => {
    const r = await t.eval((sheet)=>incCalculate(sheet).streams.map(s=>
      [s.key, Math.round(s.baseline), Math.round(s.credit), s.slab, s.rate,
       Math.round(s.incentive)].join('|')), SAMPLE);
    const want = [
      'netSales|1800000|7250000|Diamond Slab|0.0025|18125',
      'freshSip|60000|255000|Diamond Slab|60|11700',
      'meetings|25|34|Silver Slab|100|900',
      'newClients|5|4|Not Qualified|0|0',
      'callLogs|250|380|Silver Slab|5|650',
      'lifeInsurance|10000|49250|Silver Slab|100|3925',
      'healthInsurance|10000|24000|Silver Slab|50|700'];
    r.forEach((got, i)=>{ if(got !== want[i])
      throw new Error('stream ' + (i + 1) + ' reads ' + got + '\n            want ' + want[i]); });
    return r.length + ' streams, every slab and rate off the Slabs sheet';
  });

  await t.step('and they add up to the 36,000 the workbook prints', async () => {
    const r = await t.eval((sheet)=>({total: incCalculate(sheet).total}), SAMPLE);
    if(Math.round(r.total) !== 36000)
      throw new Error('BOSS makes it ' + r.total + '; REIS!R123 says 36,000');
    return '₹36,000 — REIS!R123 to the rupee';
  });

  t.section('the edges a payout gets argued over');

  await t.step('exactly the baseline does not qualify; a rupee over does', async () => {
    const r = await t.eval((sheet)=>{
      const at = JSON.parse(JSON.stringify(sheet));
      at.meetingRows = [{label:'x', n:25}];
      const over = JSON.parse(JSON.stringify(sheet));
      over.meetingRows = [{label:'x', n:26}];
      const one = incCalculate(at).streams.find(s=>s.key === 'meetings');
      const two = incCalculate(over).streams.find(s=>s.key === 'meetings');
      return {at:{q:one.qualified, inc:one.incentive}, over:{q:two.qualified, slab:two.slab, inc:two.incentive}};
    }, SAMPLE);
    if(r.at.q) throw new Error('25 meetings against a baseline of 25 was treated as qualifying');
    if(r.at.inc !== 0) throw new Error('and it paid ' + r.at.inc);
    if(!r.over.q || r.over.slab !== 'Silver Slab' || r.over.inc !== 100)
      throw new Error('26 meetings gave ' + JSON.stringify(r.over));
    return '25 pays nothing, 26 is Silver and pays ₹100 — the workbook’s strict >';
  });

  await t.step('every band floor and ceiling of the Net Sales slab', async () => {
    const r = await t.eval((sheet)=>{
      const at = n => { const s = JSON.parse(JSON.stringify(sheet));
        s.netSalesRows = [{cat:'Mutual Fund', sub:'Equity', source:'Company',
          meeting:'Independent meeting ', amount:n}];
        const row = incCalculate(s).streams.find(x=>x.key === 'netSales');
        return row.slab + '@' + Math.round(row.rate * 10000) / 10000; };
      return [1999999, 2000000, 2800000, 2800001, 4000000, 4000001].map(at);
    }, SAMPLE);
    const want = ['No Slab@0', 'Silver Slab@0.0015', 'Silver Slab@0.0015',
                  'Gold Slab@0.002', 'Gold Slab@0.002', 'Diamond Slab@0.0025'];
    if(r.join(' ') !== want.join(' '))
      throw new Error('the bands read ' + r.join(' ') + '\n            want ' + want.join(' '));
    return '2,000,000 → Silver · 2,800,001 → Gold · 4,000,001 → Diamond, and nothing below the floor';
  });

  await t.step('qualified but under the lowest slab is said plainly, and pays nothing', async () => {
    /* The workbook's own Sheet1 example lands here: net credit
       19,00,000 clears a baseline of 18,00,000 but the first band does
       not start until 20,00,000. REIS returns the header row and then
       #N/A. BOSS says what happened. */
    const r = await t.eval((sheet)=>{
      const s = JSON.parse(JSON.stringify(sheet));
      s.netSalesRows = [{cat:'Mutual Fund', sub:'Equity', source:'Company',
        meeting:'Independent meeting ', amount:1900000}];
      const row = incCalculate(s).streams.find(x=>x.key === 'netSales');
      return {q: row.qualified, below: row.belowLowest, slab: row.slab,
              inc: row.incentive, floor: row.floor};
    }, SAMPLE);
    if(!r.q) throw new Error('1,900,000 against 1,800,000 did not qualify');
    if(!r.below) throw new Error('it was not flagged as below the lowest slab');
    if(r.inc !== 0) throw new Error('and it paid ' + r.inc);
    if(r.floor !== 2000000) throw new Error('the floor reads ' + r.floor);
    return 'qualified, below the 2,000,000 floor, ₹0 — and it says so rather than erroring';
  });

  await t.step('putting the slab on each person’s own CTC closes that gap', async () => {
    const r = await t.eval(async (sheet)=>{
      const was = (DB.config.incentive || {}).slabBase;
      DB.config.incentive = Object.assign({}, DB.config.incentive, {slabBase:'individual'});
      const s = JSON.parse(JSON.stringify(sheet));
      s.netSalesRows = [{cat:'Mutual Fund', sub:'Equity', source:'Company',
        meeting:'Independent meeting ', amount:1900000}];
      const row = incCalculate(s).streams.find(x=>x.key === 'netSales');
      DB.config.incentive = Object.assign({}, DB.config.incentive, {slabBase: was || 'matrix'});
      return {slab: row.slab, inc: Math.round(row.incentive), below: row.belowLowest};
    }, SAMPLE);
    if(r.below || r.slab !== 'Silver Slab')
      throw new Error('on their own CTC it still reads ' + r.slab);
    if(r.inc !== 2850) throw new Error('it pays ' + r.inc + ', not 1,900,000 × 0.15%');
    return 'Silver at ₹2,850 — the switch in Setup does what the question says it does';
  });

  await t.step('a line that is not on the firm’s lists is dropped, loudly', async () => {
    const r = await t.eval((sheet)=>{
      const s = JSON.parse(JSON.stringify(sheet));
      s.netSalesRows = s.netSalesRows.concat([
        {cat:'Crypto', sub:'Doge', source:'Self', meeting:'Independent meeting ', amount:9999999}]);
      const o = incCalculate(s);
      return {credit: o.totals.investment.credit, dropped: o.totals.investment.dropped,
              problems: o.problems.length, why: (o.problems[0] || {}).why || []};
    }, SAMPLE);
    if(Math.round(r.credit) !== 7250000)
      throw new Error('the unknown line reached the total: ' + r.credit);
    if(r.dropped !== 1 || r.problems !== 1) throw new Error('it was not reported');
    if(!/Crypto/.test(r.why.join(' '))) throw new Error('and the reason does not name it: ' + r.why.join('; '));
    return 'left out of the total exactly as SUMIF(…,"<>#N/A") leaves it out, and named as the reason';
  });

  await t.step('a joint meeting credits a quarter, a colleague leading three quarters', async () => {
    const r = await t.eval((sheet)=>{
      const at = m => { const s = JSON.parse(JSON.stringify(sheet));
        s.netSalesRows = [{cat:'Mutual Fund', sub:'Equity', source:'Company', meeting:m, amount:100000}];
        return incCalculate(s).totals.investment.credit; };
      return {indep: at('Independent meeting'), senior: at('Joint Meeting alongwith Senior'),
              lead: at('Joint Meeting alongwith Colleague - Leader Role'),
              support: at('Joint Meeting alongwith Colleague - Support Role')};
    }, SAMPLE);
    const want = {indep:100000, senior:25000, lead:75000, support:25000};
    Object.keys(want).forEach(k=>{ if(r[k] !== want[k])
      throw new Error(k + ' credits ' + r[k] + ', Lists!C51:C55 says ' + want[k]); });
    return '1 · 0.25 · 0.75 · 0.25, straight off Lists';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
