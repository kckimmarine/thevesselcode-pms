#!/usr/bin/env bash
# Bootstrap standalone PERFECT MARINE SOLUTION ISO repo (online mode).
# Usage: ./scripts/bootstrap-perfect-marine-iso-repo.sh /path/to/new-repo-dir
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:?Usage: $0 /path/to/perfect-marine-solution-iso}"
SRC="$ROOT/templates/perfect-marine-solution-iso"
if [[ ! -d "$SRC" ]]; then
  echo "Missing $SRC"
  exit 1
fi
mkdir -p "$TARGET"
cp -a "$SRC/." "$TARGET/"
chmod +x "$TARGET/scripts/"*.mjs 2>/dev/null || true
echo "Created $TARGET (online mode: portal + Supabase)"
echo ""
echo "Next:"
echo "  cd $TARGET"
echo "  npm install"
echo "  npm run setup:supabase"
echo "  # Edit portal/js/config.js with Supabase URL + anon key"
echo "  npm start   # http://localhost:3010"
echo ""
echo "  git init && git add -A && git commit -m 'Initial PMS ISO online portal'"
echo "  gh repo create kckimmarine/perfect-marine-solution-iso --private --source=. --push"
echo "  # Vercel: import repo, Root Directory = portal"
