/* THE FIRM'S FINAL ASSET ALLOCATION MATRIX.

   "Final Asset Allocation is decided based on ability to take Risk"
   — and on how long the money is for. The questionnaire answers the
   first, the goal answers the second, and the firm's table is where
   the two meet. The page used to answer only the first: an
   Equity/Debt/Gold split off the score, with the horizon waved at in
   a sentence — "up to 3 years is debt, 3 to 7 is hybrid, more than 7
   is equity" — which is a three-band approximation of a seven-band
   table.

   The table itself is read now, and both answers are shown: the split
   is how much of each asset class, the matrix is what to hold for
   money needed in a particular year.

   What this pins: that every cell matches the slide, that the column
   follows the score, and that it reaches every place the ISEQ is
   reported — both pages a client can end on, and the letter. */
const {suite} = require('../lib/harness');

/* The slide, transcribed once. If the table in the code is edited,
   this is what says whether it still says what the firm says. */
const SLIDE = {
  'Conservative': ['Flexi Deposit','Bank FD','Short Term Fund','Equity Savings Funds',
                   'DAA / BAF / Multi Asset Fund','BAF / Multi Asset Fund','Hybrid / Large Cap / Flexicap Fund'],
  'Moderately Conservative': ['Bank FD','Bank FD / Ultra Short Term Fund',
                   'Corporate Bond Fund / PSU / Medium Term Debt Fund','DAA / BAF',
                   'BAF / Multi Asset Fund','Hybrid MF / Large Cap','Large Cap / Flexi Cap / Multicap Fund'],
  'Moderate': ['Liquid Fund / Ultra Short Term Fund','Money Manager Fund / Short Term Fund',
                   'Equity Savings Funds / DAA / BAF','Multi Asset Fund','Hybrid Fund',
                   'Large Cap Fund / Flexi Cap Fund', null],
  'Moderately Aggressive': ['Ultra Short Term Fund / Money Market Fund',
                   'Short Term Fund / Equity Savings Funds','BAF / Multi Asset Fund','Hybrid Fund',
                   'Large & Mid Cap Fund / Flexi Cap Fund','Mid Cap Fund / Thematic Fund', null],
  'Aggressive': ['Ultra Short Term Fund','Short Term Fund / Equity Savings Funds',
                   'BAF / Multi Asset Fund','Hybrid MF / Large Cap MF','Flexi Cap / Mid Cap Fund',
                   'Small Cap Fund / Sector Fund / Thematic Fund', null],
};
const HORIZONS = ['< 1 Yr','1 – 3 Yrs','3 – 5 Yrs','5 – 7 Yrs','7 – 10 Yrs','10 – 12 Yrs','> 12 Yrs'];

suite(async t => {
  await t.home();

  t.section('the table says what the slide says');

  await t.step('every column, cell by cell', async () => {
    const r = await t.eval(cols=>{
      const out = {};
      Object.keys(cols).forEach(p=>{ out[p] = iseqMatrixFor(p); });
      return {out, horizons: ISEQ_HORIZON_MATRIX.map(x=>x.horizon),
              unknown: iseqMatrixFor('ZZ Not A Profile'), blank: iseqMatrixFor('')};
    }, SLIDE);
    if(r.horizons.join(' | ') !== HORIZONS.join(' | '))
      throw new Error('the horizons read: ' + r.horizons.join(' | '));
    const wrong = [];
    Object.keys(SLIDE).forEach(p=>{
      const got = r.out[p];
      if(!got){ wrong.push(p + ': no column at all'); return; }
      SLIDE[p].forEach((want, i)=>{
        if(want === null) return;                 // the three that share a cell, checked below
        if(got[i].what !== want)
          wrong.push(p + ' at ' + HORIZONS[i] + ': "' + got[i].what + '" not "' + want + '"');
      });
    });
    if(wrong.length) throw new Error(wrong.join('; '));
    /* The last row is one answer for the three profiles that can take it. */
    const last = ['Moderate','Moderately Aggressive','Aggressive'].map(p=>r.out[p][6].what);
    if(new Set(last).size !== 1) throw new Error('the > 12 Yrs row differs: ' + last.join(' / '));
    if(!/MultiCap.*Small Case/.test(last[0])) throw new Error('> 12 Yrs reads "' + last[0] + '"');
    if(r.unknown || r.blank) throw new Error('it invented a column for a profile it has never heard of');
    return Object.keys(SLIDE).length + ' columns × ' + HORIZONS.length + ' horizons, every cell the slide’s';
  });

  t.section('and it is shown wherever the ISEQ is reported');

  await t.step('on the page, under the column the score picked', async () => {
    const r = await t.eval(()=>{
      const html = iseqAllocationHtml('Moderately Conservative', Object.keys(ISEQ_BANK)[0]);
      const d = document.createElement('div'); d.innerHTML = html;
      const rows = Array.from(d.querySelectorAll('.iseq-matrix tbody tr'))
        .map(tr=>Array.from(tr.querySelectorAll('td')).map(td=>td.textContent.trim()));
      return {rows, head: Array.from(d.querySelectorAll('.iseq-matrix thead th')).map(x=>x.textContent.trim()),
              kpis: Array.from(d.querySelectorAll('.kpi .num')).map(x=>x.textContent.trim()),
              /* a profile with no column still gets its split */
              odd: iseqAllocationHtml('ZZ Nobody', Object.keys(ISEQ_BANK)[0])};
    });
    if(r.rows.length !== 7) throw new Error(r.rows.length + ' rows on the page');
    if(r.head[2] !== 'Moderately Conservative')
      throw new Error('the column is headed "' + r.head[2] + '"');
    if(r.rows[0][2] !== 'Bank FD') throw new Error('the first row reads "' + r.rows[0][2] + '"');
    if(r.kpis.length !== 3) throw new Error('the split went missing: ' + r.kpis.join(', '));
    if(/iseq-matrix/.test(r.odd)) throw new Error('a profile with no column still drew a table');
    return r.rows.length + ' rows under "' + r.head[2] + '", with the split still above it';
  });

  /* The firm read the page and saw the table framed in a box of its own,
     a pixel out from everything else on the card. It was wrapped in
     .table-wrap, which is a panel — white, bordered, rounded, shadowed —
     so the client's page carried a card inside a card. This measures the
     thing that was wrong rather than naming the class that caused it:
     every block on that card begins and ends on the same two pixels. */
  await t.step('and every line on the card starts and ends in the same place', async () => {
    const r = await t.eval(()=>{
      const host = document.createElement('div');
      host.className = 'card';
      host.style.cssText = 'position:absolute;left:0;top:0;width:1100px';
      host.innerHTML = iseqAllocationHtml('Conservative', Object.keys(ISEQ_BANK)[0])
        .replace(/^\s*<div class="card"[^>]*>/, '').replace(/<\/div>\s*$/, '');
      document.body.appendChild(host);
      const edge = sel => { const el = host.querySelector(sel); if(!el) return null;
        const b = el.getBoundingClientRect();
        return {l: Math.round(b.left), r: Math.round(b.right)}; };
      const out = {
        title:  edge('.section-title'),
        kpis:   edge('.grid-kpi'),
        table:  edge('.iseq-matrix'),
        firstTh: edge('.iseq-matrix th'),
        firstTd: edge('.iseq-matrix td'),
        lastTh: edge('.iseq-matrix th:last-child'),
        note:   edge('.small-note'),
        nested: !!host.querySelector('.table-wrap'),
      };
      host.remove();
      return out;
    });
    if(r.nested) throw new Error('the table is still inside a panel of its own');
    const want = r.title;
    if(!want) throw new Error('the card drew no section title to measure against');
    /* A cell is as wide as its column, so the left edge is what the first
       one has to share and the right edge is the last one's. */
    const leftOff = ['kpis','table','firstTh','firstTd','note']
      .filter(k=>r[k] && r[k].l !== want.l).map(k=>k + ' at ' + r[k].l);
    if(leftOff.length)
      throw new Error(leftOff.join(', ') + ' — the rest of the card begins at ' + want.l);
    const rightOff = ['kpis','table','note','lastTh']
      .filter(k=>r[k] && r[k].r !== want.r).map(k=>k + ' at ' + r[k].r);
    if(rightOff.length)
      throw new Error(rightOff.join(', ') + ' — the rest of the card ends at ' + want.r);
    return 'title, split, table, the first cell and the note all run ' + want.l + '\u2013' + want.r;
  });

  await t.step('and the letter carries the same column', async () => {
    const r = await t.eval(()=>({
      lines: iseqMatrixLines('Aggressive'),
      none: iseqMatrixLines('ZZ Nobody'),
    }));
    const lines = String(r.lines).split('\n');
    if(lines.length !== 7) throw new Error(lines.length + ' lines in the letter');
    if(!/^< 1 Yr — Ultra Short Term Fund$/.test(lines[0]))
      throw new Error('the first line reads "' + lines[0] + '"');
    if(r.none) throw new Error('it wrote lines for a profile with no column');
    return lines.length + ' lines, beginning "' + lines[0] + '"';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
