/* "Charlie: 0" OVER A TABLE OF CHARLIES.

   The firm imported two thousand clients and the CMS header read
   Alpha: 0 · Beta: 0 · Charlie: 0 · Delta: 90, above rows whose
   Category column plainly said CHARLIE and DELTA. The Review column
   said "No rule configured" for every one of them.

   One cause, two symptoms. A configured list holds the label an
   administrator typed — Charlie. The sheet said CHARLIE, and the
   import accepted it, which is right: a dropdown is matched without
   regard to case or a stray full stop, or half the sheets in the world
   would be refused over a capital letter. What it stored was the
   sheet's own wording, which is also right. What was wrong is every
   screen that then counted with ===, and the review rule looked up the
   same way.

   So a stored value is matched to its configured option the way the
   import matched it, and shown under the spelling the firm configured.
   What the list has never heard of is counted and coloured as exactly
   that rather than disappearing out of the totals, and so is a client
   with no category at all, which is what makes the chips add up.

   Asked for in the same breath: a way to sort the list by its columns.

   What this holds to: the counts find a tier however the sheet spelled
   it; they add up to the number of clients; the review rule resolves;
   what is not a tier is visible as not a tier; an import now stores the
   configured spelling so this does not start again; and every heading
   sorts, three ways, without disturbing which rows are drawn. */
const {suite} = require('../lib/harness');

const FEED = `async (rows) => {
  window._mapImpSrc = 'clients';
  const bytes = xlsxWrite([{name:'Sheet1', rows}]);
  const file = new File([bytes], 'cats.xlsx',
    {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const inp = document.createElement('input');
  Object.defineProperty(inp, 'files', {value: [file]});
  await mapImpPick(inp);
  return mapImpBuild();
}`;

suite(async t => {
  await t.home();
  let made = null;

  await t.step('six clients, spelled the way a sheet spells them', async () => {
    made = await t.eval(async ()=>{
      const now = new Date().toISOString();
      const ids = [];
      const mk = (n, cat) => {
        const c = {id: uid('CMS'), cmsName: 'ZZ Cat ' + n, mobile: '98000000' + n,
          clientCategory: cat, rmName: currentUser, branch: DB.config.branches[0], createdAt: now};
        initState('CMS', c); DB.clients.push(c); ids.push(c.id); return c.id;
      };
      mk('01','DELTA'); mk('02','CHARLIE'); mk('03','Delta');
      mk('04','charlie'); mk('05','ZZ Gamma'); mk('06','');
      await save('clients');
      return {ids, cats: cfgLabels('arc.categories')};
    });
    if(made.cats.indexOf('Charlie') < 0) throw new Error('the configured tiers are ' + made.cats.join(', '));
    return 'DELTA, CHARLIE, Delta, charlie, an unconfigured "ZZ Gamma" and one with no category';
  });

  await t.step('a tier is counted however the sheet spelled it', async () => {
    const r = await t.eval(()=>{
      navigate('cms');
      const html = document.getElementById('content').innerHTML;
      /* Read off the page as a person reads it: the chip says "Charlie: 2". */
      const text = (document.getElementById('content').textContent || '').replace(/\s+/g, ' ');
      const n = label => {
        const at = text.indexOf(label + ':');
        if(at < 0) return null;
        const m = text.slice(at + label.length + 1).match(/^\s*(\d+)/);
        return m ? Number(m[1]) : null;
      };
      const all = visibleRecords(DB.clients, c=>c.rmName, c=>c.branch).filter(c=>!c.deletedAt);
      return {charlie: n('Charlie'), delta: n('Delta'), alpha: n('Alpha'),
        other: n('Not a configured tier'), none: n('No category'), total: all.length,
        shown: html};
    });
    if(r.charlie === null || r.delta === null) throw new Error('the category chips are not on the page');
    if(r.charlie < 2) throw new Error('Charlie counts ' + r.charlie + ', so CHARLIE is still being missed');
    if(r.delta < 2) throw new Error('Delta counts ' + r.delta + ', so DELTA is still being missed');
    if(r.other < 1) throw new Error('an unconfigured category is not counted as one');
    if(r.none < 1) throw new Error('a client with no category is not counted');
    return 'Charlie ' + r.charlie + ' · Delta ' + r.delta + ' · not a tier ' + r.other
      + ' · no category ' + r.none;
  });

  await t.step('and the chips add up to the clients they are counting', async () => {
    const r = await t.eval(()=>{
      const all = visibleRecords(DB.clients, c=>c.rmName, c=>c.branch).filter(c=>!c.deletedAt);
      const inWindow = applyTimeline('CMS', all);
      const cats = cfgLabels('arc.categories');
      const counted = cats.reduce((n,k)=>n + inWindow.filter(c=>cfgIs('arc.categories', c.clientCategory, k)).length, 0);
      const none = inWindow.filter(c=>!String(c.clientCategory||'').trim()).length;
      return {total: inWindow.length, counted, none,
        other: inWindow.length - none - counted};
    });
    if(r.counted + r.none + r.other !== r.total)
      throw new Error(r.counted + ' + ' + r.none + ' + ' + r.other + ' is not ' + r.total);
    if(r.other < 0) throw new Error('a client was counted under two tiers at once');
    return r.counted + ' in a tier, ' + r.other + ' in none of them, ' + r.none
      + ' with nothing set — ' + r.total + ' clients';
  });

  await t.step('the review rule resolves for a tier the sheet shouted', async () => {
    const r = await t.eval(()=>({
      shouted: arcFrequencyLabel('CHARLIE'),
      configured: arcFrequencyLabel('Charlie'),
      unknown: arcFrequencyLabel('ZZ Gamma'),
      blank: arcFrequencyLabel(''),
    }));
    if(r.shouted !== r.configured)
      throw new Error('"CHARLIE" reads "' + r.shouted + '" and "Charlie" reads "' + r.configured + '"');
    if(r.shouted === 'No rule configured')
      throw new Error('neither spelling finds the rule, so the fixture has no Charlie rule');
    if(r.unknown !== 'No rule configured') throw new Error('an unconfigured tier found a rule');
    if(r.blank !== 'No rule configured') throw new Error('an empty category found a rule');
    return '"CHARLIE" and "Charlie" both read "' + r.shouted + '"; an unknown tier still says so';
  });

  await t.step('the badge shows the configured spelling, and flags what is not a tier', async () => {
    const r = await t.eval(()=>({
      canon: cfgCanon('arc.categories', 'cHaRlIe'),
      kept: cfgCanon('arc.categories', 'ZZ Gamma'),
      empty: cfgCanon('arc.categories', ''),
      knownYes: cfgKnown('arc.categories', 'DELTA'),
      knownNo: cfgKnown('arc.categories', 'ZZ Gamma'),
      stored: (DB.clients.find(c=>c.cmsName === 'ZZ Cat 02') || {}).clientCategory,
    }));
    if(r.canon !== 'Charlie') throw new Error('"cHaRlIe" displays as "' + r.canon + '"');
    if(r.kept !== 'ZZ Gamma') throw new Error('an unknown category was rewritten to "' + r.kept + '"');
    if(r.empty !== '') throw new Error('an empty category became "' + r.empty + '"');
    if(!r.knownYes || r.knownNo) throw new Error('a tier and a non-tier are not told apart');
    if(r.stored !== 'CHARLIE') throw new Error('the record was rewritten to "' + r.stored + '"');
    return 'shown as Charlie, still stored as CHARLIE — nothing on the record was rewritten';
  });

  await t.step('an import now stores the spelling the firm configured', async () => {
    const r = await t.eval(async (a)=>{
      const plan = await eval('(' + a.FEED + ')')([
        ['CMS Name (Client Name)', 'Client Category'],
        ['ZZ Cat Import', 'DELTA'],
        ['ZZ Cat Import Odd', 'ZZ Gamma'],
      ]);
      return {good: plan.rows[0].rec.clientCategory, oddVerdict: plan.rows[1].verdict,
        oddDropped: (plan.rows[1].dropped[0] || {}).label || '',
        oddWhy: (plan.rows[1].dropped[0] || {}).why || ''};
    }, {FEED});
    if(r.good !== 'Delta') throw new Error('"DELTA" would import as "' + r.good + '"');
    if(r.oddVerdict !== 'add') throw new Error('an unknown tier took the whole client down');
    if(!/Category/i.test(r.oddDropped)) throw new Error('an unknown tier was imported anyway');
    return '"DELTA" lands as "Delta"; a tier the firm has never configured is left for correction '
      + 'and the client still imports';
  });

  await t.step('every heading sorts, three ways, and draws the same rows', async () => {
    const r = await t.eval(()=>{
      navigate('cms');
      const html = document.getElementById('content').innerHTML;
      const buttons = (html.match(/class="th-sort/g) || []).length;
      const count = () => document.querySelectorAll('#cmsTable tbody tr').length;
      const names = () => Array.from(document.querySelectorAll('#cmsTable tbody tr td:nth-child(2)'))
        .map(td=>td.textContent.trim());
      const before = count(), unsorted = names();
      setSort('cms','name');  const asc = names(),  s1 = Object.assign({}, sortState('cms'));
      setSort('cms','name');  const desc = names(), s2 = Object.assign({}, sortState('cms'));
      setSort('cms','name');  const back = names(), s3 = Object.assign({}, sortState('cms'));
      setSort('cms','category');
      const byCat = Array.from(document.querySelectorAll('#cmsTable tbody tr td:nth-child(5)'))
        .map(td=>td.textContent.trim());
      setSort('cms','category'); setSort('cms','category');     // back to the list's own order
      return {buttons, before, after: count(), unsorted, asc, desc, back, byCat, s1, s2, s3};
    });
    if(r.buttons < 10) throw new Error('only ' + r.buttons + ' heading(s) are sortable');
    if(r.before !== r.after) throw new Error('sorting changed how many rows are drawn');
    if(r.s1.dir !== 1 || r.s2.dir !== -1 || r.s3.k) throw new Error('the three presses do not cycle');
    const sorted = r.asc.slice().sort((a,b)=>a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'}));
    if(JSON.stringify(r.asc) !== JSON.stringify(sorted)) throw new Error('ascending is not ascending');
    if(JSON.stringify(r.desc) !== JSON.stringify(r.asc.slice().reverse()))
      throw new Error('descending is not the reverse of ascending');
    if(JSON.stringify(r.back) !== JSON.stringify(r.unsorted))
      throw new Error('the third press did not give the list back its own order');
    const blanks = r.byCat.filter(x=>x === '—' || x === '').length;
    const tail = r.byCat.slice(r.byCat.length - blanks);
    if(blanks && tail.some(x=>x !== '—' && x !== ''))
      throw new Error('a client with no category sorted above ones that have one');
    return r.buttons + ' sortable headings; ' + r.before + ' rows throughout; ascending, descending and '
      + 'back to the list’s own order, with the blanks last whichever way the arrow points';
  });
});
