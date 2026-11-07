#!/usr/bin/env bash
# Rolls the Vitals Server on the home server back (or a local dry-run directory: DEPLOY_TARGET=local:/some/dir).
#
#   deploy/oci-arm-rollback.sh            # ~/vitals-server/current -> previous release, restart, health check
#   ROLLBACK_TO=companion deploy/oci-arm-rollback.sh
#                                         # stop vitals-server and start the old relay unit (vitals-companion) again on
#                                         # its own data (~/.local/share/vitals-companion, never touched by the deploy)
#
# A release older than lumen.db schema version 4 (0.6.2 and before) refuses a v4 file: before it starts, every
# persons/*/lumen.db at version 4 is set back to version 2 (event_state and the v4 views dropped; events, deletions and
# spans untouched), so that release recreates its own views on open, and the next deploy rebuilds the state.
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
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/vitals-server"
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
# (r067) A release with schema version 4 but not 5 (0.6.3 .. 0.6.6) refuses a v5 file too: a v5 file is only marked 4
# (the detection tables and the two recognition views stay; that release never reads them), so the next deploy's step 5
# finds its episodes again and only refills what the older release ingested meanwhile.
if grep -q "version: 4," "$prev/src/home/lumenMigrate.ts" 2>/dev/null && ! grep -q "version: 5," "$prev/src/home/lumenMigrate.ts" 2>/dev/null; then
  sctl stop vitals-server
  NODE_BIN="$APP/node/bin/node"; [ -x "$NODE_BIN" ] || NODE_BIN="node"
  BETTER_SQLITE="$prev/node_modules/better-sqlite3" DATA="$DATA" "$NODE_BIN" - <<'JS'
const Database = require(process.env.BETTER_SQLITE);
const { existsSync, readdirSync } = require('node:fs');
const dir = `${process.env.DATA}/persons`;
for (const p of existsSync(dir) ? readdirSync(dir) : []) {
  const file = `${dir}/${p}/lumen.db`;
  if (!existsSync(file)) continue;
  const db = new Database(file);
  if (db.pragma('user_version', { simple: true }) === 5) {
    db.pragma('user_version = 4');
    console.log(`[host] lumen.db of person ${p}: schema 5 -> 4 for the older release`);
  }
  db.close();
}
JS
fi
if ! grep -q "version: 4," "$prev/src/home/lumenMigrate.ts" 2>/dev/null; then
  sctl stop vitals-server
  NODE_BIN="$APP/node/bin/node"; [ -x "$NODE_BIN" ] || NODE_BIN="node"
  BETTER_SQLITE="$prev/node_modules/better-sqlite3" DATA="$DATA" "$NODE_BIN" - <<'JS'
const Database = require(process.env.BETTER_SQLITE);
const { existsSync, readdirSync } = require('node:fs');
const dir = `${process.env.DATA}/persons`;
for (const p of existsSync(dir) ? readdirSync(dir) : []) {
  const file = `${dir}/${p}/lumen.db`;
  if (!existsSync(file)) continue;
  const db = new Database(file);
  if (db.pragma('user_version', { simple: true }) >= 4) {
    db.transaction(() => {
      for (const v of db.prepare("SELECT name FROM sqlite_master WHERE type = 'view'").all()) db.exec(`DROP VIEW "${v.name}"`);
      db.exec('DROP TABLE IF EXISTS event_state');
      db.pragma('user_version = 2');
    }).immediate();
    console.log(`[host] lumen.db of person ${p}: schema 4+ -> 2 for the older release`);
  }
  db.close();
}
JS
fi
sctl restart vitals-server
for i in $(seq 1 30); do
  if body="$(curl -fsS "http://127.0.0.1:$PORT/health" 2>/dev/null)"; then say "health: $body"; exit 0; fi
  sleep 1
done
say "no answer on 127.0.0.1:$PORT after 30 s"
exit 1
REMOTE
