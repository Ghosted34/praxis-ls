#!/usr/bin/env bash
# Scan the ENTIRE git history for committed credentials.
#
#   bash scripts/scan-history-secrets.sh            # summary
#   bash scripts/scan-history-secrets.sh --verbose  # every commit x file hit
#
# ---------------------------------------------------------------------------
# Audit TC-E4 / TC-CI5 / SEC-C1 (2026-08-04).
#
# The CI secret scan runs `git grep` over the WORKING TREE only. Deleting a
# credential from the tree makes CI green while every clone of the repository
# still contains it, which is the state this repo is in right now: the
# credentials removed on 2026-08-04 are present in ~177 commits of history.
#
# This script answers the question the purge decision needs: what is actually
# in there, and since when. It is read-only — it changes nothing.
#
# Run it locally, not in CI: a full-history scan is O(commits x tree) and takes
# minutes on a repo this size. Making it a blocking gate would add minutes to
# every push to catch something that, by definition, was committed long ago.
# ---------------------------------------------------------------------------
#
# WHAT TO DO WITH THE OUTPUT
#
#   1. ROTATE FIRST. Every value this prints is compromised. Rotation is what
#      makes the history harmless; the purge is hygiene that follows it.
#   2. THEN decide on a purge. `git filter-repo --replace-text` rewrites every
#      commit SHA from the first offending commit onward. That invalidates every
#      existing clone, every open PR, and every deploy pinned to a SHA. It is a
#      scheduled team event, not a quiet Tuesday change.
#   3. If the repository is or ever was PUBLIC, assume the values were scraped
#      within minutes of the push and treat rotation as an incident, not a task.
#
set -uo pipefail
cd "$(dirname "$0")/.."

VERBOSE=0
[ "${1:-}" = "--verbose" ] && VERBOSE=1

# Same shapes as the CI scan, plus a couple that only matter historically.
PATTERNS=(
  'sk-[A-Za-z0-9]{20,}'
  'AIza[0-9A-Za-z_-]{35}'
  'gsk_[A-Za-z0-9]{40,}'
  'xox[baprs]-[A-Za-z0-9-]{10,}'
  'ghp_[A-Za-z0-9]{36}'
  'AKIA[0-9A-Z]{16}'
  'BEGIN [A-Z ]*PRIVATE KEY'
  '\$DB_(PASS|PASSWORD)[[:space:]]*=[[:space:]]*['"'"'"][^'"'"'"]{3,}'
  '(SMTPPassword|->Password)[[:space:]]*=[[:space:]]*['"'"'"][^'"'"'"]{3,}'
  '(postgres(ql)?|mysql|mongodb|amqp)://[A-Za-z0-9_.-]+:[A-Za-z0-9_%.!*-]{4,}@'
)
PLACEHOLDER='(__[A-Za-z_]+__|changeme|change-me|dev-[a-z-]*secret|YOUR_|example\.com|<[a-z_]+>|placeholder|xxxx|\*\*\*|user:pass|user:password|username:password)'

TOTAL_COMMITS="$(git rev-list --count --all)"
echo "Scanning $TOTAL_COMMITS commits across all refs…"
echo

FOUND_ANY=0
for p in "${PATTERNS[@]}"; do
  # -e is required: a pattern beginning with '-' is otherwise parsed as an option
  # and the scan silently finds nothing. That bug shipped once already.
  HITS="$(git grep -lIE -e "$p" $(git rev-list --all) -- \
            ':!*.lock' ':!package-lock.json' ':!**/vendor/**' ':!**/node_modules/**' \
            ':!.github/workflows/ci.yaml' ':!scripts/scan-history-secrets.sh' \
          2>/dev/null | grep -vEi "$PLACEHOLDER" || true)"

  [ -z "$HITS" ] && continue
  FOUND_ANY=1

  # `git grep <rev>` prints "<sha>:<path>" — collapse to distinct files and the
  # commit range they span, which is what the purge scope depends on.
  FILES="$(echo "$HITS" | awk -F: '{ $1=""; sub(/^ /,""); print }' | sort -u)"
  NCOMMITS="$(echo "$HITS" | awk -F: '{print $1}' | sort -u | wc -l | tr -d ' ')"

  echo "── pattern: $p"
  echo "   present in $NCOMMITS commit(s), across these paths:"
  echo "$FILES" | sed 's/^/     /'

  while IFS= read -r f; do
    [ -z "$f" ] && continue
    ADDED="$(git log --format='%h %ad %an' --date=short --diff-filter=A -- "$f" 2>/dev/null | tail -1)"
    [ -n "$ADDED" ] && echo "     first added: $ADDED  ($f)"
  done <<< "$FILES"

  [ "$VERBOSE" = "1" ] && echo "$HITS" | sed 's/^/     /'
  echo
done

if [ "$FOUND_ANY" -eq 0 ]; then
  echo "No credential patterns found in history."
  exit 0
fi

cat <<'NOTE'
──────────────────────────────────────────────────────────────────────────────
Findings above are IN HISTORY. Removing them from the working tree did not
remove them from any clone.

  1. Rotate every value at its provider. This is the fix.
  2. Only then consider a purge:

       pip install git-filter-repo
       # build replacements.txt: one `literal-value==>__REMOVED__` per line
       git filter-repo --replace-text replacements.txt
       # coordinate: every SHA changes, every clone must be re-cloned

  3. Re-run this script afterwards to confirm.

Exit code is 1 so this is usable as a pre-purge check; it is NOT wired into CI
on purpose (see the header).
──────────────────────────────────────────────────────────────────────────────
NOTE
exit 1
