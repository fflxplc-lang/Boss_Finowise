/* THE APP IS UP WHEN IT SAYS SO, NOT AFTER A COUNT OF SECONDS.

   The store takes a moment to arrive and the first draw a moment after it.
   Sleeping a fixed 1.8s for that is too long on an idle box and sometimes
   not long enough on a loaded one — twelve workers on four cores — which is
   the fixed-pause race that used to cost us whole suites.

   So ask the page: the store is in when DB.config is there, and the app has
   drawn when #content has children.

   Note DB is `let DB = …` at the top of a classic script, which is a
   script-scope binding and NOT a property of window. Asking for window.DB
   asks for something that never exists; a version of this that did exactly
   that sat out its whole timeout on every boot, which looked like a mystery
   rather than a mistake, because the helper falls through quietly.

   If the condition never comes true the suite carries on regardless. Its own
   assertions should report the failure, in their own words, rather than this
   helper guessing at one. */
module.exports = async function ready(page, ms){
  let drew = true;
  try {
    await page.waitForFunction(
      () => !!(typeof DB !== 'undefined' && DB && DB.config
               && document.getElementById('content')
               && document.getElementById('content').children.length),
      null, {timeout: ms || 15000, polling: 50});
  } catch(e){ drew = false; }
  await page.waitForTimeout(drew ? 120 : 400);
};
