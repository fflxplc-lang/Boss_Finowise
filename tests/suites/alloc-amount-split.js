/* THE AGREED AMOUNT IS A BUDGET, AND THE LINES SPEND IT.

   A sheet opened from the Daily Business Tracker carries the figure
   the client already agreed to. Splitting it across schemes was
   arithmetic the adviser did in their head and typed in, which is how
   a sheet of four lines comes to add up to more than was agreed and
   nobody notices until the money is being placed.

   So the lines share the budget: a line nobody has typed into takes
   an equal share of what is left, a line that was typed into keeps
   exactly what was typed and is paid first, and nothing the adviser
   does can push the total past what the client agreed to.

   Lumpsum and SIP are two budgets. A monthly figure and a one-off
   cannot be added together, so each kind is spread against its own.

   A sheet with no DBT behind it has no budget, and none of this
   applies — the adviser types what they type, as before. */
const {suite} = require('../lib/harness');

const SEED_SRC = async (amount)=>{
  const c = DB.clients.find(x=>!x.deletedAt) || DB.clients[0];
  const entry = {id: uid('DBT'), clientId: c.id, dbtType:'Investment', amount: String(amount),
    transactionType:'Purchase', productCategory:'Mutual Fund', platform:'Finowise',
    status:'Pending from Client Consent', createdAt:new Date().toISOString()};
  DB.businessEntries.push(entry);
  await save('businessEntries');
  const rec = {id: uid('REC'), clientId: c.id, status:'Draft', sourceModule:'DBT',
    dbtEntryId: entry.id, productCategory:'Mutual Fund', investmentMode:'Lumpsum',
    schemes:[], attachments:[], createdAt:new Date().toISOString()};
  DB.recommendations.push(rec);
  await save('recommendations');
  window._allocDraft = JSON.parse(JSON.stringify(rec));
  window._allocDraft.schemes = [allocNewLineFor(window._allocDraft)];
  window._allocDraft.schemes[0].productCategory = 'Mutual Fund';
  window._allocDraft.schemes[0].platform = 'Finowise';
  allocSpreadAmounts(window._allocDraft);
  return {rec: rec.id, entry: entry.id};
};

suite(async t => {
  await t.home();
  await t.eval(src => { window.SEED_FN = eval('(' + src + ')'); }, String(SEED_SRC));

  t.section('a new scheme opens on what Scheme 1 says');

  await t.step('category and platform come from the first line', async () => {
    const r = await t.eval(async ()=>{
      await SEED_FN(1000000);
      const d = window._allocDraft;
      d.schemes.push(allocNewLineFor(d));
      const two = d.schemes[1];
      return {cat: two.productCategory, plat: two.platform,
              firstCat: d.schemes[0].productCategory, firstPlat: d.schemes[0].platform};
    });
    if(r.cat !== r.firstCat)
      throw new Error('the new line opened on category "' + r.cat + '", not "' + r.firstCat + '"');
    if(r.plat !== r.firstPlat)
      throw new Error('the new line opened on platform "' + r.plat + '", not "' + r.firstPlat + '"');
    return 'Scheme 2 opens on ' + r.cat + ' / ' + r.plat + ', the same as Scheme 1';
  });

  t.section('the agreed amount is shared out');

  await t.step('one line holds it all; a second splits it in two', async () => {
    const r = await t.eval(async ()=>{
      await SEED_FN(1000000);
      const d = window._allocDraft;
      const one = numVal(d.schemes[0].amount);
      allocAddScheme();
      const two = d.schemes.map(l=>numVal(l.amount));
      allocAddScheme();
      const three = d.schemes.map(l=>numVal(l.amount));
      return {one, two, three, sum3: three.reduce((a,b)=>a+b, 0)};
    });
    if(r.one !== 1000000) throw new Error('one line held ' + r.one);
    if(r.two.join(',') !== '500000,500000') throw new Error('two lines read ' + r.two.join(', '));
    if(r.sum3 !== 1000000) throw new Error('three lines add to ' + r.sum3);
    /* A third of ten lakh does not divide, so the odd rupee lands on
       the first line rather than being lost. */
    if(Math.max.apply(null, r.three) - Math.min.apply(null, r.three) > 1)
      throw new Error('the three-way split is lopsided: ' + r.three.join(', '));
    return '1 line ' + r.one + '; 2 lines ' + r.two.join('/') + '; 3 lines '
      + r.three.join('/') + ' — adding to the agreed amount exactly';
  });

  await t.step('a typed amount is kept, and the rest is shared around it', async () => {
    const r = await t.eval(async ()=>{
      await SEED_FN(1000000);
      const d = window._allocDraft;
      allocAddScheme(); allocAddScheme();
      allocAmountChanged(0, '700000');
      const after = d.schemes.map(l=>numVal(l.amount));
      return {after, sum: after.reduce((a,b)=>a+b, 0), manual: !!d.schemes[0].amountManual};
    });
    if(!r.manual) throw new Error('the typed line was not marked as typed');
    if(r.after[0] !== 700000) throw new Error('the typed amount was moved to ' + r.after[0]);
    if(r.after[1] !== 150000 || r.after[2] !== 150000)
      throw new Error('the rest was not shared evenly: ' + r.after.join(', '));
    if(r.sum !== 1000000) throw new Error('the sheet adds to ' + r.sum);
    return '7,00,000 typed and kept; the remaining 3,00,000 split evenly across the other two';
  });

  t.section('nothing may exceed what the client agreed to');

  await t.step('an amount over the balance is held to it, and says why in a pop-up', async () => {
    const before = t.dialogs.length;
    const r = await t.eval(async ()=>{
      await SEED_FN(1000000);
      const d = window._allocDraft;
      allocAddScheme();
      allocAmountChanged(0, '400000');
      /* 6,00,000 is left; asking for 9,00,000 must not take it. */
      allocAmountChanged(1, '900000');
      const after = d.schemes.map(l=>numVal(l.amount));
      return {after, sum: after.reduce((a,b)=>a+b, 0),
              body: (document.querySelector('.modal-body') || {}).textContent || ''};
    });
    /* The cap interrupts on a timer, after the redraw it explains. */
    await t.wait(150);
    const said = t.dialogs.slice(before).join(' | ');
    if(r.after[1] !== 600000)
      throw new Error('the over-ask took ' + r.after[1] + ', not the 600000 that was left');
    if(r.sum > 1000000) throw new Error('the sheet adds to ' + r.sum + ', over the agreed amount');
    if(!said) throw new Error('the cap bit without a word: no pop-up');
    if(!/600/.test(said.replace(/[^0-9]/g, '')) || !/Scheme 2/.test(said))
      throw new Error('the pop-up said nothing useful: "' + said + '"');
    /* The firm asked for a pop-up rather than a band inside the sheet. */
    if(/was set to/.test(r.body))
      throw new Error('the message is printed inside the sheet as well');
    return 'held to the 6,00,000 that was left, and said so in a pop-up rather than in the sheet';
  });

  await t.step('no line carries a running headroom note', async () => {
    const body = await t.eval(async ()=>{
      await SEED_FN(1000000);
      allocAddScheme();
      renderAllocationForm(false);
      return (document.querySelector('.modal-body') || {}).textContent || '';
    });
    if(/up to [^.]*here/.test(body))
      throw new Error('a line still prints what it may be raised to');
    return 'the Amount boxes stand on their own — what is left is said once, in the head';
  });

  await t.step('removing a line gives its money back to the others', async () => {
    const r = await t.eval(async ()=>{
      await SEED_FN(900000);
      const d = window._allocDraft;
      allocAddScheme(); allocAddScheme();
      const three = d.schemes.map(l=>numVal(l.amount));
      allocRemoveScheme(2);
      const two = d.schemes.map(l=>numVal(l.amount));
      return {three, two, sum: two.reduce((a,b)=>a+b, 0)};
    });
    if(r.three.join(',') !== '300000,300000,300000')
      throw new Error('three lines read ' + r.three.join(', '));
    if(r.two.join(',') !== '450000,450000')
      throw new Error('after removing one, two lines read ' + r.two.join(', '));
    if(r.sum !== 900000) throw new Error('the sheet adds to ' + r.sum);
    return '3 × 3,00,000 became 2 × 4,50,000 — the money came back rather than vanishing';
  });

  t.section('a sheet with no DBT behind it is left alone');

  await t.step('no budget, no split, no cap', async () => {
    const r = await t.eval(()=>{
      window._allocDraft = {id:'', clientId:'', schemes:[allocNewLineFor({})], attachments:[],
        productCategory:'Mutual Fund', investmentMode:'Lumpsum'};
      const d = window._allocDraft;
      const budget = allocBudgetOf(d);
      const spread = allocSpreadAmounts(d);
      allocAddScheme();
      allocAmountChanged(0, '12345678');
      return {budget: !!budget, spread, typed: numVal(d.schemes[0].amount),
              note: d.__amountNote || '', noteHtml: allocBudgetNoteHtml(d)};
    });
    if(r.budget) throw new Error('a sheet with no DBT behind it was given a budget');
    if(r.spread) throw new Error('it shared out money it does not have');
    if(r.typed !== 12345678) throw new Error('a figure was capped against no budget: ' + r.typed);
    if(r.note) throw new Error('it warned about a limit that does not exist: ' + r.note);
    if(r.noteHtml) throw new Error('it drew a budget line for a sheet with no budget');
    return 'nothing imposed on a sheet the tracker never agreed an amount for';
  });

  t.section('what is still unallocated, in the head of the sheet');

  await t.step('it counts down as the money is placed, and reaches zero', async () => {
    const r = await t.eval(async ()=>{
      await SEED_FN(1000000);
      const d = window._allocDraft;
      d.schemes[0].amount = '0';
      d.schemes[0].amountManual = true;
      const atNone = allocUnallocated(d, 'lump');
      const chipNone = allocHeadChipHtml(d);
      d.schemes[0].amount = '400000';
      const atPart = allocUnallocated(d, 'lump');
      const chipPart = allocHeadChipHtml(d);
      d.schemes[0].amount = '1000000';
      const atAll = allocUnallocated(d, 'lump');
      const chipAll = allocHeadChipHtml(d);
      return {atNone, atPart, atAll,
              saysNone: /Unallocated/.test(chipNone) && chipNone.indexOf(money(1000000)) >= 0,
              saysPart: chipPart.indexOf(money(600000)) >= 0,
              partIsSurplus: /alloc-chip left/.test(chipPart),
              allIsDone: /alloc-chip done/.test(chipAll),
              overAnywhere: /alloc-chip over/.test(chipNone + chipPart + chipAll)};
    });
    if(r.atNone !== 1000000) throw new Error('with nothing placed it reads ' + r.atNone);
    if(r.atPart !== 600000) throw new Error('with 4,00,000 placed it reads ' + r.atPart);
    if(r.atAll !== 0) throw new Error('with it all placed it reads ' + r.atAll);
    if(!r.saysNone) throw new Error('the head does not show the whole amount as unallocated');
    if(!r.saysPart) throw new Error('the head does not show the 6,00,000 still to place');
    /* Green: money still to place is surplus to put to work, not a
       fault. Red is kept for the one state that is a fault. */
    if(!r.partIsSurplus) throw new Error('money still to place is not marked as surplus');
    if(!r.allIsDone) throw new Error('a fully allocated sheet does not say so');
    if(r.overAnywhere) throw new Error('it cried over-allocation when nothing was over');
    return '10,00,000 \u2192 6,00,000 \u2192 0 as the money is placed, and nought shown as settled';
  });

  await t.step('over-allocation is shown, in bold red, by how much', async () => {
    const r = await t.eval(async ()=>{
      await SEED_FN(1000000);
      const d = window._allocDraft;
      /* A sheet written before the cap existed, or one whose DBT
         amount was cut afterwards: the lines hold more than was
         agreed and the cap never saw it happen. */
      d.schemes[0].amount = '1500000';
      d.schemes[0].amountManual = true;
      const left = allocUnallocated(d, 'lump');
      const chip = allocHeadChipHtml(d);
      return {left, chip,
              over: /alloc-chip over/.test(chip),
              says: chip.indexOf(money(500000)) >= 0,
              worded: /Over by/.test(chip)};
    });
    if(r.left !== -500000) throw new Error('the overage reads ' + r.left);
    if(!r.over) throw new Error('an over-allocated sheet is not marked as over');
    if(!r.says) throw new Error('it does not say by how much: ' + r.chip.slice(0, 120));
    if(!r.worded) throw new Error('it does not say "Over by"');
    return 'over by 5,00,000, marked over and named';
  });

  await t.step('it follows every change, and never disagrees with the lines', async () => {
    const r = await t.eval(async ()=>{
      await SEED_FN(900000);
      const d = window._allocDraft;
      const read = () => {
        const shown = allocUnallocated(d, 'lump');
        const actual = numVal(allocBudgetOf(d).lump)
          - d.schemes.reduce((s, l)=>s + numVal(l.amount), 0);
        return {shown, actual};
      };
      const out = [];
      out.push(read());
      allocAddScheme();            out.push(read());
      allocAddScheme();            out.push(read());
      allocAmountChanged(0, '500000'); out.push(read());
      allocRemoveScheme(2);        out.push(read());
      /* A sheet with no DBT has nothing to be unallocated against. */
      window._allocDraft = {id:'', clientId:'', schemes:[allocNewLineFor({})], attachments:[],
        productCategory:'Mutual Fund', investmentMode:'Lumpsum'};
      const none = {n: allocUnallocated(window._allocDraft, 'lump'),
                    chip: allocHeadChipHtml(window._allocDraft)};
      return {out, none};
    });
    r.out.forEach((x, i)=>{
      if(x.shown !== x.actual)
        throw new Error('at step ' + i + ' the head said ' + x.shown
          + ' while the lines added to a balance of ' + x.actual);
    });
    if(r.none.n !== null) throw new Error('a sheet with no DBT reported a balance');
    if(r.none.chip) throw new Error('a sheet with no DBT drew the figure anyway');
    return 'agreed with the lines at every one of ' + r.out.length
      + ' steps \u2014 add, add, retype, remove \u2014 and stays away where there is no DBT';
  });

  await t.step('nothing was alerted but the cap itself', async () => {
    const odd = t.dialogs.filter(d=>!/was set to/.test(String(d)));
    if(odd.length) throw new Error('alerts: ' + odd.join(' | ').slice(0, 220));
    return t.dialogs.length + ' pop-up(s), every one of them the cap explaining itself';
  });
});
