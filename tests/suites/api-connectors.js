/* WIRING BOSS TO SOMETHING ELSE.

   A connector has three halves that can each be wrong on their own:
   the credential (which must go to the server and never come back),
   the call (which must be refused when it would be unsafe), and the
   mapping (which must update the record BOSS already has rather than
   adding a second one).

   The two share endpoints are exercised for real against this suite's
   own server — they are ordinary routes, so a test can be the external
   system. The outbound proxy is exercised through its refusals, which
   is the part worth proving: this suite has no public HTTPS origin to
   call, and a test that pointed it at localhost would be testing that
   the guard does not work. */
const {suite} = require('../lib/harness');
const PORT = Number(process.env.BOSS_PORT || 3000);

const onServer = async (t, key) => t.eval(async (k)=>{
  const res = await fetch('/api/storage/' + encodeURIComponent(k), {headers: apiHeaders()});
  if(res.status === 404) return null;
  if(!res.ok) throw new Error('storage get failed: ' + res.status);
  return JSON.parse((await res.json()).value);
}, key);

suite(async t => {

  await t.step('Setup carries the screen, under Developer Hub', async () => {
    await t.eval(()=>{ navigate('settings','apiconnectors'); });
    await t.wait(400);
    const r = await t.eval(()=>{
      const c = document.getElementById('content');
      return {here: /API Connectors/.test(c.textContent),
              add: /openApiConnector\(\)/.test(c.innerHTML),
              hist: /Synchronisation history/.test(c.textContent),
              log: /Request log/.test(c.textContent),
              says: /never read back/.test(c.textContent)};
    });
    if(!r.here || !r.add) throw new Error('the screen or the New Connector button is missing');
    if(!r.hist || !r.log) throw new Error('there is no sync history or request log');
    if(!r.says) throw new Error('it does not say the credential cannot be read back');
    return 'Setup › Developer Hub › API Connectors';
  });

  t.section('the credential goes to the server and does not come back');

  await t.step('it is stored, and only its existence is readable', async () => {
    const r = await t.eval(async ()=>{
      await apiPutSecret('ZZCONN', {secret:'zz-super-secret-value-123', shareToken:'zz-share-token-456'});
      const res = await fetch('/api/apiconnectors', {headers: apiHeaders()});
      const body = await res.text();
      return {body, has: apiHasSecret('ZZCONN'), tok: apiHasShareToken('ZZCONN')};
    });
    if(!r.has || !r.tok) throw new Error('the page does not know one is stored');
    if(/zz-super-secret-value/.test(r.body)) throw new Error('the listing handed the secret back');
    if(/zz-share-token/.test(r.body)) throw new Error('the listing handed the share token back');
    return 'stored; the listing says only that it exists';
  });

  await t.step('it is nowhere in the CRM store either', async () => {
    const all = await t.eval(async ()=>{
      const keys = ['apiConnectors','apiReqLog','apiSyncRuns','config','settings'];
      const out = {};
      for(const k of keys){
        const res = await fetch('/api/storage/' + k, {headers: apiHeaders()});
        out[k] = res.ok ? (await res.json()).value : '';
      }
      return JSON.stringify(out);
    });
    if(/zz-super-secret-value/.test(all)) throw new Error('the secret reached the CRM store');
    if(/zz-share-token/.test(all)) throw new Error('the share token reached the CRM store');
    return 'not in apiConnectors, the logs, the config or the settings — so not in a backup either';
  });

  t.section('the call is refused when it would be unsafe');

  await t.step('plain http, this server’s own network, and a missing credential', async () => {
    const r = await t.eval(async ()=>{
      const call = (body) => fetch('/api/apiconnectors/ZZCONN/call', {
        method:'POST', headers: Object.assign({'Content-Type':'application/json'}, apiHeaders()),
        body: JSON.stringify(body)}).then(x=>x.json());
      return {
        http:    await call({url:'http://example.com/x', method:'GET', auth:{kind:'none'}}),
        local:   await call({url:'https://localhost:8443/x', method:'GET', auth:{kind:'none'}}),
        loop:    await call({url:'https://127.0.0.1/x', method:'GET', auth:{kind:'none'}}),
        lan:     await call({url:'https://10.1.2.3/x', method:'GET', auth:{kind:'none'}}),
        noCred:  await fetch('/api/apiconnectors/ZZNOCRED/call', {
          method:'POST', headers: Object.assign({'Content-Type':'application/json'}, apiHeaders()),
          body: JSON.stringify({url:'https://example.com/x', method:'GET', auth:{kind:'bearer'}})
        }).then(x=>x.json()),
        nonsense:await call({url:'not a url', method:'GET', auth:{kind:'none'}}),
      };
    });
    if(r.http.ok || !/https/.test(r.http.message)) throw new Error('http: ' + r.http.message);
    if(r.local.ok || !/own network/.test(r.local.message)) throw new Error('localhost: ' + r.local.message);
    if(r.loop.ok || !/own network/.test(r.loop.message)) throw new Error('127.0.0.1: ' + r.loop.message);
    if(r.lan.ok || !/own network/.test(r.lan.message)) throw new Error('10.x: ' + r.lan.message);
    if(r.noCred.ok || !/No credential is stored/.test(r.noCred.message)) throw new Error('no credential: ' + r.noCred.message);
    if(r.nonsense.ok || !/valid URL/.test(r.nonsense.message)) throw new Error('nonsense: ' + r.nonsense.message);
    return 'http, localhost, 127.0.0.1, a private range, a missing credential and a bad URL — each refused by name';
  });

  await t.step('a refused call is logged, without the credential or the key in the URL', async () => {
    const r = await t.eval(async ()=>{
      DB.apiConnectors = [{id:'ZZCONN', name:'ZZ External', system:'ZZ Co',
        baseUrl:'https://example.com', path:'/v1/things', direction:'in', module:'LMS',
        method:'GET', auth:{kind:'query', paramName:'api_key'}, headers:[{k:'X-Tenant', v:'zz'}],
        params:[{k:'api_key', v:'zz-in-the-url-999'}], map:[{boss:'email', ext:'email'}],
        matchBoss:'email', frequency:'manual', active:true}];
      await save('apiConnectors');
      const c = apiConnector('ZZCONN');
      await apiCall(c, apiRequestFor(c), 'Test connection');
      const last = DB.apiReqLog[DB.apiReqLog.length-1];
      return {last, raw: JSON.stringify(DB.apiReqLog)};
    });
    if(!r.last) throw new Error('nothing was logged');
    if(/zz-in-the-url-999/.test(r.raw)) throw new Error('the key in the query string went into the log');
    if(!/•/.test(r.last.url)) throw new Error('the url was not masked: ' + r.last.url);
    if((r.last.headerNames||[]).indexOf('X-Tenant') < 0) throw new Error('the header names were not kept');
    if(!(r.last.headerNames||[]).some(x=>/credential/.test(x)))
      throw new Error('the log does not say a credential was attached');
    return 'logged with the header names, the key masked out of the URL';
  });

  t.section('mapping, matching and not doubling');

  await t.step('their records come in, mapped and transformed', async () => {
    const r = await t.eval(async ()=>{
      DB.leads = [];
      await save('leads');
      DB.apiConnectors = [{id:'ZZIN', name:'ZZ Inbound', system:'ZZ Co',
        baseUrl:'https://example.com', path:'/leads', direction:'in', module:'LMS',
        method:'GET', auth:{kind:'none'}, headers:[], params:[], store:'leads',
        rowsPath:'data.items',
        map:[
          {boss:'email',     ext:'contact.email',  transform:'lower'},
          {boss:'firstName', ext:'name.first',     transform:'title'},
          {boss:'lastName',  ext:'name.last',      transform:'title'},
          {boss:'mobile',    ext:'contact.phone',  transform:'digits'},
          {boss:'city',      ext:'address.city',   transform:'trim'},
        ],
        matchBoss:'email', frequency:'manual', active:true}];
      await save('apiConnectors');
      const payload = {data:{items:[
        {contact:{email:'ONE@Example.IN', phone:'+91 90000 00001'}, name:{first:'asha', last:'rao'},
         address:{city:'  Varanasi  '}},
        {contact:{email:'two@example.in', phone:'(022) 1234-5678'}, name:{first:'vikram', last:'mehta'},
         address:{city:'Mumbai'}},
      ]}};
      const c = apiConnector('ZZIN');
      const rows = apiRowsFrom(c, payload);
      const out = await apiApplyRows(c, rows);
      return {out, leads: DB.leads.map(l=>({e:l.email, f:l.firstName, m:l.mobile, c:l.city,
        stage:l[RECORD_STATE_FIELD.LMS], src:l.sourceConnector}))};
    });
    if(r.out.created !== 2) throw new Error(r.out.created + ' were created, not 2');
    const a = r.leads.find(x=>x.e === 'one@example.in');
    if(!a) throw new Error('the address was not lower-cased: ' + JSON.stringify(r.leads));
    if(a.f !== 'Asha') throw new Error('title case did not apply: ' + a.f);
    if(a.m !== '919000000001') throw new Error('digits-only did not apply: ' + a.m);
    if(a.c !== 'Varanasi') throw new Error('trim did not apply: "' + a.c + '"');
    if(!a.stage) throw new Error('an imported lead has no stage, so it is nowhere in the workflow');
    if(a.src !== 'ZZIN') throw new Error('the record does not say which connector brought it');
    return '2 created, nested paths read, four transformations applied, both started in the workflow';
  });

  await t.step('the same payload again updates and never doubles', async () => {
    const r = await t.eval(async ()=>{
      const c = apiConnector('ZZIN');
      const same = {data:{items:[
        {contact:{email:'one@example.in', phone:'+91 90000 00001'}, name:{first:'asha', last:'rao'},
         address:{city:'Varanasi'}},
      ]}};
      const first = await apiApplyRows(c, apiRowsFrom(c, same));
      const changed = {data:{items:[
        {contact:{email:'ONE@example.in', phone:'+91 90000 00001'}, name:{first:'asha', last:'rao'},
         address:{city:'Lucknow'}},
      ]}};
      const second = await apiApplyRows(c, apiRowsFrom(c, changed));
      return {first, second, n: DB.leads.length,
              city: (DB.leads.find(l=>l.email==='one@example.in')||{}).city};
    });
    if(r.n !== 2) throw new Error('two leads became ' + r.n);
    if(r.first.created) throw new Error('an identical record was added again');
    if(r.first.unchanged !== 1) throw new Error('an identical record was not seen as unchanged');
    if(r.second.updated !== 1) throw new Error('the changed record was not updated');
    if(r.city !== 'Lucknow') throw new Error('the change did not land: ' + r.city);
    return 'identical → untouched, changed → updated, still two leads';
  });

  await t.step('a blank from them does not blank ours, and an unmatched row can be refused', async () => {
    const r = await t.eval(async ()=>{
      const c = apiConnector('ZZIN');
      await apiApplyRows(c, [{contact:{email:'one@example.in', phone:''}, name:{first:'', last:''},
                              address:{city:''}}]);
      const kept = DB.leads.find(l=>l.email==='one@example.in');
      c.updateOnly = true;
      const out = await apiApplyRows(c, [{contact:{email:'nobody@example.in'}, name:{first:'New'}}]);
      c.updateOnly = false;
      return {city: kept.city, first: kept.firstName, out, n: DB.leads.length};
    });
    if(r.city !== 'Lucknow' || r.first !== 'Asha') throw new Error('a blank wiped a field');
    if(r.out.created) throw new Error('update-only still created a record');
    if(!(r.out.failed||[]).some(f=>/only updates/.test(f.why))) throw new Error('it did not say why it was skipped');
    return 'blanks ignored; update-only refuses to invent a record and says so';
  });

  await t.step('each imported record carries its own audit line', async () => {
    const log = await onServer(t, 'auditLog');
    const lines = (log||[]).filter(x=>/by ZZ Inbound/.test(x.action||''));
    if(!lines.length) throw new Error('no audit line names the connector');
    const made = lines.filter(x=>/^Created/.test(x.action)).length;
    const upd = lines.filter(x=>/^Updated/.test(x.action)).length;
    if(!made || !upd) throw new Error('created ' + made + ', updated ' + upd);
    if(!lines[0].details || !lines[0].details.length) throw new Error('a line carries no field detail');
    return made + ' created and ' + upd + ' updated, each named on its own record';
  });

  t.section('their door into BOSS');

  await t.step('an outbound connector serves BOSS data to a token holder', async () => {
    t.expectConsole(/401|403|Unauthorized|Forbidden/);
    const r = await t.eval(async (port)=>{
      await apiPutSecret('ZZOUT', {shareToken:'zz-out-token-abc'});
      DB.apiConnectors = apiConnectors().concat([{id:'ZZOUT', name:'ZZ Outbound', system:'ZZ Co',
        baseUrl:'https://example.com', direction:'out', module:'LMS', store:'leads', method:'POST',
        auth:{kind:'none'}, headers:[], params:[],
        map:[{boss:'email', ext:'emailAddress'}, {boss:'firstName', ext:'given'}],
        frequency:'manual', active:true, shareLimit:100}]);
      await save('apiConnectors');
      const base = 'http://localhost:' + port + '/api/share/ZZOUT';
      const noTok = await (await fetch(base)).json();
      const wrong = await (await fetch(base + '?token=nope')).json();
      const good  = await (await fetch(base + '?token=zz-out-token-abc')).json();
      const hdr   = await (await fetch(base, {headers:{'X-Share-Token':'zz-out-token-abc'}})).json();
      return {noTok, wrong, good, hdr, out: apiOutboundRows(apiConnector('ZZOUT'))};
    }, PORT);
    if(!r.noTok.error || !r.wrong.error) throw new Error('it served data without the right token');
    if(!r.good.records || r.good.records.length !== 2) throw new Error('it served ' + JSON.stringify(r.good).slice(0,200));
    if(!r.hdr.records) throw new Error('the header form of the token was not accepted');
    const one = r.good.records.find(x=>x.emailAddress === 'one@example.in');
    if(!one) throw new Error('the field map was not applied: ' + JSON.stringify(r.good.records[0]));
    if(one.firstName) throw new Error('it shared a BOSS field name rather than theirs');
    if(Object.keys(one).length !== 2) throw new Error('it shared fields nobody mapped: ' + Object.keys(one).join(', '));
    return 'two records, only the two mapped fields, only with the token';
  });

  await t.step('an inbound connector takes a push, and BOSS applies it', async () => {
    t.expectConsole(/401|403|Unauthorized|Forbidden/);
    const r = await t.eval(async (port)=>{
      await apiPutSecret('ZZIN', {shareToken:'zz-in-token-xyz'});
      const c = apiConnector('ZZIN');
      c.frequency = 'webhook';
      await save('apiConnectors');
      const base = 'http://localhost:' + port + '/api/share/ZZIN';
      const refused = await (await fetch(base, {method:'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({records:[]})})).json();
      const pushed = await (await fetch(base + '?token=zz-in-token-xyz', {method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({records:[{contact:{email:'pushed@example.in', phone:'9000000003'},
          name:{first:'push', last:'ed'}, address:{city:'Pune'}}]})})).json();
      return {refused, pushed};
    }, PORT);
    if(!r.refused.error) throw new Error('it accepted a push with no token');
    if(!r.pushed.ok) throw new Error('the push was refused: ' + JSON.stringify(r.pushed));
    await t.wait(900);
    const drained = await t.eval(async ()=>{
      await sgetRefresh();
      const n = await apiDrainInbox();
      return {n, lead: DB.leads.find(l=>l.email === 'pushed@example.in'),
              inbox: (DB.apiInbox||[]).length, leads: DB.leads.length};
    }).catch(async ()=>t.eval(async ()=>{
      DB.apiInbox = await sget('apiInbox', []);
      const n = await apiDrainInbox();
      return {n, lead: DB.leads.find(l=>l.email === 'pushed@example.in'),
              inbox: (DB.apiInbox||[]).length, leads: DB.leads.length};
    }));
    if(!drained.lead) throw new Error('the pushed record never became a lead');
    if(drained.lead.city !== 'Pune') throw new Error('it was not mapped: ' + JSON.stringify(drained.lead));
    if(drained.inbox) throw new Error('the queue was not emptied');
    return 'refused without a token, queued with one, mapped into a lead and the queue cleared';
  });

  await t.step('a connector only answers for the direction it has', async () => {
    t.expectConsole(/401|403|404|Unauthorized|Forbidden|Not Found/);
    const r = await t.eval(async (port)=>{
      const out = apiConnector('ZZOUT');
      const get = await (await fetch('http://localhost:' + port
        + '/api/share/ZZOUT?token=zz-out-token-abc', {method:'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({records:[{a:1}]})})).json();
      out.active = false;
      await save('apiConnectors');
      await new Promise(r2=>setTimeout(r2, 400));
      const off = await (await fetch('http://localhost:' + port + '/api/share/ZZOUT?token=zz-out-token-abc')).json();
      out.active = true;
      await save('apiConnectors');
      const gone = await (await fetch('http://localhost:' + port + '/api/share/NOPE?token=x')).json();
      return {get, off, gone};
    }, PORT);
    if(!/imports nothing/.test(r.get.error||'')) throw new Error('an outbound connector accepted a push: ' + JSON.stringify(r.get));
    if(!/switched off/.test(r.off.error||'')) throw new Error('a switched-off connector still served: ' + JSON.stringify(r.off));
    if(!/unknown connector/.test(r.gone.error||'')) throw new Error('an unknown id was not refused');
    return 'push refused on an outbound-only one, nothing served while off, unknown id refused';
  });

  t.section('one connector for the whole system');

  /* The other end is a mirror, a warehouse or a second BOSS. There is no
     field map to write, because the answer to "which field is which" is
     "the same one" — so the contract is BOSS's own export shape, and
     what must be proved is that the shape really is the same one, that
     a payload applied twice does not double anything, and that what is
     unticked genuinely stays here. */

  await t.step('a whole-system connector shares every chosen module at once', async () => {
    t.expectConsole(/401|403|409|Unauthorized|Forbidden|Conflict/);
    const r = await t.eval(async (port)=>{
      DB.clients = [{id:'ZZCW', cmsName:'ZZ Whole Client', email:'wc@example.in',
        rmName:currentUser, createdAt:new Date().toISOString()}];
      initState('CMS', DB.clients[0]);
      DB.amcs = [{id:'AMCW', name:'ZZ Whole AMC'}];
      await save('clients'); await save('amcs');
      await apiPutSecret('ZZWHOLE', {shareToken:'zz-whole-token'});
      DB.apiConnectors = apiConnectors().concat([{id:'ZZWHOLE', name:'ZZ Mirror', system:'Second BOSS',
        baseUrl:'https://mirror.example', direction:'both', module:'*', store:'',
        stores:['leads','clients','amcs'], method:'POST', auth:{kind:'none'}, headers:[], params:[],
        map:[], frequency:'manual', active:true, shareLimit:1000}]);
      await save('apiConnectors');
      await new Promise(x=>setTimeout(x, 400));
      const url = 'http://localhost:' + port + '/api/share/ZZWHOLE?token=zz-whole-token';
      const got = await (await fetch(url)).json();
      return {got, out: apiWholeOut(apiConnector('ZZWHOLE'))};
    }, PORT);
    if(!r.got.modules) throw new Error('it did not answer in the export shape: ' + JSON.stringify(r.got).slice(0,200));
    const keys = Object.keys(r.got.modules).sort().join(',');
    if(keys !== 'amcs,clients,leads') throw new Error('it carried ' + keys);
    if(!r.got.modules.clients.length || !r.got.modules.amcs.length) throw new Error('a chosen module came back empty');
    if(r.got.modules.tasks) throw new Error('it shared a module nobody ticked');
    if(r.got.modules.clients[0].cmsName !== 'ZZ Whole Client')
      throw new Error('it renamed a field: ' + JSON.stringify(r.got.modules.clients[0]).slice(0,120));
    return keys + ' in one answer, in BOSS\u2019s own field names';
  });

  await t.step('an untickable module stays here', async () => {
    const r = await t.eval(async (port)=>{
      const c = apiConnector('ZZWHOLE');
      c.stores = ['clients'];
      await save('apiConnectors');
      await new Promise(x=>setTimeout(x, 400));
      const got = await (await fetch('http://localhost:' + port
        + '/api/share/ZZWHOLE?token=zz-whole-token')).json();
      c.stores = ['leads','clients','amcs'];
      await save('apiConnectors');
      return {keys: Object.keys(got.modules || {})};
    }, PORT);
    if(r.keys.join(',') !== 'clients') throw new Error('it shared ' + r.keys.join(', '));
    return 'only the one that was ticked';
  });

  await t.step('a whole-system payload comes in, and twice changes nothing', async () => {
    const r = await t.eval(async ()=>{
      const c = apiConnector('ZZWHOLE');
      const payload = {source:'BOSS', modules:{
        leads:[{id:'ZZWL1', leadName:'ZZ Whole Lead', firstName:'ZZ', lastName:'Whole',
                email:'wl@example.in', status:'new'}],
        clients:[{id:'ZZCW', cmsName:'ZZ Whole Client RENAMED', email:'wc@example.in'}],
        amcs:[{id:'AMCNEW', name:'ZZ Brand New AMC'}],
        tasks:[{id:'ZZTSKIP', taskType:'ZZ Not Carried'}],
      }};
      const first = await apiWholeApplyIn(c, payload);
      const second = await apiWholeApplyIn(c, payload);
      return {first, second,
        lead: !!DB.leads.find(l=>l.id === 'ZZWL1'),
        renamed: (DB.clients.find(x=>x.id === 'ZZCW')||{}).cmsName,
        clients: DB.clients.length, amcs: DB.amcs.length,
        skipped: !DB.tasks.find(x=>x.id === 'ZZTSKIP')};
    });
    if(!r.lead) throw new Error('the lead in the payload never landed');
    if(r.renamed !== 'ZZ Whole Client RENAMED') throw new Error('the client was not updated: ' + r.renamed);
    if(r.clients !== 1) throw new Error('one client became ' + r.clients);
    if(r.amcs !== 2) throw new Error('the new AMC did not land, or doubled: ' + r.amcs);
    if(!r.skipped) throw new Error('a module the connector does not carry was written anyway');
    if(r.second.created) throw new Error('the second pass created ' + r.second.created + ' records');
    if(r.first.modules !== 3) throw new Error('it read ' + r.first.modules + ' modules, not 3');
    return '3 modules in, the 4th ignored, and the second pass adds nothing';
  });

  await t.step('a push in the wrong shape is refused with the right shape named', async () => {
    t.expectConsole(/400|Bad Request/);
    const r = await t.eval(async (port)=>{
      const url = 'http://localhost:' + port + '/api/share/ZZWHOLE?token=zz-whole-token';
      const flat = await (await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({records:[{id:'x'}]})})).json();
      const right = await (await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({modules:{leads:[{id:'ZZWL2', leadName:'ZZ Pushed Whole',
          email:'pw@example.in', status:'new'}]}})})).json();
      return {flat, right};
    }, PORT);
    if(!/modules/.test(r.flat.error || '')) throw new Error('a flat list was accepted: ' + JSON.stringify(r.flat));
    if(!r.right.ok) throw new Error('the right shape was refused: ' + JSON.stringify(r.right));
    if(r.right.queued !== 1) throw new Error('it counted ' + r.right.queued);
    await t.wait(800);
    const landed = await t.eval(async ()=>{
      DB.apiInbox = await sget('apiInbox', []);
      await apiDrainInbox();
      return {lead: !!DB.leads.find(l=>l.id === 'ZZWL2'), inbox: (DB.apiInbox||[]).length};
    });
    if(!landed.lead) throw new Error('the pushed whole-system payload never became a lead');
    if(landed.inbox) throw new Error('the queue was not emptied');
    return 'a flat list refused by name, the export shape queued, mapped and drained';
  });

  await t.step('the editor asks a whole-system connector for less, not more', async () => {
    const r = await t.eval(()=>{
      const whole = (d)=>apiValidateDraft(Object.assign({name:'x', baseUrl:'https://a.example.com',
        module:'*', direction:'in', frequency:'manual', stores:['leads'], map:[]}, d));
      return {fine: whole({}), noStores: whole({stores:[]}),
              perModuleStillNeedsAMap: apiValidateDraft({name:'x', baseUrl:'https://a.example.com',
                module:'LMS', direction:'in', frequency:'manual', map:[], matchBoss:'email'})};
    });
    if(r.fine.length) throw new Error('a sound whole-system connector was refused: ' + r.fine.join(' | '));
    if(!/at least one module/.test(r.noStores[0]||'')) throw new Error('carrying nothing was allowed');
    if(!/Map at least one field/.test(r.perModuleStillNeedsAMap[0]||''))
      throw new Error('a per-module connector no longer needs a map');
    return 'no field map and no match rule asked for, but a module is';
  });

  t.section('what the editor will not let through');

  await t.step('a connector that could not work is not saved', async () => {
    const r = await t.eval(()=>{
      const bad = (d)=>apiValidateDraft(Object.assign({name:'x', baseUrl:'https://a.example.com',
        module:'LMS', direction:'in', matchBoss:'email', frequency:'manual',
        map:[{boss:'email', ext:'email'}]}, d));
      return {
        noName:  bad({name:''}),
        http:    bad({baseUrl:'http://a.example.com'}),
        noMap:   bad({map:[]}),
        noMatch: bad({matchBoss:''}),
        outPush: bad({direction:'out', frequency:'webhook'}),
        fine:    bad({}),
      };
    });
    if(r.fine.length) throw new Error('a good one was refused: ' + r.fine.join(' | '));
    if(!r.noName.length) throw new Error('a nameless connector was allowed');
    if(!/https/.test((r.http[0]||''))) throw new Error('http was allowed: ' + r.http.join(' | '));
    if(!/Map at least one field/.test((r.noMap[0]||''))) throw new Error('an empty map was allowed');
    if(!/every run would add everything again/.test((r.noMatch[0]||'')))
      throw new Error('inbound with no matching rule was allowed');
    if(!/cannot be real-time inbound/.test((r.outPush[0]||'')))
      throw new Error('an outbound-only connector was allowed to claim real-time inbound');
    return 'five refusals, each saying what is wrong, and a sound one accepted';
  });

  await t.step('transformations do what they say', async () => {
    const r = await t.eval(()=>({
      upper: apiTransform('upper',' abc '), digits: apiTransform('digits','+91 (98) 76-54'),
      title: apiTransform('title','asha RAO'), num: apiTransform('number','1,25,000'),
      iso: apiTransform('isoDate','14/03/2026'), dmy: apiTransform('dmyDate','2026-03-14'),
      yes: apiTransform('yesNo', true), no: apiTransform('yesNo','0'),
      join: apiTransform('join',['a','b']), none: apiTransform('', 42),
    }));
    if(r.upper !== 'ABC') throw new Error('upper: ' + r.upper);
    if(r.digits !== '91987654') throw new Error('digits: ' + r.digits);
    if(r.title !== 'Asha Rao') throw new Error('title: ' + r.title);
    if(r.num !== 125000) throw new Error('number: ' + r.num);
    if(r.iso !== '2026-03-14') throw new Error('iso: ' + r.iso);
    if(r.dmy !== '14/03/2026') throw new Error('dmy: ' + r.dmy);
    if(r.yes !== 'Yes' || r.no !== 'No') throw new Error('yesNo: ' + r.yes + '/' + r.no);
    if(r.join !== 'a, b') throw new Error('join: ' + r.join);
    if(r.none !== 42) throw new Error('as-it-comes changed the value: ' + r.none);
    return 'a DD/MM date read as DD/MM, and nine other conversions';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error(t.dialogs.join(' | '));
    return 'none';
  });
});
