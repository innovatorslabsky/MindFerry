#!/usr/bin/env bash
# Unpack the freellmapi data (freeapi.db + -wal + -shm) into the new volume.
# The freellmapi container must exist but must NOT have been started yet.
# usage: restore-freellmapi.sh <backup_dir>
set -euo pipefail
BK="${1:?usage: restore-freellmapi.sh <backup_dir>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
C=mindferry-freellmapi
V=mindferry-freellmapi-data
IMG="$(docker inspect -f '{{.Config.Image}}' "$C")"

[ "$(docker inspect -f '{{.State.Running}}' "$C")" = false ] || { echo "ERROR: $C is running; stop it first"; exit 1; }
[ "$(docker inspect -f '{{.State.StartedAt}}' "$C")" = "0001-01-01T00:00:00Z" ] || { echo "ERROR: $C has been started before; stop and ask"; exit 1; }

docker run --rm --user 0 --entrypoint sh \
  -v "$V":/d -v "$BK":/backup:ro -v "$HERE":/scripts:ro \
  "$IMG" /scripts/freellmapi-unpack.sh
