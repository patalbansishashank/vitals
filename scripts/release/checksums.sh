#!/usr/bin/env bash
# Writes SHA256SUMS.txt in <dir>: one sha256sum line per release file, names without a directory, sorted by name.
# Skipped: SHA256SUMS.txt itself and updater metadata (*.yml, *.blockmap). Fails when no file is left.
# Usage: scripts/release/checksums.sh <dir>
set -euo pipefail

if [ "$#" -ne 1 ] || [ ! -d "$1" ]; then
  echo "usage: $0 <dir>" >&2
  exit 2
fi

cd "$1"
export LC_ALL=C

files=()
while IFS= read -r -d '' f; do
  files+=("${f#./}")
done < <(find . -maxdepth 1 -type f ! -name SHA256SUMS.txt ! -name '*.yml' ! -name '*.blockmap' -print0 | sort -z)

if [ "${#files[@]}" -eq 0 ]; then
  echo "checksums.sh: no files to hash in $PWD" >&2
  exit 1
fi

sha256sum -- "${files[@]}" > SHA256SUMS.txt
cat SHA256SUMS.txt
