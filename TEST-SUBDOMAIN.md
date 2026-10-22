# Test copy at test.freedomlifex.in

A second, fully separate CRM on the **same VPS** as production
(boss.freedomlifex.in), for trying changes safely. It shares nothing with
production except the machine and nginx itself:

| | Production | Test copy |
|---|---|---|
| Linux user | `finowise` | `finowise-test` |
| Code | `/home/finowise/app` (prod repo) | `/home/finowise-test/app` (this repo) |
| Data | `/home/finowise/data/` | `/home/finowise-test/data/` (starts empty) |
| Port | 3000 | **3001** |
| Service | `finowise.service` | `finowise-test.service` |
| nginx site | `lifex` | `finowise-test` |
| Secrets | `/home/finowise/app.env` | `/home/finowise-test/app.env` (new values) |

The production deploy timer only watches the production checkout, so it never
touches the test copy, and the test copy never touches it. Config files are in
[`deploy/test-subdomain/`](deploy/test-subdomain/).

## Quick way: one command

After the DNS record in step 1 exists, run this as root on the VPS. It does
steps 2 to 6 for you, asks for a test admin email and password, and stops
without touching anything if a check fails:

```bash
curl -fsSL https://raw.githubusercontent.com/fflxplc-lang/test-finolifex-crm/main/deploy/test-subdomain/setup.sh -o /root/finowise-test-setup.sh && bash /root/finowise-test-setup.sh
```

Run the same command again later to update the test copy to the latest code.
The manual steps below do the same thing by hand.

Run everything as root on the VPS (`ssh root@187.127.179.203`, or hPanel's
**Browser terminal**).

## 1. DNS

hPanel → **Domains** → freedomlifex.in → **DNS / Nameservers** (or wherever
the domain's DNS lives). Add an **A record**: name `test`, points to
`187.127.179.203`, TTL default. Check it before step 6:

```bash
dig +short test.freedomlifex.in     # must print 187.127.179.203
```

## 2. Make sure port 3001 is free

```bash
ss -ltnp | grep ':3001 '     # must print nothing
```

If something is listed, pick another port and use it in steps 4 and 6.

## 3. User and code

```bash
adduser --system --group --home /home/finowise-test --shell /bin/bash finowise-test
mkdir -p /home/finowise-test/data
git clone https://github.com/fflxplc-lang/test-finolifex-crm.git /home/finowise-test/app
chown -R finowise-test:finowise-test /home/finowise-test
cd /home/finowise-test/app && runuser -u finowise-test -- npm ci --omit=dev
```

If the repo is private, git asks for your GitHub username and a personal access
token (GitHub → Settings → Developer settings → Personal access tokens).

## 4. Secrets

```bash
cp /home/finowise-test/app/deploy/test-subdomain/app.env.example /home/finowise-test/app.env
openssl rand -hex 32     # run twice: one value for CRM_API_KEY, one for CRM_SESSION_SECRET
nano /home/finowise-test/app.env
chown finowise-test:finowise-test /home/finowise-test/app.env && chmod 600 /home/finowise-test/app.env
```

Use new values, not production's, so a test sign-in can never work on the real site.

## 5. Start it and create a login

```bash
cp /home/finowise-test/app/deploy/test-subdomain/finowise-test.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now finowise-test
curl http://127.0.0.1:3001/api/health          # JSON answer = running

cd /home/finowise-test/app
runuser -u finowise-test -- bash -c 'set -a; . /home/finowise-test/app.env; set +a;
  npm run user -- add you@example.com "a test password";
  npm run user -- role you@example.com admin'
```

## 6. nginx + HTTPS

```bash
cp /home/finowise-test/app/deploy/test-subdomain/nginx.conf /etc/nginx/sites-available/finowise-test
ln -s /etc/nginx/sites-available/finowise-test /etc/nginx/sites-enabled/
nginx -t                        # must say "syntax is ok" before going on
systemctl reload nginx          # reload, not restart: production keeps serving
certbot --nginx -d test.freedomlifex.in --redirect
```

`-d test.freedomlifex.in` makes certbot issue a separate certificate and
edit only the test site; production's certificate is untouched. If `nginx -t`
fails, fix or remove the new file before reloading. Production keeps running
on the old config until a reload succeeds.

Open https://test.freedomlifex.in and sign in with the test login.

## Deploy on request (auto-deploy)

Turn this on once, as root on the VPS:

```bash
curl -fsSL https://raw.githubusercontent.com/fflxplc-lang/test-finolifex-crm/main/deploy/test-subdomain/install-autodeploy.sh -o /root/finowise-test-autodeploy.sh && bash /root/finowise-test-autodeploy.sh
```

From then on the test site serves whatever the `deploy` branch points at.
Changes are made on `main`; saying "deploy" moves `deploy` to `main`, and
within about a minute the server:

1. copies `/home/finowise-test/data` to `/home/finowise-test/backups/` (last 20 kept),
2. installs the new code, checks it, restarts, and waits for it to answer,
3. puts the previous code back by itself if any of that fails.

Check the result: `cat /home/finowise-test/deploy-status.txt`
(`LIVE <sha>`, or `ROLLED BACK to <sha> ...`). History:
`journalctl -u finowise-test-deploy -n 30 --no-pager`.

## Updating the test copy

```bash
cd /home/finowise-test/app && runuser -u finowise-test -- git pull \
  && runuser -u finowise-test -- npm ci --omit=dev && systemctl restart finowise-test
journalctl -u finowise-test -n 50 --no-pager     # logs
```

## Test data

The test copy starts empty. To try it with a copy of the real data (real client
details, so keep it behind the sign-in):

```bash
systemctl stop finowise-test
cp /home/finowise/data/data.json /home/finowise-test/data/data.json
chown finowise-test:finowise-test /home/finowise-test/data/data.json
systemctl start finowise-test
```

## Removing it completely

```bash
systemctl disable --now finowise-test
rm /etc/systemd/system/finowise-test.service /etc/nginx/sites-enabled/finowise-test /etc/nginx/sites-available/finowise-test
nginx -t && systemctl reload nginx
certbot delete --cert-name test.freedomlifex.in
deluser --remove-home finowise-test
```

Then delete the `test` DNS record on freedomlifex.in.
