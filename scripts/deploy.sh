#!/bin/sh
# the one way to ship: snapshot the volume, build, deploy, verify.
set -e
cd "$(dirname "$0")/.."
APP=author-computer

# restore point first — warn but continue if it fails (e.g. host trouble),
# litestream is the real safety net
VOL=$(fly volumes list -a "$APP" --json | node -e "
  const v = JSON.parse(require('fs').readFileSync(0, 'utf8')).find(v => v.name === 'author_data')
  if (v) console.log(v.id)
")
if [ -n "$VOL" ]; then
  fly volumes snapshots create "$VOL" -a "$APP" || echo "!! snapshot failed, deploying anyway"
else
  echo "!! author_data volume not found, skipping snapshot"
fi

npx vite build
fly deploy --ha=false -a "$APP"

# prod must serve the bundle we just built
HASH=$(basename dist/assets/index-*.js)
if curl -s --max-time 15 https://author.computer/ | grep -q "$HASH"; then
  echo "✓ prod is serving $HASH"
else
  echo "!! prod is NOT serving $HASH — check the deploy" >&2
  exit 1
fi
