/* A DROPDOWN THAT IS NOT CLIPPED BY WHAT IT IS INSIDE.

   Every searchable field in BOSS is the same control, and its list
   was positioned against the box it belongs to. That is right until
   the box sits inside something that scrolls — and a dialog's body
   does: .modal-body is capped at 70vh with overflow-y:auto, so the
   list of the last field on a long form was cut off at that edge and
   what was left of it sat behind Cancel and Save.

   The firm met it on Add New Lead, at OE Name, which is the last
   field on that form. Nothing about it was particular to that form,
   so the fix is not either: an open list is fixed to the viewport and
   placed against its own box, above everything it used to be inside.

   What is guarded here: that the list is readable where it used to be
   clipped, that it goes back to where it belongs when it closes, and
   that it still picks — a dropdown that floats and does not choose
   anything would be a worse bug than the one being fixed. */
const {suite} = require('../lib/harness');

/* The last picker on the form, which is the one that was clipped. */
const OPEN_LAST = `function(){
  openLeadForm();
  const boxes = Array.from(document.querySelectorAll('.modal-body .pick .pick-input'));
  const input = boxes[boxes.length - 1];
  if(!input) return null;
  input.scrollIntoView({block:'end'});
  const id = String(input.id || '').replace(/^pickbox_/, '');
  pickType(id, '', true);
  return id;
}`;

suite(async t => {
  await t.home();

  t.section('the field the firm reported');

  await t.step('the last picker on Add New Lead opens where it can be read', async () => {
    const r = await t.eval(new Function(`return (function(){
      const id = (${OPEN_LAST})();
      if(!id) return {none:true};
      const list = document.getElementById('picklist_' + id);
      const body = document.querySelector('.modal-body');
      const lr = list.getBoundingClientRect();
      const br = body.getBoundingClientRect();
      const st = getComputedStyle(list);
      return {id, rows: list.querySelectorAll('.pick-row, .pick-more').length,
              position: st.position, z: Number(st.zIndex) || 0,
              /* How much of the list the dialog's own scroll box would
                 have cut off, had the list still been inside it. */
              clippedBelow: Math.max(0, Math.round(lr.bottom - br.bottom)),
              offScreen: Math.max(0, Math.round(lr.bottom - window.innerHeight)),
              height: Math.round(lr.height), width: Math.round(lr.width),
              /* Nothing hidden inside the list either: a short list is
                 drawn whole, a long one scrolls on its own. */
              hidden: Math.max(0, list.scrollHeight - list.clientHeight),
              cap: Math.round(parseFloat(st.maxHeight) || 0),
              boxWidth: Math.round(document.getElementById('pickbox_' + id).getBoundingClientRect().width)};
    })()`));
    if(r.none) throw new Error('the form drew no searchable field at all');
    if(!r.rows) throw new Error('the list opened empty, so there is nothing to see clipped or not');
    if(r.position !== 'fixed')
      throw new Error('the list is still positioned "' + r.position + '", so its container can clip it');
    if(r.z < 1000) throw new Error('the list sits at z-index ' + r.z + ', under the dialog it has to clear');
    if(r.offScreen) throw new Error(r.offScreen + 'px of the list is off the bottom of the screen');
    if(r.hidden && r.height < r.cap - 1)
      throw new Error(r.hidden + 'px of the list is cut off while it is only ' + r.height
        + 'px of the ' + r.cap + 'px it is allowed');
    if(Math.abs(r.width - r.boxWidth) > 2)
      throw new Error('the list is ' + r.width + 'px against a ' + r.boxWidth + 'px box');
    return r.rows + ' row(s), fixed at z-index ' + r.z + ', ' + r.height + 'px tall and fully on screen'
      + (r.clippedBelow ? ' — ' + r.clippedBelow + 'px of it below the dialog’s own scroll box, which no longer clips it' : '');
  });

  await t.step('and it still chooses, which is the point of it', async () => {
    const r = await t.eval(()=>{
      const list = document.querySelector('.pick-list.open');
      const id = String(list.id || '').replace(/^picklist_/, '');
      const row = list.querySelector('.pick-row');
      const want = row ? row.dataset.value : '';
      const label = row ? (row.textContent || '').trim() : '';
      if(row) pickTake(id, want);
      const hidden = document.getElementById(id);
      const input = document.getElementById('pickbox_' + id);
      const after = document.getElementById('picklist_' + id);
      return {want, label, held: hidden ? hidden.value : '', shown: input ? input.value : '',
              open: after ? after.classList.contains('open') : false,
              style: after ? (after.getAttribute('style') || '') : '(gone)'};
    });
    if(!r.want) throw new Error('there was no row to pick');
    if(r.held !== r.want) throw new Error('the field holds "' + r.held + '", not what was picked');
    if(!r.shown) throw new Error('the box shows nothing after a pick');
    if(r.open) throw new Error('the list stayed open after a pick');
    if(r.style) throw new Error('closing left the placing behind: ' + r.style);
    return 'picked “' + r.label + '”, the field holds it, and the list closed with its placing put back';
  });

  t.section('wherever the box happens to be');

  await t.step('a box near the foot of the screen opens upwards', async () => {
    const r = await t.eval(()=>{
      closeModal();
      /* A box put where there is no room below it — the case the
         dialog's last field is really an instance of. */
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:40px;bottom:6px;width:260px;z-index:60';
      host.innerHTML = pickFieldHtml('zzFloat',
        [1,2,3,4,5,6,7,8].map(n=>({value:'v'+n, label:'ZZ Option ' + n})), '', 'Search', 'options');
      document.body.appendChild(host);
      pickType('zzFloat', '', true);
      const input = document.getElementById('pickbox_zzFloat');
      const list = document.getElementById('picklist_zzFloat');
      const ir = input.getBoundingClientRect(), lr = list.getBoundingClientRect();
      const out = {above: lr.bottom <= ir.top + 1, offScreen: Math.max(0, Math.round(lr.bottom - window.innerHeight)),
                   top: Math.round(lr.top), height: Math.round(lr.height)};
      pickClose('zzFloat'); host.remove();
      return out;
    });
    if(r.offScreen) throw new Error(r.offScreen + 'px of the list is off the bottom of the screen');
    if(!r.above) throw new Error('the list opened downwards off a box at the foot of the screen');
    if(r.top < 0) throw new Error('it opened upwards past the top of the screen');
    return 'it flips above the box, ' + r.height + 'px of it, all of it on screen';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
