/* PARTNER TARGETS — the one place a partner's achievement is counted.

   Loaded twice: by the CRM (index.html, for Partner Journey ›
   Performance) and by the server (partner-portal.js, for the partner's
   own login at /partner), so the figure a partner sees and the figure
   their RM sees cannot drift apart.

   It is plain data in, plain numbers out. The caller hands over the
   partner's onboarding record and the lists to read; nothing here
   reaches for a store. The measures come from the Partner Onboarding
   flowchart (see the notes beside viewPPF in index.html). */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.PartnerTargets = factory();
})(typeof self !== 'undefined' ? self : this, function(){
  const METRICS = [
    {k:'prospects',   l:'Prospects collected',              step:'Collection of 100 prospects and data feed in CRM'},
    {k:'qualified',   l:'Leads qualified',                  step:'MANIA sheet updation for lead qualification'},
    {k:'meetings',    l:'Meetings with Client RM',          step:'Schedule a meeting of the lead with the Client RM'},
    {k:'riskProfiles',l:'Risk profiling / data gathering',  step:'Get the RR sheet · complete the risk profiling'},
    {k:'allocations', l:'Allocation presented',             step:'Send the investment allocation sheet to the client'},
    {k:'conversions', l:'Leads converted to clients',       step:'Is the lead converted to a client?'},
    {k:'onboarded',   l:'Clients onboarded',                step:'Complete the onboarding of the client'},
    {k:'transactions',l:'Financial transactions',           step:'Complete the financial transactions'},
    {k:'business',    l:'Business amount',                  step:'Value of those transactions', money:true},
    {k:'reviews',     l:'Client reviews conducted',         step:'Conduct client reviews as per frequency'},
    {k:'monthly',     l:'Monthly reviews held',             step:'Target setting, monthly review and follow up'},
  ];
  // What the flowchart asks of each role, per month, until Setup says otherwise.
  const DEFAULTS = {
    'Ninja':       {prospects:25, qualified:10, meetings:5, conversions:1, monthly:1},
    'Super Ninja': {meetings:4, riskProfiles:3, allocations:3, conversions:2, onboarded:2, transactions:4, business:500000, monthly:1},
    'Sherpa':      {prospects:20, qualified:8, meetings:4, conversions:2, onboarded:2, transactions:4, business:300000, reviews:4, monthly:1},
  };
  const ROLES = ['Ninja', 'Super Ninja', 'Sherpa'];
  /* A partner whose role was never confirmed in BOSS — an FBM or FBP brought
     over from the old system — is measured too, on targets of their own. */
  const NO_ROLE = 'No role yet';
  const STATUS = [[100,'Exceeds Target','ok'], [75,'On Track','info'], [50,'Needs Improvement','warn'], [-Infinity,'At Risk','danger']];
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const CLIENT_ONBOARDED_FROM = 'mandateRegistration';
  // The lead stages each measure is reached at.
  const LMS = {qualified:['qualified'], meetings:['firstMeetingScheduled'], riskProfiles:['planInputSubmitted','dataGatheringSent'],
    allocations:['thirdMeetingDone','blueprintSentToLead']};

  const monthKey = d => String(d || '').slice(0, 7);
  function shiftMonth(m, k){ let y = +m.slice(0,4), n = +m.slice(5,7) + k; while(n < 1){ n += 12; y--; } while(n > 12){ n -= 12; y++; } return y + '-' + String(n).padStart(2,'0'); }
  const monLabel = m => MON[+m.slice(5,7) - 1] + ' ' + m.slice(0,4);
  function num(v){ const n = Number(String(v === undefined || v === null ? '' : v).replace(/[^0-9.\-]/g,'')); return isFinite(n) ? n : 0; }
  const roleOf = r => r.role || NO_ROLE;
  const roleKeys = () => ROLES.concat([NO_ROLE]);

  /* Each role's monthly targets: the defaults, with Setup's saved ones over them. */
  function roleTargets(saved){
    const roles = {};
    roleKeys().forEach(role=>{ roles[role] = Object.assign({}, DEFAULTS[role] || {}, ((saved || {}).roles || {})[role] || {}); });
    return roles;
  }

  /* Every dated achievement of one partner: [{k, at, v}].
     src: {leads, clients, transactions, reviews, partnerReviews, cmsOrder} —
     every list already narrowed to what is not deleted is fine, but not needed. */
  function events(r, src){
    const out = [];
    const add = (k, at, v) => { if(at) out.push({k, at: String(at), v: v === undefined ? 1 : v}); };
    const firstAt = (hist, ids) => { const h = (hist || []).find(x=>x && ids.includes(x.state)); return h && h.at; };
    const leads = (src.leads || []).filter(l=>l && !l.deletedAt && l.partnerPobId === r.id);
    const clients = (src.clients || []).filter(c=>c && !c.deletedAt && c.partnerPobId === r.id);
    leads.forEach(l=>{
      add('prospects', l.createdAt);
      Object.keys(LMS).forEach(k=>add(k, firstAt(l.blueprintHistory, LMS[k])));
    });
    const cms = src.cmsOrder || [];
    const onbFrom = cms.indexOf(CLIENT_ONBOARDED_FROM);
    const clientIds = new Set();
    clients.forEach(c=>{
      clientIds.add(c.id);
      add('prospects', c.lmsCreatedAt || c.createdAt);
      Object.keys(LMS).forEach(k=>add(k, firstAt(c.lmsHistory, LMS[k])));
      add('conversions', c.createdAt);
      const onb = (c.blueprintHistory || []).find(h=>h && onbFrom >= 0 && cms.indexOf(h.state) >= onbFrom);
      add('onboarded', onb && onb.at);
    });
    (src.transactions || []).forEach(t=>{
      if(!t || t.deletedAt || !clientIds.has(t.clientId) || /reject|cancel|fail/i.test(t.status || '')) return;
      const at = t.initiatedDate || t.createdAt;
      add('transactions', at);
      add('business', at, num(t.amount));
    });
    (src.reviews || []).forEach(rv=>{
      if(!rv || rv.deletedAt || !clientIds.has(rv.clientId) || rv.rmsStatus !== 'closed') return;
      const h = (rv.blueprintHistory || []).slice().reverse().find(x=>x && x.state === 'closed');
      add('reviews', (h && h.at) || rv.updatedAt || rv.meetingDate);
    });
    (src.partnerReviews || []).forEach(rv=>{ if(rv && !rv.deletedAt && rv.pobId === r.id && rv.kind !== 'Annual Review' && rv.status === 'Completed') add('monthly', rv.completedAt); });
    // Achievements outside BOSS, entered by hand per month.
    Object.entries(r.ptManual || {}).forEach(([m, row])=>Object.entries(row || {}).forEach(([k, v])=>{ if(num(v)) add(k, m + '-15', num(v)); }));
    return out;
  }
  /* Achieved in the months from..to (YYYY-MM, inclusive), per measure. */
  function sum(evs, from, to){
    const out = {}; METRICS.forEach(m=>{ out[m.k] = 0; });
    evs.forEach(e=>{ const m = monthKey(e.at); if(m >= from && m <= to && out[e.k] !== undefined) out[e.k] += e.v; });
    return out;
  }
  /* Targets start in the month the partner's road started: the role
     confirmed, else activation, else the record itself. Before that there
     was nothing to hit, so nothing is counted as missed. */
  function startMonth(r){
    const h = (r.blueprintHistory || []).find(x=>x && (x.state === 'roleWorkflow' || x.state === 'active'));
    return monthKey((h && h.at) || r.activatedAt || r.createdAt) || '0000-00';
  }
  /* A partner's monthly target for a measure in a given month: their own for
     that year, set at their Target Setting, else their role's. */
  function targetFor(r, k, month, roles){
    if(month < startMonth(r)) return 0;
    const own = ((r.ptTargets || {})[month.slice(0,4)] || {})[k];
    if(own !== undefined && own !== '') return num(own);
    const role = roles[roleOf(r)];
    return num(role && role[k]);
  }
  function targets(r, from, to, roles){
    const out = {}; METRICS.forEach(m=>{ out[m.k] = 0; });
    for(let m = from; m <= to; m = shiftMonth(m, 1)) METRICS.forEach(x=>{ out[x.k] += targetFor(r, x.k, m, roles); });
    return out;
  }
  /* Overall achievement: the average of each targeted measure's %, each
     capped at 150% so one runaway figure cannot hide the rest. */
  function overall(ach, tgt){
    const ks = METRICS.filter(m=>tgt[m.k] > 0);
    if(!ks.length) return null;
    return ks.reduce((s, m)=>s + Math.min(150, ach[m.k] * 100 / tgt[m.k]), 0) / ks.length;
  }
  const status = pct => pct == null ? null : STATUS.find(([min])=>pct >= min);
  const growth = (cur, prev) => prev ? (cur - prev) * 100 / prev : null;

  /* One partner's whole scorecard, as the partner's own login shows it:
     this month and the two before, this year and the two before (cut to
     the same months), and the twelve months of the year. */
  function scorecard(r, src, roles, today){
    const evs = events(r, src), now = monthKey(today);
    const m = [0, -1, -2].map(k=>shiftMonth(now, k));
    const y = +now.slice(0,4), lastM = now.slice(5,7);
    const yr = [0, -1, -2].map(k=>({from: (y+k) + '-01', to: (y+k) + '-' + lastM, label: (lastM === '12' ? '' : 'Jan–' + MON[+lastM - 1] + ' ') + (y+k)}));
    const rows = (from, to, tgtFrom, tgtTo) => {
      const a = sum(evs, from, to), t = targets(r, tgtFrom || from, tgtTo || to, roles);
      return {achieved: a, target: t, overall: overall(a, t)};
    };
    return {
      metrics: METRICS, role: roleOf(r), start: startMonth(r),
      month: {periods: m.map(x=>({from: x, to: x, label: monLabel(x)})), data: m.map(x=>rows(x, x))},
      year: {periods: yr, yearTarget: targets(r, y + '-01', y + '-12', roles), data: yr.map(p=>rows(p.from, p.to))},
      months: MON.map((_, i)=>{ const x = y + '-' + String(i+1).padStart(2,'0'); return Object.assign({month: x, label: monLabel(x), future: x > now}, rows(x, x)); }),
    };
  }

  return {METRICS, DEFAULTS, ROLES, NO_ROLE, STATUS, MON, LMS, CLIENT_ONBOARDED_FROM, monthKey, shiftMonth, monLabel, num, roleOf, roleKeys, roleTargets,
    events, sum, startMonth, targetFor, targets, overall, status, growth, scorecard};
});
