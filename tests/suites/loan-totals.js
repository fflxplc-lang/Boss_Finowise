/* "TOTAL OUTSTANDING ₹0" BESIDE A LOAN OF ₹90,000.

   Not a bug, and that was the problem. The workbook's loan and EMI
   totals deliberately leave out whichever loan type Setup tags —
   "Any Other Loan" by default — and still count it in full in the
   cash-flow and net-worth statements. A sheet whose only loan is that
   type therefore shows a total of zero, correctly, and reads as
   broken.

   The rule is untouched. What is new is that the sheet says what it
   left out, on its own line under the totals, and only when there is
   something to say. */
const {suite} = require('../lib/harness');

const SHEET = `async (rows) => {
  const l = {id:uid('LEAD'), leadName:'ZZ Loan Lead', mobile:'9800011111', email:'a@zz.in',
    rmName:currentUser, assignedTo:currentUser, dob:'1988-01-01', transformationForm:'SEVENEVENTS',
    createdAt:new Date().toISOString(), createdBy:currentUser};
  initState('LMS', l); DB.leads.push(l);
  const st = seStateOf(l); st.loans = rows; seWriteState(l, st);
  await save('leads');
  return l;
}`;

suite(async t => {
  await t.home();

  await t.step('the excluded type is still excluded — the rule has not moved', async () => {
    const r = await t.eval(async (a)=>{
      const l = await eval('(' + a.SHEET + ')')([
        {type:'Any Other Loan', out:90000, emi:3700, months:24},
        {type:'Home Loan', out:1500000, emi:12500, months:180}]);
      sheetAdapter('SEVENEVENTS').open(l.id, 'input');
      await new Promise(res=>setTimeout(res, 600));
      const c = (_se && _se.C) || {};
      return {loanOut: c.loanOut, emiTotal: c.emiTotal, all: c.loanOutAll,
        excl: c.loanOutExcl, emiExcl: c.emiExcl,
        tagged: typeof seGlobals === 'function' ? seGlobals().excludeEmi : null};
    }, {SHEET});
    if(r.loanOut !== 1500000) throw new Error('the total counted the excluded row: ' + r.loanOut);
    if(r.emiTotal !== 12500) throw new Error('the EMI total counted it too: ' + r.emiTotal);
    if(r.all !== 1590000) throw new Error('the net-worth figure dropped it: ' + r.all);
    if(r.excl !== 90000 || r.emiExcl !== 3700)
      throw new Error('what was left out is not reported: ' + r.excl + ' / ' + r.emiExcl);
    return 'totals ' + r.loanOut + ' / ' + r.emiTotal + ' exclude the tagged type, the net-worth figure '
      + 'still counts all ' + r.all + ', and the sheet knows 90000 / 3700 were left out';
  });

  await t.step('and the sheet says so, under the totals', async () => {
    const r = await t.eval(async (a)=>{
      /* the firm's own case: the only loan is the excluded type */
      const l = await eval('(' + a.SHEET + ')')([{type:'Any Other Loan', out:90000, emi:3700, months:24}]);
      sheetAdapter('SEVENEVENTS').open(l.id, 'input');
      await new Promise(res=>setTimeout(res, 600));
      const only = Array.from(document.querySelectorAll('.se-t'))
        .find(x=>/Type of loan/i.test(x.textContent));
      const onlyText = only ? only.textContent.replace(/\s+/g, ' ') : '';
      /* and a sheet with nothing excluded does not carry the line */
      const l2 = await eval('(' + a.SHEET + ')')([{type:'Home Loan', out:1500000, emi:12500, months:180}]);
      sheetAdapter('SEVENEVENTS').open(l2.id, 'input');
      await new Promise(res=>setTimeout(res, 600));
      const clean = Array.from(document.querySelectorAll('.se-t'))
        .find(x=>/Type of loan/i.test(x.textContent));
      return {onlyText, cleanText: clean ? clean.textContent.replace(/\s+/g, ' ') : ''};
    }, {SHEET});
    if(!/Total outstanding ₹0/.test(r.onlyText))
      throw new Error('the total is no longer zero for the excluded-only case: ' + r.onlyText.slice(-160));
    if(!/Left out of the total above/.test(r.onlyText))
      throw new Error('nothing explains the zero: ' + r.onlyText.slice(-200));
    if(!/90,000/.test(r.onlyText)) throw new Error('the excluded amount is not named');
    if(/Left out of the total above/.test(r.cleanText))
      throw new Error('the line is drawn when nothing is excluded: ' + r.cleanText.slice(-160));
    return 'with only the excluded type the totals read ₹0 and the line beneath names the ₹90,000 left out; '
      + 'with nothing excluded the line is not drawn at all';
  });
});
