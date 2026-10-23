/* THE PARTNER JOURNEY'S SERVER HALF.

   Three things the browser cannot do for itself, because they have to
   happen whether or not anybody has the CRM open:

   1. The session reminders. Two days before a webinar, every prospect
      registered for it is written to twice a day, and 24 hours before it
      they get the joining link. A reminder that waits for somebody to open
      a tab is not a reminder.
   2. The ARN / EUIN expiry warnings. From six months before an onboarded
      partner's ARN or EUIN runs out, their RM is told once a week, and the
      partner is written to.
   3. The prospect's own form. The acknowledgement email carries a link to
      the registration form, filled in with what is on file; the prospect
      corrects it, adds to it and sends it back, and it lands on their
      record. It has no account behind it, so it is served on its token.

   4. Partner Onboarding's documents and reviews. A partner's PAN, cheque
      and signed agreement are kept on the server, outside the public
      folder, and are served only to a signed-in session. A recurring
      review that falls overdue is put in its owner's bell once a day.

   Everything is read from and written to the same store as the rest of
   the CRM, and every write is published, so an open screen redraws. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const IST_OFFSET_MIN = 330;
const DAY = 86400000;

/* The wording the server sends when the firm has not written its own.
   The same text the CRM ships in Setup › Email Templates, which is where
   the firm edits it. */
const DEFAULT_TEMPLATES = {
  pjReminder: {subject: 'Reminder: {Webinar} on {Date}',
    body: 'Dear {Name},\n\nThis is a reminder that you are registered for "{Webinar}".\n\n📅 Date: {Date}\n⏰ Time: {Time}\n\nThe session is {DaysToGo} away. The joining link will reach you 24 hours before it starts.\n\nWe look forward to seeing you there.\n\n{Signature}'},
  pjJoiningLink: {subject: 'Your joining link for {Webinar} — {Date}',
    body: 'Dear {Name},\n\n"{Webinar}" starts in 24 hours.\n\n📅 Date: {Date}\n⏰ Time: {Time}\n🔗 Joining Link: {JoiningLink}\n\nPlease join a few minutes early.\n\n{Signature}'},
  pjArnExpiry: {subject: 'Your {What} expires on {ExpiresOn}',
    body: 'Dear {Name},\n\nYour {What} ({Number}) is valid until {ExpiresOn} — {DaysLeft} days from today.\n\nPlease start the renewal now so your work as a partner is not interrupted, and send us the renewed details once you have them.\n\n{Signature}'},
};

function fill(str, vars) {
  return String(str || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
}
function uid(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 7).toUpperCase() + Date.now().toString().slice(-4);
}
function pjName(r) { return r ? ((r.firstName || '') + ' ' + (r.lastName || '')).trim() || r.id : ''; }

/* "7:00 PM", "7 pm", "19:00" — the webinar's time is typed, so it is read
   leniently. Nothing readable is taken as 10 in the morning, which is the
   hour a session with no time is most likely to be. */
function parseClock(text) {
  const s = String(text || '').trim().toLowerCase();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/);
  if (!m) return { h: 10, m: 0, known: false };
  let h = Number(m[1]); const mi = Number(m[2] || 0);
  const ampm = (m[3] || '').replace(/\./g, '');
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (h > 23 || mi > 59) return { h: 10, m: 0, known: false };
  return { h, m: mi, known: true };
}
// A date and a clock time in India, as a moment.
function istMoment(ymd, h, m) {
  const p = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!p) return null;
  return Date.UTC(Number(p[1]), Number(p[2]) - 1, Number(p[3]), h, m) - IST_OFFSET_MIN * 60000;
}
function istYmd(ms) { return new Date(ms + IST_OFFSET_MIN * 60000).toISOString().slice(0, 10); }
function fmtDate(ymd) {
  const p = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!p) return String(ymd || '');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(p[2]) - 1];
  return Number(p[3]) + ' ' + mon + ' ' + p[1];
}
function fmtClock(c) {
  const h12 = ((c.h + 11) % 12) + 1;
  return h12 + ':' + String(c.m).padStart(2, '0') + ' ' + (c.h < 12 ? 'AM' : 'PM');
}
// The ISO week a moment falls in, in India: "2026-W43".
function isoWeek(ms) {
  const d = new Date(istYmd(ms) + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - first) / DAY - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

function pjSettings(config) {
  const s = (config && config.partnerJourney) || {};
  const times = String(s.reminderTimes || '10:00, 18:00').split(',').map((x) => x.trim()).filter(Boolean)
    .map(parseClock).filter((c) => c.known);
  return {
    autoReminders: s.autoReminders !== 'No',
    reminderDays: Math.max(0, Math.min(7, Number(s.reminderDaysBefore === undefined || s.reminderDaysBefore === '' ? 2 : s.reminderDaysBefore) || 0)),
    reminderTimes: times.length ? times : [{ h: 10, m: 0 }, { h: 18, m: 0 }],
    linkHours: Math.max(1, Number(s.linkHoursBefore) || 24),
    expiryAlerts: s.expiryAlerts !== 'No',
    expiryEmail: s.expiryEmailPartner !== 'No',
    expiryMonths: Math.max(1, Number(s.expiryMonths) || 6),
  };
}

/* What is owed to each webinar at a given moment: the reminder slots that
   have come round, and the joining-link mail. A slot is only sent within
   six hours of its time, so a server that was down for a day does not
   wake up and send the whole of yesterday at once. */
const CATCH_UP_MS = 6 * 3600000;
function dueSlots(w, s, now) {
  const clock = parseClock(w.time);
  const start = istMoment(w.date, clock.h, clock.m);
  if (!start || now >= start) return [];
  const out = [];
  if (s.autoReminders) {
    for (let k = s.reminderDays; k >= 1; k--) {
      const day = istYmd(start - k * DAY);
      s.reminderTimes.forEach((t) => {
        const at = istMoment(day, t.h, t.m);
        if (at < start && now >= at && now < at + CATCH_UP_MS) {
          out.push({ key: 'rem:' + w.id + ':' + day + 'T' + String(t.h).padStart(2, '0') + String(t.m).padStart(2, '0'),
            kind: 'reminder', at, daysToGo: k });
        }
      });
    }
    const linkAt = start - s.linkHours * 3600000;
    if (now >= linkAt && now < Math.min(start, linkAt + CATCH_UP_MS)) {
      out.push({ key: 'link:' + w.id, kind: 'link', at: linkAt });
    }
  }
  return out.map((x) => Object.assign(x, { start, clock }));
}

// Who still has a session to come: registered, and not yet past it.
const AWAITING_SESSION = ['registered', 'acknowledged', 'remindersSent', 'sessionDay'];

function install(deps) {
  const { app, storeList, storeValue, putList, writeToDisk, sendMail, checkApiKey, dataDir, now: clock } = deps;
  const nowMs = () => (clock ? clock() : Date.now());

  function template(config, key) {
    const t = ((config && config.mailTemplates) || {})[key];
    return (t && (t.subject || t.body)) ? t : DEFAULT_TEMPLATES[key];
  }
  /* The same switches the CRM's own letters obey: email outflow as a
     whole, email for the module, and the one template. A letter that is
     held is still written down, with why. */
  function heldBecause(config, module, key) {
    if (config && config.mailOutflow === false) return 'Email outflow is switched off in Setup › Email Sending.';
    if (((config && config.mailModuleOff) || {})[module]) return 'Email for ' + module + ' is switched off in Setup › Email Templates.';
    if (((config && config.mailTemplatesOff) || {})[key]) return 'The template ' + key + ' is switched off in Setup › Email Templates.';
    return '';
  }
  function firmName(config) { return ((config && config.company) || {}).name || 'Freedom LifeX'; }
  function sign(body, config) {
    const firm = firmName(config);
    return String(body).indexOf('{Signature}') >= 0
      ? String(body).split('{Signature}').join('Warm regards,\n' + firm)
      : String(body) + '\n\nWarm regards,\n' + firm;
  }
  function send(to, subject, body) {
    return new Promise((resolve) => {
      sendMail({ to, subject, body }, null, (status, json) => resolve({ ok: !!(json && json.ok), message: (json && json.message) || '' }));
    });
  }
  /* One letter, sent or not, and the line that says what became of it. */
  async function letter(o) {
    const config = o.config;
    const tpl = template(config, o.key);
    const subject = fill(tpl.subject, o.vars);
    const body = sign(fill(tpl.body, o.vars), config);
    let status, note;
    const held = heldBecause(config, o.module, o.key);
    if (held) { status = 'Held'; note = held + ' Nothing was sent; this is the letter that would have gone.'; }
    else if (!o.to) { status = 'Not Sent'; note = 'No email address on this record — nothing was sent.'; }
    else {
      const r = await send(o.to, subject, body);
      status = r.ok ? 'Sent' : (/connector|configured|set up|switched off|From address/i.test(r.message) ? 'Not Sent' : 'Failed');
      note = r.message;
    }
    return { id: uid('COM'), clientId: null, leadId: null, channel: 'Email', direction: 'Outbound', status,
      statusNote: note || '', subject, body, html: false, address: o.to || '', refId: o.refId || '',
      module: o.module, recordId: o.recordId, label: o.label, at: new Date(nowMs()).toISOString(), by: 'Automation' };
  }

  /* ---------- the reminders ---------- */
  async function runReminders(now) {
    const config = storeValue('config', {}) || {};
    const s = pjSettings(config);
    const webinars = storeList('partnerWebinars').filter((w) => w && !w.deletedAt && w.date);
    if (!webinars.length) return { sent: 0, letters: 0 };
    const prospects = storeList('partnerProspects');
    const comms = [], patches = [];
    let moved = 0;
    for (const w of webinars) {
      const slots = dueSlots(w, s, now);
      if (!slots.length) continue;
      const regs = prospects.filter((p) => p && !p.deletedAt && p.webinarId === w.id
        && AWAITING_SESSION.includes(p.ppsStage || 'registered'));
      for (const slot of slots) {
        for (const p of regs) {
          if ((p.pjSent || {})[slot.key]) continue;
          const vars = { Name: pjName(p), FirstName: p.firstName || '', Webinar: w.title || 'the session',
            Date: fmtDate(w.date), Time: w.time || fmtClock(slot.clock), FirmName: firmName(config),
            DaysToGo: slot.daysToGo === 1 ? '1 day' : slot.daysToGo + ' days', JoiningLink: w.joiningLink || '(the link will follow)' };
          const key = slot.kind === 'link' ? 'pjJoiningLink' : 'pjReminder';
          const label = slot.kind === 'link' ? 'Joining link (automatic)' : 'Session reminder (automatic)';
          comms.push(await letter({ config, key, vars, to: p.email, module: 'PPS', recordId: p.id, label, refId: w.id }));
          /* A WhatsApp registration is written to on WhatsApp as well. No
             WhatsApp delivery is wired into BOSS yet, so the message is
             recorded as owed rather than pretended. */
          if (p.commChannel === 'WhatsApp') {
            comms.push({ id: uid('COM'), clientId: null, leadId: null, channel: 'WhatsApp', direction: 'Outbound',
              status: 'Not Sent', statusNote: 'WhatsApp delivery is not connected yet — send this one by hand.',
              subject: label, body: fill(template(config, key).body, vars).split('{Signature}').join(''),
              address: p.mobile || '', module: 'PPS', recordId: p.id, label, refId: w.id,
              at: new Date(now).toISOString(), by: 'Automation' });
          }
          /* And the stage follows what has gone out. Somebody still at
             Registered has not been acknowledged yet, which is a person's
             step, so they are written to but not moved. */
          const to = slot.kind === 'link'
            ? (['acknowledged', 'remindersSent'].includes(p.ppsStage) ? 'sessionDay' : null)
            : (p.ppsStage === 'acknowledged' ? 'remindersSent' : null);
          if (to) {
            p.ppsStage = to;
            moved++;
          }
          patches.push({ id: p.id, key: slot.key, to, label });
        }
      }
    }
    if (!patches.length) return { sent: 0, letters: 0, moved };
    /* Applied to the list as it stands now, not as it stood before the
       letters went: a CRM tab may have saved in the meantime, and its
       write is not this one's to undo. */
    const fresh = storeList('partnerProspects');
    const at = new Date(now).toISOString();
    patches.forEach((x) => {
      const r = fresh.find((q) => q && q.id === x.id);
      if (!r) return;
      r.pjSent = Object.assign({}, r.pjSent, { [x.key]: at });
      if (x.to && r.ppsStage !== x.to) {
        r.ppsStage = x.to;
        r.blueprintHistory = (r.blueprintHistory || []).concat([{ state: x.to, at, by: 'Automation', via: x.label }]);
      }
    });
    putList('partnerProspects', fresh);
    putList('communications', storeList('communications').concat(comms));
    writeToDisk();
    return { sent: comms.filter((c) => c.status === 'Sent').length, letters: comms.length, moved };
  }

  /* ---------- the ARN / EUIN expiry warnings ---------- */
  async function runExpiry(now) {
    const config = storeValue('config', {}) || {};
    const s = pjSettings(config);
    if (!s.expiryAlerts) return { notified: 0 };
    const partners = storeList('pjPartners');
    const week = isoWeek(now);
    const today = istYmd(now);
    const notes = [], comms = [], marks = [];
    for (const p of partners) {
      if (!p || p.deletedAt || p.pmsStage !== 'onboarded') continue;
      for (const [what, num, until] of [['ARN', p.arn, p.arnValidTo], ['EUIN', p.euin, p.euinValidTo]]) {
        if (!until || !/^\d{4}-\d{2}-\d{2}/.test(until)) continue;
        const end = istMoment(until, 0, 0);
        const warnFrom = new Date(until + 'T00:00:00Z');
        warnFrom.setUTCMonth(warnFrom.getUTCMonth() - s.expiryMonths);
        if (today < warnFrom.toISOString().slice(0, 10)) continue;
        const key = what + ':' + until + ':' + week;
        if ((p.pjExpiryNotified || {})[key]) continue;
        marks.push({ id: p.id, key });
        const daysLeft = Math.ceil((end - now) / DAY);
        const gone = daysLeft <= 0;
        if (p.assignedTo) {
          notes.push({ id: uid('NTF'), at: new Date(now).toISOString(), userId: p.assignedTo,
            title: pjName(p) + '’s ' + what + (gone ? ' has expired' : ' expires on ' + fmtDate(until)),
            body: what + ' ' + (num || '') + (gone ? ' ran out on ' + fmtDate(until) + '.' : ' — ' + daysLeft + ' days left. You will be reminded every week until it is renewed.'),
            view: 'pms', arg: p.id, kind: 'arnExpiry', by: 'Automation' });
        }
        if (s.expiryEmail && !gone) {
          comms.push(await letter({ config, key: 'pjArnExpiry', to: p.email, module: 'PMS', recordId: p.id,
            label: what + ' expiry reminder (automatic)',
            vars: { Name: pjName(p), What: what, Number: num || '', ExpiresOn: fmtDate(until), DaysLeft: String(daysLeft),
              FirmName: firmName(config) } }));
        }
      }
    }
    if (!marks.length) return { notified: 0 };
    const fresh = storeList('pjPartners');
    marks.forEach((x) => {
      const r = fresh.find((q) => q && q.id === x.id);
      if (r) r.pjExpiryNotified = Object.assign({}, r.pjExpiryNotified, { [x.key]: new Date(now).toISOString() });
    });
    putList('pjPartners', fresh);
    if (notes.length) putList('notifications', storeList('notifications').concat(notes));
    if (comms.length) putList('communications', storeList('communications').concat(comms));
    writeToDisk();
    return { notified: notes.length, letters: comms.length };
  }

  /* ---------- Partner Onboarding: overdue reviews ----------
     Once a day, the owner of every review past its date hears about it,
     until it is done. */
  function runReviews(now) {
    const today = istYmd(now);
    const list = storeList('pjReviews');
    const pob = storeList('pjOnboarding');
    const notes = [];
    const marks = [];
    for (const r of list) {
      if (!r || r.deletedAt || r.status === 'Completed' || r.status === 'Cancelled') continue;
      if (!r.dueDate || String(r.dueDate) >= today) continue;
      if ((r.overdueNotified || {})[today]) continue;
      const p = pob.find((x) => x && x.id === r.pobId) || {};
      const who = r.assignedTo || p.assignedTo;
      marks.push(r.id);
      if (!who) continue;
      notes.push({ id: uid('NTF'), at: new Date(now).toISOString(), userId: who,
        title: (r.kind || 'Review') + ' for ' + (pjName(p) || 'a partner') + ' is overdue',
        body: 'It was due on ' + fmtDate(r.dueDate) + '. Record it in POB › Reviews.',
        view: 'pob', arg: p.id || '', kind: 'pobReview', by: 'Automation' });
    }
    if (!marks.length) return { overdue: 0 };
    const fresh = storeList('pjReviews');
    marks.forEach((id) => {
      const r = fresh.find((x) => x && x.id === id);
      if (r) r.overdueNotified = Object.assign({}, r.overdueNotified, { [today]: new Date(now).toISOString() });
    });
    putList('pjReviews', fresh);
    if (notes.length) putList('notifications', storeList('notifications').concat(notes));
    writeToDisk();
    return { overdue: notes.length };
  }

  let running = false;
  async function tick(at) {
    if (running) return { busy: true };
    running = true;
    try {
      const now = at || nowMs();
      const reminders = await runReminders(now);
      const expiry = await runExpiry(now);
      const reviews = runReviews(now);
      return { reminders, expiry, reviews, at: new Date(now).toISOString() };
    } catch (e) {
      console.error('Partner Journey run failed:', e);
      return { error: e.message };
    } finally { running = false; }
  }
  // The test runner turns the clock off and names each moment itself.
  if (process.env.CRM_PJ_AUTORUN !== 'off') {
    const every = Number(process.env.CRM_PJ_TICK_MS) || 5 * 60000;
    setTimeout(() => tick(), 20000).unref();
    setInterval(() => tick(), every).unref();
  }

  /* Run it now — from Setup, and from the tests, which name the moment
     rather than wait two days for it. */
  app.post('/api/partner-journey/run', checkApiKey, async (req, res) => {
    const at = req.body && req.body.at ? Date.parse(req.body.at) : null;
    res.set('Cache-Control', 'no-store').json(await tick(Number.isFinite(at) ? at : null));
  });

  /* ---------- the prospect's own form ---------- */
  const FORM_FIELDS = [
    { k: 'firstName', l: 'First Name', req: 1 },
    { k: 'lastName', l: 'Last Name' },
    { k: 'mobile', l: 'Mobile', req: 1, vk: 'mobile' },
    { k: 'email', l: 'Email', vk: 'email' },
    { k: 'city', l: 'City' },
    { k: 'occupation', l: 'Occupation' },
    { k: 'dob', l: 'Date of Birth', t: 'date' },
    { k: 'qualification', l: 'Highest Qualification' },
    { k: 'experience', l: 'Experience in financial products', t: 'select',
      opts: ['None', 'Less than 1 year', '1–3 years', 'More than 3 years'] },
    { k: 'interest', l: 'What interests you about becoming a partner?', t: 'textarea' },
  ];
  // Written back onto the prospect; the rest is kept with the answers.
  const ON_RECORD = ['firstName', 'lastName', 'mobile', 'email', 'city', 'occupation'];
  function prospectByToken(token) {
    if (!token || typeof token !== 'string' || token.length < 16) return null;
    return storeList('partnerProspects').find((p) => p && !p.deletedAt && p.ackFormToken === token) || null;
  }
  app.get('/api/public/pps-form', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const p = prospectByToken(String(req.query.token || ''));
    if (!p) return res.status(404).json({ ok: false, message: 'This link is not valid any more.' });
    const config = storeValue('config', {}) || {};
    const w = storeList('partnerWebinars').find((x) => x && x.id === p.webinarId) || null;
    const values = Object.assign({}, (p.ackForm && p.ackForm.answers) || {});
    FORM_FIELDS.forEach((f) => { if (values[f.k] === undefined && p[f.k] !== undefined) values[f.k] = p[f.k]; });
    res.json({ ok: true, firm: firmName(config), name: pjName(p), fields: FORM_FIELDS, values,
      webinar: w ? { title: w.title || '', date: fmtDate(w.date), time: w.time || '' } : null,
      submittedAt: p.ackFormSubmittedAt || null });
  });
  app.post('/api/public/pps-form', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const token = String(req.query.token || '');
    const list = storeList('partnerProspects');
    const p = list.find((x) => x && !x.deletedAt && x.ackFormToken === token && token.length >= 16);
    if (!p) return res.status(404).json({ ok: false, message: 'This link is not valid any more.' });
    const given = (req.body && req.body.answers) || {};
    const answers = {};
    for (const f of FORM_FIELDS) {
      let v = given[f.k] === undefined || given[f.k] === null ? '' : String(given[f.k]).trim().slice(0, 2000);
      if (f.req && !v) return res.status(400).json({ ok: false, message: f.l + ' is needed.' });
      if (v && f.vk === 'mobile' && !/^[6-9]\d{9}$/.test(v.replace(/\D/g, '').slice(-10))) {
        return res.status(400).json({ ok: false, message: 'That mobile number does not look right — 10 digits, please.' });
      }
      if (v && f.vk === 'mobile') v = v.replace(/\D/g, '').slice(-10);
      if (v && f.vk === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        return res.status(400).json({ ok: false, message: 'That email address does not look right.' });
      }
      if (v && f.opts && !f.opts.includes(v)) v = '';
      answers[f.k] = v;
    }
    const at = new Date().toISOString();
    const before = {};
    ON_RECORD.forEach((k) => { before[k] = p[k]; if (answers[k] !== '') p[k] = answers[k]; });
    const again = !!p.ackFormSubmittedAt;
    p.ackForm = { answers, submittedAt: at };
    p.ackFormSubmittedAt = at;
    p.ackFormHistory = (p.ackFormHistory || []).concat([{ at, what: again ? 'Re-submitted' : 'Submitted' }]);
    putList('partnerProspects', list);
    const changed = ON_RECORD.filter((k) => answers[k] !== '' && String(before[k] || '') !== answers[k]);
    putList('auditLog', storeList('auditLog').concat([{ id: uid('AUD'), at, by: 'Prospect', module: 'PPS', recordId: p.id,
      action: 'Registration form ' + (again ? 're-submitted' : 'submitted'),
      details: changed.map((k) => ({ field: k, oldValue: String(before[k] || ''), newValue: answers[k] })) }]));
    if (p.assignedTo) {
      putList('notifications', storeList('notifications').concat([{ id: uid('NTF'), at, userId: p.assignedTo,
        title: 'Registration form ' + (again ? 're-submitted' : 'submitted') + ' by ' + pjName(p),
        body: 'It is on the prospect now.', view: 'pps', arg: p.id, kind: 'submission', by: 'Prospect' }]));
    }
    writeToDisk();
    res.json({ ok: true });
  });

  /* ---------- Partner Onboarding: the partner's documents ----------
     Kept beside the data file, never under public/, and handed out only
     to a request that carries the CRM's key. The file goes in as base64 in
     a JSON body, which the server already takes up to 25 MB of. */
  const DOC_DIR = path.join(dataDir || path.join(__dirname, 'data'), 'partner-docs');
  const DOC_TYPES = { 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
    'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx' };
  const DOC_MAX = 5 * 1024 * 1024;
  app.post('/api/partner-docs', checkApiKey, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const b = req.body || {};
    const mime = String(b.mime || '');
    if (!DOC_TYPES[mime]) return res.status(400).json({ ok: false, message: 'Only PDF, PNG, JPG, WEBP or Word files can be uploaded.' });
    const raw = String(b.data || '').replace(/^data:[^,]*,/, '');
    const buf = Buffer.from(raw, 'base64');
    if (!buf.length) return res.status(400).json({ ok: false, message: 'The file is empty.' });
    if (buf.length > DOC_MAX) return res.status(400).json({ ok: false, message: 'The file is larger than 5 MB.' });
    const id = 'PDF-' + crypto.randomBytes(12).toString('hex');
    try {
      fs.mkdirSync(DOC_DIR, { recursive: true });
      fs.writeFileSync(path.join(DOC_DIR, id + DOC_TYPES[mime]), buf);
      fs.writeFileSync(path.join(DOC_DIR, id + '.json'), JSON.stringify({ id, mime, name: String(b.name || 'document').slice(0, 200),
        size: buf.length, at: new Date().toISOString() }));
    } catch (e) {
      return res.status(500).json({ ok: false, message: 'The file could not be stored: ' + e.message });
    }
    res.json({ ok: true, id, size: buf.length });
  });
  app.get('/api/partner-docs/:id', checkApiKey, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = String(req.params.id || '');
    if (!/^PDF-[0-9a-f]{24}$/.test(id)) return res.status(404).json({ ok: false, message: 'No such document.' });
    let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(DOC_DIR, id + '.json'), 'utf8')); } catch (e) {
      return res.status(404).json({ ok: false, message: 'No such document.' });
    }
    const file = path.join(DOC_DIR, id + (DOC_TYPES[meta.mime] || ''));
    if (!fs.existsSync(file)) return res.status(404).json({ ok: false, message: 'No such document.' });
    res.set('Content-Type', meta.mime);
    res.set('Content-Disposition', 'inline; filename="' + String(meta.name).replace(/["\\\r\n]/g, '_') + '"');
    res.set('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(file).pipe(res);
  });

  return { tick, dueSlots, parseClock, isoWeek, DEFAULT_TEMPLATES, newFormToken: () => crypto.randomBytes(18).toString('base64url') };
}

module.exports = { install, DEFAULT_TEMPLATES, parseClock, dueSlots, pjSettings };
