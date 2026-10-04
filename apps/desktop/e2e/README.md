# Desktop end-to-end checks

`pnpm --dir apps/desktop run e2e` drives the packaged app `release/linux-unpacked/vitals` (build it first:
`pnpm run build && pnpm exec electron-builder --config electron-builder.yml --linux deb --publish never`; a `--dir`-only
build has no `resources/package-type`, so the update check is a no-op there) on the Wayland session (`WAYLAND_DISPLAY`,
`XDG_RUNTIME_DIR`) with the window hidden. Each run uses a temp HOME under `<repo>/.e6-tmp/e2e-*`, fake `claude`/`codex`/
`opencode` on PATH and a local update feed; it never touches real configs. One PASS/FAIL line per check, exit 1 on any
failure. `VITALS_E2E_VERBOSE=1` prints the page console and tool schemas; `VITALS_E2E_KEEP=1` keeps the temp HOME.
Server checks 8a–8e (pair with sync on, Codex key, remote MCP, the Coach while paired, Remove) run only with
`VITALS_E2E_PAIR_FILE=<file with one vitals-server:1?… QR text for a test person>`; add `VITALS_E2E_ONLY=server` to skip
1–6. Output is redacted (no address, code or key) and that run's temp HOME is always deleted.

The Coach checks (6d locally, 8e paired) set the scripted stand-in model `qa/scripts/Q4/fakeprovider.mjs` (rules in
`qa/fixtures/Q4/script.json`, started on a free loopback port) as a Custom endpoint in Settings › AI provider with a fake
key, type "I ate dal, rice and two eggs" into the Coach and check the reply, the log_meal round trip in the stand-in's
request log and the meal in the app's log; 8e also finds that meal on the server through the remote MCP. No real model.

`ring.e2e.mjs` runs the real ring through the packaged app: L-XPORT's proof page (`src/ble/proof/page.ts`) is evaluated
inside the app's own window on `app://vitals`, so the shell's Bluetooth switch, chooser bridge and permission rules are
the ones in use. Counts and times only. Run it under the hardware locks (ring, then phone, then pc-ble) with the ring free.

`ringApp.e2e.mjs` runs the real ring through the app's own screens and the ring service: first run, Settings › Devices ›
"Add a ring", one tap on the J-Style 2301 in the list (up to three taps through "Look again", as a person would after a
failed Bluetooth connect), the history read until the card says "Last read", the readings through the read-only QA hook
(`bio.sources`, `bio.series`), then Disconnect and Connect without a list. Same locks; it prints counts and times only.
