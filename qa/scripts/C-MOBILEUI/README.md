# Mobile visual checks

All profiles are synthetic and unpaired. Evidence is written only beneath `.e6-tmp/c-mobileui/`.

Set `BASE` to a preview of the worktree. `capture.mjs before` creates fresh fixture state using the C-DESIGN seeder; `survey.mjs before` resumes missing route captures. `overlays.mjs before` captures common interactive states; `results.mjs before` runs real synthetic Planner and Simulator jobs. Capture errors are coverage gaps, not product findings.

For regression checks, set `SYNTHETIC_STATE` and `STATE` to the generated `synthetic-state.json`, then run:

- `node qa/scripts/C-MOBILEUI/touch-targets-fix1.mjs`
- `node qa/scripts/C-MOBILEUI/settings-mobile-fix2.mjs`
- `node qa/scripts/C-MOBILEUI/intake-layout.mjs`
- `node qa/scripts/C-MOBILEUI/simulator-layout.mjs`
- `node qa/scripts/C-MOBILEUI/body-footer-layout.mjs`

Optional screenshot directories: `OUT` for Settings, intake and Body; `SCREENSHOT_DIR` for Simulator. Keep these under `.e6-tmp`. Tests include small desktop controls to prevent accidental loss of compact pointer layouts.

See `qa/results/C-MOBILEUI/report.md` for verified fixes and incomplete coverage. The browser route survey may include images taken after a fix merged; dedicated regression checks are the after proof.
