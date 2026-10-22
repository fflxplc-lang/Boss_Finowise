/* THE LETTER IN THE LOG, NOT THE LETTER'S SOURCE.

   Signatures made the firm's mail HTML — that is the only way the logo
   and the coloured contact rows draw at all. The log keeps the body it
   sent, so what it keeps became markup, and every view escaped it. The
   Communication Log, the Sent Mail tab and the Mail section all filled
   up with

       <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px…

   which is the letter's source where the letter should be. It was
   unsearchable besides: every signed mail matched "Arial".

   So the log records whether what it holds is markup, every view reads
   it through one pair of readers, and a mail logged before the flag
   existed is still drawn properly — its body is sniffed, because
   nothing BOSS writes as plain text has ever begun with a tag.

   What must NOT change: a plain-text letter, a note typed into Log a
   Touch, a WhatsApp message. Those are text, they stay escaped, and
   they keep their line breaks. */
const {suite} = require('../lib/harness');

suite(async t => {

  t.section('what the log records');

  await t.step('a signed letter is logged as markup, a plain one as text', async () => {
    const r = await t.eval(async ()=>{
      const u = DB.team.find(x=>x.id === currentUser);
      u.sig = {greeting:'Best Regards,', name:'ZZ Signer', designation:'Adviser',
               email:'zz@example.com', phone:'9800011111', location:'Mumbai',
               socials:[], showLogo:false, showDisclaimer:false};
      await save('team');
      const signed = mailApplySignature('Dear Anita,\n\nThe body.\n\n{Signature}', currentUser);
      const plain  = mailApplySignature('Dear Anita,\n\nNo sign-off asked for.', currentUser);
      return {signedHtml: signed.html, plainHtml: plain.html,
              signedBody: signed.body, plainBody: plain.body};
    });
    if(!r.signedHtml) throw new Error('a letter asking for a signature did not come back as markup');
    if(r.plainHtml) throw new Error('a letter that asked for nothing was turned into markup');
    if(r.plainBody !== 'Dear Anita,\n\nNo sign-off asked for.')
      throw new Error('the plain letter was altered: ' + JSON.stringify(r.plainBody));
    if(r.signedBody.indexOf('ZZ Signer') < 0) throw new Error('the signature is not in the letter');
    return 'one came back as markup, the other exactly as it went in';
  });

  await t.step('deliverMail writes the flag onto the log entry', async () => {
    const r = await t.eval(async ()=>{
      const l = {id:uid('LEAD'), leadName:'ZZ Log Lead', firstName:'Anita', lastName:'Rao',
        mobile:'9800022222', email:'zz.log@example.com', rmName:currentUser, assignedTo:currentUser,
        createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('LMS', l); DB.leads.push(l); await save('leads');
      await deliverMail({to:l.email, subject:'ZZ signed letter',
        body:'Dear Anita,\n\nThe body.\n\n{Signature}', module:'LMS', recordId:l.id, leadId:l.id});
      const m = (DB.communications||[]).filter(x=>x.leadId===l.id).pop();
      return {leadId:l.id, html:(m||{}).html, body:((m||{}).body||'').slice(0,40)};
    });
    if(r.html !== true) throw new Error('the entry reads html=' + JSON.stringify(r.html));
    if(r.body.charAt(0) !== '<') throw new Error('and it did not store markup: ' + r.body);
    t.state = t.state || {}; t.state.leadId = r.leadId;
    return 'the entry says it holds markup, and it does';
  });

  t.section('what every view shows');

  await t.step('the Sent Mail tab draws the letter, not its source', async () => {
    const r = await t.eval((leadId)=>{
      const html = sentMailCard('LMS', leadId);
      return {html, shows: html.indexOf('&lt;div style=') >= 0,
              letter: html.indexOf('class="cp-commbody as-letter"') >= 0,
              name: html.indexOf('ZZ Signer') >= 0};
    }, t.state.leadId);
    if(r.shows) throw new Error('the tab still prints escaped markup');
    if(!r.letter) throw new Error('the body is not drawn as a letter');
    if(!r.name) throw new Error('the signature does not appear in it');
    return 'the Sent Mail tab shows the letter, signature and all';
  });

  await t.step('a mail logged before the flag existed is drawn too', async () => {
    const r = await t.eval(()=>{
      const old = {id:'COM-ZZOLD', channel:'Email', direction:'Outbound', status:'Sent',
        subject:'ZZ older letter', address:'zz.old@example.com', at:new Date().toISOString(),
        by:currentUser,
        body:'<div style="font-family:Arial">Dear Anita,<br><br>An older letter.'
             + '<div class="sig-html">ZZ Signer</div></div>'};
      const typed = {id:'COM-ZZTXT', channel:'Phone Call', direction:'Outbound', status:'Logged',
        subject:'ZZ a typed note', at:new Date().toISOString(), by:currentUser,
        body:'Spoke to them.\nThey will send the PAN.\n\n5 < 6 & more.'};
      return {oldIsHtml: mailBodyIsHtml(old), typedIsHtml: mailBodyIsHtml(typed),
              oldDrawn: mailBodyHtml(old), typedDrawn: mailBodyHtml(typed),
              typedClass: mailBodyHtmlAttr(typed), oldClass: mailBodyHtmlAttr(old)};
    });
    if(!r.oldIsHtml) throw new Error('the older letter was not recognised as markup');
    if(r.typedIsHtml) throw new Error('a typed note was mistaken for markup');
    if(r.oldDrawn.indexOf('&lt;') >= 0) throw new Error('the older letter is still escaped');
    if(r.typedDrawn !== 'Spoke to them.\nThey will send the PAN.\n\n5 &lt; 6 &amp; more.')
      throw new Error('a typed note was not escaped as it used to be: ' + r.typedDrawn);
    if(r.typedClass !== 'cp-commbody') throw new Error('a typed note lost its plain styling');
    if(r.oldClass.indexOf('as-letter') < 0) throw new Error('the older letter is not drawn as one');
    return 'the sniff reads the older letter right, and leaves a typed note exactly as it was';
  });

  t.section('and the search finds the words, not the styling');

  await t.step('a letter is searchable by what it says', async () => {
    const r = await t.eval(()=>{
      const m = {html:true,
        body:'<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px">'
             + 'Dear Anita,<br><br>Your Golden Age Blueprint is ready.<br>'
             + '<div class="sig-html">ZZ Signer</div></div>'};
      const text = mailBodyText(m);
      return {text, says: text.indexOf('Golden Age Blueprint') >= 0,
              styling: /Arial|font-family|<div/.test(text)};
    });
    if(!r.says) throw new Error('the words of the letter are not readable: ' + r.text);
    if(r.styling) throw new Error('the styling is still in the searchable text: ' + r.text);
    if(r.text.indexOf('Dear Anita,\n') !== 0)
      throw new Error('the line breaks did not survive: ' + JSON.stringify(r.text.slice(0, 40)));
    return '"' + r.text.replace(/\n+/g, ' / ').slice(0, 64) + '…"';
  });

  await t.step('the Mail section opens the letter rather than its markup', async () => {
    const r = await t.eval(async (leadId)=>{
      const m = (DB.communications||[]).filter(x=>x.leadId===leadId).pop();
      openMailDetail(m.id);
      const host = document.querySelector('.modal .cp-commbody');
      const out = {found: !!host, cls: host ? host.className : '',
                   text: host ? (host.textContent||'').slice(0,60) : '',
                   raw: host ? host.innerHTML.indexOf('&lt;div') >= 0 : false};
      closeModal();
      return out;
    }, t.state.leadId);
    if(!r.found) throw new Error('the detail window shows no body');
    if(r.raw) throw new Error('it still prints escaped markup');
    if(r.cls.indexOf('as-letter') < 0) throw new Error('it is not drawn as a letter: ' + r.cls);
    if(r.text.indexOf('<') >= 0) throw new Error('the reader sees tags: ' + r.text);
    return 'the detail window reads "' + r.text.trim().slice(0, 40) + '…"';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
