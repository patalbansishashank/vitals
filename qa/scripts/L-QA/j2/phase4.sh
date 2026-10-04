#!/usr/bin/env bash
# J2 phase 4 (phone lock only, no ring use): counts through the read-only QA hook; the app reloads with ?qa=1.
source /media/DEV/Hobby/vitals-wt/L-QA/qa/scripts/L-QA/j2/lib.sh
echo "== phase4 start $(ts)"; $A shell input keyevent KEYCODE_WAKEUP; sleep 1
$A shell am force-stop com.pulseloop.debug
$A shell dumpsys window | grep mCurrentFocus | grep -q desi.creative.vitals || { $A shell am start -n desi.creative.vitals/.MainActivity >/dev/null; sleep 8; }
need_front; fwd
drive goto 'https://localhost/settings?section=devices&qa=1' 6000
drive eval "$(cat $J2/counts.js)" | tee "$P/j2-20-counts.json"
need_front; drive text '#devices' > "$P/j2-21-devices-qa.txt"; shot j2-21-devices
$A shell am force-stop desi.creative.vitals; $A forward --remove tcp:9334 2>/dev/null
echo "== phase4 end $(ts)"
