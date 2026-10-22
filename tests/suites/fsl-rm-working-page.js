/* THE RM WORKING PAGE, IN THE ORDER THE FIRM WORKS IT.

   Four things the firm asked for on it.

   The page reads returns → Section D → the level, so the level is chosen
   off a table that is already on the screen rather than from memory.

   The Planning Return is gone. It was one box offering to override the
   rate the shortfall is planned at, and the workbook's own answer — the
   rate the horizon earns — is the one the firm plans at. A rate stored on
   a plan written before this is still honoured, so nothing already
   prepared re-prices itself.

   Conclusion is called Choose Level, and BOSS says which level is nearest
   rather than choosing it: the lowest rung the family's own assets do not
   already clear, with a button to take it. The RM still chooses.

   And the Prepare the plan card is gone — a heading, a sentence about a
   button, and the button in the bar below it. What only that card carried
   is kept. */
const {suite} = require('../lib/harness');

const SETUP = `async (tag) => {
  const l = {id: uid('LMS'), firstName:'ZZ Working', lastName: tag, mobile:'98000000' + tag,
    email:'zz.rmwork.' + tag + '@zz.in', assignedTo: currentUser, branch: DB.config.branches[0],
    createdAt:new Date().toISOString(), transformationForm:'FSL', dob:'1985-04-12',
    iseqScore: 44, iseqCategory:'Moderate'};
  initState('LMS', l); DB.leads.push(l); await save('leads');
  window._fslLeadId = l.id; window._fslStep = 'input';
  navigate('fsl');
  await new Promise(r=>setTimeout(r, 400));
  Object.assign(_fsl.s.personal, {name:'ZZ Working ' + tag, mobile:'98000000' + tag,
    email:'zz.rmwork.' + tag + '@zz.in', dob:'1985-04-12'});
  _fsl.s.years = 10;
  _fsl.s.assets[0].current = 9700000; _fsl.s.assets[0].monthly = 49500;
  _fsl.dirty = true; fslRecompute(); await fslSaveSheet();
  await fslSubmitForClient(l.id);
  await fslStepGo('plan');
  await new Promise(r=>setTimeout(r, 600));
  return l.id;
}`;

suite(async t => {
  await t.home();

  t.section('the order it reads in');

  await t.step('returns, then Section D, then the level', async () => {
    await t.eval(new Function('return (' + SETUP + ')("61")'));
    const r = await t.eval(()=>({
      cards: Array.from(document.querySelectorAll('.se-card .section-title')).map(x=>x.textContent.trim()),
      errs: document.querySelectorAll('#fslErr').length,
    }));
    const want = ['Client summary','Cashflow','Expected Return On Each Holding',
                  'Section D · Freedom Wealth Target','Choose Level'];
    if(r.cards.join(' | ') !== want.join(' | '))
      throw new Error('the page reads: ' + r.cards.join(' | '));
    if(r.errs !== 1) throw new Error(r.errs + ' error lines on the page, not one');
    return r.cards.join(' → ');
  });

  await t.step('and the two cards the firm took off it are off it', async () => {
    const r = await t.eval(()=>({
      titles: Array.from(document.querySelectorAll('.se-card .section-title')).map(x=>x.textContent.trim()),
      roi: !!FSL_FORM.find(s=>s.key === 'roi'),
      roiBox: !!document.querySelector('[data-fslp="roiPct"]'),
      rm: FSL_RM_SECTIONS.slice(),
    }));
    if(r.titles.some(x=>/planning return/i.test(x))) throw new Error('The Planning Return is still a card');
    if(r.roi) throw new Error('the roi section is still on the form');
    if(r.roiBox) throw new Error('the Annual ROI box is still drawn somewhere');
    if(r.titles.some(x=>/prepare the plan|the plan is prepared/i.test(x)))
      throw new Error('the Prepare the plan card is still there');
    if(r.rm.join(',') !== 'returns,conclusion') throw new Error('the RM sections are ' + r.rm.join(', '));
    return 'no Planning Return, no Prepare the plan card, and the RM’s sections are returns and the level';
  });

  await t.step('a rate stored on an older plan is still the rate it is priced at', async () => {
    const r = await t.eval(()=>{
      const s = fslBlank();
      s.years = 10; s.assets[0].current = 1000000; s.assets[0].monthly = 10000;
      const byHorizon = fslComputeFrom(s);
      const s2 = JSON.parse(JSON.stringify(s));
      s2.roiPct = 8;                       // what an older form holds
      const stored = fslComputeFrom(s2);
      return {horizon: byHorizon.annROI, stored: stored.annROI,
              override: fslRoiOverride(s2), blank: fslRoiOverride(s)};
    });
    if(r.blank !== null) throw new Error('a form with no rate on it invented one: ' + r.blank);
    if(Math.abs(r.override - 0.08) > 1e-9) throw new Error('a stored 8 read back as ' + r.override);
    if(Math.abs(r.stored - 0.08) > 1e-9)
      throw new Error('the plan was priced at ' + r.stored + ', not at the 8% the form holds');
    if(Math.abs(r.horizon - r.stored) < 1e-9)
      throw new Error('the stored rate made no difference, so this proves nothing');
    return 'a blank form follows the horizon (' + Math.round(r.horizon*100) + '%), a stored 8 still prices at 8%';
  });

  t.section('Choose Level, and what BOSS says about it');

  await t.step('it is headed Choose Level and names the nearest rung still to reach', async () => {
    const r = await t.eval(()=>{
      const sec = FSL_FORM.find(x=>x.key === 'conclusion');
      const box = document.querySelector('[data-fslsuggest]');
      const near = fslNearestLevel(_fsl.C);
      const cleared = ((_fsl.C||{}).levels||[]).filter(l=>l.achieved).map(l=>l.lvl);
      return {card: sec.card, label: sec.label, hint: sec.hint,
              text: box ? box.textContent.trim() : '(no suggestion on the page)',
              near: near ? near.lvl : null, cleared};
    });
    if(r.card !== 'Choose Level') throw new Error('the card is headed "' + r.card + '"');
    if(r.label !== 'Choose Level') throw new Error('it is listed elsewhere as "' + r.label + '"');
    if(!/RM chooses/i.test(r.hint)) throw new Error('the hint does not say who chooses: ' + r.hint);
    if(!r.near) throw new Error('nothing was worked out as nearest');
    if(r.cleared.indexOf(r.near) >= 0) throw new Error('it suggested a rung already cleared');
    if(r.near !== Math.max.apply(null, r.cleared.concat([0])) + 1)
      throw new Error('level ' + r.near + ' is not the one above the highest cleared (' + r.cleared.join(', ') + ')');
    if(r.text.indexOf('Level ' + r.near) < 0)
      throw new Error('the page does not name it: ' + r.text);
    return 'cleared ' + (r.cleared.join(', ')||'none') + ' — "' + r.text.slice(0, 90) + '…"';
  });

  await t.step('the button takes the suggestion, and BOSS never takes it by itself', async () => {
    const before = await t.eval(()=>String((_fsl.s||{}).chosenLevel || ''));
    if(before) throw new Error('a level was chosen without anybody choosing it: ' + before);
    const r = await t.eval(async ()=>{
      const near = fslNearestLevel(_fsl.C).lvl;
      fslTakeSuggestedLevel();
      await new Promise(r=>setTimeout(r, 400));
      const box = document.querySelector('[data-fslsuggest]');
      return {near, chosen: String(_fsl.s.chosenLevel||''),
              says: box ? box.textContent.trim() : ''};
    });
    if(r.chosen !== String(r.near)) throw new Error('it set level ' + r.chosen + ', not ' + r.near);
    if(!/this is the one chosen/i.test(r.says))
      throw new Error('it still offers a level that is already chosen: ' + r.says);
    return 'blank until pressed, then Level ' + r.chosen + ' — and the line says so instead of offering again';
  });

  await t.step('a family past the top of the ladder is told so', async () => {
    const r = await t.eval(()=>{
      const was = _fsl.C;
      _fsl.C = {levels: (was.levels||[]).map(l=>Object.assign({}, l, {achieved:true}))};
      const html = fslSuggestHtml();
      _fsl.C = was;
      return html;
    });
    if(!/every rung is already cleared/i.test(r)) throw new Error('it says: ' + r);
    if(/<button/.test(r)) throw new Error('it still offers a level to take');
    return 'no rung left, no button, and it says why';
  });

  t.section('what the Prepare card alone used to carry');

  await t.step('what is still unsettled is still said on the page', async () => {
    const r = await t.eval(async ()=>{
      _fsl.s.chosenLevel = '';            // the one thing this page can leave open
      _fsl.dirty = true; fslRecompute(); fslRedraw();
      await new Promise(r=>setTimeout(r, 400));
      const text = (document.getElementById('root')||{}).textContent || '';
      return {text, missing: fslMissing('any').map(m=>m.label)};
    });
    if(!r.missing.length) throw new Error('nothing reads as outstanding, so this proves nothing');
    if(r.text.indexOf('Still to settle before the plan can be prepared') < 0)
      throw new Error('the page no longer says what is outstanding');
    if(r.text.indexOf(r.missing[0]) < 0)
      throw new Error('it does not name "' + r.missing[0] + '"');
    return 'it names what is left: ' + r.missing.join(', ');
  });

  await t.step('and the four-up progress strip is off the page', async () => {
    const r = await t.eval(()=>({
      fn: typeof window.fslProgressHtml,
      strip: /Level played for/.test((document.getElementById('root')||{}).textContent || ''),
      /* Every line it carried is still readable, each where it is decided. */
      header: /Round \d/.test((document.getElementById('root')||{}).textContent || ''),
      level: Array.from(document.querySelectorAll('.se-card .section-title'))
               .some(x=>x.textContent.trim() === 'Choose Level'),
    }));
    if(r.fn !== 'undefined') throw new Error('the strip is still built somewhere');
    if(r.strip) throw new Error('"Level played for" is still on the page');
    if(!r.level) throw new Error('the level is no longer asked anywhere either, which is not the ask');
    return 'the band of four is gone, and the level is still chosen where it is decided';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
