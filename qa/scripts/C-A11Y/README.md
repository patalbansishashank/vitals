# C-A11Y browser probes

Use a local audit server and disposable browser contexts. These scripts never attach to the owner's browser. They create synthetic onboarding answers; the development fixture has 400 days of synthetic ring data. No server pairing, hardware operation, or real AI key is needed.

Set `BASE` to the audit origin before running a script. Start a production preview for production checks or a development server for fixture checks. Supply origins through environment variables or ignored local configuration; do not add machine addresses to these files.

Install audit-only tools outside the lockfile:

```sh
mkdir -p .e6-tmp/a11y-tools
npm install --prefix .e6-tmp/a11y-tools --no-audit --no-fund --ignore-scripts @axe-core/playwright lighthouse
```

- `accessibility.mjs`: production by default; `FIXTURE=1` enables the development-only populated fixture. `LABEL` names the report. Runs 390/1440 px and both themes with reduced motion. Reports WCAG A/AA violations, incomplete rules, page overflow and raw target measurements. Incomplete rules retain five example nodes and their total count.
- `keyboard-contrast.mjs`: development fixture only. Exercises charts, table alternatives, tabs and the estimates rail. Waits for the existing 400 ms announcement debounce. Computes SVG text contrast through CSS backgrounds; this supplements axe and does not replace visual review of overlapping geometry.
- `figure-keyboard.mjs`: production or development. Requires real WebGL (SwiftShader in headless Chromium), then checks keyboard turning, focus pause, pause/resume buttons and reduced motion using the canvas's existing angle instrumentation.
- `lighthouse.mjs`: production only. Fresh temporary profile per device. `LABEL` names the report; `ROUTES` may narrow the comma-separated route list. Full default run measures fresh Welcome, then synthetic onboarding and Ring, Signals and Body. `DEBUG_PORT` selects a free local debugging port. Scores are lab measurements, not field data.
- `performance.mjs`: use `DEV_BASE` and `PREVIEW_BASE` for synthetic year-data and repeated Body navigation probes. See its report method for data-source and rendering limits.

Run scripts with `TMPDIR=$PWD/.e6-tmp`. Screenshots and browser profiles stay in that ignored directory. Reports contain routes and aggregate synthetic measurements, not audit origins or credentials. Chromium executable defaults to the system binary; most scripts accept `CHROMIUM`.

The recorded audit used axe 4.13.0, Lighthouse 13.5.0, Playwright Core 1.63.0 and Chromium 153. Full details and limitations are in `qa/results/C-A11Y/findings.md`.

`production-year.mjs` seeds the fixture's aggregate records into an isolated development store, copies only that synthetic IndexedDB state into a fresh production context, and measures Ring plus all three Signals year tabs. It reports the exact record/day counts and asserts visible imported data; the baseline deliberately excludes raw-series chunks.

`pairing-focus.mjs` uses the development-only synthetic ring service to verify keyboard entry, completion, cancellation and ordinary-update focus retention; it never scans real hardware.

Set `RAW=1` for `production-year.mjs` to include the fixture's five-minute HR samples and the age-based Heart day assertion; it writes `production-year-raw.json`. The synthetic seed forces the app's IndexedDB blob fallback so browser state can transfer between isolated origins. This is not an OPFS transfer test.

For a repeat after an integration update, `STATE_FILE` may reuse the synthetic cache produced by this harness under `.e6-tmp`; never point it at an owner's browser data. `RUNS=1` narrows the repeat. Preserve prior results with `OUTPUT` and record the measured commit.
