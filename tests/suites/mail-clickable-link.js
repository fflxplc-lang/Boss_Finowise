/* THE LINK IN A LETTER HAS TO BE A LINK.

   The FQ invitation's whole purpose is the address it carries. It was
   arriving as dead grey text: a signed letter goes out as HTML, the body
   is written as plain text and escaped on the way, and an escaped URL is
   just characters. The client had to select it and paste it into a bar.

   So the addresses are turned into anchors once the text is safe — after
   escaping, so a template cannot smuggle markup through the same door —
   and the sent-mail log reads the letter the way the client saw it. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();

  t.section('the letter that goes out');

  await t.step('the FQ invitation carries an address the client can press', async () => {
    const r = await t.eval(async ()=>{
      /* A signature is what puts a letter on the HTML route at all, so
         give the sender one the way Setup would. */
      let me = DB.team.find(x=>x.id === currentUser);
      if(!me){ me = {id: currentUser, name:'ZZ Link Sender'}; DB.team.push(me); }
      me.sig = Object.assign({}, me.sig||{}, {name:'ZZ Link Sender', designation:'Adviser',
        email:'zz.link@example.com'});
      await save('team');
      const tpl = DB.config.mailTemplates['fqSend']
        || {subject:'FQ', body:'Link: {Link}\n\n{Signature}'};
      const url = docUrl('DOC-ZZLINK01');
      const body = fillTemplate(tpl.body, {Name:'ZZ Link Client', Link:url,
        Signature:'{Signature}'});
      const signed = mailApplySignature(body, currentUser);
      return {html: signed.html, out: signed.body, url};
    });
    if(!r.html) throw new Error('the signed letter did not go out as HTML at all');
    const href = 'href="' + r.url + '"';
    if(r.out.indexOf(href) < 0) throw new Error('no anchor on the link — looked for ' + href);
    if(!/<a href="[^"]*\?doc=DOC-ZZLINK01"[^>]*>https?:\/\/[^<]*DOC-ZZLINK01<\/a>/.test(r.out))
      throw new Error('the anchor does not show the address as its own text');
    if(!/target="_blank"/.test(r.out)) throw new Error('the link does not open in its own tab');
    if(!/rel="noopener"/.test(r.out)) throw new Error('the link is opened without rel=noopener');
    return 'the FQ letter leaves with <a href="…?doc=DOC-ZZLINK01"> round its address, opening in its own tab';
  });

  await t.step('and nothing else in the letter became markup', async () => {
    const r = await t.eval(async ()=>{
      const signed = mailApplySignature(
        'Dear <b>Name</b>,\n\nOpen https://boss.example.in/?doc=DOC-ZZ2 to begin.\n\n{Signature}',
        currentUser);
      return signed.body;
    });
    if(/<b>Name<\/b>/.test(r)) throw new Error('a tag typed into the body was passed through as markup');
    if(r.indexOf('&lt;b&gt;Name&lt;/b&gt;') < 0) throw new Error('the typed tag was not escaped');
    if(r.indexOf('href="https://boss.example.in/?doc=DOC-ZZ2"') < 0)
      throw new Error('the address in the same body was not linked');
    return 'the typed tag is still &lt;b&gt;, the address beside it is an anchor — escaping first, linking after';
  });

  await t.step('a full stop after the address is not part of it', async () => {
    const r = await t.eval(async ()=>mailApplySignature(
      'Open https://boss.example.in/?doc=DOC-ZZ3.\n\n{Signature}', currentUser).body);
    if(r.indexOf('href="https://boss.example.in/?doc=DOC-ZZ3"') < 0)
      throw new Error('the trailing full stop was swallowed into the address');
    if(!/<\/a>\.</.test(r)) throw new Error('the full stop did not survive outside the anchor');
    return 'the anchor ends at DOC-ZZ3 and the sentence still ends with a full stop';
  });

  t.section('and the log reads the way the letter did');

  await t.step('a plain-text letter is clickable where it is read back', async () => {
    const r = await t.eval(async ()=>{
      const m = {body:'Open https://boss.example.in/?doc=DOC-ZZ4 to begin.', html:false};
      return {html: mailBodyHtml(m), text: mailBodyText(m)};
    });
    if(r.html.indexOf('href="https://boss.example.in/?doc=DOC-ZZ4"') < 0)
      throw new Error('the Sent Mail view left the address as dead text');
    if(r.text !== 'Open https://boss.example.in/?doc=DOC-ZZ4 to begin.')
      throw new Error('reading it back as plain text no longer gives the letter: ' + r.text);
    return 'the log shows it as a link and still searches as the plain sentence';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | '));
    return 'no dialogs';
  });
});
