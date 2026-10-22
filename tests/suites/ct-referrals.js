/* THE C&T FORM, AND THE LEADS IT OPENS.

   The firm's own Comment & Testimonial form asks each client to name people
   who should hear about the firm, and gives five columns to name them in.
   Area was dropped once on the grounds that nothing read it; the audit of
   12 October put it back, because the code that opens the lead had been
   reading it all along.

   Also here: the migration. The column set has shipped three times now, and
   a database sitting on any of ours should come up to the current one —
   while a table the firm has rewritten is theirs and stays exactly as they
   wrote it. That distinction is the whole risk in this file. */
const {suite} = require('../lib/harness');
const ready = require('../lib/ready');

suite(async t => {
  t.section('the columns the firm asks for');

  await t.step('name, contact, email, age and area — the first two required', async () => {
    const cols = await t.eval(()=>{
      const f = (DB.config.formTemplates.CT||[]).find(x=>x.k===CT_REFERENCE_FIELD) || {};
      return (f.cols||[]).map(c=>c.k + (c.req?'*':''));
    });
    if(cols.join(',') !== 'name*,mobile*,email,age,area')
      throw new Error('the columns read ' + cols.join(', '));
    return cols.join(' · ');
  });

  await t.step('three rows on opening, and no ceiling on them', async () => {
    const r = await t.eval(()=>{
      const f = (DB.config.formTemplates.CT||[]).find(x=>x.k===CT_REFERENCE_FIELD) || {};
      window._formRenderFields = DB.config.formTemplates.CT || [];
      formTableRows = {};
      const html = formFieldHtml(f, []);
      return {min: f.minRows, max: f.maxRows || 0,
              rows: (html.match(/_r\d+_name/g)||[]).length,
              add: /Add Person/.test(html)};
    });
    if(r.rows !== 3) throw new Error(r.rows + ' rows on opening');
    if(r.max) throw new Error('it still caps at ' + r.max);
    if(!r.add) throw new Error('there is no Add Person button');
    return '3 rows, Add Person, no cap';
  });

  t.section('carrying an existing database forward');

  await t.step('either set we have shipped is brought up to this one', async () => {
    const sets = [
      [{k:'name',l:'Name'},{k:'age',l:'Age'},{k:'mobile',l:'Contact No.'},{k:'area',l:'Area'}],
      [{k:'name',l:'Name'},{k:'mobile',l:'Contact No.'},{k:'email',l:'Email'},{k:'age',l:'Age'}],
    ];
    for(const cols of sets){
      await t.eval(async (c)=>{
        const f = (DB.config.formTemplates.CT||[]).find(x=>x.k===CT_REFERENCE_FIELD);
        f.cols = c; await save('config');
      }, cols);
      await t.page.reload({waitUntil:'domcontentloaded'});
      await ready(t.page);
      const got = await t.eval(()=>{
        const f = (DB.config.formTemplates.CT||[]).find(x=>x.k===CT_REFERENCE_FIELD) || {};
        return (f.cols||[]).map(c=>c.k).join(',');
      });
      if(got !== 'name,mobile,email,age,area') throw new Error('after the boot: ' + got);
    }
    return 'both shipped sets land on name,mobile,email,age,area';
  });

  await t.step('columns the firm wrote themselves are left alone', async () => {
    await t.eval(async ()=>{
      const f = (DB.config.formTemplates.CT||[]).find(x=>x.k===CT_REFERENCE_FIELD);
      f.cols = [{k:'name',l:'Name'},{k:'mobile',l:'Mobile'},{k:'notes',l:'What they need'}];
      await save('config');
    });
    await t.page.reload({waitUntil:'domcontentloaded'});
    await ready(t.page);
    const cols = await t.eval(()=>{
      const f = (DB.config.formTemplates.CT||[]).find(x=>x.k===CT_REFERENCE_FIELD) || {};
      return (f.cols||[]).map(c=>c.k).join(',');
    });
    if(cols !== 'name,mobile,notes') throw new Error('their own columns were overwritten: ' + cols);
    await t.eval(async ()=>{                       // put the real form back
      const f = (DB.config.formTemplates.CT||[]).find(x=>x.k===CT_REFERENCE_FIELD);
      f.cols = JSON.parse(JSON.stringify(ctContent().find(x=>x.k===CT_REFERENCE_FIELD).cols));
      await save('config');
    });
    return 'left exactly as they wrote them';
  });

  t.section('what the client types becomes a lead');

  await t.step('an Area typed on the form reaches the lead as its city', async () => {
    const token = await t.eval(async ()=>{
      const c = {id:uid('CMS'), cmsName:'ZZ Area Client', rmName:currentUser,
        createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('CMS', c); DB.clients.push(c); await save('clients');
      return await createDocLink(null, 'CT', {recordModule:'CMS', recordId:c.id});
    });
    const before = await t.eval(()=>DB.leads.length);
    await t.doc(token, 1400);
    await t.page.fill('#f_ct_testimonial','They made sense of what I could not.');
    await t.page.click('#f_ct_consent_o0');
    await t.page.fill('#f_ct_references_r0_name','Rohit Sharma');
    await t.page.fill('#f_ct_references_r0_mobile','9800011111');
    await t.page.fill('#f_ct_references_r0_age','41');
    await t.page.fill('#f_ct_references_r0_area','Sigra');
    await t.page.fill('#f_ct_references_r1_name','Divya Nair');
    await t.page.fill('#f_ct_references_r1_mobile','9800022222');
    await t.eval(()=>{
      const b = Array.from(document.querySelectorAll('button')).find(x=>/Submit/.test(x.textContent));
      if(b) b.click();
    });
    await t.wait(2200);
    await t.home();
    const r = await t.eval(n=>{
      const made = DB.leads.slice(n);
      const rohit = made.find(l=>/Rohit/.test((l.firstName||'') + ' ' + (l.lastName||'')));
      return {n: made.length, city: rohit && rohit.city, age: rohit && rohit.age,
              remark: (rohit && rohit.remarks) || '', source: rohit && rohit.source};
    }, before);
    if(r.n !== 2) throw new Error(r.n + ' leads from two usable rows');
    if(r.city !== 'Sigra') throw new Error("the lead's city is \"" + r.city + '"');
    if(!/Sigra/.test(r.remark)) throw new Error('the area is not in the remark: ' + r.remark);
    if(Number(r.age) !== 41) throw new Error('the age did not come with them: ' + r.age);
    if(r.source !== 'Client Referral') throw new Error('the source reads ' + r.source);
    return '2 leads; city "' + r.city + '", said again in the remark, age 41';
  });

  await t.step('a row with no way to reach them becomes nothing', async () => {
    const r = await t.eval(()=>{
      const refs = ctReferencesFrom({ct_references:[
        {name:'No Contact', age:'50', area:'Nowhere'},
        {name:'', mobile:'9800033333'},
        {name:'Usable', mobile:'9800044444'},
      ]});
      return refs.map(x=>x.name);
    });
    if(r.length !== 1 || r[0] !== 'Usable')
      throw new Error('it kept ' + JSON.stringify(r));
    return 'only the row with a name and a number';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
