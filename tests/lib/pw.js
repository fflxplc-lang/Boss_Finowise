/* PLAYWRIGHT, WITH EVERY FORM SECTION ALREADY OPEN.

   Forms ship with their sections collapsed — a person clicks a heading and it
   opens (Modification 19). A suite that is testing something else should not
   have to click fourteen headings to reach a field, so every page opened
   through this shim starts with them open: _secOpen answers yes to any key,
   which is exactly what clicking them all would do, and it is installed
   before the page's own scripts run.

   A suite that is testing the collapse itself must require playwright-core
   directly, because shut is the thing it is checking. collapse.js does. */
const { chromium } = require('playwright-core');

const INIT = () => {
  try { window._secOpen = new Proxy({}, {get: () => true, set: () => true}); } catch (e) {}
};

function patch(target){
  const newPage = target.newPage && target.newPage.bind(target);
  const newContext = target.newContext && target.newContext.bind(target);
  if(newPage) target.newPage = async (...a) => {
    const p = await newPage(...a);
    await p.addInitScript(INIT);
    return p;
  };
  if(newContext) target.newContext = async (...a) => {
    const c = await newContext(...a);
    await c.addInitScript(INIT);
    patch(c);
    return c;
  };
  return target;
}

module.exports = {
  raw: chromium,
  chromium: Object.assign(Object.create(chromium), {
    launch: async (opts) => patch(await chromium.launch(opts)),
  }),
};
