/* THE LETTERS THE FIRM ACTUALLY SENDS.

   The CRM has always recorded what it "sent"; with a connector configured it
   really sends, over a plain socket, with no library in between. So this
   stands up a mail server of its own (lib/smtp.js), points the connector at
   it — and lets the CRM prove the connection for itself, because the server
   refuses to send until a test has genuinely passed — and then reads what
   comes out of the other end.

   What matters here is not that a send was attempted but that the letter is
   the firm's own: their wording, from Settings, with the tokens filled in
   and none left showing. A {Name} that reaches a client is worse than no
   letter at all. */
const {suite} = require('../lib/harness');

suite({mail: true}, async t => {

  t.section('the connector');

  await t.step('the CRM proves the connection before it will send', async () => {
    const c = await t.eval(async ()=>{
      const r = await fetch('/api/connections'); const list = await r.json();
      const e = (Array.isArray(list) ? list : list.connections || []).find(x => x.id === 'email');
      return e ? {status: e.status, enabled: e.enabled} : null;
    });
    if(!c) throw new Error('there is no email connector');
    if(c.status !== 'Connected') throw new Error('the connector reads "' + c.status + '"');
    if(!c.enabled) throw new Error('the connector is not enabled');
    return 'Connected, and it had to talk to the server to say so';
  });

  t.section('a letter, end to end');

  await t.step('the FQ assessment goes out in the firm’s own words', async () => {
    t.mail.clear();
    const lead = await t.eval(async ()=>{
      const l = {id:uid('LEAD'), leadName:'ZZ Mail Lead', firstName:'Anita', lastName:'Rao',
        mobile:'9800055555', email:'anita.rao@example.com', rmName:currentUser,
        createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('LMS', l); DB.leads.push(l); await save('leads');
      return l.id;
    });
    const sent = await t.eval(async (id)=>{
      const tpl = mailTemplateOf('fqSend');
      const rec = DB.leads.find(x=>x.id===id);
      const token = await createDocLink(id, 'FQ_YOUNG');
      const vars = {Name: leadName(id), Form: 'FQ Assessment', Link: docUrl(token),
                    RMName: currentUser, FirmName: (DB.config.company||{}).name || ''};
      const r = await deliverMail({to: rec.email,
        subject: fillTemplate(tpl.subject, vars), body: fillTemplate(tpl.body, vars)});
      return {ok: r && r.ok !== false, subject: fillTemplate(tpl.subject, vars)};
    }, lead);
    if(!sent.ok) throw new Error('the send was refused');
    await t.wait(700);
    if(!t.mail.received.length) throw new Error('the mail server was handed nothing');
    const m = t.mail.received[t.mail.received.length - 1];
    if(!/anita\.rao@example\.com/.test(m.to.join(',')))
      throw new Error('it went to ' + m.to.join(', '));
    if(!/Anita/.test(m.text)) throw new Error('the letter does not greet them by name');
    if(/\{[A-Za-z]+\}/.test(m.text))
      throw new Error('a token was left showing: ' + (/\{[A-Za-z]+\}/.exec(m.text) || [])[0]);
    if(!/\?doc=/.test(m.text)) throw new Error('the letter carries no link');
    return 'to ' + m.to.join(', ') + ' — "' + m.subject.slice(0, 48) + '…"';
  });

  await t.step('the link travels in the letter, and nowhere else', async () => {
    /* The stage used to print the client's own link under the FQ panel,
       which made it something to copy and pass on by hand — out of the
       firm's records, round whatever the mail says, and into a chat
       window. The link belongs to the lead and reaches them by mail. */
    t.mail.clear();
    const r = await t.eval(async ()=>{
      const l = {id:uid('LEAD'), leadName:'ZZ Link Lead', firstName:'Vikram', lastName:'Rao',
        mobile:'9800055111', email:'vikram.rao@example.com', rmName:currentUser, assignedTo:currentUser,
        createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('LMS', l); DB.leads.push(l); await save('leads');
      openSendFqModal('LMS', l.id, '');
      const opened = !!document.getElementById('f_fqEmail');
      if(opened) await submitSendFq(l.id, '');
      const rec = DB.leads.find(x=>x.id === l.id);
      return {opened, token: rec.fqDocToken || '', url: rec.fqDocToken ? docUrl(rec.fqDocToken) : '',
              sent: !!rec.fqSentAt, panel: qualifyFqPanelHtml(rec, true).replace(/\s+/g, ' ')};
    });
    if(!r.opened) throw new Error('the send dialog did not open');
    if(!r.token || !r.sent) throw new Error('nothing was sent');
    if(r.panel.indexOf(r.url) >= 0) throw new Error('the stage still prints the link');
    if(/\?doc=/.test(r.panel)) throw new Error('the stage still prints a document link');
    if(!/in the mail that went to/.test(r.panel) || r.panel.indexOf('vikram.rao@example.com') < 0)
      throw new Error('the stage does not say where the link went: ' + r.panel.slice(0, 200));
    if(!/Send the assessment again/.test(r.panel))
      throw new Error('and it offers no way to send a fresh one');
    await t.wait(700);
    const m = t.mail.received[t.mail.received.length - 1];
    if(!m) throw new Error('nothing reached the mail server');
    if(m.text.indexOf(r.url) < 0) throw new Error('the letter does not carry the link');
    return 'the letter to ' + m.to.join(', ') + ' carries the link; the stage names the address it went to '
      + 'and offers to send it again, and prints no link at all';
  });

  t.section('Settings is the source of truth');

  await t.step('an edited template is the one that goes out', async () => {
    t.mail.clear();
    const out = await t.eval(async ()=>{
      DB.config.mailTemplates.fqSend = {subject: 'A subject the firm typed',
        body: 'Dear {Name},\n\nThe firm wrote this line itself.\n\n{Link}\n\n{RMName}'};
      await save('config');
      const token = await createDocLink(null, 'FQ_YOUNG');
      const tpl = mailTemplateOf('fqSend');
      const vars = {Name:'Anita', Link: docUrl(token), RMName: currentUser};
      const r = await deliverMail({to:'anita.rao@example.com',
        subject: fillTemplate(tpl.subject, vars), body: fillTemplate(tpl.body, vars)});
      return r && r.ok !== false;
    });
    if(!out) throw new Error('the send was refused');
    await t.wait(700);
    const m = t.mail.received[t.mail.received.length - 1];
    if(!m) throw new Error('nothing arrived');
    if(!/A subject the firm typed/.test(m.subject))
      throw new Error('the subject reads "' + m.subject + '"');
    if(!/The firm wrote this line itself/.test(m.text))
      throw new Error('the body is not the one in Settings');
    return 'what Settings holds is what the client receives';
  });

  await t.step('the wording migration carries an old database forward', async () => {
    const r = await t.eval(async ()=>{
      const at = Number(DB.config.mailWordingRevision) || 0;
      return {at, latest: MAIL_WORDING_REVISION,
              revisions: MAIL_WORDING_REVISIONS.map(x=>x.n)};
    });
    if(r.at !== r.latest)
      throw new Error('the store is on revision ' + r.at + ' and the code on ' + r.latest);
    return 'revision ' + r.at + ' of ' + r.revisions.join('/');
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
