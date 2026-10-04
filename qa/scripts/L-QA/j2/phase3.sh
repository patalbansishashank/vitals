#!/usr/bin/env bash
# J2 phase 3 (under ring + phone locks): (a) in-app disconnect then connect again; (b) kill Vitals, relaunch, does it
# reconnect to the known ring by itself; then the Devices button once more (product path) after the relaunch.
source /media/DEV/Hobby/vitals-wt/L-QA/qa/scripts/L-QA/j2/lib.sh
echo "== phase3 start $(ts)"
$A shell input keyevent KEYCODE_WAKEUP; sleep 1; lockscreen
$A shell am force-stop com.pulseloop.debug
need_front; fwd
echo "-- (a) test-hook: the app's own disconnect, then reconnect by stored address"
drive eval "window.__j2Stop = true; const T = window.__ringTest; const l = window.__j2Link; if (!l) return { error: 'no link' }; const t = T.pickTransport(); const d = T.drivers.find((x) => x.id === 'jstyle2301'); clearInterval(window.__j2.timer); await l.disconnect(); await new Promise((r) => setTimeout(r, 3000)); const r0 = Date.now(); const l2 = await t.reconnect(l.deviceId, d); const ms = Date.now() - r0; window.__j2Link = l2; return { reconnectMs: ms }" | tee "$P/j2-15-reconnect.json"
echo "-- (a) product path: disconnect the hook link, keepAlive off, Devices › Connect again"
drive eval "await window.__j2Link?.disconnect(); await window.Capacitor.Plugins.VitalsShell.keepAlive({ on: false }); return 'off'"
sleep 3; svc
need_front; T0=$SECONDS; drive connect > "$P/j2-16-connect-again.log" 2>&1; echo "second connect+import took $((SECONDS-T0)) s"
grep -E 'button|done|PASSWORD|ERR' "$P/j2-16-connect-again.log" | head -5; grep -oE '[0-9]+ records, [0-9]+ readings[^|]*' "$P/j2-16-connect-again.log" | tail -1 | sed -E 's/^[0-9]+ records/N records/'
grep -oE 'toast .*' "$P/j2-16-connect-again.log" | tail -1 | grep -oE '(already here|Nothing new|up to date)[^|]*' | head -1
echo "-- (b) force-stop Vitals and relaunch $(ts)"
$A shell am force-stop desi.creative.vitals; sleep 2; $A logcat -c
$A shell am start -n desi.creative.vitals/.MainActivity >/dev/null; sleep 8; need_front; fwd
for s in 15 45; do sleep $([ $s = 15 ] && echo 7 || echo 30); echo "$(ts) +${s}s:"; svc; gatt; done
drive nav /ring > "$P/j2-17-ring-relaunch.txt"; shot j2-17-ring-relaunch
drive nav '/settings?section=devices' > /dev/null; drive text '#devices' > "$P/j2-18-devices-relaunch.txt"; shot j2-18-devices-relaunch
applog 30 > "$P/j2-19-logcat-relaunch.txt"
echo "== phase3 end $(ts)"
