/* ONE FIELD: TYPE THE NAME, PICK FROM WHAT MATCHES.

   A dropdown of two thousand clients is a dropdown nobody can use.
   The first attempt put a search box above the select, which worked
   and was wrong: two controls for one answer, one of them reading
   "Select…" while the other held the name just typed. The firm said
   so plainly — "Dont want 2 seperate fields".

   So it types like a text box and answers like a dropdown. What
   matches appears underneath; a click, or Enter on the row the arrow
   keys have landed on, takes it.

   The bargain is that nothing else changed. The id every reader uses
   — f_<key> — is on a hidden input holding the chosen id, so
   readFields() reads it unchanged, conditional fields key off it
   unchanged, and a form or a test that sets it directly still works.

   Short lists used to stay ordinary selects. The firm asked for that
   undone — one field everywhere — so a four-option list types too,
   and every hand-written dropdown in the system is painted into the
   same control. That part is proved in every-dropdown-types.js. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();

  t.section('one field, not two');

  await t.step('a record picker types however few records there are', async () => {
    const r = await t.eval(async ()=>{
      /* The shape a firm actually has early on: hundreds of clients
         and a handful of leads. Both name a person; both must look
         the same, and neither may change shape as the other grows. */
      DB.leads = DB.leads.filter(l=>!/^ZZ Few/.test(l.firstName || ''));
      for(let i = 0; i < 3; i++)
        DB.leads.push({id: uid('LMS'), firstName:'ZZ Few', lastName:'Lead ' + i,
          createdAt:new Date().toISOString()});
      await save('leads');
      const n = DB.leads.filter(l=>!l.deletedAt).length;
      const lead = fieldInput({k:'leadId', l:'Lead', t:'leadselect'}, '');
      const client = fieldInput({k:'clientId', l:'Client', t:'clientselect'}, '');
      /* A four-option vocabulary used to keep a plain dropdown. The
         firm asked for one field everywhere, so it types too. */
      const status = fieldInput({k:'status', l:'Status', t:'select', opts:['A','B','C','D']}, '');
      return {n,
              leadTypes: lead.indexOf('pick-input') >= 0,
              clientTypes: client.indexOf('pick-input') >= 0,
              statusTypes: status.indexOf('pick-input') >= 0,
              statusHolds: /<input type="hidden" id="f_status"/.test(status)};
    });
    if(r.n >= 8)
      throw new Error('the fixture left ' + r.n + ' leads, too many to prove anything about a short list');
    if(!r.leadTypes)
      throw new Error('with only ' + r.n + ' leads the Lead field is still a plain dropdown');
    if(!r.clientTypes) throw new Error('the Client field stopped typing');
    if(!r.statusTypes) throw new Error('a four-option vocabulary is still a plain dropdown');
    if(!r.statusHolds) throw new Error('the four-option field lost the id every reader uses');
    return r.n + ' leads and it types, exactly like Client \u2014 and so does a four-option Status';
  });

  await t.step('long or short, the field is one box you type into', async () => {
    const r = await t.eval(async ()=>{
      DB.clients = DB.clients.filter(c=>!/^ZZ Pick/.test(c.cmsName || ''));
      ['Anand Rao','Chanandler Bong','Gizel Dsouza','Bhavna Shah','Chetan Mehta',
       'Deepa Nair','Eshan Kapoor','Farah Khan','Gopal Reddy','Hina Patel',
       'Irfan Sheikh','Janvi Desai'].forEach(nm=>{
        DB.clients.push({id: uid('CMS'), cmsName:'ZZ Pick ' + nm, status:'Active',
          createdAt:new Date().toISOString()});
      });
      await save('clients');
      const long = fieldInput({k:'clientId', l:'Client', t:'clientselect'}, '');
      const short = fieldInput({k:'status', l:'Status', t:'select', opts:['A','B','C','D']}, '');
      const one = h => ({oneBox: (h.match(/<input type="text"/g) || []).length,
                         noSelect: h.indexOf('<select') < 0,
                         saysSearch: /placeholder="Search"/.test(h)});
      return {long: one(long), short: one(short),
              hidden: /<input type="hidden" id="f_clientId"/.test(long),
              list: long.indexOf('picklist_f_clientId') >= 0,
              shortList: short.indexOf('picklist_f_status') >= 0};
    });
    [['a 400-record picker', r.long], ['a four-option list', r.short]].forEach(([what, x])=>{
      if(x.oneBox !== 1) throw new Error(what + ' has ' + x.oneBox + ' text boxes, not one');
      if(!x.noSelect) throw new Error(what + ' still has a select beside the box');
      if(!x.saysSearch) throw new Error(what + ' calls itself something other than Search');
    });
    if(!r.hidden) throw new Error('the id every reader uses is gone');
    if(!r.list || !r.shortList) throw new Error('there is nowhere for the matches to appear');
    return 'one box with its matches underneath \u2014 the same field for four options and for four hundred';
  });

  t.section('typing, and what comes back');

  await t.step('what matches appears, best first, and clicking it answers the field', async () => {
    const r = await t.eval(()=>{
      document.getElementById('modalBody').innerHTML =
        fieldInput({k:'clientId', l:'Client', t:'clientselect'}, '');
      const box = document.getElementById('picklist_f_clientId');
      const input = document.getElementById('pickbox_f_clientId');
      const hidden = document.getElementById('f_clientId');
      pickType('f_clientId', 'gizel');
      const rows = Array.from(box.querySelectorAll('.pick-row')).map(x=>x.textContent);
      const one = box.querySelector('.pick-row');
      pickTake('f_clientId', one.getAttribute('data-value'));
      /* Read before typing again: typing over a chosen name
         deliberately un-chooses it, which the next step is about. */
      const took = {value: hidden.value, shows: input.value,
                    closed: !box.classList.contains('open')};
      const picked = DB.clients.find(c=>c.id === took.value);
      /* "Chanandler" only contains what was typed; "Anand" starts
         with it, so Anand is offered first. */
      pickType('f_clientId', 'zz pick an');
      const order = Array.from(box.querySelectorAll('.pick-row')).map(x=>x.textContent);
      return {hits: rows.length, said: rows[0] || '',
              value: took.value, shows: took.shows, closed: took.closed,
              name: picked ? picked.cmsName : '',
              order: order.slice(0, 2)};
    });
    if(r.hits !== 1) throw new Error('"gizel" matched ' + r.hits + ' rows');
    if(!/Gizel/.test(r.said)) throw new Error('it offered "' + r.said + '"');
    if(!r.value) throw new Error('clicking the row did not answer the field');
    if(r.name !== r.shows) throw new Error('the box shows "' + r.shows + '" but holds ' + r.name);
    if(!r.closed) throw new Error('the list stayed open after a pick');
    if(!/Anand/.test(r.order[0] || ''))
      throw new Error('a name it starts was not offered first: ' + r.order.join(', '));
    return 'matches appear, the one it starts comes first, a click fills the box and holds the id';
  });

  await t.step('the arrow keys and Enter pick without the mouse', async () => {
    const r = await t.eval(()=>{
      document.getElementById('modalBody').innerHTML =
        fieldInput({k:'clientId', l:'Client', t:'clientselect'}, '');
      const hidden = document.getElementById('f_clientId');
      pickType('f_clientId', 'zz pick');
      /* The rows on screen are the filtered ones, not the whole master. */
      const shown = Array.from(document.querySelectorAll('#picklist_f_clientId .pick-row'))
        .map(x=>({value: x.getAttribute('data-value'), label: x.textContent}));
      const key = k => pickKey({key:k, preventDefault(){}}, 'f_clientId');
      key('ArrowDown'); key('ArrowDown'); key('Enter');
      const row = shown[1];
      return {took: hidden.value, expected: row ? row.value : '', label: row ? row.label : ''};
    });
    if(!r.took) throw new Error('Enter picked nothing');
    if(r.took !== r.expected) throw new Error('two downs and Enter took the wrong row');
    return 'two downs and Enter took ' + r.label;
  });

  await t.step('it never holds one client while showing another', async () => {
    const r = await t.eval(async ()=>{
      const c = DB.clients.find(x=>/^ZZ Pick Gizel/.test(x.cmsName || ''));
      document.getElementById('modalBody').innerHTML =
        fieldInput({k:'clientId', l:'Client', t:'clientselect'}, c.id);
      const hidden = document.getElementById('f_clientId');
      const input = document.getElementById('pickbox_f_clientId');
      const openedWith = {value: hidden.value, shows: input.value};
      /* Typing over the chosen name must un-choose it. */
      input.value = 'ZZ Pick Giz';
      pickType('f_clientId', input.value);
      const whileTyping = hidden.value;
      /* Left with text that names nothing, the box empties rather
         than sitting there looking answered. */
      input.value = 'not a client at all';
      pickType('f_clientId', input.value);
      pickBlur('f_clientId');
      await new Promise(r=>setTimeout(r, 260));
      return {openedWith, whileTyping, after: input.value, held: hidden.value,
              name: c.cmsName};
    });
    if(r.openedWith.shows !== r.name)
      throw new Error('it opened showing "' + r.openedWith.shows + '" for ' + r.name);
    if(!r.openedWith.value) throw new Error('it opened holding nothing');
    if(r.whileTyping) throw new Error('typing over the name left the old client held underneath');
    if(r.after) throw new Error('text naming no record was left in the box: "' + r.after + '"');
    if(r.held) throw new Error('it still holds a client it is not showing');
    return 'opens on the chosen name, un-chooses as you type over it, clears what names nothing';
  });

  t.section('every form that reads a picker still reads it');

  await t.step('readFields, conditionals and a directly-set value all work', async () => {
    const r = await t.eval(()=>{
      const c = DB.clients.find(x=>/^ZZ Pick Anand/.test(x.cmsName || ''));
      const fields = [{k:'clientId', l:'Client', t:'clientselect'},
                      {k:'amount', l:'Amount', t:'text'}];
      document.getElementById('modalBody').innerHTML = fields.map(f=>fieldInput(f, '')).join('');
      /* A form, or a test, that sets the id straight onto the field. */
      document.getElementById('f_clientId').value = c.id;
      document.getElementById('f_amount').value = '500000';
      const read = readFields(fields);
      return {client: read.clientId === c.id, amount: read.amount === '500000',
              wrap: !!document.getElementById('fieldwrap_f_clientId')};
    });
    if(!r.client) throw new Error('readFields no longer sees the picker');
    if(!r.amount) throw new Error('the field beside it stopped reading');
    if(!r.wrap) throw new Error('the wrapper conditional fields key off is gone');
    return 'readFields reads it, the wrapper is intact, and a directly-set id still takes';
  });

  await t.step('every picker across the system is the same one field', async () => {
    const r = await t.eval(async ()=>{
      const bulk = (n, make) => { for(let i = 0; i < n; i++) make(i); };
      bulk(12, i=>DB.leads.push({id: uid('LMS'), firstName:'ZZ Lead', lastName:'' + i,
        createdAt:new Date().toISOString()}));
      bulk(12, i=>DB.amcs.push({id: uid('AMC'), name:'ZZ AMC ' + i, status:'Active'}));
      bulk(12, i=>DB.schemes.push({id: uid('SCH'), schemeName:'ZZ Scheme ' + i, amcId:''}));
      bulk(12, i=>DB.partners.push({id: uid('PTR'), name:'ZZ Partner ' + i}));
      bulk(12, i=>DB.projects.push({id: uid('PRJ'), name:'ZZ Project ' + i}));
      bulk(12, i=>DB.team.push({id: uid('TM'), name:'ZZ Member ' + i, status:'Active',
        role: roleList()[2] || 'Executive', scope:'own',
        adminFlags: fullAdminFlags(false), perms: fullPerms(true),
        createdAt:new Date().toISOString()}));
      await save('leads'); await save('amcs'); await save('schemes');
      await save('partners'); await save('projects'); await save('team');
      const kinds = ['clientselect','leadselect','amcselect','schemeselect',
                     'partnerselect','projectselect','team'];
      const bad = kinds.filter(tp=>{
        const html = fieldInput({k:'x_' + tp, l:'X', t:tp}, '');
        return html.indexOf('pick-input') < 0 || html.indexOf('<select') >= 0;
      });
      return {bad};
    });
    if(r.bad.length) throw new Error('not one field on: ' + r.bad.join(', '));
    return 'clients, leads, fund houses, schemes, partners, projects and the team, all one field';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 220));
    return 'none';
  });
});
