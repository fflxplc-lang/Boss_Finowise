/* A SIGNATURE THAT KEEPS UP WITH THE PERSON.

   The editor starts every line from the team record — name,
   designation, email, mobile, branch — and that was right. What was
   wrong was Save: all six lines were written into the member whether
   or not anybody had touched them, so the signature froze on the day
   it was saved. Change your designation, move branch, get a new
   address at the firm, and the letters kept going out with last
   year's. The only way out was "Back to the default", which also threw
   away the sign-off line, the accounts and the two toggles.

   Now a line is stored only when it differs from the record, which is
   what lets the record show through it — read fresh on every letter.
   A line somebody really did type differently is still theirs, and the
   editor says what the record holds and offers it in one click.

   Signatures saved before this are healed on load: the lines that
   still match the record are dropped so they follow it from now on,
   and a line that no longer matches is left for its owner to decide. */
const {suite} = require('../lib/harness');

suite(async t => {

  t.section('what a save keeps');

  await t.step('a signature nobody edited stores no lines at all', async () => {
    const r = await t.eval(async ()=>{
      const u = DB.team.find(x=>x.id === currentUser);
      u.name = 'Puttaswamy Gowda'; u.designation = 'Chief Visionary Officer';
      u.email = 'pswamy@finowise.in'; u.mobile = '9800012345'; u.branch = 'Mumbai';
      delete u.sig; delete u.signature; window._sigDraft = {};
      await save('team');
      await saveSignature(currentUser);
      const sig = DB.team.find(x=>x.id === currentUser).sig;
      return {keys: Object.keys(sig).sort(), shown: userSig(currentUser).designation};
    });
    const unexpected = r.keys.filter(k=>['socials','showLogo','showDisclaimer'].indexOf(k) < 0);
    if(unexpected.length)
      throw new Error('it froze lines nobody touched: ' + unexpected.join(', '));
    if(r.shown !== 'Chief Visionary Officer')
      throw new Error('and the signature no longer reads the record: ' + r.shown);
    return 'it keeps only the accounts and the two toggles; every line still comes from the record';
  });

  await t.step('the record changes and the letter changes with it', async () => {
    const r = await t.eval(async ()=>{
      const u = DB.team.find(x=>x.id === currentUser);
      u.designation = 'Managing Partner';
      u.email = 'pswamy@freedomlifex.in';
      u.branch = 'Varanasi';
      await save('team');
      const s = userSig(currentUser);
      const letter = mailApplySignature('Dear Asha,\n\n{Signature}', currentUser);
      return {designation: s.designation, email: s.email, location: s.location,
              inLetter: letter.body.indexOf('Managing Partner') >= 0
                     && letter.body.indexOf('pswamy@freedomlifex.in') >= 0};
    });
    if(r.designation !== 'Managing Partner')
      throw new Error('the signature still says ' + r.designation);
    if(r.email !== 'pswamy@freedomlifex.in')
      throw new Error('the signature still writes to ' + r.email);
    if(r.location.indexOf('Varanasi') < 0)
      throw new Error('the branch did not follow: ' + r.location);
    if(!r.inLetter) throw new Error('and the letter went out with the old one');
    return 'designation, address and branch all followed, and the letter carries them';
  });

  t.section('a line somebody really did type');

  await t.step('is kept, and is the only thing stored', async () => {
    const r = await t.eval(async ()=>{
      const d = sigDraft(currentUser);
      d.designation = 'Chief Visionary Officer & Founder';
      await saveSignature(currentUser);
      const u = DB.team.find(x=>x.id === currentUser);
      return {keys: Object.keys(u.sig).filter(k=>SIG_TEXT_FIELDS.indexOf(k) >= 0),
              overrides: sigOverrides(currentUser),
              shown: userSig(currentUser)};
    });
    if(r.keys.join(',') !== 'designation')
      throw new Error('it stored ' + (r.keys.join(', ') || 'nothing') + ' rather than the one line typed');
    if(r.overrides.join(',') !== 'designation')
      throw new Error('the editor counts these as set here: ' + r.overrides.join(', '));
    if(r.shown.designation !== 'Chief Visionary Officer & Founder')
      throw new Error('the typed line was lost: ' + r.shown.designation);
    if(r.shown.email !== 'pswamy@freedomlifex.in')
      throw new Error('and the untouched lines stopped following the record');
    return 'one line theirs, five still the record’s';
  });

  await t.step('the record moving under it does not overwrite it', async () => {
    const r = await t.eval(async ()=>{
      const u = DB.team.find(x=>x.id === currentUser);
      u.designation = 'Director'; await save('team');
      const html = signatureEditorHtml(currentUser);
      return {shown: userSig(currentUser).designation,
              says: html.indexOf('Your record says <b>Director</b>') >= 0,
              offers: html.indexOf("sigUseRecord('" + currentUser + "','designation')") >= 0,
              banner: html.indexOf('set here rather than taken from') >= 0,
              button: html.indexOf('Update from my record') >= 0};
    });
    if(r.shown !== 'Chief Visionary Officer & Founder')
      throw new Error('their own line was overwritten by the record: ' + r.shown);
    if(!r.says) throw new Error('the editor does not say what the record holds');
    if(!r.offers) throw new Error('and it does not offer to take it');
    if(!r.banner || !r.button) throw new Error('the editor flags nothing at the top');
    return 'the typed line stands, and the editor says “Your record says Director — use it”';
  });

  await t.step('one click takes the record’s word, and saves it', async () => {
    const r = await t.eval(async ()=>{
      await sigUseRecord(currentUser, 'designation');
      const u = DB.team.find(x=>x.id === currentUser);
      return {shown: userSig(currentUser).designation,
              stored: Object.keys(u.sig).filter(k=>SIG_TEXT_FIELDS.indexOf(k) >= 0),
              overrides: sigOverrides(currentUser),
              clean: signatureEditorHtml(currentUser).indexOf('Update from my record') < 0};
    });
    if(r.shown !== 'Director') throw new Error('it still reads ' + r.shown);
    if(r.stored.length) throw new Error('and it froze it again as ' + r.stored.join(', '));
    if(r.overrides.length) throw new Error('the editor still counts it as set here');
    if(!r.clean) throw new Error('the editor still offers the record it has just taken');
    return 'it reads Director, stores nothing, and will follow the record again';
  });

  t.section('and the signatures saved before any of this');

  await t.step('are healed on load — the matching lines only', async () => {
    const r = await t.eval(async ()=>{
      const u = DB.team.find(x=>x.id === currentUser);
      u.designation = 'Director'; u.email = 'pswamy@freedomlifex.in'; u.branch = 'Varanasi';
      /* Exactly what the old Save wrote: every line, touched or not —
         here with one of them long out of date. */
      u.sig = {greeting:'Best Regards,', name:'Puttaswamy Gowda', designation:'Admin',
               email:'pswamy@freedomlifex.in', phone:u.mobile, location:userSig('__none__') && null,
               socials:[{net:'instagram', url:'https://instagram.com/x'}],
               showLogo:true, showDisclaimer:true};
      u.sig.location = sigDefaults(u).location;
      await save('team');
      await healSignatures();
      const after = DB.team.find(x=>x.id === currentUser).sig;
      return {kept: Object.keys(after).filter(k=>SIG_TEXT_FIELDS.indexOf(k) >= 0),
              designation: userSig(currentUser).designation,
              socials: (after.socials||[]).length};
    });
    if(r.kept.join(',') !== 'designation')
      throw new Error('healing kept ' + (r.kept.join(', ') || 'nothing') + '; it should keep the stale line alone');
    if(r.designation !== 'Admin')
      throw new Error('healing threw away a line that no longer matches, which is not its to throw');
    if(r.socials !== 1) throw new Error('it lost the accounts on the signature');
    return 'the five lines that still matched were dropped; the one that did not is left for its owner';
  });

  await t.step('healing twice changes nothing more', async () => {
    const r = await t.eval(async ()=>{
      const before = JSON.stringify(DB.team.find(x=>x.id === currentUser).sig);
      await healSignatures(); await healSignatures();
      return {same: before === JSON.stringify(DB.team.find(x=>x.id === currentUser).sig)};
    });
    if(!r.same) throw new Error('a second pass moved it again');
    return 'idempotent';
  });

  await t.step('“Back to the default” still clears the lot', async () => {
    const r = await t.eval(async ()=>{
      await resetSignature(currentUser);
      const u = DB.team.find(x=>x.id === currentUser);
      return {gone: !u.sig && !u.signature, reads: userSig(currentUser).designation};
    });
    if(!r.gone) throw new Error('something was left behind');
    if(r.reads !== 'Director') throw new Error('and it does not fall back to the record: ' + r.reads);
    return 'cleared, and straight back to the record';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
