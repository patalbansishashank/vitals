# Publishing the source

The private repository (`origin`, `patalbansishashank/vitals-private`) keeps the full history. The public repository
(`public`, `patalbansishashank/vitals`) receives **snapshot commits** only: one commit per publish, whose tree is a
chosen commit minus the paths in `exclude.txt`, parented on the previous public head. The public history is therefore
short, linear and free of the private notes, QA output and screenshots.

## Publish a snapshot

```sh
scripts/publish/publish-public.sh "What changed, in one line" [--tag v0.5.0] [--from <commit>] [--dry-run]
```

The script snapshots the checkout it lives in (default `HEAD`; `--from` picks another commit) and leaves out the paths
in that commit's own `scripts/publish/exclude.txt`. It builds the public tree in a temporary index, makes the commit
with `git commit-tree` under the GitHub no-reply identity (`<id>+<login>@users.noreply.github.com`, read from
`gh api user`, which must be the public repository's owner), dates in UTC, checks that exact tree out into a temporary
worktree and runs the guards on it: the passcode guard, the ring-brand guard, the private-names guard
(`tests/publicHygiene`), a grep for secret-shaped strings. Only when all pass does it push to `public` main; with
`--tag` it also pushes an annotated tag to the same commit (tagger = the same identity; kept locally as
`public/<tag>`), and refuses a tag that already exists. `--dry-run` stops before the push. The commit id is printed last.

The private-names guard needs the owner's own values (`neverPublic`, `ownerPersonId`) from the git-ignored
`qa/local.config.json` of that checkout (or the file named by `VITALS_QA_CONFIG`); the script refuses to run without
them, and checks the commit message against them too.

The one-time setup is `git remote add public https://github.com/patalbansishashank/vitals.git`. The script refuses to
run when `public` resolves to the same URL as `origin` or contains "private". Never push any branch to `public` by
hand.

## What stays private

`exclude.txt` lists the paths left out (plans, work-package notes, hand-off, QA results and screenshots, QA findings).
Everything else that is tracked goes public, so the hygiene rules apply to the whole tree: no ring retail brand, no
tailnet names or addresses, no personal e-mail addresses, no real names, no personal health data, no secrets. Real QA
values live in the git-ignored `qa/local.config.json` (shape: `qa/local.config.example.json`, see `docs/QA.md`).

## Releases

Release tags are pushed to the public repository through this script (`--tag`), which triggers
`.github/workflows/deploy.yml` there. The private repository's deploy workflow is disabled.
