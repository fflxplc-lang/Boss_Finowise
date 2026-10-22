/* Analytics: charts counted from the records the user can see, a chart for
   any pick-list the client form holds data in, and Boss Bot answering
   "...ka chart banao" with a chart counted the same way. */
const http = require('http');
const {suite} = require('../lib/harness');

const MOCK_PORT = Number(process.env.BOSS_PORT || 3000) + 309;
const seen = [];
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d);
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if(req.url.endsWith('/models')) return res.end(JSON.stringify({data:[{id:'mock-model'}]}));
    const j = JSON.parse(body || '{}'); seen.push(j);
    const sys = ((j.messages||[]).find(m=>m.role==='system')||{}).content || '';
    const text = /WHICH RECORDS/.test(sys) ? '{"reads":[{"source":"leads","groupBy":["source"]}],"client":null}' : 'MOCK CHART ANSWER';
    res.end(JSON.stringify({choices:[{message:{role:'assistant', content:text}}]}));
  });
});
const lastUser = () => { const m = seen[seen.length-1].messages; return m[m.length-1].content; };

suite(async t => {
  await new Promise(r => mock.listen(MOCK_PORT, '127.0.0.1', r));
  try {
  await t.home();
  await t.eval(() => {
    const mk = o => { const c = Object.assign({id: uid('CMS'), createdAt: new Date().toISOString(), assignedTo: me().id, branch:'Pune'}, o); initState('CMS', c); DB.clients.push(c); return c; };
    mk({cmsName:'An One', kycStatus:'Validated', riskProfile:'Moderate', firstNomineeName:'X'});
    mk({cmsName:'An Two', kycStatus:'Validated', riskProfile:'Aggressive'});
    mk({cmsName:'An Three', kycStatus:'On Hold', riskProfile:'Moderate', branch:'Mumbai'});
    mk({cmsName:'An Four', kycStatus:'', riskProfile:'Moderate'});
    const L = o => { const l = Object.assign({id: uid('LMS'), createdAt: new Date().toISOString(), assignedTo: me().id, branch:'Pune'}, o); initState('LMS', l); DB.leads.push(l); };
    L({name:'Ld A', source:'Referral'}); L({name:'Ld B', source:'Referral'}); L({name:'Ld C', source:'Seminar'});
  });

  t.section('the Analytics page');
  await t.step('Analytics is in the sidebar under Insights', async () => {
    const r = await t.eval(() => ({group: navGroupOf('analytics'), live: viewIsLive('analytics'), label: NAV_LABELS.analytics}));
    if(r.group !== 'insights' || !r.live || r.label !== 'Analytics') throw new Error(JSON.stringify(r));
    return 'Insights › Analytics';
  });
  await t.step('the page counts the records into charts', async () => {
    await t.eval(() => navigate('analytics'));
    await t.wait(200);
    const r = await t.eval(() => {
      const a = analyticsCharts('clients');
      const kyc = a.charts.find(c=>c.id==='kyc').rows;
      const nom = a.charts.find(c=>c.id==='nominee').rows;
      return {total: a.total, kyc, nom, cards: document.querySelectorAll('#content svg[role=img], main svg[role=img]').length,
        heading: document.body.innerText.includes('KYC Status') && document.body.innerText.includes('Risk Profile')};
    });
    const k = Object.fromEntries(r.kyc.map(x=>[x.label, x.count]));
    if(k.Validated < 2 || k['On Hold'] < 1 || !k['Not recorded']) throw new Error(JSON.stringify(r.kyc));
    if(r.kyc[r.kyc.length-1].label !== 'Not recorded') throw new Error('blank is not last: ' + JSON.stringify(r.kyc));
    if(!r.nom.find(x=>x.label==='Nominee registered')) throw new Error(JSON.stringify(r.nom));
    if(!r.heading || r.cards < 4) throw new Error('page: ' + r.cards + ' charts drawn');
    return r.total + ' clients, ' + r.cards + ' charts drawn';
  });
  await t.step('the leads tab charts leads', async () => {
    const r = await t.eval(() => { setAnalyticsSource('leads'); return analyticsCharts('leads').charts.find(c=>c.id==='source').rows; });
    if(!r.find(x=>x.label==='Referral' && x.count>=2)) throw new Error(JSON.stringify(r));
    await t.eval(() => setAnalyticsSource('clients'));
    return 'lead source charted';
  });
  await t.step('a pick-list with data gets a chart of its own', async () => {
    const r = await t.eval(() => {
      const f = CMS_FIELDS_FLAT.find(f=>f.t==='select' && !['kycStatus','riskProfile','mandateStatus','taxStatus','clientCategory','branch','accountActivated','salutation','gender'].includes(f.k));
      DB.clients.filter(c=>/^An /.test(c.cmsName)).forEach((c,i)=>{ c[f.k] = f.opts ? f.opts[i % 2] : ('V'+(i%2)); });
      const a = analyticsCharts('clients');
      return {field: f.l, auto: a.charts.filter(c=>c.auto).map(c=>c.label)};
    });
    if(!r.auto.includes(r.field)) throw new Error(JSON.stringify(r));
    return '"' + r.field + '" charted automatically';
  });

  t.section('task work by Assign To');
  await t.step('the task tables under the charts count DST tasks per assignee', async () => {
    const r = await t.eval(() => {
      const d = analyticsDays(), mine = me().id;
      const other = 'TM-AN2'; DB.team.push({id:other, name:'An Other', branch:'Pune'});
      const T = o => DB.tasks.push(Object.assign({id: uid('DST'), taskType:'An task', overallStatus:'Not Started', assignedDate:d.today}, o));
      T({assignTo:mine, dueDate:d.today}); T({assignTo:mine, dueDate:d.today}); T({assignTo:other, dueDate:d.today});
      T({assignTo:mine, dueDate:d.yesterday});
      T({assignTo:other, dueDate:d.yesterday, overallStatus:'Completed', completedAt:new Date().toISOString()});
      T({assignTo:mine, dueDate:d.today, parentTaskId:'X'});                    // a sub-task: not counted
      T({assignTo:mine, dueDate:d.today, deletedAt:new Date().toISOString()}); // deleted: not counted
      setAnalyticsSource('clients');
      const rows = analyticsTaskRows();
      const card = id => analyticsTaskCard(ANALYTICS_TASK_CARDS.find(c=>c.id===id), rows).rows;
      return {mineName: teamName(mine), today: card('today'), yest: card('yesterday'), week: card('week'),
        overdue: card('overdue'), text: document.body.innerText,
        under: !!(document.querySelector('#anTasks') && document.querySelector('svg[role=img]') && (document.querySelector('svg[role=img]').compareDocumentPosition(document.querySelector('#anTasks')) & 4))};
    });
    const sum = rows => rows.reduce((s,x)=>s+x.count, 0);
    const mineToday = (r.today.find(x=>x.label===r.mineName)||{}).count;
    if(mineToday !== 2 || sum(r.today) !== 3) throw new Error('today ' + JSON.stringify(r.today));
    if(sum(r.yest) !== 2 || sum(r.overdue) !== 1 || sum(r.week) !== 1) throw new Error(JSON.stringify({y:r.yest, o:r.overdue, w:r.week}));
    if(!r.under) throw new Error('task tables not under the charts');
    for(const h of ["Today's Work", "Yesterday's Work", 'Total Incomplete Tasks', 'Completed Tasks (This Week)', 'Assign To', 'Record Count'])
      if(!r.text.toLowerCase().includes(h.toLowerCase())) throw new Error('page lacks ' + h);
    return 'today 3, yesterday 2, overdue 1, completed this week 1';
  });

  t.section('Boss Bot draws charts');
  await t.step('connect the stand-in model', async () => {
    await t.eval(async (port) => {
      await fetch('/api/connections/bossai', {method:'PUT', headers:Object.assign({'Content-Type':'application/json'}, apiHeaders()),
        body: JSON.stringify({enabled:true, config:{baseUrl:'http://127.0.0.1:'+port+'/v1', model:'mock-model'}})});
      await fetch('/api/connections/bossai/test', {method:'POST', headers: apiHeaders()});
    }, MOCK_PORT);
    return 'connected';
  });
  await t.step('"KYC status ka chart banao" draws the KYC chart from live records', async () => {
    const before = seen.length;
    await t.eval(async () => { navigate('dashboard'); ai.turns = []; aiTogglePanel(); await aiRefreshStatus(true);
      document.getElementById('aiInput').value = 'KYC status ka chart banao'; await aiSend(); });
    if(seen.length !== before + 1) throw new Error((seen.length-before) + ' model calls (no planning expected)');
    const u = lastUser();
    if(!u.includes('"chart"') || !u.includes('KYC Status')) throw new Error(u.slice(0, 300));
    const r = await t.eval(() => ({svg: !!document.querySelector('#aiTurns .boss-chart svg'), text: document.querySelector('#aiTurns').innerText}));
    if(!r.svg || !r.text.includes('KYC Status (Clients)') || !r.text.includes('MOCK CHART ANSWER')) throw new Error(r.text.slice(-300));
    return 'chart drawn under the answer, one model call';
  });
  await t.step('"aaj ke tasks assign to wise chart" draws today\'s work per person', async () => {
    await t.eval(async () => { document.getElementById('aiInput').value = 'aaj ke tasks assign to wise chart banao'; await aiSend(); });
    const c = await t.eval(() => ai.turns[ai.turns.length-1].chart);
    if(!c || c.src !== 'tasks' || !/Today's Work/.test(c.title) || c.total !== 3) throw new Error(JSON.stringify(c));
    return c.title + ', ' + c.total + ' tasks';
  });
  await t.step('a chart nobody named is built from the read Boss plans', async () => {
    await t.eval(async () => { document.getElementById('aiInput').value = 'Show a graph of how many leads came from each referral channel'; await aiSend(); });
    const r = await t.eval(() => { const tn = ai.turns[ai.turns.length-1]; return tn.chart; });
    if(!r || !r.rows.find(x=>x.label==='Referral')) throw new Error(JSON.stringify(r));
    return r.title;
  });
  await t.step('a plain question draws no chart', async () => {
    await t.eval(async () => { document.getElementById('aiInput').value = 'Which documents are needed for transmission?'; await aiSend(); });
    const c = await t.eval(() => ai.turns[ai.turns.length-1].chart);
    if(c) throw new Error('chart on a how-to');
    return 'no chart';
  });
  } finally { mock.close(); }
});
