/* A FORM ROW IS MEANT TO BE FULL.

   The input forms laid their fields out with auto-fill at a 210px
   minimum, so a desktop card opened seven or eight tracks and then put
   four fields in them. Section A of the FSL form was the firm's
   example: a date on its own line, a name in a box a thousand pixels
   wide, a mobile on its own line, and half the card white.

   Four columns at most now, so a field is a sensible width; a field
   that needs more room takes two of them rather than a line of its
   own; and the sections are ordered so each row comes out exactly
   full. This measures that on the rendered page rather than reading
   the stylesheet — the fields are where the browser puts them. */
const {suite} = require('../lib/harness');

/* Group a grid's children into visual rows by their top edge, and report
   where the last one in each row ends against the grid's own width. */
const ROWS = `(a) => {
  const g = document.querySelectorAll(a.sel)[a.i || 0];
  if(!g) return {none:true};
  const gb = g.getBoundingClientRect();
  const kids = Array.from(g.children).filter(k=>k.offsetParent !== null);
  const rows = [];
  kids.forEach(k=>{
    const b = k.getBoundingClientRect();
    let r = rows.find(x=>Math.abs(x.top - b.top) < 4);
    if(!r){ r = {top:b.top, right:0, n:0}; rows.push(r); }
    r.right = Math.max(r.right, b.right); r.n++;
  });
  rows.sort((a,b)=>a.top - b.top);
  return {width: Math.round(gb.width),
          overflow: Math.round(g.scrollWidth - g.clientWidth),
          tracks: getComputedStyle(g).gridTemplateColumns.split(' ').length,
          rows: rows.map(r=>({n:r.n, slack: Math.round(gb.right - r.right)}))};
}`;

function fills(r, what){
  if(r.none) throw new Error('there is no ' + what + ' on the page');
  if(r.overflow > 1) throw new Error(what + ' runs ' + r.overflow + 'px past its card');
  if(r.tracks > 4) throw new Error(what + ' opened ' + r.tracks + ' columns on a desktop card');
  const short = r.rows.map((x,i)=>[i, x.slack]).filter(([,s])=>s > 4);
  if(short.length) throw new Error(what + ' leaves ' + short.map(([i,s])=>'row ' + (i+1) + ' ' + s + 'px short').join(', '));
  return r.rows.length + ' rows of up to ' + r.tracks + ' columns, every one filled to the edge';
}

const FSL = `async () => {
  const l = {id: uid('LMS'), firstName:'ZZ Grid', lastName:'FSL', mobile:'9800000011',
    email:'zz.grid@zz.in', assignedTo: currentUser, branch: DB.config.branches[0],
    createdAt:new Date().toISOString(), transformationForm:'FSL', dob:'1985-04-12'};
  initState('LMS', l); DB.leads.push(l); await save('leads');
  window._fslLeadId = l.id; window._fslStep = 'input';
  navigate('fsl');
  await new Promise(r=>setTimeout(r, 400));
  return l.id;
}`;

const SE = `async () => {
  const l = {id: uid('LMS'), firstName:'ZZ Grid', lastName:'SE', mobile:'9800000012',
    email:'zz.grid.se@zz.in', assignedTo: currentUser, branch: DB.config.branches[0],
    createdAt:new Date().toISOString(), transformationForm:'7 Events', dob:'1985-04-12'};
  initState('LMS', l); DB.leads.push(l); await save('leads');
  openSevenEvents(l.id, 'input');
  await new Promise(r=>setTimeout(r, 500));
  return l.id;
}`;

suite({viewport:{width:1700, height:1000}}, async t => {
  await t.home();

  t.section('the FSL input form');

  await t.step('Section A fills every row it opens', async () => {
    await t.eval(new Function('return (' + FSL + ')()'));
    const r = await t.eval(new Function('a', 'return (' + ROWS + ')(a)'),
      {sel:'.se-card .se-grid', i:0});
    return fills(r, 'Section A \u00b7 Personal Information');
  });

  await t.step('and so does Cashflow', async () => {
    const g = await t.eval(new Function('a', 'return (' + ROWS + ')(a)'),
      {sel:'.se-card .se-grid', i:2});
    return fills(g, 'Section A2 \u00b7 Cashflow');
  });

  t.section('the 7 Events input form');

  await t.step('Basic details fills every row it opens', async () => {
    await t.eval(new Function('return (' + SE + ')()'));
    const r = await t.eval(new Function('a', 'return (' + ROWS + ')(a)'),
      {sel:'.se-card .se-grid', i:0});
    return fills(r, 'Basic details');
  });

  t.section('and nothing anywhere is pushed off its card');

  await t.step('no grid on a form, a profile or a dialog overflows', async () => {
    const bad = await t.eval(()=>{
      const out = [];
      document.querySelectorAll('.se-grid, .field-grid').forEach((g,i)=>{
        if(!g.offsetParent) return;
        const over = g.scrollWidth - g.clientWidth;
        const tracks = getComputedStyle(g).gridTemplateColumns.split(' ').length;
        if(over > 1) out.push('grid ' + i + ' overflows by ' + Math.round(over) + 'px');
        if(tracks > 4) out.push('grid ' + i + ' opened ' + tracks + ' columns');
      });
      return out;
    });
    if(bad.length) throw new Error(bad.join('; '));
    return 'every grid on the page sits inside its card, four columns at most';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
