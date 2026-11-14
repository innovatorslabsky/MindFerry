#!/bin/bash
# Puts OpenClaw's agent in the task folder (read-only except outbox/) and confines its file tools to it.
# Runs on the VPS as the deploy user. It backs the config up, checks every step, and puts the old
# config back by itself if the config is refused or the agent cannot start. Nothing here reads a secret.
#
#   bash oc-workspace.sh <directory holding openclaw-tool-policy.js and its test>
#
# Environment (defaults match the VPS):
#   GW=openclaw-openclaw-gateway-1   CFG=/home/node/.openclaw/openclaw.json (inside the container)
#   HOSTCFG=/home/deploy/.openclaw/openclaw.json   BK=$HOME/backups/oc-2b   TASKS=/home/deploy/tasks
set -u
SRC="${1:?usage: oc-workspace.sh <directory with openclaw-tool-policy.js>}"
GW="${GW:-openclaw-openclaw-gateway-1}"
CFG="${CFG:-/home/node/.openclaw/openclaw.json}"
HOSTCFG="${HOSTCFG:-/home/deploy/.openclaw/openclaw.json}"
BK="${BK:-$HOME/backups/oc-2b}"
TASKS="${TASKS:-/home/deploy/tasks}"
WANT_POLICY=70d5f43920ab970f7b17dbdfcb51eb9188d49ac51768d2e8914b320d80162bbd
WANT_TEST=507792d14f561581589ac5d3434604127924dfe0e67f09b83139ef118a63086c

say() { printf '== %s\n' "$*"; }
die() { printf 'STOP: %s\n' "$*" >&2; exit 1; }

wait_healthy() {
  local i s
  for i in $(seq 1 30); do
    s=$(docker inspect -f '{{.State.Health.Status}}' "$GW" 2>/dev/null)
    printf '%s %s\n' "$i" "$s"
    [ "$s" = healthy ] && return 0
    sleep 5
  done
  return 1
}

rollback() {
  say "putting the old config back"
  cp -p "$BK/openclaw.json.before-wsrun" "$HOSTCFG" && docker restart "$GW" >/dev/null && wait_healthy
  say "rolled back: $1"
  exit 1
}

say "checks before changing anything"
[ -z "$(ls -A "$TASKS/inbox" 2>/dev/null)$(ls -A "$TASKS/processing" 2>/dev/null)" ] || die "inbox/ or processing/ is not empty"
[ "$(sha256sum "$SRC/openclaw-tool-policy.js" | cut -d' ' -f1)" = "$WANT_POLICY" ] || die "policy script hash differs"
[ "$(sha256sum "$SRC/test-openclaw-tool-policy.js" | cut -d' ' -f1)" = "$WANT_TEST" ] || die "policy test hash differs"
docker exec "$GW" sh -c "test ! -e $CFG.new" || die "$CFG.new already exists in the container; look at it, then remove it (rm) and run again"
docker exec "$GW" openclaw config validate | tail -1
mkdir -p "$BK" && cp -p "$HOSTCFG" "$BK/openclaw.json.before-wsrun" || die "backup failed"

say "script into the container, hash re-checked inside, tests"
docker cp "$SRC/openclaw-tool-policy.js" "$GW:/tmp/" && docker cp "$SRC/test-openclaw-tool-policy.js" "$GW:/tmp/" || die "docker cp failed"
[ "$(docker exec "$GW" sha256sum /tmp/openclaw-tool-policy.js | cut -d' ' -f1)" = "$WANT_POLICY" ] || die "the copy in the container differs"
docker exec "$GW" node --test /tmp/test-openclaw-tool-policy.js 2>&1 | grep -E '(tests|pass|fail) [0-9]+' | tr '\n' ' '; echo
docker exec "$GW" node --test /tmp/test-openclaw-tool-policy.js >/dev/null 2>&1 || die "the policy tests fail"

say "prepare the new config and compare"
docker exec "$GW" node /tmp/openclaw-tool-policy.js "$CFG" --stage 2 --workspace "$TASKS" --skip-bootstrap || die "the script wrote nothing"
docker exec "$GW" node -e '
  const fs = require("fs");
  const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const b = JSON.parse(fs.readFileSync(process.argv[1] + ".new", "utf8"));
  const paths = (o, p = "") => Object.entries(o ?? {}).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) ? paths(v, p + k + ".") : [p + k]);
  const was = new Set(paths(a));
  const added = paths(b).filter((k) => !was.has(k)).sort();
  const gone = [...was].filter((k) => !paths(b).includes(k));
  console.log("added:", added.join(", "));
  console.log("removed:", gone.join(", ") || "none");
  const ok = JSON.stringify(added) === JSON.stringify(
    ["agents.defaults.skipBootstrap", "agents.defaults.workspace", "tools.fs.workspaceOnly"]) && gone.length === 0;
  process.exit(ok ? 0 : 1);' "$CFG" || die "the new config differs from the expected three additions (see the lines above); nothing was changed"

say "put it in place and let OpenClaw check it"
docker exec "$GW" sh -c "mv $CFG.new $CFG" || die "mv failed"
if ! docker exec "$GW" openclaw config validate; then rollback "the config was refused"; fi

say "restart and start the agent"
docker restart "$GW" >/dev/null
wait_healthy || rollback "the gateway did not become healthy"
OUT=$(docker exec "$GW" openclaw agent --timeout 180 -m "Read $TASKS/README.md and tell me its first line." 2>&1)
printf '%s\n' "$OUT" | head -12
case "$OUT" in *"Tasks bridge"*) say "agent started and read the README; now run the probes (step 4b)";;
  *) rollback "the agent did not start or could not read the README";; esac
