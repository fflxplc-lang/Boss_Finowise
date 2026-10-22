/* EVERY DROPDOWN IN BOSS IS ONE YOU CAN TYPE INTO.

   The form builder's fields had already become type-and-pick. The
   dropdowns written by hand had not — a grid cell, a toolbar, a
   wizard step, a settings row — and the firm, looking at a dialog
   holding four of each, asked for the one field everywhere: "i want
   this field property to everywhere in boss system, where we need to
   search and select anything".

   So every <select> the page draws is painted into the same control
   where it stands. The bargain is that NOTHING ABOUT THE SELECT
   CHANGES: it keeps its id, its options, its value and its onchange,
   and is only moved into a wrapper and taken off the screen. Every
   reader of a form — readFields(), a conditional field, a handler
   written against the control, a test — goes on reading exactly what
   it read before.

   This suite holds both halves: that the box is there, and that the
   select behind it still answers. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();

  t.section('a hand-written dropdown is painted into the same field');

  await t.step('the box appears, and the select behind it keeps everything', async () => {
    const r = await t.eval(()=>{
      const host = document.getElementById('modalBody');
      host.innerHTML = `<select id="zzPlain" onchange="window._zzHeard = this.value">
        <option value="">Select…</option>
        <option value="a">Apple</option>
        <option value="b">Banana</option>
        <option value="c">Cherry</option></select>`;
      pickPaint(host, 'test');
      const sel = document.getElementById('zzPlain');
      const box = document.getElementById('pickbox_zzPlain');
      return {
        /* The select is still the select. */
        stillSelect: !!sel && sel.tagName === 'SELECT',
        keptOptions: sel ? sel.options.length : 0,
        keptHandler: !!(sel && sel.getAttribute('onchange')),
        /* And it is no longer what anybody looks at. */
        offScreen: !!sel && sel.classList.contains('pick-native'),
        /* A box, saying the one word the firm allows. */
        typed: !!box && box.placeholder === 'Search',
        rows: (window._pickRows['zzPlain'] || []).map(x=>x.label).join(','),
        list: !!document.getElementById('picklist_zzPlain')
      };
    });
    if(!r.stillSelect) throw new Error('the select was replaced rather than painted');
    if(r.keptOptions !== 4) throw new Error('it kept ' + r.keptOptions + ' options, not 4');
    if(!r.keptHandler) throw new Error('its onchange was dropped');
    if(!r.offScreen) throw new Error('the native dropdown is still on the screen');
    if(!r.typed) throw new Error('no box to type in, or it does not say Search');
    if(r.rows !== 'Apple,Banana,Cherry')
      throw new Error('the list underneath reads: ' + r.rows);
    if(!r.list) throw new Error('there is nowhere for the matches to appear');
    return 'the select kept its id, its four options and its onchange, and now answers through a box that says Search';
  });

  await t.step('typing narrows it, and choosing answers the select itself', async () => {
    const r = await t.eval(()=>{
      window._zzHeard = '';
      pickType('zzPlain', 'ban');
      const hits = Array.from(document.querySelectorAll('#picklist_zzPlain .pick-row'))
        .map(x=>x.textContent);
      pickTake('zzPlain', document.querySelector('#picklist_zzPlain .pick-row')
        .getAttribute('data-value'));
      const sel = document.getElementById('zzPlain');
      return {hits, value: sel.value, shows: document.getElementById('pickbox_zzPlain').value,
              heard: window._zzHeard, closed: !document.getElementById('picklist_zzPlain')
                .classList.contains('open')};
    });
    if(r.hits.join(',') !== 'Banana') throw new Error('typing "ban" offered: ' + r.hits.join(', '));
    if(r.value !== 'b') throw new Error('the select holds "' + r.value + '", not b');
    if(r.shows !== 'Banana') throw new Error('the box shows "' + r.shows + '"');
    if(r.heard !== 'b') throw new Error('the dropdown’s own onchange was never told: "' + r.heard + '"');
    if(!r.closed) throw new Error('the list stayed open after a choice');
    return 'typed "ban", took Banana, and the select’s own onchange heard "b" — exactly as a click on it would have';
  });

  await t.step('a value set by the page shows in the box', async () => {
    const r = await t.eval(()=>{
      const sel = document.getElementById('zzPlain');
      sel.value = 'c';
      sel.dispatchEvent(new Event('change', {bubbles:true}));
      return document.getElementById('pickbox_zzPlain').value;
    });
    if(r !== 'Cherry') throw new Error('the box shows "' + r + '" after the page set the value to c');
    return 'the page set it to c and the box caught up to Cherry, without anybody typing';
  });

  await t.step('a disabled dropdown stays disabled', async () => {
    const r = await t.eval(()=>{
      const host = document.getElementById('modalBody');
      host.innerHTML = `<select id="zzLocked" disabled>
        <option value="a">Apple</option></select>`;
      pickPaint(host, 'test');
      return !!(document.getElementById('pickbox_zzLocked') || {}).disabled;
    });
    if(!r) throw new Error('a locked dropdown was given a box anybody can type in');
    return 'locked where it was locked';
  });

  await t.step('a blank option that means something can be chosen back', async () => {
    const r = await t.eval(async ()=>{
      const host = document.getElementById('modalBody');
      host.innerHTML = `<select id="zzBlank" onchange="window._zzBlank = this.value">
        <option value="">Untagged</option>
        <option value="g1">Retirement</option></select>
        <select id="zzPrompt">
          <option value="">Select\u2026</option>
          <option value="a">Apple</option></select>`;
      pickPaint(host, 'test');
      const rows = (window._pickRows['zzBlank'] || []).map(x=>x.label);
      const prompt = (window._pickRows['zzPrompt'] || []).map(x=>x.label);
      const says = document.getElementById('pickbox_zzBlank').placeholder;
      const saysPrompt = document.getElementById('pickbox_zzPrompt').placeholder;
      /* Tag it, then put it back to Untagged from the list itself. */
      pickTake('zzBlank', 'g1');
      const tagged = document.getElementById('zzBlank').value;
      window._zzBlank = 'unset';
      pickTake('zzBlank', '');
      return {rows, prompt, says, saysPrompt, tagged,
              untagged: document.getElementById('zzBlank').value,
              heard: window._zzBlank,
              shows: document.getElementById('pickbox_zzBlank').value};
    });
    if(r.rows.join(',') !== 'Untagged,Retirement')
      throw new Error('the list offers: ' + r.rows.join(', '));
    if(r.prompt.join(',') !== 'Apple')
      throw new Error('"Select…" was offered as a choice: ' + r.prompt.join(', '));
    if(r.says !== 'Untagged') throw new Error('the box says "' + r.says + '", not what the blank option says');
    if(r.saysPrompt !== 'Search') throw new Error('a box whose blank is a prompt says "' + r.saysPrompt + '"');
    if(r.tagged !== 'g1') throw new Error('choosing a goal gave "' + r.tagged + '"');
    if(r.untagged !== '') throw new Error('choosing Untagged gave "' + r.untagged + '"');
    if(r.heard !== '') throw new Error('the control\u2019s own onchange heard "' + r.heard + '"');
    return 'Untagged is a row you can pick and the words the empty box shows; '
      + '"Select…" stays a prompt and is not offered as an answer';
  });

  await t.step('the box wears what the dropdown wore, so a styled page keeps its look', async () => {
    const r = await t.eval(()=>{
      const host = document.getElementById('modalBody');
      host.innerHTML = `<style>.zz-styled{border-radius:16px;padding:14px 16px}</style>
        <select id="zzDressed" class="zz-styled">
          <option value="" disabled selected>Select your life stage</option>
          <option value="a">Under 25</option></select>`;
      pickPaint(host, 'test');
      const box = document.getElementById('pickbox_zzDressed');
      const cs = getComputedStyle(box);
      return {cls: box.className, radius: cs.borderRadius, pad: cs.paddingLeft,
              says: box.placeholder,
              rows: (window._pickRows['zzDressed'] || []).map(x=>x.label)};
    });
    if(!/\bzz-styled\b/.test(r.cls)) throw new Error('the box did not take the control\u2019s class: ' + r.cls);
    if(!/pick-input/.test(r.cls)) throw new Error('the box lost its own class: ' + r.cls);
    if(r.radius !== '16px' || r.pad !== '16px')
      throw new Error('the page\u2019s own shape did not reach the box: ' + r.radius + ' / ' + r.pad);
    /* A prompt the author wrote and disabled is what the empty box
       says — better than "Search" on the first field a client meets. */
    if(r.says !== 'Select your life stage') throw new Error('the empty box says "' + r.says + '"');
    if(r.rows.join(',') !== 'Under 25')
      throw new Error('the disabled prompt was offered as an answer: ' + r.rows.join(', '));
    return 'the box is the page\u2019s box — its radius, its padding, its prompt — and the prompt is not an answer';
  });

  await t.step('and it reads as a dropdown, not as a search box', async () => {
    const r = await t.eval(()=>{
      const host = document.getElementById('modalBody');
      host.innerHTML = `<select id="zzCaret"><option value="a">Apple</option></select>`;
      pickPaint(host, 'test');
      const box = document.getElementById('pickbox_zzCaret');
      const css = getComputedStyle(box);
      return {img: css.backgroundImage, pad: parseInt(css.paddingRight, 10)};
    });
    if(!/svg/.test(r.img)) throw new Error('there is no chevron on the field: ' + r.img);
    if(!(r.pad >= 20)) throw new Error('the text runs under the chevron (padding ' + r.pad + 'px)');
    return 'a chevron on the right, and room kept for it';
  });

  await t.step('a grouped list keeps the group on the row', async () => {
    const r = await t.eval(()=>{
      const host = document.getElementById('modalBody');
      host.innerHTML = `<select id="zzGrouped">
        <option value="">Select…</option>
        <optgroup label="Leads (2)"><option value="l1">Asha</option></optgroup>
        <optgroup label="Clients (1)"><option value="c1">Asha Mehta</option></optgroup></select>`;
      pickPaint(host, 'test');
      pickType('zzGrouped', 'asha');
      const rows = Array.from(document.querySelectorAll('#picklist_zzGrouped .pick-row'))
        .map(x=>x.textContent);
      return {rows, notes: (window._pickRows['zzGrouped'] || []).map(x=>x.note)};
    });
    if(r.notes.join(',') !== 'Leads,Clients')
      throw new Error('the groups came through as: ' + r.notes.join(', '));
    if(!/Leads/.test(r.rows[0] || '') || !/Asha/.test(r.rows[0] || ''))
      throw new Error('the first row reads: ' + r.rows[0]);
    return 'two people called Asha, each row saying which list it came from';
  });

  await t.step('painting twice leaves one box, not two', async () => {
    const r = await t.eval(()=>{
      const host = document.getElementById('modalBody');
      host.innerHTML = `<select id="zzTwice"><option value="a">Apple</option></select>`;
      pickPaint(host, 'test'); pickPaint(host, 'test'); pickPaint(host, 'test');
      return {boxes: host.querySelectorAll('.pick-input').length,
              wraps: host.querySelectorAll('.pick').length};
    });
    if(r.boxes !== 1 || r.wraps !== 1)
      throw new Error('three paints left ' + r.boxes + ' boxes in ' + r.wraps + ' wrappers');
    return 'three paints, one field';
  });

  t.section('and the cursor still goes where a person can see it');

  await t.step('an unanswered dropdown is complained about in the box, not behind it', async () => {
    const r = await t.eval(()=>{
      const fields = [{k:'zzNeed', l:'Something', t:'select', req:true, opts:['A','B','C']}];
      openModal('ZZ Required', fields.map(f=>fieldInput(f, '')).join(''), '');
      const ok = validateRequired(fields, {zzNeed: ''});
      const active = document.activeElement;
      const out = {ok, id: active ? active.id : '', cls: active ? active.className : '',
                   marked: Array.from(document.querySelectorAll('.is-invalid')).map(x=>x.id)};
      closeModal();
      return out;
    });
    if(r.ok) throw new Error('an empty required dropdown passed validation');
    if(r.id !== 'pickbox_f_zzNeed')
      throw new Error('the cursor went to "' + r.id + '" (' + r.cls + '), not the box');
    return 'the cursor lands in the box the person types in, not on the control behind it';
  });

  await t.step('and a field marked wrong is marked where it shows', async () => {
    const r = await t.eval(()=>{
      openModal('ZZ Marked', fieldInput({k:'zzMark', l:'Something', t:'select',
        opts:['A','B','C']}, ''), '');
      showFieldError(document.getElementById('f_zzMark'), 'Pick one.');
      const out = {on: Array.from(document.querySelectorAll('.is-invalid')).map(x=>x.id),
                   note: (document.querySelector('.field-error') || {}).textContent || ''};
      closeModal();
      return out;
    });
    if(r.on.join(',') !== 'pickbox_f_zzMark')
      throw new Error('the red mark went on: ' + (r.on.join(', ') || 'nothing'));
    if(r.note !== 'Pick one.') throw new Error('the message under the field reads: "' + r.note + '"');
    return 'the red border is on the box, with the reason under the field';
  });

  t.section('and nowhere in the running system is one left behind');

  await t.step('no page draws a dropdown you cannot type into', async () => {
    const pages = ['dashboard','lms','cms','rms','dst','business','transactions',
                   'queries','projects','team','settings'];
    const left = [];
    for(const v of pages){
      await t.eval(x => { try { navigate(x); } catch(e){} }, v);
      await t.wait(200);
      const bare = await t.eval(()=>Array.from(document.querySelectorAll('select'))
        .filter(s=>!s.multiple && !s.classList.contains('pick-native'))
        .map(s=>s.id || s.getAttribute('onchange') || s.outerHTML.slice(0, 60)));
      bare.forEach(x=>left.push(v + ': ' + x));
    }
    if(left.length) throw new Error(left.slice(0, 6).join(' | '));
    return pages.length + ' pages, and every dropdown on them is one you can type into';
  });

  await t.step('nor does a dialog', async () => {
    await t.eval(()=>{ try { navigate('cms'); } catch(e){} });
    await t.wait(200);
    const r = await t.eval(()=>{
      openModal('ZZ Painted', fieldInput({k:'status', l:'Status', t:'select',
        opts:['A','B','C']}, '') + `<select id="zzInDialog" onchange="void 0">
          <option value="">Select…</option><option value="x">Ex</option></select>`, '');
      const bare = Array.from(document.querySelectorAll('#modalBody select'))
        .filter(s=>!s.multiple && !s.classList.contains('pick-native')).length;
      const boxes = document.querySelectorAll('#modalBody .pick-input').length;
      closeModal();
      return {bare, boxes};
    });
    if(r.bare) throw new Error(r.bare + ' dropdown(s) in the dialog were left bare');
    if(r.boxes !== 2) throw new Error('the dialog drew ' + r.boxes + ' boxes, not 2');
    return 'a dialog holding a built field and a hand-written one: both of them boxes you type into';
  });

  await t.step('a panel the page redraws on its own is caught too', async () => {
    const r = await t.eval(async ()=>{
      const host = document.getElementById('root');
      const own = document.createElement('div');
      own.innerHTML = `<select id="zzLate"><option value="z">Zed</option></select>`;
      host.appendChild(own);
      /* Nothing called a painter: this is the net, not the painters. */
      await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
      const sel = document.getElementById('zzLate');
      const out = {painted: !!sel && sel.classList.contains('pick-native'),
                   box: !!document.getElementById('pickbox_zzLate')};
      own.remove();
      return out;
    });
    if(!r.painted || !r.box)
      throw new Error('a dropdown added outside a render was left bare');
    return 'added straight to the page by something that calls no painter, and painted anyway';
  });

  await t.step('nothing was alerted but the complaint this suite asked for', async () => {
    const odd = t.dialogs.filter(x=>!/^Please fill: Something/.test(String(x)));
    if(odd.length) throw new Error('alerts: ' + odd.join(' | ').slice(0, 220));
    return t.dialogs.length + ' pop-up(s), the one this suite provoked on purpose';
  });
});
