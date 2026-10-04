#!/usr/bin/env bash
# Smoke launch of the packaged desktop app for the current OS.
# Usage: smoke-desktop.sh <releaseDir>
# Starts the unpacked app from electron-builder's output with VITALS_SMOKE=1; the app must load its window and quit
# with exit code 0 on its own within SMOKE_TIMEOUT seconds (default 60).
#   Linux:   <releaseDir>/linux-unpacked/<exe>               (under xvfb-run when there is no display)
#   Windows: <releaseDir>/win-unpacked/<exe>.exe             (Git Bash)
#   macOS:   <releaseDir>/mac-universal|mac-arm64|mac/<name>.app/Contents/MacOS/<name>
# Advisory unless SMOKE_REQUIRED=1: a failure or timeout then prints a warning and exits 0.
# Runs on Linux, Windows Git Bash and macOS bash 3.2: no `timeout`, no mapfile, no GNU-only flags.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: smoke-desktop.sh <releaseDir>" >&2
  exit 2
fi
release_dir="${1%/}"
limit="${SMOKE_TIMEOUT:-60}"
required="${SMOKE_REQUIRED:-0}"

log=""
cleanup() {
  if [ -n "$log" ]; then rm -f "$log"; fi
}
trap cleanup EXIT

show_log() {
  if [ -n "$log" ] && [ -s "$log" ]; then
    echo "----- last 50 lines of the app's output -----"
    tail -n 50 "$log"
    echo "----- end of output -----"
  fi
}

fail() {
  show_log
  if [ "$required" = "1" ]; then
    echo "::error::Smoke launch: $1"
    exit 1
  fi
  echo "::warning::Smoke launch (advisory, SMOKE_REQUIRED is not 1): $1"
  exit 0
}

exe=""
pick() {
  # pick <description> <candidate>... : exactly one candidate expected.
  local what="$1"
  shift
  if [ "$#" -eq 0 ]; then
    fail "no executable found in $what"
  fi
  if [ "$#" -gt 1 ]; then
    fail "more than one executable in $what: $*"
  fi
  exe="$1"
}

extra_args=""
wrapper=""
os="$(uname -s)"
case "$os" in
  Linux)
    dir="$release_dir/linux-unpacked"
    [ -d "$dir" ] || fail "$dir does not exist"
    set --
    for f in "$dir"/*; do
      [ -f "$f" ] && [ -x "$f" ] || continue
      case "${f##*/}" in
        chrome-sandbox | chrome_crashpad_handler | *.so | *.so.*) continue ;;
      esac
      set -- ${1+"$@"} "$f"
    done
    pick "$dir" ${1+"$@"}
    # chrome-sandbox is only usable when it is setuid root, which an unpacked CI build never is.
    if [ -n "${CI:-}" ] || [ ! -u "$dir/chrome-sandbox" ]; then
      extra_args="--no-sandbox"
    fi
    if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
      if command -v xvfb-run > /dev/null 2>&1; then
        wrapper="xvfb-run -a"
      else
        echo "::warning::No DISPLAY and no xvfb-run; trying without a display."
      fi
    fi
    ;;
  MINGW* | MSYS* | CYGWIN*)
    dir="$release_dir/win-unpacked"
    [ -d "$dir" ] || fail "$dir does not exist"
    set --
    for f in "$dir"/*.exe; do
      [ -f "$f" ] || continue
      case "${f##*/}" in
        Uninstall* | elevate.exe) continue ;;
      esac
      set -- ${1+"$@"} "$f"
    done
    pick "$dir" ${1+"$@"}
    ;;
  Darwin)
    app=""
    for d in mac-universal mac-arm64 mac; do
      for a in "$release_dir/$d"/*.app; do
        if [ -d "$a" ]; then
          app="$a"
          break 2
        fi
      done
    done
    [ -n "$app" ] || fail "no .app in $release_dir/mac-universal, mac-arm64 or mac"
    name="${app##*/}"
    name="${name%.app}"
    if [ -f "$app/Contents/MacOS/$name" ]; then
      exe="$app/Contents/MacOS/$name"
    else
      set --
      for f in "$app/Contents/MacOS"/*; do
        if [ -f "$f" ] && [ -x "$f" ]; then set -- ${1+"$@"} "$f"; fi
      done
      pick "$app/Contents/MacOS" ${1+"$@"}
    fi
    ;;
  *)
    fail "unsupported OS $os"
    ;;
esac

log="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/smoke-desktop.XXXXXX")"
unset ELECTRON_RUN_AS_NODE
export VITALS_SMOKE=1

echo "Smoke launch: ${wrapper:+$wrapper }$exe${extra_args:+ $extra_args} (VITALS_SMOKE=1, up to ${limit}s)"
# Job control puts the app in its own process group, so a timeout can stop it with its helpers (and xvfb-run).
set -m
# shellcheck disable=SC2086 # wrapper and extra_args are word lists, empty or not
$wrapper "$exe" $extra_args > "$log" 2>&1 &
pid=$!
set +m

elapsed=0
while kill -0 "$pid" 2> /dev/null && [ "$elapsed" -lt "$limit" ]; do
  sleep 1
  elapsed=$((elapsed + 1))
done

if kill -0 "$pid" 2> /dev/null; then
  if [ -r "/proc/$pid/winpid" ] && command -v taskkill > /dev/null 2>&1; then
    taskkill //F //T //PID "$(cat "/proc/$pid/winpid")" > /dev/null 2>&1 || true
  fi
  kill -TERM -- "-$pid" 2> /dev/null || kill -TERM "$pid" 2> /dev/null || true
  sleep 2
  kill -KILL -- "-$pid" 2> /dev/null || kill -KILL "$pid" 2> /dev/null || true
  wait "$pid" 2> /dev/null || true
  fail "the app did not quit within ${limit}s (is VITALS_SMOKE=1 handled?)"
fi

rc=0
wait "$pid" || rc=$?
if [ "$rc" -ne 0 ]; then
  fail "the app exited with code $rc after ${elapsed}s"
fi
echo "Smoke launch passed: the app quit with code 0 after ${elapsed}s."
