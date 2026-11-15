#!/usr/bin/env bash
# Publishes a Vitals release to the home server's update feed, so phones get it over the air without USB
# (docs/RELEASING.md "Publishing to the phones", docs/SERVER.md "Updates").
#
#   scripts/release/ota-publish.sh [--apk <signed apk>] [--web <bundle zip>] [--notes <text>] [--dry-run]
#   pnpm release:ota --apk Vitals-android.apk --web apps/android/release/web/vitals-web-<version>.zip
#   pnpm release:ota --list        # only print what the feed offers
#
# Steps (each prints one line):
#   1. checks the inputs: the APK carries a v2+ signature block (and its manifest's versionCode is read), the web bundle
#      has bundle.json and its .sig beside it
#   2. reads what the feed offers now (`vitals-server release list vitals`)
#   3. refuses a web bundle whose minNativeVersionCode is above both the newest APK in the feed and the APK given with
#      --apk in the same run: no phone could take it (the server offers a bundle only to an APK at or above its floor)
#   4. copies the files to a private staging folder on the host and publishes the APK first, then checks the floor again
#      against the feed as it now stands (the only check when the APK's manifest could not be read), then publishes the
#      web bundle
#   5. removes the staged copies and prints what the feed now offers
# `--dry-run` stops after step 3.
#
# Environment:
#   OTA_TARGET      ssh:<host> | local. Default ssh:<serverSsh from qa/local.config.json> (the same host deploy/oci-arm.sh
#                   deploys to). `local` runs $OTA_CLI on this machine with the files where they are.
#   OTA_REMOTE_CLI  the server's CLI on the host, relative to its home (default vitals-server/bin/vitals-server, which
#                   deploy/oci-arm.sh installs)
#   OTA_REMOTE_DIR  staging folder on the host, relative to its home (default vitals-server/incoming)
#   OTA_CLI         the vitals-server command for OTA_TARGET=local (default vitals-server)
#   VITALS_QA_CONFIG  path of the local QA config (default qa/local.config.json, git-ignored)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
QA_CONFIG="${VITALS_QA_CONFIG:-$REPO/qa/local.config.json}"  # shape in qa/local.config.example.json
REMOTE_CLI="${OTA_REMOTE_CLI:-vitals-server/bin/vitals-server}"
REMOTE_DIR="${OTA_REMOTE_DIR:-vitals-server/incoming}"

say() { printf '[ota] %s\n' "$*"; }
die() { printf 'ota-publish: %s\n' "$*" >&2; exit 1; }
usage() { sed -n '5,7p' "${BASH_SOURCE[0]}" | sed 's/^# *//' >&2; exit 2; }

APK="" WEB="" NOTES="" DRY=0 HAS_NOTES=0 LIST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --apk) [ $# -ge 2 ] || usage; APK="$2"; shift 2 ;;
    --web) [ $# -ge 2 ] || usage; WEB="$2"; shift 2 ;;
    --notes) [ $# -ge 2 ] || usage; NOTES="$2"; HAS_NOTES=1; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --list) LIST=1; shift ;;
    -h|--help) usage ;;
    *) printf 'ota-publish: unknown argument %s\n' "$1" >&2; usage ;;
  esac
done
[ -n "$APK" ] || [ -n "$WEB" ] || [ "$LIST" = 1 ] || usage

if [ -z "${OTA_TARGET:-}" ]; then
  host="$(jq -r '.serverSsh // empty' "$QA_CONFIG" 2>/dev/null || true)"
  OTA_TARGET="ssh:${host:-vitals-server}"
fi
case "$OTA_TARGET" in
  ssh:?*)
    HOST="${OTA_TARGET#ssh:}"
    cli() { ssh "$HOST" "$REMOTE_CLI $(printf '%q ' "$@")"; }
    ;;
  local)
    LOCAL_CLI="${OTA_CLI:-vitals-server}"
    cli() { "$LOCAL_CLI" "$@"; }
    ;;
  *) die "OTA_TARGET must be ssh:<host> or local" ;;
esac

# The newest APK versionCode in a `release list` answer (0 when the feed has none).
newest_apk() { { grep -oE '^  apk  .* \(versionCode [0-9]+\)' || true; } | grep -oE '[0-9]+\)$' | tr -d ')' | sort -n | tail -1 | grep . || echo 0; }

# The feed as `release list` prints it, then which bundle a phone on the newest APK takes (the list is newest first).
show_feed() {
  local feed newest offered
  feed="$(cli release list vitals)" || die "could not read the feed from $OTA_TARGET"
  newest="$(printf '%s\n' "$feed" | newest_apk)"
  printf '%s\n' "$feed"
  offered="$(printf '%s\n' "$feed" | awk -v n="$newest" '/^  web  / { if (match($0, /needs versionCode [0-9]+/)) { c = substr($0, RSTART + 18, RLENGTH - 18) + 0; if (c <= n) { print $2; exit } } }')"
  say "a phone on APK $newest takes web bundle ${offered:-none}"
}

if [ "$LIST" = 1 ]; then show_feed; exit 0; fi

# 1. inputs
WEB_FLOOR="" WEB_VERSION="" APK_CODE=""
if [ -n "$APK" ]; then
  [ -f "$APK" ] || die "no APK at $APK"
  # Phones refuse an unsigned APK; the v2+ signing block carries this magic (release.yml's unsigned fallback has none).
  LC_ALL=C grep -aq 'APK Sig Block 42' "$APK" || die "$APK is not signed (scripts/release/sign-apk.sh signs it)"
  # The server's own manifest reader, so the floor check below sees the versionCode the feed will record before
  # anything is published. Empty when the manifest cannot be read; step 4 then checks against the feed instead.
  APK_CODE="$(node --input-type=module -e '
    const { pathToFileURL } = await import("node:url");
    const { readApkVersion } = await import(pathToFileURL(process.argv[1]).href);
    const v = await readApkVersion(process.argv[2]).catch(() => null);
    if (v?.versionCode) console.log(v.versionCode);' "$REPO/packages/companion/src/home/releases.ts" "$APK" 2>/dev/null || true)"
fi
if [ -n "$WEB" ]; then
  [ -f "$WEB" ] || die "no web bundle at $WEB"
  [ -f "$WEB.sig" ] || die "no signature at $WEB.sig (scripts/release/web-bundle.mjs writes it beside the zip)"
  command -v unzip >/dev/null || die "unzip is needed to read the bundle's bundle.json"
  meta="$(unzip -p "$WEB" bundle.json 2>/dev/null)" || die "$WEB has no bundle.json at its top level"
  read -r WEB_FLOOR WEB_VERSION < <(printf '%s' "$meta" | node -e '
    const b = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    if (!Number.isSafeInteger(b.minNativeVersionCode) || b.minNativeVersionCode < 1 || typeof b.version !== "string") process.exit(1);
    console.log(b.minNativeVersionCode, b.version);') || die "$WEB has an unreadable bundle.json"
fi
what=()
[ -z "$APK" ] || what+=("APK $(basename "$APK")${APK_CODE:+ (versionCode $APK_CODE)}")
[ -z "$WEB" ] || what+=("web bundle $WEB_VERSION (needs versionCode $WEB_FLOOR+)")
say "1. to publish: $(IFS=,; printf '%s' "${what[*]}" | sed 's/,/, /g')"

# 2. the feed now
FEED="$(cli release list vitals)" || die "could not read the feed from $OTA_TARGET"
NEWEST="$(printf '%s\n' "$FEED" | newest_apk)"
say "2. the feed's newest APK: $( [ "$NEWEST" = 0 ] && echo none || echo "versionCode $NEWEST" )"

# 3. the floor
if [ -z "$WEB" ]; then
  say "3. no web bundle, so no floor to check"
elif [ -z "$APK" ]; then
  if [ "$WEB_FLOOR" -gt "$NEWEST" ]; then
    [ "$NEWEST" != 0 ] || die "web bundle $WEB_VERSION needs versionCode $WEB_FLOOR+, but the feed has no APK yet, so no phone would take it. Publish the APK in the same run (--apk)."
    die "web bundle $WEB_VERSION needs versionCode $WEB_FLOOR+, but the newest APK in the feed is $NEWEST, so no phone would take it. Publish the APK in the same run (--apk), or rebuild the bundle with --min-native-version-code $NEWEST when the native bridge is unchanged."
  fi
  say "3. floor check passed"
elif [ -n "$APK_CODE" ]; then
  if [ "$WEB_FLOOR" -gt "$APK_CODE" ] && [ "$WEB_FLOOR" -gt "$NEWEST" ]; then
    die "web bundle $WEB_VERSION needs versionCode $WEB_FLOOR+, but $(basename "$APK") is versionCode $APK_CODE and the feed's newest APK is $NEWEST, so no phone would take it. Nothing was published."
  fi
  say "3. floor check passed"
else
  say "3. floor not checked yet: the APK's versionCode could not be read, so it is checked after the APK is published"
fi
if [ "$DRY" = 1 ]; then say "dry run: nothing copied or published"; exit 0; fi

# 4. stage and publish. stage() sets STAGED_PATH (not echoed: the staged list must survive in this shell for cleanup).
STAGED=()
STAGED_PATH=""
if [ -n "${HOST:-}" ]; then
  ssh "$HOST" "mkdir -p $(printf '%q' "$REMOTE_DIR") && chmod 700 $(printf '%q' "$REMOTE_DIR")"
  stage() { STAGED_PATH="$REMOTE_DIR/$(basename "$1")"; scp -q "$1" "$HOST:$STAGED_PATH"; STAGED+=("$STAGED_PATH"); }
  cleanup() { [ ${#STAGED[@]} -eq 0 ] || ssh "$HOST" "rm -f $(printf '%q ' "${STAGED[@]}")" || true; }
else
  stage() { STAGED_PATH="$1"; }
  cleanup() { :; }
fi
trap cleanup EXIT

if [ -n "$APK" ]; then
  stage "$APK"
  apk_args=(release publish vitals --apk "$STAGED_PATH")
  [ "$HAS_NOTES" = 0 ] || apk_args+=(--notes "$NOTES")
  say "4. publishing the APK"
  cli "${apk_args[@]}"
fi
if [ -n "$WEB" ]; then
  if [ -n "$APK" ]; then
    NEWEST="$(cli release list vitals | newest_apk)"
    [ "$WEB_FLOOR" -le "$NEWEST" ] || die "the APK is published, but web bundle $WEB_VERSION needs versionCode $WEB_FLOOR+ and the feed's newest APK is $NEWEST: the bundle was not published."
  fi
  stage "$WEB"; web_path="$STAGED_PATH"
  stage "$WEB.sig"; sig_path="$STAGED_PATH"
  say "4. publishing the web bundle"
  cli release publish vitals --web "$web_path" --sig "$sig_path" --version "$WEB_VERSION"
fi

# 5. what phones now get
cleanup
trap - EXIT
say "5. the feed now offers:"
show_feed
