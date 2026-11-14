#!/bin/bash
# Gives every OpenClaw task its own session, so one task's data cannot stay in the next task's context.
# It edits ONE line of poll-openclaw-gated.sh: `openclaw agent --timeout 600 -m "$M"` gets
# `--session-id "bridge-$ID-<seconds>"`. It refuses to touch a file that is not exactly as expected,
# keeps a backup, and checks the result with `bash -n` before putting it in place.
#
#   bash patch-gated-session.sh [path to poll-openclaw-gated.sh]      (default /home/deploy/tasks/...)
#   BK=<backup dir>   (default $HOME/backups/oc-session)
set -u
F="${1:-/home/deploy/tasks/poll-openclaw-gated.sh}"
BK="${BK:-$HOME/backups/oc-session}"
die() { printf 'STOP: %s\n' "$*" >&2; exit 1; }

[ -f "$F" ] && [ -w "$F" ] || die "$F is not a writable file"
grep -q -- '--session-id' "$F" && die "$F already has --session-id; nothing to do"
LINE_RE='openclaw agent --timeout 600 -m "\$M"'
[ "$(grep -c -- "$LINE_RE" "$F")" = 1 ] || die "expected exactly one line with: openclaw agent --timeout 600 -m \"\$M\""
grep -q '\$ID' "$F" || die "the script does not use \$ID, so the session name cannot be built"

mkdir -p "$BK" && cp -p "$F" "$BK/$(basename "$F").before" || die "backup failed"
NEW="$(mktemp "$F.XXXXXX")" || die "cannot create a temporary file next to $F"
trap 'rm -f "$NEW"' EXIT
sed 's|openclaw agent --timeout 600 -m "\$M"|openclaw agent --session-id "bridge-${ID}-$(date +%s)" --timeout 600 -m "$M"|' "$F" > "$NEW" || die "sed failed"
bash -n "$NEW" || die "the edited script does not parse; nothing changed"
[ "$(diff "$F" "$NEW" | grep -c '^[<>]')" = 2 ] || die "the change is not exactly one line; nothing changed"
chmod --reference="$F" "$NEW"
diff "$F" "$NEW"
mv "$NEW" "$F" && trap - EXIT || die "mv failed"
echo "done; the backup is $BK/$(basename "$F").before"
