#!/usr/bin/env bash
# J1 locked step. Call inside the hardware locks, ring → phone → pc-ble, e.g.
#   .jobs/hw-run.sh ring .jobs/hw-run.sh phone .jobs/hw-run.sh pc-ble bash qa/scripts/L-QA/j1/run.sh ui
# Steps: lumen (copy the phone ring app's databases read-only), ui (journey.mjs), proof (proof.mjs), desktop-proof.
# Frees the ring first: force-stops the phone's ring apps (never relaunches them, never changes a phone setting).
set -u
cd "$(dirname "$0")/../../../.." || exit 1
export TMPDIR="$PWD/.e6-tmp"
ADB=$HOME/.local/share/codex-android/sdk/platform-tools/adb
PRIV=qa/results/L-QA/private/j1
mkdir -p "$PRIV"
echo "$(date '+%F %T') j1 run.sh $*"
$ADB shell am force-stop com.pulseloop.debug
$ADB shell am force-stop desi.creative.vitals
echo "$(date '+%F %T') phone ring apps stopped; focus: $($ADB shell dumpsys window | grep -m1 mCurrentFocus | sed 's/.*{[^ ]* [^ ]* //; s/}//')"
sleep 4
rc=0
for step in "$@"; do
case "$step" in
  lumen)
    D="$PRIV/lumen-db-$(date +%H%M)"
    mkdir -p "$D"
    for f in $($ADB shell run-as com.pulseloop.debug ls databases | tr -d '\r'); do
      $ADB exec-out run-as com.pulseloop.debug cat "databases/$f" > "$D/$f"
    done
    ls -la "$D"
    ;;
  ui) J1_EMULATE_PICK=1 J1_WATCH_MS=30000 J1_SYNC_MS=180000 timeout 540 node qa/scripts/L-QA/j1/journey.mjs || rc=$? ;;
  proof) J1_PROOF=j1 timeout 540 node qa/scripts/L-QA/j1/proof.mjs || rc=$? ;;
  desktop-proof) J1_PROOF=desktop timeout 540 node qa/scripts/L-QA/j1/proof.mjs || rc=$? ;;
  *) echo "unknown step $step"; rc=2 ;;
esac
pkill -f "$TMPDIR/j1/linux-unpacked/vitals" 2>/dev/null
echo "$(date '+%F %T') j1 step $step done rc=$rc"
done
exit $rc
