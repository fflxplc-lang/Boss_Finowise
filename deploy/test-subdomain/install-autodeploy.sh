#!/usr/bin/env bash
# Turns on deploy-on-push for the test copy. Run once as root, after setup.sh:
#   bash install-autodeploy.sh
# Installs /home/finowise-test/deploy.sh plus a systemd timer that runs it every
# minute. The script is copied onto the server, so a bad commit cannot break the
# thing that rolls bad commits back. Re-run to pick up a newer deploy.sh.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run this as root" >&2; exit 1; }
[ -d /home/finowise-test/app/.git ] || { echo "run setup.sh first" >&2; exit 1; }

SRC="https://raw.githubusercontent.com/fflxplc-lang/test-finolifex-crm/main/deploy/test-subdomain/autodeploy.sh"
curl -fsSL "$SRC" -o /home/finowise-test/deploy.sh
bash -n /home/finowise-test/deploy.sh
chmod 700 /home/finowise-test/deploy.sh

cat > /etc/systemd/system/finowise-test-deploy.service <<'EOF'
[Unit]
Description=Deploy the Finowise CRM test copy from the deploy branch

[Service]
Type=oneshot
ExecStart=/home/finowise-test/deploy.sh
EOF

cat > /etc/systemd/system/finowise-test-deploy.timer <<'EOF'
[Unit]
Description=Check the deploy branch for the Finowise CRM test copy every minute

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now finowise-test-deploy.timer
systemctl start finowise-test-deploy.service || true
echo
echo "Auto-deploy is on. Status: cat /home/finowise-test/deploy-status.txt"
echo "History:  journalctl -u finowise-test-deploy -n 30 --no-pager"
