# Releasing

A release has four parts, in this order:

1. **The private commit.** `pnpm release` checks the tree, bumps the version, commits and tags it in the private
   repository (`origin`, `patalbansishashank/vitals-private`), which keeps the full history. Nothing there publishes.
2. **The public snapshot and tag.** `scripts/publish/publish-public.sh` copies that commit, minus the private paths,
   to the public repository (`public`, `patalbansishashank/vitals`) and pushes the tag there.
3. **The public workflows.** The tag runs `release.yml` in the public repository: one validation of the tagged commit,
   then the desktop apps and the signed APK as a GitHub Release, and the website on Netlify
   (https://vitals.creative.desi, site `creative-vitals`) through `deploy.yml`.
4. **The phones.** Phones update only from the home server's update feed, and no workflow feeds it.
   `pnpm release:ota` publishes the signed APK and the web bundle there.

The release and deploy workflows run only in the public repository (`github.repository == 'patalbansishashank/vitals'`),
so pushing a tag to `origin` builds and deploys nothing. The owner decides when a version is release-worthy.

| Event | What happens on GitHub |
|---|---|
| Push to `main` or `wp/r063-int`, pull request | Credential-free `.github/workflows/ci.yml`: software gates, production web build and unsigned Android unit tests. Nothing deploys. Other branch pushes alone run nothing. It also runs in the private repository. |
| Push of a tag `vX.Y.Z` (public repository) | `release.yml` resolves the tag to one immutable commit, runs the shared validation workflow once, then packages the apps and calls `deploy.yml` for the website. |
| Push of a tag `vX.Y.Z-rc.N` (public repository) | Builds all app platforms as run artifacts only. No GitHub Release and no website deploy. |
| Manual run ("Run workflow") | `deploy.yml` for the branch or tag picked in "Use workflow from" (it runs the validation gate for that commit first); `release.yml` for the tag typed in its `tag` field |

The quality gate runs locally in `pnpm release` and on GitHub before a tag can package or deploy. Release validation,
packaging and deployment use the same resolved commit SHA. Pull requests never receive deployment or signing secrets.

## Cutting a release

### 1. The private commit

From a clean, up-to-date release branch (`main`, or the integration branch the round ships from):

```sh
git switch main && git pull
pnpm release patch          # or: minor | major
git push --follow-tags origin main
```

`pnpm release <patch|minor|major>` runs, in order, and stops at the first failure:

1. `pnpm check`: typecheck, lint, release-tool/accounting tests, then the full partitioned test gate.
2. `pnpm audit:planner`: fresh staged planner evidence audit; only successful reports replace published artifacts.
3. `pnpm version <patch|minor|major>`: refuses a dirty working tree, updates the version, commits it and creates the tag.

The bump argument is appended to the end of the script, so it reaches `pnpm version` (checked with pnpm 11.17). If
anything fails, no commit and no tag are made; fix it and run `pnpm release` again.

`pnpm version` changes only the root `package.json` and refuses a dirty tree, so commit the rest first: the version's
`CHANGELOG.md` section (the GitHub Release notes are that section), and the same version in
`apps/android/package.json`, `apps/desktop/package.json` and `packages/companion/package.json`.

`git push --follow-tags origin main` stores the commit and the tag in the private repository only. Its validation run
is the same credential-free `ci.yml`; nothing is published from there.

Which part to bump:

- `patch`: fixes, copy and data corrections.
- `minor`: new features or screens, model changes that move outputs.
- `major`: breaking changes to saved plans or URLs.

The Android versionCode is `major*10000 + minor*100 + patch` (0.8.7 is 807). The Gradle build and
`scripts/release/web-bundle.mjs` refuse a minor or patch above 99, which would collide with the next minor or major:
after x.y.99 comes x.(y+1).0.

### 2. The public snapshot and tag

```sh
scripts/publish/publish-public.sh "Vitals 0.8.7: what changed, in one line" --tag v0.8.7 --dry-run
scripts/publish/publish-public.sh "Vitals 0.8.7: what changed, in one line" --tag v0.8.7
```

The script snapshots the tagged commit minus `scripts/publish/exclude.txt`, runs the public guards (passcode, ring
brand, private names, secret-shaped strings) on that exact tree, then pushes the snapshot to `public` main and an
annotated `v0.8.7` tag to the same commit. It refuses a tag that already exists. The private names guard needs the
git-ignored `qa/local.config.json`. Setup and details: `scripts/publish/README.md`. Never push a branch or tag to
`public` by hand.

### 3. The public workflows

The public tag starts `release.yml`. It checks that the tag equals `package.json`'s version, validates the tagged
commit once, then in parallel builds the apps into a GitHub Release named `Vitals X.Y.Z` (see "The apps" below) and
deploys the website through `deploy.yml`. The push to public `main` also starts `ci.yml` there.

```sh
R=patalbansishashank/vitals
gh run list -R "$R" --workflow release.yml --limit 3   # the apps and the website; about 15 to 25 minutes
gh run watch -R "$R"                                   # pick the running release
gh release view v0.8.7 -R "$R"
```

The deploy job's summary shows the production URL, the unique deploy URL, the Netlify deploy id and a link to the
Netlify deploy log. Desktop apps update themselves from the GitHub Release (electron-updater).

### 4. Publishing to the phones

The Android app checks the home server's update feed (`GET /v1/apps/vitals/latest`, docs/SERVER.md "Updates"), never
GitHub. A release reaches phones only after both of its parts are in that feed:

- **The signed APK.** Use the GitHub Release's `Vitals-android.apk`, which CI signs with the release key:
  `gh release download v0.8.7 -R patalbansishashank/vitals -p Vitals-android.apk -D apps/android/release`. Never
  publish `Vitals-android-unsigned.apk`; phones refuse it, and the script below does too.
- **The web bundle.** On the release commit, `pnpm release:web` builds `dist/`, zips it with `bundle.json` and signs it
  with the web-bundle key (`~/.config/vitals-release/web-bundle-ed25519.key`, never in the repository). It prints the
  zip, its `.sig` and the **minimum native versionCode** it chose.

The minimum native versionCode decides which phones take the bundle: the feed offers a bundle only to an installed APK
at or above it. By default it is this release's own versionCode (807 for 0.8.7), so a phone on an older APK gets the
bundle only after it installs this APK. When the release did not change what the web code needs from the native app,
pass the oldest APK it works with, for example `pnpm release:web --min-native-version-code 802`, and older phones get
the bundle straight away. Web code that reads something new from the native bridge must treat it as optional for this
to be true.

Then publish both, APK first:

```sh
pnpm release:ota --apk apps/android/release/Vitals-android.apk \
  --web apps/android/release/web/vitals-web-<version>.zip --notes "Vitals 0.8.7: what changed"
```

`scripts/release/ota-publish.sh` reads the host from `OTA_TARGET` (`ssh:<host>`), else `serverSsh` in the git-ignored
`qa/local.config.json`, the same host `deploy/oci-arm.sh` deploys to. It checks the APK is signed and the bundle's
`.sig` sits beside it, reads the feed, and refuses a bundle whose minimum native versionCode is above the newest APK in
the feed unless that APK is published in the same run. It copies the files to a private staging folder on the host, runs
`vitals-server release publish vitals --apk …` and then `--web …` there, removes the copies, and prints what the feed
now offers and which bundle a phone on the newest APK takes. `--dry-run` stops after the checks. Run either part alone
when only one changed (`--apk` or `--web`).

Check the feed afterwards, or at any time:

```sh
pnpm release:ota --list
```

The newest APK line should name this release's versionCode, and the first web line whose "needs versionCode" is at or
below it is the bundle phones take. The phone shows the update banner on its next check (on launch, on returning to the
app, or within a minute while it is open).

If the home server itself changed, deploy it as well: `deploy/oci-arm.sh` (docs/SERVER.md).

`v0.1.0` was the one exception to this process: `package.json` already said `0.1.0` at the initial import and the full
suite had been run on that tree, so the tag was created directly with `git tag -a v0.1.0 -m "Vitals v0.1.0"`. Do not
tag by hand otherwise; `pnpm version` keeps the tag and `package.json` in agreement.

## The test gate: `pnpm test:release`

The gate discovers the complete current test-file inventory, then runs two disjoint partitions from a shared selector
in `vite.config.ts`: ordinary tests with at most two workers, followed by resource-sensitive tests one file at a time.
The serial set includes module benchmarks, safety property tests, bundled engine invariants, the large Evidence page
and the Progress card accessibility suite that previously timed out under 16-worker load. Thresholds and timeouts are
unchanged. New files are automatically included and the final accounting rejects omissions or duplicate execution.

`pnpm test` also defaults to two workers. Use explicit targeted tests during parallel development; reserve a quiet CPU
window for `pnpm test:release`. A saturated bundled-engine benchmark may still report a skip, but release accounting
rejects it: wait for idle resources and rerun the gate, never count the skipped budget as a pass.

The gate writes `.vitest/release/{inventory,core,serial,summary}.json` (override the directory with `VITALS_GATE_DIR`).
The summary also records the source commit, dirty status and bounded SHA-256 fingerprints at start/end; any source
or Git-state mutation during the run fails the gate. `pnpm check` starts this boundary before typecheck/lint/tooling.
Its exact expected-failure/skip/todo registry is `docs/validation/test-dispositions.json`. On the reviewed source there
are 212 scientific/reference expected failures, three deliberate external-agent skips and one held-out-data todo.
These are separately counted limitations, not ordinary software passes or proof of empirical accuracy. Unexpected
passes, new or removed exceptions, unfinished tests and unhandled errors fail the gate. Changes to the registry require
an explained scientific or integration disposition, never a smaller assertion or a convenience skip.

`pnpm test:tooling` includes Node's release policy, source-path, bundle-signature and release-note tests, which Vitest's
normal globs do not discover. `pnpm check` is the complete software command. The slow planner audit remains a separate
release step because it explores a much larger search matrix; it starts with fresh part/level directories to prevent
mixed old/new results. Its outputs are not independent empirical validation. See `docs/VALIDATION_ACCOUNTING.md` for
scientific evidence gaps and current artifact provenance.

Hosted CI uses four bounded core jobs plus an independent serial job, and aggregates every file/exception/source
receipt before the browser/build gate. The native job builds its own web assets; source/count receipts travel through
job outputs and structured logs, so storage quota cannot suppress native validation. Optional diagnostic archival is
off unless the repository variable `VITALS_ARCHIVE_VALIDATION=true` is set. Enabled upload failures warn explicitly;
they never make a failing software check pass. See `docs/VALIDATION_ACCOUNTING.md` for the receipt contract.

## The apps (`release.yml`)

The same tag builds the apps in the public repository (`patalbansishashank/vitals`; a tag pushed to any other copy runs
nothing) and publishes them as a GitHub Release named `Vitals X.Y.Z`. The shared validation workflow runs before packaging and website deployment (the desktop job runs three times):

| Job | Runner | Produces |
|---|---|---|
| Version and notes | Ubuntu | checks the tag equals `package.json`'s version; the notes are that version's `CHANGELOG.md` section (`scripts/release/release-notes.mjs`), falling back to `## Unreleased` with a warning |
| Desktop (linux) | Ubuntu | `Vitals-linux-x86_64.AppImage`, `Vitals-linux-amd64.deb` |
| Desktop (windows) | Windows | `Vitals-windows-x64-setup.exe` (NSIS) |
| Desktop (macos) | macOS (Apple silicon) | `Vitals-macos-universal.dmg` (one app for Apple silicon and Intel) |
| Android | Ubuntu, JDK 21 | `Vitals-android.apk`, signed; `Vitals-android-unsigned.apk` instead when the signing secrets are missing |
| GitHub Release | Ubuntu | `SHA256SUMS.txt`, then creates the release (or, on a re-run, replaces its files and notes) |

For a publishing run, the Windows and macOS legs never block the release: if one fails, the release goes out with the Linux files and the APK
and without that leg's file. A Linux or Android failure stops the release. Dry runs require all platforms to pass.

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

Plain `vX.Y.Z` tags must match the root package version and publish the release. Candidate tags such as
`v0.5.0-rc.1` build every platform but never publish, even if a manual run asks to publish. The candidate version is
applied only in the disposable CI checkout, so the real version stays unchanged until the release script bumps it.
The deploy workflow excludes every tag containing a hyphen and also refuses manual deploys from such tags.
Re-running a stable publishing run replaces the release's files and notes and publishes a draft left by a broken upload.

To build a tag again without publishing (for example to test the pipeline): Actions → **Release** → **Run workflow**,
type the tag and leave "Publish" off (the default). The files stay on the run as artifacts for 90 days.

```sh
gh workflow run release.yml -f tag=v0.5.0-rc.1 -f publish=false
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
node --test scripts/release/*.test.mjs         # release notes, policy, web bundle, OTA publish
actionlint .github/workflows/*.yml             # https://github.com/rhysd/actionlint (runs shellcheck too)
```

## Re-deploying without a new version

In the public repository: GitHub → Actions → **Deploy** → **Run workflow**, then pick the tag to deploy under "Use workflow from" (for example `v0.1.0` to roll back to it, or the latest tag to re-deploy it). Or from a terminal:

```sh
gh workflow run deploy.yml -R patalbansishashank/vitals --ref v0.1.0
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

- Steps: checkout, pnpm 11 (`pnpm/action-setup` with `version: 11`), Node from `.nvmrc` (`actions/setup-node`, pnpm cache), `pnpm install --frozen-lockfile`, `pnpm build`, then the Netlify CLI (`netlify-cli` 27 through `pnpm dlx`) uploads `dist/` with `--prod --no-build`. `--no-build` stops the CLI from running `pnpm build` a second time; `netlify.toml` (SPA fallback, cache and security headers) is still applied.
- `netlify-cli` ships two binaries (`netlify` and `ntl`), so with pnpm 11 the command is `pnpm --package=netlify-cli@27 dlx netlify deploy ...`; `pnpm dlx netlify-cli@27 deploy ...` fails with `ERR_PNPM_DLX_MULTIPLE_BINS`.
- `package.json` has no `packageManager` field, so every pnpm setup step pins the major with `version: 11`. If the field
  is added, drop `version:` from those steps in the same commit: `pnpm/action-setup` stops when it is given two versions.

## History

- Historical policy (superseded by the credential-free gate above): on 2026-10-01 a first version also ran typecheck, lint, build and the full test suite on GitHub for every push to `main` (`ci.yml`). On the 2-core runner the test step was still running after 23 minutes, so the run was cancelled and the owner moved the gate to the local `pnpm release` script. `ci.yml` was removed then. It came back later as the credential-free validation described at the top of this file,
  split into bounded parallel jobs.
