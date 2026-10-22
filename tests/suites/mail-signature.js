/* A SIGNATURE THE FIRM BUILT AND NEVER SAW.

   Personal Settings has a proper signature editor — greeting, name,
   designation, the three contact lines, the social accounts, the firm's
   logo, the disclaimer — and it draws a handsome block. Somebody built
   theirs and then watched every letter go out ending in three typed
   lines instead: "Best regards," then the RM's name then the firm's.

   Two reasons, and both had to go.

   The letters BOSS ships ended with those three lines rather than with
   {Signature}, so there was nowhere for a signature to land. That tail
   IS the sign-off, and the signature is the better version of exactly
   it, so the 22 letters that are sent in a person's voice now put
   {Signature} there. The eight sent in the firm's voice — a support
   acknowledgement, the account-ready mail — keep theirs: nobody signs
   those personally.

   And the step that puts the signature on lived inside deliverMail(),
   so it reached the letters that went out that way and no others. The
   Compose Mail dialog on a lead or a client — the one somebody most
   obviously means by "sharing a mail" — posted straight to the mail
   server, and so did both campaign senders, which is odd given the
   setting governing all this is called campaign.autoSignature. It is a
   function now, and all four call it.

   A firm's stored copies of the letters are healed on load, matched on
   the tokens rather than the filled-in names so it can only touch the
   tail BOSS itself wrote. */
const {suite} = require('../lib/harness');

suite({mail: true}, async t => {

  await t.step('the letters sent in a person’s voice ask for a signature', async () => {
    const r = await t.eval(()=>{
      const d = (defaultConfig().mailTemplates) || {};
      const keys = Object.keys(d);
      const signed = keys.filter(k=>String((d[k]||{}).body || '').indexOf('{Signature}') >= 0);
      const oldTail = keys.filter(k=>/Best regards,\n\{RMName\}\n\{FirmName\}\s*$/.test((d[k]||{}).body || ''));
      const firmVoice = keys.filter(k=>/Best regards,\n\{FirmName\}\s*$/.test((d[k]||{}).body || ''));
      return {total: keys.length, signed: signed.length, oldTail, firmVoice: firmVoice.length};
    });
    if(r.oldTail.length)
      throw new Error(r.oldTail.length + ' letter(s) still end in the typed sign-off: ' + r.oldTail.slice(0,4).join(', '));
    if(r.signed < 20) throw new Error('only ' + r.signed + ' letters ask for a signature');
    if(!r.firmVoice) throw new Error('the firm-voiced letters lost their own sign-off too');
    return r.signed + ' of ' + r.total + ' letters put {Signature} where the typed sign-off was; '
      + r.firmVoice + ' sent in the firm’s voice keep theirs';
  });

  await t.step('a stored copy carrying the old tail is healed, and nothing else is', async () => {
    const r = await t.eval(async ()=>{
      DB.config.mailTemplates = DB.config.mailTemplates || {};
      const T = DB.config.mailTemplates;
      T.zzOld   = {subject:'ZZ old',   body:'Dear {Name},\n\nBody.\n\nBest regards,\n{RMName}\n{FirmName}'};
      T.zzOwn   = {subject:'ZZ own',   body:'Dear {Name},\n\nBody.\n\nYours sincerely,\nThe desk'};
      T.zzFirm  = {subject:'ZZ firm',  body:'Dear {Name},\n\nBody.\n\nBest regards,\n{FirmName}'};
      T.zzAlready = {subject:'ZZ already', body:'Dear {Name},\n\nBody.\n\n{Signature}'};
      T.zzMid   = {subject:'ZZ mid',   body:'Dear {Name},\n\nBest regards,\n{RMName}\n{FirmName}\n\nPS. more.'};
      await save('config');
      await healMailSignOffs();
      const out = {};
      ['zzOld','zzOwn','zzFirm','zzAlready','zzMid'].forEach(k=>{ out[k] = T[k].body; });
      ['zzOld','zzOwn','zzFirm','zzAlready','zzMid'].forEach(k=>{ delete T[k]; });
      await save('config');
      return out;
    });
    if(r.zzOld !== 'Dear {Name},\n\nBody.\n\n{Signature}')
      throw new Error('the old tail became: ' + JSON.stringify(r.zzOld));
    if(!/Yours sincerely/.test(r.zzOwn)) throw new Error('a firm’s own sign-off was rewritten');
    if(!/Best regards,\n\{FirmName\}$/.test(r.zzFirm)) throw new Error('a firm-voiced letter was rewritten');
    if(r.zzAlready !== 'Dear {Name},\n\nBody.\n\n{Signature}') throw new Error('one already signed was touched');
    if(!/PS\. more\.$/.test(r.zzMid)) throw new Error('a tail that is not the tail was rewritten');
    return 'the shipped tail swapped; a firm’s own wording, a firm-voiced letter, one already signed and '
      + 'one with the words mid-letter all left alone';
  });

  await t.step('the signature reaches the letter, with the person on it', async () => {
    t.mail.clear();
    const sent = await t.eval(async ()=>{
      const me0 = me();
      me0.sig = {greeting:'Best Regards,', name:'ZZ Vishal Signed', designation:'ZZ Relationship Manager',
        email:'zz.vishal@zz.in', phone:'9800000011', location:'Varanasi', socials:[],
        showLogo:false, showDisclaimer:false};
      await save('team');
      const l = {id:uid('LMS'), firstName:'ZZ Sig', lastName:'Reader', mobile:'9800000012',
        email:'zz.sig.reader@example.com', assignedTo:currentUser,
        createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('LMS', l); DB.leads.push(l); await save('leads');
      const tpl = mailTemplateOf('fqSend');
      const vars = {Name:'ZZ Sig Reader', Form:'FQ Assessment', Link:'https://example.in/x',
        RMName: teamName(currentUser), FirmName:(DB.config.company||{}).name || ''};
      const r = await deliverMail({to: l.email, subject: fillTemplate(tpl.subject, vars),
        body: fillTemplate(tpl.body, vars), module:'LMS', recordId:l.id});
      return {ok: r && r.ok !== false, body: fillTemplate(tpl.body, vars)};
    });
    if(!sent.ok) throw new Error('the send was refused');
    if(sent.body.indexOf('{Signature}') < 0)
      throw new Error('the template no longer carries {Signature}');
    await t.wait(800);
    if(!t.mail.received.length) throw new Error('the mail server was handed nothing');
    const m = t.mail.received[t.mail.received.length - 1];
    const raw = m.raw || (m.text + (m.html || ''));
    if(raw.indexOf('ZZ Vishal Signed') < 0) throw new Error('the sender’s name is not on the letter');
    if(raw.indexOf('ZZ Relationship Manager') < 0) throw new Error('their designation is not on it');
    if(raw.indexOf('zz.vishal@zz.in') < 0) throw new Error('their contact email is not on it');
    if(/\{Signature\}/.test(raw)) throw new Error('{Signature} went out as the word');
    if(!/<div/i.test(raw)) throw new Error('a letter carrying a signature must go as HTML');
    return 'name, designation and contact details all on the delivered letter, and it went as HTML';
  });

  await t.step('and so does one sent from Compose Mail, which used to bypass all of it', async () => {
    const r = await t.eval(()=>{
      const plain = mailApplySignature('Dear ZZ,\n\nA line.\n\n{Signature}', currentUser);
      const none  = mailApplySignature('Dear ZZ,\n\nA line.', currentUser);
      const src = String(submitComposeMail);
      return {signed: plain.body, signedHtml: plain.html,
        bare: none.body, bareHtml: none.html,
        composeSigns: /mailApplySignature/.test(src),
        composeFlagsHtml: /html:\s*signed\.html/.test(src)};
    });
    if(!r.signedHtml) throw new Error('a letter asking for a signature did not come back as HTML');
    if(r.signed.indexOf('ZZ Vishal Signed') < 0) throw new Error('the signature is not in the body');
    if(/\{Signature\}/.test(r.signed)) throw new Error('the token survived');
    if(r.bareHtml || r.bare !== 'Dear ZZ,\n\nA line.')
      throw new Error('a letter that asks for nothing was changed: ' + JSON.stringify(r.bare));
    if(!r.composeSigns) throw new Error('Compose Mail still does not sign');
    if(!r.composeFlagsHtml) throw new Error('Compose Mail signs but does not tell the server it is HTML');
    return 'Compose Mail signs and flags HTML; a letter with no signature in it is byte-for-byte unchanged';
  });

  await t.step('both campaign senders sign too, which is what the setting was named for', async () => {
    const r = await t.eval(()=>{
      const names = ['runCampaignDrip','sendCampaignNow','campaignSend','runDripJourneys'];
      const found = names.filter(n=>typeof window[n] === 'function');
      const src = found.map(n=>String(window[n])).join('\n');
      const all = Object.getOwnPropertyNames(window).filter(k=>{
        try { return typeof window[k] === 'function' && /\/api\/mail\/send/.test(String(window[k])); }
        catch(e){ return false; }
      });
      const unsigned = all.filter(k=>!/mailApplySignature/.test(String(window[k])));
      return {senders: all, unsigned, probe: src.length};
    });
    if(r.unsigned.length)
      throw new Error('these still post to the mail server without a signature: ' + r.unsigned.join(', '));
    if(r.senders.length < 3)
      throw new Error('only ' + r.senders.length + ' send path(s) found — the probe is not reaching them');
    return r.senders.length + ' send paths reach the mail server, and every one of them signs';
  });
});
