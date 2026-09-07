#!/usr/bin/env bash
# Push templates/perfect-marine-solution-iso to kckimmarine/perfect-marine-solution-iso
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-/tmp/perfect-marine-solution-iso}"
REMOTE="${ISO_REPO_REMOTE:-https://github.com/kckimmarine/perfect-marine-solution-iso.git}"

"$ROOT/scripts/bootstrap-perfect-marine-iso-repo.sh" "$TARGET"
cp "$ROOT/templates/perfect-marine-solution-iso/START-HERE.md" "$TARGET/START-HERE.md"

cd "$TARGET"
if [[ ! -d .git ]]; then
  git init
  git branch -M main
fi
git add -A
if git diff --cached --quiet; then
  echo "No changes to commit."
else
  git commit -m "Sync from thevesselcode-pms templates"
fi
git remote remove origin 2>/dev/null || true
git remote add origin "$REMOTE"

echo "Pushing to $REMOTE ..."
git push -u origin main --force
echo "Done: $REMOTE"
