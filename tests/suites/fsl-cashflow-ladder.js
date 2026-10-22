/* THE FSL FORM: A CASHFLOW SECTION, AND A LADDER THAT IS READ.

   Two things the firm asked for on the Financial Success Ladder's own
   input form.

   A Cashflow section — what the household earns, spends and owes. Income
   and expense are asked by the month, because that is how a family knows
   them, and the planning page shows each both ways with the surplus
   between them. What is already invested is NOT asked here: Section C
   asks for every holding line by line, and the same question in two
   places is two totals that can disagree. Captured and printed, and
   nothing more: the engine's arithmetic is the workbook's and is not
   touched by it, so a plan written before this section existed reads
   exactly as it did.

   And the ladder is read, not pressed. It used to be a six-way tap that
   set the aspiration and, quietly, the level the plan is written for;
   that level is asked for properly in Conclusion, which is where it
   stays. It was laid out one level to a line for a while; the firm then
   asked for the six across two rows of three, each with its own symbol,
   so three columns is what this now holds the layout to — narrowing to
   two and then one as the screen does. Not pressable is the part that
   has not moved. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();

  t.section('the Cashflow section');

  await t.step('it asks the three the firm wrote down, in that order', async () => {
    const r = await t.eval(()=>{
      const sec = FSL_FORM.find(x=>x.key === 'cashflow');
      if(!sec) return {none:true};
      return {card: sec.card, kind: sec.kind,
              labels: sec.fields.map(f=>f.label),
              keys: sec.fields.map(f=>f.k),
              types: Array.from(new Set(sec.fields.map(f=>f.t))),
              monthly: sec.fields.filter(f=>/month/i.test(f.ph||'')).map(f=>f.label),
              required: sec.fields.filter(f=>f.req).length,
              before: FSL_FORM.findIndex(x=>x.key === 'cashflow')
                    < FSL_FORM.findIndex(x=>x.key === 'ladder')};
    });
    if(r.none) throw new Error('there is no Cashflow section on the form');
    const want = ['Gross Family Income','Expense','Liabilities'];
    if(r.labels.join(' | ') !== want.join(' | '))
      throw new Error('it asks: ' + r.labels.join(', '));
    if(r.types.join(',') !== 'num') throw new Error('not every figure is a number: ' + r.types.join(', '));
    if(r.required) throw new Error(r.required + ' of them are mandatory; none was asked to be');
    if(r.monthly.join(' | ') !== 'Gross Family Income | Expense')
      throw new Error('the lines asked monthly are: ' + (r.monthly.join(', ') || 'none'));
    if(/Existing Investment|Monthly Investment/.test(r.labels.join(' ')))
      throw new Error('it still asks for holdings that Section C asks for');
    if(!r.before) throw new Error('it sits after the ladder rather than before it');
    if(!/Cashflow/.test(r.card)) throw new Error('the card is headed "' + r.card + '"');
    return r.labels.length + ' figures, all numbers, none mandatory, income and expense monthly, under "' + r.card + '"';
  });

  await t.step('what is typed into it is kept, and a form saved before it still opens', async () => {
    const r = await t.eval(()=>{
      const blank = fslBlank();
      const s = JSON.parse(JSON.stringify(blank));
      fslSetIn(s, 'cash.grossIncome', 200000);
      fslSetIn(s, 'cash.expense', 125000);
      /* A form written before the section existed has no cash at all. */
      const old = JSON.parse(JSON.stringify(blank));
      delete old.cash;
      return {shape: Object.keys(blank.cash || {}),
              read: [fslGet(s, 'cash.grossIncome'), fslGet(s, 'cash.expense')],
              oldReads: fslGet(old, 'cash.grossIncome'),
              oldThrew: false};
    });
    if(r.shape.length !== 3) throw new Error('a fresh form has ' + r.shape.length + ' cashflow boxes');
    if(r.read.join(',') !== '200000,125000') throw new Error('what was typed came back as ' + r.read.join(', '));
    if(r.oldReads !== undefined) throw new Error('an older form invented a value: ' + r.oldReads);
    return 'three boxes on a fresh form, read back as typed; an older form reads blank rather than breaking';
  });

  await t.step('and it changes nothing the engine works out', async () => {
    const r = await t.eval(()=>{
      const s = fslBlank();
      s.years = 10;
      s.assets[0].current = 1000000;
      s.assets[0].monthly = 10000;
      const before = FSL_ENGINE.compute(s, fslEngineCfg());
      const s2 = JSON.parse(JSON.stringify(s));
      fslSetIn(s2, 'cash.grossIncome', 5000000);
      fslSetIn(s2, 'cash.expense', 3000000);
      fslSetIn(s2, 'cash.liabilities', 2000000);
      const after = FSL_ENGINE.compute(s2, fslEngineCfg());
      return {same: JSON.stringify(before) === JSON.stringify(after),
              fv: before.totFV, rate: before.annROI};
    });
    if(!r.same)
      throw new Error('filling the cashflow in changed what the ladder works out — the engine is not meant to read it');
    return 'the workbook’s arithmetic is untouched by it, to the last figure';
  });

  t.section('the ladder');

  await t.step('it runs three across, two rows of three, and narrows with the screen', async () => {
    const r = await t.eval(()=>{
      const sec = FSL_FORM.find(x=>x.key === 'ladder');
      const rules = Array.from(document.styleSheets)
        .flatMap(sh=>{ try { return Array.from(sh.cssRules); } catch(e){ return []; } });
      const cols = rules.filter(x=>x.selectorText && /\.fsl-ladder$/.test(x.selectorText))
        .map(x=>x.style.gridTemplateColumns).join('');
      /* the two the layout narrows to, read off the media queries themselves */
      const narrow = rules.filter(x=>x.media && Array.from(x.cssRules||[])
          .some(y=>y.selectorText && /\.fsl-ladder$/.test(y.selectorText)))
        .map(x=>Array.from(x.cssRules).filter(y=>y.selectorText && /\.fsl-ladder$/.test(y.selectorText))
          .map(y=>y.style.gridTemplateColumns).join(''));
      return {cols, narrow, hint: sec.hint, levels: sec.levels ? sec.levels.length : null};
    });
    if(!/repeat\(3,\s*1fr\)/.test(String(r.cols)))
      throw new Error('the ladder is laid out as "' + r.cols + '", not three across');
    if(!r.narrow.some(c=>/repeat\(2,\s*1fr\)/.test(c)))
      throw new Error('nothing takes it down to two columns on a narrower screen');
    if(!r.narrow.some(c=>/^1fr$/.test(String(c).trim())))
      throw new Error('nothing takes it down to one column on a phone');
    if(/tap/i.test(r.hint)) throw new Error('the hint still tells somebody to tap it: ' + r.hint);
    return 'three across, then two, then one — and the hint does not ask for a tap';
  });

  await t.step('and every level carries its own symbol', async () => {
    const r = await t.eval(()=>({
      icons: typeof FSL_LEVEL_ICONS === 'undefined' ? null : Object.keys(FSL_LEVEL_ICONS).length,
      drawn: [1,2,3,4,5,6].map(n=>{
        const h = fslLevelIcon(n);
        return /<svg/.test(h) ? (h.match(/<path|<circle|<line|<rect|<polyline/g)||[]).length : 0;
      }),
      /* the markup asks for one per rung, and the rung says which level it is */
      inRung: /fslLevelIcon\(/.test(String(fslLadderHtml)) && /fsl-rung lv/.test(String(fslLadderHtml)),
    }));
    if(r.icons !== 6) throw new Error('there are ' + r.icons + ' symbols, not one per level');
    const blank = r.drawn.map((n,i)=>n ? null : (i+1)).filter(Boolean);
    if(blank.length) throw new Error('nothing is drawn for level(s) ' + blank.join(', '));
    if(!r.inRung) throw new Error('the rung does not draw the symbol, or does not say which level it is');
    return 'six symbols, each drawn, each on its own rung';
  });

  await t.step('and nothing on it can be pressed', async () => {
    const r = await t.eval(()=>{
      const src = Array.from(document.querySelectorAll('script')).map(x=>x.textContent).join('\n');
      const fn = String(fslLadderHtml);
      return {onclick: /onclick=/.test(fn), role: /role="button"/.test(fn),
              keydown: /onkeydown=/.test(fn),
              heading: /class="amt"/.test(fn) && /class="st"/.test(fn) && /class="d"/.test(fn),
              /* the choice still exists, where it belongs */
              conclusion: /k:'chosenLevel'/.test(src)};
    });
    if(r.onclick || r.role || r.keydown)
      throw new Error('the ladder is still a control: ' + JSON.stringify(r));
    if(!r.heading) throw new Error('the amount, the stage and the description are not all drawn');
    if(!r.conclusion)
      throw new Error('the level the plan is written for is no longer asked anywhere');
    return 'no click, no role, no key handler — the amount as the heading, the stage under it, '
      + 'and the level the plan is written for still asked in Conclusion';
  });

  await t.step('the figure in each rung is picked out of the sentence round it', async () => {
    const r = await t.eval(()=>{
      const pick = h => { const d = document.createElement('div'); d.innerHTML = h;
        return Array.from(d.querySelectorAll('.fsl-fig')).map(x=>x.textContent); };
      return {
        shipped: fslLevels().map(l=>({lvl:l.lvl, figs: pick(fslFigureHtml(l.purpose||''))})),
        lakh:  pick(fslFigureHtml('Empowers you to live a lifestyle of Rs 8 Lakh per month and more')),
        rupee: pick(fslFigureHtml('a lifestyle worth \u20B9 1,00,000 per month')),
        none:  pick(fslFigureHtml('No figure in this sentence at all')),
        tag:   fslFigureHtml('<b>Rs 500 per month</b>'),
      };
    });
    const bare = r.shipped.filter(l=>!l.figs.length);
    if(bare.length) throw new Error('no figure found on level(s) ' + bare.map(l=>l.lvl).join(', '));
    if(r.shipped[0].figs[0] !== 'Rs 50,000 per month')
      throw new Error('level 1 highlighted "' + r.shipped[0].figs[0] + '"');
    if(r.lakh[0] !== 'Rs 8 Lakh per month') throw new Error('a lakh figure came out as "' + r.lakh[0] + '"');
    if(r.rupee[0] !== '\u20B9 1,00,000 per month') throw new Error('a \u20B9 figure came out as "' + r.rupee[0] + '"');
    if(r.none.length) throw new Error('it highlighted something in a sentence with no figure in it');
    if(/<b>/.test(r.tag)) throw new Error('a tag typed into the wording in Setup was passed through as markup');
    return r.shipped.length + ' rungs, each with its monthly figure picked out — "'
         + r.shipped[0].figs[0] + '" on level 1, and nothing marked where there is no figure';
  });

  t.section('what the planner is shown of it');

  await t.step('the planning page gives each line both ways, and the surplus between them', async () => {
    const r = await t.eval(()=>{
      _fsl = _fsl || {};
      _fsl.s = _fsl.s || fslBlank();
      _fsl.s.cash = {grossIncome:200000, expense:125000, liabilities:1000000};
      const html = fslCashflowCardHtml();
      const box = document.createElement('div'); box.innerHTML = html;
      const rows = Array.from(box.querySelectorAll('tbody tr')).map(tr=>
        Array.from(tr.children).map(td=>td.textContent.trim()));
      return {rows, heads: Array.from(box.querySelectorAll('thead th')).map(th=>th.textContent.trim()),
              foot: (box.querySelectorAll('.small-note')[1]||{}).textContent || '',
              want: [money(200000), money(2400000), money(125000), money(1500000),
                     money(75000), money(900000), money(1000000)]};
    });
    if(r.heads.join(' | ') !== 'Line | Monthly | Annually')
      throw new Error('the columns are: ' + r.heads.join(', '));
    const want = [
      ['Gross Family Income', r.want[0], r.want[1]],
      ['Expense',             r.want[2], r.want[3]],
      ['Surplus',             r.want[4], r.want[5]],
    ];
    want.forEach((w, i)=>{
      const got = r.rows[i] || [];
      if(got.join(' | ') !== w.join(' | '))
        throw new Error('row ' + (i+1) + ' reads "' + got.join(' | ') + '", not "' + w.join(' | ') + '"');
    });
    if(r.foot.indexOf(r.want[6]) < 0)
      throw new Error('the liabilities outstanding are not on the card: ' + r.foot.trim());
    return 'income ' + r.want[0] + '/' + r.want[1] + ', expense ' + r.want[2] + '/' + r.want[3]
         + ', surplus ' + r.want[4] + '/' + r.want[5] + ' — and the liabilities under it';
  });

  await t.step('an unanswered line is a dash, not a nought, and a deficit is called one', async () => {
    const r = await t.eval(()=>{
      _fsl.s.cash = {grossIncome:'', expense:'', liabilities:''};
      const blank = fslCashflowCardHtml();
      _fsl.s.cash = {grossIncome:80000, expense:95000, liabilities:''};
      const short = fslCashflowCardHtml();
      const text = h => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent; };
      return {blank: text(blank), short: text(short), f: fslCashflow(_fsl.s),
              want: money(-15000)};
    });
    if(!/—/.test(r.blank)) throw new Error('an empty form shows no dashes at all');
    if(r.f.surplus !== -15000) throw new Error('the surplus came out as ' + r.f.surplus);
    if(r.short.indexOf(r.want) < 0) throw new Error('the deficit is not shown as ' + r.want);
    if(!/Spending more than it earns/.test(r.short))
      throw new Error('a household spending more than it earns is not told so');
    return 'blank reads —, and −₹15,000 a month is called out as a deficit';
  });

  await t.step('the card is on the planning page the RM works from', async () => {
    const r = await t.eval(async ()=>{
      const l = {id: uid('LMS'), firstName:'ZZ Cash', lastName:'Flow', mobile:'9800000041',
        email:'zz.cash@zz.in', assignedTo: currentUser, branch: DB.config.branches[0],
        createdAt:new Date().toISOString(), transformationForm:'FSL', dob:'1985-04-12',
        iseqScore: 44, iseqCategory:'Moderate'};
      initState('LMS', l); DB.leads.push(l); await save('leads');
      window._fslLeadId = l.id; window._fslStep = 'input';
      navigate('fsl');
      await new Promise(r=>setTimeout(r, 400));
      Object.assign(_fsl.s.personal, {name:'ZZ Cash Flow', mobile:'9800000041',
        email:'zz.cash@zz.in', dob:'1985-04-12'});
      _fsl.s.years = 10;
      _fsl.s.assets[0].current = 500000; _fsl.s.assets[0].monthly = 10000;
      _fsl.s.aspiration = '3'; _fsl.s.chosenLevel = '3';
      _fsl.s.cash = {grossIncome:200000, expense:125000, liabilities:1000000};
      _fsl.dirty = true; fslRecompute(); await fslSaveSheet();
      await fslSubmitForClient(l.id);
      await fslStepGo('plan');
      await new Promise(r=>setTimeout(r, 600));
      const titles = Array.from(document.querySelectorAll('.se-card .section-title'))
        .map(x=>x.textContent.trim());
      return {titles, text: (document.getElementById('root')||{}).textContent || '',
              want: [money(2400000), money(900000)]};
    });
    if(r.titles.indexOf('Cashflow') < 0)
      throw new Error('there is no Cashflow card on RM Working — it shows: ' + r.titles.join(', '));
    if(r.text.indexOf(r.want[0]) < 0) throw new Error('the yearly income ' + r.want[0] + ' is not on the page');
    if(r.text.indexOf(r.want[1]) < 0) throw new Error('the yearly surplus ' + r.want[1] + ' is not on the page');
    return 'RM Working carries the Cashflow card, with ' + r.want[0] + ' a year in and ' + r.want[1] + ' a year spare';
  });

  t.section('and it does not hold the client\u2019s Submit shut');

  await t.step('a display-only ladder is never outstanding', async () => {
    const r = await t.eval(()=>{
      const sec = FSL_FORM.find(x=>x.key === 'ladder');
      const was = JSON.parse(JSON.stringify(_fsl ? _fsl.s : fslBlank()));
      _fsl = _fsl || {};
      _fsl.s = fslBlank();
      Object.assign(_fsl.s.personal, {name:'ZZ Ladder Gate', mobile:'9800000051',
        email:'zz.gate@zz.in', dob:'1985-04-12'});
      _fsl.s.years = 10;
      _fsl.s.aspiration = '';            // nothing picked, because nothing can be
      const out = fslMissing('client').map(m=>m.label);
      _fsl.s = was;
      return {out, label: fslSectionFields(sec).map(f=>f.label)};
    });
    if(r.out.some(x=>/level aspired to/i.test(x)))
      throw new Error('the ladder still reads as unanswered: ' + r.out.join(', '));
    if(r.out.length)
      throw new Error('something else on a filled client form is still outstanding: ' + r.out.join(', '));
    return 'a client who has filled their four sections has nothing left to answer';
  });

  await t.step('and the client\u2019s own page sends it back', async () => {
    const token = await t.eval(async ()=>{
      const l = {id: uid('LMS'), firstName:'ZZ Gate', lastName:'FSL', mobile:'9800000052',
        email:'zz.gate2@zz.in', assignedTo: currentUser, branch: DB.config.branches[0],
        createdAt:new Date().toISOString(), transformationForm:'FSL', dob:'1985-04-12',
        iseqScore: 44, iseqCategory:'Moderate'};
      initState('LMS', l); DB.leads.push(l); await save('leads');
      window._zzGate = l.id;
      window._fslLeadId = l.id; window._fslStep = 'input';
      navigate('fsl');
      await new Promise(r=>setTimeout(r, 400));
      Object.assign(_fsl.s.personal, {name:'ZZ Gate FSL', mobile:'9800000052',
        email:'zz.gate2@zz.in', dob:'1985-04-12'});
      _fsl.s.years = 10;
      _fsl.s.assets[0].current = 500000; _fsl.s.assets[0].monthly = 10000;
      _fsl.dirty = true; fslRecompute(); await fslSaveSheet();
      return await createDocLink(l.id, 'FSL', {recordModule:'LMS', recordId: l.id});
    });
    await t.doc(token, 1500);
    const r = await t.eval(async (tok)=>{
      /* The risk questionnaire travels on the same link and is a real
         requirement; answer it the way a client would, so what is left
         blocking Submit is the ladder or nothing. */
      const link = DB.docLinks.find(l=>l.token===tok);
      const type = uniIseqSyncType(link, tok);
      iseqFieldsFor(type).filter(f=>(f.opts||[]).length)
        .forEach(f=>uniIseqPick(tok, f.k, 0));
      const before = (DB.docSubmissions||[]).filter(x=>x.token===tok).length;
      await submitDocForm(tok);
      await new Promise(r=>setTimeout(r, 800));
      return {before, after: (DB.docSubmissions||[]).filter(x=>x.token===tok).length,
              status: (DB.docLinks.find(l=>l.token===tok)||{}).status || ''};
    }, token);
    if(t.dialogs.length)
      throw new Error('it refused to send: ' + t.dialogs.join(' | '));
    if(r.after <= r.before)
      throw new Error('Submit was not refused but nothing came back either');
    if(r.status !== 'Submitted')
      throw new Error('the link still reads "' + r.status + '" rather than Submitted');
    return 'the client pressed Submit with the ladder untouched and the form came back, link marked Submitted';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
