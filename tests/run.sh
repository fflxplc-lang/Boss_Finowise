#!/bin/bash
# Run one suite, or several, one after another.
#
#   ./run.sh                 — every suite in suites/
#   ./run.sh smoke forms     — just these
#
# Each suite gets a server of its own on a wiped store, exactly as it would
# meet a fresh install. Sharing one store across suites is what used to make
# a mail test count four letters instead of three.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PORT=${BOSS_PORT:-3000}
WORK="$HERE/.work/serial"
rm -rf "$WORK"; mkdir -p "$WORK"

if [ ! -d "$HERE/node_modules/playwright-core" ]; then
  echo "playwright-core is not installed. Run:  cd tests && npm install"
  exit 2
fi

SUITES=("$@")
if [ ${#SUITES[@]} -eq 0 ]; then
  SUITES=()
  for f in "$HERE"/suites/*.js; do SUITES+=("$(basename "$f" .js)"); done
fi

SRV=
stopsrv(){
  [ -n "$SRV" ] && { kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; SRV=; }
  for _ in $(seq 1 20); do
    (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null || return 0
    sleep 0.2
  done
}
startsrv(){
  stopsrv
  rm -rf "$WORK"; mkdir -p "$WORK"
  ( cd "$ROOT" && CRM_USERS_DB="$WORK/users.db" node scripts/user.js add test@finowise.test testpassword1 >/dev/null 2>&1
    cd "$ROOT" && CRM_USERS_DB="$WORK/users.db" node scripts/user.js role test@finowise.test admin >/dev/null 2>&1 )
  ( cd "$ROOT" && PORT=$PORT \
      CRM_DB_FILE="$WORK/data.json" \
      CRM_CONNECTIONS_FILE="$WORK/connections.json" \
      CRM_USERS_DB="$WORK/users.db" \
      CRM_PIN_LOOKUP_URL="http://127.0.0.1:$(($PORT + 252))/pincode/" \
      CRM_IFSC_LOOKUP_URL="http://127.0.0.1:$(($PORT + 252))/ifsc/" \
      CRM_PJ_AUTORUN=off \
      exec node server.js ) > "$WORK/server.log" 2>&1 &
  SRV=$!
  for _ in $(seq 1 120); do
    curl -sf "localhost:$PORT/api/health" >/dev/null 2>&1 && return 0
    sleep 0.1
  done
  echo "WARN  the server on $PORT never answered — see $WORK/server.log"
}

fails=0 ran=0
for t in "${SUITES[@]}"; do
  [ -f "$HERE/suites/$t.js" ] || { echo "no such suite: $t"; fails=$((fails+1)); continue; }
  startsrv
  echo "=== $t ==="
  ( cd "$HERE" && BOSS_PORT=$PORT timeout "${SUITE_TIMEOUT:-600}" node "suites/$t.js" )
  rc=$?
  ran=$((ran+1))
  [ $rc -ne 0 ] && { fails=$((fails+1)); [ $rc -eq 124 ] && echo "FAIL  $t TIMED OUT"; }
done
stopsrv

echo
echo "suites : $ran"
echo "failed : $fails"
[ $fails -eq 0 ] && echo "every suite clean"
exit $(( fails > 0 ))
