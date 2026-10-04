#!/usr/bin/env bash
# J2 phase 1 (run under hw-run.sh ring hw-run.sh phone): free the ring, launch Vitals, check the downloads block,
# connect the ring through Settings › Devices, capture /ring and /signals.
source /media/DEV/Hobby/vitals-wt/L-QA/qa/scripts/L-QA/j2/lib.sh
echo "== phase1 start $(ts)"
$A shell dumpsys package desi.creative.vitals | grep -m2 -E 'versionName|lastUpdateTime'
echo "PC processes that could hold the ring:"; pgrep -af 'electron|vitals-desktop|Vitals' | grep -v -E 'pgrep|hw-run|phase1|claude' | cut -c1-160 || echo none
$A shell input keyevent KEYCODE_WAKEUP; sleep 1; lockscreen
$A shell am force-stop com.pulseloop.debug; echo "Lumen force-stopped; pid now: $($A shell pidof com.pulseloop.debug | tr -d '\r')"
$A shell am force-stop desi.creative.vitals; $A logcat -c
$A shell am start -n desi.creative.vitals/.MainActivity >/dev/null; sleep 8
echo "focus: $($A shell dumpsys window | grep mCurrentFocus | sed 's/.*u0 //')"; need_front
fwd; drive state
echo "-- first screen"; shot j2-01-first-screen; drive text main > "$P/j2-01-first-screen.txt"
grep -ciE 'get the app' "$P/j2-01-first-screen.txt" | sed 's/^/"Get the app" on first screen: /'
drive eval "return [...document.querySelectorAll('*')].filter(e => /get the app/i.test(e.textContent) && e.children.length === 0).length" | sed 's/^/leaf nodes with "Get the app" (first screen): /'
echo "-- home"; drive nav / > "$P/j2-02-home.txt"; shot j2-02-home; grep -ciE 'get the app|download' "$P/j2-02-home.txt" | sed 's/^/home lines with get-the-app or download: /'
echo "-- settings"; drive nav /settings > "$P/j2-03-settings.txt"; shot j2-03-settings; grep -ciE 'get the app|download the app|for android|for windows|for linux|for mac' "$P/j2-03-settings.txt" | sed 's/^/settings lines with downloads words: /'
drive eval "return [...document.querySelectorAll('*')].filter(e => /get the app/i.test(e.textContent) && e.children.length === 0).length" | sed 's/^/leaf nodes with "Get the app" (settings): /'
echo "-- ring before connect"; drive nav /ring > "$P/j2-04-ring-before.txt"; shot j2-04-ring-before; head -c 600 "$P/j2-04-ring-before.txt" | tr '\n' ' ' | sed -E 's/[0-9]+/N/g'; echo
need_front
permwatch 120 > "$P/j2-perm.log" 2>&1 &
W=$!
echo "-- connect $(ts)"; drive connect > "$P/j2-05-connect.log" 2>&1; kill $W 2>/dev/null; cat "$P/j2-perm.log"
sed -E 's/[0-9]{2,}( readings| records)/N\1/g' "$P/j2-05-connect.log" | grep -E 'button|clicked|done|PASSWORD|ERR|console' | head
grep -oE '[0-9]+ records, [0-9]+ readings[^|]*' "$P/j2-05-connect.log" | tail -1
need_front; shot j2-06-devices-after
echo "-- link state right after import $(ts)"; svc; gatt
echo "-- ring after connect"; drive nav /ring > "$P/j2-07-ring-after.txt"; shot j2-07-ring-after
echo "-- signals"; drive nav /signals > "$P/j2-08-signals.txt"; shot j2-08-signals
drive buttons > "$P/j2-08-signals-buttons.txt"
applog 40 > "$P/j2-09-logcat-phase1.txt"; wc -l < "$P/j2-09-logcat-phase1.txt" | sed 's/^/logcat lines kept: /'
sleep 20; echo "-- 20 s later $(ts)"; svc; gatt
echo "== phase1 end $(ts)"
