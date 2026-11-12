#!/bin/bash
# Runs poll-hermes.sh against a throwaway task tree and checks what it claims and reports.
# Usage: bash test-poll-hermes.sh /path/to/poll-hermes.sh   (safe: only touches a temp directory)
set -u
SCRIPT="${1:?usage: test-poll-hermes.sh /path/to/poll-hermes.sh}"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/inbox" "$T/processing" "$T/outbox" "$T/archive"
task() { printf -- '---\nid: %s\nto: %s\nfrom: kem\n---\n%s' "$2" "$3" "${4:-}" > "$1/$2.md"; }

task "$T/inbox" new-hermes hermes
task "$T/inbox" other-openclaw openclaw
task "$T/inbox" body-only openclaw $'to: hermes\n'
task "$T/inbox" upper-hermes HERMES
task "$T/processing" done-hermes hermes; echo "status: DONE" > "$T/outbox/done-hermes-result.md"
task "$T/processing" waiting-hermes hermes
ln -s "$T/archive" "$T/inbox/link.md"
mkdir "$T/inbox/dir.md"

fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1"; echo "  want: $3"; echo "  got:  $2"; fail=1; fi; }

out=$(TASKS_DIR="$T" bash "$SCRIPT")
check "first run lists what waits" "$out" $'processing/new-hermes.md\nprocessing/upper-hermes.md\nprocessing/waiting-hermes.md'
check "claimed files left the inbox" "$(cd "$T/inbox" && ls | tr '\n' ' ')" "body-only.md dir.md link.md other-openclaw.md "
check "a task for another agent is untouched" "$(cat "$T/inbox/other-openclaw.md" | head -2 | tail -1)" "id: other-openclaw"
out2=$(TASKS_DIR="$T" bash "$SCRIPT")
check "second run changes nothing" "$out2" "$out"

echo "status: DONE" > "$T/outbox/new-hermes-result.md"
check "a finished task drops off the list" "$(TASKS_DIR="$T" bash "$SCRIPT")" $'processing/upper-hermes.md\nprocessing/waiting-hermes.md'

task "$T/processing" clash hermes; task "$T/inbox" clash hermes "NEW CONTENT"
TASKS_DIR="$T" bash "$SCRIPT" >/dev/null
check "a name already in processing is never overwritten" "$(grep -c 'NEW CONTENT' "$T/processing/clash.md")" "0"
check "the clashing file stays in the inbox and is reported" "$(TASKS_DIR="$T" bash "$SCRIPT" | grep -c 'inbox/clash.md')" "1"

# Not covered here: a move that fails for lack of permission falls back to listing inbox/<name>.
# That cannot be shown as root, so check it once on the VPS as the container user.
[ "$fail" = 0 ] && echo "ALL OK" || { echo "FAILED"; exit 1; }
