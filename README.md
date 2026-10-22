# Finowise CRM (BOSS · Freedom LifeX)

A single-page CRM for a financial-advisory firm: lead, client, relationship and
plan management (LMS, CMS, RMS, LNG), dashboards and reports, Excel/XLS
imports and exports, mail templates and SMTP connectors, public client forms
(ISEQ risk profiler, blueprints), automation rules and role-based team
hierarchy.

One Express server (`server.js`) serves the app (`public/index.html`) and a
small JSON-file API. Accounts live in SQLite via Node's built-in `node:sqlite`,
so there are no native dependencies.

## Run it locally

Requires Node.js 22 or newer.

```bash
npm ci
npm run user -- add you@example.com "a good password"
npm run user -- role you@example.com admin
npm start                      # http://localhost:3000
```

Data is written to `data.json` and `users.db` beside `server.js` (both
gitignored). Override with `CRM_DB_FILE`, `CRM_USERS_DB`, `PORT`, `HOST`.
Set `CRM_API_KEY` and `CRM_SESSION_SECRET` in any real deployment.

## Tests

Browser tests (Playwright driving Chromium) live in `tests/`:

```bash
cd tests && npm ci
bash run.sh smoke              # one suite
bash run.sh                    # all suites
```

See `CLAUDE.md` for working rules and `DEPLOY.md` for production deployment.
