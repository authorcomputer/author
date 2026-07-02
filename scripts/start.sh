#!/bin/sh
# prod entrypoint. with a backup bucket configured, run under litestream:
# restore the db first if the volume came up empty (new/replaced volume),
# then replicate continuously while the server runs. without a bucket
# (local dev, missing secrets) just run the server.
set -e
DB=/app/data/author.db

if [ -n "$BUCKET_NAME" ] && command -v litestream >/dev/null 2>&1; then
  litestream restore -if-db-not-exists -if-replica-exists "$DB"
  exec litestream replicate -exec "node server/index.js"
fi

exec node server/index.js
