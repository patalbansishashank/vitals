<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/readme-header-dark.svg">
    <img src="public/brand/readme-header.svg" alt="Vitals" width="640">
  </picture>
</p>

Vitals is a private, local-first health planner. You can simulate how eating, fasting, training and sleep change
the body, then follow a living plan day by day. An optional server that you host yourself keeps your devices in
sync. There is a website, a desktop app and an Android app. The apps read rings over Bluetooth; the website can do so
in browsers that support Web Bluetooth. Seven protocol families are included. J-Style 2301 is the one proven on a real
ring; the others have been checked with test data.

Live site: https://vitals.creative.desi

Everything stays on your devices and, if you choose, on your own server. There are no accounts and no analytics.

Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## What is in this repository

| Folder | What is in it |
|---|---|
| `src/` | The web app: the model (`src/engine`), the Simulator and Planner screens, the living plan, sync, the Coach, ring drivers (`src/biometrics`) |
| `packages/companion` | `vitals-server`, the optional self-hosted server (sync relay, device pairing, AI proxy, agent endpoint) |
| `deploy/` | Scripts and service files to install the server on a Linux host |
| `docs/` | Specs and guides: `SUITE_SPEC.md` (code contract), `MODEL_SPEC.md` (the model), `SERVER.md`, `ARCHITECTURE.md`, `RELEASING.md` |
| `research/` | The evidence dossiers behind the model |
| `design/` | Design notes, tokens and screen specs |
| `qa/` | Browser and device test scripts and findings |
| `scripts/` | Build helpers (icons, figure, catalogues) |
| `tests/` | Shared test setup and app-level tests |
| `public/` | Static files: icons, manifest, the 3D figure |

## Run the website locally

You need Node 22 or newer (see [`.nvmrc`](.nvmrc)) and [pnpm](https://pnpm.io) 9 or newer.

```sh
pnpm install
pnpm dev         # dev server at http://localhost:5173
pnpm test        # unit and integration tests
pnpm typecheck
pnpm lint
pnpm build       # type-check and build the static site into dist/
```

`pnpm preview` serves the production build.

## Run the server

The server is optional. It runs on one always-on computer and keeps your devices in sync. In its `home` role it also
keeps a readable copy of your data so the Coach and agents work while your phone and browser are off. Full steps are
in [docs/SERVER.md](docs/SERVER.md).

- Build it with `pnpm --filter vitals-companion build`.
- Install it on a Linux host with `deploy/oci-arm.sh` (set `DEPLOY_TARGET` to your own host). The script installs
  the server's own Node and a systemd user service, and can roll back.
- Browsers need a reachable HTTPS address, for example a Tailscale name such as
  `https://vitals.example.ts.net:8443` that forwards to the server's local port.
- Add a person with `vitals-server persons add "Name" --tz <your time zone>`.
- Pair a device with `vitals-server pair code <person> --label "Phone"`. It prints an 8-digit code (10 minutes, one use).
  In Vitals, open Settings, then Server, and scan the QR or type the address and the code.
- A paired device keeps a token; the server keeps only a hash of it.

## Desktop app

The same Vitals web app in its own window, for Linux, Windows and macOS (Electron). Your data stays on the computer
and, if you set one up, on your own server, as in the browser. What it adds to the website:

- **Ring over Bluetooth**, with a silent reconnect when the app starts (the browser asks you each time). No ring ever asks you for a password.
- **Tray icon** with the ring status, Open, Sync now and Quit. Closing the window leaves the app in the tray.
- **Start with my computer**, off by default. It starts the app hidden in the tray.
- **Updates** from GitHub Releases, checked every 6 hours. The AppImage and the Windows installer download the new
  version and restart into it. The `.deb` and the macOS app only tell you that a new version is ready and link to the
  download page.
- **The Vitals MCP built in.** Settings, then Agents, then "Connect your AI tools" finds Claude Code, Codex and OpenCode
  on the computer, and shows the file and lines it would add before you confirm. On Linux, ChatGPT desktop can use the
  Codex connection; on Windows and macOS, Settings gives the server address and key setup steps for ChatGPT. A tool can
  read your data, log food and activity (each with undo), and propose bigger changes for you to approve. It cannot end
  or replace your plan or erase your data. With a paired server it uses its own agent key; without one it runs through
  the app.

**Install.** Use **Get the app** on the Vitals website, or download from the
[latest release](https://github.com/patalbansishashank/vitals/releases/latest):

| System | File |
|---|---|
| Linux, any distribution | `Vitals-linux-x86_64.AppImage` (make it executable, then run it) |
| Debian, Ubuntu | `Vitals-linux-amd64.deb` |
| Windows 10 and 11 | `Vitals-windows-x64-setup.exe` |
| macOS 11 or newer, Apple silicon and Intel | `Vitals-macos-universal.dmg` |

`SHA256SUMS.txt` in the same release lists the checksum of each file. The Windows installer is unsigned: if SmartScreen
warns, choose **More info**, then **Run anyway**. The macOS app has an ad-hoc signature, not an Apple developer
signature or notarisation: if Gatekeeper blocks it, open **System Settings › Privacy & Security › Open Anyway**.
Windows and macOS installers were built and smoke-launched in CI, but their full user flows have not
been hand-tested.

**Build it yourself.** Needs Node (the version in `.nvmrc`) and pnpm.

```sh
pnpm install
pnpm --filter @vitals/desktop run build   # the web app plus the app's own bundles, in apps/desktop/dist
pnpm --filter @vitals/desktop run start   # run it
pnpm --filter @vitals/desktop run dist:linux   # AppImage and .deb in apps/desktop/release
```

The Windows and macOS installers are built by the release workflow on those systems.

## Android app

The same Vitals web app as an installable APK (`desi.creative.vitals`, Android 8 or newer, built with Capacitor). What it
adds to the website:

- **Ring over Bluetooth**, with a reconnect by the ring's stored address. No ring ever asks you for a password.
- **A foreground service** that keeps the ring link alive with the screen off, shown as a persistent "Ring connected"
  notification. A 15-minute screen-off read and upload was observed while the phone was charging; an unplugged
  overnight run still needs checking. If background reads stop, use Android's **Settings › Battery › Vitals › Allow
  background activity**.
- **Boot and update receivers.** After a restart or an app update a quiet "tap to connect your ring" notification
  appears, if you asked Vitals to stay connected. Android does not let an app start itself from the background.
- **Notifications** for a low ring battery and for a lost ring link.
- **Pairing with your server** by code or by scanning the QR, and App Links: a pairing link from
  `https://vitals.creative.desi/settings` opens the app on its Settings page.
- **Share to Vitals** for the file formats the importers read.

**Install.** Use **Get the app** on the Vitals website, or download `Vitals-android.apk`
from the [latest release](https://github.com/patalbansishashank/vitals/releases/latest). Open it and allow installs
from that source when Android asks. The release APK is signed with the project's release key so future releases can
install over it. Check that the file is named `Vitals-android.apk`: if a release offers only
`Vitals-android-unsigned.apk`, it cannot be installed until you sign it yourself. The app's origin is
`https://localhost`; a Vitals Server from 0.5.0 on accepts it, so you add nothing to `allowedOrigins`.

**Build it yourself.** Needs JDK 21 and the Android SDK (platform 36, build-tools 35 or 36).

```sh
export JAVA_HOME=/path/to/jdk-21 ANDROID_HOME=/path/to/android-sdk
pnpm install
pnpm --filter @vitals/android run build:debug   # apps/android/android/app/build/outputs/apk/debug/app-debug.apk
pnpm --filter @vitals/android run build:apk     # release build, unsigned, in app/build/outputs/apk/release/
```

A build you make yourself is signed with your own key, or not at all; it will not update over the release APK.

## Rings

Vitals talks to rings itself over Bluetooth: Web Bluetooth in the browser and the desktop app, and native Bluetooth on
Android. The J-Style 2301 is the first supported ring. No ring ever asks you for a password or key. Where
each protocol came from is written in [src/biometrics/LICENSES.md](src/biometrics/LICENSES.md).
The built-in J-Style 2301 passcode worked on one real ring; another ring with the same firmware may differ.

## Evidence policy

- Every equation and parameter in the model traces to published human evidence and carries a grade from A to D.
- Every curve is shown with a likely range, not a single line. The ranges come from running the model many times
  with its uncertain parameters varied.
- The model is checked against published studies. Results, including where it misses and why, are in
  [docs/VALIDATION_REPORT.md](docs/VALIDATION_REPORT.md).
- A miss is recorded openly with its cause; a check is never loosened to hide it.
- The specification is [docs/MODEL_SPEC.md](docs/MODEL_SPEC.md); the research is in [research/](research/).
- Projections are for an average person with your inputs. They are not predictions for you.

## Medical disclaimer

Vitals is not a medical device and gives no medical advice. Its projections are model estimates with stated
uncertainty. Talk to a clinician before you change medication, fast for long periods, or start a plan if you have a
medical condition, are pregnant or breastfeeding, or have a history of disordered eating. Safety limits are built in,
but they are not a substitute for care. Stop and get help if you feel unwell.

## Security

To report a problem, see [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

Vitals is released under the MIT licence: see [LICENSE](LICENSE). Third-party notices for ring protocols are in
[src/biometrics/LICENSES.md](src/biometrics/LICENSES.md). Data and assets that Vitals uses:

- USDA FoodData Central food data: CC0
- IFCT 2017 (Indian food composition): not bundled; permission is pending
- MakeHuman-based 3D figure: CC0
- Archivo font (through `@fontsource-variable/archivo`): SIL Open Font Licence
