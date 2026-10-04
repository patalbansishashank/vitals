# Production website QA

Install with `pnpm install --frozen-lockfile`, build with `pnpm build`, and serve `dist` with `pnpm exec vite preview`.
Set `C_WEBQA_BASE_URL` to that preview's origin. The scripts use installed Chromium; `CHROMIUM_PATH` can override its path in the shared helpers.

```sh
node qa/scripts/C-WEBQA/static-audit.mjs
node qa/scripts/C-WEBQA/seed.mjs
node qa/scripts/C-WEBQA/seed.mjs --signals
node qa/scripts/C-WEBQA/sweep.mjs
C_WEBQA_PROFILE=seeded node qa/scripts/C-WEBQA/sweep.mjs
node qa/scripts/C-WEBQA/regressions.mjs
node qa/scripts/C-WEBQA/onboarding.mjs
node qa/scripts/C-WEBQA/launch.mjs
node qa/scripts/C-WEBQA/accessibility.mjs
C_WEBQA_PROFILE=seeded node qa/scripts/C-WEBQA/accessibility.mjs
node qa/scripts/C-WEBQA/anchors.mjs
node qa/scripts/C-WEBQA/copy-provenance.mjs
C_WEBQA_EXPECT_STABLE=1 node qa/scripts/C-WEBQA/download-layout.mjs
node qa/scripts/C-WEBQA/offline.mjs
node qa/scripts/C-WEBQA/summarize.mjs
```

Run the Ring/Signals script using its environment variables documented in the file. Its fixture matrix needs a separate Vite development server because fixture injection is intentionally absent from production. Its production mode uses the synthetic seed above.

All browser profiles, storage snapshots, screenshots, and detailed JSON logs stay under ignored `.e6-tmp/C-WEBQA/`. No real server pairing, credentials, health records, browser profiles, Bluetooth devices, or app installs are used. The seed imports existing synthetic fixtures and uses the shipped UI to create an active plan and log food. The optional `--signals` step adds the same synthetic readings shifted to the current day; the sweep prefers that snapshot when present. `C_WEBQA_STATE_PATH` can select a snapshot explicitly.

The sweep follows all route templates, friendly aliases, onboarding sections, settings paths and anchors, representative valid dynamic IDs, missing IDs, and the deliberate error route. Each runs at 390, 768, and 1440 pixels in both themes, first with a fresh profile and then with seeded data. The developer error route deliberately throws and is recorded separately.

Live release links are checked separately once. Repeated layout visits intercept release metadata with a controlled pre-release response to avoid throttling the public API. The regression script also checks signed, unsigned, and cached unsigned Android release states. It never downloads an installer.

The accessibility script measures opaque text backgrounds and records focus and hit-target candidates. It excludes gradient and opacity backgrounds from automatic contrast claims; inspect candidates before reporting findings. The regression script exits nonzero on failed assertions. The route sweep retains per-route evidence for review, including console errors, failed requests, overflow, footer clearance, broken images, forbidden-copy counts, and internal link targets.

If the preview process stops, restart it and set `C_WEBQA_RETEST=unfinished` to retry interrupted or unscanned route states while retaining completed checks. A new application build should receive a full sweep. Raw forbidden-copy matches involving the existing synthetic device model label are documented separately from authored app-copy findings.
