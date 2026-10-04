# Deploy (Netlify)

Static Vite build (`dist/`) hosted on Netlify. Build, header and redirect config lives in `netlify.toml` at the repo root. Production deploys come only from GitHub Actions on version tags; the release process is in [`RELEASING.md`](RELEASING.md).

## Site

| | |
|---|---|
| Netlify team | `<your-team>` (Free plan) |
| Site id | `<site-id>` |
| Site name | `creative-vitals` |
| netlify.app URL | https://creative-vitals.netlify.app (serves the same deploy; not redirected to the custom domain) |
| Primary custom domain | https://vitals.creative.desi |
| Admin | https://app.netlify.com/projects/creative-vitals |
| Git connection | none: Netlify does not build from the repository; GitHub Actions uploads the built `dist/` |

The project folder is linked to the site through `.netlify/state.json`, which is gitignored. To re-link a fresh checkout, run `netlify link --id <site-id>`.

## DNS

- Netlify DNS zone `example.com` (your own domain; `vitals.creative.desi` is the project site).
- The zone also holds 13 records (MX/TXT for mail, and A/CNAME records for other self-hosted services). **They belong to other things and must not be modified.**
- The site uses exactly one record, created by Netlify when the custom domain was attached:
  - `vitals.creative.desi`, type `NETLIFY`, value `creative-vitals.netlify.app`, TTL 3600, record id `<record-id>`
- The record for the site's previous name has been removed. The zone holds 14 records: the 13 others plus this one.

## TLS

- Certificate: the Let's Encrypt wildcard certificate for `*.example.com` (and `example.com`), issued and auto-renewed by Netlify. Nothing to do by hand. At the time of writing it expires 2026-11-18 and renews automatically before then.
- HTTPS is forced: `http://` requests get a 301 to `https://`.
- `netlify.toml` sends `Strict-Transport-Security: max-age=31536000; includeSubDomains` on every path. Because of `includeSubDomains`, browsers that visit the site will insist on HTTPS for any `*.vitals.creative.desi` host for a year (it does not affect the parent domain or its other subdomains). The header is not preloaded.

## What `netlify.toml` applies

- SPA fallback: `/*` to `/index.html` with status 200, so deep links and refreshes on nested routes work.
- `Cache-Control: public, max-age=31536000, immutable` for hashed files under `/assets/*`.
- Security headers on `/*`: HSTS (above), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and a Content-Security-Policy that allows only same-origin scripts, workers, fonts and connections.
- The `[build]` block (`pnpm build`, publish `dist`, Node 22) documents the build. CI builds before deploying and passes `--no-build`, so Netlify never runs it.

## CI deploy

One GitHub Actions workflow, `.github/workflows/deploy.yml`. It runs only on a pushed tag `vX.Y.Z` (or a manual "Run workflow"); pushes to `main` run nothing. Steps: checkout, pnpm 11 and the Node version from `.nvmrc`, `pnpm install --frozen-lockfile`, `pnpm build`, then:

```sh
pnpm --package=netlify-cli@27 dlx netlify deploy --prod --no-build --dir=dist \
  --site "$NETLIFY_SITE_ID" --auth "$NETLIFY_AUTH_TOKEN" --message "Release ${GITHUB_REF_NAME}"
```

Both values come from the repository secrets `NETLIFY_SITE_ID` and `NETLIFY_AUTH_TOKEN`. Deploys share the concurrency group `production` and queue rather than cancel each other. The run summary lists the deploy id, the unique deploy URL and the Netlify log link. On Netlify the deploy title is `Release vX.Y.Z`.

The workflow does not typecheck, lint or test. That gate runs locally in `pnpm release <patch|minor|major>`, before the version commit and tag are created; then `git push --follow-tags origin main` pushes the tag that deploys. Details, re-deploys and rollbacks are in [`RELEASING.md`](RELEASING.md).

## Credentials on this PC

- Netlify personal access token: fish universal variable `NETLIFY_AUTH_TOKEN`, also stored in `~/.config/netlify/config.json`. The CLI reads that file automatically. The same token is stored as the GitHub repository secret `NETLIFY_AUTH_TOKEN`.
- Never commit the token or paste it anywhere. To use it from bash, run `export NETLIFY_AUTH_TOKEN=$(fish -c 'echo $NETLIFY_AUTH_TOKEN')`.

## Netlify CLI

Installed globally with pnpm (`netlify-cli` 27.10.2), for inspection and draft previews:

```fish
pnpm setup                 # once; adds PNPM_HOME (~/.local/share/pnpm) to ~/.config/fish/config.fish
pnpm add -g netlify-cli    # binary lands in ~/.local/share/pnpm/bin/netlify
netlify --version
netlify status             # shows the logged-in account and the linked site
```

Do not run `netlify deploy --prod` locally; production deploys come from the tag-gated workflow. For a throwaway preview of a local build, a draft deploy is fine (it gets its own URL and does not touch production):

```fish
pnpm build
netlify deploy --no-build --dir=dist
```
