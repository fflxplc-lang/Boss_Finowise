/* THE EMPANELMENT FORM (B2B changes 3).

   One page carries the Freedom LifeX form, the documents and the
   partner agreement, filled in with what the firm already has. It is
   sent by email or WhatsApp from POB and served on a token of its own
   (/empanelment?t=…), like the prospect's form. Submitting it writes the
   answers, the documents and the agreement onto the onboarding record
   and sends the application for evaluation to the onboarding owner's
   reporting manager, or to an administrator.

   There was a separate partner login here (/partner) for a while. It is
   gone: an active partner signs in to BOSS itself and works there as far
   as their level opens (public/partner-levels.js, Setup › Partner
   Levels), so nothing of the partner's own pages is served from here.

   Records are read and written in the same store as the rest of the
   CRM, and every write is published, so an open BOSS screen redraws. */
const path = require('path');

/* What the CRM ships, for a store that has not been through POB ›
   Settings. The same text as POB_SETTINGS_DEFAULTS in index.html. */
const POB_DEFAULTS = {
  dueFee: 0, currency: 'INR', taskDueDays: 7,
  docs: 'PAN Card*\nAadhaar Card*\nCancelled Cheque*\nPassport Photograph*\nSigned Agreement*\nQualification Certificate',
  agreement: 'I agree to work as a Freedom LifeX partner on the terms of the Freedom LifeX partner agreement, to follow its code of conduct and the regulations that apply to the products I distribute, and to keep client information confidential.',
};
const AGREEMENT_TYPES = ['Mutual Fund Agreement', 'Wealth Agreement', 'Broker Agreement'];
const SIGNED_AGREEMENT = 'Signed Agreement';

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
function lines(text) { return String(text || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean); }
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
  const { app, storeList, storeValue, putList, writeToDisk, pj, publicDir } = deps;

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

  /* ---------- the onboarding record ---------- */
  function stageOf(r) { return r.pobStage || 'duePayment'; }
  function docChecklist() {
    return lines(pobConfig().docs).map((l) => ({ type: l.replace(/\*+$/, '').trim(), mandatory: /\*$/.test(l) }));
  }
  function docsOf(r) { return storeList('pjDocuments').filter((d) => d && !d.deletedAt && d.pobId === r.id); }
  /* A file put in on the empanelment form, kept as a document of the record. */
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

  return { verifiersFor };
}

module.exports = { install, EMP_SECTIONS, AGREEMENT_TYPES };
