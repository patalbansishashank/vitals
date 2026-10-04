#!/usr/bin/env bash
# Publish a snapshot of this repository to the public repository.
#
#   scripts/publish/publish-public.sh "<message>" [--tag vX.Y.Z] [--from <commit>] [--dry-run]
#
# The private repository keeps its full history. The public repository (git remote `public`) only ever receives
# snapshot commits: one commit per publish, whose tree is the given commit (default HEAD) minus the paths listed in
# scripts/publish/exclude.txt, with the previous public head as its parent. Nothing else is ever pushed there.
#
# What happens, in order:
#   1. checks: a clean argument list, the `public` remote exists and is not `origin`, the GitHub user id is known;
#   2. the public tree is built in a temporary index (read the source commit, drop the excluded paths, write-tree);
#   3. a commit object is made with `git commit-tree`, authored by the GitHub no-reply identity;
#   4. that commit is checked out into a temporary worktree and the hygiene guards run on it: the passcode guard,
#      the ring-brand guard, the private-names guard, a scan for secret-shaped strings;
#   5. only when every guard passes, the commit is pushed to `public` main (fast-forward) and, with --tag, an
#      annotated tag is pushed to the same commit (kept locally as `public/<tag>` so the mapping is on record).
#
# The snapshot is taken from the checkout this script lives in (default HEAD of that checkout), and the exclusions are
# read from the source commit's own scripts/publish/exclude.txt.
#
# Needs: git, gh (logged in as the owner of the public repository), node_modules installed at the repository root, and
# the git-ignored qa/local.config.json (or VITALS_QA_CONFIG) with `neverPublic` and `ownerPersonId` for the guard.
set -euo pipefail
# Pathspec behaviour must not depend on the caller's environment (the exclusions below rely on glob pathspecs).
unset GIT_LITERAL_PATHSPECS GIT_GLOB_PATHSPECS GIT_NOGLOB_PATHSPECS GIT_ICASE_PATHSPECS

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

MESSAGE="${1:-}"; shift || true
# A lone flag must never become the commit message.
case "$MESSAGE" in ''|-*) usage ;; esac
TAG=""; FROM="HEAD"; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) { [ $# -ge 2 ] && [ -n "$2" ]; } || usage; TAG="$2"; shift 2 ;;
    --from) { [ $# -ge 2 ] && [ -n "$2" ]; } || usage; FROM="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done
if [ -n "$TAG" ] && ! [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$ ]]; then
  echo "tag must look like v1.2.3: $TAG" >&2; exit 2
fi

ROOT="$(git -C "$(dirname "$(readlink -f "$0")")" rev-parse --show-toplevel)"
cd "$ROOT"
PUBLIC_REMOTE="${PUBLIC_REMOTE:-public}"
PUBLIC_BRANCH="${PUBLIC_BRANCH:-main}"

say() { printf '\033[1m» %s\033[0m\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }

# ---- 1. checks -------------------------------------------------------------------------------------------------
SRC="$(git rev-parse --verify "${FROM}^{commit}")" || die "not a commit: $FROM"
PUBLIC_URL="$(git remote get-url "$PUBLIC_REMOTE" 2>/dev/null)" || die "remote '$PUBLIC_REMOTE' is not set; add it first (see scripts/publish/README.md)"
PUBLIC_PUSH_URL="$(git remote get-url --push "$PUBLIC_REMOTE")"
ORIGIN_URL="$(git remote get-url origin 2>/dev/null || true)"
norm() { printf '%s' "$1" | sed -E 's#/+$##; s#\.git$##' | tr 'A-Z' 'a-z'; }
# Check both the fetch URL and the URL `git push` actually uses (remote.<name>.pushurl may differ).
for u in "$PUBLIC_URL" "$PUBLIC_PUSH_URL"; do
  [ "$(norm "$u")" != "$(norm "$ORIGIN_URL")" ] || die "remote '$PUBLIC_REMOTE' points at origin ($ORIGIN_URL); refusing"
  case "$(norm "$u")" in *private*) die "remote '$PUBLIC_REMOTE' looks private ($u); refusing" ;; esac
done
[ -d "$ROOT/node_modules/.bin" ] || die "node_modules missing; run pnpm install first"
say "snapshot source: ${SRC:0:12} ($(git log -1 --format=%s "$SRC" | cut -c1-80)) from $ROOT"
EXCLUDE_TEXT="$(git show "$SRC:scripts/publish/exclude.txt" 2>/dev/null)" || die "${SRC:0:12} has no scripts/publish/exclude.txt"

# The owner's own values for the private-names guard live outside the repository (see docs/QA.md).
OWN_CFG="${VITALS_QA_CONFIG:-$ROOT/qa/local.config.json}"
[ -f "$OWN_CFG" ] || die "$OWN_CFG is missing; the private-names guard needs its neverPublic and ownerPersonId (docs/QA.md)"
OWN_WORDS="$(node -e '
  const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const w = (Array.isArray(c.neverPublic) ? c.neverPublic : []).filter((x) => typeof x === "string" && x.length >= 3);
  if (typeof c.ownerPersonId === "string" && /^[0-9a-f]{16}$/i.test(c.ownerPersonId) && !/^0+$/.test(c.ownerPersonId)) w.push(c.ownerPersonId);
  process.stdout.write(w.join("\n"));' "$OWN_CFG")" || die "cannot read $OWN_CFG"
[ -n "$OWN_WORDS" ] || die "$OWN_CFG has no neverPublic words; refusing to publish without the owner's own checks"
export VITALS_QA_CONFIG="$OWN_CFG"

GH_USER="${GH_USER:-$(gh api user --jq .login)}" || die "gh is not logged in"
GH_USER_ID="${GH_USER_ID:-$(gh api user --jq .id)}" || die "cannot read the GitHub user id"
[[ "$GH_USER_ID" =~ ^[0-9]+$ ]] || die "odd GitHub user id"
IDENTITY_NAME="$GH_USER"
IDENTITY_EMAIL="${GH_USER_ID}+${GH_USER}@users.noreply.github.com"
# The identity is permanent in the public history: it must be the public repository's owner.
case "$PUBLIC_PUSH_URL" in
  *github.com[:/]*)
    OWNER="${PUBLIC_PUSH_URL#*github.com[:/]}"; OWNER="${OWNER%%/*}"
    [ "$(norm "$OWNER")" = "$(norm "$GH_USER")" ] || die "gh is logged in as $GH_USER but $PUBLIC_REMOTE belongs to $OWNER" ;;
esac

# Dates are written in UTC so the commits do not carry the local time zone.
# The commit message and the tag name are public text: run the same brand check on them (needle built from char codes).
BRAND="$(printf '\107\141\142\151\164')"
if grep -qi -e "$BRAND" <<<"$MESSAGE $TAG"; then die "the message or tag contains the ring's retail brand"; fi
rc=0; grep -qiwF -f <(printf '%s\n' "$OWN_WORDS") <<<"$MESSAGE" || rc=$?
case $rc in 0) die "the message holds one of the owner's private words" ;; 1) ;; *) die "message check failed (exit $rc)" ;; esac
if [ -n "$TAG" ]; then
  rc=0; git ls-remote --exit-code --tags "$PUBLIC_REMOTE" "refs/tags/$TAG" >/dev/null || rc=$?
  case $rc in 0) die "tag $TAG already exists on $PUBLIC_REMOTE" ;; 2) ;; *) die "cannot read $PUBLIC_REMOTE tags (exit $rc)" ;; esac
  ! git show-ref -q --verify "refs/tags/public/$TAG" || die "local tag public/$TAG already exists"
fi

# Previous public head (if any) becomes the parent.
# `ls-remote --exit-code` exits 2 when the branch is absent; any other failure (network, auth) must stop here rather
# than be read as "no public history yet".
PARENT=""; rc=0
git ls-remote --exit-code --heads "$PUBLIC_REMOTE" "$PUBLIC_BRANCH" >/dev/null || rc=$?
case $rc in
  0) git fetch -q "$PUBLIC_REMOTE" "$PUBLIC_BRANCH"
     PARENT="$(git rev-parse FETCH_HEAD)"
     say "public $PUBLIC_BRANCH is at ${PARENT:0:12}; the new snapshot will follow it" ;;
  2) say "public $PUBLIC_BRANCH does not exist yet; this will be the first commit" ;;
  *) die "cannot read $PUBLIC_REMOTE (git ls-remote exit $rc)" ;;
esac

# ---- 2. the public tree ----------------------------------------------------------------------------------------
TMP="$(mktemp -d "${TMPDIR:-/tmp}/publish-public.XXXXXX")"
WT=""
cleanup() {
  if [ -n "$WT" ] && [ -d "$WT" ]; then git worktree remove --force "$WT" >/dev/null 2>&1 || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

mapfile -t PATTERNS < <(printf '%s\n' "$EXCLUDE_TEXT" | sed -e 's/[[:space:]]*#.*$//' -e '/^[[:space:]]*$/d' -e 's#/$##')
[ "${#PATTERNS[@]}" -gt 0 ] || die "exclude.txt has no patterns"

export GIT_INDEX_FILE="$TMP/index"
git read-tree "$SRC"
# A pattern that matches nothing is either a typo (and the path it meant would ship) or a never-tracked file.
for p in "${PATTERNS[@]}"; do
  [ -n "$(git ls-files -- "$p")" ] || echo "note: exclude pattern matches nothing in ${SRC:0:12}: $p" >&2
done
git rm -r -q -f --cached --ignore-unmatch -- "${PATTERNS[@]}"
TREE="$(git write-tree)"
unset GIT_INDEX_FILE
N_SRC="$(git ls-tree -r --name-only "$SRC" | wc -l)"
N_PUB="$(git ls-tree -r --name-only "$TREE" | wc -l)"
say "tree ${TREE:0:12}: $N_PUB files kept of $N_SRC ($((N_SRC - N_PUB)) excluded)"

# Nothing matching an exclude pattern may survive (belt and braces for pattern typos). Bash glob matching: `*` in a
# pattern also crosses `/`, like git's own pathspec matching above.
while IFS= read -r path; do
  for p in "${PATTERNS[@]}"; do
    # shellcheck disable=SC2053
    if [[ "$path" == $p || "$path" == $p/* ]]; then die "excluded path still present in the public tree: $path ($p)"; fi
  done
done < <(git ls-tree -r --name-only "$TREE")

# ---- 3. the snapshot commit -------------------------------------------------------------------------------------
if [ -n "$PARENT" ] && [ "$(git rev-parse "$PARENT^{tree}")" = "$TREE" ]; then
  die "the public tree is identical to the current public head; nothing to publish"
fi
BODY="$(printf '%s\n\nSnapshot of %s.' "$MESSAGE" "${SRC:0:12}")"
COMMIT_ARGS=()
[ -n "$PARENT" ] && COMMIT_ARGS+=(-p "$PARENT")
# --no-gpg-sign: a local signing key would put its user id into the public commit.
NEW="$(printf '%s\n' "$BODY" | TZ=UTC GIT_AUTHOR_NAME="$IDENTITY_NAME" GIT_AUTHOR_EMAIL="$IDENTITY_EMAIL" \
  GIT_COMMITTER_NAME="$IDENTITY_NAME" GIT_COMMITTER_EMAIL="$IDENTITY_EMAIL" \
  git commit-tree --no-gpg-sign "$TREE" "${COMMIT_ARGS[@]}")"
say "snapshot commit ${NEW:0:12} by $IDENTITY_NAME <$IDENTITY_EMAIL>"

# ---- 4. guards on the exact tree that will be pushed -------------------------------------------------------------
WT="$TMP/wt"
git worktree add -q --detach "$WT" "$NEW"
# vitest silently runs whatever subset of its file filters exists; a missing guard file must stop the publish.
for f in tests/publicHygiene/ringBrand.test.ts tests/publicHygiene/privateNames.test.ts \
         src/biometrics/core/ble/jstyle2301/__tests__/passcode.test.ts; do
  [ -f "$WT/$f" ] || die "guard missing from the public tree: $f"
done
ln -s "$ROOT/node_modules" "$WT/node_modules"
# Workspace packages resolve their own dependencies through their node_modules; link them too so vitest can load
# package tests if the guard set ever grows.
for d in "$ROOT"/packages/*/node_modules "$ROOT"/apps/*/node_modules; do
  [ -d "$d" ] || continue
  rel="${d#"$ROOT"/}"
  ln -s "$d" "$WT/$rel"
done

say "guards: passcode, ring brand, private names"
( cd "$WT" && TMPDIR="$TMP" VITALS_QA_CONFIG="$OWN_CFG" "$ROOT/node_modules/.bin/vitest" run --root "$WT" --maxWorkers=2 \
    tests/publicHygiene src/biometrics/core/ble/jstyle2301/__tests__/passcode.test.ts ) \
  || die "a hygiene guard failed on the public tree; nothing was pushed"

say "guards: brand grep and secret-shaped strings"
# Exit codes are read explicitly: grep/git grep exit 0 = found, 1 = nothing found, anything else is an error and must
# never count as clean. No pipelines here: under pipefail a SIGPIPE from `head` would turn "found" into "clean".
# Same false-positive filter as the guard test: the letters also sit inside "megabit" and "gigabit".
rc=0; HITS="$(git -C "$WT" grep -I -i -l -P "(?<!me|gi)$BRAND" -- . ':!node_modules')" || rc=$?
case $rc in 0) printf '%s\n' "$HITS" >&2; die "brand found in the public tree" ;; 1) ;; *) die "brand grep failed (exit $rc)" ;; esac
FILES="$(git -C "$WT" ls-files)" || die "cannot list the public tree"
[ -n "$FILES" ] || die "the public tree lists no files"
rc=0; grep -i -e "$BRAND" <<<"$FILES" >&2 || rc=$?
case $rc in 0) die "brand found in a public file name" ;; 1) ;; *) die "file-name brand grep failed (exit $rc)" ;; esac
SECRET_RE='(ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{80,}|nfp_[A-Za-z0-9]{40,}|AKIA[0-9A-Z]{16}|sk-ant-[a-z]{2,8}[0-9]{2}-[A-Za-z0-9_-]{40,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY)'
rc=0; HITS="$(git -C "$WT" grep -I -n -E -e "$SECRET_RE" -- . ':!node_modules')" || rc=$?
case $rc in
  0) head -20 <<<"$HITS" | cut -d: -f1,2 >&2 || true; die "secret-shaped strings found (file:line above); nothing was pushed" ;;
  1) ;;
  *) die "secret grep failed (exit $rc)" ;;
esac
for f in LICENSE README.md SECURITY.md; do [ -f "$WT/$f" ] || die "public tree lacks $f"; done
say "all guards passed"

# ---- 5. push ----------------------------------------------------------------------------------------------------
if [ "$DRY" = 1 ]; then
  say "dry run: would push ${NEW:0:12} to $PUBLIC_REMOTE $PUBLIC_BRANCH${TAG:+ and tag $TAG}"
  echo "$NEW"
  exit 0
fi
REFSPECS=("$NEW:refs/heads/$PUBLIC_BRANCH")
if [ -n "$TAG" ]; then
  LOCAL_TAG="public/$TAG"
  # The annotated tag object is written by hand: its `tag` line must be the public name (not public/<tag>), its tagger
  # the no-reply identity in UTC, and it must never be signed with a local key.
  TAG_OBJ="$(printf 'object %s\ntype commit\ntag %s\ntagger %s <%s> %s +0000\n\n%s\n' \
    "$NEW" "$TAG" "$IDENTITY_NAME" "$IDENTITY_EMAIL" "$(date -u +%s)" "$TAG" | git mktag)"
  git update-ref "refs/tags/$LOCAL_TAG" "$TAG_OBJ"
  REFSPECS+=("$TAG_OBJ:refs/tags/$TAG")
fi
# Branch and tag land together or not at all; no other ref (push.followTags) may ride along.
git push --atomic --no-follow-tags "$PUBLIC_REMOTE" "${REFSPECS[@]}"
say "pushed ${NEW:0:12} to $PUBLIC_PUSH_URL ($PUBLIC_BRANCH)${TAG:+ with tag $TAG (kept locally as $LOCAL_TAG)}"
echo "$NEW"
