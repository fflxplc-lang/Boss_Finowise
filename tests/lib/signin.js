/* Sign-in is per person, so a suite has to hold a session before it can
   reach the app at all. run.sh creates this account when it starts the
   server; every suite signs in with it on its first page.

   Note what is NOT done here: waiting for networkidle. The app holds an
   open EventSource on /api/events for live sync, so the network never goes
   idle and that wait always times out. domcontentloaded plus ready() is the
   honest pair. */
const EMAIL = 'test@finowise.test', PASSWORD = 'testpassword1';

module.exports = async function signIn(page, base){
  base = base || 'http://localhost:3000';
  await page.goto(base + '/login', {waitUntil:'domcontentloaded'});
  if(!(await page.$('#email'))) return;                 // the gate already let us through
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await Promise.all([
    page.waitForNavigation({waitUntil:'domcontentloaded'}),
    page.click('button[type=submit]'),
  ]);
  /* Signing in lands on the app, which loads the store and then runs its
     boot migrations — and those save. Leaving before they finish means the
     suite's own first goto aborts a write in flight, and the page logs a
     "storage set failed" that has nothing to do with whatever is being
     tested. So wait for the app to draw, then let the writes land. */
  await require('./ready')(page);
  await page.waitForTimeout(500);
};
module.exports.EMAIL = EMAIL;
module.exports.PASSWORD = PASSWORD;
