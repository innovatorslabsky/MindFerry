#!/bin/bash
# Tasks bridge monitor for Hermes (hermes cron --monitor-script).
#
# 1. Claims new tasks: a file in inbox/ whose frontmatter says "to: hermes" is moved (atomic mv, same
#    filesystem) to processing/. Hermes itself no longer needs a shell to do this.
# 2. Prints, one per line and sorted, every hermes task that still waits for a result:
#      processing/<name>.md   in processing/ with no outbox/<id>-result.md yet
#      inbox/<name>.md        only when the move above failed, so a task is never silently stuck
#    Empty output = nothing for Hermes. The output changes only when a task is claimed or its result
#    appears, so an unchanged list does not start the agent again.
#
# Canonical location: /home/deploy/tasks/poll-hermes.sh (host)
#   In Hermes container: /opt/data/tasks/poll-hermes.sh
# Cron copy: /home/deploy/.hermes/scripts/poll-hermes.sh (container: /opt/data/scripts/poll-hermes.sh)
# If you edit this file, copy it to the cron location too.
TASKS_DIR="${TASKS_DIR:-/opt/data/tasks}"
[ -d "$TASKS_DIR/inbox" ] || exit 0
[ -d "$TASKS_DIR/processing" ] || exit 0

# The lowercased "to:" value, read from the frontmatter only (between the two --- lines).
addressed_to() {
  awk '
    NR == 1 && $0 != "---" { exit }
    NR > 1 && $0 == "---" { exit }
    /^to:[[:space:]]*/ {
      sub(/^to:[[:space:]]*/, ""); gsub(/[[:space:]]+$/, ""); print tolower($0); exit
    }' "$1" 2>/dev/null
}

is_mine() {
  [ -f "$1" ] && [ ! -L "$1" ] && [ "$(addressed_to "$1")" = "hermes" ]
}

# 1. Claim. Never overwrite: a name that already exists in processing/ stays where it is.
for f in "$TASKS_DIR"/inbox/*.md; do
  is_mine "$f" || continue
  dst="$TASKS_DIR/processing/$(basename "$f")"
  [ -e "$dst" ] && continue
  mv -n -- "$f" "$dst" 2>/dev/null || true
done

# 2. Report.
{
  for f in "$TASKS_DIR"/processing/*.md; do
    is_mine "$f" || continue
    name=$(basename "$f")
    [ -e "$TASKS_DIR/outbox/${name%.md}-result.md" ] && continue
    echo "processing/$name"
  done
  for f in "$TASKS_DIR"/inbox/*.md; do
    is_mine "$f" || continue
    echo "inbox/$(basename "$f")"
  done
} | sort
