/* THE DBT HIERARCHY IS PRODUCT-WISE, WITH THE TYPES NESTED UNDER IT.

   A blueprint used to raise its business transaction-type-wise: one
   DBT for the one-time money and one for the monthly, whatever
   products they were going into. The firm asked for it the other way
   round — product first, types under it — because that is how the
   money is placed and how a desk works it.

       Mutual Fund          (one Main DBT, covering MF and SIF)
         └─ Purchase
         └─ SIP
       Wealth Product       (one Main DBT)
         └─ PMS
              └─ Purchase
         └─ AIF
              └─ SIP

   Which products are mutual funds is the firm's to set, in Setup, so
   this checks the grouping follows the list rather than a rule
   written into the code.

   And it has to be raisable twice. Update DBT pressed again, a page
   refreshed, a plan re-prepared: the same hierarchy, not a second
   copy of it. */
const {suite} = require('../lib/harness');

const LEAD = 'LMS-DBTH';
const SEED = `async function(lines){
  let l = DB.leads.find(x=>x.id === '${LEAD}');
  if(!l){ l = {id:'${LEAD}'}; DB.leads.push(l); }
  Object.assign(l, {firstName:'ZZ Hier', lastName:'Archy', mobile:'9800222999',
    email:'hier@example.com', dob:'1988-02-02', assignedTo: currentUser,
    transformationForm:'MULTIGOAL', createdAt:new Date().toISOString(),
    iseqScore:50, iseqMaxScore:100, iseqCategory:'Moderate'});
  if(!stateOf('LMS', l)) initState('LMS', l);
  l.formData = {MULTIGOAL:{name:'ZZ Hier Archy', mobile:'9800222999', email:'hier@example.com',
    dob:'1988-02-02', mg_goals:[{goal:'Car', years:'5', currentValue:'2500000',
                                 inflation:'7', returns:'12'}]}};
  l.planRounds = [];
  DB.businessEntries = (DB.businessEntries||[]).filter(b=>b.leadId !== l.id);
  DB.recommendations = (DB.recommendations||[]).filter(r=>r.leadId !== l.id);
  await save('leads'); await save('businessEntries'); await save('recommendations');
  await markPlanInputSubmitted(l, 'Client');
  const round = await recomputePlan(l);
  round.allocation.lines = lines;
  round.seniorStatus = 'Approved';
  await save('leads');
  return l.id;
}`;

/* A plan a firm would actually write: mutual funds one-time and monthly,
   a SIF (which is a mutual fund as far as the firm is concerned), and two
   wealth products of different kinds. */
const LINES = `[
  {label:'Car', product:'Mutual Fund', platform:'Finowise', transactionType:'Purchase',
   schemeName:'ZZ Bluechip', amount:1000000},
  {label:'Car', product:'Mutual Fund', platform:'Ametra', transactionType:'SIP',
   schemeName:'ZZ Flexi', amount:50000},
  {label:'Car', product:'SIF', platform:'Finowise', transactionType:'Purchase',
   schemeName:'ZZ SIF One', amount:300000},
  {label:'Car', product:'PMS', platform:'Ametra', transactionType:'Purchase',
   schemeName:'ZZ PMS One', amount:5000000},
  {label:'Car', product:'AIF', platform:'Ametra', transactionType:'SIP',
   schemeName:'ZZ AIF One', amount:100000}
]`;

const tree = `function(id){
  const round = latestPlanRound(planRecordOf(id));
  return planDbtTree(id, round.n).map(b=>({path:b.dbtPath, level:b.dbtLevel,
    cat:b.dbtCategory, amt:Number(b.amount), rollup:!!b.dbtRollup,
    sheet: !!allocationForDbt(b.id)})).sort((a,b)=>a.path.localeCompare(b.path));
}`;

suite(async t => {
  await t.home();

  t.section('what a mixed plan raises');

  await t.step('one Main DBT per family, the types under them, products under Wealth', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const id = await (${SEED})(${LINES});
      const rec = planRecordOf(id), round = latestPlanRound(rec);
      await planRaiseDbtHierarchy(rec, round);
      return {tree: (${tree})(id)};
    })()`));
    const paths = r.tree.map(x=>x.path);
    const want = [
      'Mutual Fund', 'Mutual Fund/Purchase', 'Mutual Fund/SIP',
      'Wealth Product', 'Wealth Product/AIF', 'Wealth Product/AIF/SIP',
      'Wealth Product/PMS', 'Wealth Product/PMS/Purchase',
    ];
    if(paths.join(' | ') !== want.join(' | '))
      throw new Error('the hierarchy reads:\n  ' + paths.join('\n  '));
    return paths.length + ' nodes — ' + paths.join(', ');
  });

  await t.step('the money adds up at every level', async () => {
    const r = await t.eval(new Function('id', `return (${tree})(id)`), LEAD);
    const at = p => (r.find(x=>x.path === p) || {}).amt;
    /* MF = 10,00,000 purchase + 3,00,000 SIF purchase + 50,000 SIP */
    if(at('Mutual Fund') !== 1350000) throw new Error('the Mutual Fund main reads ' + at('Mutual Fund'));
    if(at('Mutual Fund/Purchase') !== 1300000)
      throw new Error('its purchases read ' + at('Mutual Fund/Purchase') + ' — the SIF should be in with them');
    if(at('Mutual Fund/SIP') !== 50000) throw new Error('its SIP reads ' + at('Mutual Fund/SIP'));
    if(at('Wealth Product') !== 5100000) throw new Error('the Wealth main reads ' + at('Wealth Product'));
    if(at('Wealth Product/PMS') !== 5000000) throw new Error('PMS reads ' + at('Wealth Product/PMS'));
    if(at('Wealth Product/AIF/SIP') !== 100000) throw new Error('the AIF SIP reads ' + at('Wealth Product/AIF/SIP'));
    return 'MF 13,50,000 (12 + 1 lakh SIF purchase, 50k SIP) · Wealth 51,00,000';
  });

  await t.step('only a leaf opens an Execution Plan', async () => {
    const r = await t.eval(new Function('id', `return (${tree})(id)`), LEAD);
    const leaves = r.filter(x=>!x.rollup), heads = r.filter(x=>x.rollup);
    const badLeaf = leaves.filter(x=>!x.sheet).map(x=>x.path);
    const badHead = heads.filter(x=>x.sheet).map(x=>x.path);
    if(badLeaf.length) throw new Error('a leaf opened no Execution Plan: ' + badLeaf.join(', '));
    if(badHead.length) throw new Error('a heading opened one anyway: ' + badHead.join(', '));
    if(leaves.length !== 4)
      throw new Error(leaves.length + ' leaves, expected 4: ' + leaves.map(x=>x.path).join(', '));
    return leaves.length + ' Execution Plans, under ' + heads.length + ' headings';
  });

  t.section('and it cannot be raised twice');

  await t.step('pressing Update DBT again changes nothing', async () => {
    const r = await t.eval(new Function('id', `return (async ()=>{
      const rec = planRecordOf(id), round = latestPlanRound(rec);
      const before = (${tree})(id);
      await planRaiseDbtHierarchy(rec, round);
      await planRaiseDbtHierarchy(rec, round);
      const after = (${tree})(id);
      /* The sheets, which are what carry money, and the Main plans
         over them, which are headings. Neither may be made twice. */
      const mine = (DB.recommendations||[]).filter(x=>!x.deletedAt && x.leadId === id);
      return {before, after, sheets: allocBusinessOnly(mine).length,
              heads: mine.filter(allocIsHeading).length};
    })()`), LEAD);
    if(JSON.stringify(r.before) !== JSON.stringify(r.after))
      throw new Error('a second and third press changed the tree');
    if(r.sheets !== 4) throw new Error(r.sheets + ' Execution Plans after three presses, not 4');
    if(r.heads !== 2) throw new Error(r.heads + ' Main Execution Plans after three presses, not 2');
    return 'three presses, ' + r.after.length + ' nodes, ' + r.sheets
      + ' Execution Plans and ' + r.heads + ' Main plans over them';
  });

  await t.step('a product dropped from the plan is withdrawn, not left behind', async () => {
    const r = await t.eval(new Function('id', `return (async ()=>{
      const rec = planRecordOf(id), round = latestPlanRound(rec);
      round.allocation.lines = round.allocation.lines.filter(l=>l.product !== 'PMS');
      await save('leads');
      await planRaiseDbtHierarchy(rec, round);
      return {tree: (${tree})(id)};
    })()`), LEAD);
    const paths = r.tree.map(x=>x.path);
    if(paths.some(p=>/PMS/.test(p))) throw new Error('the PMS nodes are still there: ' + paths.join(', '));
    if(!paths.some(p=>/AIF/.test(p))) throw new Error('it withdrew the AIF too');
    const wealth = (r.tree.find(x=>x.path === 'Wealth Product')||{}).amt;
    if(wealth !== 100000) throw new Error('the Wealth main still reads ' + wealth);
    return 'PMS gone, AIF kept, and the Wealth main down to 1,00,000';
  });

  t.section('which products are mutual funds is the firm’s to set');

  await t.step('moving one in Setup moves where its business is filed', async () => {
    const r = await t.eval(async ()=>{
      const was = dbtCategoryOf('PMS');
      /* the firm decides PMS belongs with the funds */
      DB.settings = DB.settings || {};
      DB.settings['business.mfProducts'] = {value:[{label:'Mutual Fund'}, {label:'SIF'}, {label:'PMS'}]};
      const now = dbtCategoryOf('PMS');
      const path = dbtPathOf(dbtCategoryOf('PMS'), 'PMS', 'Purchase');
      delete DB.settings['business.mfProducts'];
      return {was, now, path, back: dbtCategoryOf('PMS'),
              unknown: dbtCategoryOf('Something Nobody Configured')};
    });
    if(r.was !== 'Wealth Product') throw new Error('PMS started as ' + r.was);
    if(r.now !== 'Mutual Fund') throw new Error('adding it to the list left it as ' + r.now);
    if(r.path !== 'Mutual Fund/Purchase')
      throw new Error('its business would be filed at ' + r.path);
    if(r.back !== 'Wealth Product') throw new Error('removing it again left it as ' + r.back);
    if(r.unknown !== 'Wealth Product')
      throw new Error('a product nobody has configured went to ' + r.unknown);
    return 'PMS follows the Setup list both ways, and an unknown product is a wealth product';
  });

  t.section('a heading is not a second piece of business');

  await t.step('it carries the total but is counted nowhere that sums business', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      const id = await (${SEED})(${LINES});
      const rec = planRecordOf(id), round = latestPlanRound(rec);
      await planRaiseDbtHierarchy(rec, round);
      const all = planDbtAnyFor(id, round.n);
      const biz = planDbtsFor(id, round.n);
      const sum = list => list.reduce((a,b)=>a + Number(b.amount||0), 0);
      /* every place that adds business up has to leave the headings out,
         or the same money is counted twice over */
      const book = visibleBusiness().filter(b=>b.leadId === id);
      return {all: all.length, biz: biz.length,
              allSum: sum(all), bizSum: sum(biz), bookSum: sum(book),
              headings: all.filter(dbtIsHeading).map(b=>b.dbtPath),
              bookHasHeading: book.some(dbtIsHeading)};
    })()`));
    if(r.all !== 8) throw new Error(r.all + ' records in all, expected 8');
    if(r.biz !== 4) throw new Error(r.biz + ' of them are business, expected 4');
    if(r.headings.length !== 4)
      throw new Error('the headings are ' + r.headings.join(', '));
    /* the leaves are the real money: 13,00,000 + 50,000 + 50,00,000 + 1,00,000 */
    if(r.bizSum !== 6450000) throw new Error('the business adds to ' + r.bizSum);
    if(r.allSum === r.bizSum) throw new Error('the headings carry no total at all');
    if(r.bookHasHeading) throw new Error('a heading is in the book of business');
    if(r.bookSum !== 6450000)
      throw new Error('the Daily Business Tracker adds to ' + r.bookSum
        + ' — the headings are being counted on top of their own children');
    return 'book ' + r.bookSum + ' from 4 entries; the 4 headings carry '
         + (r.allSum - r.bizSum) + ' between them and are counted nowhere';
  });

  await t.step('and says how the leaves under it stand', async () => {
    const r = await t.eval(id=>{
      const round = latestPlanRound(planRecordOf(id));
      const done = businessDoneStatus();
      const head = planDbtAnyFor(id, round.n).find(b=>b.dbtPath === 'Mutual Fund');
      const kids = planDbtsFor(id, round.n).filter(b=>/^Mutual Fund\//.test(b.dbtPath));
      const before = dbtHeadingStatus(head);
      kids.forEach(k=>{ k.status = done; });
      const after = dbtHeadingStatus(head);
      /* a leaf of another family must not move it */
      const other = planDbtAnyFor(id, round.n).find(b=>b.dbtPath === 'Wealth Product');
      return {before, after, done, kids: kids.length, other: dbtHeadingStatus(other)};
    }, LEAD);
    if(r.kids !== 2) throw new Error('the Mutual Fund heading has ' + r.kids + ' leaves');
    if(r.before === r.done) throw new Error('it read as done before its leaves were');
    if(r.after !== r.done) throw new Error('all its leaves are done and it reads ' + r.after);
    if(r.other === r.done) throw new Error('the Wealth heading moved on another family’s leaves');
    return 'Mutual Fund ' + r.before + ' → ' + r.after + ', Wealth still ' + r.other;
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
