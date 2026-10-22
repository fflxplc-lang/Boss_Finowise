#!/usr/bin/env bash
# Auto-deployer for the test copy. Installed to /home/finowise-test/deploy.sh by
# install-autodeploy.sh and run every minute by finowise-test-deploy.timer.
#
# It watches the `deploy` branch, not `main`: changes land on main, and only
# moving `deploy` (when someone says "deploy") puts them live. On a new commit:
# back up the data, install, check, restart, and wait for /api/health. If any
# step fails, the previous commit is put back. Data in /home/finowise-test/data
# is never written by this script except to copy it into backups/.
set -uo pipefail

U=finowise-test
HOME_DIR=/home/$U
APP=$HOME_DIR/app
BRANCH=deploy
STATUS=$HOME_DIR/deploy-status.txt
BACKUPS=$HOME_DIR/backups
PORT=$(sed -n 's/^PORT=//p' $HOME_DIR/app.env)
NODE=$(command -v node)

as_app() { runuser -u $U -- "$@"; }
log() { echo "$(date -u +%FT%TZ) $*"; }
status() { echo "$(date -u +%FT%TZ) $*" > $STATUS; chown $U:$U $STATUS; log "$*"; }

healthy() {
  for _ in $(seq 1 20); do
    curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null && return 0
    sleep 1
  done
  return 1
}

install_and_start() {   # $1 = commit
  as_app git -C $APP reset -q --hard "$1" &&
  (cd $APP && as_app npm ci --omit=dev --no-audit --no-fund --loglevel=error) &&
  as_app "$NODE" --check $APP/server.js &&
  systemctl restart finowise-test &&
  healthy
}

as_app git -C $APP fetch -q origin "$BRANCH" 2>/dev/null || exit 0   # no deploy branch yet: nothing to do
NEW=$(as_app git -C $APP rev-parse "origin/$BRANCH")
CUR=$(as_app git -C $APP rev-parse HEAD)
[ "$NEW" = "$CUR" ] && exit 0
# A commit that already failed is not retried every minute; push a new one.
[ "$NEW" = "$(cat $HOME_DIR/deploy-failed 2>/dev/null)" ] && exit 0

log "deploying ${NEW:0:7} (was ${CUR:0:7})"
mkdir -p $BACKUPS
STAMP=$(date -u +%Y%m%d-%H%M%S)
cp -a $HOME_DIR/data "$BACKUPS/$STAMP-before-${NEW:0:7}"
ls -1dt $BACKUPS/*/ 2>/dev/null | tail -n +21 | xargs -r rm -rf   # keep the last 20
chown -R $U:$U $BACKUPS

if install_and_start "$NEW"; then
  rm -f $HOME_DIR/deploy-failed
  status "LIVE ${NEW:0:7}"
else
  echo "$NEW" > $HOME_DIR/deploy-failed
  log "${NEW:0:7} failed; putting ${CUR:0:7} back"
  if install_and_start "$CUR"; then
    status "ROLLED BACK to ${CUR:0:7} - ${NEW:0:7} failed (see: journalctl -u finowise-test-deploy)"
  else
    status "CRITICAL: ${NEW:0:7} failed and rolling back to ${CUR:0:7} also failed"
  fi
  exit 1
fi
