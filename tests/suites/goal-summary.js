/* WHAT A GOAL STILL NEEDS, AT THE FIRM'S OWN PLANNING RETURN.

   The tracker said how much was tagged against each goal and left the
   adviser to work out the rest. The questions it did not answer are
   the ones the client asks: how long is left, how much is still
   needed, and what would it take to get there — once, or monthly.

   Money has a cost of time, so none of that is division. The sum is
   the one the Financial Success Ladder already does — the workbook's
   own Excel-sign PV and PMT — at the rate the firm has configured for
   that horizon in Setup. This suite checks the arithmetic against the
   closed form, and checks that the figure in the headline and the
   figure in the table are the same figure. */
const {suite} = require('../lib/harness');

const SEED = async ()=>{
  let c = DB.clients.find(x=>x.id === 'CMS-GOALSUM');
  if(!c){ c = {id:'CMS-GOALSUM'}; DB.clients.push(c); }
  Object.assign(c, {cmsName:'ZZ Goal Summary Client', rmName: currentUser, branch:'Varanasi',
    createdAt:new Date().toISOString()});
  DB.clientGoals = (DB.clientGoals || []).filter(g=>g.clientId !== 'CMS-GOALSUM');
  DB.transactions = (DB.transactions || []).filter(t=>t.clientId !== 'CMS-GOALSUM');
  const inYears = n => { const d = new Date(); d.setHours(0,0,0,0);
                         d.setFullYear(d.getFullYear() + n); return d.toISOString().slice(0,10); };
  const goals = [
    {id:'GOL-ZZ-A', clientId:c.id, name:'ZZ Retirement', target:'30000000', targetDate: inYears(20), priority:'High'},
    {id:'GOL-ZZ-B', clientId:c.id, name:'ZZ Education', target:'5000000',  targetDate: inYears(8),  priority:'Medium'},
    {id:'GOL-ZZ-C', clientId:c.id, name:'ZZ No Date',   target:'1000000',  targetDate:'',            priority:'Low'},
  ];
  DB.clientGoals = DB.clientGoals.concat(goals);
  /* A completed transaction is a folio, and its goalId is the tag. */
  DB.transactions.push({id: uid('TXN'), clientId:c.id, amount:'2500000', status:'Completed',
    transactionType:'Purchase', productCategory:'Mutual Fund', folioNumber:'ZZ-85208520741',
    schemeName:'ZZ Axis Arbitrage Fund', goalId:'GOL-ZZ-A',
    initiatedDate:new Date().toISOString().slice(0,10)});
  await save('clients'); await save('clientGoals'); await save('transactions');
  return c.id;
};

suite(async t => {
  await t.home();
  await t.eval(src => { window.SEED_FN = eval('(' + src + ')'); }, String(SEED));
  let id = null;

  t.section('the arithmetic');

  await t.step('the shortfall is discounted and spread, not divided', async () => {
    id = await t.eval(async ()=>await SEED_FN());
    const r = await t.eval(cid=>{
      const c = DB.clients.find(x=>x.id === cid);
      const g = DB.clientGoals.find(x=>x.id === 'GOL-ZZ-A');
      const p = goalPlanFor(g, 2500000);
      /* The closed form, worked here rather than taken from the code
         under test: what is mapped grows, the gap is what is left at
         the date, the lump is that gap discounted, the instalment is
         the ordinary-annuity payment that reaches it. */
      const r0 = p.rate, n = p.years, i = Math.pow(1 + r0, 1/12) - 1;
      const grown = 2500000 * Math.pow(1 + r0, n);
      const gap = 30000000 - grown;
      const lump = gap / Math.pow(1 + r0, n);
      const pmt = gap * i / (Math.pow(1 + i, n * 12) - 1);
      return {rate: r0, years: n, grown, gap,
              oneTime: p.oneTime, monthly: p.monthly,
              wantLump: lump, wantPmt: pmt,
              naive: (30000000 - 2500000) / (n * 12)};
    }, id);
    if(!(r.years > 19.9 && r.years < 20.1)) throw new Error('the horizon came out ' + r.years + ' years');
    if(!(r.rate > 0)) throw new Error('no planning return was found: ' + r.rate);
    if(Math.abs(r.oneTime - r.wantLump) > 1)
      throw new Error('the one-time figure is ' + Math.round(r.oneTime) + ', not ' + Math.round(r.wantLump));
    if(Math.abs(r.monthly - r.wantPmt) > 1)
      throw new Error('the monthly figure is ' + Math.round(r.monthly) + ', not ' + Math.round(r.wantPmt));
    /* The point of the change: dividing asks for very much more. */
    if(!(r.monthly < r.naive / 2))
      throw new Error('the instalment (' + Math.round(r.monthly) + ') is not far below the naive '
        + Math.round(r.naive) + ', so the time value is not being counted');
    return 'at ' + Math.round(r.rate * 1000) / 10 + '% over ' + Math.round(r.years) + ' years: '
      + Math.round(r.oneTime) + ' once or ' + Math.round(r.monthly) + '/mo, against ' + Math.round(r.naive)
      + '/mo if it were simply divided';
  });

  await t.step('the rate is the firm’s, by horizon, and changing it in Setup moves the answer', async () => {
    const r = await t.eval(cid=>{
      const far = DB.clientGoals.find(x=>x.id === 'GOL-ZZ-A');   // 20 years
      const near = DB.clientGoals.find(x=>x.id === 'GOL-ZZ-B');  // 8 years
      const bands = fslEngineCfg().bands;
      const before = {far: goalPlanFor(far, 0).rate, near: goalPlanFor(near, 0).rate,
                      monthly: goalPlanFor(far, 0).monthly};
      return {before, bands, band10: bands[2], bandOver: bands[3]};
    }, id);
    if(r.before.far !== r.bandOver)
      throw new Error('a 20-year goal planned at ' + r.before.far + ', not the over-ten band ' + r.bandOver);
    if(r.before.near !== r.band10)
      throw new Error('an 8-year goal planned at ' + r.before.near + ', not the under-ten band ' + r.band10);
    return 'twenty years takes the over-ten band and eight years the under-ten one, straight from Setup → FSL';
  });

  await t.step('a goal with no date, no amount or nothing left to do says so rather than guessing', async () => {
    const r = await t.eval(()=>{
      const noDate = goalPlanFor({target:'1000000', targetDate:''}, 0);
      const noAmt = goalPlanFor({target:'', targetDate:'2047-01-01'}, 0);
      const d = new Date(); d.setFullYear(d.getFullYear() + 10);
      const covered = goalPlanFor({target:'1000000', targetDate: d.toISOString().slice(0,10)}, 900000);
      const past = goalPlanFor({target:'1000000', targetDate:'2020-01-01'}, 400000);
      return {noDate: {o: noDate.oneTime, why: noDate.why},
              noAmt: {o: noAmt.oneTime, why: noAmt.why},
              covered: {o: covered.oneTime, m: covered.monthly, why: covered.why},
              past: {o: past.oneTime, m: past.monthly, short: past.shortNow}};
    });
    if(r.noDate.o !== null || !/no target date/.test(r.noDate.why))
      throw new Error('a goal with no date gave ' + r.noDate.o + ' (' + r.noDate.why + ')');
    if(r.noAmt.o !== null || !/no target amount/.test(r.noAmt.why))
      throw new Error('a goal with no amount gave ' + r.noAmt.o);
    if(r.covered.o !== 0 || r.covered.m !== 0)
      throw new Error('a goal that grows into itself still asked for ' + r.covered.o);
    if(r.past.o !== 600000 || r.past.m !== null)
      throw new Error('a goal past its date gave ' + r.past.o + ' once and ' + r.past.m + ' a month');
    return 'no date and no amount say why; one that grows into itself asks for nothing; '
      + 'one past its date is short today and has nothing left to spread over';
  });

  t.section('on the page');

  await t.step('the summary names every column the firm asked for', async () => {
    const r = await t.eval(cid=>{
      const c = DB.clients.find(x=>x.id === cid);
      window._clientTab = 'goals';
      const html = JSON.stringify(viewClientDetail(cid));
      const heads = ['Goal','Corpus required','Target date','Horizon left','Mapped',
                     'Still required','One-time now','Or monthly'];
      return {missing: heads.filter(h=>html.indexOf(h) < 0),
              named: /ZZ Retirement/.test(html) && /ZZ Education/.test(html) && /ZZ No Date/.test(html),
              horizon: /20 years/.test(html),
              /* However the firm's locale groups it. */
              mapped: html.indexOf(money(2500000).replace(/\u20b9/, '')) >= 0,
              total: /All goals/.test(html)};
    }, id);
    if(r.missing.length) throw new Error('the summary has no ' + r.missing.join(', '));
    if(!r.named) throw new Error('not every goal is listed');
    if(!r.horizon) throw new Error('the horizon left is not shown');
    if(!r.mapped) throw new Error('the mapped amount is not shown');
    if(!r.total) throw new Error('there is no line for all the goals together');
    return 'eight columns, three goals, the horizon, the 2,50,000 tagged to Retirement, and a total line';
  });

  await t.step('and the headline figure is the same sum as the table', async () => {
    const r = await t.eval(cid=>{
      const c = DB.clients.find(x=>x.id === cid);
      const folios = clientFolios(c);
      const goals = clientGoals(c);
      const fromTable = goals.reduce((s, g)=>{
        const have = folios.filter(f=>f.goalId === g.id).reduce((x, f)=>x + f.amount, 0);
        return s + (goalPlanFor(g, have).monthly || 0);
      }, 0);
      window._clientTab = 'goals';
      const html = JSON.stringify(viewClientDetail(cid));
      /* The headline is printed with inr(); find it and read it back. */
      const m = /Top-up SIP needed[\s\S]{0,400}?\\u20b9([\d,]+)\/mo/.exec(html)
             || /([\d,]+)\/mo[\s\S]{0,200}?to meet all goals/.exec(html);
      return {fromTable, headline: m ? Number(m[1].replace(/,/g, '')) : null, html: !!m};
    }, id);
    if(!r.html) throw new Error('the headline figure could not be found on the page');
    if(Math.abs(r.headline - Math.round(r.fromTable)) > 2)
      throw new Error('the headline says ' + r.headline + ' and the table adds to ' + Math.round(r.fromTable));
    return 'the Top-up SIP headline and the table agree to the rupee — one sum, printed twice';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
