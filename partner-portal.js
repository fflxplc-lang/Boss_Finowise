/* THE PARTNER'S OWN DOOR (B2B changes 3).

   Two things a partner reaches without a BOSS account:

   1. The empanelment form. One page carries the Freedom LifeX form, the
      documents and the partner agreement, filled in with what the firm
      already has. It is sent by email or WhatsApp from POB and served on
      a token of its own (/empanelment?t=…), like the prospect's form.
      Submitting it writes the answers, the documents and the agreement
      onto the onboarding record and sends the application for
      evaluation to the onboarding owner's reporting manager, or to an
      administrator.

   2. The partner login (/partner). Created from POB's Login Access step,
      it opens a dashboard of the partner's own record and nothing else:
      their profile, empanelment, agreement and documents, their payments,
      their tasks — which they submit for their mentor's review — and,
      once the role's onboarding tasks are approved, the Client Journey,
      where the leads they put in are counted into their figures.

   Why a door of its own rather than a BOSS account: BOSS hands its
   whole store to every signed-in browser, so a partner signed in to
   BOSS would be holding everybody's data whatever the screens showed.
   Here every answer is built on the server from the partner's own
   onboarding record, and nothing else leaves it. The accounts are a
   table of their own in users.db, beside the staff accounts and apart
   from them: a partner session is never a BOSS session.

   Records are read and written in the same store as the rest of the
   CRM, and every write is published, so an open BOSS screen redraws. */
const crypto = require('crypto');
const path = require('path');
const PartnerTargets = require('./public/partner-targets.js');

const PARTNER_COOKIE = 'flx_partner';
const SESSION_MS = 7 * 24 * 3600000;
const SETUP_MS = 7 * 24 * 3600000;

/* What the CRM ships, for a store that has not been through POB ›
   Settings. The same text as POB_SETTINGS_DEFAULTS in index.html. */
const POB_DEFAULTS = {
  dueFee: 0, currency: 'INR', taskDueDays: 7,
  docs: 'PAN Card*\nAadhaar Card*\nCancelled Cheque*\nPassport Photograph*\nSigned Agreement*\nQualification Certificate',
  agreement: 'I agree to work as a Freedom LifeX partner on the terms of the Freedom LifeX partner agreement, to follow its code of conduct and the regulations that apply to the products I distribute, and to keep client information confidential.',
};
const AGREEMENT_TYPES = ['Mutual Fund Agreement', 'Wealth Agreement', 'Broker Agreement'];
const SIGNED_AGREEMENT = 'Signed Agreement';
const POB_STAGES = [
  ['duePayment', 'Receive Due Payment'], ['paymentAck', 'Payment Acknowledgement'], ['empanelment', 'Empanelment — Form & Agreement'],
  ['evaluation', 'Evaluation by Freedom LifeX'], ['loginAccess', 'Login Access'], ['roleMeeting', 'Role Confirmation One-to-One'],
  ['roleWorkflow', 'Role Onboarding Tasks'], ['readiness', 'Business Readiness Review'], ['active', 'Active Partner'],
];
// The CMS road, in order, for a store whose Stage Management has not been saved.
const CMS_ORDER = ['clientCreated', 'insurancePending', 'cifStage', 'cifReceived', 'docsVerification', 'kycStage', 'onboardingProcess',
  'mandateRegistration', 'mandateStatus', 'initiateTransaction', 'transactionPlaced', 'unitAllotted', 'familyMapping',
  'loginCredentials', 'readyForRMS', 'convertedToRMS'];
const CLIENT_ONBOARDED_FROM = 'mandateRegistration';
const LEAD_STATUSES_OPEN_TO_EDIT = ['created', 'warmUpCallScheduled', 'warmUpCallDone'];

/* The empanelment form, section by section. `on` names the field on
   the onboarding record when it has one there. */
const EMP_SECTIONS = [
  { title: 'Personal details', fields: [
    { k: 'firstName', l: 'First name', req: 1 },
    { k: 'lastName', l: 'Last name' },
    { k: 'dob', l: 'Date of birth', t: 'date', req: 1 },
    { k: 'gender', l: 'Gender', t: 'select', opts: ['Female', 'Male', 'Other', 'Prefer not to say'] },
    { k: 'fatherName', l: 'Father’s / spouse’s name' },
    { k: 'qualification', l: 'Highest qualification' },
    { k: 'occupation', l: 'Current occupation' },
  ] },
  { title: 'Contact', fields: [
    { k: 'email', l: 'Email', vk: 'email', req: 1 },
    { k: 'mobile', l: 'Mobile', vk: 'mobile', req: 1 },
    { k: 'address', l: 'Address', t: 'textarea', req: 1 },
    { k: 'city', l: 'City', req: 1 },
    { k: 'state', l: 'State' },
    { k: 'pincode', l: 'PIN code', vk: 'pincode' },
  ] },
  { title: 'KYC', fields: [
    { k: 'pan', l: 'PAN', vk: 'pan', req: 1, ph: 'ABCDE1234F' },
    { k: 'aadhaarLast4', l: 'Aadhaar — last 4 digits', vk: 'last4', ph: '1234', h: 'Only the last four digits. Upload the card under Documents.' },
  ] },
  { title: 'ARN / EUIN', note: 'If you hold an ARN or an EUIN, give it here. Leave this section blank if you have neither yet.', fields: [
    { k: 'arn', l: 'ARN', ph: 'ARN-123456' },
    { k: 'arnMobile', l: 'ARN registered mobile', vk: 'mobile' },
    { k: 'euin', l: 'EUIN', ph: 'E123456' },
    { k: 'euinMobile', l: 'EUIN registered mobile', vk: 'mobile' },
  ] },
  { title: 'Business', fields: [
    { k: 'proposedRole', l: 'The role you would like', t: 'select', opts: ['Ninja', 'Super Ninja', 'Sherpa', 'Not decided yet'] },
    { k: 'experience', l: 'Experience in financial products', t: 'select', opts: ['None', 'Less than 1 year', '1–3 years', 'More than 3 years'] },
  ] },
  { title: 'Bank details', note: 'Your payouts are paid into this account.', fields: [
    { k: 'bankHolder', l: 'Account holder’s name', req: 1 },
    { k: 'bankName', l: 'Bank', req: 1 },
    { k: 'bankAccount', l: 'Account number', vk: 'account', req: 1 },
    { k: 'bankIfsc', l: 'IFSC', vk: 'ifsc', req: 1, ph: 'HDFC0001234' },
  ] },
  { title: 'Nominee', fields: [
    { k: 'nomineeName', l: 'Nominee’s name' },
    { k: 'nomineeRelation', l: 'Relationship' },
  ] },
];
const EMP_FIELDS = EMP_SECTIONS.reduce((a, s) => a.concat(s.fields), []);

function uid(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 7).toUpperCase() + Date.now().toString().slice(-4);
}
function nameOf(r) { return r ? ((r.firstName || '') + ' ' + (r.lastName || '')).trim() || r.id : ''; }
function humanize(id) {
  const s = String(id || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function lines(text) { return String(text || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean); }
function sha(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }
// The same short version the CRM writes on an agreement (pobAgreementVersion).
function agreementVersion(text) {
  const t = String(text || '');
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return 'v' + (h % 100000);
}
/* A value read the way the CRM's own field rules read it; the error is
   what the person filling the form is told. */
function checkValue(vk, raw) {
  let v = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!v) return { ok: true, value: '' };
  if (vk === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? { ok: true, value: v.toLowerCase() } : { ok: false, message: 'does not look like an email address' };
  if (vk === 'mobile') { const d = v.replace(/\D/g, '').slice(-10); return /^[6-9]\d{9}$/.test(d) ? { ok: true, value: d } : { ok: false, message: 'has to be a 10-digit mobile number' }; }
  if (vk === 'pan') { v = v.toUpperCase(); return /^[A-Z]{5}\d{4}[A-Z]$/.test(v) ? { ok: true, value: v } : { ok: false, message: 'has to look like ABCDE1234F' }; }
  if (vk === 'ifsc') { v = v.toUpperCase(); return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v) ? { ok: true, value: v } : { ok: false, message: 'has to look like HDFC0001234' }; }
  if (vk === 'pincode') return /^\d{6}$/.test(v) ? { ok: true, value: v } : { ok: false, message: 'has to be 6 digits' };
  if (vk === 'last4') return /^\d{4}$/.test(v) ? { ok: true, value: v } : { ok: false, message: 'has to be the last 4 digits' };
  if (vk === 'account') { const d = v.replace(/\s/g, ''); return /^\d{6,20}$/.test(d) ? { ok: true, value: d } : { ok: false, message: 'has to be the account number, in digits' }; }
  return { ok: true, value: v.slice(0, 2000) };
}

function install(deps) {
  const { app, usersDb, storeList, storeValue, putList, writeToDisk, checkApiKey, hashPassword, passwordMatches, sign,
    readCookie, signedInUser, tooManyAttempts, noteFailure, forgiveAttempts, branding, esc, pj, publicDir } = deps;

  usersDb.exec(`CREATE TABLE IF NOT EXISTS partner_accounts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    pob_id        TEXT NOT NULL UNIQUE,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT,
    setup_hash    TEXT,
    setup_expires INTEGER,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  )`);
  const acctByPob = usersDb.prepare('SELECT * FROM partner_accounts WHERE pob_id = ?');
  const acctByEmail = usersDb.prepare('SELECT * FROM partner_accounts WHERE email = ?');
  const acctById = usersDb.prepare('SELECT * FROM partner_accounts WHERE id = ?');
  const acctBySetup = usersDb.prepare('SELECT * FROM partner_accounts WHERE setup_hash = ?');
  const insertAcct = usersDb.prepare('INSERT INTO partner_accounts (pob_id, email, setup_hash, setup_expires) VALUES (?, ?, ?, ?)');
  const updateAcctSetup = usersDb.prepare('UPDATE partner_accounts SET email = ?, setup_hash = ?, setup_expires = ? WHERE id = ?');
  const updateAcctPassword = usersDb.prepare('UPDATE partner_accounts SET password_hash = ?, setup_hash = NULL, setup_expires = NULL WHERE id = ?');
  const updateAcctActive = usersDb.prepare('UPDATE partner_accounts SET active = ? WHERE id = ?');
  const noteAcctLogin = usersDb.prepare("UPDATE partner_accounts SET last_login_at = datetime('now') WHERE id = ?");

  const config = () => storeValue('config', {}) || {};
  const pobConfig = () => Object.assign({}, POB_DEFAULTS, config().partnerOnboarding || {});
  const origin = (req) => (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim() + '://' + req.get('host');
  const nowIso = () => new Date().toISOString();

  /* ---------- the team: who verifies what ---------- */
  const team = () => storeList('team');
  const activeMember = (t) => t && !t.deletedAt && (t.status || 'Active') === 'Active';
  const admins = () => team().filter((t) => activeMember(t) && t.role === 'Admin').map((t) => t.id);
  function managersOf(id) {
    const list = team();
    const u = list.find((t) => t && t.id === id);
    if (!u) return [];
    const out = [];
    (u.managerIds || []).concat([u.parentUserId]).forEach((m) => {
      if (!m || m === u.id || out.includes(m)) return;
      if (activeMember(list.find((t) => t && t.id === m))) out.push(m);
    });
    return out;
  }
  // The same rule as pjVerifiersFor() in the CRM.
  function verifiersFor(submittedBy, mappedRm) {
    if (submittedBy === 'Partner') {
      const rm = team().find((t) => t && t.id === mappedRm);
      return activeMember(rm) ? [rm.id] : admins();
    }
    const m = managersOf(submittedBy);
    if (m.length) return m;
    const others = admins().filter((x) => x !== submittedBy);
    return others.length ? others : admins();
  }
  const memberName = (id) => { const t = team().find((x) => x && x.id === id); return t ? t.name : ''; };

  /* The bell, and a letter, for each person a partner's step waits on. */
  async function askVerifiers(ids, o) {
    const list = team();
    const at = nowIso();
    const notes = (ids || []).map((id) => ({ id: uid('NTF'), at, userId: id, title: 'To verify: ' + o.what + ' — ' + o.name,
      body: o.details || '', view: o.view || 'pob', arg: o.recordId, kind: 'verify', by: 'Partner' }));
    if (notes.length) putList('notifications', storeList('notifications').concat(notes));
    const comms = [];
    for (const id of ids || []) {
      const t = list.find((x) => x && x.id === id);
      if (!t || !t.email) continue;
      comms.push(await pj.letter({ config: config(), key: 'pjVerifyRequest', to: t.email, module: o.module || 'POB', recordId: o.recordId,
        label: 'Verification request to ' + (t.name || ''),
        vars: { VerifierName: t.name || '', What: o.what, Name: o.name, Details: o.details || '', SubmittedBy: o.by || o.name,
          Link: o.link || '', FirmName: pj.firmName(config()) } }));
    }
    if (comms.length) putList('communications', storeList('communications').concat(comms));
    writeToDisk();
  }
  function audit(recordId, action, details) {
    putList('auditLog', storeList('auditLog').concat([{ id: uid('AUD'), at: nowIso(), by: 'Partner', module: 'POB', recordId, action, details: details || [] }]));
  }

  /* ---------- the onboarding record, as the partner may see it ---------- */
  function stageOf(r) { return r.pobStage || 'duePayment'; }
  function stageLabel(id) {
    const saved = ((config().blueprints || {}).POB || {}).states || [];
    const st = saved.find((x) => x && x.id === id);
    if (st) return st.label;
    const hit = POB_STAGES.find((x) => x[0] === id);
    return hit ? hit[1] : (id === 'rejected' ? 'Application Rejected' : humanize(id));
  }
  function docChecklist() {
    return lines(pobConfig().docs).map((l) => ({ type: l.replace(/\*+$/, '').trim(), mandatory: /\*$/.test(l) }));
  }
  const liveTasks = (r) => (r.tasks || []).filter((t) => !t.retired);
  function requiredOnboarding(r) { return liveTasks(r).filter((t) => t.phase === 'onboarding' && t.required !== false); }
  function clientJourneyOpen(r) {
    if (r.pobStage === 'active') return true;
    const req = requiredOnboarding(r);
    return !!r.role && req.length > 0 && req.every((t) => t.status === 'Approved');
  }
  function metrics(r) {
    const leads = storeList('leads').filter((l) => l && !l.deletedAt && l.partnerPobId === r.id);
    const clients = storeList('clients').filter((c) => c && !c.deletedAt && c.partnerPobId === r.id);
    const saved = (((config().blueprints || {}).CMS || {}).states || []).map((x) => x.id);
    const order = saved.length ? saved : CMS_ORDER;
    const from = order.indexOf(CLIENT_ONBOARDED_FROM);
    const crm = { leads: leads.length + clients.length, conversions: clients.length,
      clients: from < 0 ? 0 : clients.filter((c) => order.indexOf(c.cmsStage || 'clientCreated') >= from).length };
    const adj = r.metricsAdjust || {};
    const out = { leads: 0, conversions: 0, clients: 0 };
    Object.keys(out).forEach((k) => { out[k] = crm[k] + Math.max(0, Math.floor(Number(adj[k]) || 0)); });
    return out;
  }
  // The same eligibility as pobTaskState() in the CRM.
  function taskState(r, t, fig) {
    const tasks = liveTasks(r);
    if (['Approved', 'Cancelled'].includes(t.status)) return { open: false, reason: '' };
    if (t.phase === 'growth' && stageOf(r) !== 'active') return { open: false, reason: 'Opens once you are an active partner' };
    const waits = (t.dependsOn || []).map((k) => tasks.find((x) => x.key === k))
      .filter((x) => x && x.status !== 'Approved' && !(x.status === 'Cancelled' && x.required === false));
    if (waits.length) return { open: false, reason: 'Waits for “' + waits[0].title + '” to be approved' };
    if (t.metric && t.count) {
      const have = Number((fig || metrics(r))[t.metric]) || 0;
      const what = { leads: 'leads collected', conversions: 'leads converted', clients: 'clients onboarded' }[t.metric] || t.metric;
      if (have < Number(t.count)) return { open: false, reason: 'Needs ' + t.count + ' ' + what + ' — ' + have + ' so far' };
    }
    return { open: true, reason: '' };
  }
  /* A task that has just opened gets its due date, as pobRefreshTasks()
     gives it in the CRM. Answers the tasks that opened. */
  function refreshTasks(r) {
    const days = Number(pobConfig().taskDueDays) || 7;
    const fig = metrics(r);
    const opened = [];
    liveTasks(r).forEach((t) => {
      if (!taskState(r, t, fig).open || t.eligibleAt) return;
      t.eligibleAt = nowIso();
      if (!t.dueDate && t.kind !== 'milestone' && t.kind !== 'review') {
        const d = new Date(); d.setUTCDate(d.getUTCDate() + days); t.dueDate = d.toISOString().slice(0, 10);
      }
      opened.push(t);
    });
    return opened;
  }
  function docsOf(r) { return storeList('pjDocuments').filter((d) => d && !d.deletedAt && d.pobId === r.id); }
  // A file belongs to a partner when one of their own records names it.
  function fileIsTheirs(r, fileId) {
    if (!fileId) return false;
    if (docsOf(r).some((d) => (d.versions || []).some((v) => v.fileId === fileId))) return true;
    if ((r.payments || []).some((p) => p.receiptFileId === fileId)) return true;
    if (r.agreement && r.agreement.signedFileId === fileId) return true;
    const meta = pj.docs.meta(fileId);
    return !!(meta && meta.pobId === r.id);
  }
  /* What the partner sees of themselves. Built field by field, so
     nothing the firm keeps about them internally — the evaluation notes,
     the escalations, the audit — goes with it. */
  function partnerView(r, req) {
    const fig = metrics(r);
    const st = stageOf(r);
    const idx = POB_STAGES.findIndex((x) => x[0] === st);
    const docs = docsOf(r);
    const ag = r.agreement || null;
    const lastAttempt = (r.attempts || []).slice(-1)[0] || null;
    const formOpen = st === 'empanelment' && !!r.empFormToken;
    return {
      firm: pj.firmName(config()),
      partner: { name: nameOf(r), firstName: r.firstName || '', partnerCode: r.partnerCode || '', applicationId: r.applicationId || '',
        role: r.role || '', proposedRole: r.proposedRole || '', email: r.email || '', mobile: r.mobile || '', city: r.city || '',
        address: r.address || '', pan: r.pan || '', registrationDate: r.registrationDate || '',
        bank: r.bankAccount ? (r.bankName || '') + ' · ••••' + String(r.bankAccount).slice(-4) + (r.bankIfsc ? ' · ' + r.bankIfsc : '') : '',
        rm: memberName(r.assignedTo), mentor: memberName(r.mentorId || r.assignedTo), status: r.operationalStatus || 'Onboarding',
        activatedAt: r.activatedAt || '' },
      stage: { id: st, label: stageLabel(st),
        steps: POB_STAGES.map(([id, label], i) => ({ id, label, done: st === 'active' || (idx >= 0 && i < idx), current: id === st })) },
      empanelment: { status: r.applicationStatus || 'Draft', submittedAt: r.empFormSubmittedAt || r.submittedAt || '',
        formOpen, formUrl: formOpen ? origin(req) + '/empanelment?t=' + encodeURIComponent(r.empFormToken) : '',
        decision: lastAttempt && lastAttempt.decision ? { decision: lastAttempt.decision, reason: lastAttempt.reason || '', at: lastAttempt.decidedAt || '' } : null },
      agreement: ag && ag.acceptedAt ? { acceptedAt: ag.acceptedAt, version: ag.version || '', types: ag.types || [], signedName: ag.signedName || '',
        evidence: ag.evidence || '', signedFileId: ag.signedFileId || '' } : null,
      documents: docChecklist().concat(docs.filter((d) => !docChecklist().some((c) => c.type === d.type)).map((d) => ({ type: d.type, mandatory: false })))
        .map((c) => {
          const d = docs.find((x) => x.type === c.type);
          const rej = d && (d.reviews || []).slice().reverse().find((x) => x.decision === 'Rejected');
          return { type: c.type, mandatory: c.mandatory, status: d ? d.status : 'Not Submitted',
            reason: d && d.status === 'Rejected' && rej ? rej.reason || '' : '',
            versions: d ? (d.versions || []).map((v) => ({ v: v.v, name: v.name, fileId: v.fileId, uploadedAt: v.uploadedAt })) : [] };
        }),
      payments: (r.payments || []).map((p) => ({ date: p.date || '', amount: p.amount, currency: p.currency || '', method: p.method || '',
        ref: p.ref || '', status: p.status || '', receiptFileId: p.receiptFileId || '' })),
      due: Number(pobConfig().dueFee) || 0, currency: pobConfig().currency || 'INR',
      mayRecordPayment: ['duePayment', 'paymentAck'].includes(st) && (Number(pobConfig().dueFee) || 0) > 0,
      tasks: liveTasks(r).slice().sort((a, b) => (a.phase === b.phase ? 0 : a.phase === 'onboarding' ? -1 : 1) || (a.order || 0) - (b.order || 0))
        .map((t) => {
          const s = taskState(r, t, fig);
          return { id: t.id, title: t.title, kind: t.kind, phase: t.phase, required: t.required !== false, status: t.status || 'Not Started',
            dueDate: t.dueDate || '', open: s.open, reason: s.reason, evidence: t.evidence || '',
            needsReview: !!t.approval,
            maySubmit: s.open && t.kind === 'task' && ['Not Started', 'In Progress', 'Changes Required'].includes(t.status || 'Not Started'),
            reviews: (t.reviews || []).map((x) => ({ at: x.at, decision: x.decision, comments: x.comments || '', by: memberName(x.by) || 'Your mentor' })),
            lastNote: t.status === 'Changes Required' ? (((t.history || []).slice(-1)[0] || {}).note || '') : '' };
        }),
      figures: fig,
      clientJourney: { open: clientJourneyOpen(r),
        reason: clientJourneyOpen(r) ? '' : r.role ? 'Opens once every onboarding task of your role is approved.' : 'Opens once your role is confirmed and its onboarding tasks are approved.' },
    };
  }

  /* ---------- the partner's session ---------- */
  function issue(acctId) {
    const exp = Date.now() + SESSION_MS;
    return acctId + '.' + exp + '.' + sign('partner.' + acctId + '.' + exp);
  }
  function sessionAccount(req) {
    const tok = readCookie(req, PARTNER_COOKIE);
    if (!tok) return null;
    const [id, exp, sig] = String(tok).split('.');
    if (!/^\d+$/.test(id || '') || !/^\d+$/.test(exp || '') || !sig || Number(exp) < Date.now()) return null;
    const want = Buffer.from(sign('partner.' + id + '.' + exp));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
    const a = acctById.get(Number(id));
    return a && a.active ? a : null;
  }
  // The signed-in partner's record, or null — and the request is answered.
  function mine(req, res) {
    res.set('Cache-Control', 'no-store');
    const a = sessionAccount(req);
    if (!a) { res.status(401).json({ ok: false, message: 'Sign in again.' }); return null; }
    const list = storeList('pjOnboarding');
    const r = list.find((x) => x && !x.deletedAt && x.id === a.pob_id);
    if (!r) { res.status(404).json({ ok: false, message: 'Your onboarding record is not there any more. Speak to your RM.' }); return null; }
    if (r.login && r.login.status === 'Suspended') { res.status(403).json({ ok: false, message: 'Your account is suspended. Speak to your RM.' }); return null; }
    return { a, r, list };
  }
  function setCookie(req, res, acctId) {
    res.cookie(PARTNER_COOKIE, issue(acctId), { httpOnly: true, sameSite: 'lax', path: '/',
      secure: req.secure || req.get('x-forwarded-proto') === 'https', maxAge: SESSION_MS });
  }

  function page(title, body) {
    const b = branding();
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex"><title>${esc(title)} — ${esc(b.name)}</title>
<style>
  :root{--navy:#0F1B2D;--navy-2:#152541;--gold:#B9863E;--line:#E4E7EC;--text:#1B2233;--muted:#6B7280;--danger:#B3432B;--ok:#166534}
  *{box-sizing:border-box} body{margin:0;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Arial,sans-serif;color:var(--text);
    background:radial-gradient(900px 480px at 50% -10%,rgba(185,134,62,.22),transparent 70%),linear-gradient(165deg,var(--navy) 0%,var(--navy-2) 55%,#0B1524 100%);
    display:flex;align-items:center;justify-content:center;padding:32px 16px}
  .card{background:#fff;border-radius:14px;padding:32px 28px;width:100%;max-width:400px;box-shadow:0 24px 60px rgba(0,0,0,.38)}
  h1{font-size:19px;margin:0 0 4px} p.sub{margin:0 0 20px;color:var(--muted);font-size:13px}
  label{display:block;font-size:12.5px;font-weight:600;margin:12px 0 6px}
  input{width:100%;padding:12px 13px;font-size:15px;border:1px solid var(--line);border-radius:9px;font-family:inherit}
  input:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(185,134,62,.16)}
  button{width:100%;margin-top:18px;padding:12px;font-size:14.5px;font-weight:600;color:#fff;background:var(--navy);border:0;border-radius:9px;cursor:pointer;font-family:inherit}
  .msg{margin:0 0 14px;padding:10px 12px;border-radius:9px;font-size:13px;color:var(--danger);background:rgba(179,67,43,.08);border:1px solid rgba(179,67,43,.25)}
  .msg.ok{color:var(--ok);background:rgba(22,101,52,.08);border-color:rgba(22,101,52,.25)}
  .foot{font-size:12px;color:var(--muted);margin-top:16px;text-align:center}
</style></head><body><div class="card">${body}</div></body></html>`;
  }
  function loginPage(o) {
    return page('Partner sign in', `<h1>${esc(branding().name)} — Partner sign in</h1><p class="sub">For Freedom LifeX partners. Staff sign in at <a href="/login">/login</a>.</p>
      ${o.error ? `<p class="msg">${esc(o.error)}</p>` : ''}${o.info ? `<p class="msg ok">${esc(o.info)}</p>` : ''}
      <form method="POST" action="/partner/login">
        <label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="username" value="${esc(o.email || '')}" autofocus>
        <label for="password">Password</label><input id="password" name="password" type="password" required autocomplete="current-password">
        <button type="submit">Sign in</button></form>
      <div class="foot">Forgotten your password? Ask your RM to send you a new password link.</div>`);
  }
  function setupPage(o) {
    return page('Set your password', `<h1>Set your password</h1><p class="sub">${esc(o.email || '')}</p>
      ${o.error ? `<p class="msg">${esc(o.error)}</p>` : ''}
      <form method="POST" action="/partner/setup">
        <input type="hidden" name="t" value="${esc(o.token || '')}">
        <label for="password">New password</label><input id="password" name="password" type="password" minlength="8" required autocomplete="new-password" autofocus>
        <label for="confirm">Type it again</label><input id="confirm" name="confirm" type="password" minlength="8" required autocomplete="new-password">
        <button type="submit">Set password &amp; sign in</button></form>
      <div class="foot">At least 8 characters.</div>`);
  }

  app.get('/partner/login', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (sessionAccount(req)) return res.redirect('/partner');
    res.type('html').send(loginPage({ info: req.query.out ? 'You are signed out.' : '' }));
  });
  app.post('/partner/login', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const ip = req.ip || 'unknown';
    const email = String((req.body || {}).email || '').trim();
    if (tooManyAttempts(ip)) return res.status(429).type('html').send(loginPage({ email, error: 'Too many attempts. Wait a few minutes and try again.' }));
    const a = acctByEmail.get(email);
    const pw = String((req.body || {}).password || '');
    if (!a || !a.active || !a.password_hash || !passwordMatches(pw, a.password_hash)) {
      noteFailure(ip);
      return res.status(401).type('html').send(loginPage({ email, error: 'That email and password do not match.' }));
    }
    forgiveAttempts(ip);
    noteAcctLogin.run(a.id);
    setCookie(req, res, a.id);
    res.redirect('/partner');
  });
  function setupAccount(token) {
    if (!token || String(token).length < 20) return null;
    const a = acctBySetup.get(sha(token));
    return a && a.active && a.setup_expires && a.setup_expires > Date.now() ? a : null;
  }
  app.get('/partner/setup', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const a = setupAccount(String(req.query.t || ''));
    if (!a) return res.status(404).type('html').send(loginPage({ error: 'That password link has expired or been used. Ask your RM for a new one.' }));
    res.type('html').send(setupPage({ token: req.query.t, email: a.email }));
  });
  app.post('/partner/setup', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const b = req.body || {};
    const a = setupAccount(String(b.t || ''));
    if (!a) return res.status(404).type('html').send(loginPage({ error: 'That password link has expired or been used. Ask your RM for a new one.' }));
    const pw = String(b.password || '');
    if (pw.length < 8) return res.status(400).type('html').send(setupPage({ token: b.t, email: a.email, error: 'Use at least 8 characters.' }));
    if (pw !== String(b.confirm || '')) return res.status(400).type('html').send(setupPage({ token: b.t, email: a.email, error: 'The two passwords are not the same.' }));
    updateAcctPassword.run(hashPassword(pw), a.id);
    noteAcctLogin.run(a.id);
    setCookie(req, res, a.id);
    res.redirect('/partner');
  });
  const signOut = (req, res) => { res.clearCookie(PARTNER_COOKIE, { path: '/' }); res.redirect('/partner/login?out=1'); };
  app.post('/partner/logout', signOut);
  app.get('/partner/logout', signOut);
  app.get('/partner', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!sessionAccount(req)) return res.redirect('/partner/login');
    res.sendFile(path.join(publicDir, 'partner-portal.html'));
  });

  /* ---------- the firm's side: making and stopping an account ----------
     Asked for by BOSS, so signed in to BOSS and carrying its key. */
  function staffOnly(req, res) {
    if (!signedInUser(req)) { res.status(401).json({ ok: false, message: 'not signed in' }); return false; }
    return true;
  }
  app.post('/api/partner-portal/accounts', (req, res, next) => {
    if (!staffOnly(req, res)) return;
    checkApiKey(req, res, next);
  }, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const b = req.body || {};
    const r = storeList('pjOnboarding').find((x) => x && !x.deletedAt && x.id === b.pobId);
    if (!r) return res.status(404).json({ ok: false, message: 'No such onboarding record.' });
    const email = checkValue('email', b.email);
    if (!email.ok || !email.value) return res.status(400).json({ ok: false, message: 'The login has to be an email address.' });
    const clash = acctByEmail.get(email.value);
    if (clash && clash.pob_id !== r.id) return res.status(409).json({ ok: false, message: email.value + ' is already another partner’s login.' });
    const token = crypto.randomBytes(24).toString('base64url');
    const had = acctByPob.get(r.id);
    if (had) updateAcctSetup.run(email.value, sha(token), Date.now() + SETUP_MS, had.id);
    else insertAcct.run(r.id, email.value, sha(token), Date.now() + SETUP_MS);
    if (had && !had.active) updateAcctActive.run(1, had.id);
    res.json({ ok: true, setupUrl: origin(req) + '/partner/setup?t=' + encodeURIComponent(token), loginUrl: origin(req) + '/partner',
      email: email.value, existing: !!had });
  });
  app.post('/api/partner-portal/accounts/status', (req, res, next) => {
    if (!staffOnly(req, res)) return;
    checkApiKey(req, res, next);
  }, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const a = acctByPob.get(String((req.body || {}).pobId || ''));
    if (!a) return res.status(404).json({ ok: false, message: 'This partner has no login yet.' });
    updateAcctActive.run((req.body || {}).active === false ? 0 : 1, a.id);
    res.json({ ok: true });
  });

  /* ---------- the partner's own answers ---------- */
  app.get('/api/partner-portal/me', (req, res) => {
    const m = mine(req, res);
    if (!m) return;
    res.json(Object.assign({ ok: true, login: m.a.email }, partnerView(m.r, req)));
  });
  app.post('/api/partner-portal/password', (req, res) => {
    const m = mine(req, res);
    if (!m) return;
    const b = req.body || {};
    if (!m.a.password_hash || !passwordMatches(String(b.current || ''), m.a.password_hash)) return res.status(400).json({ ok: false, message: 'Your current password is not right.' });
    if (String(b.next || '').length < 8) return res.status(400).json({ ok: false, message: 'Use at least 8 characters for the new password.' });
    updateAcctPassword.run(hashPassword(String(b.next)), m.a.id);
    res.json({ ok: true });
  });
  /* A file the partner puts in: a receipt here. The empanelment form has
     its own, on its token. */
  function takeFile(b, extra) {
    const mime = String(b.mime || '');
    if (!pj.docs.types[mime]) return { error: 'Only PDF, PNG, JPG, WEBP or Word files can be uploaded.' };
    const buf = Buffer.from(String(b.data || '').replace(/^data:[^,]*,/, ''), 'base64');
    if (!buf.length) return { error: 'The file is empty.' };
    if (buf.length > pj.docs.max) return { error: 'The file is larger than 5 MB.' };
    try { return { id: pj.docs.store(buf, mime, b.name, extra), name: String(b.name || 'document').slice(0, 200), size: buf.length, mime }; } catch (e) {
      return { error: 'The file could not be stored: ' + e.message };
    }
  }
  app.post('/api/partner-portal/upload', (req, res) => {
    const m = mine(req, res);
    if (!m) return;
    const f = takeFile(req.body || {}, { pobId: m.r.id, via: 'portal' });
    if (f.error) return res.status(400).json({ ok: false, message: f.error });
    res.json({ ok: true, id: f.id, name: f.name, size: f.size, mime: f.mime });
  });
  app.get('/api/partner-portal/files/:id', (req, res) => {
    const m = mine(req, res);
    if (!m) return;
    if (!fileIsTheirs(m.r, String(req.params.id))) return res.status(404).json({ ok: false, message: 'No such document.' });
    pj.docs.send(res, String(req.params.id));
  });

  /* The partner records the due payment they made. It goes to their
     mapped RM to verify against the bank, never counted on their word. */
  app.post('/api/partner-portal/payments', async (req, res) => {
    const m = mine(req, res);
    if (!m) return;
    const { r, list } = m;
    if (!['duePayment', 'paymentAck'].includes(stageOf(r))) return res.status(400).json({ ok: false, message: 'There is no payment due from you now.' });
    const b = req.body || {};
    const amount = Number(b.amount);
    const ref = String(b.ref || '').trim();
    if (!(amount > 0)) return res.status(400).json({ ok: false, message: 'Enter the amount you paid.' });
    if (!ref) return res.status(400).json({ ok: false, message: 'Enter the transaction reference / UTR — the payment cannot be verified without it.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))) return res.status(400).json({ ok: false, message: 'Enter the date you paid.' });
    const methods = ['UPI', 'Bank Transfer', 'Card', 'Cheque', 'Cash', 'Payment Gateway'];
    if (!methods.includes(b.method)) return res.status(400).json({ ok: false, message: 'Choose how you paid.' });
    const taken = list.some((x) => x && !x.deletedAt && (x.payments || []).some((p) => String(p.ref || '').trim().toUpperCase() === ref.toUpperCase() && p.status !== 'Failed'));
    if (taken) return res.status(409).json({ ok: false, message: 'That reference is already recorded. A transaction can be counted once — speak to your RM if this is a mistake.' });
    if (b.receiptFileId && !fileIsTheirs(r, b.receiptFileId)) return res.status(400).json({ ok: false, message: 'The receipt was not uploaded from your login.' });
    const at = nowIso();
    const verifierIds = verifiersFor('Partner', r.assignedTo);
    const p = { id: uid('PAY'), amount, currency: pobConfig().currency || 'INR', method: b.method, ref, date: b.date, payer: String(b.payer || nameOf(r)).slice(0, 200),
      status: 'Under Review', recordedBy: 'Partner', recordedAt: at, verifierIds,
      receiptFileId: b.receiptFileId || '', receiptName: b.receiptName ? String(b.receiptName).slice(0, 200) : '',
      history: [{ at, by: 'Partner', status: 'Under Review', note: 'Recorded by the partner · ' + amount + ' · ' + b.method + ' · ' + ref }] };
    r.payments = (r.payments || []).concat([p]);
    putList('pjOnboarding', list);
    audit(r.id, 'Payment Recorded', [{ field: 'payment', oldValue: '', newValue: ref + ' · ' + amount + ' (by the partner)' }]);
    writeToDisk();
    res.json({ ok: true });
    await askVerifiers(verifierIds, { what: 'A due payment', name: nameOf(r), recordId: r.id, by: nameOf(r) + ' (the partner)',
      details: amount + ' ' + p.currency + ' · ' + b.method + ' · ' + ref + ' · paid ' + b.date, link: origin(req) + '/' });
  });

  /* The partner submits a task for their mentor. One that needs no review
     is done when they say so; the next one opens by itself either way. */
  app.post('/api/partner-portal/tasks/:id/submit', async (req, res) => {
    const m = mine(req, res);
    if (!m) return;
    const { r, list } = m;
    const t = (r.tasks || []).find((x) => x.id === req.params.id && !x.retired);
    if (!t) return res.status(404).json({ ok: false, message: 'No such task.' });
    const s = taskState(r, t);
    if (!s.open) return res.status(400).json({ ok: false, message: '“' + t.title + '” is not open yet: ' + s.reason + '.' });
    if (t.kind !== 'task') return res.status(400).json({ ok: false, message: 'Your RM records this one for you.' });
    if (!['Not Started', 'In Progress', 'Changes Required'].includes(t.status || 'Not Started')) {
      return res.status(400).json({ ok: false, message: '“' + t.title + '” is ' + t.status + ' already.' });
    }
    const evidence = String((req.body || {}).evidence || '').trim().slice(0, 4000);
    if (!evidence) return res.status(400).json({ ok: false, message: 'Say what you did — a note or a link to your work. Your mentor reads it.' });
    const at = nowIso();
    t.evidence = evidence;
    t.startedAt = t.startedAt || at;
    if (t.approval) {
      t.status = 'Pending Review'; t.submittedAt = at; t.submittedBy = 'Partner';
      t.history = (t.history || []).concat([{ at, by: 'Partner', status: 'Pending Review', note: evidence }]);
    } else {
      t.status = 'Approved'; t.approvedAt = at; t.approvedBy = 'Partner';
      t.history = (t.history || []).concat([{ at, by: 'Partner', status: 'Approved', note: 'Done — needs no review. ' + evidence }]);
    }
    const opened = refreshTasks(r);
    putList('pjOnboarding', list);
    audit(r.id, 'Task ' + t.status, [{ field: t.title, oldValue: '', newValue: t.status + ' (by the partner)' }]);
    writeToDisk();
    res.json({ ok: true, status: t.status, opened: opened.map((x) => x.title) });
    const mentor = r.mentorId || r.assignedTo;
    if (t.status === 'Pending Review' && mentor) {
      await askVerifiers([mentor], { what: 'A task for review', name: nameOf(r), recordId: r.id, by: nameOf(r) + ' (the partner)',
        details: t.title + '\n' + evidence, link: origin(req) + '/' });
    } else if (opened.length && r.assignedTo) {
      putList('notifications', storeList('notifications').concat([{ id: uid('NTF'), at, userId: r.assignedTo, title: nameOf(r) + ': ' + opened.length + ' task(s) open',
        body: opened.map((x) => x.title).slice(0, 3).join(' · '), view: 'pob', arg: r.id, kind: 'pob', by: 'Partner' }]));
      writeToDisk();
    }
  });

  /* ---------- the Client Journey, from the partner's side ----------
     A lead the partner brings is an ordinary LMS lead, owned by their RM,
     carrying who brought it (partnerPobId). It travels to CMS with that
     mark when it converts, which is what the figures count. */
  function leadsView(r) {
    const saved = ((config().blueprints || {}).LMS || {}).states || [];
    const savedCms = ((config().blueprints || {}).CMS || {}).states || [];
    const label = (states, id) => { const s = states.find((x) => x && x.id === id); return s ? s.label : humanize(id); };
    const leads = storeList('leads').filter((l) => l && !l.deletedAt && l.partnerPobId === r.id).map((l) => ({
      id: l.id, name: nameOf(l), mobile: l.mobile || '', email: l.email || '', city: l.city || '', interest: l.productInterest || '',
      notes: l.description || '', stage: label(saved, l.status || 'created'), client: false, createdAt: l.createdAt || '',
      editable: LEAD_STATUSES_OPEN_TO_EDIT.includes(l.status || 'created') }));
    const clients = storeList('clients').filter((c) => c && !c.deletedAt && c.partnerPobId === r.id).map((c) => ({
      id: c.id, name: c.cmsName || nameOf(c), mobile: c.mobile || '', email: c.email || '', city: c.city || '', interest: c.productInterest || '',
      notes: '', stage: 'Client — ' + label(savedCms, c.cmsStage || 'clientCreated'), client: true, createdAt: c.lmsCreatedAt || c.createdAt || '', editable: false }));
    return leads.concat(clients).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  app.get('/api/partner-portal/leads', (req, res) => {
    const m = mine(req, res);
    if (!m) return;
    if (!clientJourneyOpen(m.r)) return res.status(403).json({ ok: false, message: 'The Client Journey opens once your onboarding tasks are approved.' });
    res.json({ ok: true, leads: leadsView(m.r), figures: metrics(m.r) });
  });
  const LEAD_FIELDS = [
    { k: 'firstName', l: 'First name', req: 1 }, { k: 'lastName', l: 'Last name' },
    { k: 'mobile', l: 'Mobile', vk: 'mobile', req: 1 }, { k: 'email', l: 'Email', vk: 'email' },
    { k: 'city', l: 'City' }, { k: 'productInterest', l: 'Interested in' }, { k: 'description', l: 'Notes' },
  ];
  function readLead(b) {
    const out = {};
    for (const f of LEAD_FIELDS) {
      const got = checkValue(f.vk, b[f.k]);
      if (!got.ok) return { error: f.l + ' ' + got.message + '.' };
      if (f.req && !got.value) return { error: f.l + ' is needed.' };
      out[f.k] = got.value;
    }
    return { data: out };
  }
  app.post('/api/partner-portal/leads', (req, res) => {
    const m = mine(req, res);
    if (!m) return;
    const { r } = m;
    if (!clientJourneyOpen(r)) return res.status(403).json({ ok: false, message: 'The Client Journey opens once your onboarding tasks are approved.' });
    const got = readLead(req.body || {});
    if (got.error) return res.status(400).json({ ok: false, message: got.error });
    const leads = storeList('leads');
    const dupe = leads.find((l) => l && !l.deletedAt && String(l.mobile || '').replace(/\D/g, '').slice(-10) === got.data.mobile);
    if (dupe) return res.status(409).json({ ok: false, message: dupe.partnerPobId === r.id ? 'You have added this person already.' : 'This person is already with the firm as a lead.' });
    const at = nowIso();
    const lead = Object.assign({ id: uid('LMS') }, got.data, { source: 'Partner', referredBy: nameOf(r) + (r.partnerCode ? ' (' + r.partnerCode + ')' : ''),
      partnerPobId: r.id, partnerCode: r.partnerCode || '', assignedTo: r.assignedTo || '', branch: r.branch || '',
      createdAt: at, createdBy: 'Partner', status: 'created', blueprintHistory: [{ state: 'created', at, by: 'Partner', via: 'Added by the partner' }] });
    putList('leads', leads.concat([lead]));
    putList('auditLog', storeList('auditLog').concat([{ id: uid('AUD'), at, by: 'Partner', module: 'LMS', recordId: lead.id, action: 'Create',
      details: [{ field: 'from partner', oldValue: r.partnerCode || r.id, newValue: nameOf(lead) }] }]));
    if (r.assignedTo) putList('notifications', storeList('notifications').concat([{ id: uid('NTF'), at, userId: r.assignedTo,
      title: 'New lead from ' + nameOf(r) + ': ' + nameOf(lead), body: lead.mobile + (lead.city ? ' · ' + lead.city : ''), view: 'lms', arg: lead.id, kind: 'lead', by: 'Partner' }]));
    writeToDisk();
    res.json({ ok: true, id: lead.id, figures: metrics(r) });
  });
  app.put('/api/partner-portal/leads/:id', (req, res) => {
    const m = mine(req, res);
    if (!m) return;
    const { r } = m;
    if (!clientJourneyOpen(r)) return res.status(403).json({ ok: false, message: 'The Client Journey opens once your onboarding tasks are approved.' });
    const leads = storeList('leads');
    const l = leads.find((x) => x && !x.deletedAt && x.id === req.params.id && x.partnerPobId === r.id);
    if (!l) return res.status(404).json({ ok: false, message: 'No such lead of yours.' });
    if (!LEAD_STATUSES_OPEN_TO_EDIT.includes(l.status || 'created')) return res.status(400).json({ ok: false, message: 'Your RM is working with this lead now; ask them to change it.' });
    const got = readLead(Object.assign({}, l, req.body || {}));
    if (got.error) return res.status(400).json({ ok: false, message: got.error });
    const before = {};
    Object.keys(got.data).forEach((k) => { before[k] = l[k]; l[k] = got.data[k]; });
    l.updatedAt = nowIso();
    putList('leads', leads);
    putList('auditLog', storeList('auditLog').concat([{ id: uid('AUD'), at: l.updatedAt, by: 'Partner', module: 'LMS', recordId: l.id, action: 'Edit',
      details: Object.keys(got.data).filter((k) => String(before[k] || '') !== String(got.data[k] || '')).map((k) => ({ field: k, oldValue: String(before[k] || ''), newValue: String(got.data[k] || '') })) }]));
    writeToDisk();
    res.json({ ok: true });
  });

  /* ---------- the partner's own performance ----------
     Target against achievement, counted by the same code the CRM's
     Partner Journey › Performance uses, on this partner's records only. */
  app.get('/api/partner-portal/performance', (req, res) => {
    const m = mine(req, res);
    if (!m) return;
    const { r } = m;
    const savedCms = (((config().blueprints || {}).CMS || {}).states || []).map((x) => x && x.id).filter(Boolean);
    const src = { leads: storeList('leads'), clients: storeList('clients'), transactions: storeList('transactions'), reviews: storeList('reviews'),
      partnerReviews: storeList('pjReviews'), cmsOrder: savedCms.length ? savedCms : CMS_ORDER };
    const card = PartnerTargets.scorecard(r, src, PartnerTargets.roleTargets(config().partnerTargets), nowIso().slice(0, 10));
    const reviews = storeList('pjReviews').filter((x) => x && !x.deletedAt && x.pobId === r.id);
    const last = reviews.filter((x) => x.status === 'Completed').sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')))[0];
    const next = reviews.filter((x) => x.status !== 'Completed').sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')))[0];
    res.json(Object.assign({ ok: true, today: nowIso().slice(0, 10),
      lastReview: last ? { kind: last.kind, at: last.completedAt, outcome: last.outcome || '', targets: last.targets || '' } : null,
      nextReview: next ? { kind: next.kind, due: next.dueDate } : null }, card));
  });

  /* ---------- the one empanelment form ---------- */
  function recordByFormToken(token, list) {
    if (!token || String(token).length < 16) return null;
    return (list || storeList('pjOnboarding')).find((x) => x && !x.deletedAt && x.empFormToken === token) || null;
  }
  function pmsPartnerOf(r) { return storeList('pjPartners').find((p) => p && p.id === r.partnerId) || {}; }
  // What the form opens with: the last answers, else what the firm has.
  function formValues(r) {
    const pms = pmsPartnerOf(r);
    const adm = pms.admissionForm1 || pms.admissionForm2 || {};
    const had = (r.empForm && r.empForm.answers) || {};
    const from = { dob: adm.afDob, qualification: adm.afQualification, occupation: adm.afOccupation || pms.occupation, experience: adm.afExperience,
      arn: pms.arn, arnMobile: pms.arnMobile, euin: pms.euin, euinMobile: pms.euinMobile, bankHolder: nameOf(r) };
    const out = {};
    EMP_FIELDS.forEach((f) => {
      const v = had[f.k] !== undefined ? had[f.k] : r[f.k] !== undefined && r[f.k] !== '' ? r[f.k] : from[f.k];
      out[f.k] = v === undefined || v === null ? '' : String(v);
    });
    return out;
  }
  function formDocs(r) {
    const docs = docsOf(r);
    return docChecklist().filter((c) => c.type !== SIGNED_AGREEMENT).map((c) => {
      const d = docs.find((x) => x.type === c.type);
      const last = d && (d.versions || []).slice(-1)[0];
      const rej = d && (d.reviews || []).slice().reverse().find((x) => x.decision === 'Rejected');
      return { type: c.type, mandatory: c.mandatory, status: d ? d.status : 'Not Submitted', file: last ? last.name : '',
        reason: d && d.status === 'Rejected' && rej ? rej.reason || '' : '' };
    });
  }
  app.get('/empanelment', (req, res) => {
    res.set('Cache-Control', 'no-store').sendFile(path.join(publicDir, 'empanelment-form.html'));
  });
  app.get('/api/public/pob-form', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const r = recordByFormToken(String(req.query.token || ''));
    if (!r) return res.status(404).json({ ok: false, message: 'This link is not valid any more. Ask your RM for a new one.' });
    const st = stageOf(r);
    const c = pobConfig();
    const last = (r.attempts || []).slice(-1)[0];
    const ag = r.agreement || {};
    res.json({ ok: true, firm: pj.firmName(config()), name: nameOf(r), partnerCode: r.partnerCode || '', applicationId: r.applicationId || '',
      open: st === 'empanelment',
      state: st === 'empanelment' ? (last && last.decision === 'More Information Requested' ? 'moreInfo' : r.empFormSubmittedAt ? 'resubmit' : 'new')
        : ['evaluation'].includes(st) ? 'underReview' : ['duePayment', 'paymentAck'].includes(st) ? 'notYet' : 'done',
      moreInfo: last && last.decision === 'More Information Requested' ? last.reason || '' : '',
      sections: EMP_SECTIONS, values: formValues(r), docs: formDocs(r),
      agreement: { text: c.agreement, version: agreementVersion(c.agreement), types: AGREEMENT_TYPES,
        signedRequired: docChecklist().some((x) => x.type === SIGNED_AGREEMENT),
        accepted: ag.acceptedAt ? { types: ag.types || [], method: ag.evidence === 'Signed copy uploaded' ? 'upload' : 'online', signedName: ag.signedName || '' } : null },
      submittedAt: r.empFormSubmittedAt || '' });
  });
  app.post('/api/public/pob-form/upload', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const r = recordByFormToken(String(req.query.token || ''));
    if (!r) return res.status(404).json({ ok: false, message: 'This link is not valid any more.' });
    if (stageOf(r) !== 'empanelment') return res.status(400).json({ ok: false, message: 'This form is not open for changes now.' });
    const f = takeFile(req.body || {}, { pobId: r.id, via: 'empanelment' });
    if (f.error) return res.status(400).json({ ok: false, message: f.error });
    res.json({ ok: true, id: f.id, name: f.name, size: f.size, mime: f.mime });
  });
  app.post('/api/public/pob-form', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const list = storeList('pjOnboarding');
    const r = recordByFormToken(String(req.query.token || ''), list);
    if (!r) return res.status(404).json({ ok: false, message: 'This link is not valid any more.' });
    if (stageOf(r) !== 'empanelment') return res.status(400).json({ ok: false, message: 'Your application is with our team already, so the form cannot be changed now.' });
    const b = req.body || {};
    const given = b.values || {};
    const answers = {};
    for (const f of EMP_FIELDS) {
      const got = checkValue(f.vk, given[f.k]);
      if (!got.ok) return res.status(400).json({ ok: false, field: f.k, message: f.l + ' ' + got.message + '.' });
      let v = got.value;
      if (f.opts && v && !f.opts.includes(v)) v = '';
      if (f.req && !v) return res.status(400).json({ ok: false, field: f.k, message: f.l + ' is needed.' });
      answers[f.k] = v;
    }
    for (const [num, mob, what] of [['arn', 'arnMobile', 'ARN'], ['euin', 'euinMobile', 'EUIN']]) {
      if (answers[num] && !answers[mob]) return res.status(400).json({ ok: false, field: mob, message: 'Give the mobile your ' + what + ' is registered to.' });
    }
    const email = answers.email, phone = answers.mobile;
    const dup = list.find((x) => x && !x.deletedAt && x.id !== r.id && ((email && String(x.email || '').trim().toLowerCase() === email)
      || (phone && String(x.mobile || '').replace(/\D/g, '').slice(-10) === phone)));
    if (dup) return res.status(409).json({ ok: false, message: 'This email or mobile is already registered with another empanelment. Speak to your RM.' });

    // The documents: each mandatory one on file and not rejected, or uploaded now.
    const uploads = b.docs || {};
    const docsNow = formDocs(r);
    for (const d of docsNow) {
      const fileId = uploads[d.type];
      if (fileId) {
        const meta = pj.docs.meta(fileId);
        if (!meta || meta.pobId !== r.id || meta.via !== 'empanelment') return res.status(400).json({ ok: false, message: 'Upload the ' + d.type + ' again — the file did not arrive.' });
        continue;
      }
      if (d.mandatory && ['Not Submitted', 'Rejected'].includes(d.status)) {
        return res.status(400).json({ ok: false, doc: d.type, message: d.status === 'Rejected' ? 'Upload a new ' + d.type + ' — the last one was not accepted' + (d.reason ? ': ' + d.reason : '.') : 'Upload your ' + d.type + '.' });
      }
    }
    // The agreement: what is agreed to, and how.
    const a = b.agreement || {};
    const types = (Array.isArray(a.types) ? a.types : []).filter((x) => AGREEMENT_TYPES.includes(x));
    if (!types.length) return res.status(400).json({ ok: false, section: 'agreement', message: 'Tick the agreements you are signing — at least one.' });
    const signedName = String(a.signedName || '').trim().slice(0, 200);
    if (!signedName) return res.status(400).json({ ok: false, section: 'agreement', message: 'Type your full name as your signature.' });
    if (a.method === 'upload') {
      const meta = a.fileId ? pj.docs.meta(a.fileId) : null;
      if (!meta || meta.pobId !== r.id) return res.status(400).json({ ok: false, section: 'agreement', message: 'Upload your signed agreement — you chose to upload it, so the signed copy is required.' });
    } else if (a.method === 'online') {
      if (!a.consent) return res.status(400).json({ ok: false, section: 'agreement', message: 'Tick “I have read and accept the agreement” to accept it online.' });
    } else return res.status(400).json({ ok: false, section: 'agreement', message: 'Choose how you accept the agreement.' });
    if (!b.declaration) return res.status(400).json({ ok: false, message: 'Tick the declaration at the end of the form.' });

    const at = nowIso();
    const again = !!r.empFormSubmittedAt;
    const before = {};
    ['firstName', 'lastName', 'email', 'mobile', 'address', 'city', 'pan', 'proposedRole', 'bankName', 'bankAccount', 'bankIfsc'].forEach((k) => {
      before[k] = r[k];
      if (answers[k] !== '') r[k] = answers[k];
    });
    ['dob', 'gender', 'fatherName', 'qualification', 'occupation', 'state', 'pincode', 'aadhaarLast4', 'arn', 'arnMobile', 'euin', 'euinMobile',
      'experience', 'bankHolder', 'nomineeName', 'nomineeRelation'].forEach((k) => { r[k] = answers[k]; });
    r.empForm = { answers, submittedAt: at };
    r.empFormSubmittedAt = at;
    r.empFormHistory = (r.empFormHistory || []).concat([{ at, what: again ? 'Re-submitted' : 'Submitted' }]);
    r.empanelmentSavedAt = at;
    r.updatedAt = at; r.updatedBy = 'Partner';
    const c = pobConfig();
    r.agreement = { acceptedAt: at, by: 'Partner', signedName, version: agreementVersion(c.agreement), types,
      evidence: a.method === 'upload' ? 'Signed copy uploaded' : 'Accepted online by the partner', signedFileId: a.method === 'upload' ? a.fileId : '' };

    // Every file becomes a version of its document, as an upload in BOSS does.
    const docs = storeList('pjDocuments');
    const addVersion = (type, fileId, note) => {
      const meta = pj.docs.meta(fileId) || {};
      let d = docs.find((x) => x && !x.deletedAt && x.pobId === r.id && x.type === type);
      if (!d) { d = { id: uid('PDOC'), pobId: r.id, type, versions: [], reviews: [], status: 'Not Submitted', createdAt: at }; docs.push(d); }
      const was = d.status;
      d.versions = (d.versions || []).concat([{ v: (d.versions || []).length + 1, fileId, name: meta.name || type, size: meta.size || 0, mime: meta.mime || '',
        uploadedAt: at, uploadedBy: 'Partner', note: note || '' }]);
      d.status = was === 'Rejected' ? 'Resubmitted' : 'Submitted';
      d.submittedAt = at;
      d.reviews = (d.reviews || []).concat([{ at, by: 'Partner', decision: d.status, reason: note || '' }]);
    };
    docsNow.forEach((d) => { if (uploads[d.type]) addVersion(d.type, uploads[d.type], 'From the empanelment form'); });
    if (a.method === 'upload') addVersion(SIGNED_AGREEMENT, a.fileId, 'Signed agreement, from the empanelment form');

    /* And the application goes for evaluation, to the onboarding owner's
       reporting manager or an administrator, as obSubmitT sends it. */
    const evaluatorIds = verifiersFor(r.assignedTo);
    r.pobStage = 'evaluation';
    r.blueprintHistory = (r.blueprintHistory || []).concat([{ state: 'evaluation', at, by: 'Partner', via: 'Empanelment form submitted by the partner' }]);
    r.applicationStatus = 'Under Review';
    r.submittedAt = at; r.submittedBy = 'Partner'; r.evaluatorIds = evaluatorIds;
    r.attempts = (r.attempts || []).concat([{ n: (r.attempts || []).length + 1, submittedAt: at, submittedBy: 'Partner' }]);
    docs.filter((d) => d && !d.deletedAt && d.pobId === r.id && ['Submitted', 'Resubmitted'].includes(d.status)).forEach((d) => {
      d.status = 'Under Review';
      d.reviews = (d.reviews || []).concat([{ at, by: 'Partner', decision: 'Under Review', reason: 'Application submitted' }]);
    });
    putList('pjDocuments', docs);
    putList('pjOnboarding', list);
    const changed = Object.keys(before).filter((k) => answers[k] !== '' && String(before[k] || '') !== answers[k]);
    audit(r.id, 'Empanelment form ' + (again ? 're-submitted' : 'submitted') + ' by the partner',
      changed.map((k) => ({ field: k, oldValue: String(before[k] || ''), newValue: answers[k] })).concat([{ field: 'stage', oldValue: 'Empanelment', newValue: 'Evaluation' }]));
    if (r.assignedTo) putList('notifications', storeList('notifications').concat([{ id: uid('NTF'), at, userId: r.assignedTo,
      title: 'Empanelment form ' + (again ? 're-submitted' : 'submitted') + ' by ' + nameOf(r), body: (r.applicationId || '') + ' has gone for evaluation.',
      view: 'pob', arg: r.id, kind: 'submission', by: 'Partner' }]));
    writeToDisk();
    res.json({ ok: true });
    await askVerifiers(evaluatorIds, { what: 'An empanelment for evaluation', name: nameOf(r),
      recordId: r.id, by: nameOf(r) + ' (the partner)', link: origin(req) + '/',
      details: (r.applicationId || '') + ' · partner code ' + (r.partnerCode || '') + ' · attempt ' + r.attempts.length });
  });

  return { sessionAccount, verifiersFor, metrics };
}

module.exports = { install, EMP_SECTIONS, AGREEMENT_TYPES };
