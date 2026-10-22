# Working on this repo

> **This repository (fflxplc-lang/test-finolifex-crm) is the TEST copy.**
> It runs at https://test.freedomlifex.in, not boss.freedomlifex.in, and the
> rest of this file describes the production repo. Here:
>
> - Changes go to `main`. Pushing `main` does **not** deploy anything.
> - The site serves whatever the **`deploy`** branch points at. A timer on the
>   VPS checks it every minute, backs up the data, installs, and rolls back by
>   itself if the new code fails (`deploy/test-subdomain/autodeploy.sh`).
> - After changing `main`, ask the user whether to deploy. Only when they say
>   "deploy", fast-forward `deploy` to `main` and push it:
>   `git push origin origin/main:refs/heads/deploy`
> - Data lives in `/home/finowise-test/data` on the server, outside the code;
>   deploys never touch it.

Finowise CRM. One Express server (`server.js`) serving a single-page app
(`public/index.html`) plus a small JSON-file API.

## Work on `main`, not a branch

Commit and push directly to `main`. Don't create a working branch for changes
here — only `main` deploys, so work on a branch sits there doing nothing until
somebody notices and merges it. There is one developer and one environment;
the branch-then-merge ceremony buys nothing and has already left stray
`claude/*` branches behind that had to be cleaned up.

## Pushing to `main` puts it in production

There is no staging. A push to `main` is live at **https://boss.freedomlifex.in**
within 60 seconds — the server pulls it by itself. Check the result at
**https://boss.freedomlifex.in/deploy-status.txt**:

- `LIVE <sha>` — serving.
- `ROLLED BACK to <sha> — <sha> failed: <why>` — your commit was rejected and
  the previous one was put back. The site is fine; your change is not live.
  Fix the cause and push again.

The rollback is automatic, but do not lean on it. Before pushing, run:

```bash
npm ci
node --check server.js     # the deployer refuses to restart if this fails
node server.js             # then open http://localhost:3000 and actually look
```

## Things that will break production

- **Never commit a secret.** `CRM_API_KEY`, `CRM_PASSWORD` and
  `CRM_SESSION_SECRET` live in `/home/finowise/app.env` on the server and are
  read from `process.env`. `/config.js` hands the API key to the browser at
  runtime — that is the only place it should ever appear in code.
- **Never commit `data.json`.** It is the live database and it lives outside
  this repo on the server. It is gitignored; keep it that way.
- **Do not add native dependencies** (anything that compiles at install time).
  `npm ci --omit=dev` runs on a small VPS during every deploy — see README.md
  for the better-sqlite3 failure that made this rule.
- The deploy script lives on the server, not in this repo, on purpose: a bad
  push must not be able to break the thing that recovers from bad pushes.

## Sign-in

One shared access code guards the whole site (`CRM_PASSWORD`), with a signed
cookie. It is not per-user authentication, and the CRM's own role hierarchy is
still enforced only in browser JavaScript — so anything the API serves is
reachable by anyone who signs in. Do not describe it in the UI as though it
were per-user security.

`DEPLOY.md` documents the server layout, credentials and rollback.
