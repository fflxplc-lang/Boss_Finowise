# The browser tests

These drive a real Chromium against a real server, because that is the only
way to find out what this application does. There is no unit layer: the app
is one HTML file whose functions are defined in page scope, so the honest way
to call one is to open the page and call it.

## Running them

```bash
cd tests
npm install                 # once — playwright-core, nothing else

bash run.sh                 # every suite, one after another
bash run.sh smoke mail      # just these
N=8 bash parallel.sh        # every suite across eight workers
SUITE_TIMEOUT=1200 bash run.sh layout
```

A suite prints a line per step, then `ALL CLEAN` or `N PROBLEM(S)` with the
failures underneath. The runner reads nothing else, so a suite is free to
print whatever helps while it works.

Chromium is expected at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
Somewhere else: `BOSS_CHROME=/path/to/chrome bash run.sh`.

## Why this lives in its own package

`tests/package.json` is deliberately separate from the one at the repo root.
The server runs `npm ci --omit=dev` at the root on every deploy and never
looks in here, so a test dependency cannot reach production — and the rule in
`CLAUDE.md` against anything that compiles at install time stays a rule about
the one package that matters.

`tests/node_modules` is gitignored. `npm install` is a local step.

## Writing a suite

A suite is a list of named steps. A step passes if it returns and fails if it
throws; whatever it returns is printed beside its name. Make that return say
something — `3 leads, no duplicate on the retry` is worth more than a tick,
and it is what tells you a passing test is still testing the right thing.

```js
const {suite} = require('../lib/harness');

suite(async t => {
  t.section('what this group is about');

  await t.step('the thing it should do', async () => {
    const n = await t.eval(() => DB.leads.length);
    if(!n) throw new Error('no leads');
    return n + ' leads';
  });
});
```

Save it as `suites/<name>.js` and it is picked up — both runners glob the
directory, so nothing has to be registered.

### What `t` gives you

| | |
|---|---|
| `t.page` | the Playwright page, for anything below |
| `t.eval(fn, arg)` | `page.evaluate`, which is how you reach the app's own functions |
| `t.step(name, fn)` | one named assertion |
| `t.section(title)` | a heading in the output |
| `t.home()` | the app, signed in and drawn |
| `t.doc(token, ms)` | a client's own link |
| `t.wait(ms)` | a pause |
| `t.dialogs` | every `alert`/`confirm` the page raised, already accepted |
| `t.expectConsole(/…/)` | "the next thing I do logs this on purpose" |
| `t.mail` | the fake mail server, with `{mail:true}` |

`lib/make-xls.js` converts one into a genuine BIFF8 `.xls` or an HTML
table using the LibreOffice on the machine — a parser tested only against
its own author's output proves the two agree, not that either is right. The
steps that need it say so and skip when it is absent.

`lib/xlsx-write.js` builds a real `.xlsx` — a zip of XML with a shared string
table and a date format — for any suite that needs to upload one. Node's own
zlib does the deflate; nothing is installed for it.

### Options

```js
suite({mail:true, collapsed:true, signIn:false, viewport:{…}}, async t => {…});
```

- **`mail`** stands up an SMTP server on a port of its own, points the CRM's
  connector at it and makes the CRM pass a real connection test — the server
  refuses to send otherwise. Letters land in `t.mail.received`, decoded:
  `{from, to:[…], subject, text, body}`. `t.mail.clear()` between acts.
- **`collapsed`** meets the forms as a person does, with their sections shut.
  Every other suite gets them open, because clicking fourteen headings to
  reach a field is not what most suites are testing.
- **`signIn:false`** for a suite that only ever looks at a client's link.

### Two things that will bite you

**`networkidle` never fires.** The app holds an open `EventSource` on
`/api/events` for live sync, so the network is never idle. Use
`domcontentloaded` and then `lib/ready.js`, which asks the page whether the
store has arrived and the first draw has happened.

**`DB` is not on `window`.** It is a `let` at the top of a classic script,
which is a script-scope binding. `t.eval(() => DB.leads)` works;
`window.DB` is `undefined` and will quietly waste a timeout.

## The suites

| Suite | What it holds to account |
|---|---|
| `smoke` | every module draws; the rail's hierarchy; a switched-off module stays off |
| `layout` | width, at 1920/1024/390, on every module and every client page — no overflow, no unused window, no narrow column in a wide page |
| `typing` | long strings arrive whole, the caret stays put, a redraw loses nothing, dates hold |
| `collapse` | sections shut by default, open on a click, and keep what was typed |
| `allocation` | the For column is gone and ⇄ Goal does its job |
| `ct-referrals` | the C&T columns, the migrations, and the lead a referral opens |
| `cms-order` | the order fund by fund: references, allotment, rejection, the gate |
| `public-forms` | the client's one link, the write-back, and the scope a link may not leave |
| `mail` | a letter actually goes out, in the firm's own words from Settings |
| `dashboards` | the per-module strips, and the timeline filter narrowing tile and table together |
| `main-dashboard` | both sections, the parts summing to the whole, and the two panels that cannot be honest saying so |
| `reports` | six sections, fourteen reports, the pending one naming what it waits for, and the promise that filling it in is one `run` |
| `live-refresh` | the screen keeps up with the data: a write redraws its own tab with nothing asking it to, a burst redraws once, typing is never interrupted, a second tab follows on the live stream — and when the stream is killed outright, or a tab comes back from the background, it still catches up by asking |
| `email-config` | the outflow switch really stopping mail (and logging what it held); a module held while another keeps sending; a stage, template and rule built the way a person would, then a real lead through a real transition producing a real letter; and a signature that is each person's own and reaches the letter |
| `export` | the central Export screen: one module, several or everything; rows scoped as the module scopes them; a module without the Export permission not offered; and a comma, a quote and a newline surviving the CSV |
| `permissions` | access set once and reaching every module, the stored shape `can()` reads, an exception that cannot outlive a central change, and a whole module closed to a role in one setting |
| `workbook-formats` | whatever the platform calls a spreadsheet opens: real BIFF8 .xls (LibreOffice-made, including one whose string table is split across CONTINUE records), HTML and Excel-2003 XML named .xls, CSV renamed .xls, semicolons, quoted commas, a blank cell mid-row, a cover sheet |
| `platform-import` | the five platform AUM/SIP reports, read from real .xlsx: PAN first, name only without one, a twinned name never guessed, re-import duplicating nothing, and a snapshot never reaching the transaction ledger |

## A caveat worth keeping

This set was rebuilt on 12 October after the previous harness — which lived
in a scratch directory outside the repository — was lost with its container.
It is a foundation, not a restoration: it covers the spine and the recent
work, not every path the old set had reached. Add to it when you touch
something it does not yet watch, and keep it in here, where a restart cannot
take it again.
