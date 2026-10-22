# Finowise CRM — production deployment

Live at **https://boss.freedomlifex.in** (VPS `187.127.179.203`, Ubuntu 26.04 LTS).

Pushing to `main` deploys automatically. Nothing else is needed for a normal
change — no SSH, no manual steps.

## How a deploy happens

The server pulls for itself — there are **no credentials stored on GitHub**, and
no inbound port for deploys. A systemd timer checks `origin/main` every minute
using the VPS's own read-only deploy key:

```
push to main  →  (within ~60s) finowise-deploy.timer fires
              →  git fetch; if origin/main moved: reset --hard + npm ci
              →  systemctl restart finowise
              →  curl /api/health until it answers
              →  result written to https://boss.freedomlifex.in/deploy-status.txt
```

A bad push cannot take the site down. Before restarting anything the deployer
runs `npm ci` and `node --check server.js`; if either fails — or the restart
fails, or the new code doesn't answer `/api/health` within 20 seconds — it puts
the last commit that actually served back, reinstalls, restarts and verifies.

Check the result at **https://boss.freedomlifex.in/deploy-status.txt** (no password
needed):

- `LIVE <sha>` — that commit is serving.
- `ROLLED BACK to <sha> — <sha> failed: <why>` — the site is fine and running
  the older commit; the newer one never went live.
- `CRITICAL: ...` — the rollback itself is unhealthy. Only this needs you.

```bash
ssh lifex 'journalctl -u finowise-deploy -n 30 --no-pager'   # full history
ssh lifex 'systemctl list-timers finowise-deploy'            # when it next runs
ssh lifex 'runuser -u finowise -- /home/finowise/deploy.sh'  # deploy right now
```

## What's on the server

| Thing | Where |
|---|---|
| App code (a git clone of this repo) | `/home/finowise/app` |
| Deploy script + timer | `/home/finowise/deploy.sh`, `finowise-deploy.timer` — **not in the repo**, so a bad push can't break the recovery path |
| Last commit that served | `/home/finowise/data/last-good-commit` — the rollback target |
| **Data file** | `/home/finowise/data/data.json` — *outside the repo, so deploys can never wipe it* |
| Environment (`PORT`, `HOST`, `CRM_DB_FILE`, `CRM_API_KEY`) | `/home/finowise/app.env`, mode 600 |
| systemd unit | `/etc/systemd/system/finowise.service` |
| nginx site | `/etc/nginx/sites-available/lifex` |
| Credentials (site password + API key) | `/root/lifex-credentials.txt`, root-only |

The Node process listens on `127.0.0.1:3000` only; nginx terminates TLS and is
the only thing that can reach it. UFW allows 22/80/443 and nothing else.

## Two layers of access control

1. **The sign-in page** at `/login` guards the whole site — this is the real
   gate. One shared password (`CRM_PASSWORD`), a signed HttpOnly cookie good for
   7 days, and a **Sign out** button in the bottom-right of the app.
   `CRM_SESSION_SECRET` must stay set, or every restart signs everyone out.
2. **`CRM_API_KEY`** guards `/api/*` behind that. The browser gets it from
   `/config.js`, which reads it from the environment, so the secret is never
   committed. Any signed-in browser can read it, so it is a second line of
   defence, **not** per-user authentication — see README.md "Honest Limitations".

`/api/health` and `/deploy-status.txt` are deliberately reachable without
signing in, so a deploy can be checked from anywhere. Neither exposes CRM data.

## Common operations

```bash
ssh lifex                                   # root on the box
systemctl status finowise                   # is it running?
journalctl -u finowise -n 50 --no-pager     # app logs
tail -f /var/log/nginx/lifex.error.log      # proxy/TLS errors
systemctl restart finowise                  # restart by hand
```

**Change the API key:** edit `CRM_API_KEY` in `/home/finowise/app.env`, then
`systemctl restart finowise`. The browser picks the new one up on reload —
no code change, nothing to redeploy.

**Change the site password:** edit `CRM_PASSWORD` in `/home/finowise/app.env`,
then `systemctl restart finowise`. Everyone stays signed in — existing cookies
are signed with `CRM_SESSION_SECRET`, not the password.

**Sign everyone out immediately:** change `CRM_SESSION_SECRET` in the same file
and restart. Every issued cookie stops verifying.

**Remove sign-in entirely:** delete the `CRM_PASSWORD` line from
`/home/finowise/app.env` and restart — with no password set, the gate is off and
the sign-out button disappears. Don't do this while the CRM holds real client
data.

**Roll back a bad deploy:** revert the commit and push — that *is* the rollback,
since the server hard-resets to whatever `main` says, within a minute.

**Back up the data:** `scp lifex:/home/finowise/data/data.json ./backup.json`
(it is the entire database).

## TLS

Let's Encrypt via certbot, auto-renewing through the `certbot.timer` systemd
unit. The certificate was issued **without a contact email**, so there will be
no warning mail if renewal ever breaks. To add one:
`certbot update_account --email you@example.com`.
