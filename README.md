# Vitals

Vitals is a private, local-first health planner. You can simulate how eating, fasting, training and sleep change
the body, then follow a living plan day by day. An optional server that you host yourself keeps your devices in
sync. There is a website, a desktop app and an Android app (coming in v0.5.0), and Vitals can read data from
rings (the J-Style 2301 first, more families after it).

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

<!-- L-DESKTOP: fill in build and install steps -->

Installers come from this repository's GitHub Releases.

## Android app

<!-- L-ANDROID: fill in build and install steps -->

Installers come from this repository's GitHub Releases.

## Rings

Vitals talks to rings itself over Bluetooth: Web Bluetooth in the browser and the desktop app, and native Bluetooth on
Android. The J-Style 2301 is the first supported ring. No ring ever asks you for a password or key. Where
each protocol came from is written in [src/biometrics/LICENSES.md](src/biometrics/LICENSES.md).

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
