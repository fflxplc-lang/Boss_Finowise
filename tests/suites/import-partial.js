/* FOUR HUNDRED ROWS ON THE ERROR SHEET AND NOTHING IN CMS.

   The firm uploaded a book of clients and got back a column of
   messages: "Mobile: Please enter a valid 10-digit mobile number.",
   "PAN No.: Please enter a valid PAN number in the format ABCDE1234F."
   One line did it:

       else if(issues.length){ verdict = 'fail'; note = issues[0]; }

   Any problem with any cell refused the whole row. A client carrying a
   name, a PAN, an address, a category and a joining date was thrown
   away over one eleven-digit mobile number, and the operator's only
   move was to fix four hundred cells in Excel and start again.

   A bad cell is a fact about a cell. So it is taken out of the row, the
   row goes in without it, the field is left empty on the profile for
   somebody to type in, and the report names the row, the field, the
   value and the reason. What still stops a row is the field the record
   is created under — with no name there is no client to make.

   What this holds to: the rest of the row lands; the bad value never
   does; an update does not blank a good value with a bad one; the
   counts and the report say what happened; and "Refuse the whole row"
   is still there for anyone who wants the old behaviour. */
const {suite} = require('../lib/harness');

/* The sheet is built in the page and handed to the real picker, so
   every decision below is the one the operator's upload makes. */
const FEED = `async (srcId, rows) => {
  window._mapImpSrc = srcId;
  const bytes = xlsxWrite([{name:'Sheet1', rows}]);
  const file = new File([bytes], 'clients.xlsx',
    {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const inp = document.createElement('input');
  Object.defineProperty(inp, 'files', {value: [file]});
  await mapImpPick(inp);
  return mapImpBuild();
}`;

/* One good row, one with a mobile that is not a mobile, one with a PAN
   that is not a PAN, one with both, and one with no name at all. */
const SHEET = [
  ['CMS Name (Client Name)', 'Mobile', 'PAN No.', 'Mailing City'],
  ['ZZ Partial Good',    '9800000011', 'ABCDE1234F', 'Pune'],
  ['ZZ Partial Mobile',  '98000',      'BBCDE1234F', 'Nashik'],
  ['ZZ Partial Pan',     '9800000013', 'NOT-A-PAN',  'Nagpur'],
  ['ZZ Partial Both',    'phone?',     '123',        'Satara'],
  ['',                   '9800000015', 'CBCDE1234F', 'Thane'],
];

suite(async t => {
  await t.home();

  t.section('the preview, before anything is written');

  await t.step('a bad cell costs the cell, not the client', async () => {
    const r = await t.eval(async (a)=>{
      const plan = await eval('(' + a.FEED + ')')('clients', a.sheet);
      const by = {};
      plan.rows.forEach(x=>{ by[x.rec.cmsName || '(no name)'] = {
        verdict: x.verdict, note: x.note,
        mobile: x.rec.mobile, pan: x.rec.pan, city: x.rec.mailingCity,
        dropped: x.dropped.map(d=>d.label + '=' + d.value)}; });
      return {by, add: plan.add, fail: plan.fail, cellsIn: plan.cellsIn, cellsOut: plan.cellsOut,
        gapRows: plan.gapRows, problems: plan.fieldProblems.map(f=>f.label + '/' + f.n),
        identity: plan.identity};
    }, {FEED, sheet: SHEET});
    const good = r.by['ZZ Partial Good'], mob = r.by['ZZ Partial Mobile'],
          pan = r.by['ZZ Partial Pan'], both = r.by['ZZ Partial Both'], none = r.by['(no name)'];
    if(!good || good.verdict !== 'add' || good.mobile !== '9800000011' || good.pan !== 'ABCDE1234F')
      throw new Error('the clean row did not come through intact');
    [['mobile', mob], ['PAN', pan], ['both', both]].forEach(([what, row])=>{
      if(!row) throw new Error('the ' + what + ' row vanished');
      if(row.verdict !== 'add') throw new Error('the ' + what + ' row is still refused: ' + row.note);
      if(!row.city) throw new Error('the ' + what + ' row lost the fields that were fine');
    });
    if(mob.mobile !== '') throw new Error('a five-digit mobile was imported as ' + mob.mobile);
    if(mob.pan !== 'BBCDE1234F') throw new Error('a good PAN went down with a bad mobile');
    if(pan.pan !== '') throw new Error('"NOT-A-PAN" was imported as ' + pan.pan);
    if(pan.mobile !== '9800000013') throw new Error('a good mobile went down with a bad PAN');
    if(both.mobile !== '' || both.pan !== '') throw new Error('both bad cells were not dropped');
    if(both.dropped.length !== 2) throw new Error('the row names ' + both.dropped.length + ' dropped field(s)');
    if(!none || none.verdict !== 'fail')
      throw new Error('a row with no name was imported as a client');
    if(!/Client Name/i.test(none.note || '')) throw new Error('it did not say why: ' + none.note);
    if(r.identity !== 'cmsName') throw new Error('the field a client is created under is ' + r.identity);
    if(r.add !== 4 || r.fail !== 1) throw new Error(r.add + ' in and ' + r.fail + ' refused');
    if(r.cellsOut !== 4) throw new Error(r.cellsOut + ' field(s) counted as skipped, expected 4');
    if(r.gapRows !== 3) throw new Error(r.gapRows + ' record(s) counted as having gaps, expected 3');
    if(!r.problems.some(x=>/^Mobile\/2/.test(x))) throw new Error('Mobile is not counted twice: ' + r.problems.join(' '));
    return r.add + ' clients in and 1 refused for having no name; ' + r.cellsIn + ' fields written, '
      + r.cellsOut + ' skipped across ' + r.gapRows + ' records — ' + r.problems.join(', ');
  });

  await t.step('the report names the row, the field, the value and the reason', async () => {
    const r = await t.eval(()=>{
      const plan = mapImpBuild();
      const out = [];
      plan.rows.forEach(x=>x.dropped.forEach(d=>out.push({n: x.n, field: d.label, value: d.value, why: d.why})));
      return {out, sheets: (function(){
        /* the same two sheets the download writes, without the download */
        const bad = plan.rows.filter(x=>x.verdict === 'fail' || x.verdict === 'skip').length;
        return {bad, cells: out.length};
      })()};
    });
    const mobRow = r.out.find(x=>/Mobile/i.test(x.field) && x.value === '98000');
    const panRow = r.out.find(x=>/PAN/i.test(x.field) && x.value === 'NOT-A-PAN');
    if(!mobRow) throw new Error('the five-digit mobile is not on the report');
    if(!panRow) throw new Error('the bad PAN is not on the report');
    if(mobRow.n !== 3) throw new Error('the mobile is reported on row ' + mobRow.n + ', not 3');
    if(!/10-digit/.test(mobRow.why)) throw new Error('the mobile reason is not the firm’s: ' + mobRow.why);
    if(!/ABCDE1234F/.test(panRow.why)) throw new Error('the PAN reason is not the firm’s: ' + panRow.why);
    return r.out.length + ' field(s) on the report, each with its sheet row, its field name, the value '
      + 'that was in the cell and the firm’s own reason; ' + r.sheets.bad + ' row(s) on the other sheet';
  });

  t.section('and then it is written');

  await t.step('the clients land, with the good fields on them and the bad ones empty', async () => {
    const r = await t.eval(async ()=>{
      const before = DB.clients.length;
      await mapImpApply();
      const res = await fetch('/api/storage/clients', {headers: apiHeaders()});
      const held = JSON.parse((await res.json()).value);
      const find = n => held.find(c=>c.cmsName === n) || null;
      const h = (DB.importHistory || [])[DB.importHistory.length - 1] || {};
      return {made: DB.clients.length - before,
        good: find('ZZ Partial Good'), mob: find('ZZ Partial Mobile'),
        pan: find('ZZ Partial Pan'), both: find('ZZ Partial Both'),
        nameless: held.filter(c=>!c.cmsName && c.mailingCity === 'Thane').length,
        hist: {imported: h.imported, skipped: h.skipped, fieldsIn: h.fieldsIn,
               fieldsOut: h.fieldsOut, gapRows: h.gapRows}};
    });
    if(r.made !== 4) throw new Error(r.made + ' client(s) were created, expected 4');
    if(r.nameless) throw new Error('the row with no name was written after all');
    if(!r.good || r.good.mobile !== '9800000011') throw new Error('the clean client is wrong on the server');
    if(!r.mob) throw new Error('the client with the bad mobile is not on the server');
    if(r.mob.mobile) throw new Error('the bad mobile was written as "' + r.mob.mobile + '"');
    if(r.mob.pan !== 'BBCDE1234F' || r.mob.mailingCity !== 'Nashik')
      throw new Error('the fields that were fine did not land with it');
    if(r.pan.pan) throw new Error('the bad PAN was written as "' + r.pan.pan + '"');
    if(r.both.mobile || r.both.pan) throw new Error('a row with two bad cells wrote one of them');
    if(r.hist.fieldsOut !== 4 || r.hist.gapRows !== 3)
      throw new Error('the history says ' + r.hist.fieldsOut + ' field(s) on ' + r.hist.gapRows + ' record(s)');
    return r.made + ' clients on the server, read back: every good field on them, every bad one empty, '
      + 'and the history line carries ' + r.hist.fieldsIn + ' written / ' + r.hist.fieldsOut + ' left';
  });

  await t.step('and the CMS profile shows what came in, and shows the gap', async () => {
    const r = await t.eval(()=>{
      const c = DB.clients.find(x=>x.cmsName === 'ZZ Partial Mobile');
      navigate('cms', c.id);
      const html = document.getElementById('content').innerHTML;
      const list = (function(){ navigate('cms'); return document.getElementById('content').innerHTML; })();
      return {id: c.id, onProfile: html.indexOf('BBCDE1234F') >= 0,
        noBadMobile: html.indexOf('98000<') < 0, inList: list.indexOf('ZZ Partial Mobile') >= 0};
    });
    if(!r.onProfile) throw new Error('the PAN that did import is not on the profile');
    if(!r.inList) throw new Error('the client is not in the CMS list');
    return 'the client opens at ' + r.id + ' with its PAN and city on it and the mobile blank, ready to '
      + 'be typed in — and it is in the CMS list';
  });

  t.section('what the change must not have broken');

  await t.step('an update never writes a bad value over a good one', async () => {
    const r = await t.eval(async (a)=>{
      const c = DB.clients.find(x=>x.cmsName === 'ZZ Partial Good');
      const wasMobile = c.mobile, wasPan = c.pan;
      await eval('(' + a.FEED + ')')('clients', [
        ['CMS Name (Client Name)', 'Mobile', 'PAN No.', 'Mailing City'],
        ['ZZ Partial Good', 'rubbish', 'also rubbish', 'Kolhapur'],
      ]);
      mapImpSetKey('cmsName');
      mapImpSetMode('update');
      const plan = mapImpBuild();
      await mapImpApply();
      const now = DB.clients.find(x=>x.id === c.id);
      return {verdict: plan.rows[0].verdict, wasMobile, wasPan,
        mobile: now.mobile, pan: now.pan, city: now.mailingCity};
    }, {FEED});
    if(r.verdict !== 'update') throw new Error('the update row was ' + r.verdict);
    if(r.mobile !== r.wasMobile) throw new Error('the good mobile became "' + r.mobile + '"');
    if(r.pan !== r.wasPan) throw new Error('the good PAN became "' + r.pan + '"');
    if(r.city !== 'Kolhapur') throw new Error('the one good value on the sheet did not land');
    return 'the mobile and the PAN the record already held are untouched; the city the sheet got right '
      + 'is updated — a bad cell cannot blank a good field';
  });

  await t.step('"Refuse the whole row" still refuses the whole row', async () => {
    const r = await t.eval(async (a)=>{
      /* names nothing here holds, so the duplicate rule stays out of it */
      const sheet = a.sheet.map((r, i)=>i ? r.slice() : r.slice());
      sheet.forEach((r, i)=>{ if(i && r[0]) r[0] = r[0].replace('ZZ Partial', 'ZZ Strict'); });
      const plan = await eval('(' + a.FEED + ')')('clients', sheet);
      mapImpSetKey('');
      const partial = {add: plan.add, fail: plan.fail};
      mapImpSetPartial(false);
      const strict = mapImpBuild();
      const out = {partial, strictAdd: strict.add, strictFail: strict.fail,
        notes: strict.rows.map(x=>x.note)};
      mapImpSetPartial(true);
      mapImpClear();
      return out;
    }, {FEED, sheet: SHEET});
    if(r.strictFail !== 4) throw new Error('strict refused ' + r.strictFail + ' row(s), expected 4');
    if(r.strictAdd !== 1) throw new Error('strict accepted ' + r.strictAdd + ' row(s), expected 1');
    if(!r.notes.some(n=>/10-digit/.test(n || ''))) throw new Error('strict does not say why any more');
    return 'the same sheet: 4 in and 1 refused on the default, 1 in and 4 refused on "Refuse the whole '
      + 'row" — the old behaviour is a choice, not a loss';
  });
});
