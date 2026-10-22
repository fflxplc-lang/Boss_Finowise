/* THE DISCLAIMER SITS WHERE IT IS READ, NOT WHERE IT IS SCROLLED PAST.

   The consent approval page opened on 41 points of disclosure and an
   "I have read and understood" tick, and only then showed the client
   the consent they were being asked about. So the tick came before the
   thing it refers to, and the first screen of a consent page was small
   print rather than the plan.

   The firm asked for it at the foot: the consent, then the disclosure
   and the tick, then Approve and Need More Information. That is the
   order the plan's own consent page already used, so the two pages now
   read the same way.

   Guarded here because the tick is a gate as well as a position: the
   buttons stay shut until it is ticked, wherever on the page it is,
   and a link carrying two consents opens both on the one tick.

   Each step draws the page again before reading it. The suite drives the
   client's page inside a signed-in session, where the live layer is
   running and a redraw landing between two steps replaces it with the
   CRM. A real client's link never starts that layer, so this is the
   harness keeping up with the page, not a guard against the product. */
const {suite} = require('../lib/harness');

const SETUP = `async function(tag){
  let c = DB.clients.find(x=>x.id === 'CMS-ORD');
  if(!c){ c = {id:'CMS-ORD'}; DB.clients.push(c); }
  Object.assign(c, {cmsName:'ZZ Order Client', email:'order@example.com',
    rmName: currentUser, createdAt:new Date().toISOString()});
  DB.recommendations = (DB.recommendations || []).filter(x=>x.clientId !== 'CMS-ORD');
  const mk = (amount)=>{
    const rec = {id: uid('REC'), clientId: c.id, status:'Sent to Client',
      productCategory:'Mutual Fund', investmentMode:'Lumpsum',
      schemes:[Object.assign(newAllocSchemeLine({productCategory:'Mutual Fund'}),
        {schemeName:'ZZ Order Scheme', amount:String(amount), transactionType:'Purchase'})],
      attachments:[], createdAt:new Date().toISOString()};
    DB.recommendations.push(rec);
    return rec;
  };
  const recs = tag === 'many' ? [mk(500000), mk(25000)] : [mk(500000)];
  await save('clients'); await save('recommendations');
  const token = uid('DOC');
  DB.docLinks.push({token, type:'ALLOC', recordModule:'CMS', recordId:c.id,
    allocationId: recs[0].id, allocationIds: recs.map(x=>x.id), status:'Active',
    createdAt:new Date().toISOString(),
    expiresAt:new Date(Date.now() + 72*3600*1000).toISOString()});
  await save('docLinks');
  window._ordToken = token;
  renderPublicDocForm(token);
  return {token, ids: recs.map(x=>x.id)};
}`;

/* Where each thing lands, measured in document order rather than by
   reading the markup — the page is built from several renderers and
   only the rendered page can say which came out first. */
const WHERE = `function(){
  const root = document.getElementById('root');
  const all = Array.prototype.slice.call(root.querySelectorAll('*'));
  const at = el => el ? all.indexOf(el) : -1;
  const answers = Array.prototype.slice.call(root.querySelectorAll('.plan-answer'));
  return {
    doc:   at(root.querySelector('.alloc-consent-section')),
    disc:  at(root.querySelector('.disc-ack')) >= 0
             ? Math.min.apply(null, Array.prototype.slice.call(root.querySelectorAll('*'))
                 .map((e,i)=>/Disclaimer\\./.test(e.textContent||'') && !e.children.length ? i : 1e9))
             : -1,
    tick:  at(root.querySelector('#f_discAck')),
    first: answers.length ? at(answers[0]) : -1,
    answers: answers.length,
    shut: answers.filter(b=>b.disabled).length,
    text: root.textContent || '',
  };
}`;

suite(async t => {
  await t.home();

  t.section('one consent');

  await t.step('the client reads the consent, then the disclaimer, then answers', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      await (${SETUP})('one');
      return (${WHERE})();
    })()`));
    if(r.doc < 0) throw new Error('the consent document is not on the page');
    if(r.tick < 0) throw new Error('the acknowledgement tick is not on the page');
    if(r.answers !== 2) throw new Error(r.answers + ' answer button(s), expected Approve and Need More Information');
    if(!(r.doc < r.tick))
      throw new Error('the tick still comes before the consent (doc ' + r.doc + ', tick ' + r.tick + ')');
    if(!(r.disc > 0 && r.disc > r.doc))
      throw new Error('the disclaimer is not below the consent (doc ' + r.doc + ', disclaimer ' + r.disc + ')');
    if(!(r.tick < r.first))
      throw new Error('the answers still come before the tick (tick ' + r.tick + ', first answer ' + r.first + ')');
    if(r.shut !== 2) throw new Error(r.shut + ' of 2 buttons are shut before the tick');
    return 'consent → disclaimer → tick → Approve / Need More Information, and both shut until it is ticked';
  });

  await t.step('and the tick still opens them', async () => {
    const r = await t.eval(()=>{
      renderPublicDocForm(window._ordToken);
      document.getElementById('f_discAck').checked = true;
      planAckChanged();
      const b = Array.prototype.slice.call(document.querySelectorAll('.plan-answer'));
      const note = document.getElementById('planAckNote');
      return {open: b.filter(x=>!x.disabled).length, of: b.length,
              note: note ? note.style.display : '(gone)'};
    });
    if(r.open !== r.of) throw new Error(r.open + ' of ' + r.of + ' opened');
    if(r.note !== 'none') throw new Error('the warning note is still showing: ' + r.note);
    return 'both answers open on the tick and the warning goes';
  });

  t.section('a link carrying two consents');

  await t.step('both documents come first, and one disclaimer answers for both', async () => {
    const r = await t.eval(new Function(`return (async ()=>{
      await (${SETUP})('many');
      const w = (${WHERE})();
      const root = document.getElementById('root');
      w.docs = root.querySelectorAll('.alloc-consent-section').length;
      w.ticks = root.querySelectorAll('#f_discAck').length;
      const all = Array.prototype.slice.call(root.querySelectorAll('*'));
      const last = Array.prototype.slice.call(root.querySelectorAll('.alloc-consent-section')).pop();
      w.lastDoc = all.indexOf(last);
      return w;
    })()`));
    if(r.docs !== 2) throw new Error(r.docs + ' consent document(s) drawn, expected 2');
    if(r.ticks !== 1) throw new Error(r.ticks + ' acknowledgement tick(s) — it should be asked once');
    if(r.answers !== 4) throw new Error(r.answers + ' answer button(s), expected a pair for each consent');
    if(!(r.lastDoc < r.tick))
      throw new Error('the tick is not below both consents (last doc ' + r.lastDoc + ', tick ' + r.tick + ')');
    if(!(r.tick < r.first))
      throw new Error('an answer comes before the tick (tick ' + r.tick + ', first answer ' + r.first + ')');
    if(r.shut !== 4) throw new Error(r.shut + ' of 4 buttons are shut before the tick');
    return 'two consents, one disclaimer below them both, then the two pairs of answers';
  });

  await t.step('and each answer still names the consent it belongs to', async () => {
    const r = await t.eval(()=>{
      renderPublicDocForm(window._ordToken);
      const root = document.getElementById('root');
      return {rows: Array.prototype.slice.call(root.querySelectorAll('.alloc-consent-answer'))
                .map(x=>(x.textContent || '').replace(/\s+/g,' ').trim())};
    });
    if(r.rows.length !== 2) throw new Error(r.rows.length + ' answer row(s)');
    r.rows.forEach((x, i)=>{
      if(x.indexOf(String(i + 1) + '.') !== 0)
        throw new Error('row ' + (i + 1) + ' does not name its consent: "' + x + '"');
    });
    return 'each pair of answers is headed by the consent it answers';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
