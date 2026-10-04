# Releasing

Vitals is deployed to production (https://vitals.creative.desi, Netlify site `creative-vitals`) by one GitHub Actions workflow, and only when a version tag is pushed. The owner decides when a version is release-worthy.

| Event | What happens on GitHub |
|---|---|
| Push to `main` (or any branch), pull request | **Nothing.** No workflow runs, nothing is deployed. |
| Push of a tag `vX.Y.Z` | `.github/workflows/deploy.yml`: install, build, production deploy of `dist/` to Netlify |
| Manual run ("Run workflow") | `.github/workflows/deploy.yml` for the branch or tag picked in "Use workflow from" |

The quality gate (typecheck, lint, the full test suite) runs **locally**, inside `pnpm release`, before the version tag exists. The GitHub workflow does not run tests: it only builds and deploys. Production deploys come only from that workflow; nobody runs `netlify deploy --prod` from a laptop, and Netlify does not build from Git on its own (the site is not connected to the repository).

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
```

The run's summary page shows the production URL, the unique deploy URL, the Netlify deploy id and a link to the Netlify deploy log.

`v0.1.0` was the one exception to this process: `package.json` already said `0.1.0` at the initial import and the full suite had been run on that tree, so the tag was created directly with `git tag -a v0.1.0 -m "Vitals v0.1.0"`. Do not tag by hand otherwise; `pnpm version` keeps the tag and `package.json` in agreement.

## The test gate: `pnpm test:release`

About a dozen test files measure time (module micro-benchmarks, the engine's run-time budget, the safety module's cost) or wait on the UI with timeouts. They pass on an idle machine but can fail when all ~180 test files run in parallel and saturate the CPU (Vitest's default is one worker per core but one). Their assertions are not loosened; instead `test:release` runs the suite in two passes:

1. Everything except the timing files, in parallel on half the cores: `vitest run --maxWorkers=50% --exclude "**/*bench*.test.ts" --exclude "**/safety.props.test.ts" --exclude "**/validation/invariants.test.ts" --exclude "**/evidence/__tests__/page.test.tsx"` (170 files)
2. The timing files, one at a time: `vitest run --no-file-parallelism bench safety.props.test validation/invariants.test evidence/__tests__/page.test` (13 files)

Together the two passes cover every test file exactly once. The 181 known model misses are written as expected failures and do not fail the run. Measured on the 32-thread dev PC (2026-10-01): pass 1 about 175 s (the same wall time as with every core, because one long file sets the pace), pass 2 about 10 s, all green. With every core, a parallel run failed the timing files and once timed out an unrelated UI test (`src/features/body/__tests__/energyUnit.test.tsx`, 5 s test timeout); half the workers removed that.

`pnpm test` (one parallel pass over everything, every core) still works for day-to-day use; if it reports failures only in timing-sensitive files or as UI test timeouts, re-run those files in isolation (e.g. `pnpm vitest run src/engine/model/fasting/fasting.bench.test.ts`) before treating them as real. If `pnpm release` itself stops on such a flake, run it again: nothing was committed or tagged.

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

To rotate the token: create a new one in Netlify (User settings → Applications → Personal access tokens), run `gh secret set NETLIFY_AUTH_TOKEN` and paste it at the prompt, then revoke the old one.

## How the deploy workflow works

- Steps: checkout, pnpm 11 (`pnpm/action-setup`, `version: 11`), Node from `.nvmrc` (`actions/setup-node`, pnpm cache), `pnpm install --frozen-lockfile`, `pnpm build`, then the Netlify CLI (`netlify-cli` 27 through `pnpm dlx`) uploads `dist/` with `--prod --no-build`. `--no-build` stops the CLI from running `pnpm build` a second time; `netlify.toml` (SPA fallback, cache and security headers) is still applied.
- `netlify-cli` ships two binaries (`netlify` and `ntl`), so with pnpm 11 the command is `pnpm --package=netlify-cli@27 dlx netlify deploy ...`; `pnpm dlx netlify-cli@27 deploy ...` fails with `ERR_PNPM_DLX_MULTIPLE_BINS`.
- If a `packageManager` field is ever added to `package.json`, remove `version:` from the pnpm setup step.

## History

- 2026-10-01: a first version also ran typecheck, lint, build and the full test suite on GitHub for every push to `main` (`ci.yml`). On the 2-core runner the test step was still running after 23 minutes, so the run was cancelled and the owner moved the gate to the local `pnpm release` script. `ci.yml` was removed; GitHub now only builds and deploys tags.
