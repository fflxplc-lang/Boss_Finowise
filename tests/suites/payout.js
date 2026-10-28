/* PAYOUTS — WealthFlow's screens inside BOSS.

   Walks the test pack in tests/fixtures/payout (TEST-GUIDE.md there has the
   figures) through the screens a person uses: the team is added, the nine
   registrar files go in through Data Import, the client mapping sheet goes
   in through Reconciliation's preview-then-apply, and Team payouts must
   then show TEST-GUIDE's July and August figures. Then every payout screen
   and tab is drawn, and none may show an error. */
const path = require('path');
const {suite} = require('../lib/harness');
const PACK = path.join(__dirname, '..', 'fixtures', 'payout');

const TEAM = [
  ['Finowise Freedom LLP', 'finowise@example.com', 'ARN-270604', 6, null],
  ['PRIYA NAIR', 'priya@example.com', 'ARN-270607', 5, 'Finowise Freedom LLP'],
  ['ANMOL KUMAR JHA', 'anmol@example.com', 'ARN-270605', 4, 'PRIYA NAIR'],
  ['RAVISANKAR K K', 'ravi@example.com', 'ARN-270606', 3, 'ANMOL KUMAR JHA'],
  ['DIVYA DILIP SHINDE', 'divya@example.com', 'WF-102', 2, 'ANMOL KUMAR JHA'],
  ['Johnson M John', 'johnson@example.com', 'WF-101', 1, 'ANMOL KUMAR JHA'],
  ['KIRAN PATIL', 'kiran@example.com', 'WF-103', 1, 'ANMOL KUMAR JHA'],
  ['SURESH MENON', 'suresh@example.com', 'WF-104', 3, 'PRIYA NAIR'],
  ['MEENA IYER', 'meena@example.com', 'WF-105', 1, 'PRIYA NAIR'],
];
const IMPORTS = [
  ['Aug-26 WBR9 Folio Master File.xlsx', 'folio', 'CAMS', '08', 7],
  ['Aug-26 211 Folio Master File.csv', 'folio', 'KARVY', '08', 4],
  ['Aug-26 WBR2 Trxn File.xlsx', 'transactions', 'CAMS', '08', 7],
  ['Aug-26 201 Trxn File.csv', 'transactions', 'KARVY', '08', 5],
  ['Jul-26 CAMS Brokerage File.xlsx', 'brokerage', 'CAMS', '07', 6],
  ['Jul-26 KFIN Brokerage File.csv', 'brokerage', 'KARVY', '07', 4],
  ['Aug-26 CAMS Brokerage File.xlsx', 'brokerage', 'CAMS', '08', 6],
  ['Aug-26 CAMS SIF Brokerage File.xlsx', 'brokerage', 'CAMS', '08', 1],
  ['Aug-26 KFIN Brokerage File.csv', 'brokerage', 'KARVY', '08', 4],
];
const EXPECT = {'ANMOL KUMAR JHA': [3690, 4300], 'PRIYA NAIR': [2160, 2425], 'Johnson M John': [675, 750], 'RAVISANKAR K K': [405, 675],
  'MEENA IYER': [585, 650], 'Finowise Freedom LLP': [450, 525], 'DIVYA DILIP SHINDE': [450, 500], 'KIRAN PATIL': [135, 150]};

suite(async t => {
  const p = t.page;
  const settled = () => p.waitForFunction(() => !document.querySelector('#content .py-loading'), null, {timeout: 15000});

  await t.step('an admin finds Payouts in the rail with all nine screens', async () => {
    await t.home();
    await p.waitForFunction(() => typeof PY !== 'undefined' && PY.me !== undefined, null, {timeout: 10000});
    const items = await t.eval(() => { const g = railNavGroups().find(g => g.id === 'payouts'); return g ? g.items.filter(v => pyViewOpen(v)) : []; });
    if(items.length !== 9) throw new Error('payout screens open: ' + items.join(','));
    const me = await t.eval(() => PY.me);
    if(me.role !== 'admin') throw new Error('a BOSS admin should be a payout admin, got ' + JSON.stringify(me));
    return me.email + ' is a payout admin';
  });

  await t.step('the team of nine is added', async () => {
    const n = await t.eval(async team => {
      const ids = {};
      for(const [name, email, code, level, parent] of team)
        ids[name] = (await pyPost('/users', {name, email, code, level, role: 'ops', parent_id: parent ? ids[parent] : '', address: {state: 'Maharashtra'}})).id;
      return Object.keys(ids).length;
    }, TEAM);
    if(n !== 9) throw new Error(n + ' added');
    await t.eval(() => { PY.s.clientsTab = 'hierarchy'; pyInvalidate(); navigate('pyclients'); });
    await settled();
    const rows = await p.$$eval('#content .py-table tbody tr', r => r.length);
    if(rows < 10) throw new Error('hierarchy shows ' + rows + ' rows');
    return rows + ' rows in Hierarchy';
  });

  await t.step('the payout team exports to Excel, all of it', async () => {
    const r = await t.eval(async () => {
      let got = null;
      const was = window.downloadXlsx;
      window.downloadXlsx = (sheets, name) => { got = {name, rows: sheets[0].rows}; };
      PY.s.userQ = 'zzz-nobody';
      await pyUserExport();
      window.downloadXlsx = was; PY.s.userQ = '';
      return got && {name: got.name, n: got.rows.length - 1, head: got.rows[0].slice(0, 8).join('|'), button: !!Array.from(document.querySelectorAll('#content button')).find(b=>/Export/.test(b.textContent))};
    });
    if(!r || !/^Payout_Team_.*\.xlsx$/.test(r.name) || r.n < 9 || !/Name\|Email \(BOSS login\)\|Employee \/ ARN Code\|Role\|Primary Level/.test(r.head) || !r.button) throw new Error(JSON.stringify(r));
    return r.n + ' people in ' + r.name + ', whatever the search box held';
  });

  await t.step('the nine registrar files go in through Data Import', async () => {
    const seen = [];
    for(const [file, kind, source, month, rows] of IMPORTS){
      await t.eval(([kind, source, month]) => { PY.s.impTab = 'new'; PY.s.impSel = {kind, source, month, year: '2026'}; navigate('pyimports'); }, [kind, source, month]);
      await p.setInputFiles('#pyImpFile', path.join(PACK, file));
      await p.waitForFunction(f => PY.s.impResult && PY.s.impResult.fileName === f && !PY.s.impBusy, file, {timeout: 20000});
      const got = await t.eval(() => PY.s.impResult.rows);
      if(got !== rows) throw new Error(file + ': ' + got + ' rows, want ' + rows);
      seen.push(got);
    }
    return seen.reduce((a, b) => a + b, 0) + ' rows across ' + seen.length + ' files';
  });

  await t.step('the client mapping sheet is previewed, then applied', async () => {
    await t.eval(() => { PY.s.repTab = 'recon'; navigate('pyreports'); });
    await settled();
    await p.setInputFiles('#pyFile_pyBulkPreview', path.join(PACK, 'Client mapping.xlsx'));
    await p.waitForSelector('button:has-text("Apply 9 change(s)")', {timeout: 15000});
    await p.click('button:has-text("Apply 9 change(s)")');
    await p.waitForFunction(() => !document.getElementById('overlay').classList.contains('show'), null, {timeout: 15000});
    return '9 clients mapped';
  });

  await t.step('Team payouts shows the July and August figures from TEST-GUIDE', async () => {
    const read = async month => {
      await t.eval(m => { PY.s.repTab = 'team'; PY.s.repYear = '2026'; PY.s.repMonth = m; navigate('pyreports'); }, month);
      await settled();
      return t.eval(() => Object.fromEntries(PY.rows.team.map(r => [r.name, Math.round(r.earnings)])));
    };
    const jul = await read('07'), aug = await read('08');
    const bad = Object.entries(EXPECT).filter(([n, [j, a]]) => (jul[n] || 0) !== j || (aug[n] || 0) !== a)
      .map(([n, [j, a]]) => `${n} July ${jul[n]} (want ${j}) Aug ${aug[n]} (want ${a})`);
    if(bad.length) throw new Error(bad.join('; '));
    return 'Anmol ₹' + aug['ANMOL KUMAR JHA'] + ' in August';
  });

  await t.step('the main dashboard shows the partner business, the firm’s or one person’s team', async () => {
    const r = await t.eval(async () => {
      const firm = await pyGet('/dashboard/partners');
      const anmol = await pyGet('/dashboard/partners?email=anmol@example.com');
      const kiran = await pyGet('/dashboard/partners?email=kiran@example.com');
      const nobody = await pyGet('/dashboard/partners?email=nobody@example.com');
      window._dashWho = ''; DASH_PY.cache = {};
      navigate('dashboard');
      await new Promise(r => setTimeout(r, 1500));
      const box = document.getElementById('dashPyTeam');
      return {firm: firm.totals, scope: firm.scope, anmol: anmol.totals, kiran: kiran.totals, nobody: !!nobody.none,
        anmolTeam: anmol.team.map(x => x.name), kiranTeam: kiran.team.map(x => x.name),
        rows: box ? box.querySelectorAll('tbody tr').length : -1, trend: firm.trend.length};
    });
    const names = r.anmolTeam.join('|');
    if(r.scope !== 'firm' || !(r.firm.gross12 > 0) || !(r.firm.clients > 0) || r.trend !== 6) throw new Error('firm ' + JSON.stringify(r));
    if(!(r.anmol.gross12 > 0) || r.anmol.gross12 > r.firm.gross12 || r.kiran.gross12 > r.anmol.gross12) throw new Error('totals ' + JSON.stringify(r));
    if(!/ANMOL KUMAR JHA/.test(names) || /PRIYA NAIR|MEENA IYER|SURESH MENON/.test(names)) throw new Error('Anmol’s team ' + names);
    if(r.kiranTeam.some(n => n !== 'KIRAN PATIL') || !r.nobody) throw new Error('Kiran ' + JSON.stringify(r));
    if(r.rows < 1) throw new Error('the dashboard has no partner table: ' + r.rows);
    return 'firm ₹' + Math.round(r.firm.gross12) + ' over 12 months, Anmol’s team ₹' + Math.round(r.anmol.gross12) + ', Kiran ₹' + Math.round(r.kiran.gross12) + '; ' + r.rows + ' people on the dashboard';
  });

  await t.step('every payout screen and tab draws without an error', async () => {
    const tabs = {pyimports: ['impTab', ['new', 'history', 'trash']], pyclients: ['clientsTab', ['hierarchy', 'clients', 'standardize']],
      pyreports: ['repTab', ['summary', 'monthly', 'client', 'logs', 'team', 'growth', 'approvals', 'recon']],
      pysettings: ['setTab', ['profile', 'global', 'sharing', 'lead', 'activity', 'system']]};
    let n = 0;
    for(const v of ['pydash', 'pyimports', 'pyclients', 'pyreports', 'pyrates', 'pypartner', 'pyledger', 'pyaudit', 'pysettings']){
      for(const tab of (tabs[v] ? tabs[v][1] : [null])){
        await t.eval(([v, k, tab]) => { if(k) PY.s[k] = tab; navigate(v); }, [v, tabs[v] && tabs[v][0], tab]);
        await settled();
        const state = await t.eval(() => ({view: currentView, err: (document.querySelector('#content .py-error') || {}).innerText || ''}));
        if(state.view !== v || state.err) throw new Error(v + ' ' + (tab || '') + ': ' + (state.err || 'landed on ' + state.view));
        n++;
      }
    }
    return n + ' screens';
  });
});
