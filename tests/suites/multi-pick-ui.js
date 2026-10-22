/* A FIELD THAT TAKES A LIST, LAID OUT LIKE ONE.

   Departments and reporting managers were drawn as a bordered column of
   tick boxes sitting in one cell of the form grid. A grid row is as
   tall as its tallest cell, so a 170px box in one column left the other
   three empty beside it — the Professional Information panel had a
   crater under Designation and another under Employment Type, and four
   lines of explanation under each box pushed Official Mobile and Status
   off the bottom of the dialog.

   So a field that takes a list gets the width of the row, and spends it
   sideways: the options are chips that wrap, picked ones tinted, and
   along the bottom of the box a line saying what that amounts to and a
   way to clear it. A long list gets something to narrow it with; a
   short one does not, because an empty box with a search in it reads as
   broken. Narrowing never hides something already picked — what is on
   the record has to stay within reach of being taken off it.

   For managers the order is the point: the first picked is the line the
   org chart draws and the "their team" scope walks, so that chip says
   so, and says it again the moment the picks change. */
const {suite} = require('../lib/harness');

const SEED = async ()=>{
  DB.config.departments = [
    {id:'DEP-Z1', name:'ZZ Sales and IT', active:true},
    {id:'DEP-Z2', name:'ZZ Operations', active:true},
    {id:'DEP-Z3', name:'ZZ Admin', active:true}];
  await save('config');
  for(let i = 0; i < 12; i++){
    const id = 'USR-ZZ' + i;
    if(DB.team.some(t=>t.id === id)) continue;
    DB.team.push({id, name:'ZZ Manager ' + i, email:'zz' + i + '@example.com',
      role:defaultRole(), status:'Active', branch:'Varanasi',
      documents:[], notes:[], employeeId:'EMPZ' + i});
  }
  const who = DB.team.find(t=>t.id === 'USR-ZZTARGET') || {id:'USR-ZZTARGET'};
  Object.assign(who, {name:'ZZ Divya Shinde', email:'zz.divya@example.com', role:defaultRole(),
    status:'Active', branch:'Varanasi', documents:[], notes:[], employeeId:'EMPZ99',
    perms:{}, adminFlags:{}, pagePerms:[],
    departments:['DEP-Z1'], managerIds:['USR-ZZ1']});
  if(!DB.team.some(t=>t.id === 'USR-ZZTARGET')) DB.team.push(who);
  await save('team');
  openSubUser('USR-ZZTARGET');
  return true;
};

suite(async t => {

  t.section('the shape of the panel');

  await t.step('a list field takes the whole row; the plain ones do not', async () => {
    await t.eval(SEED);
    await t.wait(400);
    const r = await t.eval(()=>{
      const wide = k => {
        const el = document.getElementById('fieldwrap_f_' + k);
        return el ? el.classList.contains('field-wide') : null;
      };
      const grid = document.getElementById('fieldwrap_f_departments').parentElement;
      return {departments: wide('departments'), managers: wide('managerIds'),
              designation: wide('designation'), branch: wide('branch'),
              align: getComputedStyle(grid).alignItems,
              span: getComputedStyle(document.getElementById('fieldwrap_f_departments')).gridColumnStart};
    });
    if(!r.departments || !r.managers) throw new Error('a list field is still boxed into one column');
    if(r.designation || r.branch) throw new Error('an ordinary field was widened too');
    if(r.align !== 'start') throw new Error('the grid still stretches its rows: ' + r.align);
    return 'both list fields span the row; Designation and Branch keep their column';
  });

  await t.step('the long list gets a search, the short one does not', async () => {
    const r = await t.eval(()=>({
      managers: !!document.querySelector('#f_managerIds_box .mpick-find'),
      departments: !!document.querySelector('#f_departments_box .mpick-find'),
      deptCount: document.querySelectorAll('#f_departments_box .mpick-chip').length,
    }));
    if(!r.managers) throw new Error('a list of a dozen people has nothing to narrow it with');
    if(r.departments) throw new Error('three departments were given a search box');
    if(r.deptCount !== 3) throw new Error('the departments box holds ' + r.deptCount + ' chips');
    return 'the managers box has one, the three-department box does not';
  });

  t.section('picking');

  await t.step('a tick tints its chip and lands in the value, in order', async () => {
    const r = await t.eval(()=>{
      const chip = v => document.querySelector('#f_departments_box .mpick-chip[data-v="' + v + '"]');
      chip('DEP-Z3').querySelector('input').click();
      chip('DEP-Z2').querySelector('input').click();
      return {value: document.getElementById('f_departments').value,
              on: [...document.querySelectorAll('#f_departments_box .mpick-chip.on')]
                    .map(c=>c.getAttribute('data-v')),
              note: document.getElementById('f_departments_note').textContent};
    });
    if(r.value !== 'DEP-Z1,DEP-Z3,DEP-Z2')
      throw new Error('the value reads ' + r.value + ' — the order of picking was not kept');
    if(r.on.length !== 3) throw new Error('only ' + r.on.length + ' chips read as picked');
    if(r.note !== '3 of 3 departments.') throw new Error('the line underneath says "' + r.note + '"');
    return 'three chips tinted, value "' + r.value + '", "' + r.note + '"';
  });

  await t.step('the first manager picked is the primary, and says so', async () => {
    const r = await t.eval(()=>{
      const box = document.getElementById('f_managerIds_box');
      const chip = v => box.querySelector('.mpick-chip[data-v="' + v + '"]');
      const tagOn = v => { const tg = chip(v).querySelector('.mpick-tag');
        return tg && tg.style.display !== 'none'; };
      chip('USR-ZZ4').querySelector('input').click();          // a second one
      const after2 = {first: tagOn('USR-ZZ1'), second: tagOn('USR-ZZ4'),
                      note: document.getElementById('f_managerIds_note').textContent};
      chip('USR-ZZ1').querySelector('input').click();          // drop the primary
      const after1 = {first: tagOn('USR-ZZ1'), second: tagOn('USR-ZZ4'),
                      value: document.getElementById('f_managerIds').value,
                      note: document.getElementById('f_managerIds_note').textContent};
      return {after2, after1};
    });
    if(!r.after2.first || r.after2.second)
      throw new Error('the primary mark is on the wrong chip');
    if(!/^Primary: ZZ Manager 1 — also reports to ZZ Manager 4\.$/.test(r.after2.note))
      throw new Error('the line underneath says "' + r.after2.note + '"');
    if(r.after1.first) throw new Error('a chip that was unticked kept the primary mark');
    if(r.after1.value !== 'USR-ZZ4') throw new Error('the value reads ' + r.after1.value);
    if(r.after1.note !== 'Reports to ZZ Manager 4.')
      throw new Error('and the line says "' + r.after1.note + '"');
    return 'the mark follows the first pick, and moves the moment it is dropped';
  });

  await t.step('Clear empties it, boxes and all', async () => {
    const r = await t.eval(()=>{
      document.getElementById('f_departments_clear').click();
      return {value: document.getElementById('f_departments').value,
              ticked: document.querySelectorAll('#f_departments_box .mpick-chip input:checked').length,
              on: document.querySelectorAll('#f_departments_box .mpick-chip.on').length,
              note: document.getElementById('f_departments_note').textContent,
              hidden: document.getElementById('f_departments_clear').style.display};
    });
    if(r.value || r.ticked || r.on)
      throw new Error('something survived: value "' + r.value + '", ' + r.ticked + ' ticked, ' + r.on + ' tinted');
    if(r.note !== 'None picked yet.') throw new Error('the line says "' + r.note + '"');
    if(r.hidden !== 'none') throw new Error('Clear is still offered with nothing to clear');
    return 'empty, and Clear takes itself away';
  });

  t.section('narrowing a long list');

  await t.step('the search hides what does not match, never what is picked', async () => {
    const r = await t.eval(()=>{
      const box = document.getElementById('f_managerIds_box');
      const find = box.querySelector('.mpick-find');
      find.value = 'manager 7'; find.dispatchEvent(new Event('input'));
      const shown = [...box.querySelectorAll('.mpick-chip')]
        .filter(c=>!c.classList.contains('off')).map(c=>c.getAttribute('data-v'));
      find.value = 'nobody at all'; find.dispatchEvent(new Event('input'));
      const none = {empty: document.getElementById('f_managerIds_empty').style.display,
                    still: [...box.querySelectorAll('.mpick-chip')]
                      .filter(c=>!c.classList.contains('off')).map(c=>c.getAttribute('data-v'))};
      find.value = ''; find.dispatchEvent(new Event('input'));
      const back = box.querySelectorAll('.mpick-chip:not(.off)').length;
      return {shown, none, back, all: box.querySelectorAll('.mpick-chip').length};
    });
    if(r.shown.indexOf('USR-ZZ7') < 0) throw new Error('the one that matches was hidden');
    if(r.shown.indexOf('USR-ZZ4') < 0)
      throw new Error('a picked manager was hidden by a search that did not match them');
    if(r.shown.length !== 2) throw new Error('it left ' + r.shown.length + ' chips showing');
    if(r.none.still.length !== 1 || r.none.still[0] !== 'USR-ZZ4')
      throw new Error('a search matching nothing should still leave the picked one');
    if(r.back !== r.all) throw new Error('clearing the search did not bring them all back');
    return 'two for "manager 7" — the match and the one already picked — and all ' + r.all + ' back after';
  });

  t.section('and it still saves');

  await t.step('what the chips say is what the record gets', async () => {
    const r = await t.eval(async ()=>{
      const box = document.getElementById('f_departments_box');
      box.querySelector('.mpick-chip[data-v="DEP-Z2"] input').click();
      box.querySelector('.mpick-chip[data-v="DEP-Z1"] input').click();
      await saveSubUser();
      const u = DB.team.find(t=>t.id === 'USR-ZZTARGET');
      return {departments: userDepartments(u), managers: userManagerIds(u),
              names: userDepartmentNames(u)};
    });
    if(r.departments.join(',') !== 'DEP-Z2,DEP-Z1')
      throw new Error('the record holds ' + r.departments.join(', '));
    if(r.managers.join(',') !== 'USR-ZZ4')
      throw new Error('the reporting managers read ' + r.managers.join(', '));
    return 'saved as picked: ' + r.names.join(' + ') + ', reporting to ZZ Manager 4';
  });

  await t.step('somebody who may not map people sees it and cannot touch it', async () => {
    const r = await t.eval(()=>{
      const f = {k:'departments', l:'Departments', t:'multidept', readOnly:true};
      const html = multiPickHtml(f, 'DEP-Z2,DEP-Z1');
      return {html, ticks: /type="checkbox"/.test(html),
              chips: (html.match(/mpick-chip read/g) || []).length,
              carries: /value="DEP-Z2,DEP-Z1"/.test(html),
              clear: html.indexOf('multiPickClear') >= 0};
    });
    if(r.ticks) throw new Error('they were given tick boxes');
    if(r.chips !== 2) throw new Error('they were shown ' + r.chips + ' chips rather than 2');
    if(!r.carries) throw new Error('the hidden input lost the value, so their save would clear it');
    if(r.clear) throw new Error('and they were offered a way to clear it');
    return 'two read-only chips, the value still carried, nothing to press';
  });

  await t.step('nothing was alerted but the save saying it saved', async () => {
    const stray = t.dialogs.filter(d=>!/^Saved\./.test(String(d).trim()));
    if(stray.length) throw new Error('alerts: ' + stray.join(' | ').slice(0, 200));
    return t.dialogs.length ? 'only the save confirmation' : 'none';
  });
});
