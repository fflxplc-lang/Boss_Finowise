/* THE SWITCH, AND THE LETTERS THE FIRM WRITES ITSELF.

   Two things the firm asked for, and both are the kind that are only
   believed when they are exercised rather than looked at.

   The switch has to actually stop mail. Not stop the obvious senders
   and leave one route open — every letter BOSS sends goes through
   deliverMail(), so that is where it is tested, and what is tested is
   that a held letter is written down rather than lost.

   The stage letters have to actually fire. A screen that lets somebody
   build a stage, a template and a rule, and then sends nothing when a
   record reaches that step, is worse than no screen. So the test builds
   one the way a person would and then moves a real lead through the
   real transition.

   The mail server here is the suite's own, so "sent" means a letter
   arrived, not that a function returned. */
const {suite} = require('../lib/harness');

/* The fake server keeps letters in .received and matches on a regex; this
   is the small wait that goes with it, because a send is a round trip. */
const waitForMail = async (t, re, ms) => {
  const until = Date.now() + (ms || 6000);
  while(Date.now() < until){
    const hit = t.mail.matching(re);
    if(hit.length) return hit[hit.length - 1];
    await t.wait(200);
  }
  return null;
};

suite({mail:true}, async t => {

  await t.step('the firm has a working mailbox, so sending means sending', async () => {
    await t.useMail();
    const r = await t.eval(()=>({ready: mailChannel.ready, from: mailChannel.from}));
    if(!r.ready) throw new Error('the connector is not ready: ' + JSON.stringify(r));
    return 'delivering through ' + r.from;
  });

  t.section('email outflow, on and off');

  await t.step('it is on unless the firm says otherwise', async () => {
    const r = await t.eval(()=>({on: mailOutflowOn(), stored: DB.config.mailOutflow}));
    if(!r.on) throw new Error('a fresh system starts with outflow off');
    return 'on by default, with nothing stored to say so';
  });

  await t.step('Setup carries the toggle, and it says which way it is', async () => {
    const r = await t.eval(()=>{
      navigate('settings','email');
      const c = document.getElementById('content');
      const btn = Array.from(c.querySelectorAll('button')).find(b=>/Switch outflow/.test(b.textContent));
      return {here: c.textContent.indexOf('Email outflow') >= 0,
              label: btn ? btn.textContent.trim() : '',
              says: c.textContent.indexOf('BOSS is sending') >= 0};
    });
    if(!r.here) throw new Error('there is no Email outflow block');
    if(!/Switch outflow off/.test(r.label)) throw new Error('the button reads "' + r.label + '"');
    if(!r.says) throw new Error('it does not say what the current state means');
    return 'Active, and the button offers to switch it off';
  });

  await t.step('with it on, a letter genuinely leaves', async () => {
    t.mail.clear();
    const r = await t.eval(async ()=>{
      const res = await deliverMail({to:'on@example.com', subject:'ZZ Outflow On',
        body:'this one should go', label:'Test'});
      return {status: res.status, sent: res.sent};
    });
    if(r.status !== 'Sent') throw new Error('it came back ' + r.status + ' with outflow on');
    const got = await waitForMail(t, /ZZ Outflow On/, 6000);
    if(!got) throw new Error('nothing reached the mail server');
    return 'arrived at the mail server';
  });

  await t.step('with it off, nothing leaves at all', async () => {
    t.mail.clear();
    const r = await t.eval(async ()=>{
      await setMailOutflow(false);
      const res = await deliverMail({to:'off@example.com', subject:'ZZ Outflow Off',
        body:'this one must not go', label:'Test'});
      return {status: res.status, sent: res.sent, note: res.note, on: mailOutflowOn()};
    });
    if(r.on) throw new Error('the switch did not take');
    if(r.sent) throw new Error('it reported the letter as sent');
    if(r.status !== 'Held') throw new Error('it came back as ' + r.status + ', expected Held');
    if(!/outflow is switched off/i.test(r.note)) throw new Error('its reason reads: ' + r.note);
    await t.wait(1500);
    const leaked = t.mail.matching(/ZZ Outflow Off/).length;
    if(leaked) throw new Error('the letter reached the mail server anyway');
    return 'held, and the mail server saw nothing';
  });

  await t.step('a held letter is written down, not lost', async () => {
    const r = await t.eval(()=>{
      const held = (DB.communications||[]).filter(m=>m.status === 'Held');
      const last = held[held.length - 1] || {};
      return {n: held.length, subject: last.subject, to: last.address, why: last.statusNote};
    });
    if(!r.n) throw new Error('nothing was logged');
    if(r.subject !== 'ZZ Outflow Off') throw new Error('the log shows "' + r.subject + '"');
    if(r.to !== 'off@example.com') throw new Error('it lost the address');
    if(!/outflow is switched off/i.test(r.why||'')) throw new Error('no reason on the log entry');
    return 'the letter, its address and the reason are all on the record';
  });

  await t.step('and switching it back on sends again', async () => {
    t.mail.clear();
    const r = await t.eval(async ()=>{
      await setMailOutflow(true);
      const res = await deliverMail({to:'again@example.com', subject:'ZZ Outflow Back On',
        body:'and this one goes', label:'Test'});
      return {status: res.status, on: mailOutflowOn()};
    });
    if(!r.on || r.status !== 'Sent') throw new Error('it came back ' + r.status);
    const got = await waitForMail(t, /ZZ Outflow Back On/, 6000);
    if(!got) throw new Error('nothing reached the mail server after switching back on');
    return 'sending again';
  });

  await t.step('the switch is in the settings change history', async () => {
    const n = await t.eval(()=>DB.settingsAudit.filter(a=>a.key === 'mail.outflow').length);
    if(n < 2) throw new Error('only ' + n + ' entries for two changes');
    return n + ' entries — off and on again';
  });

  t.section('a stage, a template and a rule, built the way a person would');

  await t.step('Setup carries the manager for all three', async () => {
    const r = await t.eval(()=>{
      navigate('settings','mailtemplates');
      const c = document.getElementById('content');
      return {box: !!document.getElementById('mailDynBox'),
              stage: !!document.getElementById('mailStageName'),
              tpl: !!document.getElementById('newTplName'),
              rule: !!document.getElementById('ruleModule') && !!document.getElementById('ruleState')
                 && !!document.getElementById('ruleTemplate'),
              text: c.textContent.indexOf('not a release') >= 0};
    });
    if(!r.box) throw new Error('the manager is not on the screen');
    if(!r.stage) throw new Error('no way to add a stage');
    if(!r.tpl) throw new Error('no way to add a template');
    if(!r.rule) throw new Error('no way to map one to a step of a workflow');
    return 'stages, templates and rules, all three on one screen';
  });

  await t.step('a new stage appears, and a template can be filed under it', async () => {
    const r = await t.eval(async ()=>{
      document.getElementById('mailStageName').value = 'ZZ Renewals';
      document.getElementById('mailStageNote').value = 'Letters about a renewal falling due';
      await addMailStage();
      const st = mailStages().find(x=>x.name === 'ZZ Renewals');
      if(!st) return {err:'the stage was not added'};
      document.getElementById('newTplName').value = 'ZZ Renewal Due';
      document.getElementById('newTplStage').value = st.id;
      await addMailTemplate();
      const tpl = allMailTemplates().find(x=>x.name === 'ZZ Renewal Due');
      return {stage: st.id, stageName: st.name, tplKey: tpl && tpl.key,
              tplStage: tpl && tpl.stage, filed: allMailTemplates().filter(x=>x.stage === st.id).length};
    });
    if(r.err) throw new Error(r.err);
    if(!r.tplKey) throw new Error('the template was not created');
    if(r.tplStage !== r.stage) throw new Error('it was filed under ' + r.tplStage);
    if(r.filed !== 1) throw new Error(r.filed + ' templates under the new stage');
    return '"' + r.stageName + '" with "' + r.tplKey + '" under it';
  });

  await t.step('the wording is written in the same editor as every other', async () => {
    const r = await t.eval(async ()=>{
      const tpl = allMailTemplates().find(x=>x.name === 'ZZ Renewal Due');
      mailTemplateGroup = tpl.stage;
      navigate('settings','mailtemplates');
      const subj = document.getElementById('mt2_subj_' + tpl.key);
      const body = document.getElementById('mt2_body_' + tpl.key);
      if(!subj || !body) return {err:'the new template has no editor'};
      subj.value = 'ZZ Renewal for {Name}';
      body.value = 'Dear {Name}, your {Module} record reached {Stage} on {Date}. — {FirmName}';
      await saveMailTemplate(tpl.key, true);
      const saved = mailTemplateOf(tpl.key);
      return {key: tpl.key, subject: saved.subject, body: saved.body};
    });
    if(r.err) throw new Error(r.err);
    if(r.subject !== 'ZZ Renewal for {Name}') throw new Error('it saved "' + r.subject + '"');
    return 'subject and body saved against ' + r.key;
  });

  await t.step('mapping it to a step of the LMS workflow', async () => {
    const r = await t.eval(async ()=>{
      const tpl = allMailTemplates().find(x=>x.name === 'ZZ Renewal Due');
      /* A step with nothing gating it, so what is being tested is the
         rule firing and not a stage prerequisite. Qualify, for instance,
         is held until the FQ result comes back. */
      const state = mailRuleStates('LMS').find(s=>s.id === 'readyToQualify') || mailRuleStates('LMS')[1];
      window._mailRuleModule = 'LMS';
      navigate('settings','mailtemplates');
      document.getElementById('mailDynBox').open = true;
      document.getElementById('ruleModule').value = 'LMS';
      document.getElementById('ruleState').value = state.id;
      document.getElementById('ruleTemplate').value = tpl.key;
      await addMailRule();
      const rule = mailRules().find(x=>x.template === tpl.key);
      return {state: state.id, label: state.label, rule: !!rule, module: rule && rule.module,
              active: rule && rule.active, n: mailRules().length};
    });
    if(!r.rule) throw new Error('the rule was not added');
    if(r.module !== 'LMS') throw new Error('it was filed against ' + r.module);
    if(!r.active) throw new Error('it was added switched off');
    return 'LMS · ' + r.label + ' → ZZ Renewal Due';
  });

  await t.step('and a lead reaching that step is actually sent it', async () => {
    /* The whole point. A real lead, the real transition, the real mail
       server — no shortcut through the rule engine. */
    t.mail.clear();
    const r = await t.eval(async ()=>{
      const rule = mailRules().find(x=>(mailTemplateMeta(x.template)||{}).name === 'ZZ Renewal Due');
      const bp = getBlueprint('LMS');
      const into = bp.transitions.find(x=>x.to === rule.state);
      if(!into) return {err:'no transition reaches ' + rule.state};
      const l = {id:uid('LEAD'), leadName:'ZZ Rule Lead', firstName:'ZZ', lastName:'Rule',
        email:'rulelead@example.com', mobile:'9800000055', assignedTo:currentUser,
        branch:(DB.config.branches||['Varanasi'])[0],
        createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('LMS', l);
      l[RECORD_STATE_FIELD.LMS] = into.from;          // stand it just before the step
      DB.leads.push(l);
      await save('leads');
      await doTransition('LMS', l.id, into.id);
      return {state: stateOf('LMS', DB.leads.find(x=>x.id===l.id)), want: rule.state, id: l.id};
    });
    if(r.err) throw new Error(r.err);
    if(r.state !== r.want) throw new Error('the lead is at ' + r.state + ', not ' + r.want);
    const got = await waitForMail(t, /ZZ Renewal for ZZ Rule/, 8000);
    if(!got) throw new Error('the lead reached the step and no letter went out');
    /* .text is the decoded body; .body is the raw message with its headers. */
    const text = got.text || '';
    if(!/reached/.test(text)) throw new Error('the body did not come through: ' + text.slice(0,140));
    if(!/ZZ Rule/.test(text)) throw new Error('{Name} did not reach the body: ' + text.slice(0,140));
    if(!/Qualification|readyToQualify|Ready/i.test(text))
      throw new Error('{Stage} did not reach the body: ' + text.slice(0,140));
    if(/\{Name\}|\{Stage\}|\{FirmName\}|\{Module\}|\{Date\}/.test((got.subject||'') + text))
      throw new Error('a placeholder was left unfilled: ' + got.subject + ' / ' + text.slice(0,140));
    return 'arrived: "' + got.subject + '"';
  });

  t.section('switching one off, and remapping it');

  await t.step('a template switched off stops being sent', async () => {
    t.mail.clear();
    const r = await t.eval(async ()=>{
      const tpl = allMailTemplates().find(x=>x.name === 'ZZ Renewal Due');
      await setMailTemplateActive(tpl.key, false);
      const rule = mailRules().find(x=>x.template === tpl.key);
      const bp = getBlueprint('LMS');
      const into = bp.transitions.find(x=>x.to === rule.state);
      const l = {id:uid('LEAD'), leadName:'ZZ Off Lead', firstName:'ZZ', lastName:'Off',
        email:'offlead@example.com', assignedTo:currentUser,
        createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('LMS', l);
      l[RECORD_STATE_FIELD.LMS] = into.from;
      DB.leads.push(l);
      await save('leads');
      await doTransition('LMS', l.id, into.id);
      const live = mailTemplateIsActive(tpl.key);
      await setMailTemplateActive(tpl.key, true);
      return {live, key: tpl.key};
    });
    if(r.live) throw new Error('the template still reads as active');
    await t.wait(1200);
    if(t.mail.matching(/ZZ Renewal for ZZ Off/).length) throw new Error('it was sent although the template was off');
    return 'off means off, and switching it back on restored it';
  });

  await t.step('a rule can be pointed at a different template without touching code', async () => {
    const r = await t.eval(async ()=>{
      const other = allMailTemplates().find(x=>x.custom && x.name !== 'ZZ Renewal Due')
        || (()=>{ return null; })();
      const rule = mailRules().find(x=>(mailTemplateMeta(x.template)||{}).name === 'ZZ Renewal Due');
      /* make a second letter to point it at */
      document.getElementById('newTplName').value = 'ZZ Second Letter';
      document.getElementById('newTplStage').value = rule ? (mailTemplateMeta(rule.template)||{}).stage : mailStages()[0].id;
      await addMailTemplate();
      const second = allMailTemplates().find(x=>x.name === 'ZZ Second Letter');
      await setMailRuleTemplate(rule.id, second.key);
      const after = mailRules().find(x=>x.id === rule.id);
      return {was: 'ZZ Renewal Due', now: (mailTemplateMeta(after.template)||{}).name,
              audited: DB.auditLog.filter(a=>a.action === 'Email rule remapped').length};
    });
    if(r.now !== 'ZZ Second Letter') throw new Error('it still sends ' + r.now);
    if(!r.audited) throw new Error('the remap was not recorded');
    return r.was + ' → ' + r.now + ', and written to the audit trail';
  });

  await t.step('removing a template takes its rules with it', async () => {
    const r = await t.eval(async ()=>{
      const tpl = allMailTemplates().find(x=>x.name === 'ZZ Second Letter');
      const before = mailRules().filter(x=>x.template === tpl.key).length;
      window.confirm = ()=>true;
      await removeMailTemplate(tpl.key);
      return {before, gone: !allMailTemplates().some(x=>x.key === tpl.key),
              rules: mailRules().filter(x=>x.template === tpl.key).length};
    });
    if(!r.before) throw new Error('it had no rules, so this proves nothing');
    if(!r.gone) throw new Error('the template is still there');
    if(r.rules) throw new Error(r.rules + ' rules still point at a template that is gone');
    return 'template and its ' + r.before + ' rule(s) removed together';
  });

  await t.step('nothing built in was disturbed', async () => {
    const r = await t.eval(()=>{
      const shipped = MAIL_TEMPLATE_DEFS.length;
      const haveAll = MAIL_TEMPLATE_DEFS.every(d=>{
        const t = mailTemplateOf(d.key);
        return t && (t.subject || t.body);
      });
      return {shipped, haveAll, stages: mailStages().filter(s=>!s.custom).length};
    });
    if(!r.haveAll) throw new Error('a shipped template lost its wording');
    if(!r.stages) throw new Error('the built-in stages are gone');
    return r.shipped + ' built-in templates intact across ' + r.stages + ' built-in stages';
  });

  t.section('one template at a time, each with its own switch');

  /* The firm asked for a switch per letter: turning one off must stop that
     letter and nothing else. The rule engine already honoured it; the
     letters BOSS sends by itself — a score card, a welcome, a form link —
     did not, because nothing told deliverMail() which template they were
     written from. These exercise the chokepoint and a real send site. */

  await t.step('every template starts active, and each is stored on its own', async () => {
    const r = await t.eval(()=>({
      shipped: MAIL_TEMPLATE_DEFS.length,
      off: MAIL_TEMPLATE_DEFS.filter(d=>!mailTemplateIsActive(d.key)).map(d=>d.key),
    }));
    if(r.off.length) throw new Error('these start switched off: ' + r.off.join(', '));
    return r.shipped + ' built-in templates, all active';
  });

  await t.step('switching one off changes that one and no other', async () => {
    const r = await t.eval(async ()=>{
      await setMailTemplateActive('fqScoreCard', false);
      return {target: mailTemplateIsActive('fqScoreCard'),
              others: MAIL_TEMPLATE_DEFS.filter(d=>d.key !== 'fqScoreCard' && !mailTemplateIsActive(d.key))
                        .map(d=>d.key),
              stored: Object.keys(DB.config.mailTemplatesOff || {})};
    });
    if(r.target) throw new Error('the one switched off still reads as active');
    if(r.others.length) throw new Error('it also switched off: ' + r.others.join(', '));
    if(r.stored.length !== 1) throw new Error('it stored ' + r.stored.length + ' keys, not one');
    return 'fqScoreCard off, every other template untouched';
  });

  await t.step('the letter it writes is held; another template’s goes out', async () => {
    t.mail.clear();
    const r = await t.eval(async ()=>{
      const held = await deliverMail({template:'fqScoreCard', to:'zzswitch@example.com',
        subject:'ZZ Switched Off Letter', body:'should not leave', module:'LMS'});
      const sent = await deliverMail({template:'welcomeEmail', to:'zzswitch@example.com',
        subject:'ZZ Other Letter', body:'should leave', module:'CMS'});
      const log = (DB.communications||[]).filter(c=>/ZZ Switched Off Letter/.test(c.subject||''))[0] || {};
      return {held: held.status, sent: sent.status, note: log.statusNote || '', logged: log.status || ''};
    });
    if(r.held !== 'Held') throw new Error('the switched-off template’s letter came back ' + r.held);
    if(r.sent !== 'Sent') throw new Error('an unrelated template’s letter came back ' + r.sent);
    await t.wait(1000);
    if(t.mail.matching(/ZZ Switched Off Letter/).length) throw new Error('the held letter was delivered anyway');
    if(!t.mail.matching(/ZZ Other Letter/).length) throw new Error('the other letter never arrived');
    if(r.logged !== 'Held') throw new Error('the held letter was not written down');
    if(!/email template is switched off/.test(r.note)) throw new Error('the reason reads "' + r.note + '"');
    if(!/No other template is affected/.test(r.note)) throw new Error('the reason does not say it stops here');
    return 'one held with its reason on the log, the other delivered';
  });

  await t.step('a real send site honours it too, not only the chokepoint', async () => {
    t.mail.clear();
    const r = await t.eval(async ()=>{
      const l = {id:uid('LEAD'), leadName:'ZZ Card Lead', firstName:'ZZ', lastName:'Card',
        email:'zzcard@example.com', assignedTo:currentUser,
        createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('LMS', l);
      DB.leads.push(l);
      await save('leads');
      const res = await sendFqScoreCard({leadId:l.id, type:'fq'},
        {score:7, max:10, pct:70, category:'Growing', sections:[], actions:[]},
        new Date().toISOString());
      return {status: res.status, leadId: l.id};
    });
    if(r.status !== 'Held') throw new Error('the score card came back ' + r.status);
    await t.wait(800);
    if(t.mail.matching(/zzcard@example\.com/).length) throw new Error('the score card went out anyway');
    return 'the FQ score card is held by its own template’s switch';
  });

  await t.step('switching it back on sends it again, with nothing else changed', async () => {
    t.mail.clear();
    const r = await t.eval(async ()=>{
      await setMailTemplateActive('fqScoreCard', true);
      const back = await deliverMail({template:'fqScoreCard', to:'zzswitch@example.com',
        subject:'ZZ Back On Letter', body:'should leave now', module:'LMS'});
      return {back: back.status,
              off: MAIL_TEMPLATE_DEFS.filter(d=>!mailTemplateIsActive(d.key)).map(d=>d.key),
              stored: Object.keys(DB.config.mailTemplatesOff || {})};
    });
    if(r.back !== 'Sent') throw new Error('it still comes back ' + r.back);
    if(r.off.length) throw new Error('these are still off: ' + r.off.join(', '));
    if(r.stored.length) throw new Error('the store kept ' + r.stored.join(', '));
    return 'back on, and the store is clean again';
  });

  await t.step('two switched off are two, not all', async () => {
    const r = await t.eval(async ()=>{
      await setMailTemplateActive('fqSend', false);
      await setMailTemplateActive('queryRaised', false);
      const off = MAIL_TEMPLATE_DEFS.filter(d=>!mailTemplateIsActive(d.key)).map(d=>d.key).sort();
      const a = await deliverMail({template:'fqSend', to:'zz2@example.com',
        subject:'ZZ Two A', body:'x', module:'LMS'});
      const b = await deliverMail({template:'iseqSend', to:'zz2@example.com',
        subject:'ZZ Two B', body:'x', module:'LMS'});
      await setMailTemplateActive('fqSend', true);
      await setMailTemplateActive('queryRaised', true);
      return {off, a:a.status, b:b.status,
              clean: Object.keys(DB.config.mailTemplatesOff || {}).length};
    });
    if(r.off.join(',') !== 'fqSend,queryRaised') throw new Error('off were: ' + r.off.join(', '));
    if(r.a !== 'Held') throw new Error('a switched-off letter came back ' + r.a);
    if(r.b !== 'Sent') throw new Error('a letter beside it came back ' + r.b);
    if(r.clean) throw new Error('turning them back on left ' + r.clean + ' behind');
    return 'two off, the rest sending, and both restored';
  });

  await t.step('the editor carries each letter’s own switch, beside that letter', async () => {
    const r = await t.eval(()=>{
      navigate('settings','mailtemplates');
      const stage = (mailTemplateMeta('fqScoreCard')||{}).stage;
      const want = mailStageName(stage);
      const tab = Array.from(document.querySelectorAll('#content .tab'))
        .find(x=>x.textContent.indexOf(want) === 0);
      if(tab) tab.click();
      return {want};
    });
    await t.wait(300);
    const u = await t.eval(()=>{
      const cards = Array.from(document.querySelectorAll('#content .card'));
      const card = cards.find(c=>/FQ assessment score card/.test(c.textContent));
      if(!card) return {found:false};
      const box = Array.from(card.querySelectorAll('input[type=checkbox]'))
        .find(x=>/setMailTemplateActive/.test(x.getAttribute('onchange')||''));
      const all = cards.filter(c=>Array.from(c.querySelectorAll('input[type=checkbox]'))
        .some(x=>/setMailTemplateActive/.test(x.getAttribute('onchange')||''))).length;
      return {found:true, has: !!box, checked: box? box.checked : null,
              names: !!(box && /setMailTemplateActive\('fqScoreCard'/.test(box.getAttribute('onchange'))),
              cards: cards.length, withSwitch: all,
              says: /\bactive\b/i.test(card.textContent)};
    });
    if(!u.found) throw new Error('the score card template has no card in the editor');
    if(!u.has) throw new Error('its card has no switch of its own');
    if(!u.names) throw new Error('its switch does not name its own template');
    if(!u.checked) throw new Error('its switch reads off although it is on');
    if(u.withSwitch < 2) throw new Error('only ' + u.withSwitch + ' card carries a switch');
    if(!u.says) throw new Error('the card does not say which way it is');
    return u.withSwitch + ' letters on this tab, each with its own switch';
  });

  await t.step('there is no control that switches every template at once', async () => {
    const r = await t.eval(()=>{
      navigate('settings','mailtemplates');
      const box = document.getElementById('mailDynBox');
      if(box) box.open = true;
      const c = document.getElementById('content');
      const bad = Array.from(c.querySelectorAll('input[type=checkbox],button'))
        .map(x=>(x.getAttribute('onchange')||x.getAttribute('onclick')||''))
        .filter(x=>/setMailTemplateActive\(\s*(''|"")|AllTemplates|TemplatesAll/.test(x));
      return {bad};
    });
    if(r.bad.length) throw new Error('something switches them together: ' + r.bad.join(' | '));
    return 'every switch names one template';
  });

  t.section('mail, a module at a time');

  await t.step('Setup lists every module that sends mail, with a switch', async () => {
    const r = await t.eval(()=>{
      navigate('settings','mailtemplates');
      document.getElementById('mailDynBox').open = true;
      const c = document.getElementById('content');
      return {rows: c.querySelectorAll('input[onchange^="setMailModuleActive"]').length,
              head: c.textContent.indexOf('By module') >= 0,
              lists: mailModuleList().length, modules: MODULES.length};
    });
    if(!r.head) throw new Error('there is no By module block');
    if(!r.rows) throw new Error('no module has a switch');
    if(r.lists < r.modules) throw new Error('the list is shorter than the module list itself');
    return r.rows + ' modules switchable, out of ' + r.lists + ' that could send mail';
  });

  await t.step('switching one off holds that module\u2019s mail and no other\u2019s', async () => {
    t.mail.clear();
    const r = await t.eval(async ()=>{
      await setMailModuleActive('LMS', false);
      const lms = await deliverMail({to:'lms@example.com', subject:'ZZ LMS Letter',
        body:'from the lead side', module:'LMS', label:'Test'});
      const cms = await deliverMail({to:'cms@example.com', subject:'ZZ CMS Letter',
        body:'from the client side', module:'CMS', label:'Test'});
      return {lms:{status:lms.status, note:lms.note}, cms:{status:cms.status},
              on:{lms: mailModuleOn('LMS'), cms: mailModuleOn('CMS')}};
    });
    if(r.on.lms) throw new Error('the LMS switch did not take');
    if(r.lms.status !== 'Held') throw new Error('the LMS letter came back ' + r.lms.status);
    if(!/Email for LMS is switched off/.test(r.lms.note)) throw new Error('its reason reads: ' + r.lms.note);
    if(r.cms.status !== 'Sent') throw new Error('the CMS letter came back ' + r.cms.status);
    await t.wait(1200);
    if(t.mail.matching(/ZZ LMS Letter/).length) throw new Error('the LMS letter went out anyway');
    if(!t.mail.matching(/ZZ CMS Letter/).length) throw new Error('the CMS letter did not go out');
    return 'LMS held, CMS sent, in the same breath';
  });

  await t.step('a stage rule on a held module is held too', async () => {
    t.mail.clear();
    const r = await t.eval(async ()=>{
      /* The earlier rule was remapped and then deleted with its template,
         so this builds its own rather than leaning on what survived. */
      const tpl = allMailTemplates().find(x=>x.name === 'ZZ Renewal Due');
      const state = 'readyToQualify';
      DB.config.mailRules = mailRules().concat([{id:uid('MRL'), module:'LMS', state,
        template: tpl.key, active:true, createdAt:new Date().toISOString(), createdBy:currentUser}]);
      await save('config');
      const rule = mailRules().find(x=>x.template === tpl.key);
      const into = getBlueprint('LMS').transitions.find(x=>x.to === rule.state);
      const l = {id:uid('LEAD'), leadName:'ZZ Module Off', firstName:'ZZ', lastName:'ModOff',
        email:'modoff@example.com', assignedTo:currentUser,
        createdAt:new Date().toISOString(), createdBy:currentUser};
      initState('LMS', l);
      l[RECORD_STATE_FIELD.LMS] = into.from;
      DB.leads.push(l); await save('leads');
      await doTransition('LMS', l.id, into.id);
      const held = (DB.communications||[]).filter(x=>x.status === 'Held'
        && /ZZ Renewal for ZZ Module Off/.test(x.subject||'')).length;
      await setMailModuleActive('LMS', true);
      return {held, back: mailModuleOn('LMS')};
    });
    await t.wait(1000);
    if(t.mail.matching(/ZZ Renewal for ZZ Module Off/).length)
      throw new Error('the stage letter went out from a module that is holding its mail');
    if(!r.held) throw new Error('it was not written down as held either');
    if(!r.back) throw new Error('LMS did not come back on');
    return 'the rule fired, the module held it, and the log says so';
  });

  await t.step('a template says which module it is filed under, and can be moved', async () => {
    const r = await t.eval(async ()=>{
      const tpl = allMailTemplates().find(x=>!x.custom && x.stage === 'Lead journey');
      const was = mailTemplateModule(tpl.key);
      await setMailTemplateModule(tpl.key, 'CMS');
      const now = mailTemplateModule(tpl.key);
      await setMailTemplateModule(tpl.key, '');
      return {key: tpl.key, was, now, back: mailTemplateModule(tpl.key)};
    });
    if(r.was !== 'LMS') throw new Error('a lead-journey letter is filed under ' + r.was);
    if(r.now !== 'CMS') throw new Error('moving it did not take: ' + r.now);
    if(r.back !== 'LMS') throw new Error('clearing the override left it at ' + r.back);
    return 'filed under LMS by default, moved to CMS, and back';
  });

  t.section('a signature of one\u2019s own');

  await t.step('everybody starts with one built from their record', async () => {
    const r = await t.eval(()=>{
      const u = me();
      return {own: userHasOwnSignature(u.id), text: signatureTextFor(u.id),
              html: signatureHtmlFor(u.id), name: u.name};
    });
    if(r.own) throw new Error('a fresh account already has a signature of its own');
    if(r.text.indexOf(r.name) < 0) throw new Error('the default does not carry their name: ' + r.text);
    if(r.html.indexOf(r.name) < 0) throw new Error('nor does the HTML one');
    if(!/Best Regards/.test(r.text)) throw new Error('it reads: ' + r.text);
    return 'the default, carrying "' + r.name + '", in both text and HTML';
  });

  await t.step('each person writes their own, with their own links, and it is theirs alone', async () => {
    const r = await t.eval(async ()=>{
      const other = {id:uid('TM'), name:'ZZ Other Person', role:'Manager', email:'other@example.com',
        scope:'own', perms:{}, adminFlags:{}, createdAt:new Date().toISOString()};
      DB.team.push(other); await save('team');
      navigate('profile');
      const need = ['greeting','name','designation','email','phone','location']
        .filter(k=>!document.getElementById('sig_' + k + '_' + currentUser));
      if(need.length) return {err:'the editor has no ' + need.join(', ') + ' field'};
      document.getElementById('sig_name_' + currentUser).value = 'ZZ Signed Tester';
      sigSet(currentUser, 'name', 'ZZ Signed Tester');
      document.getElementById('sig_designation_' + currentUser).value = 'Manager — Operations & Admin';
      sigSet(currentUser, 'designation', 'Manager — Operations & Admin');
      document.getElementById('sig_phone_' + currentUser).value = '+91 73074 73248';
      sigSet(currentUser, 'phone', '+91 73074 73248');
      document.getElementById('sig_location_' + currentUser).value = 'Varanasi, Uttar Pradesh, India';
      sigSet(currentUser, 'location', 'Varanasi, Uttar Pradesh, India');
      /* and the accounts, the way the screen adds them */
      document.getElementById('sigNewNet_' + currentUser).value = 'linkedin';
      document.getElementById('sigNewUrl_' + currentUser).value = 'https://linkedin.com/in/zz';
      sigAddSocial(currentUser);
      document.getElementById('sigNewNet_' + currentUser).value = 'youtube';
      document.getElementById('sigNewUrl_' + currentUser).value = 'https://youtube.com/@zz';
      sigAddSocial(currentUser);
      await saveSignature(currentUser);
      const mine = DB.team.find(t=>t.id === currentUser).sig || {};
      return {name: mine.name, socials: (mine.socials||[]).map(x=>x.net),
              html: signatureHtmlFor(currentUser),
              theirs: signatureTextFor(other.id),
              own: userHasOwnSignature(currentUser), theirsOwn: userHasOwnSignature(other.id)};
    });
    if(r.err) throw new Error(r.err);
    if(r.name !== 'ZZ Signed Tester') throw new Error('the name did not save: ' + r.name);
    if(r.socials.join(',') !== 'linkedin,youtube') throw new Error('the links saved as ' + r.socials.join(','));
    if(r.html.indexOf('linkedin.com/in/zz') < 0) throw new Error('the link is not in the signature');
    if(r.html.indexOf('#0A66C2') < 0) throw new Error('the LinkedIn chip has no colour on it');
    if(r.html.indexOf('73074') < 0) throw new Error('the phone is not in the signature');
    if(r.html.indexOf('Varanasi') < 0) throw new Error('the location is not in the signature');
    if(!r.own) throw new Error('it is not recorded as their own');
    if(r.theirsOwn) throw new Error('writing one gave somebody else one too');
    if(/ZZ Signed Tester/.test(r.theirs)) throw new Error('it leaked onto another account: ' + r.theirs);
    return 'name, designation, phone, location and two coloured links — and none of it on the other account';
  });

  await t.step('the letter goes out as HTML, so the links and the logo can draw', async () => {
    t.mail.clear();
    const r = await t.eval(async ()=>{
      const res = await deliverMail({to:'rich@example.com', subject:'ZZ Rich Signature',
        body:'Dear client,\n\nsomething <with> an angle bracket.\n\n{Signature}',
        module:'CMS', label:'Test'});
      return {status: res.status};
    });
    if(r.status !== 'Sent') throw new Error('it came back ' + r.status);
    const got = await waitForMail(t, /ZZ Rich Signature/, 6000);
    if(!got) throw new Error('nothing arrived');
    const raw = got.body || '';
    if(!/content-type:\s*text\/html/i.test(raw)) throw new Error('it went out as plain text');
    const text = got.text || raw;
    if(/\{Signature\}/.test(text)) throw new Error('the placeholder was left in');
    if(text.indexOf('linkedin.com/in/zz') < 0) throw new Error('the links did not travel');
    if(text.indexOf('ZZ Signed Tester') < 0) throw new Error('the name did not travel');
    /* The body is written as plain text everywhere in BOSS, so a stray
       angle bracket in it must be escaped rather than treated as markup. */
    if(text.indexOf('&lt;with&gt;') < 0) throw new Error('the body was not escaped into the HTML');
    return 'text/html, with the name, the phone and both links in it';
  });

  await t.step('{Signature} in a letter is filled with the sender\u2019s own', async () => {
    t.mail.clear();
    const r = await t.eval(async ()=>{
      const res = await deliverMail({to:'sig@example.com', subject:'ZZ Signed Letter',
        body:'Dear client,\n\nsomething.\n\n{Signature}', module:'CMS', label:'Test'});
      return {status: res.status};
    });
    if(r.status !== 'Sent') throw new Error('it came back ' + r.status);
    const got = await waitForMail(t, /ZZ Signed Letter/, 6000);
    if(!got) throw new Error('nothing arrived');
    const text = got.text || '';
    if(/\{Signature\}/.test(text)) throw new Error('the placeholder was left in: ' + text.slice(0,140));
    if(!/ZZ Signed Tester/.test(text)) throw new Error('the signature is not in the letter: ' + text.slice(0,200));
    return 'the letter arrived signed "ZZ Signed Tester"';
  });

  await t.step('a letter that does not ask for one is left alone, unless the firm says otherwise', async () => {
    t.mail.clear();
    const r = await t.eval(async ()=>{
      const off = await deliverMail({to:'nosig@example.com', subject:'ZZ Unsigned Letter',
        body:'no placeholder here', module:'CMS', label:'Test'});
      await setCfg('campaign.autoSignature', true);
      const on = await deliverMail({to:'autosig@example.com', subject:'ZZ Auto Signed',
        body:'still no placeholder', module:'CMS', label:'Test'});
      await setCfg('campaign.autoSignature', false);
      return {off: off.status, on: on.status};
    });
    if(r.off !== 'Sent' || r.on !== 'Sent') throw new Error('one of them did not send');
    const plain = await waitForMail(t, /ZZ Unsigned Letter/, 6000);
    const auto = await waitForMail(t, /ZZ Auto Signed/, 6000);
    if(!plain || !auto) throw new Error('one of the two did not arrive');
    if(/ZZ Signed Tester/.test(plain.text||''))
      throw new Error('it was signed with the setting off: ' + (plain.text||'').slice(0,140));
    if(!/ZZ Signed Tester/.test(auto.text||''))
      throw new Error('it was not signed with the setting on: ' + (auto.text||'').slice(0,140));
    return 'off by default, added when the firm turns it on';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 300));
    return 'none';
  });
});
