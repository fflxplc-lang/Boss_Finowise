# Hosting Finowise CRM on Hostinger

The CRM is a long-running Node.js server that writes its data to disk
(`data.json`, `users.db`), so it needs either a **Hostinger VPS** (recommended)
or Hostinger's **managed Node.js web app** hosting. Plain shared/PHP hosting
cannot run it.

Ready-made config files are in [`deploy/hostinger/`](deploy/hostinger/).

To run a separate **test copy beside production** on the existing VPS
(test.freedomlifex.in), follow [TEST-SUBDOMAIN.md](TEST-SUBDOMAIN.md) instead.

---

## Option A: Hostinger VPS (Ubuntu) — recommended

You need: the VPS IP and root password (hPanel → **VPS** → your server →
**Overview**), and a domain you control. Run everything below as `root` over
SSH (`ssh root@YOUR_VPS_IP`, or the **Browser terminal** button in hPanel).

### 1. Point the domain at the VPS

In your DNS (hPanel → **Domains** → **DNS / Nameservers** if the domain is at
Hostinger), add an **A record**: name `crm` (or `@` for the bare domain),
value = the VPS IP. It must resolve before step 7.

### 2. Install Node.js 22, nginx, git

```bash
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs nginx git
node -v        # must print v22.13 or newer
```

### 3. Create an app user and fetch the code

```bash
adduser --system --group --home /home/finowise --shell /bin/bash finowise
mkdir -p /home/finowise/data
git clone https://github.com/fflxplc-lang/test-finolifex-crm.git /home/finowise/app
chown -R finowise:finowise /home/finowise
cd /home/finowise/app && runuser -u finowise -- npm ci --omit=dev
```

The repo is private, so `git clone` will ask for a GitHub username and a
**personal access token** (GitHub → Settings → Developer settings → Tokens),
or add a read-only deploy key for the VPS to the repo.

Data lives in `/home/finowise/data`, **outside** the code folder, so updating
the code can never wipe it.

### 4. Set the environment

```bash
cp /home/finowise/app/deploy/hostinger/app.env.example /home/finowise/app.env
nano /home/finowise/app.env      # paste a value from `openssl rand -hex 32`
                                 # into CRM_API_KEY and CRM_SESSION_SECRET
chown finowise:finowise /home/finowise/app.env && chmod 600 /home/finowise/app.env
```

### 5. Create the first admin account

```bash
cd /home/finowise/app
runuser -u finowise -- bash -c 'set -a; . /home/finowise/app.env; set +a;
  npm run user -- add you@example.com "a good password";
  npm run user -- role you@example.com admin'
```

### 6. Run it as a service

```bash
cp /home/finowise/app/deploy/hostinger/finowise.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now finowise
curl http://127.0.0.1:3000/api/health     # should answer with JSON
```

### 7. nginx + HTTPS

```bash
cp /home/finowise/app/deploy/hostinger/nginx.conf /etc/nginx/sites-available/finowise
nano /etc/nginx/sites-available/finowise   # replace crm.example.com with your domain
ln -s /etc/nginx/sites-available/finowise /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

apt install -y certbot python3-certbot-nginx
certbot --nginx -d crm.yourdomain.com -m you@example.com --agree-tos --redirect
```

### 8. Firewall

```bash
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable
```

If hPanel's own VPS **Firewall** is enabled, allow ports 22, 80 and 443 there
too. Open `https://crm.yourdomain.com` and sign in.

### Updating and backups

```bash
cd /home/finowise/app && runuser -u finowise -- git pull \
  && runuser -u finowise -- npm ci --omit=dev && systemctl restart finowise
journalctl -u finowise -n 50 --no-pager            # logs
scp root@YOUR_VPS_IP:/home/finowise/data/*.{json,db} ./backup/   # backup
```

The automatic deploy-on-push setup described in `DEPLOY.md` is optional and
can be added later.

---

## Option B: Hostinger managed Node.js hosting (Business / Cloud plans)

hPanel → **Websites** → **Add website** → **Node.js Apps**, then connect the
GitHub repo or upload a zip. Differences from the VPS route:

- **Node version:** pick **22.x** (or newer). `package.json` declares
  `engines.node >= 22.13` because the user accounts use the built-in `node:sqlite`.
- **Entry file:** `server.js`; start command `npm start`; no build step.
- **Port/host:** Hostinger provides `PORT` itself. Do **not** set `PORT` or
  `HOST` yourself.
- **Environment variables:** add `CRM_API_KEY`, `CRM_SESSION_SECRET`, and
  `CRM_DB_FILE` / `CRM_USERS_DB` in the app's environment-variables screen.
  Point the two data paths at a folder **outside** the deployed app folder
  (e.g. `/home/<your-user>/finowise-data/data.json`), because a redeploy
  replaces the app folder and would otherwise delete the database.
- **No nginx/certbot/systemd:** Hostinger handles the proxy, SSL and restarts.
- **First admin:** run the `npm run user` commands from step 5 over the plan's
  SSH access, with the same `CRM_DB_FILE`/`CRM_USERS_DB` values exported first.

If the plan's Node.js screen has no persistent folder outside the app, or no SSH,
use the VPS route instead.
