/* Boss Bot: the SOP library, the alerts on a client's page, and what the
   assistant is actually sent when it answers a question.

   The model is a stand-in that speaks the OpenAI-compatible protocol the
   "BOSS AI (your own model)" connector uses. It records every request, so
   the steps below can read what BOSS put in front of it — which is the
   thing worth testing: the right client, the right SOPs, masked PAN, no
   Aadhaar, and nothing the user could not see. */
const http = require('http');
const {suite} = require('../lib/harness');

const MOCK_PORT = Number(process.env.BOSS_PORT || 3000) + 307;
const seen = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if(req.url.endsWith('/models')) return res.end(JSON.stringify({data:[{id:'mock-model'}]}));
    const j = JSON.parse(body || '{}');
    seen.push(j);
    const sys = ((j.messages||[]).find(m=>m.role==='system')||{}).content || '';
    const u = ((j.messages||[])[(j.messages||[]).length-1]||{}).content || '';
    const idm = u.match(/"id":"(CMS[^"]+)"/);
    const text = /WHICH RECORDS/.test(sys)
      ? '{"reads":[{"source":"clients","groupBy":["branch"],"sum":["aum"]}],"client":null}'
      : /Question: Show .* portfolio/.test(u) && idm ? 'Opening the portfolio.\nOPEN: cms ' + idm[1] + ' portfolio'
      : /Question: Take me to the meetings/.test(u) ? 'Here are the meetings.\nOPEN: meetings'
      : /Question: Open the fake client/.test(u) ? 'Opening.\nOPEN: cms CMS-NOT-REAL overview'
      : 'MOCK ANSWER';
    res.end(JSON.stringify({choices:[{message:{role:'assistant', content:text}}]}));
  });
});
const lastUser = () => { const m = seen[seen.length-1].messages; return m[m.length-1].content; };

suite(async t => {
  await new Promise(r => mock.listen(MOCK_PORT, '127.0.0.1', r));
  try {
  await t.home();

  t.section('the SOP library');
  await t.step('all 71 SOPs and the investment policy are in the page', async () => {
    const n = await t.eval(() => ({ops: BOSS_SOPS.filter(s=>!bossIsPolicy(s)).length, policy: BOSS_POLICY.length}));
    if(n.ops !== 71) throw new Error(n.ops + ' SOPs');
    if(n.policy < 14) throw new Error(n.policy + ' policy entries');
    return n.ops + ' SOPs + ' + n.policy + ' policy entries';
  });
  await t.step('a policy question finds the policy, a book question does not', async () => {
    const got = await t.eval(() => ({
      large: bossSopSearch('Large cap mein kaunsa fund recommend hai').map(s=>s.id),
      alloc: bossSopSearch('conservative client ka asset allocation kya hoga').map(s=>s.id),
      market: bossSopSearch('market expensive hai to kya karein').map(s=>s.id),
      tenure: bossSopSearch('6 saal ke goal ke liye kaunse funds').map(s=>s.id),
      book: bossSopSearch('top 5 clients by AUM').map(s=>s.id),
      kyc: bossSopSearch('KYC hold ho gaya to kya karein').map(s=>s.id),
    }));
    if(got.large.join() !== 'policy-reco-equity') throw new Error('large → ' + got.large);
    if(got.alloc[0] !== 'policy-risk-allocation') throw new Error('alloc → ' + got.alloc);
    if(got.market[0] !== 'policy-valuation-matrix') throw new Error('market → ' + got.market);
    if(got.tenure[0] !== 'policy-goal-tenure-mix') throw new Error('tenure → ' + got.tenure);
    if(!got.tenure.includes('policy-reco-hybrid') || !got.tenure.includes('policy-reco-equity')) throw new Error('tenure mix came without its fund lists: ' + got.tenure);
    if(!got.alloc.includes('policy-valuation-matrix')) throw new Error('allocation came without the valuation matrix: ' + got.alloc);
    if(got.book.length) throw new Error('book question matched ' + got.book);
    if(got.kyc.some(id=>id.startsWith('policy-'))) throw new Error('kyc → ' + got.kyc);
    return 'policy found where asked, nowhere else';
  });
  await t.step('a Hinglish or English question finds the SOP it is about', async () => {
    const got = await t.eval(() => ({
      hold: bossSopSearch('KYC hold ho gaya to kya karein').map(s=>s.id),
      death: bossSopSearch('client ki death ho gayi, transmission ke documents').map(s=>s.id),
      nominee: bossSopSearch('nominee kaise update karein').map(s=>s.id),
      major: bossSopSearch('minor to major process').map(s=>s.id),
      none: bossSopSearch('hello').map(s=>s.id),
      en: bossSopSearch('What should I do if a KYC is on hold?').map(s=>s.id),
    }));
    if(!got.hold.includes('kyc-physical')) throw new Error('hold → ' + got.hold);
    if(got.death[0] !== 'nft-transmission') throw new Error('death → ' + got.death);
    if(got.nominee[0] !== 'nft-nominee') throw new Error('nominee → ' + got.nominee);
    if(got.major[0] !== 'nft-minor-to-major') throw new Error('major → ' + got.major);
    if(got.none.length) throw new Error('hello matched ' + got.none);
    if(!got.en.includes('kyc-physical')) throw new Error('English hold → ' + got.en);
    return JSON.stringify(got);
  });

  t.section('Boss Insights on a client');
  const id = await t.eval(() => {
    const c = {id: uid('CMS'), cmsName: 'Ramesh Kumar Bossbot', createdAt: new Date().toISOString(),
      assignedTo: me().id, branch: 'Pune', kycStatus: 'On Hold', taxStatus: 'Minor',
      dob: '2007-01-15', mandateStatus: 'Pending Approval', pan: 'ABCDE1234F', aadhaar: '999988887777',
      accNo: '123456789012', canIinNo: '5011122233'};
    initState('CMS', c);
    DB.clients.push(c);
    DB.transactions.push({id: uid('TXN'), clientId: c.id, transactionType:'SIP', amount:'5000', status:'Rejected',
      initiatedDate:'2026-10-01'});
    navigate('cms', c.id);
    return c.id;
  });
  await t.wait(300);
  await t.step('the card shows what is wrong, worst first', async () => {
    const rows = await t.eval(() => [...document.querySelectorAll('.boss-ins-row summary')].map(s=>s.textContent.trim()));
    const all = rows.join(' | ');
    ['KYC On Hold', 'Minor to Major', 'Mandate approval', 'No nominee registered', 'transaction(s) rejected', 'No risk profile']
      .forEach(w => { if(!all.includes(w)) throw new Error('missing "' + w + '" in: ' + all); });
    if(!/^Blocker/.test(rows[0])) throw new Error('first row is not the blocker: ' + rows[0]);
    return rows.length + ' alerts';
  });
  await t.step('a row opens to the SOP steps', async () => {
    const txt = await t.eval(() => { const d = document.querySelector('.boss-ins-row'); d.open = true;
      return d.querySelector('.boss-ins-sop').textContent; });
    if(!/CAMS/.test(txt) || !/Documents/.test(txt)) throw new Error(txt.slice(0, 200));
    return 'physical KYC steps shown';
  });

  t.section('asking Boss Bot');
  await t.step('connect the stand-in model', async () => {
    const r = await t.eval(async (port) => {
      await fetch('/api/connections/bossai', {method:'PUT', headers:Object.assign({'Content-Type':'application/json'}, apiHeaders()),
        body: JSON.stringify({enabled:true, config:{baseUrl:'http://127.0.0.1:'+port+'/v1', model:'mock-model'}})});
      const t = await fetch('/api/connections/bossai/test', {method:'POST', headers: apiHeaders()});
      return (await t.json());
    }, MOCK_PORT);
    if(!r.ok && !/Connected/.test(JSON.stringify(r))) throw new Error(JSON.stringify(r));
    return 'connected';
  });
  await t.step('on the client page, the answer is built from that client', async () => {
    await t.eval(async () => { aiTogglePanel(); await aiRefreshStatus(true);
      document.getElementById('aiInput').value = 'What is pending on this client?'; await aiSend(); });
    const u = lastUser();
    if(!u.includes('Ramesh Kumar Bossbot')) throw new Error('client not in data');
    if(u.includes('999988887777')) throw new Error('Aadhaar was sent');
    if(u.includes('123456789012')) throw new Error('account number was sent');
    if(u.includes('ABCDE1234F') || !u.includes('******234F')) throw new Error('PAN not masked');
    if(!u.includes('KYC On Hold')) throw new Error('alerts not in data');
    if(!u.includes('[kyc-physical]')) throw new Error('the SOP for the KYC hold was not sent');
    const shown = await t.eval(() => document.querySelector('#aiTurns').textContent);
    if(!shown.includes('MOCK ANSWER') || !shown.includes('Open account')) throw new Error(shown.slice(-300));
    return u.length + ' chars sent, one model call';
  });
  await t.step('a how-to question gets the SOP, and no records', async () => {
    const before = seen.length;
    await t.eval(async () => { aiCloseP(); navigate('dashboard'); ai.turns = []; aiTogglePanel(); await aiRefreshStatus(true);
      document.getElementById('aiInput').value = 'Which documents are needed for transmission?'; await aiSend(); });
    if(seen.length !== before + 1) throw new Error((seen.length - before) + ' model calls');
    const u = lastUser();
    if(!u.includes('[nft-transmission]')) throw new Error('SOP not sent');
    if(!u.includes('none read')) throw new Error('records were read for a how-to');
    return 'SOP sent, no data';
  });
  await t.step('a fund question gets the recommended list, and no records', async () => {
    const before = seen.length;
    await t.eval(async () => { document.getElementById('aiInput').value = 'Which is the best large cap fund to recommend?'; await aiSend(); });
    if(seen.length !== before + 1) throw new Error((seen.length - before) + ' model calls');
    const u = lastUser();
    if(!u.includes('[policy-reco-equity]') || !u.includes('Large cap: most recommended Nippon India Large Cap Fund, HDFC Large Cap Fund')) throw new Error(u.slice(0, 400));
    if(!u.includes('none read')) throw new Error('records were read for a policy question');
    return 'recommended list sent, no data';
  });
  await t.step('a book-wide question plans a read, BOSS does it, then answers', async () => {
    const before = seen.length;
    await t.eval(async () => { document.getElementById('aiInput').value = 'How many clients are there in each branch, and what is their total AUM?'; await aiSend(); });
    if(seen.length !== before + 2) throw new Error((seen.length - before) + ' model calls; last: ' + lastUser().slice(0,300) + ' || panel: ' + (await t.eval(() => document.querySelector('#aiTurns').textContent.slice(-300))));
    const u = lastUser();
    if(!u.includes('"groupBy":["branch"]') || !u.includes('Pune')) throw new Error(u.slice(0, 400));
    return 'plan + answer, grouped by branch';
  });
  await t.step('while it works it shows typing, then types the answer out', async () => {
    const r = await t.eval(async () => {
      document.getElementById('aiInput').value = 'Which documents are needed for transmission?';
      const p = aiSend();
      const dots = !!document.querySelector('#aiTurns .ai-dots');
      let caret = false;
      const iv = setInterval(()=>{ if(document.querySelector('#aiLiveBubble.ai-caret')) caret = true; }, 5);
      await p; clearInterval(iv);
      return {dots, caret, after: !!document.querySelector('#aiLiveBubble'), last: [...document.querySelectorAll('#aiTurns .ai-bot .ai-bubble')].pop().textContent};
    });
    if(!r.dots) throw new Error('no typing dots while waiting');
    if(!r.caret) throw new Error('the answer was not typed out');
    if(r.after || r.last !== 'MOCK ANSWER') throw new Error(JSON.stringify(r));
    return 'dots, then typed';
  });
  await t.step('a client named in the question is read without a plan', async () => {
    const before = seen.length;
    await t.eval(async () => { document.getElementById('aiInput').value = 'What is the mandate status of Ramesh Kumar Bossbot?'; await aiSend(); });
    if(seen.length !== before + 1) throw new Error((seen.length - before) + ' model calls');
    if(!lastUser().includes('Pending Approval')) throw new Error('mandate status not in data');
    return 'found by name';
  });
  t.section('taking you to the screen');
  await t.step('"show me X portfolio" opens that client on the Portfolio tab', async () => {
    const r = await t.eval(async () => { aiCloseP(); navigate('dashboard'); ai.turns = []; aiTogglePanel(); await aiRefreshStatus(true);
      document.getElementById('aiInput').value = 'Show Ramesh Kumar Bossbot portfolio'; await aiSend();
      const last = [...document.querySelectorAll('#aiTurns .ai-bot .ai-bubble')].pop().textContent;
      return {view: currentView, rec: clientDetailId, tab: window._clientTab, last, opened: document.querySelector('#aiTurns').textContent.includes('Opened:'), dup: [...document.querySelectorAll('#aiTurns .ai-bot')].pop().textContent.includes('Open account'),
              ctx: ai.context && ai.context.recordId}; }, null);
    if(r.view !== 'cms' || r.rec !== id || r.tab !== 'portfolio') throw new Error(JSON.stringify(r));
    if(/OPEN:/.test(r.last)) throw new Error('the OPEN line showed: ' + r.last);
    if(!r.opened || r.ctx !== id) throw new Error(JSON.stringify(r));
    if(r.dup) throw new Error('an Open account button sits beside the Opened one');
    return 'cms › portfolio, line hidden';
  });
  await t.step('a page by name opens that page', async () => {
    const v = await t.eval(async () => { document.getElementById('aiInput').value = 'Take me to the meetings page'; await aiSend(); return currentView; });
    if(v !== 'meetings') throw new Error(v);
    return 'meetings';
  });
  await t.step('an id the model made up opens nothing', async () => {
    const v = await t.eval(async () => { document.getElementById('aiInput').value = 'Open the fake client'; await aiSend(); return currentView; });
    if(v !== 'meetings') throw new Error('moved to ' + v);
    return 'stayed put';
  });
  } finally { mock.close(); }
});
