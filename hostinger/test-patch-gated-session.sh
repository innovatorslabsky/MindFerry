#!/bin/bash
# Runs patch-gated-session.sh against stand-in copies of the poll script; nothing real is touched.
# Usage: bash test-patch-gated-session.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export BK="$T/bk"
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1"; echo "  want: $3"; echo "  got:  $2"; fail=1; fi; }

# The shape the VPS script has: it asks poll-openclaw.sh for work, then calls the gateway agent.
make() {
  cat > "$1" <<'FIXTURE'
#!/bin/bash
OUT=$(/home/deploy/tasks/poll-openclaw.sh)
[ "$OUT" = "NO-TASKS" ] && exit 0
ID=$(printf '%s' "$OUT" | sed -n 's/^TASK \([^ ]*\) .*/\1/p')
P=$(printf '%s' "$OUT" | sed -n 's/^TASK [^ ]* at \(.*\)/\1/p')
echo "TASK $ID at $P -- calling gateway agent"
M="Read the task file $P and do exactly what its task field says."
docker exec openclaw-openclaw-gateway-1 openclaw agent --timeout 600 -m "$M" || echo "AGENT-FAILED $ID"
FIXTURE
  chmod 750 "$1"
}

F="$T/poll-openclaw-gated.sh"; make "$F"
cp "$F" "$T/orig"
out=$(bash "$HERE/patch-gated-session.sh" "$F" 2>&1); rc=$?
check "patch exits 0" "$rc" 0
check "the call gets a session id built from the task id" \
  "$(grep -c 'openclaw agent --session-id "bridge-${ID}-$(date +%s)" --timeout 600 -m "$M"' "$F")" 1
check "only that line changed" "$(diff "$T/orig" "$F" | grep -c '^[<>]')" 2
check "the mode is kept" "$(stat -c %a "$F")" 750
check "the result parses" "$(bash -n "$F" && echo yes)" yes
check "a backup of the old script exists" "$(cmp -s "$BK/poll-openclaw-gated.sh.before" "$T/orig" && echo same)" same
check "no temporary file is left" "$(ls "$T" | grep -c 'poll-openclaw-gated.sh\.')" 0

# The id it builds is a plain word with no spaces or quotes, for a real task id.
ID=2026-11-14-0534-openclaw-write-todays-brief; S="bridge-${ID}-1700000000"
check "the session name is shell-safe" "$(printf '%s' "$S" | grep -cE '^[A-Za-z0-9._-]+$')" 1

out=$(bash "$HERE/patch-gated-session.sh" "$F" 2>&1); rc=$?
check "a second run refuses" "$rc" 1
check "and says why" "$(grep -c 'already has --session-id' <<<"$out")" 1
check "and leaves the file" "$(grep -c -- '--session-id' "$F")" 1

F2="$T/other.sh"; make "$F2"; sed -i 's/--timeout 600/--timeout 900/' "$F2"
out=$(bash "$HERE/patch-gated-session.sh" "$F2" 2>&1); rc=$?
check "a different command line is refused" "$rc" 1
check "and left alone" "$(grep -c 'timeout 900' "$F2")" 1

F3="$T/dup.sh"; make "$F3"; tail -1 "$F3" >> "$F3"
out=$(bash "$HERE/patch-gated-session.sh" "$F3" 2>&1); rc=$?
check "two matching lines are refused" "$rc" 1

F4="$T/noid.sh"; make "$F4"; sed -i 's/\$ID/$X/g' "$F4"
out=$(bash "$HERE/patch-gated-session.sh" "$F4" 2>&1); rc=$?
check "a script without \$ID is refused" "$rc" 1

out=$(bash "$HERE/patch-gated-session.sh" "$T/missing.sh" 2>&1); rc=$?
check "a missing file is refused" "$rc" 1
[ "$fail" = 0 ] && echo "ALL OK" || { echo "FAILED"; exit 1; }
