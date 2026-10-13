#!/usr/bin/env bash
# Keeps Segundo's Chainlink CRE reports flowing until the workflow is deployed on a DON: runs
# `cre/simulate.sh --broadcast` every 2 hours, so SegundoKeeper's on-chain rates stay fresh (the web app prefers
# them while the newest report is under 6 hours old) and running tabs keep getting settled.
#
#   scripts/cre-loop.sh            in WSL; stop with Ctrl-C (or kill the PID it logs)
#   CRE_LOOP_EVERY=900 scripts/cre-loop.sh      another interval, in seconds
#   CRE_LOOP_LOG=/path/to.log scripts/cre-loop.sh
#
# Signs with keys/cre.json (see cre/simulate.sh), a key used for nothing else, so it never takes a relayer nonce.
# The log keeps the workflow's own lines and the transaction; the signing key is never printed, and the loop
# removes it from the output anyway should any tool ever echo it.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
sim="$here/../cre/simulate.sh"
every="${CRE_LOOP_EVERY:-7200}"
log="${CRE_LOOP_LOG:-$HOME/.cache/segundo-cre-loop.log}"
lock="${log}.lock"
mkdir -p "$(dirname "$log")"

exec 9>"$lock"
if ! flock -n 9; then echo "Another cre-loop is already running (lock $lock)." >&2; exit 1; fi

secret=$(grep -oE '[0-9a-fA-F]{64}"' "$here/../keys/cre.json" 2>/dev/null | head -1 | tr -d '"')
scrub() {
  if [ -n "$secret" ]; then sed -u "s/$secret/[key]/g"; else cat; fi
}
stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

echo "$(stamp) cre-loop started, pid $$, every ${every}s, log $log" | tee -a "$log"
trap 'echo "$(stamp) cre-loop stopped" >>"$log"; exit 0' INT TERM

run=0
while true; do
  run=$((run + 1))
  echo "$(stamp) run $run: simulate --broadcast" >>"$log"
  # A hung run (network, simulator) is cut off well before the next one is due.
  timeout 1200 bash "$sim" --broadcast 2>&1 | scrub |
    grep -E 'USER LOG|Simulation Result|Settled|posted|Signing with|rror|panic|fatal|failed|insufficient' >>"$log"
  status=${PIPESTATUS[0]}
  echo "$(stamp) run $run finished, exit $status" >>"$log"
  sleep "$every" &
  wait $!
done
