# Validation accounting

Reviewed 31 October 2026 for the 0.7.8 software gate. This is a status inventory, not a new model calibration or an
independent empirical validation. A green software gate means the executed assertions match their reviewed contracts;
scientific misses remain misses.

## Dispositions and source mapping

`docs/validation/test-dispositions.json` enumerates every expected failure, allowed skip and todo by the exact runtime
file/test identity, reason, source and disposition. `scripts/validation/status-reporter.mjs` records actual outcomes;
`accounting.mjs` rejects unregistered or stale exceptions, missing files, duplicate partition execution and incomplete
runs. The registry is reviewed source, not automatically rewritten by the gate.

| Status | Count | Reason, source and test mapping | Disposition |
|---|---:|---|---|
| Scenario must-pass target misses | 109 | `knownMisses.ts`, `KNOWN_MISSES.md`, scenario fixtures and `scenarios.test.ts`: 97 accepted model limitations, 12 open calibration items | Original target asserted as an expected failure; an unexpected pass requires review |
| Scenario tracked target misses | 12 | Scenario fixtures' K rows, `scenarios.test.ts` | Expected failure retained; never count as empirical pass |
| Module/body/reference discrepancies | 90 | Exact test names and explanations in `test-dispositions.json`; detailed study and equation comments beside each assertion | Original numerical targets retained; includes synthetic reference tables, conflicting study targets and model approximations |
| Known causal approximation | 1 | `model/fasting/fasting.test.ts`: daily carbohydrate/sodium totals can affect earlier refeed-oedema estimates | Unresolved model limitation; observed-event prefix checks separately pass. No hourly causal-precision claim |
| External-agent integration checks | 3 skipped | `serverAgents.live.e26.test.ts`: Claude Code, Codex, OpenCode use installed agents/accounts | Explicit opt-in manual integration, not an offline software claim; `E26_LIVE=1` only when authorized |
| Held-out body-composition evaluation | 1 todo | `body/estimateBody.test.ts`: whole-person DXA/4C dataset and method-bias/coverage evaluation missing | No calibrated predictive coverage or independent validation claim |
| Saturated performance measurement | No allowed skip | `validation/invariants.test.ts`, O-11 bundled engine | Incomplete measurement fails release accounting; rerun on idle resources with unchanged bounds |
| Desktop agent-config parser defect | Fixed software regression | `apps/desktop/src/main/aiTools.verify.test.ts`, companion TOML header parsing | Ordinary passing regression after the 0.7.8 fix; removed from expected-failure accounting |

The first four rows total 212 expected failures. Module/reference checks overlap study scenarios; summing them does
not produce a count of independent studies. The previous 0.7.7 full run's 213 expected failures included the desktop
parser bug. Its fourth skip was the saturated O-11 timing check, not another accepted evidence gap.

## Untracked or missing scientific evidence

The checked model ledger (`docs/validation/review-release-ledger.json`, guarded by `scenarios.test.ts` and provenance
regressions) has 178 scenarios and 606 outcome entries: 383/492 must-pass rows met, 109 registered misses, 12 tracked
misses and 62/102 direction-only checks in direction. There are **zero unregistered target misses, no missing numerical
scenario outputs and no scenario execution errors** in the reviewed ledger. Direction-only misses do not become
ordinary numerical successes merely because their reporting test passes.

The same ledger explicitly marks 256 outcome rows with unresolved provenance. Unknown participant scope, measurement
method, estimand or source extraction excludes applicable empirical goal coverage. There are zero untouched held-out
study evaluations. Filling those gaps requires source/data work; adding a passing software test cannot supply it.

`docs/PLANNER_COVERAGE.md` and `public/validation/planner-coverage.json` are a separate last-published search audit:
23 mechanisms are known but not modelled, 99 model effects lack a documented mechanism, six limits/consents do not
change the tested result, and five levers are absent from both final plans and their explanations. These are explicit
coverage/research limitations, not unexplained test-run failures. The report lists each mechanism/lever and the audit
code identifies the corresponding reachability/liveness checks. Four gate-removal results are flagged for review
(one reviewed and retained). They do not authorize removal of safety rules. This release's UI/orchestration work does
not claim these historical audit findings were resolved or that a fresh expensive search matrix was run.

## Report provenance and gate boundaries

- `VALIDATION_REPORT.md` and its internal counterpart remain the 19 October scientific snapshot. The ledger and
  headline-count contracts are rerun; auxiliary sensitivity/ketone sections explicitly retain the 1 October run.
- The report's historical O-11 timing numbers are not today's measurement. Current timing comes from the serial
  release-gate log, with actual machine load and unchanged limits.
- Planner benchmark artifacts are frozen benchmark evidence. Running unit tests around their schema is not a new
  optimization comparison. `pnpm bench:planner` is a separate explicit benchmark workload.
- `pnpm audit:planner` creates fresh staging directories for all parts and levels. Report assertions run before
  replacing published docs/JSON; a failed part cannot reuse a successful old cached part.
- Credential-free CI runs `pnpm check`, a production web build and unsigned Gauge/app JVM tests. Local software test
  accounting does not include native tests; their XML reports are separate. Physical phone gestures/radio behavior,
  installed desktop behavior and live external-agent service calls require their own evidence.

Run `pnpm check` for all software gates; `pnpm test:release` is the single complete Vitest/accounting command. CI records
its exact inventory and count receipts in job outputs and logs even when a run fails; archival is optional. Do not splice an isolated rerun into a failed full run
and label the original run green. Keep the failure diagnosis and run the complete gate again after fixing its cause.

Native JVM accounting (`pnpm test:native-accounting`) accepts only the three named opt-in tests in
`MqttTransportSmokeTest`: real subscriber delivery, ordered inflight publishing and bad-credential rejection. They
require a configured real broker (`MQTT_TEST_URI` and, for rejection, test credentials); ordinary offline CI does not
claim those integrations ran. All other native skips, including a skipped source-leak guard, fail accounting. Missing
Gauge or app XML results also fail. Native skip counts remain separate from the three frontend agent-service skips.

## Immutable source receipts

`pnpm check` fingerprints source before typecheck/lint/tooling begin and after all test partitions and accounting finish.
`pnpm test:release` uses the same boundary around its test-only run. Each summary records start/end commit, dirty status,
SHA-256 source and Git-status digests, file/byte counts and timestamps. A separate file-metadata digest also catches
edits reverted to the original bytes before completion (rewriting/touching source conservatively requires a rerun). Dirty development source is allowed; a changed
working file, added/deleted test, staged state or HEAD during the gate fails it even when every test passed. A failed
partition still gets a final fingerprint; an interrupted process leaves a running receipt, never a passed one.

The fingerprint includes tracked files and nonignored new files, including fixture data, committed reports and packaged
assets. Transient build/test output trees and Kotlin caches are excluded. Symlinks are hashed as links without following
their targets; tracked files underneath a symlink parent fail closed. Hashing is bounded to 50,000 files, 64 MiB per file
and 512 MiB total; exceeding a bound fails instead of silently omitting source. File contents are never printed. Use the
default ignored `.vitest/release` output directory or an evidence directory outside the repository. Both receipts must
match before a run can be labelled passed; subsequent edits require a new complete gate.

## Hosted runtime and parallel accounting

The supported development/server baseline is Node 26.10.0 or newer; `.nvmrc` and the Netlify build pin 26.12.1. The gate
checks native disposal-stack and Web Locks availability before costly tests. The previous Node 22 hosted run failed
these platform contracts, so its failure was not an approved scientific limitation.

Local `pnpm check` still executes the complete preflight plus ordinary/serial suite. Hosted CI distributes the ordinary
file inventory deterministically across four independent two-worker jobs and runs resource-sensitive files in a fifth,
serial job. The serial selector includes the embedded moderators benchmark and geometry workloads as well as named
benchmarks. No test timeout, numerical tolerance or performance threshold is relaxed.

### Timing reference (2 November 2026)

Absolute O-11 timing is measured on the standard `ubuntu-24.04-arm` pool, using the same pinned Node version,
180-day workload, 14-day burn-in, warmups, samples, retry policy and 10/15 ms limits. The four core jobs, Android
and final browser/build checks remain on `ubuntu-24.04` x64. All selected tests still run exactly once in a full gate.

This makes the timing environment explicit rather than treating different server CPUs as interchangeable. The same
source passed on an x64 EPYC 9V45 and failed on an EPYC 7763; pinning Ubuntu alone did not remove that variation.
The ARM reference diagnostic passed all serial checks (full 12.09 ms, planner 8.50 ms), but that diagnostic alone is
not a full validation pass. These limits are reference-machine acceptance criteria, not a guarantee for every CPU.
The runtime version, architecture, CPU information, memory and load are retained in the job log.

Standard ARM runners use the plan's included minutes for private repositories; no larger runner or billing setting
is enabled. See [GitHub's availability notice](https://github.blog/changelog/2026-01-29-arm64-standard-runners-are-now-available-in-private-repositories/).
An explicit manual `scope=serial` run can select either approved standard image for comparison. It skips the other
jobs **and the aggregate**, so it cannot produce a full validation receipt. Push, pull-request, release-call and
default manual runs always retain every job; workflow-scope tests guard this boundary.

Each job reports its exact full inventory, executed files, counts, exception identities and start/end source receipts.
Run IDs prevent stale local report reuse. Bounded gzip/base64 job outputs (at most 60,000 characters apiece, each in a
separate environment value) carry those receipts to the aggregate job; artifact storage is not part of this path.
Structured `VALIDATION_RECEIPT_CHUNK` log lines retain the complete receipts, while `VALIDATION_SUMMARY` prints source
and count metadata directly. The aggregate requires all four core receipts, serial and native receipts, matching clean
commit/content fingerprints, unchanged source within each test run, complete preflight, exact once-only file coverage
and the original exception registry. A cancelled/missing/failed shard cannot yield a green result.

The native job builds its own web assets and syncs Capacitor. Its source boundary starts after those expected build
writes, then remains unchanged through Gradle tests and native accounting; its content fingerprint must match the
software jobs. Native counts/skips remain distinct from frontend counts. Browser and production web checks follow the
aggregate gate.

Archival is **off by default**. A repository administrator may set the non-secret variable `VITALS_ARCHIVE_VALIDATION`
to `true` when artifact storage is available. Enabled archives retain diagnostics for three days; upload failure emits
an explicit warning but cannot replace or bypass any test/source/accounting check. No validation/build/native job
downloads an artifact or depends on an upload. No unrelated artifacts are deleted and no billing change is required.
