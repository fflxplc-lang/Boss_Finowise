/* THE MODULE DASHBOARDS, AND THE TIMELINE OVER THEM.

   The Modulewise – Dashboard note named, per module, the handful of figures
   the firm actually works from, and asked for one timeline filter across
   all three: Daily, Weekly, Monthly, Quarterly, Half Yearly, Yearly, Since
   Inception, and a Custom From–To.

   Two things are worth testing rather than eyeballing. First that the strip
   is the one asked for and nothing else — a tile that crept back is exactly
   what this note was written to stop. Second that the filter narrows the
   figures and the list together: a tile counting one period above a table
   showing another is worse than no filter at all, and it is the kind of
   mismatch that only shows up when the two are checked against each other. */
const {suite} = require('../lib/harness');

const WANT = {
  lms: ['New', 'Qualification', 'Investment Approach', 'Convert'],
  cms: ['Total Clients', 'KYC Completed', 'KYC Pending', 'Categories',
        'Onboarding', 'Mandate', 'Activation', 'Insurance Hold'],
  rms: ['Open Review', 'Meeting Due', 'Meeting Over Due', 'Meeting Closed', 'Reference'],
};
/* Tiles each screen used to carry and should not any more. */
const GONE = {
  lms: ['First-call SLA breached', 'Avg first-call time', 'Called within 1h', 'Warm-up Meeting',
        'Intro Meeting', 'Blueprint', 'DBT', 'Onboarding', 'Not Qualified', 'Conversion', 'Lost'],
  cms: ['New', 'CIF & KYC', 'Transaction', 'Ready for RMS', 'In RMS'],
  rms: ['Open Reviews', 'Overdue', 'Due This Month', 'MOM Pending', 'Type & Mode', 'Preparation',
        'Review Decision', 'Agenda & Meeting', 'SOS Meeting', 'ISEQ', 'Portfolio Review',
        'C&T Form', 'DBT', 'MOM', 'Next Meeting'],
};

suite(async t => {

  const tilesOn = async (view) => {
    await t.eval(v => navigate(v), view);
    await t.wait(300);
    return await t.eval(()=>Array.from(document.querySelectorAll('.mkpi .mkpi-lbl'))
      .map(e=>e.textContent.trim()));
  };

  t.section('each module shows the strip it was given, and no more');

  for(const view of ['lms','cms','rms']){
    await t.step(view.toUpperCase() + ' carries exactly its ' + WANT[view].length + ' tiles', async () => {
      const tiles = await tilesOn(view);
      const missing = WANT[view].filter(w => !tiles.includes(w));
      if(missing.length) throw new Error('missing: ' + missing.join(', ') + '  (has: ' + tiles.join(', ') + ')');
      const extra = tiles.filter(x => !WANT[view].includes(x));
      if(extra.length) throw new Error('unasked-for tiles: ' + extra.join(', '));
      return tiles.join(' · ');
    });
    await t.step('…and none of the ' + GONE[view].length + ' it was asked to drop', async () => {
      const tiles = await tilesOn(view);
      const back = GONE[view].filter(g => tiles.includes(g));
      if(back.length) throw new Error('still showing: ' + back.join(', '));
      return 'all dropped';
    });
  }

  t.section('the timeline filter');

  await t.step('all eight periods are offered, on all three modules', async () => {
    const want = ['Daily','Weekly','Monthly','Quarterly','Half Yearly','Yearly','Since Inception','Custom'];
    for(const view of ['lms','cms','rms']){
      await t.eval(v => navigate(v), view);
      await t.wait(250);
      const opts = await t.eval(v => {
        const sel = document.getElementById('tl_' + v.toUpperCase());
        return sel ? Array.from(sel.options).map(o=>o.textContent.trim()) : null;
      }, view);
      if(!opts) throw new Error(view + ' has no timeline control');
      const missing = want.filter(w => !opts.includes(w));
      if(missing.length) throw new Error(view + ' is missing: ' + missing.join(', '));
    }
    return want.join(' / ');
  });

  await t.step('it opens on Since Inception, so nothing is hidden by default', async () => {
    const r = await t.eval(()=>({
      lms: timelineState('LMS').range, cms: timelineState('CMS').range, rms: timelineState('RMS').range,
      window: timelineWindow('LMS'),
    }));
    if(r.lms !== 'all' || r.cms !== 'all' || r.rms !== 'all')
      throw new Error('opens on ' + JSON.stringify(r));
    if(r.window !== null) throw new Error('Since Inception still computed a window');
    return 'all three open on everything';
  });

  await t.step('the calendar periods are calendar periods, not rolling windows', async () => {
    const r = await t.eval(()=>{
      const out = {};
      ['day','week','month','quarter','half','year'].forEach(k=>{
        timelineState('LMS').range = k;
        out[k] = timelineWindow('LMS');
      });
      timelineState('LMS').range = 'all';
      return out;
    });
    const today = new Date(); const iso = d => d.toISOString().slice(0,10);
    const y = today.getFullYear();
    if(r.day.from !== r.day.to) throw new Error('Daily spans ' + r.day.from + '–' + r.day.to);
    if(r.month.from.slice(8) !== '01') throw new Error('Monthly does not start on the 1st: ' + r.month.from);
    if(r.year.from !== y + '-01-01' || r.year.to !== y + '-12-31')
      throw new Error('Yearly is ' + r.year.from + '–' + r.year.to);
    if(!['01','04','07','10'].includes(r.quarter.from.slice(5,7)))
      throw new Error('Quarterly starts ' + r.quarter.from);
    if(!['01','07'].includes(r.half.from.slice(5,7)))
      throw new Error('Half Yearly starts ' + r.half.from);
    const d = new Date(r.week.from + 'T12:00:00');
    if(d.getDay() !== 1) throw new Error('the week does not start on a Monday: ' + r.week.from);
    return 'day ' + r.day.from + ' · month ' + r.month.from + ' · year ' + r.year.from;
  });

  t.section('the figures and the list move together');

  await t.step('a lead outside the window leaves both the tile and the table', async () => {
    const r = await t.eval(async ()=>{
      const old = new Date(Date.now() - 400*86400000).toISOString();     // well over a year ago
      const mk = (nm, at) => {
        const l = {id:uid('LEAD'), leadName:nm, firstName:nm, lastName:'Dash',
          rmName:currentUser, assignedTo:currentUser, createdAt:at, createdBy:currentUser};
        initState('LMS', l); DB.leads.push(l); return l;
      };
      mk('ZZOld', old);
      mk('ZZNew', new Date().toISOString());
      await save('leads');
      const read = () => {
        render();
        const tile = Array.from(document.querySelectorAll('.mkpi'))
          .find(e=>/^New$/.test(e.querySelector('.mkpi-lbl').textContent.trim()));
        return {tile: Number(tile.querySelector('.mkpi-num').textContent.trim()),
                rows: document.querySelectorAll('#lmsTable tbody tr').length,
                names: Array.from(document.querySelectorAll('#lmsTable tbody tr'))
                  .map(tr=>tr.children[2] ? tr.children[2].textContent.trim() : '').join('|')};
      };
      navigate('lms'); await new Promise(r=>setTimeout(r,200));
      timelineState('LMS').range = 'all';   const everything = read();
      timelineState('LMS').range = 'year';  const thisYear  = read();
      timelineState('LMS').range = 'all';   render();
      return {everything, thisYear};
    });
    if(r.everything.tile < 2) throw new Error('Since Inception counts ' + r.everything.tile + ', expected both');
    if(r.thisYear.tile !== r.everything.tile - 1)
      throw new Error('Yearly counts ' + r.thisYear.tile + ' against ' + r.everything.tile + ' for everything');
    if(!/ZZOld/.test(r.everything.names)) throw new Error('the old lead is not in the full table');
    if(/ZZOld/.test(r.thisYear.names)) throw new Error('the old lead is still in the table under Yearly');
    if(!/ZZNew/.test(r.thisYear.names)) throw new Error('the new lead fell out of the table under Yearly');
    return 'tile ' + r.everything.tile + '→' + r.thisYear.tile + ', and the row went with it';
  });

  await t.step('Custom takes a From and a To and holds them', async () => {
    const r = await t.eval(()=>{
      setTimelineRange('LMS','custom');
      setTimelineDate('LMS','from','2020-01-01');
      setTimelineDate('LMS','to','2020-12-31');
      const w = timelineWindow('LMS');
      const hasBoxes = !!document.getElementById('tl_LMS_from') && !!document.getElementById('tl_LMS_to');
      const rows = document.querySelectorAll('#lmsTable tbody tr').length;
      setTimelineRange('LMS','all');
      return {w, hasBoxes, rows};
    });
    if(!r.hasBoxes) throw new Error('Custom drew no date boxes');
    if(r.w.from !== '2020-01-01' || r.w.to !== '2020-12-31')
      throw new Error('the window is ' + JSON.stringify(r.w));
    return '2020 — and the table emptied to ' + r.rows + ' row(s)';
  });

  t.section('the rail');

  await t.step('LNG comes after RMS', async () => {
    const items = await t.eval(()=>{
      const g = NAV_GROUPS.find(x=>x.id==='pipeline');
      return g ? g.items : null;
    });
    if(!items) throw new Error('there is no Client Journey group');
    if(items.join(',') !== 'lms,cms,rms,lng') throw new Error('the order is ' + items.join(', '));
    return items.join(' → ');
  });

  await t.step('and LNG still opens', async () => {
    await t.eval(()=>navigate('lng'));
    await t.wait(250);
    const len = (await t.page.locator('#content').textContent()).trim().length;
    if(len < 20) throw new Error('LNG rendered empty');
    return 'opens, ' + len + ' chars';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 200));
    return 'none';
  });
});
