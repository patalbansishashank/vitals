#!/usr/bin/env bash
# Rolls the Vitals Server on the home server back (or a local dry-run directory: DEPLOY_TARGET=local:/some/dir).
#
#   deploy/oci-arm-rollback.sh            # ~/vitals-server/current -> previous release, restart, health check
#   ROLLBACK_TO=companion deploy/oci-arm-rollback.sh
#                                         # stop vitals-server and start the old relay unit (vitals-companion) again on
#                                         # its own data (~/.local/share/vitals-companion, never touched by the deploy)
#
# Data written by the server since the deploy (persons, devices, new relay messages in
# ~/.local/share/vitals-server/relay) is kept on disk either way; nothing is deleted. Synced devices hold their own
# copies and push them again to whichever relay answers.
set -euo pipefail

QA_CONFIG="$(dirname "$0")/../qa/local.config.json"  # git-ignored; shape in qa/local.config.example.json
TARGET="${DEPLOY_TARGET:-ssh:$(jq -r .serverSsh "$QA_CONFIG" 2>/dev/null || echo vitals-server)}"
PORT="${PORT:-4870}"
TO="${ROLLBACK_TO:-previous}"

case "$TARGET" in
  ssh:*) HOST="${TARGET#ssh:}"; run_remote() { ssh "$HOST" "TO='$TO' PORT='$PORT' DRY=0 bash -s"; } ;;
  local:*) ROOT="$(cd "${TARGET#local:}" && pwd)"; run_remote() { env -i PATH="$PATH" HOME="$ROOT" TO="$TO" PORT="$PORT" DRY=1 bash -s; } ;;
  *) echo "DEPLOY_TARGET must be ssh:<host> or local:<dir>" >&2; exit 2 ;;
esac

run_remote <<'REMOTE'
set -euo pipefail
say() { printf '[host] %s\n' "$*"; }
APP="$HOME/vitals-server"
sctl() {
  if [ "$DRY" = "1" ]; then
    case "$1 ${2:-}" in
      "restart vitals-server")
        if [ -f "$APP/dry-run.pid" ]; then kill "$(cat "$APP/dry-run.pid")" 2>/dev/null || true; while kill -0 "$(cat "$APP/dry-run.pid")" 2>/dev/null; do sleep 0.2; done; fi
        cd "$APP/current" && { nohup node bin/vitals-server.mjs serve >"$APP/dry-run.log" 2>&1 & echo $! >"$APP/dry-run.pid"; } && cd - >/dev/null
        ;;
      "stop vitals-server")
        if [ -f "$APP/dry-run.pid" ]; then kill "$(cat "$APP/dry-run.pid")" 2>/dev/null || true; while kill -0 "$(cat "$APP/dry-run.pid")" 2>/dev/null; do sleep 0.2; done; fi
        rm -f "$APP/dry-run.pid"
        ;;
      *) say "(dry run) systemctl --user $*" ;;
    esac
  else
    systemctl --user "$@"
  fi
}

if [ "$TO" = "companion" ]; then
  sctl disable vitals-server
  sctl stop vitals-server
  sctl enable --now vitals-companion
  say "vitals-server stopped; vitals-companion (relay only) started on its old data"
  exit 0
fi

[ -L "$APP/previous" ] || { say "no previous release to go back to (use ROLLBACK_TO=companion)"; exit 1; }
prev="$(readlink "$APP/previous")"
cur="$(readlink "$APP/current")"
ln -sfn "$prev" "$APP/current"
ln -sfn "$cur" "$APP/previous"
say "current -> $(basename "$prev") (previous -> $(basename "$cur"))"
sctl restart vitals-server
for i in $(seq 1 30); do
  if body="$(curl -fsS "http://127.0.0.1:$PORT/health" 2>/dev/null)"; then say "health: $body"; exit 0; fi
  sleep 1
done
say "no answer on 127.0.0.1:$PORT after 30 s"
exit 1
REMOTE
