#!/usr/bin/env bash
# The Vitals Server watchdog (r063, after the 2026-10-28 incident: the server's event loop sat in one SQLite read and
# answered nothing for 12 minutes until it was restarted by hand). Run every minute by vitals-watchdog.timer (a user
# timer that deploy/oci-arm.sh installs as ~/vitals-server/bin/vitals-watchdog).
#
# It must tell a busy server from a dead one (r087 S5: three slow answers during a burst of reads restarted a healthy
# server and cut every request in flight). The reads are synchronous SQLite on the event loop, so while they run
# /health cannot answer either: a slow /health alone says nothing. What does is the event-loop thread itself: the
# server's main thread (tid = pid) runs every read, so its CPU time (/proc/<pid>/task/<pid>/stat, utime + stime) grows
# while it works and stands still when it is stuck (a lock, a hung syscall, a stopped process). Each run:
#
# - GET http://127.0.0.1:$VITALS_PORT/health with a $VITALS_WATCHDOG_TIMEOUT_S (20) second limit; an answer resets
#   both counts;
# - no answer (or an error status) is one failure. It is "stalled" unless the main thread used at least
#   $VITALS_WATCHDOG_BUSY_CPU_MS (1000) ms of CPU since the last run, and "busy" if it did (a busy failure resets the
#   stalled count: the loop is moving);
# - restart after $VITALS_WATCHDOG_FAILURES (3) stalled failures in a row, or after $VITALS_WATCHDOG_BUSY_FAILURES
#   (6) failures in a row of any kind: the bursts that tripped it last about two minutes (two or three failed checks),
#   and a loop that spins for six without answering is a runaway read, as on 2026-10-28;
# - when the CPU time cannot be read (no previous sample, a new pid, no /proc) the failure counts as stalled, as
#   before r087;
# - only a server systemd reports `active` is watched (stopped, starting or failed is systemd's and the owner's
#   business), and not in the first $VITALS_WATCHDOG_GRACE_S (180) seconds after it started: a lumen.db migration runs
#   then.
#
# Log: ~/.local/state/vitals-server/watchdog.log (only times, counts, CPU and restarts; never a request or a payload).
# POSIX sh; the tests run it with fake curl, systemctl and /proc (packages/companion/src/watchdog.test.ts).
set -u
PORT="${VITALS_PORT:-4870}"
LIMIT="${VITALS_WATCHDOG_FAILURES:-3}"
BUSY_LIMIT="${VITALS_WATCHDOG_BUSY_FAILURES:-6}"
BUSY_CPU_MS="${VITALS_WATCHDOG_BUSY_CPU_MS:-1000}"
GRACE_S="${VITALS_WATCHDOG_GRACE_S:-180}"
TIMEOUT_S="${VITALS_WATCHDOG_TIMEOUT_S:-20}"
UNIT="${VITALS_WATCHDOG_UNIT:-vitals-server}"
PROC="${VITALS_WATCHDOG_PROC:-/proc}"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/vitals-server"
FAILS="$STATE/watchdog.failures"
CPU="$STATE/watchdog.cpu"
LOG="$STATE/watchdog.log"
mkdir -p "$STATE"

log() {
  printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG"
  printf '%s\n' "$*"
  # keep the log short
  if [ "$(wc -l <"$LOG")" -gt 2000 ]; then tail -n 1000 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi
}

# "<pid> <ticks>": the main thread's CPU time in clock ticks; empty when it cannot be read. The command name in field 2
# may hold spaces, so the fields are counted after its closing parenthesis (utime and stime are fields 14 and 15).
cpu_sample() {
  pid="$(systemctl --user show "$UNIT" -p MainPID --value 2>/dev/null)"
  case "$pid" in '' | 0 | *[!0-9]*) return 0 ;; esac
  ticks="$(sed 's/.*) //' "$PROC/$pid/task/$pid/stat" 2>/dev/null | awk '{ print $12 + $13 }')"
  [ -n "$ticks" ] && printf '%s %s\n' "$pid" "$ticks"
}

if [ "$(systemctl --user is-active "$UNIT" 2>/dev/null)" != "active" ]; then
  rm -f "$FAILS" "$CPU"
  exit 0
fi

# seconds since the unit became active (both clocks count from boot)
entered_us="$(systemctl --user show "$UNIT" -p ActiveEnterTimestampMonotonic --value 2>/dev/null || echo 0)"
up_s="$(cut -d' ' -f1 "$PROC/uptime")"
age_s="$(awk -v up="$up_s" -v e="${entered_us:-0}" 'BEGIN { printf "%d", up - e / 1000000 }')"

curl -fsS -m "$TIMEOUT_S" -o /dev/null "http://127.0.0.1:$PORT/health" 2>/dev/null
answered=$?
# sampled after the probe, so the window between two samples is one whole run apart
prev="$(cat "$CPU" 2>/dev/null)"
now="$(cpu_sample)"
if [ -n "$now" ]; then echo "$now" >"$CPU"; else rm -f "$CPU"; fi

if [ "$answered" -eq 0 ]; then
  [ -f "$FAILS" ] && log "health check answered again after $(cut -d' ' -f1 "$FAILS") failure(s)"
  rm -f "$FAILS"
  exit 0
fi

if [ "$age_s" -lt "$GRACE_S" ]; then
  log "health check failed ${age_s} s after start (grace ${GRACE_S} s): not counted"
  exit 0
fi

# CPU the main thread used since the last run (ms), or empty when there is nothing to compare
used_ms=""
if [ -n "$prev" ] && [ -n "$now" ] && [ "${prev%% *}" = "${now%% *}" ]; then
  hz="$(getconf CLK_TCK 2>/dev/null || echo 100)"
  used_ms="$(awk -v a="${prev#* }" -v b="${now#* }" -v hz="$hz" 'BEGIN { printf "%d", (b - a) * 1000 / hz }')"
fi

# watchdog.failures: "<failures in a row> <stalled failures in a row>"
n=0 stalled=0
[ -f "$FAILS" ] && read -r n stalled <"$FAILS"
n=$(( ${n:-0} + 1 ))
if [ -n "$used_ms" ] && [ "$used_ms" -ge "$BUSY_CPU_MS" ]; then
  stalled=0
  what="busy: main thread used ${used_ms} ms of CPU since the last check"
else
  stalled=$(( ${stalled:-0} + 1 ))
  what="stalled: main thread used ${used_ms:-unknown} ms of CPU since the last check"
fi
echo "$n $stalled" >"$FAILS"
log "health check failed ($n in a row, $stalled of $LIMIT stalled, $BUSY_LIMIT in all); $what"
if [ "$stalled" -ge "$LIMIT" ] || [ "$n" -ge "$BUSY_LIMIT" ]; then
  rm -f "$FAILS" "$CPU"
  log "restarting $UNIT after $n failed health checks ($stalled stalled)"
  systemctl --user restart "$UNIT"
fi
