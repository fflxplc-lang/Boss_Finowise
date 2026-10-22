/* WHAT EVERY SUITE WOULD OTHERWISE REPEAT.

   A suite is a list of named steps. A step passes if it returns; it fails if
   it throws, and what it throws is what gets printed. Anything the step
   returns is printed beside its name, which is where a suite earns its keep
   — "3 leads, no duplicate on the retry" tells you more than a tick.

   The runner reads the last line: ALL CLEAN, or "N PROBLEM(S)" followed by
   the failures. Nothing else is parsed, so a suite is free to print whatever
   helps while it works.

   Usage:

     const {suite} = require('../lib/harness');
     suite(async t => {
       await t.step('what it should do', async () => {
         const n = await t.eval(() => DB.leads.length);
         if(!n) throw new Error('no leads');
         return n + ' leads';
       });
     });

   Options, as a first argument: {collapsed:true} to meet the forms as a
   person does, with their sections shut; {signIn:false} for a suite that
   only ever looks at a client's own link; {mail:true} to stand up a fake
   SMTP server and point the CRM's connector at it, reachable as t.mail.
*/
const PORT      = Number(process.env.BOSS_PORT || 3000);
const SMTP_PORT = Number(process.env.BOSS_SMTP_PORT || (PORT + 251));
const BASE      = 'http://localhost:' + PORT;
const CHROME    = process.env.BOSS_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const ready  = require('./ready');
const signIn = require('./signin');
const smtp   = require('./smtp');

async function suite(opts, body){
  if(typeof opts === 'function'){ body = opts; opts = {}; }
  opts = opts || {};
  const pw = require('./pw');
  const launcher = opts.collapsed ? pw.raw : pw.chromium;

  const errors = [], dialogs = [], consoleErrors = [];
  /* Some suites provoke an error on purpose — refusing a write from a
     client's link is supposed to produce a 403, and a 403 is supposed to be
     logged. A suite says so with t.expectConsole(/…/) before the act, and
     those messages stop counting as defects. */
  const allowConsole = [];
  let browser = null, mail = null;

  // Console noise that says nothing about this application.
  const IGNORE = /404|ERR_CERT|ERR_NETWORK_CHANGED|fonts\.g(oogleapis|static)|favicon/;

  try {
    if(opts.mail){
      mail = smtp.start(SMTP_PORT);
      await mail.ready;
    }
    browser = await launcher.launch({executablePath: CHROME});
    /* A punch needs a location, because BOSS now refuses one without
       it. A real browser has a device behind it; a headless one has
       nothing, so it is given a fixed reading here. Varanasi, where
       the firm is. A suite that wants to test the refusal turns the
       permission off for itself. */
    const page = await browser.newPage({viewport: opts.viewport || {width:1500, height:950},
      permissions: ['geolocation'],
      geolocation: {latitude: 25.317645, longitude: 82.973915, accuracy: 18}});

    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => {
      if(m.type() !== 'error') return;
      const txt = m.text();
      if(IGNORE.test(txt)) return;
      if(allowConsole.some(re => re.test(txt))) return;
      consoleErrors.push('CONSOLE: ' + txt);
    });
    page.on('dialog', async d => { dialogs.push(d.message()); await d.accept().catch(()=>{}); });

    const t = {
      page, base: BASE, dialogs, errors, mail,
      url: p => BASE + (p || ''),

      /* The app, signed in and drawn. */
      async home(){
        await page.goto(BASE + '/', {waitUntil:'domcontentloaded'});
        await ready(page);
      },
      /* A client's own link. */
      async doc(token, waitMs){
        await page.goto(BASE + '/?doc=' + token, {waitUntil:'domcontentloaded'});
        await page.waitForTimeout(waitMs || 1200);
      },
      /* page.evaluate, with the name it deserves. */
      eval: (fn, arg) => page.evaluate(fn, arg),
      /* "The next thing I do will log this, and that is the point." */
      expectConsole(...res){ res.forEach(r => allowConsole.push(r)); },
      wait: ms => page.waitForTimeout(ms),
      /* Point the CRM at the fake mail server and let it prove the connection
         for itself: the server refuses to send until the connector has
         actually passed a test, so the test is run rather than faked. */
      async useMail(){
        if(!mail) throw new Error('this suite did not ask for mail; pass {mail:true}');
        const r = await page.evaluate(async (cfg)=>{
          const put = await fetch('/api/connections/email', {
            method:'PUT', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({config: cfg, enabled: true, secrets: {}})});
          if(!put.ok) return {ok:false, message:'PUT ' + put.status};
          const test = await fetch('/api/connections/email/test', {method:'POST'});
          return await test.json();
        }, smtp.connector(SMTP_PORT));
        if(!r || !r.ok) throw new Error('the fake mail server was not accepted: ' + (r && r.message));
        await page.waitForTimeout(150);
      },

      async step(name, fn){
        const before = errors.length + consoleErrors.length;
        try {
          const note = await fn();
          const broke = (errors.length + consoleErrors.length) - before;
          console.log('ok    ' + name + (note ? '  — ' + note : '')
            + (broke ? '   [' + broke + ' page error(s) during this step]' : ''));
        } catch(e){
          errors.push('FAIL  ' + name + ' — ' + (e && e.message ? e.message : e));
          console.log('FAIL  ' + name + ' — ' + (e && e.message ? e.message : e));
        }
      },
      section(title){ console.log('--- ' + title + ' ---'); },
    };

    if(opts.signIn !== false){
      await signIn(page, BASE);
      if(opts.mail) await t.useMail();
      await t.home();
    }

    await body(t);

    // A page error nobody asserted on is still a defect.
    consoleErrors.forEach(e => errors.push(e));
  } catch(e){
    errors.push('SUITE CRASHED: ' + (e && e.stack ? e.stack.split('\n').slice(0,3).join(' | ') : e));
  } finally {
    if(browser) await browser.close().catch(()=>{});
    if(mail) await mail.close().catch(()=>{});
  }

  if(errors.length){
    console.log('\n' + errors.length + ' PROBLEM(S):\n' + errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('\nALL CLEAN');
  }
}

module.exports = {suite, PORT, SMTP_PORT, BASE, CHROME};
