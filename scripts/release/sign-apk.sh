#!/usr/bin/env bash
# Sign the release APK for a GitHub Release.
#
#   bash scripts/release/sign-apk.sh <unsignedApk> <outDir>
#
# With all four of ANDROID_KEYSTORE_B64 (base64 of the keystore), ANDROID_KEYSTORE_PASSWORD,
# ANDROID_KEY_ALIAS and ANDROID_KEY_PASSWORD set: zipalign (uncompressed .so files aligned to 16 KB pages),
# sign with apksigner into <outDir>/Vitals-android.apk, then verify. Without them: warn and write the
# zipaligned but unsigned <outDir>/Vitals-android-unsigned.apk.
#
# The secrets never reach the command line or the log: apksigner reads the passwords from the environment
# (env:NAME), and the decoded keystore lives in a private temp file removed on exit. Do not add `set -x`.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <unsignedApk> <outDir>" >&2
  exit 2
fi
in_apk=$1
out_dir=$2

if [ ! -f "$in_apk" ]; then
  echo "::error::Unsigned APK not found: $in_apk"
  exit 1
fi

sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
if [ -z "$sdk" ] || [ ! -d "$sdk/build-tools" ]; then
  echo "::error::Android SDK build-tools not found (set ANDROID_HOME or ANDROID_SDK_ROOT)"
  exit 1
fi
bt_version=$(find "$sdk/build-tools" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -V | tail -n 1)
if [ -z "$bt_version" ]; then
  echo "::error::No build-tools version installed under $sdk/build-tools"
  exit 1
fi
bt=$sdk/build-tools/$bt_version
zipalign=$bt/zipalign
apksigner=$bt/apksigner
echo "Using Android build-tools $bt_version"

# -P 16 page-aligns uncompressed native libraries for 16 KB page devices (build-tools 35 and later);
# older zipalign only knows -p (4 KB pages).
# zipalign without arguments prints its usage and exits 2, so its status is not part of the test.
usage=$("$zipalign" 2>&1 || true)
if grep -q -- '-P <pagesize_kb>' <<< "$usage"; then
  page_align=(-P 16)
else
  page_align=(-p)
fi

mkdir -p "$out_dir"
umask 077
work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/sign-apk.XXXXXX")
trap 'rm -rf "$work"' EXIT

aligned=$work/aligned.apk
"$zipalign" "${page_align[@]}" -f 4 "$in_apk" "$aligned"

if [ -n "${ANDROID_KEYSTORE_B64:-}" ] && [ -n "${ANDROID_KEYSTORE_PASSWORD:-}" ] \
  && [ -n "${ANDROID_KEY_ALIAS:-}" ] && [ -n "${ANDROID_KEY_PASSWORD:-}" ]; then
  keystore=$work/release.keystore
  if ! printf '%s' "$ANDROID_KEYSTORE_B64" | base64 -d > "$keystore" 2> /dev/null || [ ! -s "$keystore" ]; then
    echo "::error::ANDROID_KEYSTORE_B64 is not valid base64"
    exit 1
  fi

  out_apk=$out_dir/Vitals-android.apk
  rm -f "$out_apk" "$out_apk.idsig"
  if ! "$apksigner" sign \
    --ks "$keystore" \
    --ks-key-alias "$ANDROID_KEY_ALIAS" \
    --ks-pass env:ANDROID_KEYSTORE_PASSWORD \
    --key-pass env:ANDROID_KEY_PASSWORD \
    --out "$out_apk" \
    "$aligned"; then
    echo "::error::apksigner could not sign the APK (check the keystore, alias and passwords)"
    exit 1
  fi
  # apksigner writes a v4 signature next to the APK; the release ships only the APK.
  rm -f "$out_apk.idsig"

  # Prints only the certificate digest lines.
  if ! certs=$("$apksigner" verify --print-certs "$out_apk"); then
    echo "::error::apksigner could not verify the signed APK"
    exit 1
  fi
  grep -i 'certificate SHA-256 digest' <<< "$certs" || true
  if ! "$zipalign" -c "${page_align[@]}" -v 4 "$out_apk" > /dev/null; then
    echo "::error::Signed APK is not zipaligned"
    exit 1
  fi
  chmod 644 "$out_apk"
  echo "Signed: $out_apk"
else
  echo "::warning::Android signing secrets (ANDROID_KEYSTORE_B64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD) are not all set; the APK is UNSIGNED and cannot be installed until it is signed."
  out_apk=$out_dir/Vitals-android-unsigned.apk
  cp "$aligned" "$out_apk"
  chmod 644 "$out_apk"
  echo "Unsigned: $out_apk"
fi
