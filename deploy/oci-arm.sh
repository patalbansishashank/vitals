#!/usr/bin/env bash
# Deploys the Vitals Server (home role) to the home server, or to a local directory for a dry run. Idempotent: running it
# twice with the same build leaves the same state.
#
#   deploy/oci-arm.sh                                  # DEPLOY_TARGET=ssh:<serverSsh from qa/local.config.json> (the default)
#   DEPLOY_TARGET=local:/some/dir deploy/oci-arm.sh    # dry run: /some/dir stands in for the host's $HOME
#
# Steps (each prints one line):
#   1. build the package on this machine (`pnpm --filter vitals-companion build` → packages/companion/dist/server)
#   2. rsync it to ~/vitals-server/releases/<version>-<git sha>/ on the host
#   3. the pinned Node ($NODE_VERSION, default 26.10.0) in ~/vitals-server/node (downloaded from nodejs.org once, checked
#      against SHASUMS256.txt, no root), then `npm install --omit=dev` with it (better-sqlite3 is native: it builds for
#      the host's arm64 and this Node). Node 24.21 must not run the server: its process-wide Web Locks kept idle person
#      workers awake until the host ran out of memory (docs/wp/E34.md)
#   4. first run only: stop the old relay unit (vitals-companion), copy its relay data to the server's data dir
#      (~/.local/share/vitals-server/relay; the old directory is kept for rollback), `vitals-server init --role home`
#   5. point ~/vitals-server/current at the new release (the old target becomes ~/vitals-server/previous)
#   6. write the user unit vitals-server.service (ExecStart on the pinned Node) and ~/vitals-server/bin/vitals-server
#      (the CLI on the pinned Node), daemon-reload, disable vitals-companion, restart vitals-server
#      (the unit carries the memory limits MemoryHigh/MemoryMax/MemorySwapMax/OOMPolicy; docs/SERVER.md "Limits")
#   7. health check on http://127.0.0.1:$PORT/health (role home, this version)
#   8. `tailscale serve` is NOT changed: it already forwards :8443 to 127.0.0.1:4870, the port the server keeps
#
# Never prints a secret: the server has none in server.json; persons, pairing codes and keys are added afterwards with
# the owner (docs/SERVER.md "Moving the owner to person 1").
#
# Environment: DEPLOY_TARGET (ssh:<host> | local:<dir>), PUBLIC_ORIGIN (default: serverUrl in qa/local.config.json, else https://vitals.example.ts.net:8443),
# PORT (default 4870; the dry run should use a free port), SKIP_BUILD=1 to reuse the last build, NODE_VERSION (default
# 26.10.0).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QA_CONFIG="$(dirname "$0")/../qa/local.config.json"  # git-ignored; shape in qa/local.config.example.json
TARGET="${DEPLOY_TARGET:-ssh:$(jq -r .serverSsh "$QA_CONFIG" 2>/dev/null || echo vitals-server)}"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-$(jq -r .serverUrl "$QA_CONFIG" 2>/dev/null || echo https://vitals.example.ts.net:8443)}"
PORT="${PORT:-4870}"
PKG="$REPO/packages/companion"
VERSION="$(node -p "require('$PKG/package.json').version")"
SHA="$(git -C "$REPO" rev-parse --short HEAD)"
RELEASE="$VERSION-$SHA"
NODE_VERSION="${NODE_VERSION:-26.10.0}"

say() { printf '[deploy] %s\n' "$*"; }

if [ "${SKIP_BUILD:-}" != "1" ]; then
  say "1. building vitals-companion $VERSION ($SHA)"
  (cd "$REPO" && pnpm --filter vitals-companion build >"${TMPDIR:-/tmp}/vitals-server-build.log" 2>&1) || { echo "build failed: see ${TMPDIR:-/tmp}/vitals-server-build.log" >&2; exit 1; }
else
  say "1. reusing the last build"
fi
[ -f "$PKG/dist/server/dist/person-worker.mjs" ] || { echo "no build in $PKG/dist/server" >&2; exit 1; }

case "$TARGET" in
  ssh:*)
    HOST="${TARGET#ssh:}"
    say "2. rsync to $HOST:vitals-server/releases/$RELEASE"
    ssh "$HOST" "mkdir -p ~/vitals-server/releases && chmod 700 ~/vitals-server"
    rsync -a --delete --exclude node_modules "$PKG/dist/server/" "$HOST:vitals-server/releases/$RELEASE/"
    run_remote() { ssh "$HOST" "RELEASE='$RELEASE' PUBLIC_ORIGIN='$PUBLIC_ORIGIN' PORT='$PORT' VERSION='$VERSION' NODE_VERSION='$NODE_VERSION' DRY=0 bash -s"; }
    ;;
  local:*)
    ROOT="${TARGET#local:}"
    mkdir -p "$ROOT"
    ROOT="$(cd "$ROOT" && pwd)"
    say "2. rsync to $ROOT/vitals-server/releases/$RELEASE (dry run: $ROOT is the host's home)"
    mkdir -p "$ROOT/vitals-server/releases" && chmod 700 "$ROOT/vitals-server"
    rsync -a --delete --exclude node_modules "$PKG/dist/server/" "$ROOT/vitals-server/releases/$RELEASE/"
    # a fresh environment with HOME pointing at the stand-in; systemctl and tailscale are not touched (DRY=1)
    run_remote() { env -i PATH="$PATH" HOME="$ROOT" TMPDIR="${TMPDIR:-/tmp}" RELEASE="$RELEASE" PUBLIC_ORIGIN="$PUBLIC_ORIGIN" PORT="$PORT" VERSION="$VERSION" NODE_VERSION="$NODE_VERSION" DRY=1 bash -s; }
    ;;
  *)
    echo "DEPLOY_TARGET must be ssh:<host> or local:<dir>" >&2
    exit 2
    ;;
esac

run_remote <<'REMOTE'
set -euo pipefail
umask 077
say() { printf '[host] %s\n' "$*"; }
APP="$HOME/vitals-server"
REL="$APP/releases/$RELEASE"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/vitals-server"
CONF="${XDG_CONFIG_HOME:-$HOME/.config}/vitals-server"
OLD_DATA="$HOME/.local/share/vitals-companion"
UNIT_DIR="$HOME/.config/systemd/user"
NODE="$APP/node/bin/node"
CLI=("$NODE" "$APP/current/bin/vitals-server.mjs")

# the dry run stands in for systemctl with a background process and a pid file
sctl() {
  if [ "$DRY" = "1" ]; then
    case "$1 ${2:-}" in
      "restart vitals-server")
        if [ -f "$APP/dry-run.pid" ]; then kill "$(cat "$APP/dry-run.pid")" 2>/dev/null || true; while kill -0 "$(cat "$APP/dry-run.pid")" 2>/dev/null; do sleep 0.2; done; fi
        cd "$APP/current" && { nohup "$NODE" bin/vitals-server.mjs serve >"$APP/dry-run.log" 2>&1 & echo $! >"$APP/dry-run.pid"; } && cd - >/dev/null
        ;;
      *) say "   (dry run) systemctl --user $*" ;;
    esac
  else
    systemctl --user "$@"
  fi
}

case "$(uname -m)" in
  aarch64 | arm64) NODE_ARCH=arm64 ;;
  x86_64) NODE_ARCH=x64 ;;
  *) say "no Node build for $(uname -m)"; exit 1 ;;
esac
if [ "$("$NODE" -v 2>/dev/null)" != "v$NODE_VERSION" ]; then
  say "3. installing Node $NODE_VERSION ($NODE_ARCH) in ~/vitals-server/node-v$NODE_VERSION"
  TARBALL="node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
  DL="$(mktemp -d)"
  curl -fsSL -o "$DL/$TARBALL" "https://nodejs.org/dist/v$NODE_VERSION/$TARBALL"
  curl -fsSL -o "$DL/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
  (cd "$DL" && grep " $TARBALL\$" SHASUMS256.txt | sha256sum -c --quiet) || { say "checksum mismatch for $TARBALL"; rm -rf "$DL"; exit 1; }
  rm -rf "$APP/node-v$NODE_VERSION" && mkdir -p "$APP/node-v$NODE_VERSION"
  tar -xJf "$DL/$TARBALL" -C "$APP/node-v$NODE_VERSION" --strip-components=1
  rm -rf "$DL"
  ln -sfn "node-v$NODE_VERSION" "$APP/node"
fi
say "3. Node $("$NODE" -v) at ~/vitals-server/node; npm install --omit=dev in releases/$RELEASE"
# npm and node-gyp follow the pinned Node, so better-sqlite3 is built for its ABI
(cd "$REL" && PATH="$APP/node/bin:$PATH" npm install --omit=dev --no-audit --no-fund --legacy-peer-deps --loglevel=error --update-notifier=false >/dev/null)

if [ -L "$APP/current" ] && [ "$(readlink "$APP/current")" != "$REL" ]; then
  ln -sfn "$(readlink "$APP/current")" "$APP/previous"
fi
ln -sfn "$REL" "$APP/current"
say "5. current -> releases/$RELEASE (previous -> $(basename "$(readlink "$APP/previous" 2>/dev/null || echo none)"))"

if [ ! -f "$CONF/server.json" ]; then
  say "4. first run: moving the relay data and writing server.json"
  if [ "$DRY" != "1" ] && systemctl --user is-active --quiet vitals-companion; then sctl stop vitals-companion; fi
  mkdir -p "$DATA" && chmod 700 "$DATA"
  if [ -d "$OLD_DATA" ] && [ ! -e "$DATA/relay" ]; then
    cp -a "$OLD_DATA" "$DATA/relay"
    chmod -R go-rwx "$DATA/relay"
    say "   copied $OLD_DATA to $DATA/relay (the old directory stays for rollback)"
  fi
  "${CLI[@]}" init --role home --public-origin "$PUBLIC_ORIGIN" --port "$PORT"
else
  say "4. server.json exists: kept (persons, devices and relay data untouched)"
fi

say "6. user unit vitals-server.service"
mkdir -p "$UNIT_DIR"
cat >"$UNIT_DIR/vitals-server.service.new" <<UNIT
[Unit]
Description=Vitals Server (home role; loopback, exposed via tailscale serve)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/vitals-server/current
# the pinned Node (step 3), never the system one: Node 24.21 kept idle person workers awake (docs/wp/E34.md)
ExecStart=%h/vitals-server/node/bin/node %h/vitals-server/current/bin/vitals-server.mjs serve
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PATH=%h/vitals-server/node/bin:/usr/local/bin:/usr/bin:/bin
UMask=0077
NoNewPrivileges=yes
# memory (docs/SERVER.md "Limits"): throttle at 1.5 GB, kill the server alone at 2 GB, almost no swap, so a runaway
# server never freezes the host again (incident 2026-10-03); each person worker also has a 512 MB heap limit in code
MemoryHigh=1900M
MemoryMax=2048M
MemorySwapMax=256M
OOMPolicy=kill

[Install]
WantedBy=default.target
UNIT
# the CLI on the pinned Node (bin/vitals-server.mjs also switches to it when started by another node)
mkdir -p "$APP/bin"
printf '#!/bin/sh\nexec "$HOME/vitals-server/node/bin/node" "$HOME/vitals-server/current/bin/vitals-server.mjs" "$@"\n' >"$APP/bin/vitals-server"
chmod 700 "$APP/bin/vitals-server"
if cmp -s "$UNIT_DIR/vitals-server.service.new" "$UNIT_DIR/vitals-server.service"; then
  rm "$UNIT_DIR/vitals-server.service.new"
else
  mv "$UNIT_DIR/vitals-server.service.new" "$UNIT_DIR/vitals-server.service"
  sctl daemon-reload
fi
if [ "$DRY" = "1" ] || systemctl --user is-enabled --quiet vitals-companion 2>/dev/null; then sctl disable --now vitals-companion; fi
sctl enable vitals-server
sctl restart vitals-server

say "7. health check"
for i in $(seq 1 30); do
  if body="$(curl -fsS "http://127.0.0.1:$PORT/health" 2>/dev/null)"; then
    case "$body" in
      *'"role":"home"'*"\"version\":\"$VERSION\""* | *"\"version\":\"$VERSION\""*'"role":"home"'*) say "   ok: $body"; break ;;
      *) say "   unexpected: $body"; exit 1 ;;
    esac
  fi
  [ "$i" = 30 ] && { say "   no answer on 127.0.0.1:$PORT after 30 s"; exit 1; }
  sleep 1
done
"${CLI[@]}" status || true

if [ "$DRY" = "1" ]; then
  say "8. (dry run) tailscale serve not touched"
else
  say "8. tailscale serve (unchanged):"
  tailscale serve status 2>/dev/null | sed 's/^/   /' || say "   tailscale serve status not available"
fi
REMOTE
say "done: vitals-server $RELEASE on $TARGET"
