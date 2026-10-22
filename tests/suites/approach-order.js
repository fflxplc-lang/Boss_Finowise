/* THE ORDER THE FIRM LISTS THE BLUEPRINTS IN.

   The Investment Approach modal offers four blueprints and selects
   none — which one a lead goes on is the adviser's call, made in the
   room. The order it offers them in is the firm's own, and they asked
   for Goal Based Planning first.

   Guarded because the order is the kind of thing a later edit
   reshuffles without noticing, and because there are two lists behind
   it — the chooser's and the rail's. They are meant to agree, so the
   firm meets one order for the blueprints rather than one per screen,
   and a change to either alone is caught here. */
const {suite} = require('../lib/harness');

const WANT = ['Goal Based Planning', 'FSL — Financial Success Ladder',
              'Comprehensive Freedom Blueprint (7 Events)', 'GAB — Golden Age Blueprint'];

suite(async t => {
  await t.home();

  await t.step('the chooser offers them in the firm’s order', async () => {
    const r = await t.eval(()=>{
      let l = DB.leads.find(x=>x.id === 'LMS-APPR');
      if(!l){ l = {id:'LMS-APPR'}; DB.leads.push(l); }
      Object.assign(l, {firstName:'ZZ Approach', lastName:'Tester', mobile:'9800777222',
        assignedTo: currentUser, createdAt:new Date().toISOString()});
      renderInvestmentApproachModal('LMS-APPR');
      const rows = Array.from(document.querySelectorAll('#overlay input[name="ia_form"]'));
      const out = {values: rows.map(x=>x.value),
                   labels: rows.map(x=>{
                     const lab = x.closest('label');
                     return lab ? (lab.textContent || '').replace(/\s+/g,' ').trim() : '';
                   }),
                   picked: rows.filter(x=>x.checked).length};
      closeModal();
      return out;
    });
    if(r.values.length !== 4) throw new Error(r.values.length + ' blueprints offered, not four');
    if(r.values.join(',') !== 'MULTIGOAL,FSL,SEVENEVENTS,GAB')
      throw new Error('the order reads: ' + r.values.join(', '));
    const wrong = WANT.filter((w, i)=>r.labels[i] !== w)
      .map(w=>'"' + w + '" is not where it should be');
    if(wrong.length) throw new Error(wrong.join('; ') + ' — got: ' + r.labels.join(' | '));
    if(r.picked) throw new Error('it pre-selected one — the pick is the adviser’s');
    return r.labels.map((x, i)=>(i + 1) + '. ' + x).join('  ');
  });

  await t.step('and the rail lists them the same way', async () => {
    const r = await t.eval(()=>({rail: blueprintModuleTypes(),
                                 order: BLUEPRINT_RAIL_ORDER.slice(),
                                 chooser: TRANSFORMATION_FORMS.slice()}));
    if(r.rail.join(',') !== r.order.join(','))
      throw new Error('the rail draws ' + r.rail.join(', ') + ', not the order it is given, '
        + r.order.join(', '));
    /* One order for the blueprints, not one per screen. */
    if(r.rail.join(',') !== r.chooser.join(','))
      throw new Error('the rail reads ' + r.rail.join(', ') + ' and the chooser '
        + r.chooser.join(', ') + ' — they are meant to agree');
    return 'the rail reads ' + r.rail.join(' · ') + ', the same order the chooser offers';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
