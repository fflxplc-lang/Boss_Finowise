/* THE FIRM CALLS IT A FORM, SO BOSS DOES.

   "Sheet" carried three different meanings here, and only one of them
   is the firm's:

     a BOSS sheet   — the allocation sheet, the blueprint input sheet,
                      the review sheet, HR's monthly incentive sheet.
                      These are forms, and the firm asked for the word.
     a spreadsheet  — the .xlsx somebody uploads to Bulk Import, and
                      the worksheet inside it. "Column in your form"
                      and "Download the sample form" for an .xlsx are
                      wrong, so those keep the word.
     an identifier  — sheetId, <sheet name=…>, isSheetForm(), the
                      reviewSheet stage id, which is stored on records.

   So this suite does two jobs: checks the word is gone from the first
   kind, and checks it is still there in the second. A later sweep
   that renames "Column in your sheet" fails here, which is the point. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();

  const src = async () => await t.eval(()=>
    Array.from(document.querySelectorAll('script')).map(x=>x.textContent).join('\n'));

  t.section('what BOSS calls its own');

  await t.step('the allocation form, the input form and the rest say form', async () => {
    const s = await src();
    const gone = [
      'Allocation sheets prepared for a client',
      'The allocation sheet as the client receives it',
      'Every blueprint input sheet',
      'Data gathering sheet — Financial Success Ladder',
      'Open the FSL sheet', 'Open the GAB sheet',
      'The sheet is saved.', 'The sheet is with the client',
      'The sheet has to come back first',
      'This sheet has already been submitted',
      'Only HR may change an incentive sheet',
      'Input sheet not back yet',
      'shown on the allocation sheet',
    ].filter(x=>s.indexOf(x) >= 0);
    if (gone.length) throw new Error('still says sheet: ' + gone.join(' | '));
    const want = [
      'Allocation forms prepared for a client',
      'The allocation form as the client receives it',
      'Every blueprint input form',
      'Open the FSL form',
      'The form is saved.',
      'Only HR may change an incentive form',
      'Input form not back yet',
    ].filter(x=>s.indexOf(x) < 0);
    if (want.length) throw new Error('these did not come through as form: ' + want.join(' | '));
    return 'the allocation form, the blueprint input form, the FSL and GAB forms, the incentive form';
  });

  await t.step('and the pages that name them read form on screen', async () => {
    const seen = {};
    for(const v of ['recommendations','planforms']){
      await t.eval(x => { try { navigate(x); } catch(e){} }, v);
      await t.wait(200);
      seen[v] = await t.eval(()=>document.getElementById('content').textContent
        + ' ' + (document.getElementById('pageSub') || {}).textContent);
    }
    const bad = Object.entries(seen).filter(([, txt])=>/\bsheets?\b/i.test(txt));
    if(bad.length) throw new Error(bad.map(([v])=>v).join(', ') + ' still say sheet on screen');
    return 'Execution Tracker and Plan Input Forms both read form';
  });

  t.section('and what is not ours keeps its own word');

  await t.step('a spreadsheet is still a spreadsheet', async () => {
    const s = await src();
    const kept = [
      'Column in your sheet',
      'Download the sample sheet',
      'Upload a filled-in sheet',
      'There is a sheet in that file but no rows under its headings.',
      'BOSS could not find a sheet inside that .xls.',
      'Which sheet of the workbook',
      'Upload a spreadsheet and map columns to CRM fields',
    ].filter(x=>s.indexOf(x) < 0);
    if(kept.length)
      throw new Error('a spreadsheet was renamed to a form: ' + kept.join(' | '));
    return 'the import screens still talk about the sheet somebody uploaded, because that is what it is';
  });

  await t.step('and Balance Sheet is still Balance Sheet', async () => {
    const s = await src();
    if(s.indexOf('Personal Balance Sheet') < 0)
      throw new Error('the Personal Balance Sheet was renamed');
    return 'untouched — it is an accounting term, not one of ours';
  });

  await t.step('the identifiers are untouched, so nothing stored broke', async () => {
    const r = await t.eval(()=>({
      stage: typeof isSheetForm === 'function' && isSheetForm('FSL'),
      reviewStage: /id:'reviewSheet'/.test(Array.from(document.querySelectorAll('script'))
        .map(x=>x.textContent).join('\n')),
      savers: ['seSaveSheet','fslSaveSheet','gabSaveSheet','sheetOpenFrom']
        .filter(f=>typeof window[f] === 'function').length}));
    if(!r.stage) throw new Error('isSheetForm no longer recognises a sheet form');
    if(!r.reviewStage) throw new Error('the reviewSheet stage id was renamed — every RMS record on it breaks');
    if(r.savers !== 4) throw new Error('only ' + r.savers + ' of the four sheet functions are still there');
    return 'isSheetForm, the reviewSheet stage and the four savers all still named as the records expect';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
