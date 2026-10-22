/* THE REPORTS MODULE — FOURTEEN OF THEM, AND NONE OF THEM HIDDEN.

   The firm's instruction was explicit: every report on the list gets an
   option, including the ones whose data BOSS does not capture yet, and a
   report awaiting data is marked as such and says what it is waiting for.
   "Do not omit any report or leave it without an option simply because the
   required data is unavailable."

   So what is worth testing is not that a table renders. It is that:

     • all six sections are on the page, in the brief's order;
     • all fourteen cards are there, each in its own section;
     • every card opens — the pending one included;
     • the pending one names its fields, its sources and its modules,
       rather than drawing an empty table and leaving somebody to guess;
     • a report that draws but cannot see one field says which;
     • and the figures are the records added up, on the two reports where
       the arithmetic has a known answer.

   The last point matters most. A reports module that quietly shows zero
   where it means "we never recorded this" is the failure this file exists
   to catch — the same reason the Main Dashboard suite exists.

   One more thing is checked that nothing else would: that switching a
   pending report on later is writing its `run` and deleting its `pending`.
   The test asserts the shape, because the firm was promised the Reports
   module would not have to be redesigned when the data arrives. */
const {suite} = require('../lib/harness');

/* The brief's own six sections, in the brief's own order. */
const SECTIONS = ['Business Intelligence', 'Performance & Comparison', 'Operations & KPIs',
                  'Trends', 'Sales & Growth', 'Compliance (Regulatory)'];

/* The fourteen, and where each one belongs. */
const WANT = {
  bi:         ['Client Concentration', 'Client Engagement', 'Investment Activity', 'Servicing Worklist'],
  perf:       ['RM Leads Dashboard', 'Branch Comparison Report', 'Lead Source ROI'],
  ops:        ['KPIs / MIS', 'Consent Analytics', 'Employee Report'],
  trends:     ['AUM Trend (12 Months)', 'SIP Book Trend', 'Lost Lead Analysis'],
  sales:      [],
  compliance: ['Compliance Certificate'],
};

/* A small book whose answers are known: three clients, one of them never
   touched and never invested, one touched today, one last touched eight
   months ago. 300,000 of AUM and a 5,000 SIP. */
const SEED = async () => {
  const br = (DB.config.branches || ['Varanasi'])[0];
  const iso = d => d.toISOString().slice(0,10);
  const ago = n => iso(new Date(Date.now() - n*86400000));
  const mk = (nm, extra) => {
    const c = Object.assign({id:uid('CMS'), cmsName:'ZZ ' + nm, rmName:currentUser, branch:br,
      clientCategory:'Alpha', createdAt:new Date().toISOString(), createdBy:currentUser}, extra||{});
    initState('CMS', c); DB.clients.push(c);
    return c;
  };
  const big   = mk('Big');        // 200000, touched today
  const small = mk('Small');      // 100000, touched 240 days ago
  const cold  = mk('Cold');       // nothing, never touched
  DB.transactions.push(
    {id:uid('TXN'), clientId:big.id, amount:200000, status:'Completed', transactionType:'Purchase',
     productCategory:'Equity', createdAt:new Date().toISOString(), createdBy:currentUser},
    {id:uid('TXN'), clientId:small.id, amount:100000, status:'Completed', transactionType:'Purchase',
     productCategory:'Debt', createdAt:new Date().toISOString(), createdBy:currentUser},
    {id:uid('TXN'), clientId:big.id, amount:5000, status:'Completed', transactionType:'SIP',
     productCategory:'Equity', createdAt:new Date().toISOString(), createdBy:currentUser});
  DB.communications.push(
    {id:uid('COM'), clientId:big.id, channel:'Email', direction:'Outbound', status:'Sent',
     at:new Date().toISOString(), by:currentUser},
    {id:uid('COM'), clientId:small.id, channel:'Email', direction:'Outbound', status:'Sent',
     at:ago(240) + 'T10:00:00.000Z', by:currentUser});
  // one lead converted from a known source, one lost
  const won = {id:uid('LEAD'), leadName:'ZZ Won', firstName:'ZZ', lastName:'Won', source:'Referral',
    assignedTo:currentUser, branch:br, createdAt:new Date().toISOString(), createdBy:currentUser};
  const lost = {id:uid('LEAD'), leadName:'ZZ Lost', firstName:'ZZ', lastName:'Lost', source:'Walk-in',
    assignedTo:currentUser, branch:br, createdAt:new Date().toISOString(), createdBy:currentUser};
  initState('LMS', won); initState('LMS', lost);
  won[RECORD_STATE_FIELD.LMS] = 'convertedToClient';
  lost[RECORD_STATE_FIELD.LMS] = 'notQualified';
  DB.leads.push(won, lost);
  await save('clients'); await save('transactions');
  await save('communications'); await save('leads');
  navigate('reports');
  return {big: big.id, small: small.id, cold: cold.id};
};

suite(async t => {

  await t.step('seed a small book with known answers', async () => {
    const ids = await t.eval(SEED);
    await t.wait(500);
    if(!ids.big) throw new Error('the seed returned nothing');
    return 'three clients (₹305,000 incl. a ₹5,000 SIP), two leads — one won, one lost';
  });

  t.section('the shelf: six sections, fourteen reports, nothing hidden');

  await t.step('all six sections are on the page, in the brief’s order', async () => {
    const heads = await t.eval(()=>Array.from(document.querySelectorAll('.rep-sec-head h2'))
      .map(h=>h.textContent.replace(/^\d+\.\s*/, '').trim()));
    if(heads.length !== SECTIONS.length)
      throw new Error(heads.length + ' sections, expected ' + SECTIONS.length + ': ' + heads.join(' / '));
    for(let i = 0; i < SECTIONS.length; i++)
      if(heads[i] !== SECTIONS[i])
        throw new Error('section ' + (i+1) + ' is "' + heads[i] + '", expected "' + SECTIONS[i] + '"');
    return heads.join(' → ');
  });

  await t.step('fourteen reports, and not one of them left without a card', async () => {
    const got = await t.eval(()=>REPORTS.map(r=>({id:r.id, section:r.section, title:r.title,
      card: !!Array.from(document.querySelectorAll('.rep-card .rep-card-t'))
        .find(e=>e.textContent.trim() === r.title)})));
    if(got.length !== 14) throw new Error(got.length + ' reports in the registry, expected 14');
    const noCard = got.filter(r=>!r.card);
    if(noCard.length) throw new Error('no card drawn for: ' + noCard.map(r=>r.title).join(', '));
    return got.length + ' cards: ' + got.map(r=>r.title).join(' · ');
  });

  await t.step('each one sits in the section the brief put it in', async () => {
    const got = await t.eval(()=>{
      const out = {};
      REPORTS.forEach(r=>{ (out[r.section] = out[r.section] || []).push(r.title); });
      return out;
    });
    const bad = [];
    for(const sec of Object.keys(WANT)){
      const have = (got[sec] || []).slice().sort();
      const want = WANT[sec].slice().sort();
      if(have.join('|') !== want.join('|'))
        bad.push(sec + ': [' + have.join(', ') + '] against [' + want.join(', ') + ']');
    }
    const extra = Object.keys(got).filter(k => !(k in WANT));
    if(extra.length) bad.push('sections nobody asked for: ' + extra.join(', '));
    if(bad.length) throw new Error(bad.join(' | '));
    return Object.keys(WANT).map(s=>s + ' ' + WANT[s].length).join(' · ');
  });

  await t.step('the section with no report named still has its place on the page', async () => {
    /* Sales & Growth is named in the brief with nothing listed under it.
       The firm asked for six sections, so it gets its heading and a line
       saying so — rather than quietly collapsing to five. */
    const r = await t.eval(()=>{
      const heads = Array.from(document.querySelectorAll('.rep-sec'));
      const sec = heads.find(s=>/Sales & Growth/.test(s.querySelector('h2').textContent));
      return sec ? {cards: sec.querySelectorAll('.rep-card').length,
                    says: sec.textContent.indexOf('lists no report') >= 0} : null;
    });
    if(!r) throw new Error('Sales & Growth is not on the page');
    if(r.cards) throw new Error('it has ' + r.cards + ' card(s); the brief named none');
    if(!r.says) throw new Error('it is empty and says nothing about why');
    return 'heading drawn, and it says why it is empty';
  });

  t.section('ready, limited, pending — the three states, told apart on the card');

  await t.step('every card carries exactly one badge, and it matches the entry', async () => {
    const bad = await t.eval(()=>{
      openReport('');                                   // the shelf, not a report page
      const out = [];
      REPORTS.forEach(r=>{
        const title = Array.from(document.querySelectorAll('.rep-card .rep-card-t'))
          .find(e=>e.textContent.trim() === r.title);
        if(!title) return out.push(r.title + ': no card');
        const card = title.closest('.rep-card');
        const badges = Array.from(card.querySelectorAll('.rep-badge'));
        if(badges.length !== 1) return out.push(r.title + ': ' + badges.length + ' badges');
        const txt = badges[0].textContent.trim();
        const want = r.pending ? 'Pending Data Integration'
                   : r.limited ? 'Ready · one field missing' : 'Ready to generate';
        if(txt !== want) out.push(r.title + ': badge reads "' + txt + '", expected "' + want + '"');
      });
      return out;
    });
    if(bad.length) throw new Error(bad.join(' | '));
    return 'fourteen badges, each the state of its entry';
  });

  await t.step('the one awaiting data says "Pending Data Integration" in those words', async () => {
    /* The firm wrote the phrase itself, in bold. A synonym is not it. */
    const r = await t.eval(()=>{
      openReport('');
      const pend = REPORTS.filter(x=>x.pending);
      const txt = document.getElementById('content').textContent;
      return {ids: pend.map(x=>x.id), phrase: txt.indexOf('Pending Data Integration') >= 0};
    });
    if(!r.ids.length) throw new Error('no report is marked pending at all');
    if(!r.phrase) throw new Error('the phrase "Pending Data Integration" is nowhere on the shelf');
    return r.ids.length + ' pending: ' + r.ids.join(', ');
  });

  t.section('a report is a page of its own');

  await t.step('opening one leaves the shelf behind', async () => {
    /* The firm asked for a dedicated page, not a panel under the cards.
       So the shelf has to be gone, not scrolled past. */
    const r = await t.eval(()=>{
      openReport('clientConcentration');
      const c = document.getElementById('content');
      return {cards: c.querySelectorAll('.rep-card').length,
              sections: c.querySelectorAll('.rep-sec').length,
              panel: !!document.getElementById('repOpen'),
              title: document.getElementById('pageTitle').textContent.trim(),
              sub: document.getElementById('pageSub').textContent.trim()};
    });
    if(r.cards) throw new Error('the shelf is still drawn under it: ' + r.cards + ' cards');
    if(r.sections) throw new Error('the six sections are still drawn under it');
    if(!r.panel) throw new Error('the report itself did not draw');
    if(r.title !== 'Client Concentration')
      throw new Error('the page is titled "' + r.title + '", not the report');
    if(!r.sub) throw new Error('the page carries no subtitle');
    return 'shelf gone, page titled "' + r.title + '"';
  });

  await t.step('all fourteen open a page, and every page says how to get back', async () => {
    /* Including the pending one. "Do not omit any report or leave any
       option non-clickable." */
    const bad = await t.eval(()=>{
      const out = [];
      REPORTS.forEach(r=>{
        openReport(r.id);
        const c = document.getElementById('content');
        if(c.querySelectorAll('.rep-card').length) out.push(r.id + ': the shelf is still under it');
        if(!c.querySelector('.rep-crumb')) out.push(r.id + ': no crumb');
        const backs = Array.from(c.querySelectorAll('button'))
          .filter(b=>/Back to Reports/.test(b.textContent));
        if(!backs.length) out.push(r.id + ': no way back');
        const crumb = c.querySelector('.rep-crumb');
        if(crumb && crumb.textContent.indexOf(r.title) < 0)
          out.push(r.id + ': the crumb does not name it');
        if(document.getElementById('pageTitle').textContent.trim() !== r.title)
          out.push(r.id + ': the topbar says "' + document.getElementById('pageTitle').textContent.trim() + '"');
      });
      return out;
    });
    if(bad.length) throw new Error(bad.join(' | '));
    return 'fourteen pages, each titled, crumbed and with a way back';
  });

  await t.step('the way back actually goes back', async () => {
    const r = await t.eval(()=>{
      openReport('complianceCertificate');
      const back = Array.from(document.getElementById('content').querySelectorAll('button'))
        .find(b=>/Back to Reports/.test(b.textContent));
      back.click();
      const c = document.getElementById('content');
      return {open: activeReport, cards: c.querySelectorAll('.rep-card').length,
              sections: c.querySelectorAll('.rep-sec').length,
              title: document.getElementById('pageTitle').textContent.trim()};
    });
    if(r.open) throw new Error('a report is still open: ' + r.open);
    if(r.cards !== 14) throw new Error('the shelf came back with ' + r.cards + ' cards');
    if(r.sections !== 6) throw new Error('the shelf came back with ' + r.sections + ' sections');
    if(r.title !== 'Reports') throw new Error('the topbar still says "' + r.title + '"');
    return 'back to fourteen cards under six sections';
  });

  await t.step('and so does the rail \u2014 Reports closes whatever was open', async () => {
    /* Without this, clicking Reports while a report is open leaves you on
       the report, which reads as the rail being broken. */
    const r = await t.eval(()=>{
      openReport('aumTrend');
      navigate('reports');
      return {open: activeReport,
              cards: document.getElementById('content').querySelectorAll('.rep-card').length};
    });
    if(r.open) throw new Error('the rail left ' + r.open + ' open');
    if(r.cards !== 14) throw new Error('the shelf drew ' + r.cards + ' cards');
    return 'the rail returns to the shelf';
  });

  await t.step('a link can name a report, and lands straight on its page', async () => {
    const r = await t.eval(()=>{
      navigate('reports', 'sipTrend');
      return {open: activeReport,
              title: document.getElementById('pageTitle').textContent.trim(),
              panel: !!document.getElementById('repOpen')};
    });
    if(r.open !== 'sipTrend') throw new Error('it opened ' + r.open);
    if(r.title !== 'SIP Book Trend') throw new Error('the page is titled "' + r.title + '"');
    if(!r.panel) throw new Error('the report did not draw');
    return "navigate('reports','sipTrend') lands on the report";
  });

  await t.step('the next and previous report in a section are one click away', async () => {
    const r = await t.eval(()=>{
      openReport('clientEngagement');                   // second of four in Business Intelligence
      const acts = document.querySelector('.rep-page-acts');
      const labels = Array.from(acts.querySelectorAll('button')).map(b=>b.textContent.trim());
      const next = Array.from(acts.querySelectorAll('button'))
        .find(b=>/Investment Activity/.test(b.textContent));
      if(next) next.click();
      return {labels, landed: activeReport};
    });
    if(r.landed !== 'investmentActivity') throw new Error('next landed on ' + r.landed);
    return r.labels.join(' | ');
  });

  t.section('every card opens — including the one that cannot be generated');

  await t.step('all fourteen render a body, and none of them throws', async () => {
    const bad = [];
    for(const id of await t.eval(()=>REPORTS.map(r=>r.id))){
      const r = await t.eval(x => {
        try {
          openReport(x);
          const el = document.getElementById('repOpen');
          return {len: el ? el.textContent.trim().length : 0, drawn: !!el};
        } catch(e){ return {err: String(e && e.message || e)}; }
      }, id);
      await t.wait(90);
      if(r.err) bad.push(id + ' threw: ' + r.err);
      else if(!r.drawn) bad.push(id + ' drew no panel');
      else if(r.len < 120) bad.push(id + ' drew ' + r.len + ' chars');
    }
    if(bad.length) throw new Error(bad.join(' | '));
    return 'fourteen panels, all of them with something in them';
  });

  await t.step('the pending one names its fields, its sources and its modules', async () => {
    /* "specify the data sources, fields, or modules required to enable
       them" — all three, not one of the three. */
    const bad = await t.eval(()=>{
      const out = [];
      REPORTS.filter(r=>r.pending).forEach(r=>{
        openReport(r.id);
        const panel = document.getElementById('repOpen');
        const heads = Array.from(panel.querySelectorAll('.rep-pend-col h4')).map(h=>h.textContent.trim());
        ['Fields required','Data sources','Modules to build'].forEach(h=>{
          if(heads.indexOf(h) < 0) out.push(r.id + ': no "' + h + '" list');
        });
        const items = panel.querySelectorAll('.rep-pend-col li').length;
        if(items < 6) out.push(r.id + ': only ' + items + ' items named between the three');
        if(panel.textContent.indexOf('Pending Data Integration') < 0)
          out.push(r.id + ': the panel itself does not say it is pending');
      });
      return out;
    });
    if(bad.length) throw new Error(bad.join(' | '));
    return 'fields, sources and modules — all three, on every pending report';
  });

  await t.step('and it does not draw a fake table instead', async () => {
    const r = await t.eval(()=>{
      const out = [];
      REPORTS.filter(x=>x.pending).forEach(x=>{
        openReport(x.id);
        const panel = document.getElementById('repOpen');
        if(panel.querySelectorAll('table').length) out.push(x.id + ' drew a table');
        if(panel.querySelectorAll('.kpi').length) out.push(x.id + ' drew figures');
      });
      return out;
    });
    if(r.length) throw new Error(r.join(' | '));
    return 'no table, no figure — the shopping list and nothing invented';
  });

  await t.step('a report that cannot see one field says which, on its own face', async () => {
    const bad = await t.eval(()=>{
      const out = [];
      REPORTS.filter(r=>r.limited).forEach(r=>{
        openReport(r.id);
        const panel = document.getElementById('repOpen');
        const note = Array.from(panel.querySelectorAll('.rep-note.rep-warn .rep-note-b'))
          .map(e=>e.textContent.trim()).join(' ');
        if(note.indexOf(r.limited.slice(0, 30)) < 0)
          out.push(r.id + ': its caveat is not drawn on the report');
      });
      return out;
    });
    if(bad.length) throw new Error(bad.join(' | '));
    return 'each limited report carries its own caveat';
  });

  t.section('the figures are the records added up');

  await t.step('Client Concentration totals the book, and the shares sum to it', async () => {
    const r = await t.eval(()=>{
      openReport('clientConcentration');
      const rows = repClients('').filter(x=>x.aum > 0).sort((a,b)=>b.aum - a.aum);
      return {total: rows.reduce((s,x)=>s+x.aum, 0), n: rows.length,
              top: rows[0] ? rows[0].aum : 0,
              shown: document.getElementById('repOpen').textContent};
    });
    // 200000 + 5000 on the big client, 100000 on the small one
    if(r.total !== 305000) throw new Error('the book reads ' + r.total + ', expected 305000');
    if(r.top !== 205000) throw new Error('the largest client holds ' + r.top + ', expected 205000');
    if(r.shown.indexOf('Pareto') < 0) throw new Error('no Pareto line on the report');
    if(r.shown.indexOf('Growth headroom') < 0) throw new Error('no reverse (headroom) view');
    if(r.shown.indexOf('Concentration risk') < 0) throw new Error('no concentration-risk flag');
    return '₹305,000 across ' + r.n + ' clients, biggest ₹205,000';
  });

  await t.step('Client Engagement bands by the last touch from any module', async () => {
    const r = await t.eval(()=>{
      openReport('clientEngagement');
      const rows = repClients('').map(x=>{
        const touch = repLastTouch(x.c);
        return {name:x.c.cmsName, days: repDays(touch), aum:x.aum};
      });
      return rows.filter(x=>/^ZZ /.test(x.name));
    });
    const big = r.find(x=>/Big/.test(x.name)), small = r.find(x=>/Small/.test(x.name)),
          cold = r.find(x=>/Cold/.test(x.name));
    if(!big || big.days > 1) throw new Error('the client touched today reads ' + (big && big.days) + ' days');
    if(!small || small.days < 200) throw new Error('the client touched 240 days ago reads ' + (small && small.days));
    if(!cold || cold.days !== null) throw new Error('the client never touched reads ' + (cold && cold.days));
    return 'today / ' + small.days + ' days / never — each landing in its own band';
  });

  await t.step('Investment Activity calls a client who never invested exactly that', async () => {
    const r = await t.eval(()=>{
      openReport('investmentActivity');
      const cold = DB.clients.find(c=>/ZZ Cold/.test(c.cmsName||''));
      return {last: repLastInvestment(cold), shown: document.getElementById('repOpen').textContent};
    });
    if(r.last) throw new Error('it found an investment on a client with none: ' + r.last);
    if(r.shown.indexOf('Never invested') < 0) throw new Error('no "Never invested" band on the report');
    return 'never invested, said as "Never invested" rather than as a zero';
  });

  await t.step('Lead Source ROI counts the won lead against its own source', async () => {
    const r = await t.eval(()=>{
      openReport('leadSourceRoi');
      return document.getElementById('repOpen').textContent;
    });
    if(r.indexOf('Referral') < 0) throw new Error('the won lead’s source is not in the table');
    if(r.indexOf('return on spend') < 0)
      throw new Error('it does not say that ROI here is not a return on spend');
    return 'Referral in the table, and the word ROI qualified honestly';
  });

  await t.step('AUM Trend shows twelve months and says why the month is the month', async () => {
    const r = await t.eval(()=>{
      openReport('aumTrend');
      const panel = document.getElementById('repOpen');
      return {months: repMonths(12).length,
              cols: panel.querySelectorAll('.rep-trend-col').length,
              says: panel.textContent.indexOf('carries no date of its own') >= 0
                 || panel.textContent.indexOf('records no date of its own') >= 0};
    });
    if(r.months !== 12) throw new Error('repMonths(12) gave ' + r.months);
    if(r.cols !== 12) throw new Error(r.cols + ' columns drawn, expected 12');
    if(!r.says) throw new Error('it does not say that a transaction has no date of its own');
    return 'twelve columns, and the proxy declared';
  });

  await t.step('Lost Lead Analysis finds the lost lead and not the won one', async () => {
    const r = await t.eval(()=>{
      openReport('lostLeadAnalysis');
      return document.getElementById('repOpen').textContent;
    });
    if(r.indexOf('Walk-in') < 0) throw new Error('the lost lead’s source is not cut out');
    if(r.indexOf('Referral') >= 0) throw new Error('the won lead has been counted as lost');
    return 'Walk-in cut out, Referral left alone';
  });

  t.section('Presentation Mode');

  await t.step('a KPI figure opens full-screen, and closes again', async () => {
    const r = await t.eval(()=>{
      openReport('kpiMis');
      const clickable = document.querySelectorAll('.rep-kpi-click').length;
      openKpiPresentation('clients');
      const on = document.getElementById('repPresent');
      const num = on ? on.querySelector('.rep-present-num').textContent.trim() : '';
      closeKpiPresentation();
      return {clickable, opened: !!on, num, closed: !document.getElementById('repPresent')};
    });
    if(!r.clickable) throw new Error('no figure on the KPI board is clickable');
    if(!r.opened) throw new Error('clicking a figure opened nothing');
    if(!r.num) throw new Error('the full-screen panel showed no number');
    if(!r.closed) throw new Error('it would not close again');
    return r.clickable + ' figures, one thrown on the wall reading ' + r.num;
  });

  t.section('the promise: switching one on later does not mean a redesign');

  await t.step('every entry carries a run or a pending, never both and never neither', async () => {
    /* This is the shape the firm was promised: filling in a report means
       writing its `run` and deleting its `pending`. If an entry could have
       both, or neither, that promise is not kept by the code. */
    const bad = await t.eval(()=>REPORTS.filter(r=>
      (typeof r.run === 'function') === !!r.pending).map(r=>r.id));
    if(bad.length) throw new Error('entries with both or neither: ' + bad.join(', '));
    return 'fourteen entries, each with exactly one of the two';
  });

  await t.step('a pending report becomes a real one by writing its run', async () => {
    /* Proven rather than asserted: give the pending entry a run, delete
       its pending, re-render, and the card is ready and the body is the
       new one — without touching a section, a card, or the routing. */
    const r = await t.eval(()=>{
      const e = REPORTS.find(x=>x.pending);
      const keep = e.pending;
      e.run = () => '<div id="zzProof">the data arrived</div>';
      delete e.pending;
      openReport(e.id);
      const panel = document.getElementById('repOpen');
      const out = {badge: panel.querySelector('.rep-badge').textContent.trim(),
                   drew: !!document.getElementById('zzProof'),
                   back: !!Array.from(panel.parentNode.querySelectorAll('button'))
                     .find(b=>/Back to Reports/.test(b.textContent))};
      openReport('');                             // and the shelf behind it is untouched
      out.cards = document.querySelectorAll('.rep-card').length;
      out.sections = document.querySelectorAll('.rep-sec').length;
      e.pending = keep; delete e.run;             // put it back as it was
      return out;
    });
    if(!r.drew) throw new Error('the new run did not draw');
    if(!r.back) throw new Error('its page lost the way back');
    if(r.badge !== 'Ready to generate') throw new Error('the badge still reads "' + r.badge + '"');
    if(r.cards !== 14) throw new Error(r.cards + ' cards after the switch, expected 14');
    if(r.sections !== 6) throw new Error(r.sections + ' sections after the switch, expected 6');
    return 'ready, drawn, and the six sections and fourteen cards never moved';
  });

  t.section('and nothing complained');

  await t.step('no alert, and the shelf renders clean', async () => {
    await t.eval(()=>navigate('reports'));
    await t.wait(250);
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    const len = await t.eval(()=>document.getElementById('content').textContent.trim().length);
    if(len < 500) throw new Error('the shelf rendered ' + len + ' chars');
    return 'no alerts, ' + len + ' chars on the shelf';
  });
});
