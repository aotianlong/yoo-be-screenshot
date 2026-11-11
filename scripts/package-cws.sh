#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('${ROOT}/manifest.json').version")"
OUT="${ROOT}/dist/yoo-screenshot-v${VERSION}.zip"

mkdir -p "${ROOT}/dist"
rm -f "$OUT"

cd "$ROOT"
zip -r "$OUT" . \
  -x ".git/*" \
  -x ".agents/*" \
  -x "dist/*" \
  -x "CHROMEWEBSTORE.md" \
  -x "docs/*" \
  -x "README.md" \
  -x "skills-lock.json" \
  -x "external-extensions.json" \
  -x "scripts/*" \
  -x "site/*" \
  -x "wrangler.pages.toml" \
  -x ".*" \
  -x "**/.DS_Store" \
  -x "**/__MACOSX/*"

echo "Created: $OUT"
zipinfo -1 "$OUT" | head -30
echo "..."
echo "Total files: $(zipinfo -1 "$OUT" | wc -l | tr -d ' ')"
