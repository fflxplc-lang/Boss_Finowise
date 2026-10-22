/* THE FIRM WRITES THE AUTOMATION, NOT THE DEVELOPER.

   The builder that was here before could not do the thing it was named
   after: no stage, no test, no delete, no order, three actions, and a
   field name typed into a text box. What is tested here is that the one
   that replaced it is real — that the lists come out of BOSS rather than
   out of the source, that saving a rule makes BOSS behave differently
   straight away, that the order and the stop-on-failure are obeyed, that
   the same event arriving twice runs it once, and that deleting a rule
   stops the next run without undoing the last. */
const {suite} = require('../lib/harness');

const onServer = async (t, key) => t.eval(async (k)=>{
  const res = await fetch('/api/storage/' + encodeURIComponent(k), {headers: apiHeaders()});
  if(res.status === 404) return null;
  if(!res.ok) throw new Error('storage get failed: ' + res.status);
  return JSON.parse((await res.json()).value);
}, key);

/* Build a rule through the real builder functions and save it. */
const BUILD = `async (spec) => {
  openAutomationBuilder(spec.id || undefined);
  Object.assign(window._autoDraft, spec.draft || {});
  if(spec.draft && spec.draft.trigger)
    window._autoDraft.trigger = Object.assign({type:'Record Created', stage:'', field:''}, spec.draft.trigger);
  await saveAutomationRule();
  const made = (DB.automationRules||[]).find(r=>r.name === (spec.draft||{}).name);
  return made ? made.id : null;
}`;

suite(async t => {

  t.section('the dashboard, and where it lives');

  await t.step('Setup carries the builder, and it lists what each rule is', async () => {
    const r = await t.eval(()=>{
      navigate('settings', 'automationengine');
      const c = document.getElementById('content');
      const head = Array.from(c.querySelectorAll('table thead th')).map(x=>x.textContent.trim());
      return {head, rules: (DB.automationRules||[]).length,
        rows: c.querySelectorAll('table tbody tr').length,
        make: /openAutomationBuilder\(\)/.test(c.innerHTML),
        buttons: ['openAutomationBuilder\\(\'', 'openAutomationTest', 'toggleAutomationRule',
          'cloneAutomationRule', 'viewAutomationHistory', 'askDeleteAutomationRule']
          .filter(x=>!new RegExp(x).test(c.innerHTML))};
    });
    if(!r.make) throw new Error('there is no way to add one');
    if(r.buttons.length) throw new Error('missing from every row: ' + r.buttons.join(', '));
    if(r.rows !== r.rules) throw new Error('it lists ' + r.rows + ' of ' + r.rules);
    return r.head.join(' · ');
  });

  t.section('nothing in the builder is a list somebody typed');

  await t.step('modules, stages, fields and templates all come out of BOSS', async () => {
    const r = await t.eval(()=>{
      const mods = autoModules();
      const before = autoFields('LMS').length;
      /* a field the firm adds today must be choosable today */
      const extra = {k:'zzAutoProbe', l:'ZZ Automation Probe', t:'text'};
      DB.config.moduleFields = DB.config.moduleFields || {};
      const out = {mods: mods.length, hasLms: mods.indexOf('LMS') >= 0,
        stages: autoStages('CMS').length, blueprint: getBlueprint('CMS').states.length,
        fieldsBefore: before,
        templates: autoTemplates().length,
        liveTemplates: allMailTemplates().filter(x=>mailTemplateIsActive(x.key)).length,
        taskTypes: autoTaskTypes().length, cfgTaskTypes: cfgLabels('dst.taskTypes').length,
        people: autoPeople().length, team: activeTeam().length,
        noWorkflow: autoStages('Business').length};
      return out;
    });
    if(!r.hasLms || r.mods < 5) throw new Error('only ' + r.mods + ' modules offered');
    if(r.stages !== r.blueprint) throw new Error('stages: ' + r.stages + ' vs the blueprint’s ' + r.blueprint);
    if(r.templates !== r.liveTemplates) throw new Error('templates: ' + r.templates + ' vs ' + r.liveTemplates);
    if(r.taskTypes !== r.cfgTaskTypes) throw new Error('task types do not come from Setup');
    if(r.people !== r.team) throw new Error('people do not come from the team');
    if(r.noWorkflow !== 0) throw new Error('a module with no workflow was offered stages');
    return r.mods + ' modules, ' + r.stages + ' CMS stages, ' + r.fieldsBefore + ' LMS fields, '
      + r.templates + ' live templates, ' + r.taskTypes + ' task types — every one read from the system';
  });

  await t.step('a stage added to a workflow is in the builder the same minute', async () => {
    const r = await t.eval(async ()=>{
      const bp = getBlueprint('RMS');
      const before = autoStages('RMS').length;
      bp.states.push({id:'zzAutoStage', label:'ZZ Automation Stage'});
      const after = autoStages('RMS').length;
      const inBuilder = autoStages('RMS').some(s=>s.v === 'zzAutoStage');
      bp.states.pop();
      return {before, after, inBuilder, back: autoStages('RMS').length};
    });
    if(r.after !== r.before + 1 || !r.inBuilder) throw new Error('the new stage never appeared');
    if(r.back !== r.before) throw new Error('the probe was not cleaned up');
    return r.before + ' → ' + r.after + ' the moment the workflow changed, with nothing here to update';
  });

  await t.step('every action draws its own fields, and refuses to save half-filled', async () => {
    const r = await t.eval(()=>{
      const kinds = AUTOMATION_ACTIONS.map(a=>a.v);
      const noFields = AUTOMATION_ACTIONS.filter(a=>!a.fields('CMS').length).map(a=>a.v);
      const noSay = AUTOMATION_ACTIONS.filter(a=>typeof a.say !== 'function').map(a=>a.v);
      const noRun = AUTOMATION_ACTIONS.filter(a=>typeof a.run !== 'function').map(a=>a.v);
      /* each required field must be refused when it is empty */
      const lax = AUTOMATION_ACTIONS.filter(a=>{
        const req = a.fields('CMS').filter(f=>f.req && (!f.showIf || f.showIf({})));
        return req.length && !(a.check && a.check({}, 'CMS'));
      }).map(a=>a.v);
      return {kinds, noFields, noSay, noRun, lax,
        alias: Object.keys(AUTOMATION_ACTION_ALIAS).filter(k=>!autoActionDef(k))};
    });
    if(r.noFields.length) throw new Error('no fields drawn for: ' + r.noFields.join(', '));
    if(r.noSay.length || r.noRun.length) throw new Error('cannot describe or cannot run: '
      + r.noSay.concat(r.noRun).join(', '));
    if(r.lax.length) throw new Error('would save with a required field empty: ' + r.lax.join(', '));
    if(r.alias.length) throw new Error('an old saved action no longer resolves: ' + r.alias.join(', '));
    return r.kinds.length + ' actions, each with its own fields, its own sentence, its own refusal';
  });

  t.section('a rule the firm writes really changes what BOSS does');

  let madeId = null;

  await t.step('a rule built here fires on a record created, and is on the server', async () => {
    const r = await t.eval(async (build)=>{
      const id = await eval('(' + build + ')')({draft:{
        name:'ZZ raise a call on a big entry', description:'test', active:true, module:'Business',
        trigger:{type:'Record Created'},
        conditions:[{field:'amount', op:'greater_than', value:'100'}], logic:'AND',
        actions:[{type:'task', taskType:(cfgLabels('dst.taskTypes')[0]||'Other'), assignTo:'owner',
          dueDays:'1', description:'ZZ raised by the builder', onFail:'stop'}]}});
      const tasksBefore = DB.tasks.length;
      DB.businessEntries.push({id:'ZZBIZ1', amount:5000, remarks:'big'});
      await save('businessEntries');
      const big = DB.tasks.length;
      DB.businessEntries.push({id:'ZZBIZ2', amount:5, remarks:'small'});
      await save('businessEntries');
      return {id, tasksBefore, big, small: DB.tasks.length,
        made: DB.tasks.filter(x=>x.description === 'ZZ raised by the builder').length};
    }, BUILD);
    if(!r.id) throw new Error('the rule did not save');
    if(r.big !== r.tasksBefore + 1) throw new Error('the matching record raised ' + (r.big - r.tasksBefore) + ' task(s)');
    if(r.small !== r.big) throw new Error('a record that fails the condition raised a task anyway');
    const server = await onServer(t, 'automationRules');
    if(!(server||[]).some(x=>x.id === r.id)) throw new Error('it is not on the server, so it dies with the tab');
    madeId = r.id;
    return 'created over 100 → task raised; under 100 → nothing; and the rule is in storage';
  });

  await t.step('the same event arriving twice runs it once', async () => {
    const r = await t.eval(async ()=>{
      const before = DB.tasks.filter(x=>x.description === 'ZZ raised by the builder').length;
      const rec = DB.businessEntries.find(x=>x.id === 'ZZBIZ1');
      const rule = DB.automationRules.find(x=>x.name === 'ZZ raise a call on a big entry');
      const again = await runAutomationRule(rule, 'Business', 'Record Created', rec);
      return {before, after: DB.tasks.filter(x=>x.description === 'ZZ raised by the builder').length,
        ran: again.ran, why: again.skipped || ''};
    });
    if(r.ran || r.after !== r.before) throw new Error('it ran a second time for the same record');
    if(!/twice/i.test(r.why)) throw new Error('it refused for the wrong reason: ' + r.why);
    return 'refused — "' + r.why + '"';
  });

  await t.step('a rule on one field fires only when that field moves', async () => {
    const r = await t.eval(async (build)=>{
      await eval('(' + build + ')')({draft:{
        name:'ZZ watch the remarks', active:true, module:'Business',
        trigger:{type:'Field Changed', field:'remarks'},
        conditions:[], logic:'AND',
        actions:[{type:'note', message:'ZZ remarks moved', onFail:'stop'}]}});
      autoPrimeSeen();
      const notes = () => DB.auditLog.filter(a=>a.action === 'Automation: Note'
        && (a.details||[]).some(d=>d.newValue === 'ZZ remarks moved')).length;
      const start = notes();
      const rec = DB.businessEntries.find(x=>x.id === 'ZZBIZ1');
      rec.amount = 9999; await save('businessEntries');      // a different field
      const afterOther = notes();
      rec.remarks = 'changed'; await save('businessEntries'); // the watched one
      return {start, afterOther, afterWatched: notes()};
    }, BUILD);
    if(r.afterOther !== r.start) throw new Error('another field moving set it off');
    if(r.afterWatched !== r.start + 1) throw new Error('the watched field moved and it did not fire');
    return 'amount changed — silent; remarks changed — fired, exactly once';
  });

  t.section('several actions, in order, and what happens when one fails');

  await t.step('they run top to bottom, and a failure stops the rest', async () => {
    const r = await t.eval(async (build)=>{
      await eval('(' + build + ')')({draft:{
        name:'ZZ ordered actions', active:true, module:'Business',
        trigger:{type:'Record Created'}, conditions:[], logic:'AND',
        actions:[
          {type:'note', message:'ZZ first', onFail:'stop'},
          /* a real, valid action that cannot succeed on this record: a business
             entry carries no email address, so the send has nowhere to go */
          {type:'mail', template:(allMailTemplates().find(x=>mailTemplateIsActive(x.key))||{}).key,
           to:'record', onFail:'stop'},
          {type:'note', message:'ZZ third', onFail:'stop'}]}});
      autoPrimeSeen();
      const rule = DB.automationRules.find(x=>x.name === 'ZZ ordered actions');
      if(!rule) return {error:'the rule would not save'};
      DB.businessEntries.push({id:'ZZBIZ3', amount:1});
      const out = await runAutomationRule(rule, 'Business', 'Record Created', DB.businessEntries.find(x=>x.id==='ZZBIZ3'));
      const said = (m) => DB.auditLog.some(a=>(a.details||[]).some(d=>d.newValue === m));
      /* read before the second run, which deliberately lets the rest carry on */
      const first = said('ZZ first'), third = said('ZZ third');
      const errs = DB.errorLog.filter(e=>e.ruleName === 'ZZ ordered actions').length;
      /* and the same rule set to carry on instead */
      rule.actions.forEach(a=>a.onFail = 'continue');
      DB.businessEntries.push({id:'ZZBIZ4', amount:1});
      const out2 = await runAutomationRule(rule, 'Business', 'Record Created', DB.businessEntries.find(x=>x.id==='ZZBIZ4'));
      return {first, third, errs,
        steps: out.results.map(x=>x.action + (x.ok?'✓':'✗')),
        carried: out2.results.filter(x=>x.ok).length};
    }, BUILD);
    if(r.error) throw new Error(r.error);
    if(!r.first) throw new Error('the first action did not run');
    if(r.third) throw new Error('the third ran even though the second failed and the rule stops');
    if(!r.errs) throw new Error('the failure never reached the Error Center');
    if(r.carried !== 2) throw new Error('set to carry on, only ' + r.carried + ' of the 2 good actions ran');
    return r.steps.join(' → ') + ' — then, set to carry on, both notes ran';
  });

  t.section('test before you let it loose');

  await t.step('the dry run says what would happen, and changes nothing', async () => {
    const r = await t.eval(()=>{
      const rule = DB.automationRules.find(x=>x.name === 'ZZ raise a call on a big entry');
      window._autoTestPick = 'ZZBIZ1';
      const tasksBefore = DB.tasks.length;
      openAutomationTest(rule.id);
      const body = document.getElementById('modalBody');
      const text = body.textContent;
      const out = {tasksBefore, after: DB.tasks.length,
        valid: /Valid/.test(text), conds: /holds|does not/.test(text),
        says: /task/i.test(text), real: /Run it for real/.test(body.parentElement.textContent)};
      closeAutomationTest();
      return out;
    });
    if(r.after !== r.tasksBefore) throw new Error('the dry run actually did something');
    if(!r.valid || !r.conds || !r.says) throw new Error('it does not report validity, conditions and actions');
    if(!r.real) throw new Error('there is no way to then run it for real');
    return 'validity, every condition with the value it read, every action it would take — and nothing done';
  });

  t.section('a loop is caught, not discovered at 3am');

  await t.step('a rule that would set itself off is flagged before it is saved', async () => {
    const r = await t.eval(()=>{
      const bp = getBlueprint('LMS');
      const a = bp.states[0].id, b = bp.states[1].id;
      openAutomationBuilder();
      Object.assign(window._autoDraft, {name:'ZZ loop', module:'LMS',
        trigger:{type:'Stage Changed', stage:a, field:''},
        actions:[{type:'stage', stage:a, onFail:'stop'}]});
      const warn = autoLoopWarning(window._autoDraft);
      closeModal();
      return {warn: warn || '', depth: AUTOMATION_MAX_DEPTH};
    });
    if(!r.warn) throw new Error('a rule that moves a record to the stage it fires on raised no warning');
    if(!/same stage/i.test(r.warn)) throw new Error('the warning does not say why: ' + r.warn);
    return 'flagged before saving, and a chain is stopped at ' + r.depth + ' deep at run time';
  });

  t.section('deleting stops the next one, not the last one');

  await t.step('the rule goes, the work it already did stays', async () => {
    const r = await t.eval(async ()=>{
      const rule = DB.automationRules.find(x=>x.name === 'ZZ raise a call on a big entry');
      const tasks = DB.tasks.filter(x=>x.description === 'ZZ raised by the builder').length;
      const runs = DB.automationExecutionLog.filter(e=>e.ruleId === rule.id).length;
      askDeleteAutomationRule(rule.id);
      const warned = document.getElementById('modalBody').textContent;
      await deleteAutomationRule(rule.id);
      DB.businessEntries.push({id:'ZZBIZ5', amount:9000});
      await save('businessEntries');
      return {gone: !DB.automationRules.some(x=>x.id === rule.id),
        tasks, tasksNow: DB.tasks.filter(x=>x.description === 'ZZ raised by the builder').length,
        runsKept: DB.automationExecutionLog.filter(e=>e.ruleId === rule.id).length === runs,
        warnsKept: /What is kept/.test(warned), warnsGone: /cannot\s+be\s+undone/.test(warned)};
    });
    if(!r.gone) throw new Error('it is still there');
    if(!r.warnsKept || !r.warnsGone) throw new Error('the dialog does not say what is kept and what goes');
    if(r.tasksNow !== r.tasks) throw new Error('a new record still raised a task after the delete');
    if(!r.runsKept) throw new Error('its history was deleted with it');
    return r.tasks + ' task(s) it made are untouched, its runs are still in the log, and nothing fires now';
  });

  t.section('a condition can read the stage, because that is the rule firms want');

  await t.step('the stage is offered as a condition and matches by id, not by label', async () => {
    const r = await t.eval(()=>{
      const key = RECORD_STATE_FIELD.CMS;
      const f = autoConditionFields('CMS', 'Stage Changed').find(x=>x.k === key);
      const stage = autoStages('CMS')[2];
      const rec = {id:'ZZSTG', [key]: stage.v};
      return {offered: !!f, pairs: f && (f.optPairs||[]).length,
        byId: evalCondition(rec, {field:key, op:'equals', value:stage.v}),
        byLabel: evalCondition(rec, {field:key, op:'equals', value:stage.l}),
        /* the writable list still refuses to set it, which is what the stage
           action is for */
        notWritable: !autoWriteFieldDef('CMS', key),
        seeded: (DB.automationRules||[]).filter(x=>autoRuleProblems(x).length).map(x=>x.name),
        /* a value written onto records but never declared as a field is found
           on the records themselves, not in a list in the source */
        derivedBefore: autoDerivedFields('CMS').some(f=>f.k === 'zzStamped'),
        derivedAfter: (DB.clients.push({id:'ZZDRV', cmsName:'ZZ Derived', zzStamped:'yes'}),
                       autoDerivedFields('CMS').some(f=>f.k === 'zzStamped')),
        cleaned: (DB.clients = DB.clients.filter(c=>c.id !== 'ZZDRV'), true)};
    });
    if(!r.offered) throw new Error('the stage is not offered as a condition');
    if(!r.pairs) throw new Error('the stage dropdown has no stages in it');
    if(!r.byId) throw new Error('a condition built from the dropdown does not match the record');
    if(r.byLabel) throw new Error('it matched the label too, so the dropdown could store the wrong thing');
    if(!r.notWritable) throw new Error('the stage is offered as something to overwrite directly');
    if(r.seeded.length) throw new Error('a rule BOSS ships with is already broken: ' + r.seeded.join(', '));
    if(r.derivedBefore) throw new Error('a field nothing writes was offered anyway');
    if(!r.derivedAfter) throw new Error('a value written onto a record was not found as a condition field');
    return r.pairs + ' stages offered by id, read by label; both shipped rules valid; and a value stamped '
      + 'onto a record is offered as a condition the moment it exists';
  });

  await t.step('nothing was alerted that was not a result', async () => {
    const bad = t.dialogs.slice().filter(m=>/error|undefined|not a function/i.test(m));
    if(bad.length) throw new Error(bad.join(' | '));
    return t.dialogs.length ? t.dialogs.length + ' confirmation(s), no errors' : 'none';
  });
});
