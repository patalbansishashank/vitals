# Vitals for the desktop

The Electron app for Linux, Windows and macOS: the Vitals web app in its own window, with the ring over the PC's
Bluetooth and the Vitals MCP built in, so AI tools on the same computer can read and log with the person's consent
(SUITE_SPEC §15.6). Build output goes to `dist/` and `release/` (both git-ignored).

- `pnpm --filter @vitals/desktop run build`: builds the web app (skip with `VITALS_SKIP_WEB=1`), copies it to
  `dist/web`, and bundles main, preload and the MCP bridge (`dist/{main,preload,mcp}.cjs`). Only `electron` stays
  external, so the package ships no `node_modules`. The CSP of every `app://vitals` response comes from `netlify.toml`.
- Package: `pnpm exec electron-builder --config electron-builder.yml --linux AppImage deb` (also `--win nsis`, which
  works on Linux with wine; the macOS dmg needs a Mac runner). Release names are in `electron-builder.yml`.
- `VITALS_SMOKE=1 release/linux-unpacked/vitals` loads the page, waits for it to render and exits 0 (1 on a failure).
- The MCP: an AI tool runs `<app> --mcp --client <tool>`. That process is a pipe between the tool's stdio and the
  running app's local socket (`<config>/Vitals/mcp.sock`, on Windows a named pipe), and starts the app hidden if it is
  not running. The app answers with the page's tools through the command bus, or forwards to the paired server's
  `/mcp` with the agent key it minted for that tool (kept with Electron `safeStorage`, never in the tool's config).
  Settings › Agents › "Connect your AI tools" adds or removes the entry in Claude Code, Codex, OpenCode and ChatGPT.
- Tests: unit tests run with the repo's vitest (`apps/desktop/src/**/*.test.ts`); the packaged-app checks are in `e2e/`.
