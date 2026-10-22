#!/usr/bin/env bash
# One-shot setup (and update) of the Finowise CRM test copy on the production VPS.
# Run as root:  bash setup.sh
# Touches only finowise-test things; never the production app, data, service or site.
# Safe to re-run: later runs pull the latest code and restart the test copy.
set -euo pipefail

DOMAIN="${DOMAIN:-test.freedomlifex.in}"
# A re-run keeps the port chosen the first time (it is saved in app.env).
SAVED_PORT=$(sed -n 's/^PORT=//p' /home/finowise-test/app.env 2>/dev/null || true)
PORT="${PORT:-${SAVED_PORT:-3001}}"
# Once auto-deploy is in use, the live code is whatever the `deploy` branch says.
if [ -z "${BRANCH:-}" ]; then
  if git ls-remote --exit-code --heads https://github.com/fflxplc-lang/test-finolifex-crm.git deploy >/dev/null 2>&1
  then BRANCH=deploy; else BRANCH=main; fi
fi
REPO="https://github.com/fflxplc-lang/test-finolifex-crm.git"
U=finowise-test
HOME_DIR=/home/$U
APP=$HOME_DIR/app
ENV_FILE=$HOME_DIR/app.env
SITE=/etc/nginx/sites-available/finowise-test

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mSTOPPED: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run this as root"

say "Checking Node.js"
NODE=$(command -v node) || die "node is not installed"
"$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || die "Node $("$NODE" -v) is too old; need 22.13+"
echo "$NODE $("$NODE" -v)"

say "Checking port $PORT is free (or already ours)"
LISTENERS=$(ss -ltnpH "sport = :$PORT")
if [ -n "$LISTENERS" ]; then
  systemctl is-active --quiet finowise-test && [[ $LISTENERS == *node* ]] \
    || die "port $PORT is used by something else; re-run with PORT=3002 bash setup.sh"
fi

say "Linux user $U"
id $U >/dev/null 2>&1 || adduser --system --group --home $HOME_DIR --shell /bin/bash $U
mkdir -p $HOME_DIR/data

say "Code ($BRANCH)"
if [ -d $APP/.git ]; then
  runuser -u $U -- git -C $APP fetch -q origin $BRANCH
  runuser -u $U -- git -C $APP reset -q --hard origin/$BRANCH
else
  git clone -q -b $BRANCH $REPO $APP
fi
chown -R $U:$U $HOME_DIR
(cd $APP && runuser -u $U -- npm ci --omit=dev --no-audit --no-fund)
runuser -u $U -- "$NODE" --check $APP/server.js
echo "commit $(runuser -u $U -- git -C $APP rev-parse --short HEAD)"

say "Environment"
if [ ! -f $ENV_FILE ]; then
  cat > $ENV_FILE <<EOF
PORT=$PORT
HOST=127.0.0.1
CRM_DB_FILE=$HOME_DIR/data/data.json
CRM_USERS_DB=$HOME_DIR/data/users.db
CRM_API_KEY=$(openssl rand -hex 32)
CRM_SESSION_SECRET=$(openssl rand -hex 32)
EOF
  echo "created $ENV_FILE with new secrets"
else
  echo "keeping existing $ENV_FILE"
fi
chown $U:$U $ENV_FILE && chmod 600 $ENV_FILE

say "Service finowise-test"
cat > /etc/systemd/system/finowise-test.service <<EOF
[Unit]
Description=Finowise CRM (test copy)
After=network.target

[Service]
User=$U
WorkingDirectory=$APP
EnvironmentFile=$ENV_FILE
ExecStart=$NODE server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q finowise-test
systemctl restart finowise-test
for i in $(seq 1 20); do curl -fs http://127.0.0.1:$PORT/api/health >/dev/null && break; sleep 1; done
curl -fs http://127.0.0.1:$PORT/api/health >/dev/null \
  || { journalctl -u finowise-test -n 30 --no-pager; die "test app did not start (logs above)"; }
echo "test app answering on 127.0.0.1:$PORT"

say "Admin login for the test copy"
EMAIL=""
{ read -rp "Admin email (blank to skip): " EMAIL </dev/tty; } 2>/dev/null || echo "(no terminal, skipping)"
if [ -n "$EMAIL" ]; then
    read -rsp "Password for $EMAIL: " PW </dev/tty; echo
    (cd $APP && runuser -u $U -- env $(grep -v '^#' $ENV_FILE | xargs) "$NODE" scripts/user.js add "$EMAIL" "$PW" \
      || echo "(user may already exist; setting role anyway)")
    (cd $APP && runuser -u $U -- env $(grep -v '^#' $ENV_FILE | xargs) "$NODE" scripts/user.js role "$EMAIL" admin)
fi

say "nginx site for $DOMAIN"
if [ ! -f $SITE ]; then
  cat > $SITE <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    client_max_body_size 25m;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  ln -sf $SITE /etc/nginx/sites-enabled/finowise-test
  if ! nginx -t 2>/dev/null; then
    rm -f /etc/nginx/sites-enabled/finowise-test $SITE
    nginx -t || true
    die "nginx rejected the new site; removed it again, production untouched"
  fi
  systemctl reload nginx
  echo "site enabled"
else
  echo "site already exists, leaving it as is"
fi

say "HTTPS"
IP_DNS=$(timeout 10 getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)
if [ -z "$IP_DNS" ] || [[ " $(hostname -I) " != *" $IP_DNS "* ]]; then
  echo "$DOMAIN resolves to '${IP_DNS:-nothing}', not this server ($(hostname -I | awk '{print $1}'))."
  echo "Point its DNS A record here, wait a few minutes, then re-run this script for HTTPS."
  echo "Until then: http://$DOMAIN works only once DNS points here."
  exit 0
fi
command -v certbot >/dev/null || apt-get install -y -q certbot python3-certbot-nginx
certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos \
  --register-unsafely-without-email --keep-until-expiring

say "Done: https://$DOMAIN"
