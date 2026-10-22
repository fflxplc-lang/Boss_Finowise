/* DOWNLOAD REPORT GIVES THE CLIENT THE PAGE THEY ARE LOOKING AT.

   The firm asked for the downloaded report to carry the data on the
   page and to be set out the way the page sets it out — the same
   sections, headings, tables and figures.

   It did not. The page groups the money into a box per goal, each
   headed with the goal, how many schemes sit under it and what they
   come to, and lists the schemes in ten columns. The report drew a
   donut and one flat table with columns of its own invention: Event,
   Annualised, Sharing ratio — none of which appear on the page.

   What this pins is not the wording but the agreement: every goal on
   the page is a box in the report, every scheme a row, and every
   figure the same figure. The share is the part most easily got
   wrong, because the page has two rules for it — a share of its own
   kind of money, or a share of its event where the blueprint maps
   goals to events — so both are checked against the page's own
   helpers rather than against a number typed in here. */
const {suite} = require('../lib/harness');

const LEAD = 'LMS-RPT';
const SEED = `async function(){
  let l = DB.leads.find(x=>x.id === '${LEAD}');
  if(!l){ l = {id:'${LEAD}'}; DB.leads.push(l); }
  Object.assign(l, {firstName:'ZZ Report', lastName:'Match', mobile:'9800555777',
    email:'rpt@example.com', dob:'1990-01-01', assignedTo: currentUser,
    transformationForm:'MULTIGOAL', createdAt:new Date().toISOString(),
    iseqScore:50, iseqMaxScore:100, iseqCategory:'Moderate'});
  if(!stateOf('LMS', l)) initState('LMS', l);
  l.formData = {MULTIGOAL:{name:'ZZ Report Match', mobile:'9800555777', email:'rpt@example.com',
    dob:'1990-01-01', mg_goals:[
      {goal:'Car',   years:'5',  currentValue:'2500000', inflation:'7', returns:'12'},
      {goal:'House', years:'10', currentValue:'8000000', inflation:'7', returns:'12'}]}};
  l.planRounds = [];
  await save('leads');
  await markPlanInputSubmitted(l, 'Client');
  const round = await recomputePlan(l);
  /* A split a client would actually be sent: one goal over two schemes,
     one of them a SIP, and a folio and remark on one line only. */
  round.allocation.lines = [
    {label:'Car', product:'Mutual Fund', platform:'Finowise', fundCategory:'Equity MF',
     transactionType:'Purchase', schemeName:'ZZ Bluechip Fund', amount:1000000,
     folioNumber:'F-1', status:'Not Start', remark:''},
    {label:'Car', product:'Mutual Fund', platform:'Finowise', fundCategory:'Equity MF',
     transactionType:'Purchase', schemeName:'ZZ Flexicap Fund', amount:989614, status:'Not Start'},
    {label:'House', product:'Mutual Fund', platform:'Ametra', fundCategory:'Hybrid',
     transactionType:'SIP', schemeName:'ZZ Hybrid Fund', amount:50000, status:'Not Start'},
  ];
  round.clientDecision = 'Approved';
  round.clientAt = new Date().toISOString();
  await save('leads');
  return l.id;
}`;

suite(async t => {
  await t.home();

  t.section('the report is the page');

  await t.step('a box per goal, a row per scheme, and the page’s own figures', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const id = await (${SEED})();
      const rec = planRecordOf(id), round = latestPlanRound(rec);
      const blocks = blueprintPdfBlocks(rec, round, {finalOnly:true});
      /* what the page itself draws, for the same round */
      const page = planAllocationHtml(rec, round, {readOnly:true});
      const bands = blocks.filter(x=>x.t === 'band').map(x=>x.text);
      const tables = blocks.filter(x=>x.t === 'table');
      const alloc = tables.filter(x=>(x.cols||[]).some(c=>c.label === 'Scheme / Strategy'));
      return {
        bands,
        /* a goal's own band counts its schemes; the section band above
           them only talks about them */
        goalBoxes: blocks.filter(x=>x.t === 'band' && /^\\d+ scheme/.test(String(x.sub||'')))
                         .map(x=>({t:x.text, sub:x.sub})),
        tables: alloc.map(x=>({cols:(x.cols||[]).map(c=>c.label),
                               rows:x.rows, foot:x.foot})),
        total: (blocks.find(x=>x.t === 'kv' && x.label === 'Total allocated')||{}).value,
        /* and what the page says, to hold it against */
        pageHasCols: ['Product','Platform','Category','Transaction Type','Scheme / Strategy',
                      'Amount','Share','Status'].filter(c=>page.indexOf('<th>' + c + '</th>') >= 0),
        pageTotal: /Total allocated/.test(page),
        /* the invented columns are gone */
        invented: tables.some(x=>(x.cols||[]).some(c=>/Annualised|Sharing ratio|^Event$/.test(c.label))),
        donut: blocks.some(x=>x.t === 'donut'),
      };
    })()`));
    if(r.invented) throw new Error('the report still has columns the page does not');
    if(r.donut) throw new Error('the report still leads with a donut the page does not draw');
    if(r.goalBoxes.length !== 2)
      throw new Error(r.goalBoxes.length + ' goal boxes, not one per goal: '
        + r.goalBoxes.map(x=>x.t).join(', '));
    if(r.goalBoxes.map(x=>x.t).join(', ') !== 'Car, House')
      throw new Error('the boxes read ' + r.goalBoxes.map(x=>x.t).join(', '));
    if(!/2 schemes/.test(r.goalBoxes[0].sub))
      throw new Error('the Car box does not count its schemes: ' + r.goalBoxes[0].sub);
    if(!/1 scheme\b/.test(r.goalBoxes[1].sub))
      throw new Error('the House box does not count its scheme: ' + r.goalBoxes[1].sub);
    if(r.tables.length !== 2) throw new Error(r.tables.length + ' allocation tables, not one per goal');
    if(r.tables[0].rows.length !== 2 || r.tables[1].rows.length !== 1)
      throw new Error('the rows per goal are ' + r.tables.map(x=>x.rows.length).join(', '));
    /* the columns the page shows and the report shows are the same ones,
       bar those empty on every line */
    const want = ['Product','Platform','Category','Transaction type','Scheme / Strategy',
                  'Amount','Share','Folio / Account ID','Status'];
    if(r.tables[0].cols.join(' | ') !== want.join(' | '))
      throw new Error('the report’s columns read: ' + r.tables[0].cols.join(' | '));
    return r.goalBoxes.map(x=>x.t + ' (' + x.sub + ')').join('  ·  ');
  });

  await t.step('an empty column is dropped, one with anything in it is kept', async () => {
    const r = await t.eval(id=>{
      const rec = planRecordOf(id), round = latestPlanRound(rec);
      const cols = () => reportAllocCols(round.allocation.lines).map(c=>c.label);
      const was = cols();
      round.allocation.lines.forEach(l=>{ delete l.folioNumber; });
      const without = cols();
      round.allocation.lines[0].remark = 'placed on the 5th';
      const withRemark = cols();
      return {was, without, withRemark};
    }, LEAD);
    if(r.was.indexOf('Folio / Account ID') < 0) throw new Error('a folio on one line did not print its column');
    if(r.without.indexOf('Folio / Account ID') >= 0)
      throw new Error('the folio column is printed with nothing in it');
    if(r.withRemark.indexOf('Remark') < 0) throw new Error('a remark on one line did not print its column');
    return 'Folio drops when every line is blank; Remark appears the moment one is not';
  });

  await t.step('and the share is the figure the page is showing', async () => {
    const r = await t.eval(id=>{
      const rec = planRecordOf(id), round = latestPlanRound(rec);
      const lines = round.allocation.lines;
      const blocks = blueprintPdfBlocks(rec, round, {finalOnly:true});
      const tables = blocks.filter(x=>x.t === 'table'
        && (x.cols||[]).some(c=>c.label === 'Scheme / Strategy'));
      const at = (tbl, row, col) => tbl.rows[row][tbl.cols.findIndex(c=>c.label === col)];
      /* the page's own rule, computed here off the page's own helpers */
      const total = planAllocationTotal(round), sipTotal = planAllocationSipTotal(round);
      const kind = l => { const d = allocLineIsSip(l) ? sipTotal : total;
        return d > 0 ? Math.round((Number(l.amount)||0)/d*1000)/10 : 0; };
      return {
        car0: at(tables[0], 0, 'Share'), car1: at(tables[0], 1, 'Share'),
        house: at(tables[1], 0, 'Share'),
        wantCar0: kind(lines[0]) + '%', wantCar1: kind(lines[1]) + '%',
        wantHouse: kind(lines[2]) + '%',
        amt0: at(tables[0], 0, 'Amount'), amtSip: at(tables[1], 0, 'Amount'),
        foot0: tables[0].foot, total: (blocks.find(x=>x.t === 'kv' && x.label === 'Total allocated')||{}).value,
        money: money(total), sip: money(sipTotal),
      };
    }, LEAD);
    if(r.car0 !== r.wantCar0 || r.car1 !== r.wantCar1 || r.house !== r.wantHouse)
      throw new Error('the shares read ' + [r.car0, r.car1, r.house].join(', ')
        + ' against the page’s ' + [r.wantCar0, r.wantCar1, r.wantHouse].join(', '));
    /* a monthly figure is marked as monthly, and is never added to a lumpsum */
    if(!/\/mo$/.test(r.amtSip)) throw new Error('the SIP line does not read as monthly: ' + r.amtSip);
    if(/\/mo/.test(r.amt0)) throw new Error('a one-time line reads as monthly: ' + r.amt0);
    if(r.total.indexOf(r.money) < 0 || r.total.indexOf(r.sip) < 0)
      throw new Error('Total allocated reads "' + r.total + '", not the page’s '
        + r.money + ' + ' + r.sip + '/mo');
    return 'shares ' + [r.car0, r.car1, r.house].join(' · ') + ', total ' + r.total;
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
