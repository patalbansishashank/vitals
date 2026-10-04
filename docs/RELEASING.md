# Releasing

Vitals is deployed to production (https://vitals.creative.desi, Netlify site `creative-vitals`) by one GitHub Actions workflow, and only when a version tag is pushed. The same tag builds the desktop and Android apps and publishes them as a GitHub Release (a second workflow). The owner decides when a version is release-worthy.

| Event | What happens on GitHub |
|---|---|
| Push to `main` (or any branch), pull request | **Nothing.** No workflow runs, nothing is deployed. |
| Push of a tag `vX.Y.Z` | `.github/workflows/deploy.yml`: install, build, production deploy of `dist/` to Netlify. `.github/workflows/release.yml`: the desktop and Android apps and a GitHub Release (see "The apps" below) |
| Manual run ("Run workflow") | `.github/workflows/deploy.yml` for the branch or tag picked in "Use workflow from"; `release.yml` for the tag typed in its `tag` field |

The quality gate (typecheck, lint, the full test suite) runs **locally**, inside `pnpm release`, before the version tag exists. The GitHub workflows do not run tests: they only build, deploy and publish. Production deploys come only from that workflow; nobody runs `netlify deploy --prod` from a laptop, and Netlify does not build from Git on its own (the site is not connected to the repository).

## Cutting a release

From a clean, up-to-date `main`:

```sh
git switch main && git pull
pnpm release patch          # or: minor | major
git push --follow-tags origin main
```

`pnpm release <patch|minor|major>` runs, in order, and stops at the first failure:

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test:release`: the full test suite in two passes (see below)
4. `pnpm version <patch|minor|major>`: refuses to run on a dirty working tree, sets `version` in `package.json`, commits it with the message `X.Y.Z`, and creates the annotated tag `vX.Y.Z` (the `v` prefix is the default)

The bump argument is appended to the end of the script, so it reaches `pnpm version` (checked with pnpm 11.17). If anything fails, no commit and no tag are made; fix it and run `pnpm release` again.

`git push --follow-tags` pushes the version commit and the tag together. The commit itself triggers nothing; the tag triggers the deploy.

Which part to bump:

- `patch`: fixes, copy and data corrections.
- `minor`: new features or screens, model changes that move outputs.
- `major`: breaking changes to saved plans or URLs.

Watch the deploy:

```sh
gh run list --workflow deploy.yml --limit 3
gh run watch                # pick the running deploy
gh run list --workflow release.yml --limit 3   # the apps; about 15–25 minutes
```

The run's summary page shows the production URL, the unique deploy URL, the Netlify deploy id and a link to the Netlify deploy log.

`v0.1.0` was the one exception to this process: `package.json` already said `0.1.0` at the initial import and the full suite had been run on that tree, so the tag was created directly with `git tag -a v0.1.0 -m "Vitals v0.1.0"`. Do not tag by hand otherwise; `pnpm version` keeps the tag and `package.json` in agreement.

## The test gate: `pnpm test:release`

About a dozen test files measure time (module micro-benchmarks, the engine's run-time budget, the safety module's cost) or wait on the UI with timeouts. They pass on an idle machine but can fail when all ~180 test files run in parallel and saturate the CPU (Vitest's default is one worker per core but one). Their assertions are not loosened; instead `test:release` runs the suite in two passes:

1. Everything except the timing files, in parallel on half the cores: `vitest run --maxWorkers=50% --exclude "**/*bench*.test.ts" --exclude "**/safety.props.test.ts" --exclude "**/validation/invariants.test.ts" --exclude "**/evidence/__tests__/page.test.tsx"` (170 files)
2. The timing files, one at a time: `vitest run --no-file-parallelism bench safety.props.test validation/invariants.test evidence/__tests__/page.test` (13 files)

Together the two passes cover every test file exactly once. The 181 known model misses are written as expected failures and do not fail the run. Measured on the 32-thread dev PC (2026-10-01): pass 1 about 175 s (the same wall time as with every core, because one long file sets the pace), pass 2 about 10 s, all green. With every core, a parallel run failed the timing files and once timed out an unrelated UI test (`src/features/body/__tests__/energyUnit.test.tsx`, 5 s test timeout); half the workers removed that.

`pnpm test` (one parallel pass over everything, every core) still works for day-to-day use; if it reports failures only in timing-sensitive files or as UI test timeouts, re-run those files in isolation (e.g. `pnpm vitest run src/engine/model/fasting/fasting.bench.test.ts`) before treating them as real. If `pnpm release` itself stops on such a flake, run it again: nothing was committed or tagged.

## The apps (`release.yml`)

The same tag builds the apps in the public repository (`patalbansishashank/vitals`; a tag pushed to any other copy runs
nothing) and publishes them as a GitHub Release named `Vitals X.Y.Z`. Four jobs (the desktop one runs three times):

| Job | Runner | Produces |
|---|---|---|
| Version and notes | Ubuntu | checks the tag equals `package.json`'s version; the notes are that version's `CHANGELOG.md` section (`scripts/release/release-notes.mjs`), falling back to `## Unreleased` with a warning |
| Desktop (linux) | Ubuntu | `Vitals-linux-x86_64.AppImage`, `Vitals-linux-amd64.deb` |
| Desktop (windows) | Windows | `Vitals-windows-x64-setup.exe` (NSIS) |
| Desktop (macos) | macOS (Apple silicon) | `Vitals-macos-universal.dmg` (one app for Apple silicon and Intel) |
| Android | Ubuntu, JDK 21 | `Vitals-android.apk`, signed; `Vitals-android-unsigned.apk` instead when the signing secrets are missing |
| GitHub Release | Ubuntu | `SHA256SUMS.txt`, then creates the release (or, on a re-run, replaces its files and notes) |

The Windows and macOS legs never block the release: if one fails, the release goes out with the Linux files and the APK
and without that leg's file. A Linux or Android failure stops the release.

Desktop jobs also upload electron-updater's files (`latest.yml`, `latest-linux.yml`, `latest-mac.yml`, `*.blockmap`).

**Asset names are stable** (no version in the name), so the newest file is always at
`https://github.com/patalbansishashank/vitals/releases/latest/download/<name>`. The website's download block reads
`GET https://api.github.com/repos/patalbansishashank/vitals/releases/latest` for the version and sizes. Renaming an asset
breaks those links: change `release.yml`, this table and the download block together.

How each part is built:

- **Desktop:** `pnpm --filter @vitals/desktop run build`, then `electron-builder --publish never` from `apps/desktop`
  with the version pinned to the tag (`-c.extraMetadata.version`) and the file names set per target
  (`-c.<target>.artifactName`). The unpacked app is started once with `VITALS_SMOKE=1` (`scripts/release/smoke-desktop.sh`;
  the app quits by itself after its window loads). Windows and macOS builds are not code-signed: signing certificates are
  an owner purchase. macOS builds are ad-hoc signed so they open on Apple silicon after "Open Anyway".
- **Android:** `pnpm --filter @vitals/android run build:apk` (web build, `cap sync android`, `gradlew assembleRelease`
  with no signing config), then `scripts/release/sign-apk.sh` aligns the APK and signs it with `apksigner`.
- **Checksums:** `scripts/release/checksums.sh` hashes every installer (not the updater files).

Only plain `vX.Y.Z` tags build: a pre-release tag such as `v0.5.0-rc.1` stops at the first step, so it can never become
the "latest" release the download links point to. Re-running a failed run is safe: the release's files and notes are
replaced, and a release left as a draft by a broken upload is published.

To build a tag again without publishing (for example to test the pipeline): Actions → **Release** → **Run workflow**,
type the tag, untick "Publish". The files stay on the run as artifacts for 90 days.

```sh
gh workflow run release.yml -f tag=v0.5.0 -f publish=false
```

### The Android signing key

Every release must be signed with the same key, or phones refuse the update ("App not installed") and people have to
uninstall first, which deletes the app's local data. The key was made on 2026-10-04 and lives **outside the repository**
on the owner's PC:

| File (mode 0600) | What it is |
|---|---|
| `~/.config/vitals-release/android-release.jks` | the keystore (PKCS12, RSA 4096, valid 10,000 days, alias `vitals`) |
| `~/.config/vitals-release/android-release.env` | `ANDROID_KEY_ALIAS`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD` |

Certificate SHA-256: `C6:B6:02:6E:D0:A2:B8:AE:D4:9D:7A:5E:2F:94:4B:65:9F:FC:47:2F:69:B6:16:E0:34:27:FF:AD:A9:86:BB:70`
(`apksigner verify --print-certs Vitals-android.apk` shows it). **Back up both files** somewhere safe and offline. Losing
them means a new signing identity: every phone must uninstall and reinstall.

Setting the four repository secrets from those files, without printing them:

```sh
cd ~/.config/vitals-release
R=patalbansishashank/vitals
base64 -w0 android-release.jks | gh secret set ANDROID_KEYSTORE_B64 -R "$R"
( set -a; . ./android-release.env; set +a
  for k in ANDROID_KEY_ALIAS ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_PASSWORD; do
    printf '%s' "${!k}" | gh secret set "$k" -R "$R"
  done )
gh secret list -R "$R"
```

To sign a local build by hand: `set -a; . ~/.config/vitals-release/android-release.env; set +a;
ANDROID_KEYSTORE_B64=$(base64 -w0 ~/.config/vitals-release/android-release.jks) bash scripts/release/sign-apk.sh <unsigned.apk> <out-dir>`.

### Checking the release scripts

```sh
node --test scripts/release/                   # release notes
actionlint .github/workflows/*.yml             # https://github.com/rhysd/actionlint (runs shellcheck too)
```

## Re-deploying without a new version

GitHub → Actions → **Deploy** → **Run workflow**, then pick the tag to deploy under "Use workflow from" (for example `v0.1.0` to roll back to it, or the latest tag to re-deploy it). Or from a terminal:

```sh
gh workflow run deploy.yml --ref v0.1.0
```

The deploy message on Netlify is `Release <ref name>`; a manual run from a branch shows the branch name instead of a version. Runs share the concurrency group `production` and are queued, never cancelled mid-deploy.

## Secrets

Repository secrets (GitHub → Settings → Secrets and variables → Actions). Names only; values never go in the repository:

| Secret | What it is |
|---|---|
| `NETLIFY_SITE_ID` | The Netlify site id (see `docs/DEPLOY.md`) |
| `NETLIFY_AUTH_TOKEN` | A Netlify personal access token for the owner's account |
| `ANDROID_KEYSTORE_B64` | The Android release keystore, base64 (see "The Android signing key") |
| `ANDROID_KEYSTORE_PASSWORD` | Its store password |
| `ANDROID_KEY_ALIAS` | The key's alias (`vitals`) |
| `ANDROID_KEY_PASSWORD` | The key's password (the same as the store password: PKCS12 keystores have one) |

To rotate the token: create a new one in Netlify (User settings → Applications → Personal access tokens), run `gh secret set NETLIFY_AUTH_TOKEN` and paste it at the prompt, then revoke the old one.

## How the deploy workflow works

- Steps: checkout, pnpm 11 (`pnpm/action-setup`, `version: 11`), Node from `.nvmrc` (`actions/setup-node`, pnpm cache), `pnpm install --frozen-lockfile`, `pnpm build`, then the Netlify CLI (`netlify-cli` 27 through `pnpm dlx`) uploads `dist/` with `--prod --no-build`. `--no-build` stops the CLI from running `pnpm build` a second time; `netlify.toml` (SPA fallback, cache and security headers) is still applied.
- `netlify-cli` ships two binaries (`netlify` and `ntl`), so with pnpm 11 the command is `pnpm --package=netlify-cli@27 dlx netlify deploy ...`; `pnpm dlx netlify-cli@27 deploy ...` fails with `ERR_PNPM_DLX_MULTIPLE_BINS`.
- If a `packageManager` field is ever added to `package.json`, remove `version:` from the pnpm setup step.

## History

- 2026-10-01: a first version also ran typecheck, lint, build and the full test suite on GitHub for every push to `main` (`ci.yml`). On the 2-core runner the test step was still running after 23 minutes, so the run was cancelled and the owner moved the gate to the local `pnpm release` script. `ci.yml` was removed; GitHub now only builds and deploys tags.
