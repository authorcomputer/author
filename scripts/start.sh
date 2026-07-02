#!/bin/sh
# prod entrypoint. with backup secrets configured, run under litestream:
# restore the db first if the volume came up empty (new/replaced volume),
# then replicate continuously while the server runs. without them
# (local dev) just run the server.
set -e
DB=/app/data/author.db

# both must be present — with only the bucket set, litestream would quietly
# aim at real AWS S3 and replicate nothing
if [ -n "$BUCKET_NAME" ] && [ -n "$AWS_ENDPOINT_URL_S3" ]; then
  if [ ! -f "$DB" ]; then
    # a stale WAL next to a restored db would be replayed into it —
    # SQLite never checks that a WAL belongs to its neighbor
    rm -f "$DB-wal" "$DB-shm"
    litestream restore -if-replica-exists "$DB"
  fi
  exec litestream replicate -exec "node server/index.js"
fi

if [ "$NODE_ENV" = "production" ]; then
  echo "!! BUCKET_NAME / AWS_ENDPOINT_URL_S3 not set — running WITHOUT replication" >&2
fi
exec node server/index.js
