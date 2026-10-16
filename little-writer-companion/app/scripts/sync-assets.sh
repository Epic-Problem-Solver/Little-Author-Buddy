#!/usr/bin/env sh
# Copy Animator assets + Writer content into the embedded frontend (ui/). Missing dirs are fine.
set -e
D=$(cd "$(dirname "$0")/.." && pwd); R="$D/.."
rm -rf "$D/ui/assets" "$D/ui/content"; mkdir -p "$D/ui/assets" "$D/ui/content"
[ -d "$R/assets" ] && cp "$R"/assets/*.svg "$R"/assets/*.css "$R"/assets/*.js "$D/ui/assets/" 2>/dev/null || true
[ -d "$R/content" ] && cp "$R"/content/*.json "$D/ui/content/" 2>/dev/null || true
echo "synced: $(ls "$D/ui/assets" "$D/ui/content" | tr '\n' ' ')"
