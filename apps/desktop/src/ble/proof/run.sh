#!/usr/bin/env bash
# Real-ring proof of the desktop Bluetooth path (see main.cjs). Run it under the hardware locks, e.g.
#   .jobs/hw-run.sh ring .jobs/hw-run.sh phone .jobs/hw-run.sh pc-ble apps/desktop/src/ble/proof/run.sh
# Env: ELECTRON (binary; default: the desktop app's electron), RING_ID (address; default: qa/local.config.json
# .ringAddress, else the first ring listed), FREE_PHONE=1 to stop the phone's ring app first (ADB = adb binary).
set -u
cd "$(dirname "$0")"
ROOT=$(git rev-parse --show-toplevel)
ELECTRON=${ELECTRON:-$(cd "$ROOT/apps/desktop" && node -p "require('electron')" 2>/dev/null)}
[ -x "$ELECTRON" ] || { echo "no electron binary: set ELECTRON"; exit 2; }
RING_ID=${RING_ID:-$(jq -r '.ringAddress // empty' "$ROOT/qa/local.config.json" 2>/dev/null)}
export RING_ID PATH_KIND=${PATH_KIND:-a5a}
export TMPDIR=${TMPDIR:-$ROOT/.e6-tmp}; mkdir -p "$TMPDIR"
if [ "${FREE_PHONE:-0}" = 1 ]; then "${ADB:-adb}" shell am force-stop "${PHONE_RING_APP:?set PHONE_RING_APP}"; fi
echo "bonds before: $(bluetoothctl devices Paired | wc -l)"
timeout 360 "$ELECTRON" --ozone-platform="${OZONE:-wayland}" main.cjs 2>&1 | grep -E "^\[main|^RESULT"
echo "bonds after: $(bluetoothctl devices Paired | wc -l)"
if [ -n "$RING_ID" ]; then
  for i in $(seq 1 20); do [ "$(bluetoothctl info "$RING_ID" | awk '/Connected:/{print $2}')" != yes ] && { echo "ring released after ${i}s"; break; }; sleep 1; done
fi
