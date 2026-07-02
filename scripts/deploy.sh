#!/bin/sh
# the one way to ship: snapshot the volume, build, deploy, verify.
set -e
cd "$(dirname "$0")/.."
APP=author-computer

# restore point first — warn but continue if any of it fails (fly API
# hiccup, host trouble), litestream is the real safety net. the try/catch
# and || true keep a failed list/parse from killing the script under set -e
VOL=$(fly volumes list -a "$APP" --json 2>/dev/null | node -e "
  let vols = []
  try { vols = JSON.parse(require('fs').readFileSync(0, 'utf8')) } catch {}
  const v = Array.isArray(vols) && vols.find(v => v.name === 'author_data')
  if (v) console.log(v.id)
" || true)
if [ -n "$VOL" ]; then
  fly volumes snapshots create "$VOL" -a "$APP" || echo "!! snapshot failed, deploying anyway"
else
  echo "!! author_data volume not found, skipping snapshot"
fi

npx vite build
fly deploy --ha=false -a "$APP"

# prod must serve the bundle we just built (newest, in case the entry
# ever gains sibling index-* chunks — basename mishandles multiple args)
HASH=$(ls -t dist/assets/index-*.js | head -1 | xargs basename)
if curl -s --max-time 15 https://author.computer/ | grep -q "$HASH"; then
  echo "✓ prod is serving $HASH"
else
  echo "!! prod is NOT serving $HASH — check the deploy" >&2
  exit 1
fi
