/* =====================================================================
   PAYOUTS — mutual fund brokerage, the L1–L7 sharing and what everybody
   is owed

   This was WealthFlow, a separate React app with its own logins. Its
   engine now answers at /api/payout on this server (payout/ in the repo)
   and these are its screens, drawn the way every other BOSS screen is:
   a view function returns HTML, render() puts it on the page.

   The difference from the rest of BOSS is where the records live. BOSS
   keeps its store in the browser and saves it back; the payout records
   are SQLite on the server, because an import is ten thousand rows and a
   recalculation walks all of them. So a view asks for what it needs,
   shows "Loading" the first time, and draws again when the answer comes
   back. Anything that changes data throws the cached answers away and
   asks again.

   The server decides who sees what. A CRM admin is a payout admin; anyone
   else sees their own clients and their own earnings, and only once an
   admin has added their email to the payout team (Clients & Map ›
   Hierarchy). The rail asks the server once who you are and hides the
   section from anybody who is not on the team.

   Loaded before BOSS itself, so nothing here runs until BOSS calls it.
   ===================================================================== */

const PY_VIEWS = ['pydash','pyimports','pyclients','pyreports','pyrates','pypartner','pyledger','pyaudit','pysettings'];
const PY_ADMIN_VIEWS = ['pyimports','pyrates','pyaudit'];
const PY_LEVELS = {1:'Ninja', 2:'Super Ninja', 3:'Sherpa', 4:'Master Sherpa', 5:'Monks', 6:'Zen Monks', 7:'Company'};
const PY_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/* Everything the screens remember between draws. `me` is undefined until
   the server has been asked, then the payout user or {error}. */
const PY = {me: undefined, cache: {}, loading: {}, errors: {}, s: {}, rows: {}};

/* ---------- talking to the server ---------- */
async function pyApi(method, url, body){
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers = Object.assign({}, typeof apiHeaders === 'function' ? apiHeaders() : {});
  if(body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch('/api/payout' + url, {method, headers,
    body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body))});
  const type = res.headers.get('content-type') || '';
  const data = type.indexOf('json') >= 0 ? await res.json() : await res.text();
  if(!res.ok){
    const err = new Error((data && data.error) || ('Request failed (' + res.status + ')'));
    err.status = res.status; err.code = data && data.code;
    throw err;
  }
  return data;
}
const pyGet = u => pyApi('GET', u);
const pyPost = (u, b) => pyApi('POST', u, b === undefined ? {} : b);
const pyPut = (u, b) => pyApi('PUT', u, b);
const pyDel = u => pyApi('DELETE', u);
function pyQs(o){
  const p = new URLSearchParams();
  Object.keys(o || {}).forEach(k=>{ const v = o[k]; if(v !== undefined && v !== null && v !== '') p.set(k, v); });
  const s = p.toString();
  return s ? '?' + s : '';
}
function pyIsView(v){ return PY_VIEWS.indexOf(v) >= 0; }

/* A cached GET. Returns the data, or undefined while it is on its way —
   and when it lands, the page is drawn again if it is still a payout page. */
function pyData(url){
  if(Object.prototype.hasOwnProperty.call(PY.cache, url)) return PY.cache[url];
  if(PY.errors[url]) return undefined;
  if(!PY.loading[url]){
    PY.loading[url] = true;
    pyGet(url).then(d=>{ PY.cache[url] = d; delete PY.errors[url]; },
                    e=>{ PY.errors[url] = e.message; })
      .finally(()=>{ delete PY.loading[url]; if(pyIsView(currentView)) render(); });
  }
  return undefined;
}
function pyErr(url){ return PY.errors[url]; }
/* Anything that changes data calls this: every cached answer is stale. */
function pyInvalidate(){ PY.cache = {}; PY.errors = {}; }
function pyRefresh(){ pyInvalidate(); render(); }

/* Who am I to the payout module. Asked once; a 403 means "not on the team". */
function pyMe(){
  if(PY.me !== undefined) return PY.me;
  if(!PY.loading.__me){
    PY.loading.__me = true;
    pyGet('/auth/me').then(u=>{ PY.me = u; }, e=>{ PY.me = {error: e.message, code: e.code || e.status}; })
      .finally(()=>{ delete PY.loading.__me; if(typeof render === 'function') render(); });
  }
  return undefined;
}
/* The server's answer wins: it knows whether this sign-in is a BOSS admin
   account. Until it has answered, a BOSS admin in the browser is taken at
   their word so the rail does not flicker, and the server still refuses
   anything they should not have. */
function pyMentor(){ const m = PY.me; return !!(m && !m.error && m.role === 'mentor'); }
function pyAdmin(){
  const m = PY.me;
  if(m && !m.error) return m.role === 'admin';
  return m === undefined && typeof isAdmin === 'function' && isAdmin(me());
}
/* The rail: anybody the server says is on the payout team. */
function pySectionOpen(){
  const m = pyMe();
  if(m === undefined) return typeof isAdmin === 'function' && isAdmin(me());
  return !m.error;
}
function pyViewOpen(view){
  if(!pySectionOpen()) return false;
  if(PY_ADMIN_VIEWS.indexOf(view) >= 0) return pyAdmin();
  return true;
}

/* ---------- formatting ---------- */
function pyInr(n, d){
  d = d === undefined ? 2 : d;
  return '₹' + Number(n || 0).toLocaleString('en-IN', {minimumFractionDigits: d, maximumFractionDigits: d});
}
function pyAmt(n){ return '₹' + Number(n || 0).toLocaleString('en-IN', {maximumFractionDigits: 2}); }
function pyInrShort(n){
  const v = Number(n || 0), a = Math.abs(v);
  if(a >= 1e7) return '₹' + (v / 1e7).toFixed(2) + ' Cr';
  if(a >= 1e5) return '₹' + (v / 1e5).toFixed(2) + ' L';
  if(a >= 1e3) return '₹' + (v / 1e3).toFixed(1) + 'k';
  return '₹' + v.toFixed(0);
}
function pyPct(n, d){ return Number(n || 0).toFixed(d === undefined ? 2 : d) + '%'; }
function pyPeriodLabel(p){ return p ? PY_MONTHS[Number(p.slice(5)) - 1] + ' ' + p.slice(0, 4) : ''; }
function pyShortPeriod(p){ return p ? PY_MONTHS[Number(p.slice(5)) - 1].slice(0, 3) + ' ' + p.slice(0, 4) : ''; }
function pyUtc(ts){ return new Date(String(ts).indexOf('T') >= 0 ? ts : String(ts).replace(' ', 'T') + 'Z'); }
function pyTimeAgo(ts){
  const s = (Date.now() - pyUtc(ts).getTime()) / 1000;
  if(s < 60) return 'just now';
  if(s < 3600) return Math.floor(s / 60) + 'm ago';
  if(s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
function pyLocalTs(ts){ return pyUtc(ts).toLocaleString('en-IN'); }
function pyLevel(l){ return 'L' + l + ' ' + (PY_LEVELS[l] || ''); }

/* ---------- small pieces of page ---------- */
function pyToast(msg, kind){
  let box = document.getElementById('pyToasts');
  if(!box){ box = document.createElement('div'); box.id = 'pyToasts'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = 'py-toast ' + (kind || 'ok');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(()=>el.remove(), 4500);
}
/* Runs an action, says what happened, and redraws with fresh data. */
async function pyRun(fn, okMsg){
  try {
    const r = await fn();
    if(okMsg) pyToast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
    pyInvalidate(); render();
    return r;
  } catch(e){
    pyToast(e.message || String(e), 'err');
    return undefined;
  }
}
function pyExport(rows, name){
  if(!rows || !rows.length){ pyToast('Nothing to export', 'err'); return; }
  const keys = Object.keys(rows[0]);
  downloadXlsx([{name: 'Data', rows: [keys].concat(rows.map(r=>keys.map(k=>r[k] === null || r[k] === undefined ? '' : r[k])))}],
    /\.xlsx$/.test(name) ? name : name.replace(/\.csv$/, '') + '.xlsx');
}
function pyLoadingHtml(url){
  const e = url && pyErr(url);
  if(e) return `<div class="card py-error"><b>Could not load this.</b> ${esc(e)}
    <button class="btn sm" onclick="pyRefresh()">Try again</button></div>`;
  return `<div class="empty py-loading">Loading…</div>`;
}
function pyHead(title, sub, right){
  return `<div class="mod-head py-head">
      <div><h2>${esc(title)}</h2><div class="mod-sub">${esc(sub || '')}</div></div>
      <div class="row py-head-actions">${right || ''}</div>
    </div>`;
}
function pyTabs(key, options, def){
  const cur = PY.s[key] || def || options[0][0];
  return `<div class="tabs py-tabs">${options.map(o=>
    `<div class="tab ${cur === o[0] ? 'active' : ''}" onclick="PY.s['${key}']='${o[0]}'; render()">${esc(o[1])}${
      o[2] !== undefined ? ` <span class="py-count">${esc(String(o[2]))}</span>` : ''}</div>`).join('')}</div>`;
}
function pyTab(key, def){ return PY.s[key] || def; }
function pyStats(items){
  return kpiCards(items.filter(Boolean).map(k=>({label: k.label, tone: k.tone,
    html: `${esc(String(k.value))}${k.sub ? `<div class="py-stat-sub">${esc(k.sub)}</div>` : ''}`})));
}
/* A table. head: [{t, r, c}] (r = right-aligned, c = centred). */
function pyTable(head, rows, empty, opts){
  opts = opts || {};
  const cls = h => h.r ? ' class="py-r"' : h.c ? ' class="py-c"' : '';
  return `<div class="table-wrap py-table${opts.scroll ? ' py-scroll' : ''}"${opts.max ? ` style="max-height:${opts.max}px"` : ''}><table>
    <thead><tr>${head.map(h=>`<th${cls(h)}>${h.html || esc(h.t || '')}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="empty">${esc(empty || 'Nothing yet.')}</td></tr>`}</tbody>
  </table></div>`;
}
function pyCard(title, body, right){
  return `<div class="card py-card">${title || right ? `<div class="between py-card-head"><div class="section-title" style="margin:0">${title || ''}</div><div class="row" style="gap:8px">${right || ''}</div></div>` : ''}${body}</div>`;
}
function pyBadge(text, tone){ return `<span class="badge ${tone || 'muted'}">${esc(text)}</span>`; }
function pySelect(id, value, options, onchange, attrs){
  return `<select class="list-sort" id="${id}" ${attrs || ''} onchange="${onchange}">${options.map(o=>{
    const v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
    return `<option value="${esc(String(v))}" ${String(v) === String(value) ? 'selected' : ''}>${esc(String(l))}</option>`;
  }).join('')}</select>`;
}
/* A search box that waits for typing to pause before asking the server. */
function pySearch(id, key, placeholder, width){
  return `<input class="search list-search py-search" id="${id}" placeholder="${esc(placeholder || 'Search')}"
    style="${width ? 'width:' + width + 'px' : ''}" value="${esc(PY.s[key] || '')}"
    oninput="pyDebounce('${key}', this.value)">`;
}
const pyTimers = {};
function pyDebounce(key, value){
  clearTimeout(pyTimers[key]);
  pyTimers[key] = setTimeout(()=>{ PY.s[key] = value; if(PY.s[key + 'Page']) PY.s[key + 'Page'] = 1; render(); }, 250);
}
function pyYearMonth(fk){
  const y = new Date().getFullYear();
  const years = [y + 1, y, y - 1, y - 2, y - 3];
  return pySelect(fk + 'M', PY.s[fk + 'Month'] || 'all', [['all','All Months']].concat(PY_MONTHS.map((m, i)=>[String(i + 1).padStart(2, '0'), m])),
      `PY.s['${fk}Month']=this.value; render()`)
    + pySelect(fk + 'Y', PY.s[fk + 'Year'] || String(y), [['all','All Years']].concat(years.map(x=>[String(x), String(x)])),
      `PY.s['${fk}Year']=this.value; render()`);
}
/* A hidden file input, and the button that opens it. `handler` is the name
   of a global function that is given the File. */
function pyFileButton(label, handler, accept, kind, multiple){
  const id = 'pyFile_' + handler;
  return `<button class="btn ${kind || ''}" onclick="document.getElementById('${id}').click()">${label}</button>
    <input type="file" id="${id}" hidden ${multiple ? 'multiple' : ''} accept="${accept || '.xlsx,.xls,.csv'}"
      onchange="const f=${multiple ? 'Array.from(this.files)' : 'this.files[0]'}; this.value=''; if(${multiple ? 'f.length' : 'f'}) ${handler}(f)">`;
}
function pyForm(file, fields){
  const fd = new FormData();
  fd.append('file', file);
  Object.keys(fields || {}).forEach(k=>fd.append(k, fields[k]));
  return fd;
}
function pyVal(id){ const el = document.getElementById(id); return el ? el.value : ''; }
function pyChecked(id){ const el = document.getElementById(id); return !!(el && el.checked); }
function pyField(label, input, hint){
  return `<div class="field"><label>${esc(label)}</label>${input}${hint ? `<div class="small-note" style="margin:4px 0 0">${hint}</div>` : ''}</div>`;
}
function pyInput(id, value, attrs){ return `<input id="${id}" value="${esc(value === null || value === undefined ? '' : String(value))}" ${attrs || ''}>`; }
/* Asks before something that cannot be undone. With `typed`, the person has
   to type that word first. */
function pyConfirm(title, text, label, onConfirm, typed){
  PY.s._confirm = onConfirm;
  openModal(esc(title), `<p>${esc(text)}</p>${typed ? pyField('Type ' + typed + ' to confirm', pyInput('pyConfirmTyped', '', `oninput="document.getElementById('pyConfirmGo').disabled=this.value!=='${typed}'"`)) : ''}`,
    `<button class="btn" onclick="closeModal()">Cancel</button>
     <button class="btn danger" id="pyConfirmGo" ${typed ? 'disabled' : ''} onclick="closeModal(); PY.s._confirm && PY.s._confirm()">${esc(label || 'Confirm')}</button>`);
}

/* ---------- charts, drawn in SVG from the page's own colours ---------- */
function pyLineChart(points, series){
  const W = 560, H = 210, L = 54, B = 26, T = 10;
  const max = Math.max(1, ...points.flatMap(p=>series.map(s=>Number(p[s.k]) || 0)));
  const x = i => L + (points.length < 2 ? 0 : i * (W - L - 10) / (points.length - 1));
  const y = v => T + (H - T - B) * (1 - v / max);
  const ticks = [0, .5, 1].map(f=>max * f);
  return `<svg class="py-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${ticks.map(v=>`<line x1="${L}" x2="${W - 6}" y1="${y(v)}" y2="${y(v)}" class="py-grid"/>
      <text x="${L - 6}" y="${y(v) + 4}" class="py-axis" text-anchor="end">${esc(pyInrShort(v))}</text>`).join('')}
    ${series.map(s=>{
      const d = points.map((p, i)=>(i ? 'L' : 'M') + x(i) + ' ' + y(Number(p[s.k]) || 0)).join(' ');
      const area = s.fill ? `<path d="${d} L${x(points.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z" fill="${s.color}" opacity=".12"/>` : '';
      return area + `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5"/>`
        + points.map((p, i)=>`<circle cx="${x(i)}" cy="${y(Number(p[s.k]) || 0)}" r="3" fill="${s.color}"><title>${esc(p.label)} · ${esc(s.label)}: ${esc(pyInr(p[s.k]))}</title></circle>`).join('');
    }).join('')}
    ${points.map((p, i)=>`<text x="${x(i)}" y="${H - 6}" class="py-axis" text-anchor="middle">${esc(p.label)}</text>`).join('')}
  </svg>
  <div class="row py-legend">${series.map(s=>`<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>`;
}
const PY_CAT_COLORS = {Equity:'#1E6B85', Hybrid:'#047857', Other:'#B45309', Arbitrage:'#6D28D9', Debt:'#B91C1C', Liquid:'#0E7490'};
function pyDonut(items){
  const total = items.reduce((s, c)=>s + c.value, 0) || 1;
  const R = 54, C = 2 * Math.PI * R;
  let at = 0;
  return `<svg class="py-donut" viewBox="0 0 140 140"><g transform="rotate(-90 70 70)">${items.map(c=>{
    const len = c.value / total * C;
    const seg = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${PY_CAT_COLORS[c.name] || '#94a3b8'}" stroke-width="20"
      stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-at}"><title>${esc(c.name)}: ${esc(pyInr(c.value))}</title></circle>`;
    at += len; return seg;
  }).join('')}</g></svg>`;
}

/* =====================================================================
   DASHBOARD
   ===================================================================== */
function viewPyDashboard(){
  const range = PY.s.dashRange || 'all', top = PY.s.dashTop || 'aum';
  const url = '/dashboard' + pyQs({range, top});
  const d = pyData(url);
  const admin = pyAdmin();
  const notes = admin ? pyData('/dashboard/notifications') : [];
  const head = pyHead('Payout Dashboard', 'Brokerage, payouts and compliance across the whole hierarchy.',
    `${pySearch('pyGlobalQ', 'globalQ', 'Search clients, folios, people…', 230)}
     <div class="pill-tabs">${[['all','All'],['month','Month'],['quarter','Quarter'],['year','Year']].map(o=>
      `<button class="${range === o[0] ? 'active' : ''}" onclick="PY.s.dashRange='${o[0]}'; render()">${o[1]}</button>`).join('')}</div>`);
  if(!d) return head + pyLoadingHtml(url);
  const search = (PY.s.globalQ || '').trim();
  const hits = search.length >= 2 ? pyData('/dashboard/search' + pyQs({q: search})) : null;
  PY.rows.search = hits || [];
  const catTotal = d.categories.reduce((s, c)=>s + c.value, 0) || 1;
  PY.rows.topClients = d.topClients;
  const unread = (notes || []).filter(n=>!n.read).length;
  return head + `
    ${hits ? pyCard('Search results', hits.length ? hits.map((h, i)=>`<div class="py-list-row row-clickable" onclick="pyOpenSearchHit(${i})">
        <div><b>${esc(h.label)}</b><div class="small-note" style="margin:0">${h.type === 'user' ? 'Team member' : 'Client'} · ${esc(h.sub || '')}</div></div></div>`).join('')
        : '<div class="empty">Nothing matches.</div>') : ''}
    ${pyStats([
      {label: 'Gross brokerage', value: pyInrShort(d.kpis.gross), sub: 'aggregated brokerage'},
      {label: 'Payout pool', value: pyInr(d.kpis.pool), sub: 'earned by the team', tone: 'ok'},
      {label: 'Portfolios', value: Number(d.kpis.clients).toLocaleString('en-IN'), sub: Number(d.kpis.transactions).toLocaleString('en-IN') + ' transactions'},
    ])}
    <div class="py-grid2">
      ${pyCard(`Compliance attention ${pyBadge(String(d.compliance.length), d.compliance.length ? 'warn' : 'ok')}`,
        d.compliance.length ? `<div class="py-scrollbox">${d.compliance.slice(0, 50).map(c=>`<div class="py-list-row">
          <div><b>${esc(c.name)}</b> <span class="small-note">(${esc(c.code || '—')})</span><div class="small-note" style="margin:0">${esc(c.kind)}</div></div>
          <div>${pyBadge(c.status + (c.date ? ' · ' + c.date : ''), c.status === 'MISSING' ? 'muted' : 'danger')}</div></div>`).join('')}</div>
          ${d.compliance.length > 50 ? `<div class="small-note">+ ${d.compliance.length - 50} more — review them in Admin Console › Profile.</div>` : ''}`
        : '<div class="empty">Every ARN and EUIN is on file and valid.</div>')}
      ${admin ? pyCard(`Notifications ${unread ? pyBadge(unread + ' new', 'info') : ''}`,
        notes === undefined ? pyLoadingHtml() : notes.length ? `<div class="py-scrollbox">${notes.map(n=>`<div class="py-list-row">
          <div><b>${esc(n.title)}</b>${n.read ? '' : ' <span class="badge info">new</span>'}<div class="small-note" style="margin:0">${esc(n.body)}</div></div>
          <div class="small-note">${esc(pyTimeAgo(n.ts))}</div></div>`).join('')}</div>` : '<div class="empty">You are all caught up.</div>',
        unread ? `<button class="btn sm" onclick="pyRun(()=>pyPost('/dashboard/notifications/read'))">Mark all read</button>` : '') : ''}
    </div>
    <div class="py-grid2">
      ${pyCard('🏆 Top clients', d.topClients.length ? d.topClients.map((c, i)=>`<div class="py-list-row row-clickable" onclick="pyOpenClient(${i})">
          <div class="row" style="gap:10px"><span class="py-rank ${i < 3 ? 'top' : ''}">${i + 1}</span>
            <div><b>${esc(c.name)}</b><div class="small-note" style="margin:0">${esc(c.pan || '—')} · ${c.txns} txns</div></div></div>
          <div class="py-r"><b>${esc(pyInrShort(c.aum))}</b><div class="small-note" style="margin:0">${esc(pyInr(c.brokerage, 0))} brokerage</div></div></div>`).join('')
        : '<div class="empty">Import brokerage files to see top clients.</div>',
        `<div class="pill-tabs">${[['aum','AUM'],['brokerage','Brokerage']].map(o=>`<button class="${top === o[0] ? 'active' : ''}" onclick="PY.s.dashTop='${o[0]}'; render()">${o[1]}</button>`).join('')}</div>`)}
      ${pyCard(`Recent redemptions ${pyBadge('last 60 days · ' + d.redemptions.length, 'danger')}`,
        d.redemptions.length ? d.redemptions.map(x=>`<div class="py-list-row"><div><b>${esc(x.investor)}</b><div class="small-note" style="margin:0">${esc(x.scheme)}</div></div>
          <div class="py-r"><b class="py-neg">${esc(pyInr(Math.abs(x.amount), 0))}</b><div class="small-note" style="margin:0">${esc(x.trxn_date)}</div></div></div>`).join('')
        : '<div class="empty">No redemptions in the last 60 days of imported transactions.</div>')}
    </div>
    <div class="py-grid21">
      ${pyCard('Revenue growth', `<div class="small-note" style="margin-top:0">Gross brokerage and the team's share, month by month</div>`
        + pyLineChart(d.revenue.map(r=>Object.assign({label: pyShortPeriod(r.period)}, r)),
          [{k: 'gross', label: 'Gross', color: 'var(--navy-2)'}, {k: 'share', label: 'Payout share', color: 'var(--gold)', fill: true}]))}
      ${pyCard('Top producers', [['Asset management', d.producers.amc], ['Key investor', d.producers.investor], ['Prime scheme', d.producers.scheme]].map(x=>
        `<div class="py-producer"><div class="small-note" style="margin:0">${x[0]}</div>
          <div class="between"><b class="py-ellipsis">${esc((x[1] && x[1].name) || '—')}</b><b>${esc(pyInrShort((x[1] && x[1].v) || 0))}</b></div></div>`).join(''))}
    </div>
    <div class="py-grid2">
      ${pyCard('Fund category breakdown', d.categories.length ? `<div class="row" style="gap:18px;align-items:center">${pyDonut(d.categories)}
        <div style="flex:1">${d.categories.map(c=>`<div class="between py-cat"><span><i style="background:${PY_CAT_COLORS[c.name] || '#94a3b8'}"></i>${esc(c.name)}</span>
          <span><span class="small-note">${(c.value / catTotal * 100).toFixed(1)}%</span> <b>${esc(pyInrShort(c.value))}</b></span></div>`).join('')}</div></div>`
        : '<div class="empty">No brokerage imported yet.</div>')}
      ${pyCard('RM leaderboard', d.leaderboard.length ? d.leaderboard.map((u, i)=>`<div class="py-list-row">
          <div class="row" style="gap:10px"><span class="py-rank ${i < 3 ? 'top' : ''}">${i + 1}</span><div><b>${esc(u.name)}</b><div class="small-note" style="margin:0">${u.txns} transactions</div></div></div>
          <b class="py-pos">${esc(pyInr(u.earnings, 0))}</b></div>`).join('')
        : '<div class="empty">Map clients to RMs to rank earnings.</div>')}
    </div>`;
}
function pyOpenClient(i){
  const c = PY.rows.topClients[i]; if(!c) return;
  PY.s.clientsTab = 'clients'; PY.s.clientQ = c.name; PY.s.clientQPage = 1;
  navigate('pyclients');
}
function pyOpenSearchHit(i){
  const h = PY.rows.search[i]; if(!h) return;
  PY.s.globalQ = '';
  if(h.type === 'user'){ PY.s.clientsTab = 'hierarchy'; PY.s.userQ = h.label; }
  else { PY.s.clientsTab = 'clients'; PY.s.clientQ = h.label; PY.s.clientQPage = 1; }
  navigate('pyclients');
}

/* =====================================================================
   PAYOUTS LEDGER — earned, paid and still owed, per person per month
   ===================================================================== */
function viewPyLedger(){
  const admin = pyAdmin();
  const url = '/payouts' + pyQs({period: PY.s.ledPeriod, product: PY.s.ledProduct || 'all'});
  const d = pyData(url);
  const head = data => pyHead('Payouts', 'What every BM and RM has earned, what has been paid, and what is still owed.',
    `${pySelect('pyLedProd', PY.s.ledProduct || 'all', [['all','All products'],['mf','Mutual funds'],['partner','Partner broking']], "PY.s.ledProduct=this.value; render()")}
     ${data ? pySelect('pyLedPer', data.period, (data.periods.indexOf(data.period) >= 0 ? data.periods : [data.period].concat(data.periods)).map(p=>[p, pyPeriodLabel(p)]), "PY.s.ledPeriod=this.value; render()") : ''}
     <button class="btn" onclick="pyRefresh()">↻ Refresh</button>
     ${data ? `<button class="btn" onclick="pyLedgerExport()">⬇ Export</button>` : ''}
     ${admin && data ? pyFileButton('⬆ Import payments', 'pyImportPayments', '.xlsx,.xls,.csv', 'primary') : ''}`);
  if(!d) return head() + pyLoadingHtml(url);
  PY.rows.ledger = d.rows; PY.s.ledPeriodNow = d.period;
  const k = d.kpis, q = (PY.s.ledQ || '').toLowerCase();
  const rows = d.rows.filter(r=>(!PY.s.ledOwed || r.owed > 0.005) && (!q || r.name.toLowerCase().indexOf(q) >= 0));
  const health = [['noRM', 'Clients with no RM', d.health.noRM, x=>x.name + ' · ' + pyAmt(x.gross)],
                  ['shared', 'Folios on two clients', d.health.shared, x=>x.folio + ': ' + x.clients]];
  return head(d) + `
    ${pyStats([
      {label: 'Brought forward', value: pyInrShort(k.broughtFwd), sub: 'unpaid from earlier months'},
      {label: 'Earned this month', value: pyInrShort(k.earned), sub: k.people + ' people'},
      {label: 'GST on top', value: pyInr(k.gst, 0), sub: 'added when GST is on'},
      {label: 'Payable (after GST & TDS)', value: pyInrShort(k.payable), tone: 'ok', sub: 'what the cheques come to'},
      {label: 'Paid', value: pyInrShort(k.paid), tone: 'ok', sub: 'recorded against this month'},
      {label: 'Still owed', value: pyInrShort(k.owed), tone: k.owed > 0 ? 'danger' : 'ok', sub: 'carries into next month'},
    ])}
    ${admin ? `<div class="card py-health"><div class="section-title" style="margin:0 0 8px">⚠ Attribution health
        <span class="small-note">money that may be reaching the wrong person</span></div>
      <div class="py-grid3">${health.map(h=>`<div class="py-health-cell row-clickable" onclick="PY.s.ledOpen=PY.s.ledOpen==='${h[0]}'?'':'${h[0]}'; render()">
          <b class="py-big ${h[2].count ? 'py-warn' : 'py-pos'}">${h[2].count}</b><div><b>${h[1]}</b></div>
          <div class="small-note" style="margin:0">${esc(pyAmt(h[2].amount))} this month</div>
          ${PY.s.ledOpen === h[0] ? `<div class="small-note py-scrollbox">${h[2].items.map(x=>`<div>${esc(h[3](x))}</div>`).join('') || 'clear'}</div>` : ''}</div>`).join('')}
        <div class="py-health-cell"><b class="py-big py-pos">${d.rows.filter(r=>r.owed < -0.5).length}</b><div><b>People overpaid</b></div>
          <div class="small-note" style="margin:0">paid more than they were owed</div></div></div></div>` : ''}
    ${pyCard('📅 ' + esc(pyPeriodLabel(d.period)), pyTable(
      [{t: 'Person'}, {t: 'Brought fwd', r: 1}, {t: 'Earned', r: 1}, {t: 'GST', r: 1}, {t: 'TDS', r: 1}, {t: 'Payable', r: 1}, {t: 'Paid', r: 1}, {t: 'Still owed', r: 1}, {t: ''}],
      rows.map(r=>`<tr><td><b>${esc(r.name)}</b><div class="small-note" style="margin:0">${esc(r.code || '')} · L${r.level}</div></td>
        <td class="py-r py-muted">${esc(pyAmt(r.broughtFwd))}</td><td class="py-r"><b>${esc(pyAmt(r.earned))}</b></td>
        <td class="py-r py-muted">${esc(pyAmt(r.gst))}</td><td class="py-r py-muted">${esc(pyAmt(r.tds))}</td>
        <td class="py-r"><b>${esc(pyAmt(r.payable))}</b>${r.estimated ? ' <span class="py-est">EST</span>' : ''}</td>
        <td class="py-r py-pos">${esc(pyAmt(r.paid))}</td>
        <td class="py-r"><b class="${r.owed > 0.005 ? 'py-neg' : 'py-pos'}">${esc(pyAmt(r.owed))}</b></td>
        <td class="py-r">${admin ? `<button class="btn sm" onclick="pyRecordPayment(${d.rows.indexOf(r)})">Record payment</button>` : ''}</td></tr>`),
      'Nothing earned this month. Import brokerage and map clients to see payouts.'),
      `<label class="py-check"><input type="checkbox" ${PY.s.ledOwed ? 'checked' : ''} onchange="PY.s.ledOwed=this.checked; render()"> Only those still owed</label>
       ${pySearch('pyLedQ', 'ledQ', 'Search person…', 180)}`)}`;
}
function pyLedgerExport(){
  pyExport(PY.rows.ledger.map(r=>({Person: r.name, Code: r.code, Level: r.level, 'Brought Fwd': r.broughtFwd, Earned: r.earned,
    GST: r.gst, TDS: r.tds, Payable: r.payable, Paid: r.paid, 'Still Owed': r.owed})), 'payouts-' + PY.s.ledPeriodNow + '.xlsx');
}
function pyImportPayments(file){
  pyRun(()=>pyPost('/payouts/payments/import', pyForm(file, {period: PY.s.ledPeriodNow})),
    r=>r.recorded + ' payment(s) recorded' + (r.skipped.length ? ', ' + r.skipped.length + ' skipped (' + r.skipped.join(', ') + ')' : ''));
}
function pyRecordPayment(i){
  const r = PY.rows.ledger[i]; if(!r) return;
  PY.s._payRow = r;
  openModal('Record payment', `
    <div><b>${esc(r.name)}</b> · ${esc(pyPeriodLabel(PY.s.ledPeriodNow))}</div>
    <div class="py-banner info">Still owed: <b>${esc(pyAmt(r.owed))}</b> (payable this month ${esc(pyAmt(r.payable))} plus ${esc(pyAmt(r.broughtFwd))} brought forward)</div>
    <div class="field-grid">
      ${pyField('Amount (₹)', pyInput('pyPayAmt', Math.max(0, r.owed).toFixed(2), 'type="number" step="0.01"'))}
      ${pyField('Paid on', pyInput('pyPayOn', new Date().toISOString().slice(0, 10), 'type="date"'))}
    </div>
    ${pyField('Reference (UTR / cheque no.)', pyInput('pyPayRef', ''))}`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="pySavePayment()">Save payment</button>`);
}
async function pySavePayment(){
  const r = PY.s._payRow;
  const body = {userId: r.id, period: PY.s.ledPeriodNow, amount: pyVal('pyPayAmt'), paidOn: pyVal('pyPayOn'), reference: pyVal('pyPayRef')};
  const ok = await pyRun(()=>pyPost('/payouts/payments', body), 'Payment recorded');
  if(ok) closeModal();
}

/* =====================================================================
   PARTNER BROKERAGE — MOFSL and other broking statements
   ===================================================================== */
function viewPyPartner(){
  const admin = pyAdmin();
  const partner = PY.s.ptPartner || 'MOFSL';
  const url = '/partner' + pyQs({partner, month: PY.s.ptMonth});
  const d = pyData(url);
  const head = pyHead('Partner Brokerage', 'Broking revenue from Motilal Oswal and other partners — separate from mutual fund trail.',
    `${d && d.partners.length > 1 ? pySelect('pyPtPartner', partner, d.partners, "PY.s.ptPartner=this.value; PY.s.ptSharing=null; render()") : ''}
     <button class="btn" onclick="pyRefresh()">↻ Refresh</button>
     ${admin ? `<button class="btn primary" onclick="pyPartnerUploadModal()">⬆ Upload statement</button>` : ''}`);
  if(!d) return head + pyLoadingHtml(url);
  const k = d.kpis, m = d.months;
  if(!PY.s.ptSharing || PY.s.ptSharingFor !== url){ PY.s.ptSharing = Object.assign({}, d.sharing); PY.s.ptSharingFor = url; }
  PY.rows.ptUnmapped = d.unmapped;
  return head + `
    ${pyStats([
      {label: 'Total brokerage', value: pyInrShort(k.total), sub: 'what the partner billed'},
      {label: 'Mentor brokerage', value: pyInrShort(k.mentor), tone: 'ok', sub: 'our side of the split'},
      {label: 'Partner brokerage', value: pyInrShort(k.partner), sub: 'retained by ' + partner},
      {label: 'Payout brokerage', value: pyInrShort(k.payout), sub: k.payout ? 'reaches the team by level %' : 'no sharing % set yet'},
    ])}
    <div class="row" style="gap:8px;margin:6px 0 12px">
      <span class="small-note" style="margin:0">Month</span>
      ${pySelect('pyPtMonth', PY.s.ptMonth || '', [['','All months']].concat(m.map(x=>[x.period, pyPeriodLabel(x.period)])), "PY.s.ptMonth=this.value; render()")}
      <span class="small-note" style="margin:0">${m.length} month(s) imported · ${m.reduce((s, x)=>s + x.rows, 0)} rows, ${m.reduce((s, x)=>s + x.codes, 0)} codes</span>
    </div>
    ${pyCard('Sharing for ' + esc(partner), `<div class="small-note">The statement says what the firm earns; it says nothing about what reaches a person, because broking carries no level ladder of its own. Set a percentage against the hierarchy level that should be paid — most clients sit at level 3 (RM) with their manager at level 4.</div>
      <div class="row py-wrap" style="gap:10px;align-items:flex-end">${[1, 2, 3, 4, 5, 6, 7].map(l=>pyField('Level ' + l,
        pyInput('pyPtShare' + l, PY.s.ptSharing[l] === undefined ? 0 : PY.s.ptSharing[l], `type="number" class="py-pct" ${admin ? '' : 'disabled'} oninput="PY.s.ptSharing[${l}]=this.value"`))).join('')}
        ${admin ? `<button class="btn primary" onclick="pyRun(()=>pyPut('/partner/sharing', {partner: '${esc(partner)}', sharing: PY.s.ptSharing}), 'Sharing saved')">Save sharing</button>` : ''}</div>`)}
    ${d.unmapped.length ? `<div class="card py-alert"><b>🔗 ${d.unmapped.length} client code(s) are not attached to a client yet.</b>
      <div class="small-note">The statement has no RM column, so until a code is attached nobody but an admin can see it and it reaches no payout. Later imports of the same code attribute themselves.</div>
      ${pyTable([{t: 'Code'}, {t: 'Name on statement'}, {t: 'Rows', r: 1}, {t: 'Total', r: 1}, {t: 'Mentor', r: 1}, {t: ''}],
        d.unmapped.map((u, i)=>`<tr><td class="py-mono">${esc(u.code)}</td><td>${esc(u.client_name)}</td><td class="py-r">${u.rows}</td>
          <td class="py-r">${esc(pyAmt(u.total))}</td><td class="py-r"><b>${esc(pyAmt(u.mentor))}</b></td>
          <td class="py-r">${admin ? `<button class="btn sm" onclick="pyAttachCode(${i})">Attach</button>` : ''}</td></tr>`))}</div>` : ''}
    ${pyCard('By month', pyTable([{t: 'Partner'}, {t: 'Month'}, {t: 'Rows', r: 1}, {t: 'Codes', r: 1}, {t: 'Total brokerage', r: 1}, {t: 'Mentor brokerage', r: 1}, {t: 'Partner brokerage', r: 1}, {t: 'Unmapped', r: 1}],
      m.map(x=>`<tr><td>${esc(partner)}</td><td class="py-mono">${esc(x.period)}</td><td class="py-r">${x.rows}</td><td class="py-r">${x.codes}</td>
        <td class="py-r">${esc(pyAmt(x.total))}</td><td class="py-r"><b>${esc(pyAmt(x.mentor))}</b></td><td class="py-r">${esc(pyAmt(x.partner_share))}</td><td class="py-r py-neg">${x.unmapped}</td></tr>`),
      'No statements imported.'))}
    ${pyCard('By segment', pyTable([{t: 'Partner'}, {t: 'Segment'}, {t: 'Rows', r: 1}, {t: 'Total brokerage', r: 1}, {t: 'Our share', r: 1}],
      d.segments.map(s=>`<tr><td>${esc(partner)}</td><td class="py-mono">${esc(s.segment)}</td><td class="py-r">${s.rows}</td><td class="py-r">${esc(pyAmt(s.total))}</td><td class="py-r"><b>${esc(pyAmt(s.ours))}</b></td></tr>`)))}
    <div class="py-grid2">
      ${pyCard('By client', pyTable([{t: 'Code'}, {t: 'Client'}, {t: 'Total', r: 1}, {t: 'Mentor', r: 1}],
        d.byClient.map(c=>`<tr><td class="py-mono">${esc(c.code)}</td><td>${esc(c.name)}${c.client_id ? '' : ' ' + pyBadge('unattached', 'danger')}</td>
          <td class="py-r">${esc(pyAmt(c.total))}</td><td class="py-r"><b>${esc(pyAmt(c.mentor))}</b></td></tr>`), '', {scroll: 1, max: 380}))}
      ${pyCard('Payout by person', pyTable([{t: 'Person'}, {t: 'Level'}, {t: 'Payout', r: 1}],
        d.payouts.map(p=>`<tr><td><b>${esc(p.name)}</b></td><td>L${p.level}</td><td class="py-r"><b class="py-pos">${esc(pyInr(p.amount))}</b></td></tr>`),
        'Set sharing % and attach codes to see payouts.'))}
    </div>`;
}
function pyPartnerUploadModal(){
  openModal('Upload statement', `<div class="field-grid">
      ${pyField('Partner', pyInput('pyPtUpPartner', 'MOFSL', 'oninput="this.value=this.value.toUpperCase()"'))}
      ${pyField('Statement month', pyInput('pyPtUpPeriod', new Date().toISOString().slice(0, 7), 'type="month"'))}
    </div>
    <div class="small-note">Needs Client Code, Total Brokerage and Mentor (our) Brokerage columns.</div>
    <div style="margin-top:10px">${pyFileButton('Choose the partner Excel / CSV', 'pyPartnerUpload', '.xlsx,.xls,.csv', 'primary')}</div>`,
    `<button class="btn" onclick="closeModal()">Close</button>`);
}
async function pyPartnerUpload(file){
  const r = await pyRun(()=>pyPost('/partner/upload', pyForm(file, {partner: pyVal('pyPtUpPartner') || 'MOFSL', period: pyVal('pyPtUpPeriod')})),
    r=>r.rows + ' statement row(s) imported');
  if(r) closeModal();
}
function pyAttachCode(i){
  const u = PY.rows.ptUnmapped[i]; if(!u) return;
  PY.s._attach = {item: u, partner: PY.s.ptPartner || 'MOFSL', q: u.client_name || '', clientId: ''};
  pyAttachDraw();
}
function pyAttachDraw(){
  const a = PY.s._attach;
  const url = '/clients' + pyQs({q: a.q, size: 20});
  const d = pyData(url);
  if(!d) setTimeout(()=>{ if(PY.s._attach === a && document.getElementById('pyAttachList')) pyAttachDraw(); }, 400);
  PY.rows.attachList = d ? d.rows : [];
  openModal('Attach client code', `<div><b>Code <span class="py-mono">${esc(a.item.code)}</span></b> · ${esc(a.item.client_name)}</div>
    ${pyField('Find client', pyInput('pyAttachQ', a.q, `oninput="clearTimeout(pyTimers.att); const v=this.value; pyTimers.att=setTimeout(()=>{PY.s._attach.q=v; pyAttachDraw()},250)"`))}
    <div class="py-pick-list" id="pyAttachList">${!d ? '<div class="empty">Loading…</div>' : d.rows.length ? d.rows.map((c, i)=>
      `<div class="py-pick ${String(a.clientId) === String(c.id) ? 'on' : ''}" onclick="PY.s._attach.clientId=${c.id}; pyAttachDraw()"><b>${esc(c.name)}</b> <span class="py-mono small-note">${esc(c.pan || '')}</span></div>`).join('')
      : '<div class="empty">No matching client — add them in Clients & Map first.</div>'}</div>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" ${a.clientId ? '' : 'disabled'} onclick="pyAttachSave()">Attach</button>`);
}
async function pyAttachSave(){
  const a = PY.s._attach;
  const r = await pyRun(()=>pyPost('/partner/map', {partner: a.partner, code: a.item.code, clientId: a.clientId}), r=>r.rows + ' row(s) re-attributed');
  if(r) closeModal();
}

/* =====================================================================
   BROKERAGE RATES
   ===================================================================== */
function viewPyRates(){
  const f = PY.s.rates = PY.s.rates || {q: '', amc: '', month: '', year: '', current: '1'};
  f.q = PY.s.rateQ || '';
  const url = '/rates' + pyQs(f);
  const d = pyData(url);
  PY.s.rateChecked = PY.s.rateChecked || {};
  const head = pyHead('Brokerage Structure', 'Master list of AMC brokerage rates, extracted from AMC PDFs or rate sheets.',
    `<button class="btn" onclick="pyRatesExport()">⬇ Export</button>
     <button class="btn danger" onclick="pyConfirm('Reset the rate master?', 'Every scheme rate and its history will be deleted.', 'Reset master', ()=>pyRun(()=>pyPost('/rates/reset'), 'Rate master reset'))">🗑 Reset master</button>`);
  const rows = d ? d.rows : [];
  PY.rows.rates = rows;
  const years = Array.from(new Set(rows.map(r=>(r.period || '').slice(0, 4)).filter(Boolean)));
  const checked = Object.keys(PY.s.rateChecked).filter(k=>PY.s.rateChecked[k]).map(Number);
  return head + `<div class="py-grid12">
    <div>
      ${pyCard('Upload brokerage PDFs', `<div class="small-note" style="margin-top:0">Rates are pulled out of AMC brokerage-structure PDFs automatically; .xlsx and .csv rate sheets work too.</div>
        ${pyField('Effective month', pyInput('pyRatePeriod', PY.s.ratePeriod || new Date().toISOString().slice(0, 7), `type="month" onchange="PY.s.ratePeriod=this.value"`))}
        <div style="margin-top:10px">${pyFileButton('Select PDF / sheet files', 'pyRatesUpload', '.pdf,.xlsx,.xls,.csv', 'primary', true)}</div>`)}
      ${pyCard('Structure analytics', `<div class="py-kv"><span>Total schemes</span><b>${d ? d.stats.schemes : 0}</b></div>
        <div class="py-kv"><span>Rate versions</span><b>${d ? d.stats.versions : 0}</b></div>
        <div class="py-kv"><span>Tracked AMCs</span><b>${d ? d.stats.amcs : 0}</b></div>`)}
    </div>
    ${pyCard('', `<div class="row py-wrap" style="gap:8px;margin-bottom:8px">
        ${pySearch('pyRateQ', 'rateQ', 'Search master list…', 220)}
        ${pySelect('pyRateAmc', f.amc, [['','All AMCs']].concat((d ? d.amcs : []).map(a=>[a, a])), "PY.s.rates.amc=this.value; render()")}
        ${pySelect('pyRateMonth', f.month, [['','Months']].concat(PY_MONTHS.map((m, i)=>[String(i + 1), m])), "PY.s.rates.month=this.value; render()")}
        ${pySelect('pyRateYear', f.year, [['','Years']].concat(years.map(y=>[y, y])), "PY.s.rates.year=this.value; render()")}
        <label class="py-check"><input type="checkbox" ${f.current === '1' ? 'checked' : ''} onchange="PY.s.rates.current=this.checked?'1':'0'; render()"> Current rate only</label>
        ${checked.length ? `<button class="btn sm danger" onclick="pyConfirm('Delete selected rates?', '${checked.length} rate row(s) will be deleted.', 'Delete', ()=>pyRun(()=>pyPost('/rates/delete', {ids: ${JSON.stringify(checked)}}).then(r=>{PY.s.rateChecked={}; return r;}), 'Deleted'))">Delete ${checked.length}</button>` : ''}
        <span class="small-note" style="margin:0">${rows.length} master schemes</span></div>
      ${!d ? pyLoadingHtml(url) : pyTable([{html: `<input type="checkbox" ${rows.length && checked.length === rows.length ? 'checked' : ''} onchange="PY.rows.rates.forEach(r=>PY.s.rateChecked[r.id]=this.checked); render()">`},
          {t: 'AMC & scheme'}, {t: 'Period', c: 1}, {t: 'Gross rate', c: 1}, {t: '', r: 1}],
        rows.map((r, i)=>`<tr><td><input type="checkbox" ${PY.s.rateChecked[r.id] ? 'checked' : ''} onchange="PY.s.rateChecked[${r.id}]=this.checked; render()"></td>
          <td><b>${esc(r.scheme)}</b><div class="small-note" style="margin:0">${esc(r.amc || '')}</div></td>
          <td class="py-c py-muted">${esc(r.period || '')}</td><td class="py-c"><b>${esc(String(r.rate))}%</b></td>
          <td class="py-r py-nowrap"><button class="btn sm ghost" title="Rate history" onclick="pyRateHistory(${i})">🕘</button>
            <button class="btn sm ghost" title="Edit" onclick="pyRateEdit(${i})">✎</button>
            <button class="btn sm ghost" title="Delete" onclick="pyRun(()=>pyPost('/rates/delete', {ids: [${r.id}]}), 'Rate deleted')">🗑</button></td></tr>`),
        'No rates yet. Upload AMC brokerage PDFs or a rate sheet.', {scroll: 1, max: 640})}`)}
  </div>`;
}
function pyRatesExport(){
  pyExport((PY.rows.rates || []).map(r=>({AMC: r.amc, Scheme: r.scheme, Period: r.period, 'Gross Rate %': r.rate, Source: r.source})), 'brokerage-rates.xlsx');
}
function pyRatesUpload(files){
  const fd = new FormData();
  files.forEach(x=>fd.append('files', x));
  fd.append('period', PY.s.ratePeriod || new Date().toISOString().slice(0, 7));
  pyRun(()=>pyPost('/rates/upload', fd), r=>r.total + ' scheme rate(s) extracted from ' + r.files.length + ' file(s)');
}
async function pyRateHistory(i){
  const r = PY.rows.rates[i];
  try {
    const h = await pyGet('/rates/history' + pyQs({amc: r.amc, scheme: r.scheme}));
    openModal('Rate history', `<div><b>${esc(r.scheme)}</b></div>` + pyTable([{t: 'Period'}, {t: 'Rate'}, {t: 'Source'}],
      h.map(x=>`<tr><td>${esc(x.period || '')}</td><td><b>${esc(String(x.rate))}%</b></td><td class="small-note">${esc(x.source || '')}</td></tr>`)),
      `<button class="btn" onclick="closeModal()">Close</button>`);
  } catch(e){ pyToast(e.message, 'err'); }
}
function pyRateEdit(i){
  const r = PY.rows.rates[i];
  PY.s._rate = r;
  openModal('Edit rate', `${pyField('Scheme', pyInput('pyRateScheme', r.scheme))}
    <div class="field-grid">${pyField('Gross rate %', pyInput('pyRateRate', r.rate, 'type="number" step="0.01"'))}
      ${pyField('Period', pyInput('pyRatePer', r.period, 'type="month"'))}</div>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="pyRateSave()">Save</button>`);
}
async function pyRateSave(){
  const r = PY.s._rate;
  const ok = await pyRun(()=>pyPut('/rates/' + r.id, Object.assign({}, r, {scheme: pyVal('pyRateScheme'), rate: pyVal('pyRateRate'), period: pyVal('pyRatePer')})), 'Rate updated');
  if(ok) closeModal();
}

/* =====================================================================
   AUDIT LOG
   ===================================================================== */
function pyActionTone(a){
  return /DELETE|PURGE|RESET|FAILED|REJECT/.test(a) ? 'danger' : /MAPPING|UPDATE|LOCK|SHARING|RULES|CORRECTED/.test(a) ? 'warn'
    : /IMPORT|CREATE|APPROVED|PAYMENT/.test(a) ? 'ok' : 'muted';
}
function pyAuditTable(compact){
  const f = PY.s.audit = PY.s.audit || {action: '', user: '', from: '', to: '', limit: 100};
  const url = '/audit' + pyQs(Object.assign({}, f, {q: PY.s.auditQ || ''}));
  const d = pyData(url);
  PY.rows.audit = d ? d.rows : [];
  return pyCard('', `<div class="row py-wrap" style="gap:8px">
      ${pySearch('pyAuditQ', 'auditQ', 'Search user, action, description…', 260)}
      ${compact ? '' : pySelect('pyAuditAct', f.action, [['','All actions']].concat((d ? d.actions : []).map(a=>[a, a])), "PY.s.audit.action=this.value; render()")}
      ${compact ? '' : pySelect('pyAuditUser', f.user, [['','All users']].concat((d ? d.users : []).map(a=>[a, a])), "PY.s.audit.user=this.value; render()")}
      <input type="date" class="list-sort" value="${esc(f.from)}" onchange="PY.s.audit.from=this.value; render()">
      <input type="date" class="list-sort" value="${esc(f.to)}" onchange="PY.s.audit.to=this.value; render()">
      <button class="btn sm" onclick="pyRefresh()">↻</button></div>`)
    + pyCard('', !d ? pyLoadingHtml(url) : pyTable([{t: 'When'}, {t: 'User'}, {t: 'Action'}, {t: 'Description'}],
        d.rows.map(r=>`<tr><td class="py-nowrap"><b>${esc(pyTimeAgo(r.ts))}</b><div class="small-note" style="margin:0">${esc(pyLocalTs(r.ts))}</div></td>
          <td><b>${esc(r.user_name || '')}</b><div class="small-note" style="margin:0">${r.user_id ? 'user ' + r.user_id : 'system'}</div></td>
          <td>${pyBadge(r.action, pyActionTone(r.action))}</td><td>${esc(r.description || '')}</td></tr>`), 'No activity found.')
      + `<div class="between small-note"><span>Showing ${d.rows.length} of ${d.total} entries</span>
        ${d.rows.length < d.total ? `<button class="btn sm" onclick="PY.s.audit.limit+=200; render()">Load more</button>` : ''}</div>`);
}
function viewPyAudit(){
  return pyHead('Audit Log', 'Every login, import, mapping and configuration change in Payouts.',
    `<button class="btn" onclick="pyRefresh()">↻ Refresh</button><button class="btn primary" onclick="pyAuditExport()">⬇ Export</button>`)
    + pyAuditTable(false);
}
async function pyAuditExport(){
  try {
    const r = await pyGet('/audit?limit=1000');
    pyExport(r.rows.map(x=>({When: pyLocalTs(x.ts), User: x.user_name, Action: x.action, Description: x.description})), 'payout-audit-log.xlsx');
  } catch(e){ pyToast(e.message, 'err'); }
}

/* Page numbers under a long list. `key` is where the page lives in PY.s. */
function pyPager(key, total, size){
  size = size || 50;
  const page = PY.s[key] || 1, pages = Math.max(1, Math.ceil(total / size));
  if(total <= size) return `<div class="small-note">${total} result(s)</div>`;
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const nums = Array.from({length: Math.min(5, pages)}, (_, i)=>start + i);
  const go = n => `PY.s['${key}']=${n}; render()`;
  return `<div class="between py-pager"><span class="small-note" style="margin:0">Showing ${(page - 1) * size + 1}–${Math.min(total, page * size)} of ${total}</span>
    <div class="row" style="gap:4px"><button class="btn sm" ${page === 1 ? 'disabled' : ''} onclick="${go(page - 1)}">‹</button>
      ${nums.map(n=>`<button class="btn sm ${n === page ? 'primary' : ''}" onclick="${go(n)}">${n}</button>`).join('')}
      <button class="btn sm" ${page === pages ? 'disabled' : ''} onclick="${go(page + 1)}">›</button></div></div>`;
}

/* =====================================================================
   IMPORTS — registrar files in, cleaned and attributed
   ===================================================================== */
const PY_IMPORT_TYPES = [
  {kind: 'transactions', title: '1 · Transactions (Full)', note: 'WBR2 / MFSD201 — PAN + full names', opts: [['CAMS', 'CAMS WBR2'], ['KARVY', 'Karvy MFSD201']]},
  {kind: 'folio', title: '2 · Folio Master', note: 'WBR9 / MFSD211 — investor master only', opts: [['CAMS', 'CAMS WBR9'], ['KARVY', 'Karvy MFSD211']]},
  {kind: 'brokerage', title: '3 · Brokerage Statement', note: 'CAMS (normal, then SIF), then Karvy', opts: [['CAMS', 'CAMS'], ['KARVY', 'Karvy']]},
];
function viewPyImports(){
  const trash = pyData('/imports/batches?status=deleted');
  const tab = pyTab('impTab', 'new');
  return pyHead('Data Import', 'Registrar files from CAMS and Karvy, cleaned and matched to clients as they come in.')
    + pyTabs('impTab', [['new', 'New upload'], ['history', 'Batch history'], ['trash', '🗑 Trash', trash ? trash.trash : undefined]], 'new')
    + (tab === 'new' ? pyImportNew() : pyBatchTable(tab === 'trash'));
}
function pyImportNew(){
  const now = new Date();
  const sel = PY.s.impSel = PY.s.impSel || {kind: 'transactions', source: 'CAMS', month: String(now.getMonth() + 1).padStart(2, '0'), year: String(now.getFullYear())};
  const years = Array.from({length: 6}, (_, i)=>String(now.getFullYear() + 1 - i));
  const r = PY.s.impResult;
  const sampleKeys = r && r.sample && r.sample[0] ? Object.keys(r.sample[0]) : [];
  return `<div class="py-grid12">
    <div>
      ${pyCard('1 · Source and period', PY_IMPORT_TYPES.map(t=>`<div class="py-imp-type">
          <div class="between"><b class="small-note" style="margin:0;text-transform:uppercase;letter-spacing:.06em">${t.title}</b><span class="small-note" style="margin:0">${t.note}</span></div>
          <div class="py-grid-btn">${t.opts.map(o=>`<button class="btn ${sel.kind === t.kind && sel.source === o[0] ? 'primary' : ''}"
            onclick="PY.s.impSel.kind='${t.kind}'; PY.s.impSel.source='${o[0]}'; render()">${o[1]}</button>`).join('')}</div></div>`).join('')
        + `<div class="field-grid" style="margin-top:10px">${pyField('Settlement month', pySelect('pyImpMonth', sel.month, PY_MONTHS.map((m, i)=>[String(i + 1).padStart(2, '0'), m]), "PY.s.impSel.month=this.value"))}
          ${pyField('Year', pySelect('pyImpYear', sel.year, years, "PY.s.impSel.year=this.value"))}</div>`)}
      ${pyCard('2 · Select file', `<div class="py-drop" id="pyDrop" onclick="document.getElementById('pyImpFile').click()"
          ondragover="event.preventDefault(); this.classList.add('drag')" ondragleave="this.classList.remove('drag')"
          ondrop="event.preventDefault(); this.classList.remove('drag'); if(event.dataTransfer.files[0]) pyImportUpload(event.dataTransfer.files[0])">
          <div style="font-size:26px">${PY.s.impBusy ? '⏳' : '⬆'}</div><b>${PY.s.impBusy ? 'Processing…' : 'Upload spreadsheet'}</b>
          <div class="small-note" style="margin:0">.xls, .xlsx, .csv, .dbf — or drop it here</div></div>
        <input type="file" id="pyImpFile" hidden accept=".xls,.xlsx,.csv,.txt,.dbf" onchange="const f=this.files[0]; this.value=''; if(f) pyImportUpload(f)">`)}
    </div>
    ${pyCard(r ? '✅ ' + esc(r.fileName) : '', !r ? '<div class="empty">Upload a registrar file to start. The result shows here.</div>' : `
      <div class="small-note" style="margin-top:0">${esc(r.source)} ${esc(r.variant || '')} · ${esc(pyPeriodLabel(r.period))}</div>
      ${pyStats([
        {label: 'Rows', value: Number(r.rows).toLocaleString('en-IN'), sub: 'was ' + r.rawRows},
        {label: 'Total business', value: pyInr(r.total)},
        {label: 'New clients', value: r.newClients},
        {label: 'Unmapped rows', value: r.unmapped, tone: r.unmapped ? 'warn' : 'ok'},
      ])}
      ${r.duplicatesRemoved > 0 ? `<div class="py-banner warn">${r.duplicatesRemoved} exact duplicate row(s) in the file were skipped.</div>` : ''}
      ${r.unmapped > 0 ? `<div class="py-banner warn">Some brokerage rows have no client yet. Import the Folio Master, then use Batch history › Re-map unmapped.</div>` : ''}
      ${pyTable(sampleKeys.map(k=>({t: k.replace('_', ' ')})), (r.sample || []).map(row=>`<tr>${sampleKeys.map(k=>`<td class="small">${esc(String(row[k] === null || row[k] === undefined ? '' : row[k]))}</td>`).join('')}</tr>`), '', {scroll: 1, max: 360})}
      <div class="small-note">Showing the first ${(r.sample || []).length} cleaned rows.</div>`)}
  </div>`;
}
async function pyImportUpload(file){
  const sel = PY.s.impSel;
  PY.s.impBusy = true; render();
  const r = await pyRun(()=>pyPost('/imports/upload', pyForm(file, {kind: sel.kind, source: sel.source, period: sel.year + '-' + sel.month})),
    r=>r.fileName + ': ' + r.rows + ' rows imported');
  PY.s.impBusy = false;
  if(r) PY.s.impResult = r;
  render();
}
function pyBatchTable(trash){
  const url = '/imports/batches' + pyQs({status: trash ? 'deleted' : 'live', q: PY.s.batchQ, month: PY.s.batchMonth});
  const d = pyData(url);
  if(!d) return pyLoadingHtml(url);
  PY.rows.batches = d.rows;
  const ts = b => pyLocalTs(trash ? b.deleted_at : b.created_at);
  return (trash ? `<div class="py-banner warn">⚠ Deleted batches are hidden from reports but kept so they can be restored. Purge them to free space.</div>`
      : `<div class="card between"><span class="small-note" style="margin:0">After importing a Folio Master, use this to link new investors' brokerage to their client.</span>
         <button class="btn primary" onclick="pyRun(()=>pyPost('/imports/remap'), r=>'Re-mapped ' + r.mapped + ' of ' + r.scanned + ' unmapped row(s)')">↻ Re-map unmapped</button></div>`)
    + pyCard('', `<div class="row py-wrap" style="gap:8px;margin-bottom:8px">${pySearch('pyBatchQ', 'batchQ', 'Search file name…', 200)}
        ${pySelect('pyBatchMonth', PY.s.batchMonth || '', [['','All months']].concat(d.periods.map(p=>[p, pyPeriodLabel(p)])), "PY.s.batchMonth=this.value; render()")}
        <span class="small-note" style="margin:0">Showing ${d.rows.length} of ${trash ? d.trash : d.live}</span></div>`
      + pyTable([{t: 'Batch file'}, {t: trash ? 'Deleted on' : 'Imported'}, {t: 'Type', c: 1}, {t: 'Rows', c: 1}, {t: 'Total business', r: 1}].concat(trash ? [] : [{t: 'Status', c: 1}]).concat([{t: '', r: 1}]),
        d.rows.map((b, i)=>`<tr><td><b>${esc(b.file_name)}</b><div class="small-note" style="margin:0">${esc(pyPeriodLabel(b.period))}</div></td>
          <td class="py-muted small">${esc(ts(b))}</td>
          <td class="py-c">${pyBadge(b.source + ' ' + (b.variant || ''), 'info')}<div class="small-note" style="margin:0">${esc(b.kind)}</div></td>
          <td class="py-c"><b>${Number(b.rows).toLocaleString('en-IN')}</b>${b.raw_rows !== b.rows ? `<div class="small-note" style="margin:0">was ${Number(b.raw_rows).toLocaleString('en-IN')}</div>` : ''}</td>
          <td class="py-r"><b>${esc(pyInr(b.total))}</b>${Math.abs(b.raw_total - b.total) > 0.001 ? `<div class="small-note" style="margin:0">was ${esc(pyInr(b.raw_total, 3))}</div>` : ''}</td>
          ${trash ? '' : `<td class="py-c">${pyBadge('Live', 'ok')}</td>`}
          <td class="py-r py-nowrap">${trash
            ? `<button class="btn sm primary" onclick="pyRun(()=>pyPost('/imports/batches/${b.id}/restore'), 'Batch restored')">Restore</button>
               <button class="btn sm danger" onclick="pyPurgeBatch(${i})">Delete forever</button>`
            : `<button class="btn sm ghost" title="Move to trash" onclick="pyRun(()=>pyDel('/imports/batches/${b.id}'), 'Moved to trash')">🗑</button>`}</td></tr>`),
        trash ? 'Trash is empty.' : 'No batches yet. Upload a registrar file in New upload.'));
}
function pyPurgeBatch(i){
  const b = PY.rows.batches[i]; if(!b) return;
  pyConfirm('Delete forever?', b.file_name + ' and its ' + b.rows + ' rows will be permanently removed. This cannot be undone.', 'Delete forever',
    ()=>pyRun(()=>pyDel('/imports/batches/' + b.id + '/purge'), 'Batch permanently deleted'));
}

/* =====================================================================
   CLIENTS & MAP — the team (hierarchy), the clients, and clean-up
   ===================================================================== */
function viewPyClients(){
  const admin = pyAdmin();
  const opts = (admin ? [['hierarchy', '🛡 Hierarchy']] : []).concat([['clients', '👥 Clients']]).concat(admin ? [['standardize', '🗂 Standardize']] : []);
  let tab = pyTab('clientsTab', admin ? 'hierarchy' : 'clients');
  if(!opts.some(o=>o[0] === tab)) tab = 'clients';
  PY.s.clientsTab = tab;
  return pyHead('Clients & Map', 'Who is on the payout team, which client belongs to whom, and tidy names.')
    + pyTabs('clientsTab', opts, tab)
    + (tab === 'hierarchy' ? pyHierarchy() : tab === 'standardize' ? pyStandardize() : pyClientList(admin));
}

/* ---- Hierarchy: the payout team ---- */
function pyHierarchy(){
  const url = '/users' + pyQs({q: PY.s.userQ});
  const d = pyData(url);
  PY.rows.users = d || [];
  return pyCard('Payout team', `<div class="small-note" style="margin-top:0">Everyone here signs in with their BOSS account. Add a person with the same email they use for BOSS; a BOSS admin is always a payout admin.</div>`
    + (!d ? pyLoadingHtml(url) : pyTable([{t: 'Person'}, {t: 'Role & level'}, {t: 'Reports to'}, {t: 'Mapped clients', c: 1}, {t: 'Access'}, {t: '', r: 1}],
      d.map((u, i)=>`<tr><td><b>${esc(u.name)}</b><div class="small-note" style="margin:0">${esc(u.email || '')}${u.code ? ' · ' + esc(u.code) : ''}</div></td>
        <td>${pyBadge(String(u.role).toUpperCase(), u.role === 'admin' ? 'info' : u.role === 'mentor' ? 'ok' : 'muted')} <b>L${u.level}</b> <span class="small-note">${esc(u.level_name || PY_LEVELS[u.level] || '')}</span>
          ${(u.extra_levels || []).length ? `<div class="small-note" style="margin:0">+ ${u.extra_levels.map(l=>'L' + l).join(', ')}</div>` : ''}
          ${u.active === 0 ? ' ' + pyBadge('disabled', 'danger') : ''}</td>
        <td class="small">${esc(u.parent_name || '—')}</td>
        <td class="py-c"><b>${u.clients || 0}</b><div class="small-note" style="margin:0">direct clients</div></td>
        <td><button class="btn sm" onclick="pyCopyAccess(${i})">Copy access</button></td>
        <td class="py-r py-nowrap"><button class="btn sm ghost" title="Edit" onclick="pyUserModal(${i})">✎</button>
          <button class="btn sm ghost" title="Delete" onclick="pyUserDelete(${i})">🗑</button></td></tr>`), 'Nobody on the payout team yet.')),
    `${pySearch('pyUserQ', 'userQ', 'Search name or email…', 220)}<button class="btn" onclick="pyUserExport()">⬇ Export</button>${pyFileButton('⬆ Import', 'pyTeamImport', '.xlsx,.xls,.csv')}<button class="btn ghost" onclick="pyTeamTemplate()">Template</button><button class="btn primary" onclick="pyUserModal(-1)">+ New person</button>`);
}
/* The whole team, whatever the search box holds: every RM, mentor,
   partner and admin with their level, who they report to, their sharing,
   bank and address — one row each, for Excel. */
async function pyUserExport(){
  let all;
  try { all = await pyGet('/users'); } catch(e){ pyToast(e.message, 'err'); return; }
  await pySharingRules();
  const roleName = {ops: 'Ops / RM', partner: 'Partner', mentor: 'Mentor', admin: 'Admin'};
  const rows = (all || []).map(u=>{
    const b = u.bank || {}, a = u.address || {};
    return {'Name': u.name || '', 'Email (BOSS login)': u.email || '', 'Employee / ARN Code': u.code || '',
      'Role': roleName[u.role] || u.role || '', 'Primary Level': 'L' + u.level, 'Level Name': u.level_name || PY_LEVELS[u.level] || '',
      'Additional Levels': (u.extra_levels || []).map(l=>'L' + l).join(', '), 'Reports To': u.parent_name || '',
      'Sharing %': Number(u.sharing_pct) > 0 ? Number(u.sharing_pct) : pyPolicyRate(u.level), 'Direct Clients': u.clients || 0,
      'Status': u.active === 0 ? 'Disabled' : 'Active', 'GST': u.gst || '',
      'Bank Account Holder': b.holder || '', 'Bank Name': b.bankName || '', 'Account Number': b.account || '', 'IFSC': b.ifsc || '', 'Bank Branch': b.branch || '',
      'Street': a.street || '', 'City': a.city || '', 'State': a.state || '', 'Pincode': a.pincode || '', 'Country': a.country || ''};
  });
  pyExport(rows, 'Payout_Team_' + new Date().toISOString().slice(0, 10) + '.xlsx');
}
/* ---- Import the team from a sheet ----
   The same columns Export writes, so a firm can export, fill in and bring
   it back. Each row is a person on the payout team AND a BOSS team member
   with a sign-in account: a new one is emailed their password, the same
   way Team Members does it. A row is matched on its email, so a sheet
   imported twice updates the same people. "Reports To" names someone by
   email or by name, on this sheet or already on the team. */
const PY_TEAM_COLS = {
  name: ['name', 'full name'], email: ['email (boss login)', 'email', 'email id', 'login email'], mobile: ['mobile', 'mobile no', 'phone'],
  code: ['employee / arn code', 'arn code', 'employee code', 'code', 'arn'], role: ['role', 'payout role'], level: ['primary level', 'level'],
  extra: ['additional levels', 'extra levels'], parent: ['reports to', 'manager', 'reporting manager'], sharing: ['sharing %', 'sharing', 'sharing pct'],
  gst: ['gst', 'gst number'], pan: ['pan', 'pan no'], bossRole: ['boss role', 'crm role', 'designation role'],
  holder: ['bank account holder', 'account holder'], bankName: ['bank name', 'bank'], account: ['account number', 'account no'],
  ifsc: ['ifsc', 'ifsc code'], branch: ['bank branch'], street: ['street', 'address'], city: ['city'], state: ['state'], pincode: ['pincode', 'pin code'], country: ['country'],
};
const PY_TEAM_ROLES = {'ops / rm': 'ops', 'ops': 'ops', 'rm': 'ops', 'relationship manager': 'ops', 'mentor': 'mentor', 'partner': 'partner', 'admin': 'admin'};
function pyTeamTemplate(){
  pyExport([
    {'Name': 'Anmol Kumar Jha', 'Email (BOSS login)': 'anmol@example.com', 'Mobile': '9876500001', 'Employee / ARN Code': 'ARN-270604', 'Role': 'Mentor',
      'Primary Level': 'L4', 'Additional Levels': 'L3', 'Reports To': '', 'Sharing %': 40, 'BOSS Role': 'Manager', 'GST': '', 'PAN': '',
      'Bank Account Holder': 'Anmol Kumar Jha', 'Bank Name': 'HDFC Bank', 'Account Number': '50100012345678', 'IFSC': 'HDFC0001234', 'Bank Branch': 'Andheri',
      'Street': '', 'City': 'Mumbai', 'State': 'Maharashtra', 'Pincode': '400001', 'Country': 'India'},
    {'Name': 'Riya Sharma', 'Email (BOSS login)': 'riya@example.com', 'Mobile': '9876500002', 'Employee / ARN Code': 'EMP-014', 'Role': 'Ops / RM',
      'Primary Level': 'L2', 'Additional Levels': '', 'Reports To': 'anmol@example.com', 'Sharing %': 30, 'BOSS Role': 'Executive', 'GST': '', 'PAN': '',
      'Bank Account Holder': '', 'Bank Name': '', 'Account Number': '', 'IFSC': '', 'Bank Branch': '', 'Street': '', 'City': 'Pune', 'State': 'Maharashtra', 'Pincode': '', 'Country': 'India'},
  ], 'Payout_Team_Import_Template.xlsx');
}
function pyTeamRows(table){
  const at = {};
  table.headers.forEach((h, i)=>{ const k = String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
    Object.entries(PY_TEAM_COLS).forEach(([f, names])=>{ if(at[f] === undefined && names.includes(k)) at[f] = i; }); });
  if(at.name === undefined || at.email === undefined) return null;
  return table.rows.map(row=>{
    const o = {};
    Object.keys(PY_TEAM_COLS).forEach(f=>{ o[f] = at[f] === undefined ? '' : String(row[at[f]] == null ? '' : row[at[f]]).trim(); });
    o.email = o.email.toLowerCase();
    return o;
  }).filter(o=>o.name || o.email);
}
const pyLevelNum = v => { const n = Number(String(v || '').replace(/[^\d]/g, '')); return n >= 1 && n <= 7 ? n : 0; };
const pyOwnRate = (rate, level) => PY.s._sharing && rate === pyPolicyRate(level) ? 0 : rate;
async function pyTeamImport(file){
  await pySharingRules();
  let tables, existing;
  try { tables = (await impReadAllSheets(file)).tables; existing = await pyGet('/users'); }
  catch(e){ pyToast(e.message, 'err'); return; }
  const rows = tables.map(pyTeamRows).filter(Boolean)[0];
  if(!rows) { pyToast('No sheet in that file has both a Name and an Email column. Start from the template.', 'err'); return; }
  const byEmail = {}; existing.forEach(u=>{ byEmail[String(u.email || '').toLowerCase()] = u; });
  const inFile = {};
  rows.forEach(r=>{ if(r.email) inFile[r.email] = r; });
  const findParent = p => { const k = String(p || '').trim().toLowerCase(); if(!k) return null;
    return inFile[k] || byEmail[k] || rows.find(r=>r.name.toLowerCase() === k) || existing.find(u=>String(u.name || '').toLowerCase() === k) || false; };
  const seen = {};
  const plan = rows.map(r=>{
    const problems = [], warn = [];
    if(!r.name) problems.push('no name');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) problems.push('email "' + r.email + '" is not usable');
    if(seen[r.email]) problems.push('this email is on the sheet twice'); seen[r.email] = 1;
    const role = PY_TEAM_ROLES[String(r.role || '').toLowerCase()] || (r.role ? null : 'ops');
    if(!role) problems.push('role "' + r.role + '" is not Ops / RM, Mentor, Partner or Admin');
    const level = r.level ? pyLevelNum(r.level) : 1;
    if(!level) problems.push('level "' + r.level + '" is not 1–7');
    const parent = findParent(r.parent);
    if(parent === false) warn.push('reports to "' + r.parent + '" — nobody by that name or email; left as it is');
    if(parent && String(parent.email || '').toLowerCase() === r.email) problems.push('reports to themselves');
    const member = DB.team.find(t=>!t.deletedAt && String(t.email || '').toLowerCase() === r.email);
    const bossRole = r.bossRole ? roleList().find(x=>roleNorm(x) === roleNorm(r.bossRole)) : '';
    if(r.bossRole && !bossRole) warn.push('BOSS role "' + r.bossRole + '" is not set up — they get ' + defaultRole());
    if(bossRole === ADMIN_ROLE && !isAdmin()) problems.push('only an admin can import a BOSS Admin');
    return {r, role, level, parent: parent || null, parentMissing: parent === false, payout: byEmail[r.email] || null, member, bossRole: bossRole || '', problems, warn, skip: problems.length > 0};
  });
  PY.s._teamPlan = plan;
  const go = plan.filter(p=>!p.skip);
  const newAcc = go.filter(p=>!p.member).length;
  openModal('Import the payout team', `<div class="small-note" style="margin-top:0">${esc(file.name)} — <b>${go.length}</b> to import
      (${go.filter(p=>!p.payout).length} new to the payout team, ${go.filter(p=>p.payout).length} updated)${plan.length - go.length ? ', <b>' + (plan.length - go.length) + '</b> skipped' : ''}.
      <b>${newAcc}</b> new BOSS sign-in account${newAcc === 1 ? '' : 's'} will be created, and each person emailed their password.</div>
    <div class="table-wrap" style="max-height:360px;overflow:auto"><table id="pyTeamPlan"><thead><tr><th>Person</th><th>Role & level</th><th>Reports to</th><th>Payout</th><th>BOSS account</th><th>Check</th></tr></thead><tbody>
    ${plan.map(p=>`<tr><td><b>${esc(p.r.name || '—')}</b><div class="small-note" style="margin:0">${esc(p.r.email)}</div></td>
      <td>${esc(p.role || p.r.role)} · L${p.level || '?'}</td><td>${esc(p.parent ? p.parent.name : '—')}</td>
      <td>${p.skip ? pyBadge('skipped', 'danger') : p.payout ? pyBadge('update', 'info') : pyBadge('new', 'ok')}</td>
      <td>${p.skip ? '' : p.member ? pyBadge('has one', 'muted') : pyBadge('create + email', 'ok')}</td>
      <td class="small-note">${esc(p.problems.concat(p.warn).join('; '))}</td></tr>`).join('')}</tbody></table></div>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="pyTeamGo" ${go.length ? '' : 'disabled'} onclick="pyTeamImportApply()">Import ${go.length} ${go.length === 1 ? 'person' : 'people'}</button>`);
}
async function pyTeamImportApply(){
  const plan = (PY.s._teamPlan || []).filter(p=>!p.skip);
  if(!plan.length) return;
  const btn = document.getElementById('pyTeamGo'); if(btn){ btn.disabled = true; btn.textContent = 'Importing…'; }
  const failed = [];
  const body = p => {
    const r = p.r, cur = p.payout || {};
    const bank = Object.assign({}, cur.bank || {}), address = Object.assign({country: 'India'}, cur.address || {});
    [['holder', 'holder'], ['bankName', 'bankName'], ['account', 'account'], ['ifsc', 'ifsc'], ['branch', 'branch']].forEach(([k, f])=>{ if(r[k]) bank[f] = k === 'ifsc' ? r[k].toUpperCase() : r[k]; });
    ['street', 'city', 'state', 'pincode', 'country'].forEach(k=>{ if(r[k]) address[k] = r[k]; });
    const extra = String(r.extra || '').split(/[,;/ ]+/).map(pyLevelNum).filter(l=>l && l !== p.level);
    return Object.assign({}, cur, {name: r.name, email: r.email, code: r.code || cur.code || '', gst: r.gst || cur.gst || '', pan: r.pan || cur.pan || '',
      role: p.role, level: p.level, extra_levels: r.extra ? extra : (cur.extra_levels || []).filter(l=>l !== p.level),
      sharing_pct: r.sharing !== '' ? pyOwnRate(Number(String(r.sharing).replace('%', '')) || 0, p.level) : (cur.sharing_pct || 0), bank, address});
  };
  // 1. Everyone onto the payout team, then who reports to whom, once all of them exist.
  const ids = {};
  for(const p of plan){
    try {
      const b = body(p);
      b.parent_id = p.parentMissing ? ((p.payout || {}).parent_id || null)
        : !p.parent ? null
        : (p.parent.id && !inPlan(p.parent.email)) ? p.parent.id
        : ((p.payout || {}).parent_id || null);   // someone on this sheet: set below, once they exist
      const u = p.payout ? await pyPut('/users/' + p.payout.id, b) : await pyPost('/users', b);
      ids[p.r.email] = u.id;
    } catch(e){ failed.push(p.r.name + ': ' + e.message); }
  }
  function inPlan(email){ return plan.some(q=>q.r.email === String(email || '').toLowerCase()); }
  for(const p of plan){
    if(!p.parent || !ids[p.r.email] || !inPlan(p.parent.email)) continue;
    const pid = ids[String(p.parent.email).toLowerCase()];
    if(pid) try { await pyPut('/users/' + ids[p.r.email], {parent_id: pid}); } catch(e){ failed.push(p.r.name + ' (reports to): ' + e.message); }
  }
  // 2. A BOSS team member and a sign-in account for each.
  const made = [];
  for(const p of plan){
    if(!ids[p.r.email]) continue;
    let m = p.member;
    if(!m){
      const role = p.bossRole || defaultRole();
      const access = roleTemplateAccess(role);
      m = {id: uid('USR'), name: p.r.name, email: p.r.email, mobile: String(p.r.mobile || '').replace(/\D/g, '').slice(-10), role, status: 'Active',
        scope: (access && access.scope) || 'own', branch: (DB.config.branches || [])[0] || '', departments: [], managerIds: [],
        perms: access ? access.perms : fullPerms(false, {view: 1}), adminFlags: access ? access.adminFlags : fullAdminFlags(false),
        employeeId: nextEmployeeId(), designation: p.role === 'mentor' ? 'Mentor' : p.role === 'ops' ? 'Relationship Manager' : '',
        joinedAt: new Date().toISOString(), createdAt: new Date().toISOString(), createdBy: currentUser, documents: [], notes: [], parentUserId: currentUser};
      if(access && access.pagePerms) m.pagePerms = access.pagePerms;
      if(access && access.stagePerms) m.stagePerms = access.stagePerms;
      DB.team.push(m);
      made.push(m);
      await logAudit('Team', m.id, 'Profile Created', [{field: 'Name', oldValue: '', newValue: m.name}, {field: 'From', oldValue: '', newValue: 'Payout team import'}]);
    } else if(p.bossRole && m.role !== p.bossRole){ m.role = p.bossRole; }
    p._member = m;
  }
  // Their reporting line in BOSS follows the sheet too, where that manager is in BOSS.
  plan.forEach(p=>{
    if(!p._member || !p.parent) return;
    const boss = DB.team.find(t=>!t.deletedAt && String(t.email || '').toLowerCase() === String(p.parent.email || '').toLowerCase());
    if(boss && boss.id !== p._member.id){ setUserManagers(p._member, [boss.id]); p._member.parentUserId = boss.id; }
  });
  await save('team');
  let mailed = 0, notMailed = 0, accounts = 0;
  for(const p of plan){
    if(!p._member) continue;
    const a = await provisionMemberAccount(p._member);
    if(a && a.created){ accounts++; if(a.mail && a.mail.sent) mailed++; else notMailed++; }
    else if(a && a.ok === false && !a.skipped) failed.push(p.r.name + ' (sign-in): ' + (a.message || ''));
  }
  closeModal();
  pyInvalidate(); render();
  alert('Imported ' + Object.keys(ids).length + ' of ' + plan.length + ' to the payout team.\n'
    + made.length + ' new BOSS team member(s); ' + accounts + ' sign-in account(s) created'
    + (accounts ? ' — ' + mailed + ' emailed their password' + (notMailed ? ', ' + notMailed + ' could NOT be emailed (no mail connector) — the password is on their profile' : '') : '') + '.'
    + (failed.length ? '\n\nNot done:\n' + failed.join('\n') : ''));
}
function pyCopyAccess(i){
  const u = PY.rows.users[i]; if(!u) return;
  const text = 'Freedom LifeX — Payouts\nURL: ' + location.origin + '\nSign in with your BOSS account: ' + u.email + '\nThen open Payouts in the menu.';
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(()=>pyToast('Access details copied'), ()=>pyToast(text));
}
function pyUserDelete(i){
  const u = PY.rows.users[i]; if(!u) return;
  pyConfirm('Delete ' + u.name + '?', u.name + ' will be removed from every client hierarchy and their reports move up to their manager. Payouts recalculate.', 'Delete',
    ()=>pyRun(()=>pyDel('/users/' + u.id), 'Person deleted'));
}
/* THE SHARING RULE FOR A LEVEL, as Settings › Sharing has it: L1–L3 take
   their lead rate (25 / 50 / 75 by default), L4 the pool left after the
   top share, L5–L7 their top share. A person whose Sharing % equals the
   rule is saved as 0, "follow the rule", so a later change to the rule
   reaches them, and a person put at more than one level earns each
   level's own rate rather than their primary level's. */
async function pySharingRules(){
  // Read fresh each time: Settings may have changed the rule since.
  try { PY.s._sharing = (await pyGet('/settings/global')).sharing; } catch(e){ PY.s._sharing = null; }
  return PY.s._sharing;
}
function pyPolicyRate(level, sh){
  sh = sh || PY.s._sharing;
  if(!sh) return 0;
  const l = Number(level), top = sh.top || {};
  if(l >= 1 && l <= 3) return Number((sh.rates || {})[l]) || 0;
  if(l === 4) return Math.max(0, 100 - Object.values(top).reduce((a, b)=>a + (Number(b) || 0), 0));
  return Number(top[l]) || 0;
}
function pyPolicyNote(level){
  const l = Number(level), r = pyPolicyRate(l);
  if(!PY.s._sharing) return 'The rule could not be read; leave it at 0 to follow Settings.';
  const what = l <= 3 ? r + '% of the brokerage on their own leads' : l === 4 ? 'the whole pool (' + r + '%) on their own leads' : r + '% top share';
  return 'Rule for L' + l + ' · ' + (PY_LEVELS[l] || '') + ': ' + what + '. Filled in by itself; change it only for a custom rate.';
}
function pyUserSetLevel(v){
  const f = PY.s._user;
  const shown = Number(f._shownLevel || f.level);
  pyUserKeep();
  f.level = Number(v);
  // The rate follows the level unless somebody typed a custom one.
  const cur = Number(f.sharing_pct);
  if(!cur || cur === pyPolicyRate(shown)) f.sharing_pct = pyPolicyRate(f.level);
  pyUserDraw();
}
async function pyUserModal(i){
  let all;
  try { all = await pyGet('/users'); } catch(e){ pyToast(e.message, 'err'); return; }
  await pySharingRules();
  const u = i >= 0 ? PY.rows.users[i] : {};
  const f = PY.s._user = Object.assign({name: '', email: '', code: '', gst: '', parent_id: '', sharing_pct: 0, role: 'ops', level: 1, extra_levels: []}, u,
    {bank: Object.assign({}, u.bank || {}), address: Object.assign({country: 'India'}, u.address || {}), extra_levels: (u.extra_levels || []).slice()});
  PY.s._userAll = all.filter(x=>x.id !== u.id);
  if(!Number(f.sharing_pct)) f.sharing_pct = pyPolicyRate(f.level);
  pyUserDraw();
}
function pyUserDraw(){
  const f = PY.s._user;
  f._shownLevel = Number(f.level);
  const inp = (k, ph, o, attrs) => pyInput('pyU_' + (o ? o + '_' : '') + k, o ? f[o][k] : f[k], `placeholder="${esc(ph || '')}" ${attrs || ''}`);
  openModal(f.id ? 'Edit person' : 'Add person to the payout team', `
    <div class="section-title">Basic information</div>
    ${pyField('Full name', inp('name', 'John Mathew'))}
    ${pyField('Email (their BOSS login)', inp('email', 'john@freedomlifex.com'), 'They sign in to BOSS with this email and see their own clients and earnings.')}
    <div class="field-grid">${pyField('Employee / ARN code', inp('code', 'WF-001'))}${pyField('GST number (optional)', inp('gst', '22AAAAA0000A1Z5'))}</div>
    <div class="section-title">Hierarchy and sharing</div>
    <div class="field-grid">
      ${pyField('Reports to', pySelect('pyU_parent_id', f.parent_id || '', [['', '— Nobody (top) —']].concat(PY.s._userAll.map(x=>[x.id, x.name + ' · L' + x.level])), ''))}
      ${pyField('Sharing % rate', inp('sharing_pct', '', '', 'type="number" step="0.01"'), pyPolicyNote(f.level))}
      ${pyField('Role', pySelect('pyU_role', f.role, [['ops', 'Ops / RM — own data'], ['partner', 'Partner — own data'], ['mentor', 'Mentor — own data + direct reports'], ['admin', 'Admin — full access']], ''),
        'A mentor sees their own data and that of everyone who reports to them directly.')}
      ${pyField('Primary level', pySelect('pyU_level', f.level, [1, 2, 3, 4, 5, 6, 7].map(l=>[l, 'Level ' + l + ' · ' + PY_LEVELS[l]]), "pyUserSetLevel(this.value)"))}
    </div>
    <div class="card py-sub">
      <b>Additional levels (multi-role)</b>
      <div class="small-note">Tick every level this person can be put at in a client's hierarchy. On each client they earn that level's share. The primary level is always allowed.</div>
      <div class="row py-wrap" style="gap:6px">${[1, 2, 3, 4, 5, 6, 7].map(l=>{
        const on = l === Number(f.level) || f.extra_levels.indexOf(l) >= 0;
        return `<button type="button" class="btn sm ${on ? 'primary' : ''}" ${l === Number(f.level) ? 'disabled' : ''} onclick="pyUserKeep(); pyUserLevel(${l})">L${l}${l === Number(f.level) ? '★' : ''}</button>`;
      }).join('')}</div>
    </div>
    <div class="section-title">Bank details</div>
    ${pyField('Account holder name', inp('holder', 'Same as full name', 'bank'))}
    <div class="field-grid">${pyField('Bank name', inp('bankName', 'HDFC Bank', 'bank'))}${pyField('Branch', inp('branch', 'Main branch', 'bank'))}
      ${pyField('Account number', inp('account', '00018239…', 'bank'))}${pyField('IFSC code', inp('ifsc', 'HDFC0000001', 'bank', 'style="text-transform:uppercase"'))}</div>
    <div class="section-title">Office address</div>
    ${pyField('Street / building', inp('street', 'Plot No 4, Skyline', 'address'))}
    <div class="field-grid">${pyField('City', inp('city', 'Mumbai', 'address'))}${pyField('State', inp('state', 'Maharashtra', 'address'), 'Decides CGST + SGST (same state as the firm) or IGST on invoices.')}
      ${pyField('Pincode', inp('pincode', '400001', 'address'))}${pyField('Country', inp('country', '', 'address'))}</div>`,
    `<span class="small-note" style="flex:1;margin:0">Changed the sharing %? <b>Save & recalculate</b> applies it to every payout. <b>Save</b> alone stores it without recomputing past payouts.</span>
     <button class="btn" onclick="closeModal()">Cancel</button>
     <button class="btn" onclick="pyUserSave(false)">Save</button>
     <button class="btn primary" onclick="pyUserSave(true)">Save & recalculate</button>`, {wide: true});
}
/* Reads the open form back into PY.s._user, so a redraw keeps what was typed. */
function pyUserKeep(){
  const f = PY.s._user;
  ['name', 'email', 'code', 'gst', 'sharing_pct'].forEach(k=>{ if(document.getElementById('pyU_' + k)) f[k] = pyVal('pyU_' + k); });
  ['parent_id', 'role', 'level'].forEach(k=>{ if(document.getElementById('pyU_' + k)) f[k] = pyVal('pyU_' + k); });
  f.level = Number(f.level);
  ['holder', 'bankName', 'branch', 'account', 'ifsc'].forEach(k=>{ if(document.getElementById('pyU_bank_' + k)) f.bank[k] = pyVal('pyU_bank_' + k); });
  f.bank.ifsc = String(f.bank.ifsc || '').toUpperCase();
  ['street', 'city', 'state', 'pincode', 'country'].forEach(k=>{ if(document.getElementById('pyU_address_' + k)) f.address[k] = pyVal('pyU_address_' + k); });
}
function pyUserLevel(l){
  const f = PY.s._user;
  f.extra_levels = f.extra_levels.indexOf(l) >= 0 ? f.extra_levels.filter(x=>x !== l) : f.extra_levels.concat([l]);
  pyUserDraw();
}
async function pyUserSave(recalculate){
  pyUserKeep();
  const f = PY.s._user;
  const rate = Number(f.sharing_pct) || 0;
  const body = Object.assign({}, f, {recalculate, parent_id: f.parent_id || null, extra_levels: f.extra_levels.filter(l=>l !== f.level),
    sharing_pct: PY.s._sharing && rate === pyPolicyRate(f.level) ? 0 : rate});
  delete body._shownLevel;
  const ok = await pyRun(()=>f.id ? pyPut('/users/' + f.id, body) : pyPost('/users', body), recalculate ? 'Saved and payouts recalculated' : 'Saved');
  if(ok) closeModal();
}

/* ---- Clients ---- */
function pyClientList(admin){
  const filter = PY.s.clientFilter || 'all';
  const page = PY.s.clientQPage || 1;
  const url = filter === 'orphan' ? '/clients/orphan-folios' : '/clients' + pyQs({q: PY.s.clientQ, filter, page});
  const d = pyData(url);
  const counts = (pyData('/clients?size=1') || {}).counts || {};
  const pills = [['all', 'All clients', counts.all], ['noRM', 'No RM', counts.noRM], ['noBM', 'No BM', counts.noBM], ['noFolios', 'No folios', counts.noFolios], ['orphan', 'Folios with no client', counts.orphanFolios]];
  PY.rows.clients = d && d.rows ? d.rows : [];
  PY.s.clientChecked = PY.s.clientChecked || {};
  const head = `<div class="between py-wrap" style="gap:8px;margin-bottom:10px">${pySearch('pyClientQ', 'clientQ', 'Search name, PAN, folio…', 300)}
      <div class="row" style="gap:8px"><button class="btn" onclick="pyClientExport()">⬇ Export</button>
        ${admin ? `<button class="btn primary" onclick="pyClientModal(-1)">+ Add client</button>` : ''}</div></div>
    <div class="pill-tabs" style="margin-bottom:10px">${pills.map(p=>`<button class="${filter === p[0] ? 'active' : ''}" onclick="PY.s.clientFilter='${p[0]}'; PY.s.clientQPage=1; render()">${p[1]} <span class="py-count">${p[2] === undefined ? '?' : p[2]}</span></button>`).join('')}</div>`;
  if(!d) return pyCard('', head + pyLoadingHtml(url));
  if(filter === 'orphan') return pyCard('', head + pyTable([{t: 'Folio'}, {t: 'Investor on statement'}, {t: 'PAN'}, {t: 'Txns', r: 1}, {t: 'Gross', r: 1}],
    d.map(f=>`<tr><td class="py-mono">${esc(f.folio)}</td><td>${f.investor ? esc(f.investor) : '<i class="py-muted">unknown</i>'}</td><td class="py-mono small">${esc(f.pan || '—')}</td>
      <td class="py-r">${f.txns}</td><td class="py-r"><b class="py-warn">${esc(pyInr(f.gross))}</b></td></tr>`), 'Every folio with brokerage belongs to a client.'));
  const allOn = d.rows.length && d.rows.every(r=>PY.s.clientChecked[r.id]);
  return pyCard('', head + pyTable([{html: `<input type="checkbox" ${allOn ? 'checked' : ''} onchange="PY.rows.clients.forEach(r=>PY.s.clientChecked[r.id]=this.checked); render()">`},
      {t: 'Investor'}, {t: 'PAN / folios'}, {t: 'AUM', r: 1}, {t: 'Assigned manager'}, {t: '', r: 1}],
    d.rows.map((x, i)=>`<tr><td><input type="checkbox" ${PY.s.clientChecked[x.id] ? 'checked' : ''} onchange="PY.s.clientChecked[${x.id}]=this.checked"></td>
      <td><b>${esc(x.name)}</b><div class="small-note py-mono" style="margin:0">${esc(x.pan || 'NO PAN')}</div></td>
      <td><div class="small py-ellipsis" style="max-width:260px">${esc(x.folios.join(', ') || '—')}</div><div class="small-note" style="margin:0">${x.folios.length} linked folio(s)</div></td>
      <td class="py-r"><b class="py-pos">${esc(pyInrShort(x.aum))}</b><div class="small-note" style="margin:0">${x.aumPeriod ? 'latest · ' + esc(x.aumPeriod) : ''}</div></td>
      <td>${x.owner ? `<b>${esc(x.owner.name)}</b><div class="small-note" style="margin:0">Level ${x.owner.level}</div>` : pyBadge('Unmapped', 'warn')}
        ${x.leadBy ? `<div class="small-note" style="margin:0">lead passed down</div>` : ''}</td>
      <td class="py-r py-nowrap">${admin ? `<button class="btn sm" onclick="pyMapModal(${i})">Map account</button>
        <button class="btn sm ghost" title="Edit" onclick="pyClientModal(${i})">✎</button>
        <button class="btn sm ghost" title="Delete" onclick="pyClientDelete(${i})">🗑</button>` : ''}</td></tr>`),
    'No clients found. Import transaction or folio files, or add a client.') + pyPager('clientQPage', d.total, 50));
}
async function pyClientExport(){
  try {
    const f = PY.s.clientFilter === 'orphan' ? 'all' : (PY.s.clientFilter || 'all');
    const r = await pyGet('/clients' + pyQs({q: PY.s.clientQ, filter: f, all: 1}));
    pyExport(r.rows.map(x=>({Name: x.name, PAN: x.pan, Email: x.email, Mobile: x.mobile, Folios: x.folios.join(', '), AUM: x.aum,
      'Assigned Manager': (x.owner && x.owner.name) || '', Level: (x.owner && x.owner.level) || ''})), 'payout-clients.xlsx');
  } catch(e){ pyToast(e.message, 'err'); }
}
function pyClientDelete(i){
  const c = PY.rows.clients[i]; if(!c) return;
  pyConfirm('Delete ' + c.name + '?', c.name + ' will be removed. Their brokerage stays as unmapped (company retention) until it is mapped again.', 'Delete',
    ()=>pyRun(()=>pyDel('/clients/' + c.id), 'Client deleted'));
}
function pyClientModal(i){
  const c = i >= 0 ? PY.rows.clients[i] : {};
  PY.s._client = c;
  openModal(c.id ? 'Edit investor' : 'New investor', `
    ${pyField('Investor name', pyInput('pyC_name', c.name))}
    ${pyField('PAN', pyInput('pyC_pan', c.pan, 'placeholder="ABCDE1234F" style="text-transform:uppercase"'))}
    <div class="field-grid">${pyField('Email', pyInput('pyC_email', c.email, 'placeholder="client@example.com"'))}${pyField('Mobile', pyInput('pyC_mobile', c.mobile, 'placeholder="+91 98765 43210"'))}</div>
    ${pyField('Linked folios (comma separated)', `<textarea id="pyC_folios" rows="3" class="py-mono" placeholder="11366282/49, 45966856/64">${esc((c.folios || []).join(', '))}</textarea>`)}`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="pyClientSave()">Save</button>`);
}
async function pyClientSave(){
  const c = PY.s._client;
  const body = {name: pyVal('pyC_name'), pan: pyVal('pyC_pan').toUpperCase(), email: pyVal('pyC_email'), mobile: pyVal('pyC_mobile'), folios: pyVal('pyC_folios')};
  const ok = await pyRun(()=>c.id ? pyPut('/clients/' + c.id, body) : pyPost('/clients', body), 'Client saved');
  if(ok) closeModal();
}

/* ---- Map account: who earns on this client ---- */
async function pyMapModal(i){
  const c = PY.rows.clients[i]; if(!c) return;
  let users;
  try { users = await pyGet('/users'); } catch(e){ pyToast(e.message, 'err'); return; }
  const h = Object.assign({}, c.hierarchy || {});
  const lowest = Object.keys(h).filter(l=>h[l]).map(Number).sort((a, b)=>a - b)[0];
  PY.s._map = {client: c, users, mode: 'rm', rmId: lowest ? String(h[lowest]) : '', h, leadBy: c.leadBy ? String(c.leadBy) : '',
    correcting: false, reason: '', resplitPast: false};
  pyMapDraw();
}
function pyMapKeep(){
  const m = PY.s._map;
  if(document.getElementById('pyMapRm')) m.rmId = pyVal('pyMapRm');
  if(document.getElementById('pyMapLead')) m.leadBy = pyVal('pyMapLead');
  if(document.getElementById('pyMapReason')) m.reason = pyVal('pyMapReason');
  if(document.getElementById('pyMapResplit')) m.resplitPast = pyChecked('pyMapResplit');
  [1, 2, 3, 4, 5, 6, 7].forEach(l=>{ if(document.getElementById('pyMapL' + l)) m.h[l] = pyVal('pyMapL' + l) || null; });
}
function pyMapDraw(){
  const m = PY.s._map, c = m.client, users = m.users;
  const leadFixed = !!c.leadBy && !m.correcting;
  const team = boss => users.filter(u=>Number(u.parent_id) === Number(boss));
  const rmChoices = m.leadBy ? team(m.leadBy) : users;
  if(m.leadBy && m.rmId && !rmChoices.some(u=>String(u.id) === String(m.rmId))) m.rmId = '';
  const eligible = l => users.filter(u=>u.level === l || (u.extra_levels || []).indexOf(l) >= 0);
  const lead = users.find(u=>String(u.id) === String(m.leadBy));
  openModal('Map account', `<div><b>${esc(c.name)}</b> <span class="py-mono small-note">${esc(c.pan || '')}</span></div>
    ${pyField('Lead brought by', pySelect('pyMapLead', m.leadBy, [['', '— The RM brought it —']].concat(users.filter(u=>u.level >= 4).map(u=>[u.id, u.name + ' · L' + u.level + ' ' + PY_LEVELS[u.level]])),
        "pyMapKeep(); pyMapDraw()", leadFixed ? 'disabled' : ''),
      leadFixed ? 'The lead source is fixed once saved. An admin can correct a mistake.' : m.correcting
        ? 'Correcting the saved lead source. Re-split is ticked so brokerage already received follows the correction; untick it to change only future brokerage.'
        : 'Leave blank when the RM brought the lead. Pick the L4+ who brought it to pass it down: they get the lead fee first, and only their direct reports can be the RM.')}
    ${leadFixed ? `<button class="btn sm" onclick="pyMapKeep(); PY.s._map.correcting=true; PY.s._map.resplitPast=true; pyMapDraw()">✎ Correct lead source</button>` : ''}
    ${m.correcting ? pyField('Reason for the correction', pyInput('pyMapReason', m.reason, 'placeholder="e.g. Entered Anmol by mistake, lead came through Priya"'), 'Saved in the Audit Log with the old and new lead source.') : ''}
    <div class="pill-tabs" style="margin:10px 0">${[['rm', 'Assign RM (standard hierarchy)'], ['levels', 'Set each level']].map(o=>
      `<button class="${m.mode === o[0] ? 'active' : ''}" onclick="pyMapKeep(); PY.s._map.mode='${o[0]}'; pyMapDraw()">${o[1]}</button>`).join('')}</div>
    ${m.mode === 'rm'
      ? pyField('Relationship manager', pySelect('pyMapRm', m.rmId, [['', '— Select RM —']].concat(rmChoices.map(u=>[u.id, u.name + ' · L' + u.level + ' ' + PY_LEVELS[u.level]])), ''),
          m.leadBy ? 'Showing only people who report directly to ' + esc(lead ? lead.name : 'the lead') + '.' : 'Their managers are filled in automatically from the reporting line.')
      : `<div class="field-grid">${[1, 2, 3, 4, 5, 6, 7].map(l=>pyField('Level ' + l + ' · ' + PY_LEVELS[l],
          pySelect('pyMapL' + l, m.h[l] || '', [['', '— Nobody —']].concat(eligible(l).map(u=>[u.id, u.name])), ''))).join('')}</div>`}
    <label class="py-check" style="margin-top:10px"><input type="checkbox" id="pyMapResplit" ${m.resplitPast ? 'checked' : ''}> Also re-split brokerage already received (only to correct a wrong mapping)</label>
    <div class="small-note">Normally a new mapping applies only to brokerage imported from now on; earlier payouts stay as they were. Locked months never change.</div>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="pyMapSave()">Save mapping</button>`, {wide: true});
}
async function pyMapSave(){
  pyMapKeep();
  const m = PY.s._map, c = m.client;
  if(m.mode === 'rm' && !m.rmId){ pyToast('Choose an RM', 'err'); return; }
  if(m.correcting && String(m.leadBy || '') !== String(c.leadBy || '') && m.reason.trim().length < 5){ pyToast('Give a reason for correcting the lead source', 'err'); return; }
  const body = Object.assign(m.mode === 'rm' ? {rmId: Number(m.rmId)} : {hierarchy: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(l=>[l, m.h[l] ? Number(m.h[l]) : null]))},
    {leadBy: m.leadBy ? Number(m.leadBy) : null, resplitPast: m.resplitPast}, m.correcting ? {correctLead: true, reason: m.reason} : {});
  const ok = await pyRun(()=>pyPut('/clients/' + c.id + '/map', body), 'Client mapping saved');
  if(ok) closeModal();
}

/* ---- Standardize: duplicates and names ---- */
function pyStandardize(){
  const d = pyData('/clients/duplicates');
  PY.rows.dups = d || [];
  return pyCard('🔎 Duplicate detection', `<div class="small-note" style="margin-top:0">Clients that share a PAN, a mobile or email, or an exact name.</div>
      <div class="py-banner warn"><b>Check the names before merging.</b> A shared PAN is not always a duplicate: a minor invests under the guardian's PAN, so siblings can share one. Merge only when the records are the same person; "Keep as master" folds the others into it for good.</div>
      ${!d ? pyLoadingHtml('/clients/duplicates') : !d.length ? '<div class="empty">No duplicates found.</div>' : d.map((g, gi)=>`<div class="py-dup">
        <div class="between"><div><div class="small-note py-warn" style="margin:0;text-transform:uppercase">Possible duplicate — matched by ${esc(g.by)}</div><b>${esc(g.key)}</b></div>
          ${pyBadge(g.records.length + ' records', 'warn')}</div>
        <div class="py-grid2">${g.records.map((r, ri)=>`<div class="card py-sub"><b>${esc(r.name)}</b>
          <div class="row py-wrap" style="gap:6px;margin:6px 0">${pyBadge(r.pan || '—', 'muted')}${r.mobile ? pyBadge(r.mobile, 'muted') : ''}${r.email ? pyBadge(r.email, 'muted') : ''}${pyBadge(r.folios + ' folios', 'info')}</div>
          <button class="btn primary sm" onclick="pyMerge(${gi}, ${ri})">Keep as master</button></div>`).join('')}</div></div>`).join('')}`)
    + `<div class="py-grid2">${pyNameTable('amc', 'AMC name standardization', ['Original name', 'Mapped standard'])}${pyNameTable('scheme', 'Scheme standardization', ['Extracted name', 'Standard name'])}</div>`;
}
function pyMerge(gi, ri){
  const g = PY.rows.dups[gi], master = g && g.records[ri]; if(!master) return;
  pyConfirm('Merge into ' + master.name + '?', (g.records.length - 1) + ' other record(s) will be folded into this one permanently.', 'Merge',
    ()=>pyRun(()=>pyPost('/clients/merge', {masterId: master.id, otherIds: g.records.filter(r=>r.id !== master.id).map(r=>r.id)}), 'Records merged into master'));
}
function pyNameTable(kind, title, cols){
  const qk = 'name' + kind + 'Q', pk = qk + 'Page';
  const url = '/clients/names/' + kind + pyQs({page: PY.s[pk] || 1, q: PY.s[qk]});
  const d = pyData(url);
  PY.rows['names_' + kind] = d ? d.rows : [];
  const ed = PY.s._nameEdit;
  return pyCard(esc(title), !d ? pyLoadingHtml(url) : pyTable([{t: cols[0]}, {t: cols[1]}],
      d.rows.map((r, i)=>`<tr><td class="small py-muted">${esc(r.original)}</td><td>${ed && ed.kind === kind && ed.original === r.original
        ? `<div class="row" style="gap:6px"><input id="pyNameEd" value="${esc(ed.standard)}" onkeydown="if(event.key==='Enter') pyNameSave()" style="flex:1"><button class="btn sm primary" onclick="pyNameSave()">Save</button></div>`
        : `<a href="javascript:void 0" onclick="PY.s._nameEdit=Object.assign({kind:'${kind}'}, PY.rows.names_${kind}[${i}]); render(); setTimeout(()=>{const e=document.getElementById('pyNameEd'); e&&e.focus()})"><b>${esc(r.standard)}</b></a>`}</td></tr>`),
      'Names appear here after the first import.', {scroll: 1, max: 320}) + pyPager(pk, d.total, 50),
    pySearch('pyName' + kind, qk, 'Filter…', 160));
}
async function pyNameSave(){
  const ed = PY.s._nameEdit;
  const ok = await pyRun(()=>pyPut('/clients/names/' + ed.kind, {original: ed.original, standard: pyVal('pyNameEd')}), 'Standard name updated');
  if(ok !== undefined) PY.s._nameEdit = null;
  render();
}

/* =====================================================================
   REPORTS & PAYOUTS — settlements, invoices, growth, reconciliation
   ===================================================================== */
function pyF(){ return {year: PY.s.repYear || String(new Date().getFullYear()), month: PY.s.repMonth || 'all'}; }
function viewPyReports(){
  const admin = pyAdmin();
  const tabs = [['summary', 'Summary'], ['monthly', 'Monthly payouts'], ['client', 'Client-wise'], ['logs', 'Logs'], ['team', 'Team payouts'], ['growth', 'Growth']]
    .concat(admin ? [['approvals', 'Approvals queue'], ['recon', 'Reconciliation']] : []);
  let tab = pyTab('repTab', 'summary');
  if(!tabs.some(t=>t[0] === tab)) tab = 'summary';
  const body = {summary: pyRepSummary, monthly: pyRepMonthly, client: pyRepClientWise, logs: pyRepLogs, team: pyRepTeam,
    growth: pyRepGrowth, approvals: pyRepApprovals, recon: pyRepRecon}[tab];
  return pyHead('Brokerage Settlements', 'Payouts by month, invoices, approvals and reconciliation.',
      `${pyYearMonth('rep')}<button class="btn" onclick="navigate('pyledger')">🏦 Payouts ledger</button>`)
    + pyTabs('repTab', tabs, 'summary') + body(pyF(), admin);
}
/* The invoice is an HTML page from the server, behind the API key, so it is
   fetched here and opened from memory rather than by link. */
async function pyOpenInvoice(period, userId){
  const w = window.open('', '_blank');
  try {
    const html = await pyApi('GET', '/reports/invoice' + pyQs({period, userId}));
    const url = URL.createObjectURL(new Blob([html], {type: 'text/html'}));
    if(w) w.location = url; else window.location = url;
  } catch(e){ if(w) w.close(); pyToast(e.message, 'err'); }
}
function pyRepSummary(f){
  const url = '/reports/summary' + pyQs(f), d = pyData(url);
  if(!d) return pyLoadingHtml(url);
  return pyStats([{label: 'System gross', value: pyInr(d.gross)}, {label: 'My net payout', value: pyInr(d.myNet), tone: 'ok'},
      {label: 'Transactions', value: Number(d.transactions).toLocaleString('en-IN')}])
    + pyCard('Month-wise gross', pyTable([{t: 'Month'}, {t: 'Volume', c: 1}, {t: 'Gross brokerage', r: 1}, {t: 'Payout pool', r: 1}],
      d.months.map(m=>`<tr><td><b>${esc(pyPeriodLabel(m.period))}</b></td><td class="py-c">${Number(m.volume).toLocaleString('en-IN')}</td>
        <td class="py-r"><b>${esc(pyInr(m.gross))}</b></td><td class="py-r">${esc(pyInr(m.pool))}</td></tr>`), 'No brokerage for this period.'));
}
function pyRepMonthly(f, admin){
  const userId = PY.s.monUser || '';
  const url = '/reports/monthly' + pyQs(Object.assign({}, f, {userId})), d = pyData(url);
  // A mentor may look at the people who report to them; the server lists only those.
  const pick = admin || pyMentor();
  const users = pick ? pyData('/users') : [];
  if(!d) return pyLoadingHtml(url);
  PY.s._invoice = d.invoice;
  const inv = d.invoice;
  PY.rows.monthly = d.rows;
  const toggle = (k, label) => `<label class="py-check"><input type="checkbox" ${inv[k] ? 'checked' : ''} ${admin ? '' : 'disabled'} onchange="pySetTax({${k}: this.checked})"> <b>${label}</b></label>`;
  return pyCard('Tax settings for invoices', `<div class="row py-wrap" style="gap:14px;align-items:center">
        ${toggle('gstEnabled', 'GST')}${inv.gstEnabled ? `<span class="row" style="gap:4px">${pyInput('pyGstPct', inv.gstPct, `type="number" class="py-pct" ${admin ? '' : 'disabled'} onchange="pySetTax({gstPct: Number(this.value)})"`)} %</span><span class="small-note" style="margin:0">GST is added on the invoice</span>` : ''}
        ${toggle('tdsEnabled', 'TDS deduction')}<span class="row" style="gap:4px">${pyInput('pyTdsPct', inv.tdsPct, `type="number" class="py-pct" ${admin ? '' : 'disabled'} onchange="pySetTax({tdsPct: Number(this.value)})"`)} %</span>
        ${inv.tdsEnabled ? '<span class="small-note" style="margin:0">TDS comes off the net payable</span>' : ''}
        ${pick ? `<span style="margin-left:auto">${pySelect('pyMonUser', userId, [['', 'My own payouts']].concat((users || []).filter(u=>!PY.me || u.id !== PY.me.id).map(u=>[u.id, u.name])), "PY.s.monUser=this.value; render()")}</span>` : ''}</div>`)
    + pyCard(esc(d.user.name), pyTable([{t: 'Settlement period'}, {t: 'Txns', c: 1}, {t: 'My share', r: 1}]
        .concat(inv.gstEnabled ? [{t: 'GST ' + inv.gstPct + '%', r: 1}] : []).concat(inv.tdsEnabled ? [{t: 'TDS ' + inv.tdsPct + '%', r: 1}] : [])
        .concat([{t: 'Net payable', r: 1}, {t: '', r: 1}]),
      d.rows.map(r=>`<tr><td><b>${esc(pyPeriodLabel(r.period))}</b></td><td class="py-c">${r.txs}</td><td class="py-r">${esc(pyInr(r.share))}</td>
        ${inv.gstEnabled ? `<td class="py-r">+${esc(pyInr(r.gst))}</td>` : ''}${inv.tdsEnabled ? `<td class="py-r py-warn">−${esc(pyInr(r.tds))}</td>` : ''}
        <td class="py-r"><b>${esc(pyInr(r.net))}</b></td>
        <td class="py-r py-nowrap"><button class="btn sm" onclick="pyOpenInvoice('${esc(r.period)}', '${esc(String(userId))}')">⬇ Invoice</button>
          ${r.status ? pyBadge(r.status, r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'danger' : 'warn')
            : `<button class="btn sm primary" onclick="pyRun(()=>pyPost('/reports/settlements', {period: '${esc(r.period)}', userId: '${esc(String(userId))}'}), 'Sent for approval')">Request settlement</button>`}</td></tr>`),
      'No payouts yet. They appear once brokerage is imported and clients are mapped to this person.'),
      `<button class="btn sm" onclick="pyMonthlyExport()">⬇ Export</button>`);
}
function pySetTax(patch){ pyRun(()=>pyPut('/reports/invoice-settings', Object.assign({}, PY.s._invoice, patch))); }
function pyMonthlyExport(){
  pyExport(PY.rows.monthly.map(r=>({Period: r.period, Transactions: r.txs, 'My Share': r.share, GST: r.gst, TDS: r.tds, 'Net Payable': r.net, Status: r.status || ''})), 'monthly-payouts.xlsx');
}
function pyRepClientWise(f){
  const url = '/reports/client-wise' + pyQs(f), d = pyData(url);
  if(!d) return pyLoadingHtml(url);
  const q = (PY.s.cwQ || '').toLowerCase();
  const rows = PY.rows.clientWise = d.rows.filter(r=>!q || r.name.toLowerCase().indexOf(q) >= 0 || (r.pan || '').toLowerCase().indexOf(q) >= 0);
  return pyCard('Investor breakdown ' + pyBadge(rows.length + ' investors', 'info'), pyTable([{t: 'Investor'}, {t: 'PAN'}, {t: 'Txns', c: 1}, {t: 'AUM', r: 1}, {t: 'Total brokerage', r: 1}],
      rows.map(r=>`<tr><td><b>${esc(r.name)}</b></td><td class="py-mono small">${esc(r.pan || '—')}</td><td class="py-c">${r.txs}</td>
        <td class="py-r"><b class="py-pos">${esc(pyInrShort(r.aum))}</b><div class="small-note" style="margin:0">${esc(d.aumPeriod || '')}</div></td><td class="py-r"><b>${esc(pyInr(r.gross))}</b></td></tr>`),
      'No brokerage for this period.', {scroll: 1, max: 640}),
    `${pySearch('pyCwQ', 'cwQ', 'Search investor or PAN…', 210)}<button class="btn sm" onclick="pyExport(PY.rows.clientWise.map(r=>({Investor: r.name, PAN: r.pan, Txs: r.txs, AUM: r.aum, 'Total Brokerage': r.gross})), 'client-wise.xlsx')">⬇ Export</button>`);
}
function pyRepLogs(f){
  const page = PY.s.logPage || 1;
  const url = '/reports/logs' + pyQs(Object.assign({}, f, {page})), d = pyData(url);
  if(!d) return pyLoadingHtml(url);
  PY.rows.logs = d.rows;
  return pyCard('Transaction log', pyTable([{t: 'Date'}, {t: 'Investor / scheme'}, {t: 'Gross', r: 1}, {t: 'My rate', c: 1}, {t: 'My share', r: 1}],
      d.rows.map(r=>`<tr><td class="small py-muted py-nowrap">${esc(r.date || '')}</td><td><b class="small">${esc(r.investor || '')}</b><div class="small-note" style="margin:0">${esc(r.scheme || '')}</div></td>
        <td class="py-r small">${esc(pyInr(r.gross, 3))}</td><td class="py-c">${r.myRate !== null && r.myRate !== undefined ? esc(pyPct(r.myRate)) : '—'}</td>
        <td class="py-r"><b class="py-pos">${esc(pyInr(r.myShare))}</b></td></tr>`), 'No transactions.', {scroll: 1, max: 640})
    + `<div class="between py-pager"><span class="small-note" style="margin:0">Page ${page}</span><div class="row" style="gap:4px">
        <button class="btn sm" ${page === 1 ? 'disabled' : ''} onclick="PY.s.logPage=${page - 1}; render()">‹ Prev</button>
        <button class="btn sm" ${d.rows.length < 200 ? 'disabled' : ''} onclick="PY.s.logPage=${page + 1}; render()">Next ›</button></div></div>`,
    `<button class="btn sm" onclick="pyExport(PY.rows.logs.map(r=>({Date: r.date, Investor: r.investor, Scheme: r.scheme, Gross: r.gross, 'My Rate %': r.myRate === null ? '' : r.myRate, 'My Share': r.myShare})), 'payout-logs.xlsx')">⬇ Export</button>`);
}
function pyRepTeam(f){
  const url = '/reports/team' + pyQs(f), d = pyData(url);
  if(!d) return pyLoadingHtml(url);
  const q = (PY.s.teamQ || '').toLowerCase();
  const rows = PY.rows.team = d.rows.filter(r=>!q || r.name.toLowerCase().indexOf(q) >= 0);
  return pyCard('System-wide distribution ' + pyBadge(d.label, 'info'), pyTable([{t: 'Person'}, {t: 'Level'}, {t: 'Gross brokerage', r: 1}, {t: 'Their earnings', r: 1}, {t: '% of gross', r: 1}, {t: 'Status', c: 1}],
      rows.map(r=>`<tr><td><b>${esc(r.name)}</b><div class="small-note" style="margin:0">${esc(r.code || '')}</div></td><td>${esc(r.level_name || '')}<div class="small-note" style="margin:0">Level ${r.level}</div></td>
        <td class="py-r py-muted">${esc(pyInr(r.gross, 3))}</td><td class="py-r"><b>${esc(pyInr(r.earnings))}</b></td><td class="py-r"><b>${esc(pyPct(r.pctOfGross))}</b></td>
        <td class="py-c">${pyBadge(r.status, 'ok')}</td></tr>`), 'Nobody on the team yet.', {scroll: 1, max: 640}),
    `${pySearch('pyTeamQ', 'teamQ', 'Search name…', 200)}<button class="btn sm" onclick="pyExport(PY.rows.team.map(r=>({Name: r.name, Code: r.code, Level: r.level, Role: r.level_name, Gross: r.gross, Earnings: r.earnings, '% of Gross': r.pctOfGross})), 'team-payouts.xlsx')">⬇ Export</button>`);
}
function pyDelta(prev, cur){
  const d = prev ? (cur - prev) / Math.abs(prev) * 100 : null;
  return pyBadge(d === null ? '—' : (d > 0 ? '+' : '') + d.toFixed(1) + '%', d === null || Math.abs(d) < 0.005 ? 'muted' : d > 0 ? 'ok' : 'danger');
}
function pyRepGrowth(f){
  const mode = PY.s.grMode || 'mom';
  const custom = PY.s.grCustom = PY.s.grCustom || {curFrom: '', curTo: '', prevFrom: '', prevTo: ''};
  const url = '/reports/growth' + pyQs(Object.assign({}, f, {mode}, mode === 'custom' ? custom : {})), d = pyData(url);
  const modes = `<div class="pill-tabs">${[['mom', 'Month over month'], ['qoq', 'Quarter over quarter'], ['yoy', 'Year over year'], ['custom', 'Custom']].map(o=>
    `<button class="${mode === o[0] ? 'active' : ''}" onclick="PY.s.grMode='${o[0]}'; render()">${o[1]}</button>`).join('')}</div>`;
  const customRow = mode === 'custom' ? `<div class="row py-wrap" style="gap:10px;margin-top:10px">${[['curFrom', 'Current from'], ['curTo', 'Current to'], ['prevFrom', 'Previous from'], ['prevTo', 'Previous to']].map(k=>
    pyField(k[1], pyInput('pyGr' + k[0], custom[k[0]], `type="month" onchange="PY.s.grCustom.${k[0]}=this.value; render()"`))).join('')}</div>` : '';
  if(!d) return pyCard('Comparison', modes + customRow) + pyLoadingHtml(url);
  const span = r => r[0] === r[1] ? r[0] : r[0] + ' → ' + r[1];
  PY.rows.growth = d.members;
  const metric = (title, sub, k) => `<div class="card"><div class="between"><div><b>${title}</b><div class="small-note" style="margin:0">${sub}</div></div>${pyDelta(d.totals.prev[k], d.totals.cur[k])}</div>
    <div class="py-grid2" style="margin-top:10px"><div><div class="small-note" style="margin:0">Previous</div><b>${esc(pyInr(d.totals.prev[k], 0))}</b></div>
      <div><div class="small-note" style="margin:0">Current</div><b>${esc(pyInr(d.totals.cur[k], 0))}</b></div></div></div>`;
  const pair = (p, c, k) => `<div class="py-r py-nowrap"><span class="py-muted small">${esc(pyInr(p[k], 0))}</span> → <b>${esc(pyInr(c[k], 0))}</b> ${pyDelta(p[k], c[k])}</div>`;
  return pyCard('Comparison', `<div class="small-note" style="margin-top:0">Comparing <b>${esc(span(d.cur))}</b> with <b>${esc(span(d.prev))}</b> (uses the year and month above)</div>` + modes + customRow)
    + (!d.hasData ? `<div class="py-banner warn">No brokerage has been imported for ${esc(span(d.cur))} yet, so there is nothing to compare. This is not a fall to zero.</div>` : '')
    + `<div class="py-grid3">${metric('Average AUM', 'Sum of average assets per transaction', 'avgAum')}${metric('Snapshot AUM', 'Latest value per folio at period end', 'snapAum')}${metric('Brokerage share', 'Actual payout from the sharing engine', 'share')}</div>`
    + pyCard('Per-member growth (' + d.members.length + ')', pyTable([{t: 'Member'}, {t: 'Average AUM', r: 1}, {t: 'Snapshot AUM', r: 1}, {t: 'Brokerage share', r: 1}],
      d.members.map(m=>`<tr><td><b>${esc(m.name)}</b><div class="small-note" style="margin:0">${esc(m.code || '')} · L${m.level}</div>${!m.cur.avgAum && !m.cur.snapAum ? '<div class="small-note py-warn" style="margin:0">⚠ AUM data missing</div>' : ''}</td>
        <td>${pair(m.prev, m.cur, 'avgAum')}</td><td>${pair(m.prev, m.cur, 'snapAum')}</td><td>${pair(m.prev, m.cur, 'share')}</td></tr>`), 'Nobody on the team yet.', {scroll: 1, max: 640}),
      `<button class="btn sm" onclick="pyExport(PY.rows.growth.map(m=>({Member: m.name, Code: m.code, Level: m.level, 'Prev Avg AUM': m.prev.avgAum, 'Curr Avg AUM': m.cur.avgAum, 'Prev Snapshot AUM': m.prev.snapAum, 'Curr Snapshot AUM': m.cur.snapAum, 'Prev Share': m.prev.share, 'Curr Share': m.cur.share})), 'growth-report.xlsx')">⬇ Export growth report</button>`);
}
function pyRepApprovals(){
  const d = pyData('/reports/approvals');
  if(!d) return pyLoadingHtml('/reports/approvals');
  return pyCard('Settlement queue', pyTable([{t: 'Payee'}, {t: 'Period'}, {t: 'Base', r: 1}, {t: 'Net payable', r: 1}, {t: 'Status', c: 1}, {t: '', r: 1}],
    d.map(s=>`<tr><td><b>${esc(s.name)}</b><div class="small-note" style="margin:0">${esc(s.level_name || '')}</div></td><td>${esc(pyPeriodLabel(s.period))}</td>
      <td class="py-r">${esc(pyInr(s.base))}</td><td class="py-r"><b>${esc(pyInr(s.net))}</b><div class="small-note" style="margin:0">${s.gst ? '+GST ' : ''}${s.tds ? '−TDS' : ''}</div></td>
      <td class="py-c">${pyBadge('Pending approval', 'warn')}</td>
      <td class="py-r py-nowrap"><button class="btn sm ghost" title="Invoice" onclick="pyOpenInvoice('${esc(s.period)}', '${s.user_id}')">⬇</button>
        <button class="btn sm primary" onclick="pyRun(()=>pyPost('/reports/approvals/${s.id}/approve'), 'Approved')">Approve</button>
        <button class="btn sm danger" onclick="pyRun(()=>pyPost('/reports/approvals/${s.id}/reject'), 'Rejected')">Reject</button></td></tr>`),
    'Queue is clear. Settlement requests from Monthly payouts land here.'));
}
function pyRepRecon(f){
  const url = '/reports/reconciliation' + pyQs(f), d = pyData(url);
  const users = pyData('/users') || [];
  const ex = PY.s.excResult;
  const exBox = (t, list, fmt) => `<div class="card py-sub"><div class="between"><b class="small-note" style="margin:0;text-transform:uppercase">${t}</b><b class="${list.length ? 'py-warn' : 'py-pos'}">${list.length}</b></div>
    <div class="small-note py-scrollbox" style="max-height:120px">${list.slice(0, 30).map(x=>`<div>${esc(fmt(x))}</div>`).join('') || 'Clear'}</div></div>`;
  return `<div class="between py-wrap" style="gap:10px;margin-bottom:10px"><div><div class="section-title" style="margin:0">Monthly reconciliation</div>
      <div class="small-note" style="margin:0">Per-RM gross and net, plus the unmapped (house) folios, for all periods.</div></div>
      <button class="btn primary" onclick="pyReconExport()">⬇ Download reconciliation (Excel)</button></div>
    ${pyCard('⚠ Exceptions — what the import could not map', `<div class="small-note" style="margin-top:0">Run this straight after an import. It lists every folio, client and RM that still needs a person: brokerage that reaches nobody, clients with no RM, folios two records both claim, and rows whose investor is not the client they landed on. It only reads; nothing is changed.</div>
      <div class="row" style="gap:8px">${pyInput('pyExcPeriod', PY.s.excPeriod || '', 'placeholder="Period e.g. 2026-07 (blank = all)" style="width:250px"')}
        <button class="btn primary" onclick="pyRunExceptions()">Run check</button></div>
      ${ex ? `<div class="py-grid4">${exBox('Brokerage reaching nobody', ex.noOne, x=>x.folio + ' · ' + (x.investor || 'unknown') + ' · ₹' + Number(x.gross).toFixed(2))}
        ${exBox('Clients with no RM', ex.noRM, x=>x.name + ' · ₹' + Number(x.gross).toFixed(2))}
        ${exBox('Folios on two records', ex.shared, x=>x.folio + ': ' + x.clients)}
        ${exBox('Investor ≠ client', ex.mismatched, x=>x.folio + ': "' + x.investor + '" on ' + x.client)}</div>` : ''}`)}
    ${pyCard('Bulk client mapping from Excel', `<div class="small-note" style="margin-top:0">Upload a sheet with <b>Client Name, PAN, RM Name, BM Name</b> and optionally <b>Lead By</b> (the L4+ who brought a lead and passed it to that RM). One row per client, many RMs at once. You see exactly what changes <b>before</b> anything is saved.</div>
      <div class="row py-wrap" style="gap:8px">${pyFileButton('Choose Excel / CSV', 'pyBulkPreview', '.xlsx,.xls,.csv', 'primary')}
        <button class="btn" onclick="pyCurrentMapping()">⬇ Download current mapping</button>
        <button class="btn ghost" onclick="pyExport([{'Client ID': '', 'Client Name': '', PAN: '', 'RM Name': '', 'BM Name': '', 'Lead By': ''}], 'mapping-template.xlsx')">Blank template</button></div>
      <div class="small-note"><b>Recommended:</b> download the current mapping. It has every client with a <b>Client ID</b> and their RM and BM today. Change only the RM / BM columns and upload it back, so a spelling mistake in a client name cannot break the match. RM and BM can be a name or an ARN code; small spelling mistakes are corrected and the preview shows which name it read. If two people share a name it asks for the code instead of guessing.</div>`)}
    ${pyCard('Map RM from a registrar file', `<div class="small-note" style="margin-top:0">Upload an RM's "RM-wise / Investor-wise Brokerage" Excel. Every folio in it is mapped to the selected RM (with their standard hierarchy), then payouts recalculate. Do it per RM after importing the brokerage files.</div>
      <div class="row py-wrap" style="gap:8px">${pySelect('pyRmFileUser', PY.s.rmFileUser || '', [['', '— Select RM —']].concat(users.map(u=>[u.id, u.name + ' · L' + u.level])), "PY.s.rmFileUser=this.value; render()")}
        ${PY.s.rmFileUser ? pyFileButton('⬆ Upload RM file', 'pyRmFileUpload', '.xlsx,.xls,.csv') : '<button class="btn" disabled>⬆ Upload RM file</button>'}</div>`)}
    <div class="py-banner warn"><b>Unmapped transactions.</b> These investor accounts have brokerage but are <b>not mapped to anyone on the team</b>, so all of their brokerage currently goes to company retention. Map them in <a href="javascript:void 0" onclick="PY.s.clientsTab='clients'; navigate('pyclients')">Clients & Map</a> to credit the right RM. Showing ${f.year === 'all' && f.month === 'all' ? 'all periods' : 'the selected period'}.</div>
    ${!d ? pyLoadingHtml(url) : pyStats([{label: 'Unmapped accounts', value: d.accounts, sub: d.txns + ' transactions'}, {label: 'Unattributed gross', value: pyInr(d.gross), tone: 'warn', sub: 'currently goes to company retention'}])
      + pyCard('', pyTable([{t: 'Investor'}, {t: 'PAN'}, {t: 'Folio'}, {t: 'Txns', r: 1}, {t: 'Gross', r: 1}],
        d.rows.map(r=>`<tr><td>${r.investor === 'unknown' ? '<i class="py-muted">unknown</i>' : esc(r.investor)}</td><td class="py-mono small">${esc(r.pan || '—')}</td>
          <td class="py-mono small">${esc(r.folio)}</td><td class="py-r"><b>${r.txns}</b></td><td class="py-r"><b class="py-warn">${esc(pyInr(r.gross))}</b></td></tr>`), 'Everything is mapped.', {scroll: 1, max: 480}))}`;
}
async function pyReconExport(){
  try {
    const r = await pyGet('/reports/reconciliation/export' + pyQs(pyF()));
    pyExport(r.rows.map(x=>({Month: x.period, Person: x.person, Code: x.code || '', Transactions: x.txns, 'Net (₹)': x.net})), 'reconciliation.xlsx');
  } catch(e){ pyToast(e.message, 'err'); }
}
async function pyRunExceptions(){
  PY.s.excPeriod = pyVal('pyExcPeriod').trim();
  try { PY.s.excResult = await pyGet('/reports/exceptions' + pyQs({period: PY.s.excPeriod})); render(); }
  catch(e){ pyToast(e.message, 'err'); }
}
async function pyCurrentMapping(){
  try { pyExport(await pyGet('/reports/bulk-mapping/current'), 'current-mapping.xlsx'); } catch(e){ pyToast(e.message, 'err'); }
}
async function pyBulkPreview(file){
  let p;
  try { p = await pyPost('/reports/bulk-mapping/preview', pyForm(file)); } catch(e){ pyToast(e.message, 'err'); return; }
  PY.s._preview = p;
  openModal('Review mapping changes', pyTable([{t: 'Client'}, {t: 'PAN'}, {t: 'RM read as'}, {t: 'BM read as'}, {t: 'Lead by'}, {t: 'Result'}],
      p.rows.map(r=>`<tr><td><b>${esc(r.client || '')}</b></td><td class="py-mono small">${esc(r.pan || '')}</td>
        <td>${esc(r.rm || '—')}${r.rmCorrected ? ' <span class="small-note py-warn">(spelling corrected)</span>' : ''}</td>
        <td>${esc(r.bm || '—')}${r.bmCorrected ? ' <span class="small-note py-warn">(spelling corrected)</span>' : ''}</td>
        <td>${esc(r.leadByName || '—')}</td>
        <td>${r.errors.length ? `<span class="small py-neg">${esc(r.errors.join('; '))}</span>` : r.changed ? pyBadge('Will change', 'ok') : pyBadge('No change', 'muted')}</td></tr>`),
      'The sheet has no rows.', {scroll: 1, max: 460}),
    `<span class="small-note" style="flex:1;margin:0">${p.ok} change(s) ready · ${p.errors} row(s) need attention</span>
     <button class="btn" onclick="closeModal()">Cancel</button>
     <button class="btn primary" ${p.ok ? '' : 'disabled'} onclick="pyBulkApply()">Apply ${p.ok} change(s)</button>`, {wide: true});
}
async function pyBulkApply(){
  const r = await pyRun(()=>pyPost('/reports/bulk-mapping/apply', {rows: PY.s._preview.rows}), r=>r.applied + ' client(s) re-mapped');
  if(r) closeModal();
}
function pyRmFileUpload(file){
  pyRun(()=>pyPost('/reports/rm-file', pyForm(file, {rmId: PY.s.rmFileUser})), r=>r.clients + ' client(s) mapped, ' + r.recalculated + ' rows recalculated');
}

/* =====================================================================
   PAYOUT SETTINGS — profile, rules, sharing, lead source, system
   ===================================================================== */
function viewPySettings(){
  const admin = pyAdmin();
  const tabs = [['profile', 'Profile']].concat(admin ? [['global', 'Global rules'], ['sharing', 'User sharing'], ['lead', 'Lead source'], ['activity', 'Activity log'], ['system', 'System']] : []);
  let tab = pyTab('setTab', 'profile');
  if(!tabs.some(t=>t[0] === tab)) tab = 'profile';
  const body = {profile: pySetProfile, global: pySetGlobal, sharing: pySetSharing, lead: pySetLead,
    activity: ()=>pyAuditTable(true), system: pySetSystem}[tab];
  return pyHead('Payout Settings', 'Your payout profile, and the rules that decide who earns what.') + pyTabs('setTab', tabs, 'profile') + body();
}

/* ---- Profile: what goes on your invoices ---- */
function pySetProfile(){
  const m = PY.me;
  if(!m || m.error) return m && m.error ? `<div class="card py-error">${esc(m.error)}</div>` : pyLoadingHtml();
  const url = '/users/' + m.id, d = pyData(url);
  if(!d) return pyLoadingHtml(url);
  if(!PY.s._prof || PY.s._profFor !== d){
    PY.s._prof = Object.assign({}, d, {bank: Object.assign({}, d.bank || {}), address: Object.assign({country: 'India'}, d.address || {})});
    PY.s._profFor = d;
  }
  const f = PY.s._prof;
  const inp = (k, ph, o, attrs) => pyInput('pyP_' + (o ? o + '_' : '') + k, o ? f[o][k] : f[k], `placeholder="${esc(ph || '')}" ${attrs || ''}`);
  return `<div class="py-grid2">
      ${pyCard('Personal information', pyField('Display name', inp('name')) + pyField('Account', `<input disabled value="${esc(String(m.role).toUpperCase() + ' — Level ' + f.level + ' (' + PY_LEVELS[f.level] + ')')}">`)
        + `<div class="small-note">You sign in with your BOSS account (${esc(m.email)}). Change your password in BOSS.</div>`)}
      ${pyCard('Bank details', pyField('Account name', inp('holder', f.name, 'bank'))
        + `<div class="field-grid">${pyField('Account number', inp('account', 'XXXXXX1234', 'bank'))}${pyField('IFSC code', inp('ifsc', 'HDFC0001234', 'bank', 'style="text-transform:uppercase"'))}
          ${pyField('Bank name', inp('bankName', 'HDFC Bank', 'bank'))}${pyField('Branch', inp('branch', 'Mumbai Main', 'bank'))}</div>`)}
    </div>
    ${pyCard('Address and contact', pyField('Street address', inp('street', '123, Wealth Street, Business Park', 'address'))
      + `<div class="field-grid">${pyField('City', inp('city', 'Mumbai', 'address'))}${pyField('State', inp('state', 'Maharashtra', 'address'))}
        ${pyField('Pincode', inp('pincode', '400001', 'address'))}${pyField('Country', inp('country', '', 'address'))}</div>`)}
    <div class="py-grid2">
      ${pyCard('SEBI / AMFI registration', `<div class="small-note" style="margin-top:0">ARN expires every 3 years, EUIN every 5. The dashboard warns 30 days before expiry.</div>
        <div class="field-grid">${pyField('ARN number', inp('arn', 'ARN-12345'))}${pyField('ARN valid till', inp('arn_valid', '', '', 'type="date"'))}
          ${pyField('EUIN number', inp('euin', 'E123456'))}${pyField('EUIN valid till', inp('euin_valid', '', '', 'type="date"'))}</div>`)}
      ${pyCard('Invoice details', `<div class="field-grid">${pyField('GSTIN (GST is added only if set)', inp('gst', '27ABCDE1234F1Z5', '', 'style="text-transform:uppercase"'))}
          ${pyField('PAN', inp('pan', 'ABCDE1234F', '', 'style="text-transform:uppercase"'))}</div>
        ${pyField('Signature (placed above "Authorised Signatory")', `<input type="file" accept="image/png,image/jpeg" onchange="pySignature(this.files[0])">
          ${f.signature ? `<img src="${esc(f.signature)}" alt="signature" style="max-height:44px;margin-top:6px">` : ''}`, 'PNG or JPEG, transparent background is best, under 400 KB.')}`)}
    </div>
    <div class="row" style="justify-content:flex-end"><button class="btn primary" onclick="pyProfileSave()">Save profile</button></div>`;
}
function pyProfileKeep(){
  const f = PY.s._prof;
  ['name', 'arn', 'arn_valid', 'euin', 'euin_valid', 'gst', 'pan'].forEach(k=>{ if(document.getElementById('pyP_' + k)) f[k] = pyVal('pyP_' + k); });
  ['holder', 'account', 'ifsc', 'bankName', 'branch'].forEach(k=>{ if(document.getElementById('pyP_bank_' + k)) f.bank[k] = pyVal('pyP_bank_' + k); });
  ['street', 'city', 'state', 'pincode', 'country'].forEach(k=>{ if(document.getElementById('pyP_address_' + k)) f.address[k] = pyVal('pyP_address_' + k); });
  f.gst = String(f.gst || '').toUpperCase(); f.pan = String(f.pan || '').toUpperCase(); f.bank.ifsc = String(f.bank.ifsc || '').toUpperCase();
}
function pySignature(file){
  if(!file) return;
  if(file.size > 400 * 1024){ pyToast('The signature must be under 400 KB', 'err'); return; }
  pyProfileKeep();
  const r = new FileReader();
  r.onload = () => { PY.s._prof.signature = r.result; render(); };
  r.readAsDataURL(file);
}
async function pyProfileSave(){
  pyProfileKeep();
  const f = PY.s._prof;
  const ok = await pyRun(()=>pyPut('/users/' + f.id, {name: f.name, bank: f.bank, address: f.address, gst: f.gst, pan: f.pan, arn: f.arn, arn_valid: f.arn_valid,
    euin: f.euin, euin_valid: f.euin_valid, signature: f.signature}), 'Profile saved');
  if(ok){ PY.s._prof = null; PY.me = undefined; }
}

/* ---- Global rules: the firm on every invoice ---- */
function pySetGlobal(){
  const d = pyData('/settings/global');
  if(!d) return pyLoadingHtml('/settings/global');
  if(!PY.s._firm || PY.s._firmFor !== d){ PY.s._firm = Object.assign({}, d.firm); PY.s._firmFor = d; }
  const F = (k, label, ph) => pyField(label, pyInput('pyFirm_' + k, PY.s._firm[k], `placeholder="${esc(ph || '')}" oninput="PY.s._firm.${k}=this.value"`));
  return `<div class="py-banner info">The lead payout policy (the L1–L7 percentages) is set under <a href="javascript:void 0" onclick="PY.s.setTab='lead'; render()">Lead source</a>.</div>`
    + pyCard('Firm GST registration', `<div class="small-note" style="margin-top:0">Used on invoices and to split the GST: a payee in the same state gets CGST + SGST, anyone else IGST.</div>
      <div class="field-grid">${F('name', 'Firm name')}${F('state', 'Registered state')}${F('gstin', 'Firm GSTIN')}${F('pan', 'Firm PAN', 'ABCDE1234F')}${F('stateCode', 'GST state code')}</div>
      ${F('address1', 'Company address — line 1')}${F('address2', 'Company address — line 2')}
      <div class="field-grid">${F('hsn', 'Default HSN / SAC')}${F('tds', 'Default TDS %')}${F('gst', 'Default GST %')}</div>
      <div class="small-note">These are the "To" (company) block, HSN/SAC and default taxes on every RM tax invoice. GST is added when the GST switch in Reports › Monthly payouts is on.</div>`,
      `<button class="btn primary" onclick="pyRun(()=>pyPut('/settings/global', {firm: PY.s._firm}), 'Firm details saved')">Save firm details</button>`);
}

/* ---- User sharing: per-person overrides ---- */
function pySetSharing(){
  const users = pyData('/users');
  if(!users) return pyLoadingHtml('/users');
  const q = (PY.s.shareQ || '').toLowerCase();
  const list = users.filter(u=>u.role !== 'admin' && (!q || u.name.toLowerCase().indexOf(q) >= 0));
  const sel = users.find(u=>u.id === PY.s.shareSel);
  if(sel && PY.s._splitFor !== sel){ PY.s._split = Object.assign({}, sel.custom_split || {}); PY.s._splitFor = sel; }
  const levels = sel ? Array.from(new Set([sel.level].concat(sel.extra_levels || []))).sort((a, b)=>a - b) : [];
  return `<div class="py-grid12">
    ${pyCard('Select a person', pySearch('pyShareQ', 'shareQ', 'Search…', 220) + `<div class="py-pick-list" style="max-height:520px">${list.map(u=>
      `<div class="py-pick ${sel && sel.id === u.id ? 'on' : ''} between" onclick="PY.s.shareSel=${u.id}; render()"><div><b>${esc(u.name)}</b><div class="small-note" style="margin:0">${esc(u.code || '—')} · Level ${u.level}</div></div>
        ${pyBadge(u.custom_split ? 'Custom' : u.sharing_pct ? u.sharing_pct + '%' : 'Global', u.custom_split ? 'ok' : 'muted')}</div>`).join('') || '<div class="empty">Nobody on the team yet.</div>'}</div>`)}
    ${pyCard(sel ? esc(sel.name) : 'User-wise sharing', !sel ? '<div class="empty">Pick a person to set sharing percentages that override the global rules for them.</div>'
      : `<div class="small-note" style="margin-top:0">Primary level L${sel.level} · own sharing ${sel.sharing_pct || 0}% · leave a level blank to use the default.</div>
        ${levels.map(l=>`<div class="py-kv"><span><b>L${l}</b> ${PY_LEVELS[l]}</span><span class="row" style="gap:4px">${pyInput('pySplit' + l, PY.s._split[l], `type="number" class="py-pct" placeholder="default" oninput="PY.s._split[${l}]=this.value"`)} %</span></div>`).join('')}
        <div class="py-banner info">For L1–L3 the % is what this person gets on their own lead (on a lead passed down by an L4+, it applies to what is left after that person's share). For L5–L7 a custom % replaces their top share. Order: custom % for the level, then own sharing %, then the policy rate in Lead source. Managers always get the rest, so an L4 override has no effect.</div>
        <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" onclick="pySaveSplit(true)">Clear override</button><button class="btn primary" onclick="pySaveSplit(false)">Save & recalculate</button></div>`)}
  </div>`;
}
async function pySaveSplit(clear){
  const split = {};
  Object.keys(PY.s._split || {}).forEach(k=>{ const v = PY.s._split[k]; if(v !== '' && v !== null && v !== undefined) split[k] = v; });
  const ok = await pyRun(()=>pyPut('/users/' + PY.s.shareSel + '/sharing', {custom_split: clear ? null : split, recalculate: true}),
    clear ? 'Custom sharing cleared' : 'Custom sharing saved and applied');
  if(ok){ PY.s.shareSel = null; PY.s._splitFor = null; }
}

/* ---- Lead source: the sharing model, with a calculator ---- */
function pyLevelNums(o){ return Object.keys(o || {}).map(Number).sort((a, b)=>a - b); }
/* The same split as payout/services/payout.js splitGross, for the levels
   marked as assigned. `passedBy` is the level of an L4+ who brought the
   lead and passed it down, or null. */
function pySimulate(gross, sharing, assigned, passedBy){
  const pay = {}; let company = 0;
  const add = (l, pct) => { if(pct > 0) pay[l] = (pay[l] || 0) + gross * pct / 100; };
  const top = pyLevelNums(sharing.top);
  const topTotal = top.reduce((s, l)=>s + Number(sharing.top[l] || 0), 0);
  let carry = 0;
  for(const l of top){ const pct = carry + Number(sharing.top[l] || 0); if(assigned.has(l)){ add(l, pct); carry = 0; } else carry = pct; }
  company += gross * carry / 100;
  const pool = Math.max(0, 100 - topTotal);
  const lead = [1, 2, 3, 4, 5, 6, 7].find(l=>assigned.has(l));
  if(!lead) return {pay, company: company + gross * pool / 100, pool, topTotal, lead: null, mgr: null};
  let mgr = null;
  for(let l = Math.max(lead + 1, 4); l <= 7; l++) if(assigned.has(l)){ mgr = l; break; }
  const rate = l => Number(sharing.rates[l]) || 0;
  if(passedBy && passedBy >= 4 && passedBy > lead){
    const fee = Math.min(pool, Number(sharing.leadFee) || 0);
    add(passedBy, fee);
    const left = pool - fee;
    if(lead <= 3){ const own = left * rate(lead) / 100; add(lead, own); add(mgr || passedBy, left - own); } else add(lead, left);
  } else if(lead <= 3){
    const own = Math.min(pool, rate(lead));
    add(lead, own);
    if(mgr) add(mgr, pool - own); else company += gross * (pool - own) / 100;
  } else add(lead, pool);
  return {pay, company, pool, topTotal, lead, mgr};
}
function pySetLead(){
  const d = pyData('/settings/global');
  if(!d) return pyLoadingHtml('/settings/global');
  if(!PY.s._sh || PY.s._shFor !== d){ PY.s._sh = JSON.parse(JSON.stringify(d.sharing)); PY.s._shFor = d; }
  const sh = PY.s._sh;
  const sim = PY.s._sim = PY.s._sim || {gross: 100, assigned: [1, 4, 5, 6, 7], passedBy: ''};
  const assigned = new Set(sim.assigned);
  const r = pySimulate(Number(sim.gross) || 0, sh, assigned, Number(sim.passedBy) || null);
  const top = pyLevelNums(sh.top).reverse();
  const pool = r.pool, fee = Number(sh.leadFee) || 0, rate = l => Number(sh.rates[l]) || 0;
  const pct = (group, l) => `<span class="row" style="gap:4px">${pyInput('pySh_' + group + l, group === 'fee' ? sh.leadFee : sh[group][l],
    `type="number" step="0.01" class="py-pct" onchange="${group === 'fee' ? 'PY.s._sh.leadFee=this.value' : `PY.s._sh.${group}[${l}]=this.value`}; render()"`)} %</span>`;
  const why = l => l === r.lead ? ' (handles the client)' : l === Number(sim.passedBy) && r.lead && l > r.lead ? ' (brought the lead)' : l === r.mgr ? ' (manager)' : assigned.has(l) ? '' : ' (not assigned)';
  return pyCard('Lead reporting and brokerage distribution', `<div class="py-banner info"><b>Top share first, then the lead and their L4+ manager.</b>
        <div>On every client's brokerage, first <b>${r.topTotal}%</b> goes to the top levels (${top.map(l=>'L' + l + ' ' + (sh.top[l] || 0) + '%').join(', ')}). From the other <b>${pool}%</b>:</div>
        <ul style="margin:6px 0 0 18px;line-height:1.6">
          <li><b>L1, L2 or L3 brings the lead:</b> they get ${rate(1)}% / ${rate(2)}% / ${rate(3)}% of the brokerage, and the rest of the ${pool}% goes to their reporting manager (the nearest L4 or higher).</li>
          <li><b>L4 or higher brings the lead and handles it:</b> they get the whole ${pool}%.</li>
          <li><b>L4 or higher brings the lead and passes it down:</b> they get ${fee}% first. The direct report gets their ${rate(1)}/${rate(2)}/${rate(3)}% of the remaining ${pool - fee}%, and what is left goes to their manager.</li>
        </ul>
        <div class="small-note">A passed-down lead is marked with "Lead brought by" in Clients & Map › Map account.</div></div>
      <div class="py-grid3">
        <div class="card py-sub"><b class="small-note" style="margin:0;text-transform:uppercase">Top share (${r.topTotal}%)</b>
          ${top.map(l=>`<div class="py-kv"><span>L${l} ${PY_LEVELS[l]}</span>${pct('top', l)}</div>`).join('')}
          <div class="small-note">of the total brokerage; an empty level passes its share up</div></div>
        <div class="card py-sub"><b class="small-note" style="margin:0;text-transform:uppercase">Lead by L1 – L3</b>
          ${[1, 2, 3].map(l=>`<div class="py-kv"><span>L${l} ${PY_LEVELS[l]}<div class="small-note" style="margin:0">own lead: manager gets ${pool - rate(l)}%</div></span>${pct('rates', l)}</div>`).join('')}</div>
        <div class="card py-sub"><b class="small-note" style="margin:0;text-transform:uppercase">Lead by L4 and higher</b>
          <div class="py-kv"><span>Kept when passed down<div class="small-note" style="margin:0">handled themselves: the whole ${pool}%</div></span>${pct('fee', 0)}</div></div>
      </div>
      <div class="row" style="justify-content:flex-end"><button class="btn primary" onclick="pyRun(()=>pyPut('/settings/global', {sharing: PY.s._sh, recalculate: true}), 'Lead policy saved and payouts recalculated')">Save & recalculate</button></div>
      <div class="py-sim">
        <div class="between py-wrap"><b>↻ Try it</b><span class="row" style="gap:6px">Brokerage ₹ ${pyInput('pySimGross', sim.gross, 'type="number" style="width:130px" onchange="PY.s._sim.gross=this.value; render()"')}</span></div>
        <div class="small-note">Click a level to mark it as on or off the client. The lowest level switched on handles the client.</div>
        <div class="row py-wrap" style="gap:6px">${[1, 2, 3, 4, 5, 6, 7].map(l=>`<button class="btn sm ${assigned.has(l) ? 'primary' : ''}" onclick="pySimToggle(${l})">L${l}</button>`).join('')}
          <span class="small-note" style="margin:0 0 0 8px">Lead brought by</span>
          ${pySelect('pySimPassed', sim.passedBy, [['', 'the person handling it']].concat([4, 5, 6, 7].map(l=>[l, 'L' + l + ' ' + PY_LEVELS[l]])), "PY.s._sim.passedBy=this.value; render()")}</div>
        <div class="py-sim-rows">${[7, 6, 5, 4, 3, 2, 1].map(l=>`<div class="between" style="opacity:${assigned.has(l) || r.pay[l] ? 1 : .45}"><span>L${l} ${PY_LEVELS[l]}${why(l)}</span><b>₹${(r.pay[l] || 0).toFixed(2)}</b></div>`).join('')}
          <div class="between py-sim-total"><b>Company</b><b class="py-neg">₹${r.company.toFixed(2)}</b></div></div>
      </div>`);
}
function pySimToggle(l){
  const a = new Set(PY.s._sim.assigned);
  if(a.has(l)) a.delete(l); else a.add(l);
  PY.s._sim.assigned = Array.from(a); render();
}

/* ---- System: recalculate, locks, folio clean-up, restructure, reset ---- */
function pySetSystem(){
  const locks = pyData('/settings/locks');
  const users = pyData('/users') || [];
  const months = locks || [];
  const allLocked = months.length > 0 && months.every(m=>m.locked);
  const as = PY.s._assign = PY.s._assign || {folios: '', userId: '', move: 'none'};
  const br = PY.s._branch = PY.s._branch || {fromId: '', toId: ''};
  const own = PY.s._own, bc = PY.s._branchCheck;
  const people = [['', 'Choose a person']].concat(users.map(u=>[u.id, u.name + ' · L' + u.level]));
  const sec = (title, body) => `<div class="py-danger-sec"><div class="section-title" style="margin:0 0 6px">${title}</div>${body}</div>`;
  return `<div class="card py-danger"><div class="py-danger-head">⚠ Danger zone</div>
    ${sec('Recalculate payouts', `<div class="small-note">Runs the sharing again on every imported transaction with the current global and per-person rules. Locked months are left alone.</div>
      <button class="btn primary" onclick="pyRun(()=>pyPost('/settings/recalculate'), r=>r.recalculated + ' brokerage row(s) recalculated')">↻ Recalculate all transactions</button>`)}
    ${sec('🔒 Lock months', `<div class="small-note">A locked month keeps its payouts exactly as they were paid. Imports, rate changes, promotions, re-mapping and Recalculate never touch it. Lock a month once it has been paid.</div>
      ${!locks ? pyLoadingHtml('/settings/locks') : `<div class="row" style="gap:8px">${pySelect('pyLockUpTo', PY.s.lockUpTo || '', [['', allLocked ? 'Everything is locked' : 'Lock every month up to…']].concat(months.filter(m=>!m.locked).map(m=>[m.period, pyShortPeriod(m.period)])), "PY.s.lockUpTo=this.value; render()")}
          <button class="btn sm" ${PY.s.lockUpTo ? '' : 'disabled'} onclick="pyRun(()=>pyPost('/settings/locks', {upTo: PY.s.lockUpTo}).then(r=>{PY.s.lockUpTo=''; return r;}), r=>r.locked + ' month(s) locked')">🔒 Lock</button></div>
        ${pyTable([{t: 'Month'}, {t: 'Rows', r: 1}, {t: 'Brokerage', r: 1}, {t: 'Status'}, {t: '', r: 1}],
          months.map(m=>`<tr><td><b>${esc(pyShortPeriod(m.period))}</b></td><td class="py-r py-mono small">${Number(m.rows).toLocaleString('en-IN')}</td><td class="py-r py-mono small">${esc(pyInr(m.brokerage, 0))}</td>
            <td>${m.locked ? pyBadge('🔒 Locked', 'ok') : '<span class="small-note">Open</span>'}</td>
            <td class="py-r">${m.locked ? `<button class="btn sm ghost" onclick="pyRun(()=>pyDel('/settings/locks/${esc(m.period)}'), '${esc(m.period)} unlocked')">Unlock</button>` : ''}</td></tr>`),
          'No brokerage imported yet.', {scroll: 1, max: 420})}
        <div class="small-note">Locking up to a month also covers every earlier one.</div>`}`)}
    ${sec('Folio ownership', `<div class="small-note">Finds folios claimed by more than one client and removes the claim from every record that is not the owner. The owner is decided from the investor name on that folio's own statements, and only when exactly one claimant matches. Anything less certain is listed for you rather than guessed at. Folios are never added to a record.</div>
      <div class="row" style="gap:8px"><button class="btn" onclick="pyFolioCheck()">🔎 Check only</button>
        <button class="btn primary" ${own && own.resolved.length ? '' : 'disabled'} onclick="pyRun(()=>pyPost('/settings/folio-ownership/cleanup').then(r=>{PY.s._own=null; return r;}), r=>r.cleaned + ' folio(s) cleaned, ' + r.unsure + ' left for review')">Clean up</button></div>
      ${own ? `<div class="card py-sub small"><b>${own.resolved.length} can be cleaned · ${own.unsure.length} need a person</b>
        ${own.resolved.map(x=>`<div>✓ ${esc(x.folio)}: keep on <b>${esc(x.owner)}</b>, remove from ${esc(x.removeFrom.join(', '))}</div>`).join('')}
        ${own.unsure.map(x=>`<div class="py-warn">? ${esc(x.folio)}: ${esc(x.claimants.join(' | '))} — ${esc(x.reason)}</div>`).join('')}
        ${!own.resolved.length && !own.unsure.length ? '<div class="py-pos">No folio is claimed twice.</div>' : ''}</div>` : ''}
      <div class="section-title" style="margin:14px 0 4px;font-size:13px">Assign folios to one RM</div>
      <div class="small-note">When one investor is split between two RMs by folio, say which RM each folio belongs to. The folio stays on that RM's record and leaves every other. Optionally the chosen month's rows move too, so the report corrects without re-uploading the month.</div>
      <textarea id="pyAssignFolios" class="py-mono" rows="3" placeholder="Folios, separated by commas or new lines" oninput="PY.s._assign.folios=this.value">${esc(as.folios)}</textarea>
      <div class="row py-wrap" style="gap:8px;margin-top:6px">${pySelect('pyAssignUser', as.userId, [['', 'Belongs to…']].concat(users.map(u=>[u.id, u.name])), "PY.s._assign.userId=this.value")}
        ${pySelect('pyAssignMove', as.move, [['none', 'Do not move any rows'], ['all', 'Move rows for all months']].concat(months.map(m=>[m.period, 'Move ' + pyShortPeriod(m.period) + ' rows'])), "PY.s._assign.move=this.value")}
        <button class="btn primary" onclick="pyAssignFolios()">Assign</button></div>`)}
    ${sec('Branch restructure', `<div class="small-note">Use when a manager is promoted and a new BM is placed beneath them. Everyone who reports to the first person moves to report to the second, and clients under the first with <b>no manager at the second's level</b> get the second placed there. A slot already filled is never overwritten. Check first; it changes nothing.</div>
      <div class="field-grid">${pyField('Everyone currently under', pySelect('pyBrFrom', br.fromId, people, "PY.s._branch.fromId=this.value; PY.s._branchCheck=null; render()"))}
        ${pyField('Move them under', pySelect('pyBrTo', br.toId, people, "PY.s._branch.toId=this.value; PY.s._branchCheck=null; render()"))}</div>
      <div class="row" style="gap:8px"><button class="btn" ${br.fromId && br.toId ? '' : 'disabled'} onclick="pyBranchCheck()">🔎 Check only</button>
        <button class="btn primary" ${bc ? '' : 'disabled'} onclick="pyRun(()=>pyPost('/settings/branch-restructure', PY.s._branch).then(r=>{PY.s._branchCheck=null; return r;}), r=>r.moved + ' report(s) moved, ' + r.clients + ' client(s) updated')">Move branch</button></div>
      ${bc ? `<div class="py-banner info">${bc.reports.length} person(s) will move: ${esc(bc.reports.join(', ') || 'none')}. ${bc.clients} client(s) get the new manager placed.</div>` : ''}`)}
    ${sec('System reset', `<div class="small-note">Permanently deletes every imported transaction, client, rate, payout and payment, and every payout team member who is not an admin. Admin accounts and settings stay. BOSS itself is not touched.</div>
      <button class="btn danger" onclick="pyConfirm('Factory reset Payouts?', 'Every import, client, rate, payout, payment and non-admin team member will be permanently deleted. Admin accounts and settings stay.', 'Factory reset', ()=>pyRun(()=>pyPost('/settings/factory-reset', {confirm: 'RESET'}), 'Payouts reset'), 'RESET')">🗑 Factory reset Payouts</button>`)}
  </div>`;
}
async function pyFolioCheck(){
  try { PY.s._own = await pyGet('/settings/folio-ownership'); render(); } catch(e){ pyToast(e.message, 'err'); }
}
async function pyBranchCheck(){
  try { PY.s._branchCheck = await pyPost('/settings/branch-restructure', Object.assign({}, PY.s._branch, {check: true})); render(); } catch(e){ pyToast(e.message, 'err'); }
}
function pyAssignFolios(){
  const a = PY.s._assign;
  if(!a.folios.trim() || !a.userId){ pyToast('Enter folios and choose who they belong to', 'err'); return; }
  pyRun(()=>pyPost('/settings/assign-folios', a), r=>r.assigned + ' folio(s) assigned' + (r.skipped.length ? '; not on that RM\'s records: ' + r.skipped.join(', ') : ''));
}

/* =====================================================================
   NOT ON THE TEAM — what someone sees before an admin adds them
   ===================================================================== */
function pyNotOnTeam(){
  const m = PY.me;
  return `<div class="card py-error"><b>Payouts is not open for you yet.</b>
    <div class="small-note">${esc(m && m.error ? m.error : 'Ask an admin to add your email under Payouts › Clients & Map › Hierarchy.')}</div></div>`;
}

/* =====================================================================
   THE ONE DOOR — BOSS's render() calls this for every payout page
   ===================================================================== */
const PY_RENDER = {pydash: ()=>viewPyDashboard(), pyimports: ()=>viewPyImports(), pyclients: ()=>viewPyClients(),
  pyreports: ()=>viewPyReports(), pyrates: ()=>viewPyRates(), pypartner: ()=>viewPyPartner(),
  pyledger: ()=>viewPyLedger(), pyaudit: ()=>viewPyAudit(), pysettings: ()=>viewPySettings()};
function pyRender(view){
  pyStyles();
  if(pyMe() === undefined) return pyLoadingHtml();
  if(!pySectionOpen()) return pyNotOnTeam();
  if(!pyViewOpen(view)) return `<div class="card py-error"><b>That payout screen is for admins.</b>
    <div class="small-note">Your own clients and earnings are in the Payout Dashboard, Reports and the Payouts ledger.</div></div>`;
  try { return PY_RENDER[view](); }
  catch(e){ console.error(e); return `<div class="card py-error"><b>This screen hit an error.</b> ${esc(e.message)}
    <button class="btn sm" onclick="pyRefresh()">Try again</button></div>`; }
}

/* The page's own look, added once. Built from BOSS's colour tokens so it
   follows the theme like everything else. */
function pyStyles(){
  if(document.getElementById('pyStyles')) return;
  const s = document.createElement('style');
  s.id = 'pyStyles';
  s.textContent = `
  .py-head{margin-bottom:14px;gap:12px;flex-wrap:wrap}
  .py-head-actions{gap:8px;flex-wrap:wrap;align-items:center}
  .py-tabs{margin-bottom:14px}
  .py-count{display:inline-block;min-width:18px;padding:0 6px;border-radius:9px;background:var(--line);font-size:11px;line-height:18px;text-align:center;margin-left:4px}
  .py-stat-sub{font-size:11px;font-weight:400;color:var(--muted);margin-top:2px}
  .py-r{text-align:right}.py-c{text-align:center}
  .py-table table{width:100%}
  .py-scroll{overflow:auto}
  .py-card{margin-bottom:14px}
  .py-card-head{margin-bottom:10px;gap:10px;flex-wrap:wrap}
  .py-list-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid var(--line)}
  .py-list-row:last-child{border-bottom:0}
  .py-scrollbox{max-height:300px;overflow:auto}
  .py-rank{display:inline-flex;width:24px;height:24px;border-radius:50%;align-items:center;justify-content:center;background:var(--line);font-size:12px;font-weight:700}
  .py-rank.top{background:var(--gold);color:#fff}
  .py-grid2,.py-grid21,.py-grid3,.py-grid4,.py-grid12{display:grid;gap:14px;margin-bottom:0}
  .py-grid2{grid-template-columns:repeat(2,minmax(0,1fr))}
  .py-grid21{grid-template-columns:minmax(0,2fr) minmax(0,1fr)}
  .py-grid12{grid-template-columns:minmax(0,1fr) minmax(0,2fr);align-items:start}
  .py-grid3{grid-template-columns:repeat(3,minmax(0,1fr))}
  .py-grid4{grid-template-columns:repeat(4,minmax(0,1fr));margin-top:10px}
  @media (max-width:900px){.py-grid2,.py-grid21,.py-grid12,.py-grid3,.py-grid4{grid-template-columns:minmax(0,1fr)}}
  .py-producer{padding:8px 0;border-bottom:1px solid var(--line)}
  .py-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
  .py-cat{padding:5px 0}.py-cat i,.py-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px}
  .py-health{margin-bottom:14px}
  .py-health-cell{padding:10px;border:1px solid var(--line);border-radius:10px}
  .py-big{font-size:24px;display:block}
  .py-warn{color:var(--warn)}.py-pos{color:var(--ok)}.py-neg{color:var(--danger)}.py-muted{color:var(--muted)}
  .py-est{font-size:10px;font-weight:700;color:var(--warn);margin-left:3px}
  .py-check{display:inline-flex;gap:6px;align-items:center;font-size:13px;cursor:pointer}
  .py-search{max-width:100%}
  .py-banner{padding:10px 12px;border-radius:10px;margin:10px 0;font-size:13px;border:1px solid var(--line);background:var(--card)}
  .py-banner.info{border-color:var(--navy-2);background:color-mix(in srgb,var(--navy-2) 8%,var(--card))}
  .py-banner.warn{border-color:var(--warn);background:color-mix(in srgb,var(--warn) 9%,var(--card))}
  .py-alert{border-color:var(--warn);margin-bottom:14px}
  .py-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .py-pct{width:76px}
  .py-wrap{flex-wrap:wrap}
  .py-kv{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)}
  .py-pick-list{max-height:300px;overflow:auto;border:1px solid var(--line);border-radius:10px;margin-top:8px}
  .py-pick{padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--line)}
  .py-pick:hover{background:color-mix(in srgb,var(--navy-2) 6%,transparent)}
  .py-pick.on{background:color-mix(in srgb,var(--navy-2) 14%,transparent)}
  .py-nowrap{white-space:nowrap}
  .py-chart{width:100%;height:210px;display:block}
  .py-grid{stroke:var(--line);stroke-width:1}
  .py-axis{fill:var(--muted);font-size:10px}
  .py-legend{gap:14px;font-size:12px;margin-top:6px}
  .py-donut{width:140px;height:140px;flex:none}
  .py-error{border-color:var(--danger)}
  .py-loading{padding:30px}
  .py-pager{margin-top:10px;gap:10px;flex-wrap:wrap}
  .py-imp-type{margin-bottom:10px}
  .py-grid-btn{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px}
  .py-drop{border:2px dashed var(--line);border-radius:12px;padding:28px;text-align:center;cursor:pointer}
  .py-drop.drag,.py-drop:hover{border-color:var(--navy-2)}
  .py-sub{padding:12px;margin:0}
  .py-dup{border:1px solid var(--warn);border-radius:12px;padding:12px;margin-top:12px}
  .py-sim{margin-top:16px;padding:16px;border-radius:12px;background:var(--navy);color:#e2e8f0}
  .py-sim .small-note{color:#94a3b8}
  .py-sim .btn{background:transparent;color:#94a3b8;border-color:#475569}
  .py-sim .btn.primary{background:var(--gold);color:#fff;border-color:var(--gold)}
  .py-sim input{background:#fff;color:#0f172a}
  .pill-tabs button.active .py-count{background:rgba(255,255,255,.25);color:inherit}
  .py-sim-rows{border-top:1px solid #334155;margin-top:12px;padding-top:6px}
  .py-sim-rows>div{padding:5px 0}
  .py-sim-total{border-top:1px solid #334155;margin-top:6px;padding-top:10px}
  .py-danger{border-color:var(--danger);padding:0;overflow:hidden;max-width:820px}
  .py-danger-head{padding:14px 18px;font-weight:700;color:var(--danger);background:color-mix(in srgb,var(--danger) 8%,var(--card))}
  .py-danger-sec{padding:16px 18px;border-top:1px solid var(--line)}
  .py-danger-sec textarea{width:100%}
  #pyToasts{position:fixed;right:18px;bottom:18px;z-index:10000;display:flex;flex-direction:column;gap:8px}
  .py-toast{padding:10px 14px;border-radius:10px;color:#fff;font-size:13px;max-width:420px;box-shadow:0 6px 20px rgba(0,0,0,.18)}
  .py-toast.ok{background:var(--ok)}.py-toast.err{background:var(--danger)}`;
  document.head.appendChild(s);
}
