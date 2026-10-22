/* THE FUND HOUSE IS IN THE SCHEME FILE.

   The firm imported 1,588 schemes from their own scheme master and
   then opened an allocation to find the Fund House picker holding
   nothing but "All AMCs". The schemes were all there. Every one of
   them carried its fund house in the amcId field — as the NAME, the
   way the spreadsheet wrote it, because the import had no idea that
   an amcselect column means an id and stored the cell verbatim. A
   name is not an id, the picker reads the AMC store, and the AMC
   store was empty.

   Two halves to the answer. A sheet naming a fund house that is
   already on file resolves to it. A sheet naming one that is not
   creates it — the scheme master is where a firm's fund houses are
   written down, and making somebody key forty of them into Setup
   before a file will take is make-work.

   And for the 1,588 already in: a migration reads the names back out
   of the schemes, makes one AMC for each distinct one, and repoints
   every scheme at the record. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();

  t.section('a sheet that names a fund house BOSS has never heard of');

  await t.step('the name becomes a record, and the scheme points at it', async () => {
    const r = await t.eval(async ()=>{
      const before = (DB.amcs || []).length;
      const src = exportSource('schemes');
      const add = [
        {id:'', row:{amcId:'ZZ Alpha Mutual Fund', schemeName:'ZZ Alpha Flexi Cap',
                     category:'Mutual Fund', createdAt:new Date().toISOString()}},
        /* The same house, spelled differently: one record, not two. */
        {id:'', row:{amcId:'zz   alpha  mutual fund', schemeName:'ZZ Alpha Mid Cap',
                     category:'Mutual Fund', createdAt:new Date().toISOString()}},
        {id:'', row:{amcId:'ZZ Beta Life Insurance', schemeName:'ZZ Beta Term',
                     category:'Insurance', createdAt:new Date().toISOString()}},
      ];
      const w = await impBackWrite([{srcId:'schemes', src, add, update:[], skip:[]}], null);
      const made = (DB.amcs || []).filter(a=>/^zz /i.test(a.name || ''));
      const mine = (DB.schemes || []).filter(s=>/^ZZ (Alpha|Beta)/.test(s.schemeName || ''));
      return {added: w.added, newAmcs: (DB.amcs || []).length - before,
              names: made.map(a=>a.name).sort(),
              types: made.map(a=>a.name + ':' + a.type).sort(),
              allPointAtRecords: mine.every(s=>made.some(a=>a.id === s.amcId)),
              alphaShared: mine.filter(s=>/Alpha/.test(s.schemeName))
                .map(s=>s.amcId).filter((v,i,xs)=>xs.indexOf(v) === i).length};
    });
    if(r.added !== 3) throw new Error('the schemes did not import: ' + r.added);
    if(r.newAmcs !== 2) throw new Error('made ' + r.newAmcs + ' fund houses, expected 2');
    if(r.names.join(' | ') !== 'ZZ Alpha Mutual Fund | ZZ Beta Life Insurance')
      throw new Error('made: ' + r.names.join(', '));
    if(r.alphaShared !== 1) throw new Error('two spellings of one house became two houses');
    if(!r.allPointAtRecords) throw new Error('a scheme still holds a name where an id belongs');
    /* The type is read off the scheme's own category where that names
       one of the kinds an AMC can be. */
    if(r.types.join(' | ') !== 'ZZ Alpha Mutual Fund:Mutual Fund | ZZ Beta Life Insurance:Insurance')
      throw new Error('types came out as ' + r.types.join(', '));
    return 'two houses from three schemes, one of them spelled two ways, each typed from its category';
  });

  await t.step('a fund house already on file is matched, not duplicated', async () => {
    const r = await t.eval(async ()=>{
      const before = (DB.amcs || []).length;
      const existing = (DB.amcs || []).find(a=>a.name === 'ZZ Alpha Mutual Fund');
      const src = exportSource('schemes');
      await impBackWrite([{srcId:'schemes', src, update:[], skip:[], add:[
        {id:'', row:{amcId:'ZZ ALPHA MUTUAL FUND.', schemeName:'ZZ Alpha Small Cap',
                     category:'Mutual Fund', createdAt:new Date().toISOString()}}]}], null);
      const sc = (DB.schemes || []).find(s=>s.schemeName === 'ZZ Alpha Small Cap');
      return {grew: (DB.amcs || []).length - before, matched: sc.amcId === existing.id};
    });
    if(r.grew !== 0) throw new Error('it made another fund house for one already on file');
    if(!r.matched) throw new Error('the scheme did not point at the house already on file');
    return 'matched on name, ignoring case and punctuation; nothing duplicated';
  });

  t.section('the schemes already imported as text');

  await t.step('the migration reads the houses back out and repoints', async () => {
    const r = await t.eval(async ()=>{
      /* Exactly the shape on the firm's books: schemes carrying the
         fund house's NAME in the id field, and no AMC to match. */
      DB.amcs = (DB.amcs || []).filter(a=>!/^ZZ Legacy/i.test(a.name || ''));
      const names = ['ZZ Legacy AMC One','ZZ Legacy AMC One','ZZ Legacy AMC Two'];
      const ids = names.map((n, i)=>{
        const sc = {id: uid('SCH'), amcId: n, schemeName:'ZZ Legacy Scheme ' + i,
          category:'Mutual Fund', createdAt:new Date().toISOString()};
        DB.schemes.push(sc); return sc.id;
      });
      await save('schemes'); await save('amcs');
      const before = (DB.amcs || []).length;
      const made = await migrateSchemeAmcNames();
      const again = await migrateSchemeAmcNames();
      const after = ids.map(id=>DB.schemes.find(s=>s.id === id));
      const houses = (DB.amcs || []).filter(a=>/^ZZ Legacy/i.test(a.name || ''));
      return {made, again, grew: (DB.amcs || []).length - before,
              pointed: after.every(s=>houses.some(a=>a.id === s.amcId)),
              shared: after[0].amcId === after[1].amcId && after[0].amcId !== after[2].amcId,
              names: houses.map(a=>a.name).sort()};
    });
    if(r.made !== 2) throw new Error('the migration made ' + r.made + ' houses, expected 2');
    if(r.again !== 0) throw new Error('a second run was not a no-op: ' + r.again);
    if(r.grew !== 2) throw new Error('the AMC store grew by ' + r.grew);
    if(!r.pointed) throw new Error('a scheme still holds a name where an id belongs');
    if(!r.shared) throw new Error('the two schemes of one house did not land on one record');
    return 'three schemes, two houses, repointed — and the second run does nothing';
  });

  await t.step('the Fund House picker on an allocation now has them', async () => {
    const r = await t.eval(()=>{
      const html = allocSchemeLineHtml({schemeName:'ZZ', amount:'1'}, 0, ['Lumpsum']);
      const houses = (DB.amcs || []).filter(a=>!a.deletedAt);
      /* The fund house is picked by typing its name, so what it
         offers is the picker's rows rather than a select's options. */
      const rows = window._pickRows['f_alAmc0'] || [];
      return {n: houses.length, drawn: houses.filter(a=>rows.some(r=>r.value === a.id)).length,
              typeahead: html.indexOf('pickbox_f_alAmc0') >= 0,
              named: rows.some(r=>r.label === 'ZZ Legacy AMC One')};
    });
    if(!r.n) throw new Error('there are still no fund houses on file');
    if(!r.typeahead) throw new Error('the fund house is not a type-ahead on the line');
    if(r.drawn !== r.n) throw new Error('the picker offers ' + r.drawn + ' of ' + r.n + ' houses');
    if(!r.named) throw new Error('a house read out of the scheme file is not in the picker');
    return r.n + ' fund houses offered by the type-ahead, including the ones read out of the scheme file';
  });

  t.section('the column under whatever heading the sheet gave it');

  await t.step('"Fund House" is matched to the AMC column', async () => {
    const r = await t.eval(()=>{
      const fields = mapImpFields('schemes');
      const map = h => mapImpAuto([h], fields)[h] || '';
      return {fund: map('Fund House'), amc: map('AMC'), amcName: map('AMC Name'),
              house: map('Fund House (AMC)'), label: map('AMC / Insurer'),
              scheme: map('Scheme Name')};
    });
    ['fund','amc','amcName','house','label'].forEach(k=>{
      if(r[k] !== 'amcId') throw new Error(k + ' mapped to "' + r[k] + '", not amcId');
    });
    if(r.scheme !== 'schemeName') throw new Error('Scheme Name mapped to "' + r.scheme + '"');
    return 'Fund House, AMC, AMC Name and Fund House (AMC) all reach the AMC column';
  });

  await t.step('a house carried under an unmapped heading is still read', async () => {
    const r = await t.eval(async ()=>{
      /* What an import that could not place the heading leaves behind:
         the value on the record under the sheet's own wording, and
         amcId empty. */
      DB.amcs = (DB.amcs || []).filter(a=>!/^ZZ Carried/i.test(a.name || ''));
      const sc = {id: uid('SCH'), amcId:'', schemeName:'ZZ Carried Scheme',
        category:'Mutual Fund', 'Fund House':'ZZ Carried House',
        createdAt:new Date().toISOString()};
      DB.schemes.push(sc);
      await save('schemes'); await save('amcs');
      const made = await migrateSchemeAmcNames();
      const after = DB.schemes.find(x=>x.id === sc.id);
      const house = (DB.amcs || []).find(a=>a.name === 'ZZ Carried House');
      return {made, pointed: !!house && after.amcId === house.id};
    });
    if(!r.made) throw new Error('the carried column was not read');
    if(!r.pointed) throw new Error('the scheme was not repointed at the house it names');
    return 'read out of the sheet\u2019s own heading and repointed';
  });

  await t.step('an empty picker says why it is empty', async () => {
    const r = await t.eval(()=>{
      const keep = DB.amcs;
      DB.amcs = [];
      const html = allocSchemeLineHtml({schemeName:'ZZ', amount:'1'}, 0, ['Lumpsum']);
      DB.amcs = keep;
      const full = allocSchemeLineHtml({schemeName:'ZZ', amount:'1'}, 0, ['Lumpsum']);
      return {says: /No fund houses on file/.test(html),
              names: /scheme master has/.test(html),
              quietWhenFull: !/No fund houses on file/.test(full)};
    });
    if(!r.says) throw new Error('an empty picker still says nothing');
    if(!r.names) throw new Error('it does not say the scheme master has schemes without one');
    if(!r.quietWhenFull) throw new Error('it warns even when there are fund houses');
    return 'it names the problem and where to fix it, and stays quiet once they are there';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 220));
    return 'none';
  });
});
