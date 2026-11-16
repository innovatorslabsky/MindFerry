#!/bin/bash
# Builds the MindFerry backend from one exact commit and switches the running backend to it.
# It checks the source against a list of hashes, edits only the build folder and image tag in
# compose.yaml, and puts the old compose.yaml back by itself if the new backend does not become
# healthy. Run it as the deploy user from /opt/agents/mindferry. It reads no secret.
#
#   bash deploy-backend.sh
#
# Environment (defaults match the VPS): COMPOSE_DIR, SRC_NAME (new folder), BK (backups),
#   HEALTH_URL, CONTAINER, ENV_BACKUP. (EXPECTED_FILE, TARBALL_URL and ALLOW_ANY_USER exist for the test.)
set -u
SRC_SHA=733b52c9006732b2164d65bd5d80cd397703b7f9
TAG="ap-${SRC_SHA:0:7}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/agents/mindferry}"
SRC_NAME="${SRC_NAME:-src-ap}"
BK="${BK:-$HOME/backups/deploy-ap}"
CONTAINER="${CONTAINER:-mindferry-backend}"
HEALTH_URL="${HEALTH_URL:-https://mindferry.smartcare.business/health}"
TARBALL_URL="${TARBALL_URL:-https://github.com/innovatorslabsky/MindFerry/archive/$SRC_SHA.tar.gz}"

say() { printf '== %s\n' "$*"; }
die() { printf 'STOP: %s\n' "$*" >&2; exit 1; }

wait_healthy() {
  local i s
  for i in $(seq 1 40); do
    s=$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null)
    printf '%s %s\n' "$i" "$s"
    [ "$s" = healthy ] && return 0
    sleep 5
  done
  return 1
}

rollback() {
  say "putting the old compose.yaml back"
  cp -p "$BK/compose.yaml.before" compose.yaml && docker compose up -d backend && wait_healthy
  say "rolled back: $1"
  exit 1
}

# One line per file: hash, then the path inside the new source folder.
expected() {
  cat <<EOF
66089f0bb12b6fe650b1d85de23be75a35709959ee65cb4341e27c08418e23b4  Dockerfile
b26ed1707c5caf2d12ea54c34d07c24512e62451658f5a5dee146698f4b5c48a  librechat.yaml
c5bee95d97ab028954302dfb1c56bd8c8185603317e343380d84055bc972abcd  api/server/routes/bridge.js
96d6ce55e7528eecba82e6d610def8866902b11dfcd05ca92ab26dba8611f010  packages/api/src/bridge/roles/service.ts
969d1c756241a31cbb393b812b00beef3e299dfc5cb4971fe6efc1a7ecd8bb98  packages/api/src/bridge/scan/result.ts
cdfd3cd76fbfe9cb79e8bf2ead9175d5249a084ba5ecb970a0f6fc1b069f7cb5  packages/api/src/bridge/store.ts
09774724043b3e6e4b57569403c00fe33b906ad5d4f75308660b4563a1234f71  packages/api/src/bridge/approvals/service.ts
84463a75dd364431be17d3b1399fbbc0ef33a2e33c38a3f1f05411eb0e52b6e1  packages/api/src/bridge/approvals/handlers.ts
688874547747ac4c142b8ca94a265725d83101d2d4e8ae80148b49b31a04d4b5  packages/data-schemas/src/methods/bridge.ts
15f2922d677bd53320b1354c2074a4b5de33ea71d3a1164a32d3498c4bd90e0d  packages/data-schemas/src/methods/bridgeApproval.ts
e3c96fa51af5f7c0ca9d2ef88a3c3a8c289c660db3ebe196121d65e40003e570  packages/data-schemas/src/schema/bridgeProposal.ts
a7bca3044d36311f1a0ec77e3197dda1b1c7f05085349e5a52f52f03b1945424  packages/data-provider/src/config.ts
9fe2aff32ad462400ff6447c52f24a3decf2256452c39eb3bf6a0e81ed8691cf  client/src/components/Bridge/ApprovalsPanel.tsx
99d3f264b97795be1d4d93a5835c36d58d12c2fd2e176aedbfba895377ba4785  client/src/components/Bridge/ResultDialog.tsx
1a046a06629aabb5cdcf038f84178cc7a82dfcb5d4b39c4257578d527b64a1d0  client/src/components/Bridge/ResultWarnings.tsx
61aedbe757dbccf86bd5af8a63b5aa5a36f906522eb26e59b8ac5d278def1dc2  client/src/locales/en/translation.json
EOF
}

cd "$COMPOSE_DIR" 2>/dev/null || die "$COMPOSE_DIR does not exist"
say "checks before changing anything"
[ "$(id -un)" = deploy ] || [ -n "${ALLOW_ANY_USER:-}" ] || die "run this as the deploy user"
[ -f compose.yaml ] || die "no compose.yaml here"
[ ! -e "$SRC_NAME" ] || [ -z "$(ls -A "$SRC_NAME" 2>/dev/null)" ] || die "$SRC_NAME already holds files; remove it or choose another SRC_NAME"
grep -nE 'context:|image: mindferry-backend' compose.yaml
FREE_KB=$(df -Pk . | awk 'NR==2 {print $4}')
[ "${FREE_KB:-0}" -gt $((8 * 1024 * 1024)) ] || die "less than 8 GB free"
docker compose ps || die "docker compose does not answer"
mkdir -p "$BK" && cp -p compose.yaml "$BK/compose.yaml.before" || die "backup failed"

say "source for $SRC_SHA"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/src.tar.gz" "$TARBALL_URL" || die "download failed"
mkdir -p "$SRC_NAME" && tar xzf "$TMP/src.tar.gz" -C "$SRC_NAME" --strip-components=1 || die "unpack failed"
if [ -n "${EXPECTED_FILE:-}" ]; then
  cp "$EXPECTED_FILE" "$TMP/expected.txt"
else
  expected | sed "s#  #  $SRC_NAME/#" > "$TMP/expected.txt"
  [ "$(wc -l < "$TMP/expected.txt")" = 15 ] || die "the hash list does not have 15 lines"
fi
sha256sum -c "$TMP/expected.txt" || die "the source does not match the hashes; $SRC_NAME was left for you to look at"

say "compose.yaml: build folder and image tag only"
SRC_NAME="$SRC_NAME" TAG="$TAG" python3 - <<'PY' || die "compose.yaml is not as expected; it was not changed"
import os, re
s = open("compose.yaml", encoding="utf8").read()
ctx = re.compile(r"^(      context: )\./src-[a-z]+\n", re.M)
img = re.compile(r"^(    image: mindferry-backend:)[a-z]+-[0-9a-f]{7}\n", re.M)
assert len(ctx.findall(s)) == 1, "build context line"
assert len(img.findall(s)) == 1, "image line"
s = ctx.sub(lambda m: m.group(1) + "./" + os.environ["SRC_NAME"] + "\n", s)
s = img.sub(lambda m: m.group(1) + os.environ["TAG"] + "\n", s)
open("compose.yaml", "w", encoding="utf8").write(s)
PY
diff "$BK/compose.yaml.before" compose.yaml
[ "$(diff "$BK/compose.yaml.before" compose.yaml | grep -c '^[<>]')" = 4 ] || { cp -p "$BK/compose.yaml.before" compose.yaml; die "compose.yaml changed by more than the two lines; put back"; }
docker compose config -q || { cp -p "$BK/compose.yaml.before" compose.yaml; die "compose.yaml does not validate; put back"; }

say "build (about 7 minutes; the running site is not touched)"
docker compose build backend 2>&1 | tail -15
[ "${PIPESTATUS[0]}" = 0 ] || { cp -p "$BK/compose.yaml.before" compose.yaml; die "the build failed; the old compose.yaml is back and nothing was switched"; }
docker image ls mindferry-backend

say "switch the backend (this is the 1-2 minutes of downtime)"
date -u
docker compose up -d backend || rollback "docker compose up failed"
wait_healthy || rollback "the new backend did not become healthy"
date -u
docker ps --format '{{.Names}}  {{.Status}}' | grep mindferry

say "checks on the new backend"
curl -sS "$HEALTH_URL"; echo
ROLES_CODE=$(curl -sS -o /dev/null -w '%{http_code}' "${HEALTH_URL%/health}/api/bridge/approvals")
echo "approvals, not signed in (want 401): $ROLES_CODE"
[ "$ROLES_CODE" = 401 ] || rollback "the new approvals route did not answer 401 when not signed in ($ROLES_CODE)"
docker exec "$CONTAINER" sh -c 'touch /home/deploy/tasks/outbox/.rwtest 2>&1; echo "outbox write rc=$?"'
docker compose logs --tail 150 backend | grep -iE 'error|fail|invalid' | head -20
[ -x ./scripts/mf-env.py ] && ./scripts/mf-env.py verify "${ENV_BACKUP:-$HOME/backups/mindferry-20261106}"
say "done: $TAG is running. The old compose.yaml is $BK/compose.yaml.before"
