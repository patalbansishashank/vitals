#!/usr/bin/env bash
# R5 locked run. Call inside the hardware locks, ring → phone → pc-ble:
#   .jobs/hw-run.sh ring .jobs/hw-run.sh phone .jobs/hw-run.sh pc-ble bash qa/scripts/L-QA/r5/hw.sh
# Frees the ring (force-stops the phone's ring apps; never relaunches them, never changes a phone setting), runs
# hwturns.mjs (round-5 packaged app, temp HOME), and leaves no desktop app process holding the ring.
set -u
cd "$(dirname "$0")/../../../.." || exit 1
export TMPDIR="$PWD/.e6-tmp"
ADB=$HOME/.local/share/codex-android/sdk/platform-tools/adb
echo "$(date '+%F %T') r5 hw.sh start"
$ADB shell am force-stop com.pulseloop.debug
$ADB shell am force-stop desi.creative.vitals
echo "$(date '+%F %T') phone ring apps stopped; pids now: '$($ADB shell pidof com.pulseloop.debug | tr -d '\r')' '$($ADB shell pidof desi.creative.vitals | tr -d '\r')'"
echo "$(date '+%F %T') BlueZ: powered=$(bluetoothctl show | grep -c 'Powered: yes') connected devices=$(bluetoothctl devices Connected | wc -l)"
sleep 3
rc=0
timeout 540 node qa/scripts/L-QA/r5/hwturns.mjs || rc=$?
pkill -f "$TMPDIR/r5/apps/desktop/release/linux-unpacked/vitals" 2>/dev/null
sleep 1
echo "$(date '+%F %T') r5 done rc=$rc; desktop app processes left: $(pgrep -fc "$TMPDIR/r5/apps/desktop/release/linux-unpacked/vitals")"
echo "$(date '+%F %T') BlueZ after: connected devices=$(bluetoothctl devices Connected | wc -l)"
exit $rc
