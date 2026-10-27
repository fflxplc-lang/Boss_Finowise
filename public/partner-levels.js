/* PARTNER LEVELS — what an active partner opens when they sign in to BOSS,
   and whose records they see.

   Partners work in the same platform as the firm, not on a page of
   their own: a partner is a team member carrying partnerPobId (their
   Partner Onboarding record) and partnerLevel (L1–L6). The level says
   which parts of the rail open and how far their data reaches. It comes
   from the firm's organisation structure (External sheet):

     L1 Ninja          Client Journey                         own business only
     L2 Super Ninja    Client Journey, Operations             own business only
     L3 Sherpa         Client Journey, Operations, Sales      partners mapped to them
     L4 Master Sherpa  everything                             partners mapped to them
     L5 Monks          everything and HR                      team and partners mapped
     L6 Zen Monks      everything and HR                      team and partners mapped

   Every level sees its own tasks, performance and payouts in Partner
   Journey and raises queries in PQS (L3 up also follows its team's).
   "Everything" includes Partner Journey itself (PPS, Onboarding, PMS),
   so L4–L6 onboard partners and build their own teams there. Setup ›
   Partner Levels changes any of it.

   Loaded by the CRM (index.html) and by the server, which will hold the
   same rule. */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.PartnerLevels = factory();
})(typeof self !== 'undefined' ? self : this, function(){
  /* The rail groups a level can be given, by NAV_GROUPS id, and the
     permission modules each one needs to be worked rather than looked at. */
  const GROUPS = [
    {k:'pipeline',   l:'Client Journey',  modules:['LMS','CMS','RMS','Meetings','Calls']},
    {k:'operations', l:'Operations',      modules:['DST','Queries','Projects']},
    {k:'business',   l:'Sales (Business)',modules:['Business','Recommendations','Transactions']},
    {k:'advisory',   l:'Communications',  modules:['Meetings','Calls']},
    {k:'blueprint',  l:'Blueprint',       modules:['Recommendations']},
    {k:'forms',      l:'Forms',           modules:[]},
    {k:'insights',   l:'Insights',        modules:[]},
    {k:'hr',         l:'HR',              modules:[]},
    {k:'partnerjourney', l:'Partner Journey (PPS, Onboarding, PMS)', modules:['Partners']},
  ];
  /* Groups added after a firm may already have saved its levels: a level
     whose defaults hold one gets it, unless it was saved since. */
  const LATER = {partnerjourney: 2};
  const VERSION = 2;
  const ALL = GROUPS.map(g=>g.k);
  const EVERYTHING = ALL.filter(k=>k !== 'hr');
  const SCOPES = [['own','Own business only'], ['team','Partners mapped to them'], ['all','Everyone']];
  const LEVELS = [
    {k:'L1', name:'Ninja',         pobRole:'Ninja',       groups:['pipeline'],                         scope:'own'},
    {k:'L2', name:'Super Ninja',   pobRole:'Super Ninja', groups:['pipeline','operations'],            scope:'own'},
    {k:'L3', name:'Sherpa',        pobRole:'Sherpa',      groups:['pipeline','operations','business'], scope:'team'},
    {k:'L4', name:'Master Sherpa', pobRole:'',            groups:EVERYTHING,                           scope:'team'},
    {k:'L5', name:'Monks',         pobRole:'',            groups:ALL,                                  scope:'team'},
    {k:'L6', name:'Zen Monks',     pobRole:'',            groups:ALL,                                  scope:'team'},
  ];
  const ACTIONS = ['view','create','edit','changeStage','changeStatus','upload','download'];
  const roleName = lv => lv.name + ' (' + lv.k + ')';
  /* The levels as Setup holds them: the defaults, with what was saved over them. */
  function levels(saved){
    const s = (saved && saved.levels) || {};
    return LEVELS.map(d=>{
      const o = s[d.k] || {};
      let groups = Array.isArray(o.groups) ? o.groups.filter(g=>ALL.includes(g)) : d.groups.slice();
      const v = Number((saved && saved.v) || 1);
      if(Array.isArray(o.groups)) Object.keys(LATER).forEach(g=>{ if(v < LATER[g] && d.groups.includes(g) && !groups.includes(g)) groups.push(g); });
      return Object.assign({}, d, {
        groups,
        scope: SCOPES.some(x=>x[0] === o.scope) ? o.scope : d.scope,
      });
    });
  }
  const level = (saved, k) => levels(saved).find(x=>x.k === k) || null;
  /* The level a partner starts at, from the role their onboarding confirmed. */
  function levelForRole(role){
    const lv = LEVELS.find(x=>x.pobRole && x.pobRole === role);
    return lv ? lv.k : 'L1';
  }
  /* The permission grid a level hands its partners: the modules its
     groups need, View on Partners to read their own Partner Journey and
     performance (the pages they open there are only those), and PQS of
     its own: every level raises queries and follows them; a level that
     sees its team (L3 up) also works its team's. */
  function perms(lv, allModules){
    const out = {};
    (allModules || []).forEach(m=>{ out[m] = {}; });
    const mods = new Set();
    lv.groups.forEach(g=>{ const x = GROUPS.find(y=>y.k === g); (x ? x.modules : []).forEach(m=>mods.add(m)); });
    mods.forEach(m=>{ out[m] = {}; ACTIONS.forEach(a=>{ out[m][a] = 1; }); });
    out.Partners = Object.assign({}, out.Partners, {view: 1});
    out.PQS = {view: 1, create: 1, edit: lv.scope === 'own' ? 0 : 1};
    return out;
  }
  return {GROUPS, LEVELS, SCOPES, ACTIONS, VERSION, roleName, levels, level, levelForRole, perms};
});
