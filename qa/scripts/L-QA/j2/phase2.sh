#!/usr/bin/env bash
# J2 phase 2 (under ring + phone locks for the whole run, ~17 min): screen off for $1 minutes with the link up.
source /media/DEV/Hobby/vitals-wt/L-QA/qa/scripts/L-QA/j2/lib.sh
M=${1:-15}; echo "== phase2 start $(ts)"
$A shell input keyevent KEYCODE_WAKEUP; sleep 1; lockscreen
$A shell am force-stop com.pulseloop.debug
front || { $A shell am start -n desi.creative.vitals/.MainActivity >/dev/null; sleep 8; }
need_front; fwd; $A logcat -c
echo "-- product state before (no test hook): $(ts)"; svc; gatt
echo "-- test-hook link + keepAlive"; drive eval "$(cat $J2/bg-start.js)" | tee "$P/j2-10-bg-start.json"
grep -q connectMs "$P/j2-10-bg-start.json" || { echo "no ring link; stopping"; exit 4; }
PID0=$($A shell pidof desi.creative.vitals | tr -d '\r'); echo "app pid recorded"
svc; gatt
$A shell input keyevent 223; sleep 2; echo "screen off $(ts)"; lockscreen
for i in $(seq 1 $M); do sleep 60
  PID=$($A shell pidof desi.creative.vitals | tr -d '\r')
  echo "$(ts) min $i: process $([ "$PID" = "$PID0" ] && echo same || echo "CHANGED/none") svc=$($A shell dumpsys activity services desi.creative.vitals | grep -c RingLinkService) wake=$($A shell dumpsys power | grep -m1 mWakefulness | tr -d ' ')"
done
echo "after $M min (screen still off) $(ts)"; svc; gatt
echo "-- report while screen off"; fwd; drive eval "$(cat $J2/bg-report.js)" | tee "$P/j2-11-bg-report-off.json"
$A shell input keyevent 224; sleep 2; echo "screen on $(ts)"; lockscreen
echo "focus: $($A shell dumpsys window | grep mCurrentFocus | sed 's/.*u0 //')"
fwd; drive eval "$(cat $J2/bg-report.js)" | tee "$P/j2-12-bg-report-on.json"
front && shot j2-13-after-screen-off
applog 40 > "$P/j2-14-logcat-screenoff.txt"; echo "logcat link lines: $(grep -ciE 'disconnect' "$P/j2-14-logcat-screenoff.txt") disconnect mentions"
$A shell dumpsys activity exit-info desi.creative.vitals | grep -E 'timestamp=|reason=' | head -4
echo "== phase2 end $(ts)"
