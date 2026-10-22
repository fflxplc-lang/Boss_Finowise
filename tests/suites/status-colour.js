/* A STATUS SHOULD READ AT A GLANCE, WHATEVER THE FIRM CALLS IT.

   The Execution Tracker's Status column had Draft and Client
   Accepted in the same grey, which makes a column you scan into a
   column you have to read. Only the lead and task words were in the
   colour map; every other lifecycle fell through.

   The fix reads the words rather than looking them up, because the
   lists are configurable: rename "Client Accepted" to "Signed Off"
   and a map keyed by label goes grey again. What has to hold is that
   every status in every configured lifecycle gets a colour, that the
   colour means the same thing everywhere, and that renaming one does
   not lose it. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();

  t.section('every lifecycle in the system gets a colour');

  await t.step('no configured status is left grey that should not be', async () => {
    const r = await t.eval(()=>{
      const lists = {
        'Asset allocation': cfgLabels('business.recommendationStatuses'),
        'Transactions': cfgLabels('business.transactionStatuses'),
        'DBT entries': cfgLabels('business.statuses'),
        'Allocation lines': cfgLabels('alloc.lineStatuses'),
      };
      const out = {};
      Object.keys(lists).forEach(k=>{
        out[k] = (lists[k] || []).map(s=>s + '=' + statusTone(s));
      });
      const grey = [];
      Object.keys(lists).forEach(k=>{
        (lists[k] || []).forEach(s=>{
          /* Only a not-yet-started status has any business being grey. */
          if(statusTone(s) === 'muted' && !/not *start|draft|^new$/i.test(s)) grey.push(k + ': ' + s);
        });
      });
      return {out, grey};
    });
    if(r.grey.length) throw new Error('still grey: ' + r.grey.join(' | '));
    return Object.keys(r.out).map(k=>k + ' — ' + r.out[k].join(', ')).join(' · ');
  });

  await t.step('the two from the screenshot no longer read the same', async () => {
    const r = await t.eval(()=>({
      draft: statusTone('Draft'), accepted: statusTone('Client Accepted'),
      sent: statusTone('Sent to Client'), query: statusTone('Client Query'),
      rejected: statusTone('Rejected'), internal: statusTone('Pending Internal Approval'),
      approved: statusTone('Internally Approved'),
      draftHtml: statusBadge('Draft'), acceptedHtml: statusBadge('Client Accepted'),
    }));
    if(r.draft === r.accepted)
      throw new Error('Draft and Client Accepted are both ' + r.draft);
    if(r.accepted !== 'ok') throw new Error('Client Accepted reads ' + r.accepted);
    if(r.rejected !== 'danger') throw new Error('Rejected reads ' + r.rejected);
    if(r.sent !== 'warn') throw new Error('Sent to Client reads ' + r.sent);
    if(r.query !== 'warn') throw new Error('Client Query reads ' + r.query);
    if(r.internal !== 'warn') throw new Error('Pending Internal Approval reads ' + r.internal);
    if(r.approved !== 'ok') throw new Error('Internally Approved reads ' + r.approved);
    if(!/badge ok/.test(r.acceptedHtml)) throw new Error('the badge did not carry the colour');
    return 'Draft ' + r.draft + ', Internal ' + r.internal + ', Approved ' + r.approved
      + ', Sent ' + r.sent + ', Query ' + r.query + ', Accepted ' + r.accepted
      + ', Rejected ' + r.rejected;
  });

  t.section('the words, not the labels');

  await t.step('a renamed status keeps its colour', async () => {
    const r = await t.eval(()=>({
      signed: statusTone('Signed Off by Client'),
      turned: statusTone('Turned Down'),
      withDesk: statusTone('Awaiting the Desk'),
      notYet: statusTone('Not Started'),
      /* "Not Started" holds the word "started" and "Pending from
         Client Consent" holds "pending": the specific reading has to
         win over the general one. */
      consent: statusTone('Pending from Client Consent'),
      nonsense: statusTone('Zzxq'),
      blank: statusTone(''),
    }));
    if(r.signed !== 'ok') throw new Error('"Signed Off by Client" reads ' + r.signed);
    if(r.turned !== 'danger') throw new Error('"Turned Down" reads ' + r.turned);
    if(r.withDesk !== 'warn') throw new Error('"Awaiting the Desk" reads ' + r.withDesk);
    if(r.notYet !== 'muted') throw new Error('"Not Started" reads ' + r.notYet);
    if(r.consent !== 'warn') throw new Error('"Pending from Client Consent" reads ' + r.consent);
    if(r.nonsense !== 'muted') throw new Error('a word it cannot read should stay grey');
    if(r.blank !== 'muted') throw new Error('an empty status should stay grey');
    return 'renamings keep their meaning; "Not Started" stays grey despite holding "started"';
  });

  await t.step('the words it already knew are unchanged', async () => {
    const r = await t.eval(()=>({
      qualified: statusTone('Qualified'), lost: statusTone('Lost/Dormant'),
      high: statusTone('High'), low: statusTone('Low'),
      inProgress: statusTone('In Progress'), closed: statusTone('Closed'),
    }));
    const want = {qualified:'ok', lost:'danger', high:'danger', low:'muted',
                  inProgress:'warn', closed:'muted'};
    const off = Object.keys(want).filter(k=>r[k] !== want[k]);
    if(off.length) throw new Error('changed: ' + off.map(k=>k + '=' + r[k]).join(', '));
    return 'the lead and task words read exactly as they did before';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 220));
    return 'none';
  });
});
