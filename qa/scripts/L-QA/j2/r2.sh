#!/usr/bin/env bash
# J2 round 2 (run under hw-run.sh ring hw-run.sh phone): bash r2.sh <phase>...
#   a   free the ring, launch Vitals, first run if needed, downloads block, Add a ring (one tap), counts, /ring /signals,
#       keep my ring connected, QA read interval 5 min (androidRingLink's BACKGROUND_READ_MINUTES_KEY) + reload
#   off screen off 15 min (adb only while off: no DevTools calls), wake, evidence of background reads
#   b   QA interval removed, force-stop + relaunch → reconnects by itself; in-app Disconnect → Connect; leave it connected
# Never changes a phone setting, never uninstalls or clears data, never relaunches the phone's other ring app.
# Output (screens, page text, logcat) only in qa/results/L-QA/round2/private/j2 (git-ignored).
source /media/DEV/Hobby/vitals-wt/L-QA/qa/scripts/L-QA/j2/lib.sh
P=/media/DEV/Hobby/vitals-wt/L-QA/qa/results/L-QA/round2/private/j2
mkdir -p "$P"
R() { node $J2/r2.mjs "$@"; }
shot() { need_front; $A exec-out screencap -p > "$P/$1.png"; echo "$(ts) shot $1.png"; }
alarms() { echo "alarm entries for vitals: $($A shell dumpsys alarm | grep -c 'desi.creative.vitals')"; $A shell dumpsys alarm | grep -A3 'u0a[0-9]*:desi.creative.vitals' | grep -E 'wakeup|alarm' | head -4; }
wakelocks() { $A shell dumpsys power | grep -i 'ring-read' | head -3; }
STATE=$P/r2-state.env
touch "$STATE"; source "$STATE"

phase_a() {
  echo "== A start $(ts)"; tail -3 /media/DEV/Hobby/vitals-wt/.jobs/NOTICES.md | cut -c1-120
  $A shell dumpsys package desi.creative.vitals | grep -m2 -E 'versionName|lastUpdateTime'
  echo "PC desktop Vitals processes: $(pgrep -fc 'linux-unpacked/vitals')"
  $A shell input keyevent KEYCODE_WAKEUP; sleep 1; lockscreen
  $A shell am force-stop com.pulseloop.debug; echo "other ring app force-stopped; pid now: '$($A shell pidof com.pulseloop.debug | tr -d '\r')'"
  $A shell am force-stop desi.creative.vitals; $A logcat -c
  $A shell am start -n desi.creative.vitals/.MainActivity >/dev/null; sleep 10
  echo "focus: $($A shell dumpsys window | grep mCurrentFocus | sed 's/.*u0 //')"; need_front
  fwd; R state
  shot r2j2-01-first-screen
  need_front; R welcome
  need_front; R counts > "$P/r2j2-counts-before.txt"; head -c 1500 "$P/r2j2-counts-before.txt" | sed -E 's/"(points|records)":[0-9]+/"\1":N/g' | head -5
  need_front; R nav /settings > "$P/r2j2-02-settings.txt"; shot r2j2-02-settings
  R eval "return [...document.querySelectorAll('*')].filter(e => /get the app/i.test(e.textContent) && e.children.length === 0).length" | sed 's/^/leaf nodes with "Get the app" in Settings: /'
  grep -ciE 'download|for android|for windows|for linux|for mac' "$P/r2j2-02-settings.txt" | sed 's/^/Settings lines with download words: /'
  grep -iE 'install' "$P/r2j2-02-settings.txt" | head -4 | sed 's/^/install line: /'
  need_front; R nav /settings/devices > "$P/r2j2-03-devices-before.txt"; shot r2j2-03-devices-before
  need_front
  permwatch 150 > "$P/r2j2-perm.log" 2>&1 & W=$!
  echo "-- add ring $(ts)"; R addring 2>&1 | tee "$P/r2j2-04-addring.log" | grep -vE '^\[.*card ' ; kill $W 2>/dev/null; cat "$P/r2j2-perm.log"
  need_front; shot r2j2-05-devices-after-read
  R ringcard > "$P/r2j2-05-card.txt"
  echo "-- link state $(ts)"; svc; gatt
  need_front; R counts > "$P/r2j2-06-counts.txt"; echo "counts saved"
  need_front; R nav /ring > "$P/r2j2-07-ring.txt"; shot r2j2-07-ring
  need_front; R nav '/signals?tab=sleep' > "$P/r2j2-08-signals-sleep.txt"; shot r2j2-08-signals-sleep
  need_front; R nav '/signals?tab=heart' > "$P/r2j2-09-signals-heart.txt"; shot r2j2-09-signals-heart
  for f in 07-ring 08-signals-sleep 09-signals-heart; do echo "$f: $(wc -c < "$P/r2j2-$f.txt") chars; coming-soon $(grep -ci 'coming soon' "$P/r2j2-$f.txt"); get-the-app $(grep -ci 'get the app' "$P/r2j2-$f.txt"); welcome-redirect $(head -1 "$P/r2j2-$f.txt" | grep -c welcome)"; done
  need_front; R keep
  need_front; R qatick 5
  need_front; R reload; sleep 20; fwd; R ringcard; R shell
  echo "== A end $(ts)"
}

phase_conn() {
  echo "== CONN start $(ts)"
  $A shell input keyevent KEYCODE_WAKEUP; sleep 2; lockscreen
  echo "focus: $($A shell dumpsys window | grep mCurrentFocus | sed 's/.*u0 //')"
  need_front; fwd; R ringcard | tail -1 | sed -E 's/Heart rate now [0-9]+ bpm/live HR/' | cut -c1-300
  need_front; R connect | sed -E 's/Heart rate now [0-9]+ bpm/live HR/' | cut -c1-300
  for i in $(seq 1 20); do c=$(R ringcard | tail -1); echo "$c" | grep -q 'Last read' && echo "$c" | grep -q Disconnect && ! echo "$c" | grep -qE 'Reading your ring|Connecting' && break; sleep 5; done
  echo "$(ts) card: $(echo "$c" | sed -E 's/Heart rate now [0-9]+ bpm/live HR/' | cut -c1-300)"
  need_front; shot r2j2-05b-devices-connected; R counts > "$P/r2j2-06b-counts-connected.txt"; echo "counts saved"
  echo "== CONN end $(ts)"
}

phase_off() {
  echo "== OFF start $(ts)"
  need_front; R shell | tee "$P/r2j2-10-shell-before-off.txt"; svc; alarms
  local pid0; pid0=$($A shell pidof desi.creative.vitals | tr -d '\r')
  local toff; toff=$(date -u +%FT%T.000Z)
  echo "T_OFF=$toff" >> "$STATE"
  $A shell input keyevent 223
  echo "screen off at $(ts) ($toff)"
  for m in $(seq 1 15); do
    sleep 60
    echo "$(ts) +${m}m $($A shell dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*') pid=$($A shell pidof desi.creative.vitals | tr -d '\r') fg=$($A shell dumpsys activity services desi.creative.vitals | grep -c 'isForeground=true') notif=$($A shell dumpsys notification --noredact | grep -c 'pkg=desi.creative.vitals') wl=$($A shell dumpsys power | grep -ci 'ring-read')"
  done
  $A shell input keyevent 224; sleep 3
  echo "screen on at $(ts); pid before $pid0 now $($A shell pidof desi.creative.vitals | tr -d '\r')"; lockscreen
  echo "focus: $($A shell dumpsys window | grep mCurrentFocus | sed 's/.*u0 //')"
  need_front; fwd; R shell | tee "$P/r2j2-11-shell-after-on.txt"
  svc; alarms
  R counts "$toff" > "$P/r2j2-12-counts-after-off.txt"; grep -E 'samples timestamped|ERR' "$P/r2j2-12-counts-after-off.txt"
  R ringcard > "$P/r2j2-13-card-after-on.txt"; sed -E 's/Heart rate now [0-9]+ bpm/live HR shown/' "$P/r2j2-13-card-after-on.txt" | tail -1 | cut -c1-300
  shot r2j2-13-after-screen-off
  $A logcat -d > "$P/r2j2-14-logcat-full.txt"; echo "logcat lines: $(wc -l < "$P/r2j2-14-logcat-full.txt"); ring-read/tick/RingLink lines: $(grep -ciE 'ring-read|ringtick|RingLink' "$P/r2j2-14-logcat-full.txt")"
  echo "== OFF end $(ts)"
}

phase_b() {
  echo "== B start $(ts)"
  need_front; R qatick off
  $A shell am force-stop desi.creative.vitals; echo "force-stopped $(ts); service entries now $($A shell dumpsys activity services desi.creative.vitals | grep -c RingLinkService)"
  sleep 3; local t; t=$(date +%s)
  $A shell am start -n desi.creative.vitals/.MainActivity >/dev/null; sleep 6
  need_front; fwd
  for i in $(seq 1 30); do
    local c; c=$(R ringcard 2>&1 | grep 'card' | tail -1)
    if echo "$c" | grep -q 'Disconnect' && ! echo "$c" | grep -qE 'Connecting|Looking'; then echo "reconnected by itself $(( $(date +%s) - t )) s after relaunch: $(echo "$c" | sed -E 's/Heart rate now [0-9]+ bpm/live HR/' | cut -c1-200)"; break; fi
    [ "$i" = 30 ] && echo "NOT reconnected after ~$(( $(date +%s) - t )) s: $(echo "$c" | cut -c1-200)"
    sleep 3
  done
  R eval "return document.querySelectorAll('[aria-label=\"rings nearby\"]').length" | sed 's/^/scan lists shown after relaunch: /'
  need_front; shot r2j2-15-devices-relaunch
  svc
  need_front; R disconnect; need_front; shot r2j2-16-after-disconnect
  need_front; R connect; need_front; shot r2j2-17-after-connect
  svc
  R shell
  echo "== B end $(ts) (Vitals left running, ring connected)"
}

for ph in "$@"; do "phase_$ph"; done
