# J2 shared helpers (sourced). Private output (screens, page text, logcat) goes to qa/results/L-QA/private/j2 only.
A=$HOME/.local/share/codex-android/sdk/platform-tools/adb
J2=/media/DEV/Hobby/vitals-wt/L-QA/qa/scripts/L-QA/j2
P=/media/DEV/Hobby/vitals-wt/L-QA/qa/results/L-QA/private/j2
export TMPDIR=/media/DEV/Hobby/vitals-wt/L-QA/.e6-tmp J2_CDP_PORT=9334
mkdir -p "$P"
ts() { date +%T; }
front() { $A shell dumpsys window | grep mCurrentFocus | grep -q 'desi.creative.vitals'; }
need_front() { front || { echo "$(ts) STOP: Vitals not in front: $($A shell dumpsys window | grep mCurrentFocus)"; exit 3; }; }
fwd() { local pid; pid=$($A shell pidof desi.creative.vitals | tr -d '\r'); [ -z "$pid" ] && { echo "vitals not running"; return 2; }
  $A forward tcp:$J2_CDP_PORT localabstract:webview_devtools_remote_$pid >/dev/null; echo "pid $pid"; }
drive() { node $J2/drive.mjs "$@"; }
shot() { need_front; $A exec-out screencap -p > "$P/$1.png"; echo "shot $1.png"; }
svc() { echo "RingLinkService entries: $($A shell dumpsys activity services desi.creative.vitals | grep -c RingLinkService)";
  $A shell dumpsys activity services desi.creative.vitals | grep -E 'ServiceRecord|isForeground|foregroundId' | sed -E 's/[0-9a-f]{7,}/<id>/g' | head -6;
  echo "notifications:"; $A shell dumpsys notification --noredact | grep -A4 'pkg=desi.creative.vitals' | grep -E 'android.title|android.text|channel=|flags=' | head -8; }
gatt() { echo "gatt clients for vitals: $($A shell dumpsys bluetooth_manager | grep -ciE 'desi.creative.vitals')";
  $A shell dumpsys bluetooth_manager | grep -iE 'desi.creative.vitals|pulseloop' | sed -E 's/([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}/<addr>/g; s/<addr>\([^)]*\)/<addr>(<name>)/g' | head -8; }
lockscreen() { $A shell dumpsys window | grep -E 'mDreamingLockscreen|isKeyguardShowing|mShowingDream|KeyguardShowing' | head -3; $A shell dumpsys power | grep -m1 mWakefulness; }
permwatch() { local end=$((SECONDS + ${1:-60})); while [ $SECONDS -lt $end ]; do sleep 1
  $A shell dumpsys window | grep mCurrentFocus | grep -q 'permissioncontroller.*GrantPermissionsActivity' || continue
  $A shell uiautomator dump /sdcard/l-qa-j2-ui.xml >/dev/null 2>&1; local X; X=$($A shell cat /sdcard/l-qa-j2-ui.xml); $A shell rm -f /sdcard/l-qa-j2-ui.xml
  echo "$X" | grep -q 'Vitals' || { echo "prompt does not name Vitals; not tapping"; continue; }
  echo "permission prompt: $(echo "$X" | grep -o 'permission_message[^>]*' | grep -o 'text="[^"]*"' | head -1)"
  local B; B=$(echo "$X" | grep -oE 'resource-id="com.android.permissioncontroller:id/permission_allow[a-z_]*button"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | head -1 | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]')
  [ -z "$B" ] && { echo "no Allow button"; continue; }
  set -- $(echo "$B" | sed 's/\]\[/,/; s/[][]//g' | tr ',' ' ')
  $A shell dumpsys window | grep mCurrentFocus | grep -q 'GrantPermissionsActivity' && $A shell input tap $(( ($1+$3)/2 )) $(( ($2+$4)/2 )) && echo "tapped Allow"; done; }
applog() { $A logcat -d | grep -iE 'BluetoothLe|VitalsShell|RingLink|Capacitor|chromium' | grep -iE 'error|exception|disconnect|connected|fail|keepalive|service' | sed -E 's/([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}/<addr>/g; s/[0-9a-fA-F:, ]{16,}/<hex>/g' | tail -${1:-30}; }
