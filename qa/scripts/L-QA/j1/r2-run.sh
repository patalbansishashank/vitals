#!/usr/bin/env bash
# J1 round 2 locked run. Call inside the hardware locks, ring → phone → pc-ble:
#   .jobs/hw-run.sh ring .jobs/hw-run.sh phone .jobs/hw-run.sh pc-ble bash qa/scripts/L-QA/j1/r2-run.sh
# Frees the ring (force-stops the phone's ring apps; never relaunches them, never changes a phone setting), copies the
# phone ring app's databases read-only for the comparison, runs r2.mjs (packaged app, one tap, relaunch), and makes
# sure no desktop app process is left holding the ring. Output only under qa/results/L-QA/round2/private/j1.
set -u
cd "$(dirname "$0")/../../../.." || exit 1
export TMPDIR="$PWD/.e6-tmp"
ADB=$HOME/.local/share/codex-android/sdk/platform-tools/adb
PRIV=qa/results/L-QA/round2/private/j1
mkdir -p "$PRIV"
echo "$(date '+%F %T') j1 r2-run.sh start"
$ADB shell am force-stop com.pulseloop.debug
$ADB shell am force-stop desi.creative.vitals
echo "$(date '+%F %T') phone ring apps stopped; pids now: '$($ADB shell pidof com.pulseloop.debug | tr -d '\r')' '$($ADB shell pidof desi.creative.vitals | tr -d '\r')'"
D="$PRIV/lumen-db-$(date +%H%M)"
mkdir -p "$D"
for f in $($ADB shell run-as com.pulseloop.debug ls databases | tr -d '\r'); do
  $ADB exec-out run-as com.pulseloop.debug cat "databases/$f" > "$D/$f"
done
echo "$(date '+%F %T') lumen databases copied: $(ls "$D" | wc -l) files"
echo "$(date '+%F %T') BlueZ: powered=$(bluetoothctl show | grep -c 'Powered: yes') connected devices=$(bluetoothctl devices Connected | wc -l)"
sleep 3
rc=0
timeout 720 node qa/scripts/L-QA/j1/r2.mjs || rc=$?
pkill -f "$TMPDIR/r2j1/linux-unpacked/vitals" 2>/dev/null
sleep 1
echo "$(date '+%F %T') j1 r2 done rc=$rc; desktop app processes left: $(pgrep -fc "$TMPDIR/r2j1/linux-unpacked/vitals")"
echo "$(date '+%F %T') BlueZ after: connected devices=$(bluetoothctl devices Connected | wc -l)"
exit $rc
