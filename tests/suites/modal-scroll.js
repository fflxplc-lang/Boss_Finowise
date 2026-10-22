/* A FORM THAT REDRAWS ITSELF MUST NOT THROW YOU BACK TO THE TOP.

   A modal is one block of HTML, and several forms rebuild the whole
   of it when one field changes — an allocation re-renders when the
   fund house changes, when an amount is capped, when a scheme is
   picked. Replacing innerHTML destroys .modal-body, which is the
   element that scrolls, so the new one starts at the top and the
   field being typed into loses focus with it. On a long sheet every
   edit near the bottom threw the adviser back to the client's name.

   The fix is in openModal rather than in any one form, so every
   modal in BOSS gets it. What has to hold: a redraw of the same
   modal keeps the scroll and the cursor; a DIFFERENT modal opening
   is not a redraw and starts at the top, as it should; and a form
   that deliberately scrolls somewhere — Add Scheme, to the line it
   just added — still gets to. */
const {suite} = require('../lib/harness');

const LONG = '<div style="height:1400px">tall</div>'
  + '<input type="text" id="zz_field" value="abcdefgh">'
  + '<div style="height:1400px">tall</div>';

suite(async t => {
  await t.home();
  await t.eval(h => { window.LONG_HTML = h; }, LONG);

  t.section('a redraw keeps your place');

  await t.step('the scroll position and the cursor both survive', async () => {
    const r = await t.eval(()=>{
      openModal('ZZ Scroll Test', LONG_HTML, '<button class="btn">x</button>');
      const body = () => document.querySelector('#modalBody .modal-body');
      body().scrollTop = 900;
      const el = document.getElementById('zz_field');
      el.focus();
      el.setSelectionRange(3, 3);
      const before = {top: body().scrollTop, at: el.selectionStart};
      /* The same modal, drawn again — what every one of these forms
         does when a field changes. */
      openModal('ZZ Scroll Test', LONG_HTML, '<button class="btn">x</button>');
      const after = {top: body().scrollTop,
                     focused: (document.activeElement || {}).id,
                     at: (document.activeElement || {}).selectionStart};
      closeModal();
      return {before, after};
    });
    if(r.before.top !== 900) throw new Error('the fixture did not scroll');
    if(r.after.top !== 900)
      throw new Error('the redraw moved the scroll from 900 to ' + r.after.top);
    if(r.after.focused !== 'zz_field')
      throw new Error('the cursor left the field, landing on "' + r.after.focused + '"');
    if(r.after.at !== 3) throw new Error('the caret moved to ' + r.after.at);
    return 'scroll held at 900, cursor still in the field, caret still at 3';
  });

  await t.step('a different modal still opens at the top', async () => {
    const r = await t.eval(()=>{
      openModal('ZZ Scroll Test', LONG_HTML, '');
      const body = () => document.querySelector('#modalBody .modal-body');
      body().scrollTop = 900;
      openModal('ZZ Something Else', LONG_HTML, '');
      const top = body().scrollTop;
      closeModal();
      return {top};
    });
    if(r.top !== 0) throw new Error('a new modal opened part-way down, at ' + r.top);
    return 'a different dialog opens at the top, as it should';
  });

  t.section('the allocation sheet, where it was reported');

  await t.step('editing an amount near the bottom does not jump the sheet', async () => {
    const r = await t.eval(async ()=>{
      const c = DB.clients.find(x=>!x.deletedAt) || DB.clients[0];
      const entry = {id: uid('DBT'), clientId: c.id, dbtType:'Investment', amount:'900000',
        transactionType:'Purchase', status:'Pending from Client Consent',
        createdAt:new Date().toISOString()};
      DB.businessEntries.push(entry); await save('businessEntries');
      const rec = {id: uid('REC'), clientId: c.id, status:'Draft', sourceModule:'DBT',
        dbtEntryId: entry.id, productCategory:'Mutual Fund', investmentMode:'Lumpsum',
        schemes:[], attachments:[], createdAt:new Date().toISOString()};
      DB.recommendations.push(rec); await save('recommendations');
      window._allocDraft = JSON.parse(JSON.stringify(rec));
      const d = window._allocDraft;
      d.schemes = [allocNewLineFor(d)];
      d.schemes[0].schemeName = 'ZZ Scroll One';
      allocSpreadAmounts(d);
      renderAllocationForm(true);
      allocAddScheme(); allocAddScheme();
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const body = () => document.querySelector('#modalBody .modal-body');
      body().scrollTop = 700;
      const before = body().scrollTop;
      /* The thing the firm reported: type into a field and the page
         goes back to the top. */
      allocAmountChanged(1, '200000');
      const after = body().scrollTop;
      /* And picking a fund house, which also redraws. */
      allocLineChanged(0, 'amcId', '');
      const afterPick = body().scrollTop;
      closeModal();
      return {before, after, afterPick};
    });
    if(!r.before) throw new Error('the fixture did not scroll');
    if(r.after !== r.before)
      throw new Error('editing an amount moved the sheet from ' + r.before + ' to ' + r.after);
    if(r.afterPick !== r.before)
      throw new Error('changing the fund house moved the sheet to ' + r.afterPick);
    return 'held at ' + r.before + ' through an amount edit and a fund house change';
  });

  await t.step('Add Scheme still gets to scroll to its new line', async () => {
    const r = await t.eval(async ()=>{
      const d = window._allocDraft = {id:'', clientId:'', attachments:[],
        productCategory:'Mutual Fund', investmentMode:'Lumpsum', schemes:[]};
      d.schemes = [allocNewLineFor(d)];
      renderAllocationForm(false);
      let went = null;
      const real = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function(o){ went = this.className; };
      allocAddScheme();
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      Element.prototype.scrollIntoView = real;
      const inNew = !!(document.activeElement
        && document.querySelectorAll('.alloc-line')[1]
        && document.querySelectorAll('.alloc-line')[1].contains(document.activeElement));
      closeModal();
      return {went: went || '', inNew};
    });
    if(!/alloc-line/.test(r.went))
      throw new Error('holding the scroll stopped Add Scheme reaching its line');
    if(!r.inNew) throw new Error('the cursor did not land in the new line');
    return 'the deliberate scroll still wins over the held position';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 220));
    return 'none';
  });
});
