#!/bin/bash
# Copies the Let's Encrypt certificate that Caddy already holds for a public name into the Vitals Server's TLS folder,
# and restarts the server only when the certificate actually changed (the server reads it at start). Run by
# vitals-cert-sync.timer as root, because Caddy's storage is private to Caddy.
#
# Why a public name and not the tailnet's own *.ts.net name: some phones cannot resolve MagicDNS names (turning the
# Tailscale DNS setting on can break all DNS there), while a name in public DNS that points at the tailnet address works
# through the tunnel. Renewal stays with Caddy; this only copies.
set -euo pipefail
NAME="${VITALS_TLS_NAME:?set VITALS_TLS_NAME to the public name Caddy holds the certificate for, e.g. hermes.example.com}"
RUN_AS="${VITALS_RUN_AS:-ubuntu}"
HOME_DIR="$(getent passwd "$RUN_AS" | cut -d: -f6)"
SRC="/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/${NAME}"
DST="${HOME_DIR}/.config/vitals-server/tls"
[ -r "$SRC/$NAME.crt" ] || { echo "no caddy certificate for $NAME" >&2; exit 1; }
install -d -o "$RUN_AS" -g "$RUN_AS" -m 700 "$DST"
NEW=$(sha256sum "$SRC/$NAME.crt" | cut -d' ' -f1)
OLD=$(sha256sum "$DST/mqtt.crt" 2>/dev/null | cut -d' ' -f1 || echo none)
if [ "$NEW" = "$OLD" ]; then echo "certificate unchanged"; exit 0; fi
install -o "$RUN_AS" -g "$RUN_AS" -m 644 "$SRC/$NAME.crt" "$DST/mqtt.crt"
install -o "$RUN_AS" -g "$RUN_AS" -m 600 "$SRC/$NAME.key" "$DST/mqtt.key"
echo "certificate updated for $NAME"
# first run: the server may not be configured for TLS yet; only restart a server that is running
if runuser -u "$RUN_AS" -- env XDG_RUNTIME_DIR="/run/user/$(id -u "$RUN_AS")" systemctl --user is-active --quiet vitals-server; then
  runuser -u "$RUN_AS" -- env XDG_RUNTIME_DIR="/run/user/$(id -u "$RUN_AS")" systemctl --user restart vitals-server
  echo "restarted vitals-server"
fi
