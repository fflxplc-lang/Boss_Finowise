/* THE SAME QUESTIONS, A WORSE PAGE, DEPENDING ON HOW IT WAS SENT.

   The ISEQ reaches a client two ways. Riding on an Input Form it gets
   a page of its own: one card to a question, the options as buttons
   with their letters down the side, a progress strip across the top.
   Sent by itself from Send Form it fell through to the generic form
   renderer and arrived as a wall of radio buttons squeezed four and
   five to a row, the long answers wrapping to three lines.

   Same questions, same marks, same submit — the client simply met a
   worse page depending on a choice the adviser made without knowing
   they were making it. So the good page draws both.

   What this holds to above all: there is still ONE submit. The pretty
   buttons sit over the very controls the generic renderer writes, kept
   out of sight; a pick checks the matching one. submitDocForm() reads
   what it has always read and scores it the way it has always scored
   it, which is why iseq-landing.js — the suite that proves a solo
   link lands its score on the lead — goes on passing untouched. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();
  let token = null, lead = null;

  await t.step('an ISEQ sent on its own link', async () => {
    const r = await t.eval(async ()=>{
      const l = {id:uid('LEAD'), leadName:'ZZ Solo Page', firstName:'Rahul', lastName:'Sadhu',
        mobile:'9800012398', email:'rahul.solo@example.com', rmName:currentUser, assignedTo:currentUser,
        dob:'2001-04-02', transformationForm:'SEVENEVENTS',
        createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('LMS', l); DB.leads.push(l); await save('leads');
      await sendIseqTo(l, 'LMS', {resend:true});
      const link = DB.docLinks.find(x=>x.token === l.iseqDocToken);
      return {id:l.id, token:l.iseqDocToken, type: link.type,
        rides: !!link.iseqType, cat: (formMeta(link.type)||{}).category};
    });
    token = r.token; lead = r.id;
    if(r.rides) throw new Error('this link rides on an input sheet — it is not the case being tested');
    if(r.cat !== 'ISEQ') throw new Error('the link is a "' + r.cat + '" form');
    return r.type + ', on its own link, with no input sheet under it';
  });

  await t.step('it opens on the questionnaire’s own page, not a wall of radio buttons', async () => {
    await t.doc(token, 1800);
    const r = await t.eval(()=>{
      const n = s => document.querySelectorAll(s).length;
      return {buttons: n('.fx-opt'), cards: n('.fx-quiz-card'), dots: n('.fx-dots i'),
        heading: (document.querySelector('.fx-q') || {}).textContent || '',
        progress: (document.querySelector('.fx-qidx') || {}).textContent || '',
        named: /Rahul Sadhu/.test(document.body.textContent),
        /* the generic renderer's visible grid must not also be on the page */
        genericGrid: n('.public-body .fg-cell')};
    });
    if(!r.buttons) throw new Error('no option buttons — it is still the generic form');
    if(r.genericGrid) throw new Error('the generic grid is on the page as well');
    if(!/Investor Suitability/.test(r.heading)) throw new Error('the heading reads "' + r.heading + '"');
    if(!r.named) throw new Error('it does not greet them by name');
    if(!/0 of \d+ answered/.test(r.progress)) throw new Error('the progress strip reads "' + r.progress + '"');
    if(r.dots !== r.cards - 1)
      throw new Error(r.dots + ' progress dots against ' + (r.cards - 1) + ' question cards');
    return r.cards - 1 + ' questions, one card each, ' + r.buttons + ' option buttons, and a progress strip';
  });

  await t.step('a pick lights the button and ticks the control the submit reads', async () => {
    const r = await t.eval(()=>{
      const before = document.querySelectorAll('#publicDocBody input:checked').length;
      document.querySelector('.fx-opt').click();
      return {before};
    });
    await t.wait(400);
    const after = await t.eval(()=>({
      lit: document.querySelectorAll('.fx-opt.sel').length,
      checked: document.querySelectorAll('#publicDocBody input:checked').length,
      progress: (document.querySelector('.fx-qidx') || {}).textContent || '',
      /* the hidden half is present but genuinely out of sight */
      hiddenHost: (()=>{ const el = document.getElementById('publicDocBody');
        return el ? Math.max(el.getBoundingClientRect().width, el.getBoundingClientRect().height) : -1; })(),
    }));
    if(r.before) throw new Error('something was already picked before the click');
    if(after.lit !== 1) throw new Error(after.lit + ' buttons are lit after one click');
    if(after.checked !== 1) throw new Error(after.checked + ' controls checked — the submit would read nothing');
    if(!/1 of \d+ answered/.test(after.progress)) throw new Error('the strip reads "' + after.progress + '"');
    if(after.hiddenHost > 2) throw new Error('the controls the submit reads are visible on the page');
    return 'one button lit, one control checked, the strip counts it, and the control is out of sight';
  });

  await t.step('and submitting scores it onto the lead exactly as it always did', async () => {
    await t.eval(async (tok)=>{
      const link = DB.docLinks.find(l=>l.token === tok);
      /* answered through the page itself, button by button, which is the
         whole point: no test-only path into the answers */
      iseqFieldsFor(link.type).filter(f=>(f.opts||[]).length).forEach(f=>{
        const card = document.getElementById('iseqq_' + f.k);
        const btn = card && card.querySelector('.fx-opt');
        if(btn) btn.click();
      });
      await submitDocForm(tok);
    }, token);
    await t.wait(900);
    await t.home();
    const r = await t.eval(async (id)=>{
      const res = await fetch('/api/storage/leads', {headers: apiHeaders()});
      const leads = JSON.parse((await res.json()).value);
      const l = (leads || []).find(x=>x.id === id) || {};
      return {score: l.iseqScore, cat: l.iseqCategory};
    }, lead);
    if(r.score === undefined || r.score === null)
      throw new Error('the lead has no score after the client answered on the new page');
    if(!r.cat) throw new Error('it has a score but no category');
    return 'ISEQ ' + r.score + ' · ' + r.cat + ' on the lead, answered entirely through the buttons';
  });

  await t.step('the page that rides on an input sheet is untouched', async () => {
    const r = await t.eval(()=>({
      solo: typeof renderIseqSoloPage === 'function',
      unified: typeof uniIseqPageHtml === 'function',
      /* the dispatch only takes a link with no sheet under it */
      guarded: /category === 'ISEQ' && !link\.iseqType/.test(String(renderPublicDocForm)),
    }));
    if(!r.solo || !r.unified) throw new Error('one of the two pages is missing');
    if(!r.guarded) throw new Error('the new page would take a link that rides on an input sheet too');
    return 'two entry points, one look; a link carrying an input sheet still goes the way it did';
  });
});
