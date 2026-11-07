#!/usr/bin/env bash
# The Vitals Server watchdog (r063, after the 2026-10-28 incident: the server's event loop sat in one SQLite read and
# answered nothing for 12 minutes until it was restarted by hand). Run every minute by vitals-watchdog.timer (a user
# timer that deploy/oci-arm.sh installs as ~/vitals-server/bin/vitals-watchdog):
#
# - GET http://127.0.0.1:$VITALS_PORT/health with a 10 s limit; an answer resets the count;
# - no answer (or an error status) counts one failure; after $VITALS_WATCHDOG_FAILURES (3) in a row it restarts
#   vitals-server and logs it;
# - only a server systemd reports `active` is watched (stopped, starting or failed is systemd's and the owner's
#   business), and not in the first $VITALS_WATCHDOG_GRACE_S (180) seconds after it started: a lumen.db migration runs
#   then.
#
# Log: ~/.local/state/vitals-server/watchdog.log (only times, counts and restarts; never a request or a payload).
set -u
PORT="${VITALS_PORT:-4870}"
LIMIT="${VITALS_WATCHDOG_FAILURES:-3}"
GRACE_S="${VITALS_WATCHDOG_GRACE_S:-180}"
TIMEOUT_S="${VITALS_WATCHDOG_TIMEOUT_S:-10}"
UNIT="${VITALS_WATCHDOG_UNIT:-vitals-server}"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/vitals-server"
FAILS="$STATE/watchdog.failures"
LOG="$STATE/watchdog.log"
mkdir -p "$STATE"

log() {
  printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG"
  printf '%s\n' "$*"
  # keep the log short
  if [ "$(wc -l <"$LOG")" -gt 2000 ]; then tail -n 1000 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi
}

if [ "$(systemctl --user is-active "$UNIT" 2>/dev/null)" != "active" ]; then
  rm -f "$FAILS"
  exit 0
fi

# seconds since the unit became active (both clocks count from boot)
entered_us="$(systemctl --user show "$UNIT" -p ActiveEnterTimestampMonotonic --value 2>/dev/null || echo 0)"
up_s="$(cut -d' ' -f1 /proc/uptime)"
age_s="$(awk -v up="$up_s" -v e="${entered_us:-0}" 'BEGIN { printf "%d", up - e / 1000000 }')"

if curl -fsS -m "$TIMEOUT_S" -o /dev/null "http://127.0.0.1:$PORT/health" 2>/dev/null; then
  [ -f "$FAILS" ] && log "health check answered again after $(cat "$FAILS") failure(s)"
  rm -f "$FAILS"
  exit 0
fi

if [ "$age_s" -lt "$GRACE_S" ]; then
  log "health check failed ${age_s} s after start (grace ${GRACE_S} s): not counted"
  exit 0
fi

n=$(( $(cat "$FAILS" 2>/dev/null || echo 0) + 1 ))
echo "$n" >"$FAILS"
log "health check failed ($n of $LIMIT in a row)"
if [ "$n" -ge "$LIMIT" ]; then
  rm -f "$FAILS"
  log "restarting $UNIT after $n failed health checks"
  systemctl --user restart "$UNIT"
fi
