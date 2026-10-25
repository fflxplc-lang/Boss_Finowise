/* PARTNER ACCESS — which parts of their own login (/partner) a partner
   may open.

   Loaded by the CRM (Setup › Partner Login Access, and the partner's
   Login & Access card in Partner Onboarding) and by the server
   (partner-portal.js), which is where it is enforced: a section a
   partner may not open is neither drawn nor answered.

   The rule, in order: the partner's own list, if somebody set one; else
   their role's list from Setup; else every section. Dashboard and My
   Profile are always open — a login with nothing behind it is no use. */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.PartnerAccess = factory();
})(typeof self !== 'undefined' ? self : this, function(){
  const SECTIONS = [
    {k:'dashboard',   l:'Dashboard',                 d:'Where they are, what to do next, their figures', fixed:true},
    {k:'profile',     l:'My Profile',                d:'Their own details and password', fixed:true},
    {k:'empanelment', l:'Empanelment & Documents',   d:'The form, the agreement and their documents'},
    {k:'tasks',       l:'My Tasks',                  d:'Their role’s tasks, submitted for the mentor’s review'},
    {k:'journey',     l:'Client Journey',            d:'Add leads and follow them (opens once onboarding tasks are approved)'},
    {k:'clients',     l:'My Clients',                d:'The clients their leads became, and their business'},
    {k:'performance', l:'My Performance',            d:'Targets against achievement, month-wise and year-wise'},
    {k:'payments',    l:'Payments',                  d:'Their onboarding fee and its receipt'},
    {k:'payouts',     l:'My Payouts',                d:'What the firm pays them, month by month'},
  ];
  const ROLES = ['Ninja', 'Super Ninja', 'Sherpa', 'No role yet'];
  const all = () => SECTIONS.map(s=>s.k);
  const fixed = () => SECTIONS.filter(s=>s.fixed).map(s=>s.k);
  const roleKey = r => (r && r.role) || 'No role yet';
  const clean = list => {
    const ok = new Set(all());
    return Array.from(new Set(fixed().concat((list || []).filter(k=>ok.has(k)))));
  };
  /* The role's list as Setup holds it; every section when Setup never said. */
  function roleSections(saved, role){
    const got = (((saved || {}).roles) || {})[role];
    return Array.isArray(got) ? clean(got) : all();
  }
  /* What this partner may open, and where the answer came from. */
  function resolve(r, saved){
    if(r && Array.isArray(r.portalAccess)) return {sections: clean(r.portalAccess), from: 'partner'};
    return {sections: roleSections(saved, roleKey(r)), from: 'role'};
  }
  const allows = (r, saved, k) => resolve(r, saved).sections.includes(k);
  return {SECTIONS, ROLES, all, fixed, roleKey, clean, roleSections, resolve, allows};
});
