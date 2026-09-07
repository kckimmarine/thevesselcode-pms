#!/usr/bin/env bash
# Create a standalone PERFECT MARINE SOLUTION ISO repo from git history (one-time).
# Usage: ./scripts/bootstrap-perfect-marine-iso-repo.sh /path/to/new-repo-dir
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:?Usage: $0 /path/to/perfect-marine-solution-iso}"
REF="${ISO_TEMPLATE_REF:-cursor/pms-iso-audit-folder-1cae}"
mkdir -p "$TARGET"
cd "$ROOT"
if git cat-file -e "$REF:pms-iso-audit/README.md" 2>/dev/null; then
  git archive "$REF" pms-iso-audit | tar -x -C "$TARGET" --strip-components=1
else
  echo "Ref $REF has no pms-iso-audit/. Checkout that branch or set ISO_TEMPLATE_REF."
  exit 1
fi
cat > "$TARGET/AGENTS.md" << 'EOF'
# AGENTS.md — PERFECT MARINE SOLUTION ISO Audit

ISO certification documents only. Not TVC-PMS app code.
Repository: separate from kckimmarine/thevesselcode-pms.
EOF
echo "Created $TARGET from $REF"
echo "Next:"
echo "  cd $TARGET && git init && git add -A && git commit -m 'Initial ISO audit structure'"
echo "  gh repo create kckimmarine/perfect-marine-solution-iso --private --source=. --push"
