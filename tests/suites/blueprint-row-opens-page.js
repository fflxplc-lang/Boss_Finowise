/* A LINE ON A BLUEPRINT'S LIST OPENS THE BLUEPRINT.

   Clicking a record on FSL's list went to the planning journey — the
   page that gathers everything the blueprint touches. Useful, and not
   what somebody opening FSL came for: they came for the Success
   Ladder. The firm asked for the line to go to the blueprint's own
   page, and for it to be the same on every blueprint.

   So the row goes to the page, the row's own button still goes to the
   journey, and neither of them is named here one blueprint at a time
   — every blueprint with a workbench calls its own page the same
   step, so one added later needs no edit.

   The other half of it is a record with no plan behind it, which has
   no blueprint page to show. It lands on the furthest step it has
   reached instead of an empty one. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();

  t.section('where the line goes');

  await t.step('with a plan prepared it is the blueprint’s own page', async () => {
    const r = await t.eval(()=>{
      /* Asked of every blueprint there is, rather than of FSL. */
      const out = {};
      blueprintModuleTypes().forEach(type=>{
        const A = sheetAdapter(type);
        const steps = (A && A.steps ? A.steps() : []).map(x=>x[0]);
        out[type] = {
          prepared: blueprintLandingStep(type, {prepared:true, sheetIn:true, mapped:true}),
          bare:     blueprintLandingStep(type, {prepared:false, sheetIn:false, mapped:false}),
          mapped:   blueprintLandingStep(type, {prepared:false, sheetIn:true, mapped:true}),
          hasBp:    steps.indexOf('bp') >= 0,
          hasMap:   steps.indexOf('map') >= 0,
          label:    (A && A.steps ? (A.steps().find(x=>x[0]==='bp')||[])[1] : '') || '',
        };
      });
      return out;
    });
    const names = Object.keys(r);
    if(!names.length) throw new Error('no blueprints are registered at all');
    const wrong = names.filter(k=>r[k].hasBp && r[k].prepared !== 'bp')
      .map(k=>k + ' lands on "' + r[k].prepared + '"');
    if(wrong.length) throw new Error('with a plan prepared: ' + wrong.join('; '));
    const bareWrong = names.filter(k=>r[k].bare !== 'input').map(k=>k + ' → ' + r[k].bare);
    if(bareWrong.length) throw new Error('with nothing prepared: ' + bareWrong.join('; '));
    const mapWrong = names.filter(k=>r[k].hasMap && r[k].mapped !== 'map').map(k=>k + ' → ' + r[k].mapped);
    if(mapWrong.length) throw new Error('mapped but not planned: ' + mapWrong.join('; '));
    const withBp = names.filter(k=>r[k].hasBp);
    return withBp.map(k=>k + ' → ' + (r[k].label || 'its blueprint page')).join('; ')
      + '; and ' + (names.length - withBp.length) + ' without a workbench open what they have';
  });

  await t.step('and the list wires the line to it, with the journey still on the button', async () => {
    const r = await t.eval(async ()=>{
      const type = blueprintModuleTypes().find(x=>sheetAdapter(x)) || blueprintModuleTypes()[0];
      /* A record on that blueprint, so there is a line to look at. */
      let l = DB.leads.find(x=>x.id === 'LMS-BPROW');
      if(!l){ l = {id:'LMS-BPROW'}; DB.leads.push(l); }
      Object.assign(l, {firstName:'ZZ Row', lastName:'Tester', mobile:'9800555111',
        email:'row@example.com', assignedTo: currentUser, transformationForm: type,
        createdAt:new Date().toISOString()});
      if(!stateOf('LMS', l)) initState('LMS', l);
      await save('leads');
      const html = viewBlueprintModule(blueprintModuleView(type));
      const d = document.createElement('div'); d.innerHTML = html;
      const tr = d.querySelector('tbody tr');
      const btn = tr ? tr.querySelector('button') : null;
      return {type,
              row: tr ? (tr.getAttribute('onclick') || '') : '(no rows)',
              btn: btn ? (btn.getAttribute('onclick') || '') : '(no button)',
              btnText: btn ? (btn.textContent || '').trim() : ''};
    });
    if(/no rows/.test(r.row)) throw new Error('the fixture put no record on ' + r.type);
    if(!/openBlueprintPage\(/.test(r.row))
      throw new Error('the line still goes to: ' + r.row);
    if(!/openBlueprintRecord\(/.test(r.btn))
      throw new Error('the journey button goes to: ' + r.btn);
    if(!/journey/i.test(r.btnText)) throw new Error('the button now reads "' + r.btnText + '"');
    return 'the line opens the blueprint page; “' + r.btnText + '” still opens the journey';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
