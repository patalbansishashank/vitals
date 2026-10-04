#!/usr/bin/env bash
# J3 phone part. Run ONLY as:
#   /media/DEV/Hobby/vitals-wt/.jobs/hw-run.sh ring /media/DEV/Hobby/vitals-wt/.jobs/hw-run.sh phone bash qa/scripts/L-QA/j3/phone.sh
# from the L-QA worktree. Frees the ring (force-stops the other ring app), installs the candidate APK over the installed
# Vitals (adb install -r: same signing, data kept), leaves the old sync group and server in Settings, pairs the app to
# the J3 test person through the pairing link (App Link), runs the phone replica tests, then test 4 (the phone reads
# the ring, the desktop shows the night). No pairing text, address or code is printed; the link lives in a 0600 file
# under .e6-tmp only for the am call and is removed at once.
set -u
cd "$(dirname "$0")/../../../.."
export TMPDIR="$PWD/.e6-tmp"
A=$HOME/.local/share/codex-android/sdk/platform-tools/adb
APK="$PWD/.e6-tmp/cand/apps/android/android/app/build/outputs/apk/debug/app-debug.apk"
PKG=desi.creative.vitals
front() { $A shell dumpsys window | grep mCurrentFocus | grep -q "$PKG"; }
date +%T
$A shell am force-stop com.pulseloop.debug
$A shell am force-stop $PKG
if [ "${J3_SKIP_INSTALL:-0}" != 1 ]; then $A install -r "$APK" 2>&1 | tail -1; date +%T > .e6-tmp/j3/apk-installed-at; fi
$A shell am start -n $PKG/.MainActivity >/dev/null; sleep 8
front || { echo "Vitals not in front"; exit 3; }
timeout 120 node qa/scripts/L-QA/j3/phone.mjs prep 2>&1 | grep -v "Warning\|trace-warn"
# the pairing link for the J3 person (label checked in server.mjs), opened as an App Link
umask 077
node -e '
import("./qa/scripts/L-QA/j3/server.mjs").then(async (s) => {
  const st = s.state();
  const qr = await s.pairQr(st.personId, "J3 phone");
  if (!qr) process.exit(2);
  const site = JSON.parse(require("fs").readFileSync("qa/local.config.json", "utf8")).siteUrl.replace(/\/$/, "");
  require("fs").writeFileSync(".e6-tmp/j3/link", `${site}/settings?section=server#${qr}`, { mode: 0o600 });
  process.exit(0);
});' || { echo "no pairing link"; exit 2; }
$A shell am start -n $PKG/.MainActivity -a android.intent.action.VIEW -d "'$(cat .e6-tmp/j3/link)'" >/dev/null
rm -f .e6-tmp/j3/link
sleep 6
front || { echo "Vitals not in front"; exit 3; }
timeout 420 node qa/scripts/L-QA/j3/phone.mjs main 2>&1 | grep -v "Warning\|trace-warn"
front || { echo "Vitals not in front"; exit 3; }
timeout 300 node qa/scripts/L-QA/j3/phone.mjs ring 2>&1 | grep -v "Warning\|trace-warn"
date +%T
