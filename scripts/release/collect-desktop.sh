#!/usr/bin/env bash
# Collects the desktop release files from electron-builder's output folder for upload.
# Usage: collect-desktop.sh <releaseDir> <outDir>
# Copies (top level of <releaseDir> only) the installers with the stable names from docs/RELEASING.md, plus the
# updater files latest*.yml and *.blockmap. Fails when none of the stable installers is there.
# Runs on Linux, Windows Git Bash and macOS bash 3.2: no mapfile, no GNU-only flags.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: collect-desktop.sh <releaseDir> <outDir>" >&2
  exit 2
fi
src="${1%/}"
out="${2%/}"

STABLE_NAMES="Vitals-linux-x86_64.AppImage Vitals-linux-amd64.deb Vitals-windows-x64-setup.exe Vitals-macos-universal.dmg"

if [ ! -d "$src" ]; then
  echo "::error::Release folder $src does not exist (did the Package step run?)"
  exit 1
fi
mkdir -p "$out"

size_of() {
  # wc -c pads with spaces on macOS; the arithmetic strips them.
  echo $(($(wc -c < "$1")))
}

copied=0
installers=0
copy_one() {
  local f="$1" bytes
  bytes="$(size_of "$f")"
  cp "$f" "$out/"
  copied=$((copied + 1))
  awk -v n="${f##*/}" -v b="$bytes" 'BEGIN { printf "  %-40s %12d bytes  %8.1f MiB\n", n, b, b / 1048576 }'
}

echo "Collecting desktop files from $src into $out"
for name in $STABLE_NAMES; do
  if [ -f "$src/$name" ]; then
    copy_one "$src/$name"
    installers=$((installers + 1))
  fi
done

if [ "$installers" -eq 0 ]; then
  echo "::error::None of the stable installer names ($STABLE_NAMES) is in $src. Top level of $src:"
  ls -la "$src" || true
  exit 1
fi

for f in "$src"/latest*.yml "$src"/*.blockmap; do
  [ -f "$f" ] || continue
  copy_one "$f"
done

# An installer under another name means an artifactName override did not apply; it would not be uploaded.
for f in "$src"/*.AppImage "$src"/*.deb "$src"/*.exe "$src"/*.dmg "$src"/*.zip "$src"/*.rpm "$src"/*.snap; do
  [ -f "$f" ] || continue
  case " $STABLE_NAMES " in
    *" ${f##*/} "*) ;;
    *) echo "::warning::Not collected (not a stable asset name): ${f##*/}" ;;
  esac
done

echo "Copied $copied file(s), $installers installer(s)."
