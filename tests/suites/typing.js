/* TYPING, AND DATES.

   The other half of the 6 October note: fields that "behave as if they are
   processing one character at a time", a cursor that jumps, a calendar that
   closes after one input and has to be reopened.

   There is no custom date picker in this system — every date is a native
   <input type="date">, which the browser owns — so what can actually go
   wrong is the page redrawing under the person while they are typing. That
   is what this measures, on a real internal form and a real client form:

     * every character arrives, in order;
     * focus is still on the same element afterwards;
     * the caret is where the typing left it;
     * a redraw provoked mid-typing keeps the field, its value and the caret.
*/
const {suite} = require('../lib/harness');

const LONG = 'Rajeshwari Venkataraman';

suite(async t => {
  /* Types character by character, the way a person does, and reports what
     the field and the document think afterwards. */
  const typeInto = async (sel, text) => {
    await t.page.click(sel);
    await t.eval(s => { const el = document.querySelector(s); if(el) el.value = ''; }, sel);
    for(const ch of text) await t.page.type(sel, ch, {delay: 15});
    return await t.eval(s => {
      const el = document.querySelector(s);
      return {value: el ? el.value : null,
              focused: document.activeElement === el,
              caret: el && el.selectionStart !== undefined ? el.selectionStart : -1,
              active: document.activeElement
                ? (document.activeElement.id || document.activeElement.tagName) : null};
    }, sel);
  };

  t.section('an internal form');

  await t.step('a lead’s name takes every character, and keeps the caret', async () => {
    await t.eval(()=>openLeadForm());
    await t.wait(500);
    const r = await typeInto('#f_firstName', LONG);
    if(r.value !== LONG) throw new Error('the field reads "' + r.value + '"');
    if(!r.focused) throw new Error('focus moved to ' + r.active + ' while typing');
    if(r.caret !== LONG.length) throw new Error('the caret jumped to ' + r.caret);
    return LONG.length + ' characters, caret at the end';
  });

  await t.step('a redraw mid-typing keeps the field, the value and the caret', async () => {
    await t.page.click('#f_firstName');
    await t.eval(()=>document.getElementById('f_firstName').setSelectionRange(5, 5));
    const before = await t.eval(()=>{
      const el = document.getElementById('f_firstName');
      return {v: el.value, caret: el.selectionStart};
    });
    await t.eval(()=>{ if(typeof render === 'function') render(); });
    await t.wait(300);
    const after = await t.eval(()=>{
      const el = document.getElementById('f_firstName');
      if(!el) return {gone: true};
      return {v: el.value, caret: el.selectionStart, focused: document.activeElement === el};
    });
    if(after.gone) throw new Error('the field disappeared on the redraw');
    if(after.v !== before.v) throw new Error('the value changed from "' + before.v + '" to "' + after.v + '"');
    if(!after.focused) throw new Error('focus was lost on the redraw');
    if(after.caret !== before.caret) throw new Error('the caret moved from ' + before.caret + ' to ' + after.caret);
    return 'value and caret survived a full redraw';
  });

  t.section('a client’s own form');

  await t.step('it types just as fluently', async () => {
    const token = await t.eval(async ()=>{
      const c = {id:uid('CMS'), cmsName:'ZZ Typing Client', rmName:currentUser,
        createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('CMS', c); DB.clients.push(c); await save('clients');
      return await createDocLink(null, 'CIF', {recordModule:'CMS', recordId:c.id});
    });
    await t.doc(token, 1300);
    const sel = await t.eval(()=>{
      const el = document.querySelector('#publicDocBody input[type=text]');
      return el ? '#' + el.id : null;
    });
    if(!sel) throw new Error('the client form drew no text field');
    const r = await typeInto(sel, LONG);
    if(r.value !== LONG) throw new Error('the field reads "' + r.value + '"');
    if(!r.focused) throw new Error('focus moved to ' + r.active + ' while typing');
    if(r.caret !== LONG.length) throw new Error('the caret jumped to ' + r.caret);
    return sel + ' took ' + r.value.length + ' characters';
  });

  await t.step('a date holds its value, its focus, and a redraw', async () => {
    const sel = await t.eval(()=>{
      const el = document.querySelector('#publicDocBody input[type=date]');
      return el ? '#' + el.id : null;
    });
    if(!sel) throw new Error('the client form drew no date field to check');
    await t.page.fill(sel, '1985-07-19');
    await t.wait(150);
    const r = await t.eval(s => {
      const el = document.querySelector(s); el.focus();
      return {value: el.value, focused: document.activeElement === el, type: el.type};
    }, sel);
    if(r.type !== 'date') throw new Error('it is not a native date input but a ' + r.type);
    if(r.value !== '1985-07-19') throw new Error('the date reads "' + r.value + '"');
    if(!r.focused) throw new Error('the field cannot hold focus');
    await t.eval(()=>{ if(typeof refreshRenderedForm === 'function') refreshRenderedForm(); });
    await t.wait(350);
    const after = await t.eval(s => { const el = document.querySelector(s); return el ? el.value : null; }, sel);
    if(after !== '1985-07-19') throw new Error('the redraw cleared it to "' + after + '"');
    return sel + ' — native, held through a redraw';
  });
});
