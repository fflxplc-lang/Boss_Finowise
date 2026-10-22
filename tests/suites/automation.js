/* ONE REGISTER FOR EVERYTHING BOSS DOES BY ITSELF.

   The old screen listed twenty-six automations and could switch off
   none of them, because none of them asked anything before running.
   The point of the register is that the switch is real: the code that
   raises a task, sends a stage mail, drains a connector or empties the
   bin asks automationOn() first, and automationOn() reads the same
   settings registry every other setting in BOSS lives in.

   So what is tested here is not that a table draws. It is that turning
   a switch off stops the work, that turning it back on resumes it, that
   two automations which already had a setting did not grow a second one,
   and that everything which cannot honestly be switched says why. */
const {suite} = require('../lib/harness');

suite(async t => {

  t.section('the register, and where it lives');

  await t.step('Setup has an Automation section, and the old page lands on it', async () => {
    const r = await t.eval(()=>{
      const cats = SETTINGS_CATEGORIES.map(c=>c.id);
      const tabs = [];
      SETTINGS_CATEGORIES.forEach(c=>c.tabs.forEach(tb=>tabs.push(tb[0])));
      settingsTab = 'automationrules'; navigate('settings');
      const landed = settingsTab;
      const c = document.getElementById('content');
      return {cats, sections: cats.length, landed,
        dupes: tabs.filter((x,i)=>tabs.indexOf(x) !== i),
        gone: tabs.indexOf('automationrules') >= 0,
        here: /Everything BOSS does without being asked/.test(c.textContent),
        rows: c.querySelectorAll('#autoList table tbody tr').length,
        n: AUTOMATIONS.length};
    });
    if(r.cats.indexOf('automation') < 0) throw new Error('there is no Automation section');
    if(r.landed !== 'automationcenter') throw new Error('the old page lands on ' + r.landed);
    if(r.gone) throw new Error('Built-in Automations is still a screen of its own');
    if(r.dupes.length) throw new Error('a screen appears twice in Setup: ' + r.dupes.join(', '));
    if(!r.here) throw new Error('the register did not draw');
    if(r.rows !== r.n) throw new Error('it lists ' + r.rows + ' of ' + r.n + ' automations');
    return r.sections + ' Setup sections, ' + r.n + ' automations in one list, no screen listed twice';
  });

  await t.step('every switch is a real setting, and nothing is a label over nothing', async () => {
    const r = await t.eval(()=>{
      const sw = AUTOMATIONS.filter(a=>automationSwitchable(a));
      const fixed = AUTOMATIONS.filter(a=>!automationSwitchable(a));
      return {
        sw: sw.length, fixed: fixed.length,
        noDef: sw.filter(a=>!settingDef(a.key)).map(a=>a.key),
        offByDefault: sw.filter(a=>!automationOn(a.id)).map(a=>a.id),
        unexplained: fixed.filter(a=>!a.fixed || !(a.where||[]).length).map(a=>a.id),
        noConsequence: sw.filter(a=>!a.offMeans).map(a=>a.id),
        /* the two that already had a setting must point at it, not add a second */
        welcome: (automationById('welcome')||{}).key,
        arc: (automationById('arcCycle')||{}).key,
      };
    });
    if(r.noDef.length) throw new Error('a switch with no setting behind it: ' + r.noDef.join(', '));
    if(r.offByDefault.length) throw new Error('shipped switched off: ' + r.offByDefault.join(', '));
    if(r.unexplained.length) throw new Error('always-on with no reason given: ' + r.unexplained.join(', '));
    if(r.noConsequence.length) throw new Error('no answer to "what stops": ' + r.noConsequence.join(', '));
    if(r.welcome !== 'cms.welcomeChannel') throw new Error('the welcome message grew a second switch');
    if(r.arc !== 'arc.autoOnComplete') throw new Error('the review cycle grew a second switch');
    return r.sw + ' real switches, ' + r.fixed + ' always-on and each saying why, no setting duplicated';
  });

  t.section('the switch reaches the code, not just the screen');

  await t.step('switched off, no task is raised by a stage', async () => {
    const r = await t.eval(async ()=>{
      const lead = {id: uid('LD'), firstName:'ZZ', lastName:'Auto', assignedTo: currentUser};
      const before = DB.tasks.length;
      await createLeadDST(lead, 'Warm Up Call', 1, 'while it is on');
      const withOn = DB.tasks.length;
      await setAutomationOn('stageTasks', false);
      await createLeadDST(lead, 'Warm Up Call', 1, 'while it is off');
      const withOff = DB.tasks.length;
      await setAutomationOn('stageTasks', true);
      await createLeadDST(lead, 'Warm Up Call', 1, 'back on');
      return {before, withOn, withOff, after: DB.tasks.length,
        logged: automationRuns('stageTasks').length,
        last: automationResultText(automationLastRun('stageTasks'))};
    });
    if(r.withOn !== r.before + 1) throw new Error('nothing was raised even with it on');
    if(r.withOff !== r.withOn) throw new Error('switched off and a task was still raised');
    if(r.after !== r.withOff + 1) throw new Error('switching back on did not resume it');
    if(r.logged !== 2) throw new Error('the run log counted ' + r.logged + ' of the 2 that ran');
    return 'on: raised · off: nothing · on again: raised — and the log says "' + r.last + '"';
  });

  await t.step('switched off, a stage sends no mail \u2014 with a rule that would have sent one', async () => {
    const r = await t.eval(async ()=>{
      /* a real rule against a real stage, and the letter counted rather
         than posted, so what is measured is the gate and nothing else */
      const state = getBlueprint('LMS').states[0].id;
      DB.config.mailTemplates = DB.config.mailTemplates || {};
      DB.config.mailTemplates.zzAutoTest = {name:'ZZ Automation Test', subject:'Hello {Name}', body:'Stage {Stage}'};
      DB.config.mailRules = (DB.config.mailRules || []).concat([
        {id:'zzrule', module:'LMS', state, template:'zzAutoTest', active:true}]);
      await save('config');
      const real = deliverMail;
      let count = 0;
      deliverMail = async () => { count++; return {sent:true}; };
      const lead = {id:'LD-zz', firstName:'ZZ', lastName:'Mail', email:'zz@example.com'};
      await setAutomationOn('stageMail', false);
      const off = await runStageMailRules('LMS', lead, state);
      const offCount = count;
      await setAutomationOn('stageMail', true);
      const on = await runStageMailRules('LMS', lead, state);
      const onCount = count;
      deliverMail = real;
      DB.config.mailRules = DB.config.mailRules.filter(x=>x.id !== 'zzrule');
      delete DB.config.mailTemplates.zzAutoTest;
      await save('config');
      return {off, offCount, on, onCount, logged: automationRuns('stageMail').length};
    });
    if(r.offCount !== 0 || r.off !== 0) throw new Error('it sent ' + r.offCount + ' letter(s) with the switch off');
    if(r.onCount !== 1 || r.on !== 1) throw new Error('with it on it sent ' + r.onCount + ', so the rule never worked');
    if(r.logged !== 1) throw new Error('the run was not recorded');
    return 'the same rule, the same stage: 0 letters off, 1 letter on, 1 line in the log';
  });

  await t.step('the welcome message answers the same register as its own setting', async () => {
    const r = await t.eval(async ()=>{
      const out = {};
      await setAutomationOn('welcome', false);
      out.cfgAfterOff = cfg('cms.welcomeChannel');
      out.onAfterOff = automationOn('welcome');
      await setCfg('cms.welcomeChannel', 'Email');
      out.onAfterCfg = automationOn('welcome');
      await setAutomationOn('welcome', true);
      out.cfgAfterOn = cfg('cms.welcomeChannel');
      return out;
    });
    if(r.cfgAfterOff !== 'None' || r.onAfterOff) throw new Error('the register did not write the real setting');
    if(!r.onAfterCfg) throw new Error('changing the setting itself did not reach the register');
    if(r.cfgAfterOn === 'None') throw new Error('switching it back on left the channel at None');
    return 'one value, two doors onto it — the register writes cms.welcomeChannel and reads it back';
  });

  t.section('what the screen tells somebody before they press anything');

  await t.step('switching off shows what stops, and records who did it', async () => {
    const r = await t.eval(async ()=>{
      navigate('settings', 'automationcenter');
      askAutomationSwitch('purgeBin');
      const body = document.getElementById('modalBody').textContent;
      const btns = Array.from(document.querySelectorAll('#modalBody ~ * button, .modal-foot button'))
        .map(b=>b.textContent.trim());
      const auditBefore = DB.settingsAudit.length;
      await confirmAutomationSwitch('purgeBin', false);
      const a = DB.settingsAudit[DB.settingsAudit.length-1] || {};
      await setAutomationOn('purgeBin', true);
      return {says: /What stops happening/.test(body),
        consequence: /Recycle Bin indefinitely/.test(body),
        reassures: /Nothing is deleted/.test(body),
        btns, audited: DB.settingsAudit.length > auditBefore, key: a.key, by: a.by};
    });
    if(!r.says || !r.consequence) throw new Error('the dialog does not say what stops');
    if(!r.reassures) throw new Error('it does not say what is left alone');
    if(!r.audited || r.key !== 'automation.purgeBin') throw new Error('the change was not recorded');
    return 'the consequence is on the screen first, and "' + r.key + '" is in the change history under ' + r.by;
  });

  await t.step('search and the category filter narrow the same list', async () => {
    const r = await t.eval(()=>{
      navigate('settings', 'automationcenter');
      const count = () => document.querySelectorAll('#autoList table tbody tr').length;
      const all = count();
      setAutoSearch('welcome'); const searched = count();
      setAutoSearch(''); setAutoCat('Integrations'); const filtered = count();
      setAutoCat('');
      return {all, searched, filtered,
        integrations: AUTOMATIONS.filter(a=>a.category === 'Integrations').length};
    });
    if(r.searched >= r.all || !r.searched) throw new Error('search matched ' + r.searched + ' of ' + r.all);
    if(r.filtered !== r.integrations) throw new Error('the filter showed ' + r.filtered + ' of ' + r.integrations);
    return r.all + ' → ' + r.searched + ' by word, → ' + r.filtered + ' by category';
  });

  await t.step('reset puts every switch back on', async () => {
    const r = await t.eval(async ()=>{
      await setAutomationOn('drip', false);
      await setAutomationOn('momTasks', false);
      const off = AUTOMATIONS.filter(a=>automationSwitchable(a) && !automationOn(a.id)).length;
      await confirmResetAutomations();
      return {off, left: AUTOMATIONS.filter(a=>automationSwitchable(a) && !automationOn(a.id)).length};
    });
    if(r.off !== 2) throw new Error('only ' + r.off + ' went off');
    if(r.left) throw new Error(r.left + ' still off after the reset');
    return '2 off → 0 off';
  });

  await t.step('nothing was alerted that was not a result', async () => {
    const seen = t.dialogs.slice();
    const bad = seen.filter(m=>/error|undefined|not a function/i.test(m));
    if(bad.length) throw new Error(bad.join(' | '));
    return seen.length ? seen.length + ' confirmation(s), no errors' : 'none';
  });
});
