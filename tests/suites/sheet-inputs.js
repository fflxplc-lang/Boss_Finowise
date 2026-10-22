/* A DATE OF BIRTH TYPED A DIGIT AT A TIME, ON A SHEET THAT SAVES AS YOU TYPE.

   The 7 Events sheet asks for a date of birth on its first screen, and
   so does FSL. A native date box reports a year the moment its FIRST
   digit is in, so on the way to 2002 the box passes through the year 2
   — and two separate things went wrong with that.

   The box: the year-range rule fired on 'change', cleared the whole
   date and printed a red line about four digits, out from under the
   caret, after one keystroke. The firm sent a screenshot of it from
   7 Events and then the same one from FSL.

   The sheet: these boxes write into the model on every keystroke,
   which is what makes the figures move as somebody types. So the plan
   was recomputed and saved against the years 2, 20 and 200 — and when
   the box was cleared, the model kept the nonsense. An empty Date of
   Birth on screen with 0002-12-05 underneath it.

   Both are fixed in one place each: a box is judged only once the
   caret has left it, and a date outside the range is never written to
   a sheet model. The same two lines cover 7 Events, FSL and GAB,
   because all three go through one guard and one parser apiece.

   Asked for in the same breath, on FSL's Section A: Occupation should
   be the firm's own list rather than a free-text box, and RM name
   should not be asked at all on a sheet opened from inside the record
   the RM already owns. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();
  let leadId = null;

  await t.step('an FSL sheet, open on a lead', async () => {
    leadId = await t.eval(async ()=>{
      const now = new Date().toISOString();
      const l = {id: uid('LMS'), firstName:'ZZ Sheet', lastName:'Dates', mobile:'9800000098',
        email:'zz.sheet@zz.in', assignedTo: currentUser, branch: DB.config.branches[0], createdAt: now};
      initState('LMS', l); DB.leads.push(l); await save('leads');
      window._fslLeadId = l.id; window._fslStep = 'input';
      navigate('fsl');
      return l.id;
    });
    await t.wait(800);
    const ok = await t.eval(()=>!!document.querySelector('input[data-fslp="personal.dob"]'));
    if(!ok) throw new Error('the FSL input sheet did not draw its date of birth');
    return 'FSL input sheet on ' + leadId;
  });

  await t.step('the box keeps what is typed, and the sheet holds nothing until it is a year', async () => {
    const el = await t.page.$('input[data-fslp="personal.dob"]');
    await el.click();
    await t.page.keyboard.type('1205');
    const seen = [];
    for(const d of ['2','0','0','2']){
      await t.page.keyboard.type(d);
      seen.push(await t.eval(()=>({
        box: (document.querySelector('input[data-fslp="personal.dob"]') || {}).value,
        model: ((((_fsl || {}).s) || {}).personal || {}).dob,
        err: (() => { const f = document.querySelector('input[data-fslp="personal.dob"]').closest('.field');
          return (f && f.querySelector('.field-error') || {}).textContent || ''; })(),
      })));
    }
    await t.page.keyboard.press('Tab');
    await t.wait(400);
    const after = await t.eval(()=>({
      box: (document.querySelector('input[data-fslp="personal.dob"]') || {}).value,
      model: ((((_fsl || {}).s) || {}).personal || {}).dob,
    }));
    const wiped = seen.findIndex(x=>!x.box);
    if(wiped >= 0) throw new Error('the box was cleared after digit ' + (wiped + 1) + ' of the year');
    const shouted = seen.find(x=>x.err);
    if(shouted) throw new Error('it complained mid-typing: ' + shouted.err);
    const polluted = seen.slice(0, 3).find(x=>x.model);
    if(polluted) throw new Error('a half-typed year reached the sheet: ' + polluted.model);
    if(seen[3].model !== '2002-12-05') throw new Error('the finished year did not reach the sheet: ' + seen[3].model);
    if(after.box !== '2002-12-05' || after.model !== '2002-12-05')
      throw new Error('box "' + after.box + '" and sheet "' + after.model + '" disagree after leaving');
    return 'through the years 2, 20 and 200 with an empty sheet and an untouched box, then 2002-12-05 in both';
  });

  await t.step('and a year the rule refuses never reaches the model, on any of the three sheets', async () => {
    const r = await t.eval(()=>({
      fsl: [fslParse('0002-12-05','date'), fslParse('1975-06-01','date'), fslParse('','date'), fslParse('3500-01-01','date')],
      se:  [seParse('0002-12-05','date'),  seParse('1975-06-01','date'),  seParse('','date'),  seParse('1800-01-01','date')],
      gab: [gabParse('0002-12-05','date'), gabParse('1975-06-01','date'), gabParse('','date'), gabParse('0026-05-12','date')],
      /* and nothing else changed shape */
      text: [fslParse('Salaried','text'), seParse('Salaried','text'), gabParse('Salaried','text')],
      num:  [fslParse('1,00,000','num'),  seParse('1,00,000','num'),  gabParse('1,00,000','num')],
    }));
    ['fsl','se','gab'].forEach(k=>{
      const v = r[k];
      if(v[0] !== '') throw new Error(k + ' stored a half-typed year as "' + v[0] + '"');
      if(v[1] !== '1975-06-01') throw new Error(k + ' refused a good date: "' + v[1] + '"');
      if(v[2] !== '') throw new Error(k + ' turned an empty date into "' + v[2] + '"');
      if(v[3] !== '') throw new Error(k + ' stored an out-of-range year as "' + v[3] + '"');
    });
    if(r.text.some(x=>x !== 'Salaried')) throw new Error('a text field changed: ' + JSON.stringify(r.text));
    if(r.num.some(x=>x !== 100000)) throw new Error('a number field changed: ' + JSON.stringify(r.num));
    return '7 Events, FSL and GAB each refuse a half-typed and an out-of-range year, keep a good one, '
      + 'and leave text and numbers exactly as they were';
  });

  await t.step('Occupation is the firm’s own list, and RM name is not asked', async () => {
    const r = await t.eval(()=>{
      const c = document.getElementById('content');
      const sel = c.querySelector('select[data-fslp="personal.occupation"]');
      return {hasSelect: !!sel,
        opts: sel ? Array.from(sel.options).map(o=>o.textContent.trim()) : [],
        master: seCodeOpts('OCC').map(o=>o[1]),
        rmAsked: !!c.querySelector('[data-fslp="personal.rm"]'),
        rmWord: /RM name/.test(c.textContent)};
    });
    if(!r.hasSelect) throw new Error('Occupation is still a free-text box');
    if(r.rmAsked || r.rmWord) throw new Error('RM name is still on the input sheet');
    r.master.forEach(m=>{ if(r.opts.indexOf(m) < 0) throw new Error('"' + m + '" is in the firm’s list and not in the dropdown'); });
    if(r.opts.length !== r.master.length + 1)
      throw new Error('the dropdown offers ' + r.opts.length + ' against ' + r.master.length + ' configured');
    return r.master.length + ' occupations from Setup (' + r.master.slice(0, 3).join(', ')
      + '…), and no RM name box';
  });

  await t.step('an occupation the list has since dropped is still shown, not blanked', async () => {
    const r = await t.eval(()=>{
      _fsl.s.personal = _fsl.s.personal || {};
      _fsl.s.personal.occupation = 'ZZ Retired Circus Performer';
      fslRedraw();
      const sel = document.querySelector('select[data-fslp="personal.occupation"]');
      const out = {value: sel.value,
        text: (sel.options[sel.selectedIndex] || {}).textContent || ''};
      _fsl.s.personal.occupation = '';
      fslRedraw();
      return out;
    });
    if(r.value !== 'ZZ Retired Circus Performer')
      throw new Error('an answer the list no longer carries was blanked: "' + r.value + '"');
    if(!/no longer on the list/.test(r.text)) throw new Error('it does not say why it is odd: ' + r.text);
    return 'kept, selected, and marked "no longer on the list" rather than silently lost';
  });
});
