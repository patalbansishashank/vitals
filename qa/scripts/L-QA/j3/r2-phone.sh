#!/usr/bin/env bash
# Round 2 J3 phone part. Run ONLY as:
#   /media/DEV/Hobby/vitals-wt/.jobs/hw-run.sh ring /media/DEV/Hobby/vitals-wt/.jobs/hw-run.sh phone bash qa/scripts/L-QA/j3/r2-phone.sh
# from the L-QA worktree, after setup.mjs (round-2 person, desktop + website paired). No install (the hardware worker
# left the round-2 APK running with the ring connected), no force-stop of any other app. Steps: bring Vitals to the
# front if needed, leave its old sync group and server in Settings (phone.mjs prep), pair it to the round-2 person by
# typing a CLI code in Settings › Server (address from the 0600 file .e6-tmp/r2j3/phone-server, never printed), run the
# phone replica tests (main), then test 4 (ring: "Sync now" on the Ring page, the night on the desktop).
set -u
cd "$(dirname "$0")/../../../.."
export TMPDIR="$PWD/.e6-tmp"
A=$HOME/.local/share/codex-android/sdk/platform-tools/adb
PKG=desi.creative.vitals
# two adb transports to the same phone (USB and wireless): use the USB one
export ANDROID_SERIAL="${ANDROID_SERIAL:-$($A devices -l | awk '/ device .*usb:/{print $1; exit}')}"
front() { $A shell dumpsys window | grep mCurrentFocus | grep -q "$PKG"; }
# guards (round 2): the hardware worker must be done with the phone (its J2 results exist) and there must be time left
[ -f qa/results/L-QA/round2/j2-ring-phone.md ] || { echo "J2 not finished: not touching the phone"; exit 4; }
pgrep -f "j2/r2-post.sh|j2/r2.sh" >/dev/null && { echo "J2 step still queued or running: not touching the phone"; exit 6; }
[ "$(date +%H%M)" -le "${J3_LATEST:-2224}" ] || { echo "too late: not touching the phone"; exit 5; }
date +%T
$A shell dumpsys package $PKG | grep -E "versionName|lastUpdateTime" | head -2
$A shell pidof $PKG >/dev/null || { $A shell am start -n $PKG/.MainActivity >/dev/null; sleep 8; }
front || { $A shell am start -n $PKG/.MainActivity >/dev/null; sleep 6; }
$A shell pidof $PKG >/dev/null || { echo "Vitals not running"; exit 3; }
front || { echo "Vitals not in front"; exit 3; }
STEPS=${J3_STEPS:-"prep main ring"}
for s in $STEPS; do
  front || { echo "Vitals not in front before $s"; exit 3; }
  case $s in prep) T=120;; main) T=360;; *) T=200;; esac
  J3_PAIR_BY_CODE=1 timeout $T node qa/scripts/L-QA/j3/phone.mjs "$s" 2>&1 | grep -v "Warning\|trace-warn"
done
date +%T
