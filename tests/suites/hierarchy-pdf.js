/* THE REPORTING TREE, DRAWN.

   BOSS already knows who reports to whom — every team member carries a
   parentUserId. The chart must be that tree and nothing else: no second
   list of names to keep up to date, no one left out, nobody drawn twice.

   A PDF is hard to look at from a test, so what is checked is what can
   go wrong without anyone noticing: that every name reaches the page,
   that the shape of the file is a shape a reader will open, that a loop
   in the data neither hangs the page nor duplicates a person, and that
   a designation nobody wrote down is not invented. The layout itself was
   checked by looking at it. */
const {suite} = require('../lib/harness');

/* The chart's text, as a reader would see it. Every string the writer
   emits is a PDF literal, so the page's words can be read straight out
   of the content stream. */
const words = raw => (raw.match(/\(((?:\\.|[^()\\])*)\) Tj/g) || [])
  .map(x => x.slice(1, -4).replace(/\\([\\()])/g, '$1'));

suite(async t => {

  await t.step('a firm with nobody in it is told so rather than handed a blank sheet', async () => {
    const r = await t.eval(async ()=>{
      const was = DB.team;
      DB.team = [];
      let said = '';
      const alert0 = window.alert; window.alert = m => { said = m; };
      downloadHierarchyPdf();
      window.alert = alert0;
      DB.team = was;
      return {said};
    });
    if(!/nobody in the team/i.test(r.said)) throw new Error('it said "' + r.said + '"');
    return 'it says there is nobody yet';
  });

  await t.step('the tree BOSS keeps is the tree that is drawn', async () => {
    const r = await t.eval(async ()=>{
      DB.config.company = DB.config.company || {};
      DB.config.company.name = 'ZZ Hierarchy Firm';
      DB.team = [];
      let n = 0;
      const add = (name, role, desig, dept, parent, status) => {
        const id = 'ZZU' + (++n);
        DB.team.push({id, name, role, designation:desig||'', department:dept||'',
          parentUserId:parent||null, status:status||'Active', email:'zz'+n+'@example.in', scope:'all'});
        return id;
      };
      const boss = add('ZZ Top Person', 'Admin', 'Managing Director', '', null);
      const ops  = add('ZZ Ops Head', 'Manager', 'Chief Operating Officer', 'Operations', boss);
      const tech = add('ZZ Tech Head', 'Manager', 'Chief Technology Officer', 'Technology', boss);
      add('ZZ Junior One', 'Operations', 'Operations Executive', '', ops);
      add('ZZ Junior Two', 'Operations', 'Operations Executive', '', ops);
      add('ZZ Junior Three', 'Operations', 'Technology Executive', '', tech);
      add('ZZ Empty Seat', 'Operations', '', '', tech);              // no designation written down
      add('ZZ Gone Away', 'Operations', 'Operations Executive', '', ops, 'Inactive');
      await save('team');
      return {raw: hierarchyPdfRaw(), people: DB.team.length, name: hierarchyPdfName()};
    });
    const said = words(r.raw);
    const missing = ['ZZ Top Person','ZZ Ops Head','ZZ Tech Head','ZZ Junior One','ZZ Junior Two',
                     'ZZ Junior Three','ZZ Empty Seat','ZZ Gone Away'].filter(x=>said.indexOf(x) < 0);
    if(missing.length) throw new Error('not on the chart: ' + missing.join(', '));
    const twice = said.filter((x,i)=>/^ZZ /.test(x) && said.indexOf(x) !== i);
    if(twice.length) throw new Error('drawn more than once: ' + twice.join(', '));
    if(said.indexOf('ZZ Hierarchy Firm') < 0) throw new Error('the firm is not at the top');
    if(said.indexOf('Company / Super Admin') < 0) throw new Error('the top box lost its heading');
    if(!/-Hierarchy-\d{4}-\d{2}-\d{2}\.pdf$/.test(r.name)) throw new Error('the file is called ' + r.name);
    return r.people + ' people, each once, under ' + 'ZZ Hierarchy Firm';
  });

  await t.step('each person carries their department and their designation', async () => {
    const said = words(await t.eval(()=>hierarchyPdfRaw()));
    if(said.indexOf('Operations') < 0) throw new Error('a department is missing');
    if(said.indexOf('Designation: Chief Operating Officer') < 0) throw new Error('a designation is missing');
    const invented = said.filter(x=>/^Designation: (Operations|Manager|Admin|Relationship Manager)$/.test(x));
    if(invented.length) throw new Error('a designation was invented from a system role: ' + invented.join(', '));
    if(said.indexOf('Inactive') < 0) throw new Error('somebody who has left is not marked');
    return 'department, designation where written, and standing where it is not Active';
  });

  await t.step('it is a PDF a reader will open — one page, cut to the chart', async () => {
    const r = await t.eval(()=>{
      const raw = hierarchyPdfRaw();
      const box = raw.match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
      return {head: raw.slice(0,8), tail: raw.slice(-5), pages: (raw.match(/\/Type \/Page[^s]/g)||[]).length,
              w: box? Number(box[1]) : 0, h: box? Number(box[2]) : 0,
              xref: /startxref\n\d+\n%%EOF$/.test(raw),
              len: Number((raw.match(/<< \/Length (\d+) >>/)||[])[1]),
              stream: (()=>{ const a = raw.indexOf('stream\n') + 7;
                             return raw.indexOf('\nendstream', a) - a; })()};
    });
    if(r.head !== '%PDF-1.4') throw new Error('it does not start as a PDF');
    if(r.tail !== '%%EOF') throw new Error('it does not end as a PDF');
    if(!r.xref) throw new Error('the cross-reference table is not where a reader looks for it');
    if(r.pages !== 1) throw new Error(r.pages + ' pages, not one');
    if(r.len !== r.stream) throw new Error('the declared stream length is ' + r.len + ', the stream is ' + r.stream);
    if(!(r.w > 200 && r.h > 120)) throw new Error('the page is ' + r.w + ' x ' + r.h);
    if(r.w <= r.h) throw new Error('a chart this wide should be a landscape page: ' + r.w + ' x ' + r.h);
    if(r.w > 14400 || r.h > 14400) throw new Error('the page is past what a PDF may be: ' + r.w + ' x ' + r.h);
    return Math.round(r.w) + ' x ' + Math.round(r.h) + ' points, one page';
  });

  await t.step('a very wide firm is scaled to fit rather than run off the sheet', async () => {
    const r = await t.eval(async ()=>{
      const boss = DB.team[0].id;
      for(let i=0;i<400;i++){
        DB.team.push({id:'ZZW'+i, name:'ZZ Wide Person Number '+i, role:'Operations',
          designation:'Client Relationship Executive', parentUserId:boss, status:'Active',
          email:'zzw'+i+'@example.in', scope:'all'});
      }
      await save('team');
      const raw = hierarchyPdfRaw();
      const box = raw.match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
      const said = (raw.match(/\(((?:\\.|[^()\\])*)\) Tj/g)||[]).map(x=>x.slice(1,-4));
      return {w: Number(box[1]), h: Number(box[2]),
              last: said.indexOf('ZZ Wide Person Number 399') >= 0,
              scaled: /drawn to \d+%/.test(raw)};
    });
    if(r.w > 14400 || r.h > 14400) throw new Error('the page is ' + r.w + ' x ' + r.h + ', past what a PDF may be');
    if(!r.last) throw new Error('the four hundredth person fell off the chart');
    if(!r.scaled) throw new Error('it was not scaled, and the foot does not say so');
    return Math.round(r.w) + ' points wide, everybody on it, and the foot says it was scaled';
  });

  await t.step('a loop in the reporting line neither hangs the page nor doubles anybody', async () => {
    const r = await t.eval(async ()=>{
      DB.team = [
        {id:'L1', name:'ZZ Loop One', role:'Manager', parentUserId:'L3', status:'Active', email:'l1@example.in'},
        {id:'L2', name:'ZZ Loop Two', role:'Manager', parentUserId:'L1', status:'Active', email:'l2@example.in'},
        {id:'L3', name:'ZZ Loop Three', role:'Manager', parentUserId:'L2', status:'Active', email:'l3@example.in'},
      ];
      await save('team');
      const raw = hierarchyPdfRaw();
      const said = (raw.match(/\(((?:\\.|[^()\\])*)\) Tj/g)||[]).map(x=>x.slice(1,-4));
      return {said: said.filter(x=>/^ZZ Loop/.test(x))};
    });
    if(r.said.length !== 3) throw new Error('three people in a ring came out as ' + r.said.join(', '));
    return 'all three drawn, each once';
  });

  await t.step('Team Members offers it, at the list and beside the tree', async () => {
    /* The steps above replaced the team wholesale, signed-in account and
       all. Put a real one back before asking the screen to draw itself. */
    await t.eval(async ()=>{
      DB.team = [{id: currentUser, name:'ZZ Admin', role:'Admin', designation:'Administrator',
        department:'Leadership', parentUserId:null, status:'Active',
        email:'zzadmin@example.in', scope:'all', perms: fullPerms(true), adminFlags: fullAdminFlags(true)}];
      await save('team');
      navigate('teammembers');
    });
    await t.wait(400);
    const r = await t.eval(()=>{
      const c = document.getElementById('content');
      const html = c.innerHTML;
      const buttons = Array.from(c.querySelectorAll('button'))
        .filter(b=>/HierarchyPdf\(\)/.test(b.getAttribute('onclick')||''))
        .map(b=>b.textContent.trim());
      return {download: /downloadHierarchyPdf\(\)/.test(html),
              open: /openHierarchyPdf\(\)/.test(html),
              buttons};
    });
    if(!r.download) throw new Error('there is no way to get the chart');
    if(!r.open) throw new Error('there is no way to just look at it');
    if(r.buttons.length < 3) throw new Error('only these offer it: ' + r.buttons.join(', '));
    return r.buttons.join(', ');
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error(t.dialogs.join(' | '));
    return 'none';
  });
});
