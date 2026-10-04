#!/usr/bin/env bash
# Check the native desktop packages before CI uploads them.
# Usage: verify-desktop.sh <electron-builder release directory>
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: verify-desktop.sh <releaseDir>" >&2
  exit 2
fi

release_dir="${1%/}"
min_bytes=$((20 * 1024 * 1024))

fail() {
  echo "::error::Desktop package verification: $*" >&2
  exit 1
}

check_size() {
  local path="$1" bytes
  [ -f "$path" ] || fail "missing ${path##*/}"
  bytes=$(wc -c < "$path")
  [ "$bytes" -ge "$min_bytes" ] || fail "${path##*/} is only $bytes bytes (minimum $min_bytes)"
  echo "${path##*/}: $bytes bytes"
}

case "$(uname -s)" in
  Linux)
    appimage="$release_dir/Vitals-linux-x86_64.AppImage"
    deb="$release_dir/Vitals-linux-amd64.deb"
    check_size "$appimage"
    check_size "$deb"
    command -v file >/dev/null || fail "file is unavailable"
    appimage_type=$(file -b "$appimage")
    deb_type=$(file -b "$deb")
    [[ "$appimage_type" == *ELF* && "$appimage_type" == *x86-64* ]] || fail "AppImage is not an x86-64 ELF file"
    [[ "$deb_type" == *Debian\ binary\ package* ]] || fail "deb is not a Debian package"
    dpkg-deb --info "$deb" >/dev/null || fail "deb metadata cannot be read"
    ;;
  MINGW* | MSYS* | CYGWIN*)
    installer="$release_dir/Vitals-windows-x64-setup.exe"
    check_size "$installer"
    command -v cygpath >/dev/null || fail "cygpath is unavailable"
    command -v powershell.exe >/dev/null || fail "Windows PowerShell is unavailable"
    export VITALS_VERIFY_FILE
    VITALS_VERIFY_FILE=$(cygpath -wa "$installer")
    powershell.exe -NoProfile -NonInteractive -Command '
      $ErrorActionPreference = "Stop"
      $path = $env:VITALS_VERIFY_FILE
      try {
        $stream = [System.IO.File]::OpenRead($path)
        try {
          $reader = [System.IO.BinaryReader]::new($stream)
          if ($reader.ReadUInt16() -ne 0x5A4D) { throw "missing MZ header" }
          $stream.Position = 0x3C
          $offset = $reader.ReadInt32()
          if ($offset -lt 64 -or $offset -gt ($stream.Length - 4)) { throw "invalid PE offset" }
          $stream.Position = $offset
          if ($reader.ReadUInt32() -ne 0x00004550) { throw "missing PE header" }
        } finally {
          $stream.Dispose()
        }
        $signature = Get-AuthenticodeSignature -LiteralPath $path
        if ($signature.Status -ne "NotSigned") { throw "installer is not unsigned" }
      } catch {
        Write-Error "Windows installer check failed: $($_.Exception.Message)"
        exit 1
      }
      Write-Output "Windows PE header and unsigned status verified"
    ' || fail "Windows installer failed verification"
    ;;
  Darwin)
    dmg="$release_dir/Vitals-macos-universal.dmg"
    app="$release_dir/mac-universal/Vitals.app"
    executable="$app/Contents/MacOS/Vitals"
    check_size "$dmg"
    [ -d "$app" ] || fail "missing universal Vitals.app"
    [ -f "$executable" ] || fail "missing universal app executable"
    hdiutil verify "$dmg" >/dev/null || fail "DMG verification failed"
    codesign --verify --deep --strict "$app" >/dev/null 2>&1 || fail "app code signature verification failed"
    signature=$(codesign -dv --verbose=4 "$app" 2>&1) || fail "cannot inspect app code signature"
    grep -q '^Signature=adhoc$' <<< "$signature" || fail "app does not have an ad-hoc signature"
    arches=$(lipo -archs "$executable") || fail "cannot inspect app architectures"
    case " $arches " in *" x86_64 "*) ;; *) fail "app is missing x86_64" ;; esac
    case " $arches " in *" arm64 "*) ;; *) fail "app is missing arm64" ;; esac
    echo "DMG, ad-hoc signature and universal app verified"
    ;;
  *)
    fail "unsupported operating system"
    ;;
esac
