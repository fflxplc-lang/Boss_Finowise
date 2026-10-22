#!/bin/bash
# The whole set, across N workers.
#
#   ./parallel.sh                 — every suite, N=4
#   N=12 ./parallel.sh            — twelve workers
#   N=6 ./parallel.sh a b c       — just these, across six
#
# Each worker owns a thousand ports and a store of its own, and restarts its
# server on a wiped store before every suite — the same guarantee run.sh
# gives, held while twelve of them run at once. Suites take their port from
# BOSS_PORT, so nothing has to be rewritten to move one.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
N=${N:-4}
WORK="$HERE/.work"
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

# Longest first into the emptiest worker, using what the last run measured.
# Round-robin used to leave one worker holding three slow suites while the
# others sat idle.
python3 - "$N" "$WORK" "$HERE/.times" "${SUITES[@]}" <<'SCHED'
import os, sys
n = int(sys.argv[1]); work = sys.argv[2]; timesfile = sys.argv[3]
suites = sys.argv[4:]
seen = {}
if os.path.exists(timesfile):
    for line in open(timesfile):
        a = line.split()
        if len(a) == 2:
            try: seen[a[0]] = int(a[1])
            except ValueError: pass
default = max(seen.values()) if seen else 60
load = [0]*n; bins = [[] for _ in range(n)]
for t in sorted(suites, key=lambda t: -seen.get(t, default)):
    w = load.index(min(load)); bins[w].append(t); load[w] += seen.get(t, default)
for w, b in enumerate(bins):
    if b: open(os.path.join(work, 'list%d' % w), 'w').write('\n'.join(b) + '\n')
print('plan: ' + ' | '.join('w%d %ds/%d' % (w, load[w], len(bins[w])) for w in range(n) if bins[w]),
      file=sys.stderr)
SCHED

worker(){
  local w=$1
  local D="$WORK/w$w"
  local PORT=$((3000 + 8000 + w*1000))
  local SMTP=$((PORT + 251))
  mkdir -p "$D"
  local SRV=
  stopsrv(){ [ -n "$SRV" ] && { kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; SRV=; }; }
  startsrv(){
    stopsrv
    rm -rf "$D/store"; mkdir -p "$D/store"
    ( cd "$ROOT" && CRM_USERS_DB="$D/store/users.db" node scripts/user.js add test@finowise.test testpassword1 >/dev/null 2>&1
      cd "$ROOT" && CRM_USERS_DB="$D/store/users.db" node scripts/user.js role test@finowise.test admin >/dev/null 2>&1 )
    ( cd "$ROOT" && PORT=$PORT \
        CRM_DB_FILE="$D/store/data.json" \
        CRM_CONNECTIONS_FILE="$D/store/connections.json" \
        CRM_USERS_DB="$D/store/users.db" \
        CRM_PIN_LOOKUP_URL="http://127.0.0.1:$(($PORT + 252))/pincode/" \
        CRM_IFSC_LOOKUP_URL="http://127.0.0.1:$(($PORT + 252))/ifsc/" \
        CRM_PJ_AUTORUN=off \
        exec node server.js ) > "$D/server.log" 2>&1 &
    SRV=$!
    for _ in $(seq 1 150); do
      curl -sf "localhost:$PORT/api/health" >/dev/null 2>&1 && return 0
      sleep 0.1
    done
    echo "WARN  worker $w: the server on $PORT never answered"
  }
  while read -r t; do
    startsrv
    local t0=$SECONDS
    ( cd "$HERE" && BOSS_PORT=$PORT BOSS_SMTP_PORT=$SMTP \
        timeout "${SUITE_TIMEOUT:-900}" node "suites/$t.js" > "$D/$t.out" 2>&1 )
    local rc=$? took=$((SECONDS - t0))
    echo "$t $took" >> "$WORK/times.raw"
    {
      echo "=== $t  (${took}s) ==="
      if [ $rc -eq 124 ]; then echo "FAIL  $t TIMED OUT after ${SUITE_TIMEOUT:-900}s"
      elif [ $rc -ne 0 ]; then grep -E '^(FAIL|[0-9]+ PROBLEM|PAGEERROR|CONSOLE|SUITE CRASHED)' "$D/$t.out" | head -20
      else echo "ALL CLEAN"; fi
    } >> "$WORK/report.$w"
  done < "$WORK/list$w"
  stopsrv
}

for w in $(seq 0 $((N-1))); do
  [ -f "$WORK/list$w" ] || continue
  worker "$w" &
done
wait

cat "$WORK"/report.* 2>/dev/null | sort > "$WORK/report.all"
# Remember how long each suite took, so the next run packs the workers better.
[ -f "$WORK/times.raw" ] && sort -u -k1,1 "$WORK/times.raw" > "$HERE/.times"

ran=0; bad=0
if [ -f "$WORK/report.all" ]; then
  ran=$(grep -c '^=== ' "$WORK/report.all" 2>/dev/null); ran=${ran:-0}
  bad=$(grep -c '^FAIL'  "$WORK/report.all" 2>/dev/null); bad=${bad:-0}
fi
echo
grep -B1 '^FAIL' "$WORK/report.all" 2>/dev/null | head -60
echo "suites : $ran of ${#SUITES[@]}"
echo "failed : $bad"
if [ "$ran" -ne "${#SUITES[@]}" ]; then echo "  INCOMPLETE — see $WORK/report.all"; exit 1; fi
[ "$bad" -eq 0 ] && echo "every suite clean"
exit $(( bad > 0 ))
