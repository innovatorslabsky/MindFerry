#!/bin/sh
# Runs INSIDE the freellmapi image as root (mounted by restore-freellmapi.sh).
# Puts freeapi.db, freeapi.db-wal and freeapi.db-shm at the root of the volume.
# Accepts a backup archive whose files sit under "data/" or "./", and a volume that is
# either empty or holds only the "data/" directory left by the first, wrong extraction.
# Nothing is deleted except empty directories (lost+found, data/).
set -eu
D="${D:-/d}"
A="${A:-/backup/freellmapi-data.tgz}"

top="$(ls -A "$D")"
if [ -z "$top" ]; then
  tar xzf "$A" -C "$D" --exclude='*lost+found*'
elif [ "$top" != data ]; then
  echo "ERROR: $D has unexpected content, refusing:"; ls -la "$D"; exit 1
fi

if [ -d "$D/data" ] && [ ! -e "$D/freeapi.db" ]; then
  chown --reference="$D/data" "$D"
  chmod --reference="$D/data" "$D"
  find "$D/data" -mindepth 1 -maxdepth 1 -name 'lost+found' -type d -exec rmdir {} +
  find "$D/data" -mindepth 1 -maxdepth 1 -exec mv -t "$D" {} +
  rmdir "$D/data"
fi
ls -la "$D"

for f in freeapi.db freeapi.db-wal freeapi.db-shm; do
  m="$(tar tzf "$A" | grep -E "(^|/)$f\$" | head -n 1)"
  [ -n "$m" ] || { echo "ERROR: $f is not in the archive"; exit 1; }
  a="$(tar xzOf "$A" "$m" | wc -c)"
  b="$(wc -c < "$D/$f")"
  if [ "$a" = "$b" ]; then echo "OK    $f $b bytes"; else echo "DIFF  $f archive=$a volume=$b"; exit 1; fi
done
echo FREELLMAPI_RESTORE_OK
